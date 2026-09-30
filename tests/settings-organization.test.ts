import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import {
  DEFAULT_BUSINESS_HOURS,
  buildSetupSteps,
  documentAddressLine,
  documentLicenseLine,
  expiryAlerts,
  organizationSettingsPatchSchema,
  parseBusinessHours,
} from "../src/lib/settings/organization.js";

describe("settings/organization — pure helpers", () => {
  it("fills missing or broken business hours with defaults", () => {
    const h = parseBusinessHours({ mon: { open: false, start: "25:00", end: "18:00" }, junk: 1 });
    expect(h.mon).toEqual({ open: false, start: "07:00", end: "18:00" });
    expect(h.sun).toEqual(DEFAULT_BUSINESS_HOURS.sun);
    expect(parseBusinessHours(null)).toEqual(DEFAULT_BUSINESS_HOURS);
  });

  it("validates and normalizes a patch", () => {
    const ok = organizationSettingsPatchSchema.safeParse({
      contact_email: "Doug@Example.com",
      website: "nakaflooring.com",
      postal_code: "80019",
      license_expires_on: "2027-03-31",
      address_line2: "",
    });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.data.contact_email).toBe("doug@example.com");
    expect(ok.data.website).toBe("https://nakaflooring.com/");
    expect(ok.data.address_line2).toBeNull();
    expect(ok.data.license_expires_on?.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("rejects bad values with per-field errors", () => {
    const bad = organizationSettingsPatchSchema.safeParse({
      contact_email: "contato@naka",
      contact_phone: "123",
      timezone: "Mars/Olympus",
      business_hours: { ...DEFAULT_BUSINESS_HOURS, mon: { open: true, start: "17:00", end: "07:00" } },
      unknown_field: "x",
    });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    const paths = bad.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["contact_email", "contact_phone", "timezone", "business_hours.mon"]),
    );
  });

  it("hides the address on documents when private", () => {
    const base = {
      addressPrivate: false,
      addressLine1: "5765 N Genoa Way",
      addressLine2: null,
      city: "Aurora",
      state: "CO",
      postalCode: "80019",
    };
    expect(documentAddressLine(base)).toBe("5765 N Genoa Way · Aurora, CO 80019");
    expect(documentAddressLine({ ...base, addressPrivate: true })).toBeNull();
    expect(documentLicenseLine({ showLicenseOnDocuments: true, licenseNumber: "123", licenseState: "CO" })).toBe(
      "License CO #123",
    );
    expect(documentLicenseLine({ showLicenseOnDocuments: false, licenseNumber: "123", licenseState: "CO" })).toBeNull();
  });

  it("flags license/insurance expiring in 30 days", () => {
    const now = new Date("2026-09-30T15:00:00Z");
    const alerts = expiryAlerts(
      { licenseExpiresOn: new Date("2026-10-20T00:00:00Z"), insuranceExpiresOn: new Date("2027-01-01T00:00:00Z") },
      now,
    );
    expect(alerts).toEqual([
      { key: "license", label: "Licença de contratante", expires_on: "2026-10-20", days_left: 20 },
    ]);
  });

  it("builds the setup checklist", () => {
    const steps = buildSetupSteps({
      hasLogo: true,
      hasContact: false,
      hasAddress: true,
      hasLicense: false,
      pricingCount: 3,
      activeUsers: 1,
      quoteCount: 0,
      viewerHasPush: false,
    });
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(["logo", "address", "pricing"]);
  });
});

/**
 * Login and session loading read `User` outside a tenant transaction, which only
 * works for a database role that bypasses RLS (as in production). Under the CI
 * `app_user` role these HTTP checks are skipped; run them locally with a
 * privileged DATABASE_URL.
 */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("settings/organization — HTTP (tenant isolation, permissions)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgA = "";
  let orgB = "";
  const suffix = Date.now().toString(36);
  const emails = { admin: `set-a-${suffix}@example.com`, sales: `set-sales-${suffix}@example.com` };

  async function login(email: string, organizationId: string): Promise<string> {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
      redirect: "manual",
    });
    const cookie = (r.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    if (!cookie.includes("=")) throw new Error(`login failed ${r.status} ${await r.text()}`);
    return cookie;
  }

  async function call(cookie: string, method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: { key: permission.key, group: permission.group, description: permission.description },
        update: {},
      });
    }
    const a = await createOrganizationWithAdmin({
      organizationName: `Settings A ${suffix}`,
      slug: `set-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: emails.admin,
      password: "password12345",
    });
    const b = await createOrganizationWithAdmin({
      organizationName: `Settings B ${suffix}`,
      slug: `set-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: `set-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgA = a.organization.id;
    orgB = b.organization.id;
    const passwordHash = await hashPassword("password12345");
    await withTenantTransaction(orgA, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: "sales" } });
      await tx.user.create({
        data: { organizationId: orgA, email: emails.sales, name: "Sales A", passwordHash, roleId: role.id },
      });
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

  it("admin reads and updates company details; other tenant is untouched", async () => {
    const cookie = await login(emails.admin, orgA);
    const get = await call(cookie, "GET", "/api/settings/organization");
    expect(get.status).toBe(200);
    expect(get.json.data.business_hours.mon.open).toBe(true);
    expect(get.json.data.default_locale).toBe("pt-BR");

    const patch = await call(cookie, "PATCH", "/api/settings/organization", {
      contact_email: "contato@nakaflooring.com",
      address_line1: "5765 North Genoa Way",
      city: "Aurora",
      state: "CO",
      postal_code: "80019",
      license_number: "CO-123",
      business_hours: { ...DEFAULT_BUSINESS_HOURS, sat: { open: true, start: "08:00", end: "12:00" } },
      timezone: "America/Denver",
    });
    expect(patch.status).toBe(200);
    expect(patch.json.changed).toEqual(
      expect.arrayContaining(["contactEmail", "addressLine1", "businessHours", "timezone"]),
    );
    expect(patch.json.data.business_hours.sat.open).toBe(true);

    const events = await withTenantTransaction(orgA, (tx) =>
      tx.activityEvent.findMany({ where: { entityType: "organization", action: "settings.updated" } }),
    );
    expect(events).toHaveLength(1);
    expect((events[0]!.changes as Record<string, unknown>).addressLine1).toBeTruthy();

    const other = await prisma.organization.findUniqueOrThrow({ where: { id: orgB } });
    expect(other.addressLine1).toBeNull();
    expect(other.timezone).not.toBe("America/Denver");

    const again = await call(cookie, "PATCH", "/api/settings/organization", { city: "Aurora" });
    expect(again.json.changed).toEqual([]);
  });

  it("returns field errors for invalid input", async () => {
    const cookie = await login(emails.admin, orgA);
    const r = await call(cookie, "PATCH", "/api/settings/organization", { contact_email: "x@y", website: "nope" });
    expect(r.status).toBe(400);
    expect(Object.keys(r.json.fields)).toEqual(expect.arrayContaining(["contact_email", "website"]));
  });

  it("users without settings.manage cannot read or change company details", async () => {
    const cookie = await login(emails.sales, orgA);
    expect((await call(cookie, "GET", "/api/settings/organization")).status).toBe(403);
    expect((await call(cookie, "PATCH", "/api/settings/organization", { city: "X" })).status).toBe(403);

    const ov = await call(cookie, "GET", "/api/settings/overview");
    expect(ov.status).toBe(200);
    const logo = ov.json.data.setup.find((s: { key: string }) => s.key === "logo");
    expect(logo.can_open).toBe(false);
    const quote = ov.json.data.setup.find((s: { key: string }) => s.key === "quote");
    expect(quote.can_open).toBe(true);
    expect(ov.json.data.alerts).toEqual([]);
  });
});
