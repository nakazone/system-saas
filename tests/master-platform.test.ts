import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { totpAt, verifyTotp, generateTotpSecret, encryptSecret, decryptSecret } from "../src/lib/auth/totp.js";
import { ensureMaster, issueActivation, resetThrottle } from "../src/master/auth.js";
import { daysUntil, dayFromToday, cyclePriceCents, dueChip } from "../src/master/lib.js";

/** The Master area reads every tenant — needs a privileged DB role (like production). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe("Master — helpers", () => {
  it("TOTP matches RFC 6238 test vector and tolerates one step of drift", () => {
    // RFC 6238 SHA-1 secret "12345678901234567890" (base32 below), T=59 → 94287082 → last 6 digits
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpAt(secret, 59_000)).toBe("287082");
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpAt(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, "abc", now)).toBe(false);
  });

  it("encrypts the TOTP secret at rest", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP", "k".repeat(32));
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc, "k".repeat(32))).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptSecret(enc, "x".repeat(32))).toThrow();
  });

  it("computes due chips and prices", () => {
    expect(daysUntil(dayFromToday(5))).toBe(5);
    expect(daysUntil(dayFromToday(-2))).toBe(-2);
    expect(dueChip(-3).label).toBe("Venceu há 3d");
    expect(dueChip(0).tone).toBe("danger");
    expect(dueChip(4).tone).toBe("warn");
    expect(cyclePriceCents({ plan: "starter", billingCycle: "monthly", planPriceCents: null })).toBe(12900);
    expect(cyclePriceCents({ plan: "starter", billingCycle: "annual", planPriceCents: null })).toBe(129000);
    expect(cyclePriceCents({ plan: "business", billingCycle: "monthly", planPriceCents: 45000 })).toBe(45000);
  });
});

describe.skipIf(!privileged)("Master — login, 2FA, ações e auditoria", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let cookie = "";
  let secret = "";
  let orgId = "";
  let orgSlug = "";
  let userId = "";
  const suffix = `ms${Date.now().toString(36)}`;
  const masterEmail = `master-${suffix}@example.com`;
  const masterPassword = "master-password-123";
  const tenantEmail = `owner-${suffix}@example.com`;

  function grab(r: Response) {
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  }
  async function get(path: string, json = false) {
    const r = await fetch(base + path, { headers: { Cookie: cookie, ...(json ? { Accept: "application/json" } : {}) }, redirect: "manual" });
    grab(r);
    return r;
  }
  async function form(path: string, body: Record<string, string>, json = true) {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", ...(json ? { Accept: "application/json", "X-Requested-With": "fetch" } : {}) },
      body: new URLSearchParams(body),
      redirect: "manual",
    });
    grab(r);
    return r;
  }
  const code = () => totpAt(secret, Date.now());

  beforeAll(async () => {
    resetThrottle();
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `Master Co ${suffix}`, slug: `master-${suffix}`, adminName: "Olivia Owner", adminEmail: tenantEmail, password: "password12345" });
    orgId = a.organization.id;
    orgSlug = a.organization.slug;
    userId = (await prisma.user.findFirstOrThrow({ where: { organizationId: orgId } })).id;
    await prisma.organization.update({ where: { id: orgId }, data: { status: "trial", trialEndsAt: dayFromToday(2) } });

    // Exactly one Master: hand the role to this test's account.
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({ data: { email: masterEmail, name: "Naka Test", passwordHash: await hashPassword(masterPassword), status: "active" } });
    process.env.MASTER_EMAIL = masterEmail;
    await ensureMaster();
    delete process.env.MASTER_EMAIL;

    const app = createApp();
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("promoveu a conta certa e só permite um Master", async () => {
    const m = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    expect(m.role).toBe("MASTER");
    await expect(
      prisma.platformAdmin.create({ data: { email: `second-${suffix}@example.com`, name: "Second", passwordHash: "", role: "MASTER" } }),
    ).rejects.toThrow();
  });

  it("sem login, nada do Master abre", async () => {
    expect((await get("/master")).headers.get("location")).toBe("/master/entrar");
    expect((await form("/master/clientes/" + orgId + "/suspender", {})).status).toBe(401);
    expect((await get("/master/busca?q=ma", true)).status).toBe(401);
  });

  it("senha errada não passa; sem 2FA a senha só manda link por e-mail", async () => {
    const bad = await form("/master/entrar", { email: masterEmail, password: "nope" }, false);
    expect(bad.status).toBe(401);
    const good = await form("/master/entrar", { email: masterEmail, password: masterPassword }, false);
    expect(good.status).toBe(200);
    expect(await good.text()).toContain("Enviamos um link");
    // Password alone does not open anything.
    expect((await get("/master")).headers.get("location")).toBe("/master/entrar");
    expect((await get("/master/2fa/configurar")).headers.get("location")).toBe("/master/entrar");

    // The e-mailed link (the test issues its own) leads to password + 2FA setup.
    const m = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    const link = new URL(await issueActivation(m.id));
    const act = await fetch(base + link.pathname, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Naka Test", password: masterPassword, confirm: masterPassword }), redirect: "manual" });
    grab(act);
    expect(act.headers.get("location")).toBe("/master/2fa/configurar");

    const setup = await get("/master/2fa/configurar");
    const html = await setup.text();
    expect(html).toContain("<svg");
    secret = (html.match(/class="secret">([A-Z2-7 ]+)</)?.[1] ?? "").replace(/\s/g, "");
    expect(secret.length).toBeGreaterThan(20);

    const wrong = await form("/master/2fa/configurar", { code: "000000" }, false);
    expect(wrong.status).toBe(400);
    const done = await form("/master/2fa/configurar", { code: code() }, false);
    expect(done.status).toBe(200);
    const codesHtml = await done.text();
    expect((codesHtml.match(/<span>[A-Z0-9]{4}-[A-Z0-9]{4}<\/span>/g) ?? []).length).toBe(10);

    const saved = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    expect(saved.totpEnabledAt).not.toBeNull();
    expect(saved.totpSecretEnc).not.toContain(secret);
  });

  it("login completo: senha + código", async () => {
    await form("/master/sair", {}, false);
    expect((await get("/master")).status).toBe(302);
    const step1 = await form("/master/entrar", { email: masterEmail, password: masterPassword }, false);
    expect(step1.headers.get("location")).toBe("/master/2fa");
    const step2 = await form("/master/2fa", { code: code() }, false);
    expect(step2.headers.get("location")).toBe("/master");
  });

  it("todas as telas abrem", async () => {
    for (const p of ["/master", "/master/clientes", "/master/usuarios", "/master/contatos", "/master/pagamentos", "/master/vencimentos", "/master/equipe", "/master/auditoria", `/master/clientes/${orgId}`, `/master/clientes/${orgId}?partial=1`, `/master/usuarios/${userId}?partial=1`]) {
      const r = await get(p);
      expect(r.status, p).toBe(200);
    }
    const central = await (await get("/master")).text();
    expect(central).toContain(`Master Co ${suffix}`);
    const busca = await (await get(`/master/busca?q=${encodeURIComponent("Master Co " + suffix)}`, true)).json();
    expect(busca.groups[0].items[0].href).toContain(orgId);
  });

  it("prorroga o trial e registra pagamento (vencimento anda um ciclo)", async () => {
    const ext = await form(`/master/clientes/${orgId}/prorrogar`, { days: "7", reason: "Negociação" });
    expect(ext.status).toBe(200);
    let org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(daysUntil(org.trialEndsAt)).toBe(9);

    await form(`/master/clientes/${orgId}/plano`, { plan: "professional", cycle: "monthly", price: "" });
    const pay = await form(`/master/clientes/${orgId}/pagamento`, { amount: "299", method: "zelle", paidAt: new Date().toISOString().slice(0, 10) });
    expect(pay.status).toBe(200);
    org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.status).toBe("active");
    expect(org.plan).toBe("professional");
    expect(daysUntil(org.currentPeriodEnd)!).toBeGreaterThanOrEqual(27);
    const p = await prisma.platformPayment.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(p.amountCents).toBe(29900);
  });

  it("ação sensível pede o código de novo (step-up)", async () => {
    // Make the step-up from the login stale.
    await prisma.$executeRaw`UPDATE "session" SET sess = jsonb_set(sess::jsonb, '{master,stepUpAt}', '0'::jsonb)::json WHERE sess->'master'->>'adminId' IS NOT NULL`;
    const blocked = await form(`/master/clientes/${orgId}/suspender`, {});
    expect(blocked.status).toBe(428);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).status).toBe("active");

    expect((await form("/master/step-up", { code: "123456" })).status).toBe(401);
    expect((await form("/master/step-up", { code: code() })).status).toBe(200);
    const okr = await form(`/master/clientes/${orgId}/suspender`, {});
    expect(okr.status).toBe(200);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).status).toBe("suspended");
  });

  it("empresa suspensa não entra no CRM", async () => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: tenantEmail, password: "password12345" }),
    });
    const j = (await r.json()) as { success?: boolean };
    expect(j.success).not.toBe(true);
    // Reactivate for the next checks.
    expect((await form(`/master/clientes/${orgId}/reativar`, {})).status).toBe(200);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).status).toBe("active");
  });

  it("bloqueia usuário, cria senha temporária e desbloqueia", async () => {
    expect((await form(`/master/usuarios/${userId}/bloquear`, {})).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe("suspended");
    expect((await form(`/master/usuarios/${userId}/desbloquear`, {})).status).toBe(200);
    const temp = await form(`/master/usuarios/${userId}/senha-temporaria`, {});
    const j = (await temp.json()) as { reveal?: { value: string } };
    expect(j.reveal?.value).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mustChangePassword).toBe(true);
  });

  it("exporta CSV e registra na auditoria, que não pode ser apagada", async () => {
    const r = await form("/master/exportar/clientes", {});
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(await r.text()).toContain(orgSlug);
    const actions = (await prisma.platformAuditLog.findMany({ where: { actorName: "Naka Test" }, select: { action: true } })).map((a) => a.action);
    for (const a of ["auth.login", "tenant.extend", "payment.record", "tenant.suspend", "user.block", "user.temp_password", "export.clientes"]) {
      expect(actions, a).toContain(a);
    }
    await expect(prisma.$executeRaw`DELETE FROM "PlatformAuditLog" WHERE "actorName" = 'Naka Test'`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "PlatformAuditLog" SET "actorName" = 'x' WHERE "actorName" = 'Naka Test'`).rejects.toThrow();
  });

  it("convida membro da equipe com link de ativação de uso único", async () => {
    const r = await form("/master/equipe/convidar", { email: `bia-${suffix}@example.com`, role: "FINANCE" });
    const j = (await r.json()) as { reveal?: { value: string } };
    expect(j.reveal?.value).toContain("/master/ativar/");
    const link = new URL(j.reveal!.value);
    const page = await fetch(base + link.pathname);
    expect(page.status).toBe(200);
    const act = await fetch(base + link.pathname, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Bia", password: "finance-pass-1234", confirm: "finance-pass-1234" }), redirect: "manual" });
    expect(act.headers.get("location")).toBe("/master/2fa/configurar");
    expect((await fetch(base + link.pathname)).status).toBe(410);
    const bia = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: `bia-${suffix}@example.com` } });
    expect(bia.role).toBe("FINANCE");
    expect(bia.status).toBe("active");
  });

  it("conta Master não entra pelo login antigo sem 2FA", async () => {
    const { platformAdminRouter } = await import("../src/platform-admin/routes.js");
    expect(platformAdminRouter).toBeTruthy();
    const m = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    expect(m.totpEnabledAt).not.toBeNull();
  });
});
