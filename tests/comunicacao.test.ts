import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { encryptSecret, generateTotpSecret, totpAt } from "../src/lib/auth/totp.js";
import { resetThrottle } from "../src/master/auth.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { email as emailProvider, LoggedEmailProvider, ConsoleEmailProvider, type EmailMessage } from "../src/lib/email/index.js";
import {
  TEMPLATES,
  render,
  missingRequired,
  unknownVars,
  sendPlatformEmail,
  setLocaleMode,
  clearTemplateCache,
  templateDef,
} from "../src/lib/email/templates.js";
import { applyResendEvent, cleanupEmailLog, verifySvix } from "../src/lib/email/delivery.js";
import { announcementsForApp, dismissAnnouncement, reaches } from "../src/lib/announcements/index.js";

const prisma = new PrismaClient();
const suffix = `cm${Date.now().toString(36)}`;

/** The Master area reads every tenant — needs a privileged DB role (like production). */
const privileged = await prisma
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false);

afterAll(async () => {
  await setLocaleMode("en");
  await prisma.$disconnect();
});

describe("Modelos de e-mail — texto", () => {
  const def = templateDef("trial_ending")!;

  it("todo modelo tem inglês e português sem variável desconhecida e com o obrigatório", () => {
    for (const t of TEMPLATES) {
      for (const l of ["en", "pt"] as const) {
        const d = t.defaults[l];
        expect(unknownVars(t, d.subject, d.body), `${t.key}/${l}`).toEqual([]);
        expect(missingRequired(t, d), `${t.key}/${l}`).toEqual([]);
      }
    }
  });

  it("troca variáveis por idioma, escapa HTML, põe o botão no lugar e a nota em cinza", () => {
    const out = render(
      def.defaults.pt,
      { name: "Ana", company: "<Pisos & Cia>", date: { en: "Oct 20, 2026", pt: "20 de out. de 2026" }, ends_in: { en: "tomorrow", pt: "amanhã" }, link: "https://x.test/p?a=1&b=2" },
      "pt",
    );
    expect(out.subject).toBe("Seu teste do ObraMate acaba amanhã");
    expect(out.text).toContain("O teste grátis da <Pisos & Cia> acaba em 20 de out. de 2026");
    expect(out.text).toContain("Assinar: https://x.test/p?a=1&b=2");
    expect(out.html).toContain("&lt;Pisos &amp; Cia&gt;");
    expect(out.html).not.toContain("<Pisos");
    expect(out.html).toContain('href="https://x.test/p?a=1&amp;b=2"');
    expect(out.html).toMatch(/font-size:13px[^>]*>Depois do teste/);
  });

  it("acusa variável inventada e link faltando", () => {
    expect(unknownVars(def, "Oi {{nome}}", "{{company}} {{button}}")).toEqual(["nome"]);
    expect(missingRequired(def, { subject: "x", body: "Sem link nenhum", button: "Assinar" })).toEqual(["link"]);
    expect(missingRequired(def, { subject: "x", body: "Abra {{link}}" })).toEqual([]);
    expect(missingRequired(def, { subject: "x", body: "A\n\n{{button}}", button: "Assinar" })).toEqual([]);
  });
});

describe("Envio: registro, bloqueio e idioma", () => {
  let orgId = "";
  const owner = `owner-${suffix}@example.com`;

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `Comms Co ${suffix}`, slug: `comms-${suffix}`, adminName: "Ana Lima", adminEmail: owner, password: "Test-Passw0rd-2026" });
    orgId = a.organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { defaultLocale: "pt-BR" } });
  });

  it("todo e-mail fica no registro; endereço bloqueado não recebe", async () => {
    const blocked = `blocked-${suffix}@example.com`;
    const ok = `ok-${suffix}@example.com`;
    await prisma.emailSuppression.create({ data: { email: blocked, reason: "bounce" } });
    const p = new LoggedEmailProvider(new ConsoleEmailProvider());
    const r1 = await p.send({ to: blocked, subject: `Bloqueado ${suffix}`, text: "x", meta: { category: "company", organizationId: orgId } });
    expect(r1.skipped).toBe(true);
    const r2 = await p.send({ to: [ok, blocked], subject: `Parcial ${suffix}`, text: "x", meta: { category: "company", organizationId: orgId } });
    expect(r2.skipped).toBeFalsy();
    expect(r2.blocked).toEqual([blocked]);
    const rows = await prisma.platformEmailLog.findMany({ where: { subject: { contains: suffix } }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.status, r.toEmail])).toEqual([
      ["blocked", blocked],
      ["console", ok],
    ]);
    expect(rows[0].organizationId).toBe(orgId);
  });

  it("usa o texto editado pelo Master e o idioma da empresa quando escolhido", async () => {
    await prisma.platformEmailTemplate.upsert({
      where: { key_locale: { key: "trial_extended", locale: "pt" } },
      create: { key: "trial_extended", locale: "pt", subject: "Ganhou mais dias, {{name}}!", body: "Oi {{name}}, a {{company}} vai até {{date}}.", updatedByName: "Teste" },
      update: { subject: "Ganhou mais dias, {{name}}!", body: "Oi {{name}}, a {{company}} vai até {{date}}." },
    });
    clearTemplateCache();
    const sent: EmailMessage[] = [];
    const real = emailProvider.send.bind(emailProvider);
    emailProvider.send = async (m) => { sent.push(m); return real(m); };
    try {
      await setLocaleMode("en");
      await sendPlatformEmail("trial_extended", { to: owner, organizationId: orgId, vars: { name: "Ana", company: "Comms Co", date: { en: "Nov 1, 2026", pt: "1 de nov. de 2026" } } });
      await setLocaleMode("company");
      await sendPlatformEmail("trial_extended", { to: owner, organizationId: orgId, vars: { name: "Ana", company: "Comms Co", date: { en: "Nov 1, 2026", pt: "1 de nov. de 2026" } } });
    } finally {
      emailProvider.send = real;
      await setLocaleMode("en");
      await prisma.platformEmailTemplate.deleteMany({ where: { key: "trial_extended" } });
      clearTemplateCache();
    }
    expect(sent[0].subject).toBe("Your ObraMate trial was extended");
    expect(sent[1].subject).toBe("Ganhou mais dias, Ana!");
    expect(sent[1].text).toContain("a Comms Co vai até 1 de nov. de 2026");
    expect(sent[1].meta).toMatchObject({ category: "platform", template: "trial_extended", organizationId: orgId });
  });
});

describe("Retorno de entrega (webhook do Resend)", () => {
  let server: Server;
  let base = "";
  const secret = `whsec_${Buffer.from(`resend-secret-${suffix}`).toString("base64")}`;

  beforeAll(async () => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    server?.close();
  });

  function sign(body: string, id = `msg_${crypto.randomUUID()}`, ts = Math.floor(Date.now() / 1000)) {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
  }
  async function post(ev: unknown, tamper = false) {
    const body = JSON.stringify(ev);
    const h = sign(body);
    return fetch(`${base}/webhooks/resend`, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: tamper ? body.replace("}", ',"x":1}') : body });
  }

  it("confere a assinatura", () => {
    const body = '{"a":1}';
    const h = sign(body);
    expect(verifySvix(secret, { id: h["svix-id"], timestamp: h["svix-timestamp"], signature: h["svix-signature"] }, body)).toBe(true);
    expect(verifySvix(secret, { id: h["svix-id"], timestamp: h["svix-timestamp"], signature: h["svix-signature"] }, '{"a":2}')).toBe(false);
    const old = sign(body, "m1", Math.floor(Date.now() / 1000) - 3600);
    expect(verifySvix(secret, { id: old["svix-id"], timestamp: old["svix-timestamp"], signature: old["svix-signature"] }, body)).toBe(false);
  });

  it("atualiza a situação sem voltar atrás e bloqueia quem deu bounce", async () => {
    const pid = `re_${suffix}`;
    const to = `bounce-${suffix}@example.com`;
    const row = await prisma.platformEmailLog.create({ data: { category: "platform", toEmail: to, subject: "x", provider: "resend", providerId: pid, status: "sent" } });
    expect((await post({ type: "email.opened", created_at: new Date().toISOString(), data: { email_id: pid, to: [to] } })).status).toBe(200);
    expect((await post({ type: "email.delivered", data: { email_id: pid, to: [to] } })).status).toBe(200);
    let r = await prisma.platformEmailLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(r.status).toBe("opened");
    expect(r.openedAt).not.toBeNull();
    expect((await post({ type: "email.bounced", data: { email_id: pid, to: [to], bounce: { type: "Permanent", message: "Mailbox does not exist" } } }, true)).status).toBe(400);
    expect((await post({ type: "email.bounced", data: { email_id: pid, to: [to], bounce: { type: "Permanent", message: "Mailbox does not exist" } } })).status).toBe(200);
    r = await prisma.platformEmailLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(r.status).toBe("bounced");
    expect(r.error).toBe("Mailbox does not exist");
    expect(await prisma.emailSuppression.findUnique({ where: { email: to } })).toMatchObject({ reason: "bounce" });
    // A soft bounce doesn't block.
    await applyResendEvent({ type: "email.bounced", data: { email_id: "re_none", to: [`soft-${suffix}@example.com`], bounce: { type: "Transient" } } });
    expect(await prisma.emailSuppression.findUnique({ where: { email: `soft-${suffix}@example.com` } })).toBeNull();
  });

  it("apaga registros com mais de 90 dias", async () => {
    const old = await prisma.platformEmailLog.create({ data: { category: "platform", toEmail: `old-${suffix}@example.com`, subject: "old", provider: "console", status: "console", createdAt: new Date(Date.now() - 91 * 86400e3) } });
    const fresh = await prisma.platformEmailLog.create({ data: { category: "platform", toEmail: `new-${suffix}@example.com`, subject: "new", provider: "console", status: "console" } });
    await cleanupEmailLog();
    expect(await prisma.platformEmailLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.platformEmailLog.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});

describe("Avisos no app", () => {
  let orgA = "";
  let orgB = "";
  let userA = "";
  let userB = "";
  const ids: string[] = [];

  beforeAll(async () => {
    const a = await createOrganizationWithAdmin({ organizationName: `Aviso A ${suffix}`, slug: `aviso-a-${suffix}`, adminName: "A A", adminEmail: `a-${suffix}@example.com`, password: "Test-Passw0rd-2026", plan: "professional" });
    const b = await createOrganizationWithAdmin({ organizationName: `Aviso B ${suffix}`, slug: `aviso-b-${suffix}`, adminName: "B B", adminEmail: `b-${suffix}@example.com`, password: "Test-Passw0rd-2026", plan: "starter" });
    orgA = a.organization.id;
    orgB = b.organization.id;
    userA = a.admin.id;
    userB = b.admin.id;
  });
  afterAll(async () => {
    await prisma.platformAnnouncement.deleteMany({ where: { id: { in: ids } } });
  });

  const mk = async (data: Record<string, unknown>) => {
    const r = await prisma.platformAnnouncement.create({ data: { title: `T ${suffix}`, body: "", createdByName: "Teste", ...data } as never });
    ids.push(r.id);
    return r;
  };

  it("público por plano e por empresa", () => {
    const org = { id: orgA, plan: "professional" };
    expect(reaches({ audience: "all", plans: [], organizationIds: [] }, org)).toBe(true);
    expect(reaches({ audience: "plans", plans: ["starter"], organizationIds: [] }, org)).toBe(false);
    expect(reaches({ audience: "plans", plans: ["professional"], organizationIds: [] }, org)).toBe(true);
    expect(reaches({ audience: "companies", plans: [], organizationIds: [orgB] }, org)).toBe(false);
  });

  it("mostra só o que está no ar para a empresa, urgente primeiro; fechar vale por usuário; urgente não fecha", async () => {
    const info = await mk({ kind: "info", audience: "companies", organizationIds: [orgA], title: `Info ${suffix}` });
    const urgent = await mk({ kind: "urgent", audience: "companies", organizationIds: [orgA], title: `Urg ${suffix}` });
    await mk({ kind: "info", audience: "companies", organizationIds: [orgB], title: `Outra ${suffix}` });
    await mk({ kind: "info", audience: "companies", organizationIds: [orgA], startsAt: new Date(Date.now() + 3600e3), title: `Futuro ${suffix}` });
    await mk({ kind: "info", audience: "companies", organizationIds: [orgA], endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 7200e3), title: `Passado ${suffix}` });
    await mk({ kind: "info", audience: "companies", organizationIds: [orgA], endedAt: new Date(), title: `Tirado ${suffix}` });

    const org = { id: orgA, plan: "professional", status: "trial" };
    const list = (await announcementsForApp(org, userA)).filter((x) => x.title.includes(suffix));
    expect(list.map((x) => x.title)).toEqual([`Urg ${suffix}`, `Info ${suffix}`]);
    expect(list[0].dismissible).toBe(false);
    expect(await prisma.platformAnnouncementReceipt.count({ where: { userId: userA, announcementId: { in: [info.id, urgent.id] } } })).toBe(2);

    expect(await dismissAnnouncement(urgent.id, userA, orgA)).toBe("urgent");
    expect(await dismissAnnouncement(info.id, userA, orgA)).toBe("ok");
    const after = (await announcementsForApp(org, userA)).filter((x) => x.title.includes(suffix));
    expect(after.map((x) => x.title)).toEqual([`Urg ${suffix}`]);
    // Suspended companies never see notices.
    expect(await announcementsForApp({ ...org, status: "suspended" }, userA)).toEqual([]);
  });

  it("modo suporte não conta como visto", async () => {
    const a = await mk({ kind: "maintenance", audience: "companies", organizationIds: [orgB], title: `Sup ${suffix}` });
    await announcementsForApp({ id: orgB, plan: "starter", status: "trial" }, userB, { track: false });
    expect(await prisma.platformAnnouncementReceipt.count({ where: { announcementId: a.id } })).toBe(0);
  });
});

describe.skipIf(!privileged)("Master › Comunicação", () => {
  let server: Server;
  let base = "";
  let cookie = "";
  const secret = generateTotpSecret();
  const masterEmail = `master-${suffix}@example.com`;
  const cookieOf = (r: Response) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  async function form(path: string, body: Record<string, string | string[]>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
    const r = await fetch(base + path, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-Requested-With": "fetch" }, body: params });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    resetThrottle();
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({
      data: { email: masterEmail, name: "Naka Comms", role: "MASTER", status: "active", passwordHash: await hashPassword("master-password-123"), totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!), totpEnabledAt: new Date(), recoveryCodeHashes: [] },
    });
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r1 = await fetch(`${base}/master/entrar`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: masterEmail, password: "master-password-123" }), redirect: "manual" });
    cookie = cookieOf(r1);
    const r2 = await fetch(`${base}/master/2fa`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: totpAt(secret, Date.now()) }), redirect: "manual" });
    cookie = cookieOf(r2) || cookie;
  });
  afterAll(() => server?.close());

  it("as quatro abas e o editor abrem", async () => {
    for (const p of ["/master/comunicacao", "/master/comunicacao?aba=modelos", "/master/comunicacao?aba=envios&status=problema", "/master/comunicacao?aba=remetente", "/master/comunicacao/modelos/password_reset?lang=pt"]) {
      const r = await fetch(base + p, { headers: { Cookie: cookie } });
      expect(r.status, p).toBe(200);
    }
  });

  it("aviso: valida, publica, edita e tira do ar (com auditoria)", async () => {
    expect((await form("/master/comunicacao/avisos", { kind: "info", title: "Oi", audience: "all" })).status).toBe(400);
    expect((await form("/master/comunicacao/avisos", { kind: "info", title: `Aviso ${suffix}`, audience: "plans" })).json.message).toMatch(/plano/);
    expect((await form("/master/comunicacao/avisos", { kind: "info", title: `Aviso ${suffix}`, audience: "all", linkUrl: "javascript:alert(1)" })).status).toBe(400);
    // Urgent to everyone asks for the 2FA code again (once the login's own confirmation is old).
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    await prisma.$executeRaw`UPDATE "session" SET sess = jsonb_set(sess::jsonb, '{master,stepUpAt}', '0')::json WHERE sess->'master'->>'adminId' = ${admin.id}`;
    expect((await form("/master/comunicacao/avisos", { kind: "urgent", title: `Aviso ${suffix}`, audience: "all" })).status).toBe(428);
    const ok = await form("/master/comunicacao/avisos", { kind: "maintenance", title: `Aviso ${suffix}`, body: "Parada curta", audience: "plans", plans: ["professional", "starter"], linkUrl: "/configuracoes.html" });
    expect(ok.status).toBe(200);
    const a = await prisma.platformAnnouncement.findFirstOrThrow({ where: { title: `Aviso ${suffix}` } });
    expect(a).toMatchObject({ kind: "maintenance", plans: ["professional", "starter"], linkLabel: "Saiba mais", createdByName: "Naka Comms" });
    expect((await form(`/master/comunicacao/avisos/${a.id}`, { kind: "info", title: `Aviso ${suffix} v2`, audience: "all" })).status).toBe(200);
    expect((await form(`/master/comunicacao/avisos/${a.id}/encerrar`, {})).status).toBe(200);
    const b = await prisma.platformAnnouncement.findUniqueOrThrow({ where: { id: a.id } });
    expect(b.title).toBe(`Aviso ${suffix} v2`);
    expect(b.endedAt).not.toBeNull();
    expect((await form(`/master/comunicacao/avisos/${a.id}`, { kind: "info", title: "x y z", audience: "all" })).status).toBe(400);
    const log = await prisma.platformAuditLog.findMany({ where: { targetId: a.id }, select: { action: true } });
    expect(log.map((l) => l.action).sort()).toEqual(["comms.announcement_create", "comms.announcement_end", "comms.announcement_update"]);
    await prisma.platformAnnouncement.delete({ where: { id: a.id } });
  });

  it("modelo: prévia acusa erro, salvar recusa sem link, salva, testa e restaura", async () => {
    const prev = await form("/master/comunicacao/modelos/password_reset/previa", { lang: "pt", subject: "Nova senha", body: "Oi {{nome}}" });
    expect(prev.json.problem).toMatch(/\{\{nome\}\}/);
    expect((await form("/master/comunicacao/modelos/password_reset", { lang: "pt", subject: "Nova senha", body: "Oi {{name}}, sem link aqui." })).status).toBe(400);
    const save = await form("/master/comunicacao/modelos/password_reset", { lang: "pt", subject: "Nova senha da {{company}}", body: "Oi {{name}},\n\n{{button}}", button: "Criar senha" });
    expect(save.status).toBe(200);
    expect(await prisma.platformEmailTemplate.findUnique({ where: { key_locale: { key: "password_reset", locale: "pt" } } })).toMatchObject({ subject: "Nova senha da {{company}}", updatedByName: "Naka Comms" });
    const test = await form("/master/comunicacao/modelos/password_reset/teste", { lang: "pt", subject: "Nova senha da {{company}}", body: "Oi {{name}},\n\n{{button}}", button: "Criar senha" });
    expect(test.status).toBe(200);
    expect(await prisma.platformEmailLog.findFirst({ where: { toEmail: masterEmail, subject: "[Teste] Nova senha da Summit Floors LLC" } })).not.toBeNull();
    // Saving exactly the default text removes the edit.
    const d = templateDef("password_reset")!.defaults.pt;
    expect((await form("/master/comunicacao/modelos/password_reset", { lang: "pt", subject: d.subject, body: d.body, button: d.button! })).json.message).toMatch(/padrão/);
    expect(await prisma.platformEmailTemplate.findUnique({ where: { key_locale: { key: "password_reset", locale: "pt" } } })).toBeNull();
    clearTemplateCache();
  });

  it("bloquear e liberar endereço", async () => {
    const em = `manual-${suffix}@example.com`;
    expect((await form("/master/comunicacao/bloqueados", { email: em, note: "pediu para sair" })).status).toBe(200);
    expect(await prisma.emailSuppression.findUnique({ where: { email: em } })).toMatchObject({ reason: "manual", createdByName: "Naka Comms" });
    expect((await form("/master/comunicacao/bloqueados/liberar", { email: em })).status).toBe(200);
    expect(await prisma.emailSuppression.findUnique({ where: { email: em } })).toBeNull();
  });
});
