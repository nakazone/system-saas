import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { obraCalendarHtml } from "../src/crm/mount.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

describe("obraCalendarHtml", () => {
  const page = `<html><head><meta name="theme-color" content="#f7f4ee" /><title>Agenda | ObraMate</title><link rel="apple-touch-icon" href="/old.png" /></head><body></body></html>`;
  const out = obraCalendarHtml(page);

  it("dresses the Calendar page as its own app", () => {
    expect(out).toContain("<title>ObraCalendar</title>");
    expect(out).toContain('href="/obracalendar.webmanifest?v=1"');
    expect(out).toContain("/assets/obracalendar/apple-touch-icon.png");
    expect(out).toContain("window.__OM_CAL_APP=true");
    expect(out).toContain("/obracalendar.js");
    expect(out).not.toContain("/old.png");
  });

  it("sets the app flag before the page scripts run", () => {
    expect(out.indexOf("__OM_CAL_APP")).toBeLessThan(out.indexOf("/obracalendar.js"));
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("GET /obracalendar", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let adminCookie = "";
  let salesCookie = "";
  const suffix = `oc${Date.now().toString(36)}`;

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
    const a = await createOrganizationWithAdmin({ organizationName: `Cal ${suffix}`, slug: `cal-${suffix}`, adminName: "Admin", adminEmail, password: "password12345" });
    const orgId = a.organization.id;
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
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("opens the app for an admin", async () => {
    const r = await fetch(`${base}/obracalendar`, { headers: { Cookie: adminCookie } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("window.__OM_CAL_APP=true");
    expect(html).toContain('id="agStage"');
  });

  it("explains to other roles that the app is for admins", async () => {
    const r = await fetch(`${base}/obracalendar`, { headers: { Cookie: salesCookie } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("é para administradores");
    expect(html).not.toContain("agStage");
  });

  it("serves the manifest", async () => {
    const r = await fetch(`${base}/obracalendar.webmanifest`);
    const m = (await r.json()) as { name: string; scope: string };
    expect(m.name).toBe("ObraCalendar");
    expect(m.scope).toBe("/obracalendar");
  });
});
