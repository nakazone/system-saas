import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { encryptSecret, generateTotpSecret, totpAt } from "../src/lib/auth/totp.js";
import { resetThrottle, issueActivation } from "../src/master/auth.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { email as emailProvider, type EmailMessage } from "../src/lib/email/index.js";
import { deviceLabel, cleanupLoginHistory } from "../src/lib/security/login-events.js";

const prisma = new PrismaClient();
const suffix = `sg${Date.now().toString(36)}`;
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0 Mobile/15E148 Safari/604.1";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Aparelho", () => {
  it("nomeia navegador e sistema", () => {
    expect(deviceLabel(MAC)).toBe("Safari · macOS");
    expect(deviceLabel(IPHONE)).toBe("Chrome · iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge · Windows");
    expect(deviceLabel("")).toBe("Aparelho desconhecido");
  });

  it("apaga histórico com mais de 180 dias", async () => {
    const old = await prisma.loginEvent.create({ data: { kind: "user", email: `old-${suffix}@x.com`, success: true, createdAt: new Date(Date.now() - 181 * 86400e3) } });
    const fresh = await prisma.loginEvent.create({ data: { kind: "user", email: `new-${suffix}@x.com`, success: true } });
    await cleanupLoginHistory();
    expect(await prisma.loginEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.loginEvent.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});

const privileged = await prisma
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false);

describe.skipIf(!privileged)("Segurança do Master (HTTP)", () => {
  let server: Server;
  let base = "";
  const secret = generateTotpSecret();
  const masterEmail = `master-${suffix}@example.com`;
  const password = "master-password-123";
  const sent: EmailMessage[] = [];
  const realSend = emailProvider.send.bind(emailProvider);

  /** A browser: its own cookie jar (session + device cookie). */
  function browser(ua: string) {
    const jar = new Map<string, string>();
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const take = (r: Response) => {
      for (const c of r.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(";");
        const i = kv.indexOf("=");
        jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
    };
    return {
      jar,
      async get(p: string) {
        const r = await fetch(base + p, { headers: { Cookie: cookie(), "User-Agent": ua }, redirect: "manual" });
        take(r);
        return r;
      },
      async post(p: string, body: Record<string, string> = {}, json = false) {
        const r = await fetch(base + p, {
          method: "POST",
          headers: { Cookie: cookie(), "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded", ...(json ? { Accept: "application/json", "X-Requested-With": "fetch" } : {}) },
          body: new URLSearchParams(body),
          redirect: "manual",
        });
        take(r);
        return r;
      },
      async login() {
        const r1 = await this.post("/master/entrar", { email: masterEmail, password });
        if (r1.headers.get("location") !== "/master/2fa") return r1;
        return this.post("/master/2fa", { code: totpAt(secret, Date.now()) });
      },
    };
  }

  beforeAll(async () => {
    resetThrottle();
    emailProvider.send = async (m) => {
      sent.push(m);
      return realSend(m);
    };
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({ data: { email: masterEmail, name: "Naka Seg", role: "MASTER", status: "active", passwordHash: await hashPassword(password), totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!), totpEnabledAt: new Date(), recoveryCodeHashes: [] } });
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    emailProvider.send = realSend;
    server?.close();
  });

  const alerts = () => sent.filter((m) => m.to === masterEmail && /novo acesso/.test(m.subject));

  it("1º login não alerta; aparelho novo alerta; o mesmo aparelho não", async () => {
    const mac = browser(MAC);
    expect((await mac.login()).headers.get("location")).toBe("/master");
    expect(mac.jar.has("om_mdev")).toBe(true);
    expect(alerts()).toHaveLength(0);
    const phone = browser(IPHONE);
    expect((await phone.login()).headers.get("location")).toBe("/master");
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].text).toContain("Chrome · iPhone");
    // Same Mac again (cookie kept): no alert.
    await mac.post("/master/sair");
    await mac.login();
    expect(alerts()).toHaveLength(1);
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    const ev = await prisma.loginEvent.findMany({ where: { adminId: admin.id, success: true }, orderBy: { createdAt: "asc" } });
    expect(ev.map((e) => e.newDevice)).toEqual([false, true, false]);
  });

  it("senha errada fica no histórico; minhas sessões lista e encerra os outros", async () => {
    const pc = browser("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36");
    await pc.post("/master/entrar", { email: masterEmail, password: "errada" });
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    expect(await prisma.loginEvent.findFirst({ where: { adminId: admin.id, success: false, reason: "wrong_password" } })).not.toBeNull();
    const a = browser(MAC);
    await a.login();
    const b = browser(IPHONE);
    await b.login();
    const page = await (await a.get("/master/seguranca")).text();
    expect(page).toContain("Este aparelho");
    expect(page).toContain("Chrome · iPhone");
    expect(page).toContain("Senha errada");
    const r = await a.post("/master/seguranca/sessoes/outras", {}, true);
    expect(r.status).toBe(200);
    expect((await b.get("/master")).headers.get("location")).toBe("/master/entrar");
    expect((await a.get("/master")).status).toBe(200);
  });

  it("“não fui eu” derruba tudo e trava; só um link novo destrava", async () => {
    sent.length = 0;
    const mine = browser(MAC);
    await mine.login();
    const intruder = browser("Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0");
    await intruder.login();
    const mail = alerts().pop()!;
    const link = mail.text.match(/\/master\/nao-fui-eu\/[A-Za-z0-9_-]+/)![0];
    const confirmPage = await mine.get(link);
    expect(confirmPage.status).toBe(200);
    expect(await confirmPage.text()).toContain("Firefox · Linux");
    const done = await mine.post(link);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("Conta travada");
    expect((await intruder.get("/master")).headers.get("location")).toBe("/master/entrar");
    expect((await mine.post(link)).status).toBe(410); // single use
    const again = await browser(MAC).post("/master/entrar", { email: masterEmail, password });
    expect(again.status).toBe(423);
    // Recovery: npm run master:link → activation clears the lock.
    const activation = await issueActivation((await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } })).id);
    const rec = browser(MAC);
    const path = activation.replace(/^https?:\/\/[^/]+/, "");
    await rec.get(path);
    const act = await rec.post(path, { name: "Naka Seg", password: "nova-senha-segura-123", confirm: "nova-senha-segura-123" });
    expect(act.headers.get("location")).toBe("/master/2fa/configurar");
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } })).securityLockedAt).toBeNull();
    expect(await prisma.platformAuditLog.findFirst({ where: { action: "auth.not_me" } })).not.toBeNull();
  });

  it("login de usuário de empresa vai para o histórico e aparece na ficha", async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `Seg Co ${suffix}`, slug: `seg-${suffix}`, adminName: "Uma Pessoa", adminEmail: `user-${suffix}@example.com`, password: "Test-Passw0rd-2026" });
    const login = (pw: string) =>
      fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": IPHONE }, body: JSON.stringify({ email: `user-${suffix}@example.com`, password: pw, organizationId: a.organization.id }) });
    expect((await login("errada")).status).toBe(401);
    expect((await login("Test-Passw0rd-2026")).status).toBe(200);
    const ev = await prisma.loginEvent.findMany({ where: { userId: a.admin.id }, orderBy: { createdAt: "asc" } });
    expect(ev.map((e) => [e.success, e.reason, e.device])).toEqual([
      [false, "wrong_password", "Chrome · iPhone"],
      [true, null, "Chrome · iPhone"],
    ]);
    // Master record (the lock above was cleared, sign in with the new password needs 2FA setup → use a fresh admin).
    await prisma.platformAdmin.update({ where: { email: masterEmail }, data: { passwordHash: await hashPassword(password), totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!), totpEnabledAt: new Date() } });
    const m = browser(MAC);
    await m.login();
    const html = await (await m.get(`/master/usuarios/${a.admin.id}`)).text();
    expect(html).toContain("Histórico de login");
    expect(html).toContain("Senha errada");
  });
});
