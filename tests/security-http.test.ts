import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { clearRateLimits } from "../src/lib/security/rate-limit.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

const PASSWORD = "Test-Passw0rd-2026";

describe.skipIf(!privileged)("security hardening — HTTP", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  const suffix = `sec${Date.now().toString(36)}`;
  const adminEmail = `admin-${suffix}@example.com`;
  const gmEmail = `gm-${suffix}@example.com`;
  const installerEmail = `inst-${suffix}@example.com`;
  const leakedEmail = `leaked-${suffix}@example.com`;
  let gmId = "";
  let adminId = "";
  let adminRoleId = "";

  async function login(email: string, password = PASSWORD) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, organizationId: orgId }),
    });
    const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return { status: r.status, cookie, json: (await r.json().catch(() => ({}))) as Record<string, any>, headers: r.headers };
  }

  async function call(cookie: string, method: string, path: string, body?: unknown, extra?: Record<string, string>) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json", ...(extra || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any>, headers: r.headers };
  }

  beforeAll(async () => {
    clearRateLimits();
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({
      organizationName: `Sec ${suffix}`,
      slug: `sec-${suffix}`,
      adminName: "Admin",
      adminEmail,
      password: PASSWORD,
    });
    orgId = a.organization.id;
    adminId = a.admin.id;
    const hash = await hashPassword(PASSWORD);
    const leakedHash = await hashPassword("SeniorMigrate2026!");
    await withTenantTransaction(orgId, async (tx) => {
      const roles = await tx.role.findMany();
      const byKey = new Map(roles.map((r) => [r.key, r.id]));
      adminRoleId = byKey.get("admin")!;
      const gm = await tx.user.create({
        data: { organizationId: orgId, email: gmEmail, name: "Gerente", passwordHash: hash, roleId: byKey.get("general_manager")!, status: "active" },
      });
      gmId = gm.id;
      await tx.user.create({
        data: { organizationId: orgId, email: installerEmail, name: "Instalador", passwordHash: hash, roleId: byKey.get("installer")!, status: "active" },
      });
      await tx.user.create({
        data: { organizationId: orgId, email: leakedEmail, name: "Migrado", passwordHash: leakedHash, roleId: byKey.get("office")!, status: "active", mustChangePassword: true },
      });
      await tx.customer.create({ data: { organizationId: orgId, name: "Cliente Sigiloso", email: "cliente@example.com" } });
    });
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("sends security headers", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });

  it("refuses a password that is published in the repository", async () => {
    const r = await login(leakedEmail, "SeniorMigrate2026!");
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("DEFAULT_PASSWORD_BLOCKED");
    expect(r.cookie).not.toContain("connect.sid");
  });

  it("locks an account after repeated wrong passwords", async () => {
    clearRateLimits();
    for (let i = 0; i < 8; i++) {
      const bad = await login(gmEmail, "wrong-password-xx");
      expect(bad.status).toBe(401);
    }
    const locked = await login(gmEmail, PASSWORD);
    expect(locked.status).toBe(429);
    clearRateLimits();
    expect((await login(gmEmail, PASSWORD)).status).toBe(200);
  });

  it("does not let a field installer read customers, quotes or payroll", async () => {
    clearRateLimits();
    const { cookie } = await login(installerEmail);
    expect((await call(cookie, "GET", "/api/customers")).status).toBe(403);
    expect((await call(cookie, "GET", "/api/customers/overview")).status).toBe(403);
    expect((await call(cookie, "GET", "/api/quotes")).status).toBe(403);
    expect((await call(cookie, "GET", "/api/payroll")).status).toBe(403);
    const { cookie: adminCookie } = await login(adminEmail);
    const ok = await call(adminCookie, "GET", "/api/customers");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("does not let a manager become admin or take over the admin", async () => {
    clearRateLimits();
    const { cookie } = await login(gmEmail);
    const promote = await call(cookie, "PUT", `/api/users/${gmId}`, { role_id: adminRoleId });
    expect(promote.status).toBe(403);
    const takeover = await call(cookie, "PUT", `/api/users/${adminId}`, { password: "Another-Passw0rd-1" });
    expect(takeover.status).toBe(403);
    const after = await withTenantTransaction(orgId, (tx) => tx.user.findFirst({ where: { id: gmId }, include: { role: true } }));
    expect(after?.role?.key).toBe("general_manager");
  });

  it("blocks cross-site writes but keeps same-origin ones", async () => {
    clearRateLimits();
    const { cookie } = await login(adminEmail);
    const cross = await call(cookie, "POST", "/api/customers", { name: "X" }, { Origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    const same = await call(cookie, "POST", "/api/customers", { name: "Cliente Novo" }, { Origin: base });
    expect([200, 201]).toContain(same.status);
  });

  it("gives a new session id on login and ends other sessions on password change", async () => {
    clearRateLimits();
    const first = await login(adminEmail);
    const second = await login(adminEmail);
    expect(first.cookie).not.toBe(second.cookie);
    const change = await call(second.cookie, "POST", "/api/auth/change-password", {
      current_password: PASSWORD,
      new_password: "Novo-Passw0rd-2026",
    });
    expect(change.status).toBe(200);
    // The other device is signed out, the one that changed the password stays in.
    // (401 on a company subdomain; 404 "organization required" on the apex host.)
    expect([401, 404]).toContain((await call(first.cookie, "GET", "/api/customers")).status);
    expect((await call(second.cookie, "GET", "/api/customers")).status).toBe(200);
  });

  it("hides lead details from anonymous intake callers and neutralises HTML", async () => {
    clearRateLimits();
    const body = {
      tenant: `sec-${suffix}`,
      name: "<img src=x onerror=alert(1)> Maria",
      email: `maria-${suffix}@example.com`,
      phone: "3035550100",
      zipcode: "80027",
    };
    const r = await fetch(`${base}/api/receive-lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as Record<string, unknown>;
    expect(r.status).toBe(200);
    expect(j.lead_id).toBeUndefined();
    const lead = await withTenantTransaction(orgId, (tx) => tx.lead.findFirst({ where: { email: body.email } }));
    expect(lead?.name).not.toContain("<");
  });

  it("keeps CRM scripts and screens away from visitors who are not signed in", async () => {
    clearRateLimits();
    const anon = await fetch(`${base}/folha.js`);
    expect(anon.status).toBe(401);
    expect((await fetch(`${base}/om-device.js`)).status).toBe(200);
    expect((await fetch(`${base}/login.html`)).status).toBe(200);
    const forged = await fetch(`${base}/folha.js`, { headers: { Cookie: "om_a=9999999999999.forged" } });
    expect(forged.status).toBe(401);
    const { cookie } = await login(adminEmail, "Novo-Passw0rd-2026");
    expect(cookie).toContain("om_a=");
    expect((await fetch(`${base}/folha.js`, { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it("serves a robots.txt that keeps AI crawlers and app paths out", async () => {
    const r = await fetch(`${base}/robots.txt`);
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("Disallow: /api/");
    expect((await fetch(`${base}/assets/master/master.js`)).status).toBe(401);
  });
});

