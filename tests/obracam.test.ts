import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { obraCamHtml } from "../src/crm/mount.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

describe("obraCamHtml", () => {
  const page = `<html><head><meta name="theme-color" content="#f7f4ee" /><title>ObraCam | ObraMate</title><link rel="apple-touch-icon" href="/old.png" /></head><body></body></html>`;
  const out = obraCamHtml(page);

  it("dresses the ObraCam page as its own app", () => {
    expect(out).toContain("<title>ObraCam</title>");
    expect(out).toContain('href="/obracam.webmanifest?v=1"');
    expect(out).toContain("/assets/obracam/apple-touch-icon.png");
    expect(out).toContain("window.__OM_FOCUS_APP=true");
    expect(out).toContain("/obracam-app.js");
    expect(out).not.toContain("/old.png");
  });

  it("sets the app flag before the page scripts run", () => {
    expect(out.indexOf("__OM_FOCUS_APP")).toBeLessThan(out.indexOf("/obracam-app.js"));
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("GET /obracam", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let adminCookie = "";
  let salesCookie = "";
  let managerCookie = "";
  let officeCookie = "";
  const suffix = `ocm${Date.now().toString(36)}`;

  async function login(email: string, organizationId: string) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
      redirect: "manual",
    });
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const adminEmail = `admin-${suffix}@example.com`;
    const a = await createOrganizationWithAdmin({ organizationName: `Cam ${suffix}`, slug: `cam-${suffix}`, adminName: "Admin", adminEmail, password: "password12345" });
    const orgId = a.organization.id;
    for (const key of ["general_manager", "office"]) {
      const role = await prisma.role.findFirst({ where: { organizationId: orgId, key } });
      await prisma.user.create({ data: { organizationId: orgId, email: `${key}-${suffix}@example.com`, name: key, passwordHash: await hashPassword("password12345"), roleId: role!.id, status: "active" } });
    }
    const salesRole = await prisma.role.findFirst({ where: { organizationId: orgId, key: "sales" } });
    const salesEmail = `sales-${suffix}@example.com`;
    await prisma.user.create({ data: { organizationId: orgId, email: salesEmail, name: "Sales", passwordHash: await hashPassword("password12345"), roleId: salesRole!.id, status: "active" } });
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    adminCookie = await login(adminEmail, orgId);
    salesCookie = await login(salesEmail, orgId);
    managerCookie = await login(`general_manager-${suffix}@example.com`, orgId);
    officeCookie = await login(`office-${suffix}@example.com`, orgId);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("opens the app for an admin", async () => {
    const r = await fetch(`${base}/obracam`, { headers: { Cookie: adminCookie } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("window.__OM_FOCUS_APP=true");
    expect(html).toContain('id="camRows"');
  });

  it("opens the app for a general manager and for the office", async () => {
    for (const cookie of [managerCookie, officeCookie]) {
      const r = await fetch(`${base}/obracam`, { headers: { Cookie: cookie } });
      expect(await r.text()).toContain("window.__OM_FOCUS_APP=true");
    }
  });

  it("explains to other roles that the app is for admins", async () => {
    const r = await fetch(`${base}/obracam`, { headers: { Cookie: salesCookie } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("é para administradores, gerentes e escritório");
    expect(html).not.toContain("camRows");
  });

  it("serves the manifest", async () => {
    const r = await fetch(`${base}/obracam.webmanifest`);
    const m = (await r.json()) as { name: string; scope: string };
    expect(m.name).toBe("ObraCam");
    expect(m.scope).toBe("/obracam");
  });
});
