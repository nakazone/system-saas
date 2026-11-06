import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { obraQuoteHtml, canUseObraQuote } from "../src/crm/mount.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

describe("obraQuoteHtml", () => {
  const page = `<html><head><title>Field Quote | ObraMate</title><link rel="apple-touch-icon" href="/old.png" /></head><body><script src="field-quote.js"></script></body></html>`;
  const out = obraQuoteHtml(page);

  it("dresses the Field Quote page as its own app", () => {
    expect(out).toContain("<title>ObraQuote</title>");
    expect(out).toContain('href="/obraquote.webmanifest?v=1"');
    expect(out).toContain("/assets/obraquote/apple-touch-icon.png");
    expect(out).toContain("window.__OM_QUOTE_APP=true");
    expect(out).not.toContain("/old.png");
  });

  it("sets the app flag before the page scripts run", () => {
    expect(out.indexOf("__OM_QUOTE_APP")).toBeLessThan(out.indexOf("field-quote.js"));
  });
});

describe("canUseObraQuote", () => {
  it("follows the Field Quote rule", () => {
    expect(canUseObraQuote({ roleKey: "admin", permissions: [] })).toBe(true);
    expect(canUseObraQuote({ roleKey: "sales", permissions: ["quotes.create"] })).toBe(true);
    expect(canUseObraQuote({ roleKey: "custom", permissions: ["leads.edit"] })).toBe(true);
    expect(canUseObraQuote({ roleKey: "installer", permissions: ["visits.view"] })).toBe(false);
    expect(canUseObraQuote(null)).toBe(false);
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("GET /obraquote", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let adminCookie = "";
  let salesCookie = "";
  let installerCookie = "";
  let orgIdForFlags = "";
  const suffix = `oqt${Date.now().toString(36)}`;

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
    const a = await createOrganizationWithAdmin({ organizationName: `Quote ${suffix}`, slug: `quote-${suffix}`, adminName: "Admin", adminEmail, password: "password12345" });
    const orgId = a.organization.id;
    orgIdForFlags = orgId;
    for (const key of ["sales", "installer"]) {
      const role = await prisma.role.findFirst({ where: { organizationId: orgId, key } });
      await prisma.user.create({ data: { organizationId: orgId, email: `${key}-${suffix}@example.com`, name: key, passwordHash: await hashPassword("password12345"), roleId: role!.id, status: "active" } });
    }
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    adminCookie = await login(adminEmail, orgId);
    salesCookie = await login(`sales-${suffix}@example.com`, orgId);
    installerCookie = await login(`installer-${suffix}@example.com`, orgId);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("sends a visitor without a session to the app's login", async () => {
    const r = await fetch(`${base}/obraquote`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/login.html?app=obraquote");
  });

  it("opens the app for an admin and for sales", async () => {
    for (const cookie of [adminCookie, salesCookie]) {
      const r = await fetch(`${base}/obraquote`, { headers: { Cookie: cookie } });
      const html = await r.text();
      expect(r.status).toBe(200);
      expect(html).toContain("window.__OM_QUOTE_APP=true");
      expect(html).toContain("field-quote.js");
    }
  });

  it("explains to roles without quotes that the app is not for them", async () => {
    const r = await fetch(`${base}/obraquote`, { headers: { Cookie: installerCookie } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("O ObraQuote é o app do Field Quote");
    expect(html).not.toContain("field-quote.js");
  });

  it("says so when the company turned Field Quote off", async () => {
    await prisma.organization.update({ where: { id: orgIdForFlags }, data: { featureFlags: { field_quote: false } } });
    try {
      const r = await fetch(`${base}/obraquote`, { headers: { Cookie: adminCookie } });
      const html = await r.text();
      expect(html).toContain("O Field Quote está desligado na sua empresa");
      expect(html).not.toContain("field-quote.js");
    } finally {
      await prisma.organization.update({ where: { id: orgIdForFlags }, data: { featureFlags: {} } });
    }
  });

  it("serves the manifest", async () => {
    const r = await fetch(`${base}/obraquote.webmanifest`);
    const m = (await r.json()) as { name: string; scope: string };
    expect(m.name).toBe("ObraQuote");
    expect(m.scope).toBe("/obraquote");
  });
});
