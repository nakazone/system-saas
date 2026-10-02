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
  computeNextQuoteNumber,
  formatQuoteNumber,
  parseDateInput,
  parseQuoteSettings,
  quoteSettingsPatchSchema,
} from "../src/lib/settings/quotes.js";

describe("settings/quotes — pure helpers", () => {
  it("numbers move forward and respect the configured minimum", () => {
    expect(computeNextQuoteNumber(null, null)).toBe(1001);
    expect(computeNextQuoteNumber(1042, null)).toBe(1043);
    expect(computeNextQuoteNumber(1042, 2000)).toBe(2000);
    expect(computeNextQuoteNumber(2500, 2000)).toBe(2501);
    expect(formatQuoteNumber("NF-", 7)).toBe("NF-7");
  });

  it("fills client view and signature defaults", () => {
    const s = parseQuoteSettings({ client_view: { showUnitPrices: false } });
    expect(s.client_view).toEqual({ showQuantities: true, showUnitPrices: false, showLineTotals: true, showRoomBreakdown: true });
    expect(s.owner_signature.use_auto).toBe(true);
    expect(s.owner_signature.image_url).toBeNull();
    expect(s.share_messages.sms_body).toMatch(/Hi \[name\]/);
    expect(s.share_messages.followup_body).toMatch(/review the quote/i);
  });

  it("keeps custom share message templates", () => {
    const s = parseQuoteSettings({
      share_messages: { sms_body: "Hello [name] — [link]", followup_body: "Ping [name]" },
    });
    expect(s.share_messages).toEqual({ sms_body: "Hello [name] — [link]", followup_body: "Ping [name]" });
    expect(quoteSettingsPatchSchema.safeParse({ share_messages: { sms_body: "", followup_body: "x" } }).success).toBe(false);
    expect(
      quoteSettingsPatchSchema.safeParse({
        share_messages: { sms_body: "Hi [name]", followup_body: "Follow up [link]" },
      }).success,
    ).toBe(true);
  });

  it("parses builder dates and validates patches", () => {
    expect(parseDateInput("2026-10-30")?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput(undefined)).toBeUndefined();
    expect(quoteSettingsPatchSchema.safeParse({ number_prefix: "Q -" }).success).toBe(false);
    expect(quoteSettingsPatchSchema.safeParse({ validity_days: 0 }).success).toBe(false);
    expect(quoteSettingsPatchSchema.safeParse({ tax_rate: 8.25, number_prefix: "NF-" }).success).toBe(true);
  });
});

/** See settings-organization.test.ts: HTTP login needs a DB role that bypasses RLS. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("settings/quotes — HTTP", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgA = "";
  let orgB = "";
  const suffix = Date.now().toString(36);
  const emails = { admin: `sq-a-${suffix}@example.com`, sales: `sq-sales-${suffix}@example.com` };

  async function login(email: string, organizationId: string) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
    });
    const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie.includes("=")) throw new Error(`login failed ${r.status}`);
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
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: p.key },
        create: { key: p.key, group: p.group, description: p.description },
        update: {},
      });
    }
    const a = await createOrganizationWithAdmin({
      organizationName: `Quotes A ${suffix}`,
      slug: `sq-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: emails.admin,
      password: "password12345",
    });
    const b = await createOrganizationWithAdmin({
      organizationName: `Quotes B ${suffix}`,
      slug: `sq-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: `sq-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgA = a.organization.id;
    orgB = b.organization.id;
    const passwordHash = await hashPassword("password12345");
    await withTenantTransaction(orgA, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: "sales" } });
      await tx.user.create({ data: { organizationId: orgA, email: emails.sales, name: "Sales", passwordHash, roleId: role.id } });
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

  it("new CRM quotes use prefix, next number, validity, terms and client view", async () => {
    const cookie = await login(emails.admin, orgA);
    const patch = await call(cookie, "PATCH", "/api/settings/quotes", {
      number_prefix: "NF-",
      next_number: 5000,
      validity_days: 15,
      tax_rate: 8.25,
      terms: "50% na aprovação.",
      client_view: { showQuantities: true, showUnitPrices: false, showLineTotals: true, showRoomBreakdown: false },
    });
    expect(patch.status).toBe(200);
    expect(patch.json.data.next_label).toBe("NF-5000");

    const created = await call(cookie, "POST", "/api/quotes/full", {
      title: "Sala",
      items: [{ description: "LVP", quantity: 100, unit_price: 3 }],
    });
    expect(created.status).toBe(201);
    const q = await withTenantTransaction(orgA, (tx) => tx.quote.findFirstOrThrow({ where: { id: created.json.data.id } }));
    expect(q.number).toBe(5000);
    expect(q.quoteNumber).toBe("NF-5000");
    expect(q.terms).toBe("50% na aprovação.");
    expect(q.clientView).toMatchObject({ showUnitPrices: false, showRoomBreakdown: false });
    const days = Math.round((q.validUntil!.getTime() - q.createdAt.getTime()) / 86_400_000);
    expect(days).toBe(15);

    // The builder sends terms_conditions / expiration_date — they must persist.
    const upd = await call(cookie, "PUT", `/api/quotes/${q.id}/full`, {
      terms_conditions: "Novos termos",
      expiration_date: "2026-12-31",
    });
    expect(upd.status).toBe(200);
    expect(upd.json.data.terms_conditions).toBe("Novos termos");
    expect(String(upd.json.data.expiration_date).slice(0, 10)).toBe("2026-12-31");

    // Next number can't go backwards.
    const back = await call(cookie, "PATCH", "/api/settings/quotes", { next_number: 4000 });
    expect(back.status).toBe(400);
    expect(back.json.fields.next_number).toContain("NF-5000");

    // Other tenant unaffected.
    const other = await prisma.organization.findUniqueOrThrow({ where: { id: orgB } });
    expect(other.quoteNumberPrefix).toBe("Q-");
  });

  it("owner signature round-trips and is restricted to settings.manage", async () => {
    const admin = await login(emails.admin, orgA);
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const put = await call(admin, "PUT", "/api/quotes/settings/owner-signature", {
      name: "Doug Nakazone",
      title: "Owner",
      use_auto_signature: false,
      signature_png: png,
    });
    expect(put.status).toBe(200);
    expect(put.json.data.has_signature).toBe(true);

    const sales = await login(emails.sales, orgA);
    const get = await call(sales, "GET", "/api/quotes/settings/owner-signature");
    expect(get.status).toBe(200);
    expect(get.json.data).toMatchObject({ name: "Doug Nakazone", title: "Owner", use_auto_signature: false });
    expect((await call(sales, "PUT", "/api/quotes/settings/owner-signature", { name: "X Y", title: "Z Z" })).status).toBe(403);
    expect((await call(sales, "PATCH", "/api/settings/quotes", { validity_days: 5 })).status).toBe(403);
    const defaults = await call(sales, "GET", "/api/quotes/settings/defaults");
    expect(defaults.status).toBe(200);
    expect(defaults.json.data.validity_days).toBe(15);
  });

  it("estimate rules update and log activity", async () => {
    const cookie = await login(emails.admin, orgA);
    const get = await call(cookie, "GET", "/api/settings/estimate-rules");
    expect(get.json.data).toHaveLength(5);
    const rules = get.json.data.map((r: Record<string, any>) => ({
      flooring_type: r.flooring_type,
      waste_percent: r.flooring_type === "lvp" ? 12 : r.waste_percent,
      material_markup: r.material_markup,
      labor_markup: r.labor_markup,
      default_price_per_sqft: r.default_price_per_sqft,
      default_labor_per_sqft: r.default_labor_per_sqft,
    }));
    const put = await call(cookie, "PUT", "/api/settings/estimate-rules", { rules });
    expect(put.status).toBe(200);
    expect(put.json.data.find((r: { flooring_type: string }) => r.flooring_type === "lvp").waste_percent).toBe(12);
    const bad = await call(cookie, "PUT", "/api/settings/estimate-rules", {
      rules: [{ ...rules[0], waste_percent: -1 }],
    });
    expect(bad.status).toBe(400);
    const events = await withTenantTransaction(orgA, (tx) =>
      tx.activityEvent.findMany({ where: { action: "settings.estimate_rules_updated" } }),
    );
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!.changes as object)).toEqual(["lvp"]);
  });
});
