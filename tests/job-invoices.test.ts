import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { jobBilling, jobInvoiceLines } from "../src/lib/invoices/job.js";
import { computeNewInvoiceAmount } from "../src/lib/invoices/core.js";

describe("jobs — billing math (pure)", () => {
  it("derives the billing status of a job", () => {
    expect(jobBilling(0, []).billing_status).toBe("no_value");
    expect(jobBilling(1000, []).billing_status).toBe("to_invoice");
    const part = jobBilling(1000, [{ amount: 300, status: "sent", receipts: [{ amount: 300 }] }]);
    expect(part).toMatchObject({ billing_status: "partially_invoiced", remaining_to_invoice: 700, paid_total: 300 });
    const waiting = jobBilling(1000, [{ amount: 1000, status: "sent", receipts: [{ amount: 400 }] }]);
    expect(waiting).toMatchObject({ billing_status: "awaiting_payment", open_balance: 600 });
    const paid = jobBilling(1000, [
      { amount: 1000, status: "paid", receipts: [{ amount: 1000 }] },
      { amount: 500, status: "void", receipts: [] },
    ]);
    expect(paid).toMatchObject({ billing_status: "paid", invoiced_total: 1000, invoice_count: 1 });
  });

  it("itemizes full/final invoices from the job lines and nets out earlier invoices", () => {
    const job = {
      number: 7,
      title: "Smith townhomes",
      lineItems: [
        { serviceName: "LVP install", quantitySqft: 800, unitPrice: 2.1, lineTotal: 1680, notes: "Hallway only" },
        { serviceName: "Stairs", quantitySqft: 12, unitPrice: 45, lineTotal: 540 },
      ],
    };
    const full = jobInvoiceLines({ kind: "full", label: "Full payment", amount: 2220, job, invoicedBefore: 0 });
    expect(full.map((l) => l.description)).toEqual(["LVP install — Hallway only", "Stairs"]);
    const final = jobInvoiceLines({ kind: "final", label: "Final balance", amount: 1554, job, invoicedBefore: 666 });
    expect(final.at(-1)).toMatchObject({ description: "Less: previously invoiced", amount: -666 });
    expect(final.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(1554, 2);
    const dep = jobInvoiceLines({ kind: "deposit", label: "Deposit (30%)", amount: 666, job, invoicedBefore: 0 });
    expect(dep).toEqual([{ description: "Deposit (30%) — Job #7 · Smith townhomes", quantity: 1, unitPrice: 666, amount: 666 }]);
  });

  it("speaks about the job, not a quote, in amount errors", () => {
    const r = computeNewInvoiceAmount({ kind: "full", quoteTotal: 0, invoicedTotal: 0, source: "job" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/job/);
  });
});

/** Login reads `User` outside a tenant transaction — needs a privileged DB role (see invoices-module test). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("jobs — ordem de serviço → fatura (HTTP)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgA = "";
  let orgB = "";
  let builderId = "";
  let crewLeadId = "";
  let lvpId = "";
  let stairsId = "";
  const suffix = `jobinv${Date.now().toString(36)}`;
  const emails = { admin: `ji-a-${suffix}@example.com`, lead: `ji-l-${suffix}@example.com`, b: `ji-b-${suffix}@example.com` };

  async function login(email: string, organizationId: string): Promise<string> {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
      redirect: "manual",
    });
    const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie.includes("=")) throw new Error(`login failed ${r.status} ${await r.text()}`);
    return cookie;
  }

  async function call(cookie: string, method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = r.headers.get("content-type") || "";
    return { status: r.status, type, json: (type.includes("json") ? await r.json() : {}) as Record<string, any> };
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
      organizationName: `Job Inv A ${suffix}`,
      slug: `ji-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: emails.admin,
      password: "password12345",
    });
    const b = await createOrganizationWithAdmin({
      organizationName: `Job Inv B ${suffix}`,
      slug: `ji-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: emails.b,
      password: "password12345",
    });
    orgA = a.organization.id;
    orgB = b.organization.id;
    const passwordHash = await hashPassword("password12345");
    await withTenantTransaction(orgA, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: "crew_lead" } });
      crewLeadId = (
        await tx.user.create({ data: { organizationId: orgA, email: emails.lead, name: "Lead", passwordHash, roleId: role.id } })
      ).id;
      builderId = (
        await tx.builder.create({
          data: { organizationId: orgA, firstName: "Mark", company: "Summit Homes", email: `summit-${suffix}@example.com` },
        })
      ).id;
      lvpId = (
        await tx.pricingItem.create({
          data: { organizationId: orgA, name: "LVP install", unit: "sq_ft", priceBuilder: 2.1, priceParticular: 3.5 },
        })
      ).id;
      stairsId = (
        await tx.pricingItem.create({
          data: { organizationId: orgA, name: "Stairs", unit: "step", priceBuilder: 45, priceParticular: 60 },
        })
      ).id;
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

  it("accepts every origin the job form offers (Particular and Loja were rejected)", async () => {
    const admin = await login(emails.admin, orgA);
    for (const source_type of ["particular", "loja", "builder", "contractor"]) {
      const r = await call(admin, "POST", "/api/work-orders", { title: `Origem ${source_type}`, source_type });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.data.source_type).toBe(source_type);
    }
  });

  it("bills a builder job from its table prices: deposit, final, PDF, payment, filters", async () => {
    const admin = await login(emails.admin, orgA);
    const created = await call(admin, "POST", "/api/work-orders", {
      title: "Summit — Lot 14",
      source_type: "builder",
      builder_id: builderId,
      assigned_user_id: crewLeadId,
      address: "14 Summit Way, Louisville CO",
      line_items: [
        { pricing_item_id: lvpId, service_name: "LVP install", quantity_sqft: 800, unit_price: 2.1 },
        { pricing_item_id: stairsId, service_name: "Stairs", quantity_sqft: 12, unit_price: 45 },
      ],
    });
    expect(created.status).toBe(201);
    const job = created.json.data;
    expect(job.services_total).toBe(2220);
    expect(job.billing).toMatchObject({ billing_status: "to_invoice", remaining_to_invoice: 2220 });

    // Nothing to bill without a client, and never more than the job is worth.
    const empty = await call(admin, "POST", "/api/work-orders", { title: "Sem cliente", line_items: [{ service_name: "X", quantity_sqft: 1, unit_price: 10 }] });
    expect((await call(admin, "POST", `/api/work-orders/${empty.json.data.id}/invoices`, {})).status).toBe(422);
    const over = await call(admin, "POST", `/api/work-orders/${job.id}/invoices`, { invoice_type: "custom", custom_amount: 5000 });
    expect(over.status).toBe(422);

    const dep = await call(admin, "POST", `/api/work-orders/${job.id}/invoices`, { invoice_type: "deposit", deposit_pct: 30 });
    expect(dep.status, JSON.stringify(dep.json)).toBe(201);
    expect(dep.json.data.amount).toBe(666);
    expect(dep.json.billing).toMatchObject({ billing_status: "partially_invoiced", remaining_to_invoice: 1554 });

    // The services can't be cut below what was already billed, and the job can't be canceled.
    const cut = await call(admin, "PUT", `/api/work-orders/${job.id}`, {
      line_items: [{ service_name: "LVP install", quantity_sqft: 100, unit_price: 2.1 }],
    });
    expect(cut.status).toBe(409);
    expect((await call(admin, "DELETE", `/api/work-orders/${job.id}`)).status).toBe(409);

    const fin = await call(admin, "POST", `/api/work-orders/${job.id}/invoices`, { invoice_type: "final" });
    expect(fin.status).toBe(201);
    expect(fin.json.data.amount).toBe(1554);
    expect(fin.json.billing.remaining_to_invoice).toBe(0);

    const detail = await call(admin, "GET", `/api/quote-invoices/${fin.json.data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.data.quote).toBeNull();
    expect(detail.json.data.job).toMatchObject({ id: job.id, total: 2220, invoiced_total: 2220, remaining_to_invoice: 0 });
    expect(detail.json.data.client).toMatchObject({ name: "Summit Homes", address: "14 Summit Way, Louisville CO" });
    expect(detail.json.data.line_items.map((l: { description: string }) => l.description)).toEqual([
      "LVP install",
      "Stairs",
      "Less: previously invoiced",
    ]);
    expect(detail.json.data.sibling_invoices).toHaveLength(1);
    // Itemized job invoice: the amount is edited through the job, not on the invoice.
    expect((await call(admin, "PATCH", `/api/quote-invoices/${fin.json.data.id}`, { amount: 1000 })).status).toBe(409);

    const pdf = await call(admin, "GET", `/api/quote-invoices/${fin.json.data.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toContain("pdf");

    const pay = await call(admin, "POST", `/api/quote-invoices/${dep.json.data.id}/receipts`, { mode: "full", method: "check" });
    expect(pay.status, JSON.stringify(pay.json)).toBeLessThan(300);

    const list = await call(admin, "GET", `/api/work-orders/${job.id}/invoices`);
    expect(list.json.data).toHaveLength(2);
    expect(list.json.billing).toMatchObject({
      billing_status: "awaiting_payment",
      invoiced_total: 2220,
      paid_total: 666,
      open_balance: 1554,
    });

    const invoices = await call(admin, "GET", `/api/invoices?work_order_id=${job.id}`);
    expect(invoices.json.data).toHaveLength(2);
    expect(invoices.json.data[0].source_ref).toMatch(/^Job #\d+$/);

    // "Concluídos a faturar": completed jobs with value left to bill.
    const other = await call(admin, "POST", "/api/work-orders", {
      title: "Summit — Lot 15",
      builder_id: builderId,
      source_type: "builder",
      status: "completed",
      line_items: [{ pricing_item_id: lvpId, service_name: "LVP install", quantity_sqft: 500, unit_price: 2.1 }],
    });
    const toInvoice = await call(admin, "GET", "/api/work-orders?billing=to_invoice");
    const ids = toInvoice.json.data.map((w: { id: string }) => w.id);
    expect(ids).toContain(other.json.data.id);
    expect(ids).not.toContain(job.id);
    const billable = await call(admin, "GET", "/api/invoices/billable-jobs");
    expect(billable.json.data[0]).toMatchObject({ id: other.json.data.id, remaining_to_invoice: 1050 });

    // Field crew sees the job but not the money position; another tenant sees nothing.
    const lead = await login(emails.lead, orgA);
    const leadView = await call(lead, "GET", `/api/work-orders/${job.id}`);
    expect(leadView.status).toBe(200);
    expect(leadView.json.data.billing).toBeNull();
    expect((await call(lead, "POST", `/api/work-orders/${job.id}/invoices`, {})).status).toBe(403);
    const b = await login(emails.b, orgB);
    expect((await call(b, "GET", `/api/work-orders/${job.id}/invoices`)).status).toBe(404);
    expect((await call(b, "POST", `/api/work-orders/${job.id}/invoices`, { invoice_type: "final" })).status).toBe(404);
  });
});
