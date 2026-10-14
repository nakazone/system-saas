import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { createSupportSession, endSupportSession, isHiddenInSupport } from "../src/lib/support/session.js";
import { email as emailProvider, type EmailMessage } from "../src/lib/email/index.js";

/** Login and the CRM read `User` outside a tenant transaction — needs a privileged DB role (as in production). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe("Modo suporte — o que fica escondido", () => {
  it("folha e funcionários escondidos; o resto não", () => {
    for (const p of ["/api/folha/semana", "/api/folha", "/api/payroll", "/api/finance/payroll/abatements", "/api/campo/folha/diaria", "/folha.html", "/payroll-module.html", "/funcionario.html"]) {
      expect(isHiddenInSupport(p), p).toBe(true);
    }
    for (const p of ["/api/leads", "/api/invoices", "/api/folhas-de-estilo", "/dashboard", "/finance.html", "/api/finance/cashflow"]) {
      expect(isHiddenInSupport(p), p).toBe(false);
    }
  });
});

describe.skipIf(!privileged)("Entrar como suporte", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `sp${Date.now().toString(36)}`;
  const sent: EmailMessage[] = [];
  let orgId = "";
  let adminId = "";
  let adminEmail = "";
  let staffId = "";
  const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Naka Suporte" };

  function cookieOf(r: Response) {
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  function merge(a: string, b: string) {
    const m = new Map<string, string>();
    for (const part of [a, b].join("; ").split("; ").filter(Boolean)) m.set(part.split("=")[0], part);
    return [...m.values()].join("; ");
  }
  async function req(method: string, path: string, cookie = "", body?: unknown) {
    const r = await fetch(base + path, {
      method,
      headers: { Cookie: cookie, Accept: "application/json", "X-Requested-With": "fetch", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any>, cookie: merge(cookie, cookieOf(r)), location: r.headers.get("location") };
  }
  /** Opens the support link like the new tab does; returns the tab's cookie. */
  async function enter(url: string, cookie = "") {
    const u = new URL(url);
    const r = await fetch(base + u.pathname + u.search, { headers: { Cookie: cookie }, redirect: "manual" });
    return { status: r.status, cookie: merge(cookie, cookieOf(r)), html: await r.text() };
  }

  beforeAll(async () => {
    vi.spyOn(emailProvider, "send").mockImplementation(async (m) => {
      sent.push(m);
      return { ok: true, transport: "console" };
    });
    adminEmail = `owner-${suffix}@example.com`;
    const a = await createOrganizationWithAdmin({ organizationName: `Suporte ${suffix}`, slug: `sup-${suffix}`, adminName: "Olivia Owner", adminEmail, password: "password12345" });
    orgId = a.organization.id;
    adminId = a.admin.id;
    const staffRole = await prisma.role.findFirst({ where: { organizationId: orgId, key: { not: "admin" } }, select: { id: true } });
    const staff = await prisma.user.create({
      data: { organizationId: orgId, email: `staff-${suffix}@example.com`, name: "Sam Staff", passwordHash: a.admin.passwordHash, roleId: staffRole!.id, status: "active" },
    });
    staffId = staff.id;
    const app = createApp();
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    server?.close();
    await prisma.$disconnect();
  });

  it("link de uso único abre o CRM como o admin, só leitura, folha escondida, e avisa a empresa", async () => {
    const s = await createSupportSession({ admin, organizationId: orgId, reason: "Conferir fatura sumida", minutes: 30 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.userName).toBe("Olivia Owner");
    expect(s.url).toContain(`/suporte/entrar?token=`);

    const tab = await enter(s.url);
    expect(tab.status).toBe(303);
    expect(sent.some((m) => m.to === adminEmail && /support accessed your workspace/.test(m.subject) && m.text.includes("Conferir fatura sumida"))).toBe(true);

    const st = await req("GET", "/api/account/status", tab.cookie);
    expect(st.status).toBe(200);
    expect(st.json.data.support).toMatchObject({ admin: "Naka Suporte", user: "Olivia Owner", minutes_left: 30 });
    expect(st.json.data.can_manage_billing).toBe(false);
    expect(st.json.data.legal).toBeNull();

    expect((await req("GET", "/api/leads", tab.cookie)).status).toBe(200);
    const write = await req("POST", "/api/leads", tab.cookie, { name: "Should Fail", phone: "3035550100" });
    expect(write.status).toBe(403);
    expect(write.json.error).toBe("SUPPORT_READ_ONLY");
    const folha = await req("GET", "/api/folha/semana", tab.cookie);
    expect(folha.status).toBe(403);
    expect(folha.json.error).toBe("SUPPORT_HIDDEN");

    // Second use of the same link is refused.
    expect((await enter(s.url)).status).toBe(410);

    const row = await prisma.supportSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.startedAt).toBeTruthy();
    expect(row.views).toBeGreaterThan(0);
    expect(row.blocked).toBeGreaterThanOrEqual(2);

    // The Master ends it: the tab is out on its next request.
    expect(await endSupportSession(s.id, "master")).toBe(true);
    const after = await req("GET", "/api/leads", tab.cookie);
    expect(after.status).toBe(401);
    expect(after.json.error).toBe("SUPPORT_ENDED");
    expect((await req("GET", "/api/account/status", after.cookie)).status).not.toBe(200);
  });

  it("ver como outro usuário e, ao sair, volta a sessão que o navegador já tinha", async () => {
    const login = await req("POST", "/api/auth/login", "", { email: adminEmail, password: "password12345", organizationId: orgId });
    expect(login.status).toBe(200);
    const own = login.cookie;

    const s = await createSupportSession({ admin, organizationId: orgId, userId: staffId, reason: "Ver o que o Sam vê", minutes: 60 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const tab = await enter(s.url, own);
    expect(tab.status).toBe(303);
    const who = await req("GET", "/api/auth/session", tab.cookie);
    expect(JSON.stringify(who.json)).toContain("Sam Staff");

    const exit = await req("POST", "/api/support-session/exit", tab.cookie, {});
    expect(exit.status).toBe(200);
    expect(exit.json.restored).toBe(true);
    const back = await req("GET", "/api/auth/session", exit.cookie);
    expect(JSON.stringify(back.json)).toContain("Olivia Owner");
    expect((await req("POST", "/api/leads", exit.cookie, { name: "Owner Lead", phone: "3035550199" })).status).not.toBe(403);
    expect((await prisma.supportSession.findUniqueOrThrow({ where: { id: s.id } })).endedBy).toBe("user");
  });

  it("link vencido, empresa suspensa e usuário bloqueado são recusados", async () => {
    const s = await createSupportSession({ admin, organizationId: orgId, reason: "Link que vence", minutes: 30 });
    if (!s.ok) throw new Error(s.message);
    await prisma.supportSession.update({ where: { id: s.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    expect((await enter(s.url)).status).toBe(410);

    await prisma.user.update({ where: { id: staffId }, data: { status: "suspended" } });
    const blocked = await createSupportSession({ admin, organizationId: orgId, userId: staffId, reason: "Usuário bloqueado", minutes: 30 });
    expect(blocked.ok).toBe(false);

    await prisma.organization.update({ where: { id: orgId }, data: { status: "suspended" } });
    const susp = await createSupportSession({ admin, organizationId: orgId, reason: "Empresa suspensa", minutes: 30 });
    expect(susp.ok).toBe(false);
    await prisma.organization.update({ where: { id: orgId }, data: { status: "trial" } });
    void adminId;
  });
});
