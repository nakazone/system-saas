import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { runWithTenant } from "../src/lib/tenant/prisma-tenant.js";
import {
  applyFeaturePermissions,
  checkLimit,
  getEntitlements,
  hiddenPages,
  invalidateEntitlements,
  monthStart,
  resolveEntitlements,
  takeAiUse,
} from "../src/lib/features/index.js";

/** Login and the CRM read `User` outside a tenant transaction — needs a privileged DB role (as in production). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe("Recursos por plano — regra de decisão", () => {
  const plan = (features: Record<string, boolean> = {}, limits: Record<string, unknown> = {}) => ({ key: "p", features, limits });

  it("padrão: tudo liberado e sem limite (nada muda no deploy)", () => {
    const e = resolveEntitlements({ plan: null, planKey: "starter", globals: {}, overrides: [] });
    expect(Object.values(e.features).every((f) => f.on)).toBe(true);
    expect(e.limits).toEqual({ users: null, photos_month: null, ai_month: null });
  });

  it("plano tira módulo; exceção devolve; desligado global vence exceção; beta só com exceção; exceção vencida some", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const p = plan({ chat: false, payroll: true }, { users: 5, photos_month: "x", ai_month: -1 });
    let e = resolveEntitlements({ plan: p, planKey: "p", globals: {}, overrides: [], now });
    expect(e.features.chat).toMatchObject({ on: false, source: "plan" });
    expect(e.limits).toEqual({ users: 5, photos_month: null, ai_month: null });

    e = resolveEntitlements({ plan: p, planKey: "p", globals: {}, overrides: [{ featureKey: "chat", enabled: true, endsAt: null }], now });
    expect(e.features.chat).toMatchObject({ on: true, source: "override" });

    e = resolveEntitlements({ plan: p, planKey: "p", globals: { chat: "off" }, overrides: [{ featureKey: "chat", enabled: true, endsAt: null }], now });
    expect(e.features.chat).toMatchObject({ on: false, source: "global_off" });

    e = resolveEntitlements({ plan: p, planKey: "p", globals: { payroll: "beta" }, overrides: [], now });
    expect(e.features.payroll).toMatchObject({ on: false, source: "beta" });
    e = resolveEntitlements({ plan: p, planKey: "p", globals: { payroll: "beta" }, overrides: [{ featureKey: "payroll", enabled: true, endsAt: new Date("2026-12-01") }], now });
    expect(e.features.payroll.on).toBe(true);

    e = resolveEntitlements({ plan: p, planKey: "p", globals: {}, overrides: [{ featureKey: "chat", enabled: true, endsAt: new Date("2026-11-01") }], now });
    expect(e.features.chat).toMatchObject({ on: false, source: "plan" });
  });

  it("mês começa à meia-noite de Denver (horário de verão e de inverno)", () => {
    expect(monthStart(new Date("2026-10-14T04:00:00Z"))).toEqual({ start: new Date("2026-10-01T06:00:00Z"), period: "2026-10" });
    expect(monthStart(new Date("2026-12-01T05:30:00Z")).period).toBe("2026-11");
    expect(monthStart(new Date("2026-12-15T12:00:00Z")).start).toEqual(new Date("2026-12-01T07:00:00Z"));
  });
});

describe("Recursos por plano — limites e IA", () => {
  const prisma = new PrismaClient();
  const suffix = `pf${Date.now().toString(36)}`;
  const planKey = `test_${suffix}`;
  let orgId = "";

  beforeAll(async () => {
    await prisma.plan.create({ data: { key: planKey, name: "Plano de teste", monthlyCents: 100, annualCents: 1000, visible: false, features: { chat: false, payroll: false }, limits: { users: 1, ai_month: 2, photos_month: 0 } } });
    const a = await createOrganizationWithAdmin({ organizationName: `Recursos ${suffix}`, slug: `rec-${suffix}`, adminName: "Pat Admin", adminEmail: `pat-${suffix}@example.com`, password: "password12345" });
    orgId = a.organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { plan: planKey } });
    invalidateEntitlements(orgId);
  });

  afterAll(async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { plan: "starter" } }).catch(() => undefined);
    await prisma.plan.delete({ where: { key: planKey } }).catch(() => undefined);
    invalidateEntitlements();
    await prisma.$disconnect();
  });

  it("tira as permissões e esconde as páginas dos módulos fora do plano", async () => {
    const perms = await applyFeaturePermissions(orgId, ["leads.view", "chat.use", "chat.create_group", "payroll.view", "finance.view", "reports.view"]);
    expect(perms).toEqual(["leads.view", "finance.view", "reports.view"]);
    expect((await hiddenPages(orgId)).sort()).toEqual(["chat.html", "folha.html", "payroll-module.html"]);
  });

  it("limite de usuários e de fotos", async () => {
    const users = await checkLimit(orgId, "users", 1);
    expect(users.ok).toBe(false);
    if (!users.ok) expect(users.message).toContain("até 1 usuários");
    expect((await checkLimit(orgId, "photos_month", 1)).ok).toBe(false);
  });

  it("IA: conta por mês e para no limite; fora do plano bloqueia", async () => {
    const run = () => runWithTenant(orgId, () => takeAiUse());
    expect(await run()).toBeNull();
    expect(await run()).toBeNull();
    expect(await run()).toMatch(/2 usos de IA por mês/);
    const { period } = monthStart();
    expect((await prisma.usageCounter.findUnique({ where: { organizationId_metric_period: { organizationId: orgId, metric: "ai_month", period } } }))?.count).toBe(2);

    await prisma.plan.update({ where: { key: planKey }, data: { features: { chat: false, payroll: false, ai: false } } });
    invalidateEntitlements(orgId);
    expect(await run()).toMatch(/não está incluída/);
    // Outside a company request (scripts, jobs) nothing is blocked.
    expect(await takeAiUse()).toBeNull();
  });
});

describe.skipIf(!privileged)("Recursos por plano — no CRM", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `pc${Date.now().toString(36)}`;
  const planKey = `test_${suffix}`;
  let orgId = "";
  const email = `crm-${suffix}@example.com`;

  async function req(method: string, path: string, cookie = "", body?: unknown) {
    const r = await fetch(base + path, {
      method,
      headers: { Cookie: cookie, Accept: "application/json", "X-Requested-With": "fetch", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const set = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any>, cookie: set || cookie };
  }

  beforeAll(async () => {
    await prisma.plan.create({ data: { key: planKey, name: "Plano CRM", monthlyCents: 100, annualCents: 1000, visible: false, features: { chat: false }, limits: { users: 1 } } });
    const a = await createOrganizationWithAdmin({ organizationName: `CRM ${suffix}`, slug: `crm-${suffix}`, adminName: "Chris Admin", adminEmail: email, password: "password12345" });
    orgId = a.organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { plan: planKey } });
    invalidateEntitlements(orgId);
    const app = createApp();
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await prisma.orgFeatureOverride.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.update({ where: { id: orgId }, data: { plan: "starter" } }).catch(() => undefined);
    await prisma.plan.delete({ where: { key: planKey } }).catch(() => undefined);
    invalidateEntitlements();
    await prisma.$disconnect();
  });

  it("módulo fora do plano: API e página 403, permissões e links somem; exceção devolve", async () => {
    const li = await req("POST", "/api/auth/login", "", { email, password: "password12345", organizationId: orgId });
    expect(li.status).toBe(200);
    const c = li.cookie;
    const chat = await req("GET", "/api/chat/conversations", c);
    expect(chat.status).toBe(403);
    expect(chat.json).toMatchObject({ error: "FEATURE_OFF", feature: "chat" });
    const page = await fetch(`${base}/chat.html`, { headers: { Cookie: c } });
    expect(page.status).toBe(403);
    expect(await page.text()).toContain("ObraChat não está no seu plano");
    const sess = await req("GET", "/api/auth/session", c);
    expect(sess.json.user.permissions).not.toContain("chat.use");
    const st = await req("GET", "/api/account/status", c);
    expect(st.json.data.hidden_pages).toContain("chat.html");

    await prisma.orgFeatureOverride.create({ data: { organizationId: orgId, featureKey: "chat", enabled: true, reason: "teste" } });
    invalidateEntitlements(orgId);
    expect((await req("GET", "/api/chat/conversations", c)).status).not.toBe(403);
    expect((await req("GET", "/api/account/status", c)).json.data.hidden_pages).toEqual([]);
  });

  it("limite de usuários bloqueia só o cadastro de usuário, com mensagem clara", async () => {
    const li = await req("POST", "/api/auth/login", "", { email, password: "password12345", organizationId: orgId });
    const r = await req("POST", "/api/users", li.cookie, { name: "Second Person", email: `second-${suffix}@example.com`, password: "password12345" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("LIMIT_REACHED");
    expect(r.json.error).toContain("até 1 usuários");
    expect((await req("GET", "/api/leads", li.cookie)).status).toBe(200);
    const sum = await req("GET", "/api/billing/summary", li.cookie);
    expect(sum.json.data.usage).toEqual([{ key: "users", name: "Usuários", used: 1, limit: 1, pct: 100 }]);
    expect(sum.json.data.not_included).toEqual([]);
    void getEntitlements;
  });
});
