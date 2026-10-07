import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { recordInvoicePayment } from "../src/lib/payments/engine.js";
import {
  computeInvoiceMoney,
  computeNewInvoiceAmount,
  resolvePaymentAmount,
  storedStatusAfterPayments,
} from "../src/lib/invoices/core.js";
import {
  ensureInvoicePublicToken,
  invoiceDetailInclude,
  invoicePdfInput,
  receiptPdfInput,
  removeInvoicePayment,
} from "../src/lib/invoices/service.js";
import { buildInvoicePdf, buildReceiptPdf } from "../src/lib/invoices/pdf.js";

const NOW = new Date("2026-10-01T15:00:00Z");

describe("invoices — money and status (pure)", () => {
  const base = { status: "sent", amount: 1000, dueDate: "2026-10-15", receipts: [] as { amount: number }[] };

  it("derives display status from payments, due date and views", () => {
    expect(computeInvoiceMoney({ ...base, status: "draft" }, NOW).displayStatus).toBe("draft");
    expect(computeInvoiceMoney(base, NOW).displayStatus).toBe("sent");
    expect(computeInvoiceMoney({ ...base, viewedAt: NOW }, NOW).displayStatus).toBe("viewed");
    const partial = computeInvoiceMoney({ ...base, receipts: [{ amount: 250 }] }, NOW);
    expect(partial).toMatchObject({ displayStatus: "partially_paid", paid: 250, balance: 750, percentPaid: 25 });
    const paid = computeInvoiceMoney({ ...base, receipts: [{ amount: 400 }, { amount: 600 }] }, NOW);
    expect(paid).toMatchObject({ displayStatus: "paid", balance: 0, percentPaid: 100 });
    expect(computeInvoiceMoney({ ...base, status: "void" }, NOW).displayStatus).toBe("void");
  });

  it("marks open invoices past due as overdue, never drafts or paid ones", () => {
    const late = computeInvoiceMoney({ ...base, dueDate: "2026-09-25", receipts: [{ amount: 100 }] }, NOW);
    expect(late).toMatchObject({ displayStatus: "overdue", isOverdue: true, daysOverdue: 6, balance: 900 });
    expect(computeInvoiceMoney({ ...base, dueDate: "2026-10-01" }, NOW).isOverdue).toBe(false);
    expect(computeInvoiceMoney({ ...base, status: "draft", dueDate: "2026-09-01" }, NOW).isOverdue).toBe(false);
    expect(
      computeInvoiceMoney({ ...base, dueDate: "2026-09-01", receipts: [{ amount: 1000 }] }, NOW).displayStatus,
    ).toBe("paid");
  });

  it("stored status follows payments and goes back when a payment is removed", () => {
    expect(storedStatusAfterPayments({ currentStatus: "sent", amount: 100, paidTotal: 100 })).toBe("paid");
    expect(storedStatusAfterPayments({ currentStatus: "draft", amount: 100, paidTotal: 30 })).toBe("partially_paid");
    expect(storedStatusAfterPayments({ currentStatus: "paid", amount: 100, paidTotal: 0 })).toBe("sent");
    expect(storedStatusAfterPayments({ currentStatus: "draft", amount: 100, paidTotal: 0 })).toBe("draft");
    expect(storedStatusAfterPayments({ currentStatus: "void", amount: 100, paidTotal: 100 })).toBe("void");
  });

  it("computes new invoice amounts from the quote without over-billing", () => {
    expect(computeNewInvoiceAmount({ kind: "deposit", quoteTotal: 12345.67, invoicedTotal: 0, depositPct: 30 })).toMatchObject({
      ok: true,
      amount: 3703.7,
      kind: "deposit",
    });
    expect(computeNewInvoiceAmount({ kind: "final", quoteTotal: 1000, invoicedTotal: 300 })).toMatchObject({ ok: true, amount: 700 });
    expect(computeNewInvoiceAmount({ kind: "full", quoteTotal: 1000, invoicedTotal: 0 })).toMatchObject({ ok: true, amount: 1000 });
    expect(computeNewInvoiceAmount({ kind: "full", quoteTotal: 1000, invoicedTotal: 300 }).ok).toBe(false);
    expect(computeNewInvoiceAmount({ kind: "progress", quoteTotal: 1000, invoicedTotal: 300, customAmount: 800 }).ok).toBe(false);
    expect(computeNewInvoiceAmount({ kind: "deposit", quoteTotal: 1000, invoicedTotal: 0, depositPct: 0 }).ok).toBe(false);
    expect(computeNewInvoiceAmount({ kind: "final", quoteTotal: 1000, invoicedTotal: 1000 }).ok).toBe(false);
    expect(computeNewInvoiceAmount({ kind: "weird", quoteTotal: 1000, invoicedTotal: 0 }).ok).toBe(false);
  });

  it("resolves full and partial payment amounts", () => {
    expect(resolvePaymentAmount({ mode: "full", balance: 432.1 })).toEqual({ ok: true, amount: 432.1, settles: true });
    expect(resolvePaymentAmount({ mode: "partial", amount: 100, balance: 432.1 })).toEqual({ ok: true, amount: 100, settles: false });
    expect(resolvePaymentAmount({ amount: 432.1, balance: 432.1 })).toEqual({ ok: true, amount: 432.1, settles: true });
    expect(resolvePaymentAmount({ amount: 500, balance: 432.1 }).ok).toBe(false);
    expect(resolvePaymentAmount({ amount: 0, balance: 432.1 }).ok).toBe(false);
    expect(resolvePaymentAmount({ mode: "full", balance: 0 }).ok).toBe(false);
  });
});

describe("invoices — payments, receipts and documents (tenant DB)", () => {
  const prisma = new PrismaClient();
  const suffix = `inv${Date.now().toString(36)}`;
  let orgId = "";
  let invoiceId = "";

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: p.key },
        create: { key: p.key, group: p.group, description: p.description },
        update: {},
      });
    }
    const { organization } = await createOrganizationWithAdmin({
      organizationName: `Invoices ${suffix}`,
      slug: `inv-${suffix}`,
      adminName: "Admin",
      adminEmail: `inv-admin-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = organization.id;
    invoiceId = await withTenantTransaction(orgId, async (tx) => {
      const customer = await tx.customer.create({
        data: { organizationId: orgId, name: "Ana Client", email: `ana-${suffix}@example.com` },
      });
      const quote = await tx.quote.create({
        data: { organizationId: orgId, number: 7, title: "Oak refinish", customerId: customer.id, status: "approved", total: 1000, subtotal: 1000 },
      });
      const inv = await tx.quoteInvoice.create({
        data: { organizationId: orgId, quoteId: quote.id, customerId: customer.id, invoiceNumber: "INV-0001", status: "sent", amount: 1000 },
      });
      await tx.invoiceLineItem.create({
        data: { organizationId: orgId, invoiceId: inv.id, description: "Deposit (100%)", quantity: 1, unitPrice: 1000, amount: 1000, sortOrder: 1 },
      });
      return inv.id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("numbers receipts, moves partial → paid, and reverts when a payment is removed", async () => {
    const [r1, r2] = await withTenantTransaction(orgId, async (tx) => {
      const a = await recordInvoicePayment(tx, { organizationId: orgId, invoiceId, amount: 400, method: "check" });
      const s1 = await tx.quoteInvoice.findFirstOrThrow({ where: { id: invoiceId } });
      expect(s1.status).toBe("partially_paid");
      const b = await recordInvoicePayment(tx, { organizationId: orgId, invoiceId, amount: 600, method: "zelle" });
      return [a, b];
    });
    expect(r1.receiptNumber).toBe("RCT-0001");
    expect(r2.receiptNumber).toBe("RCT-0002");

    const paid = await withTenantTransaction(orgId, (tx) => tx.quoteInvoice.findFirstOrThrow({ where: { id: invoiceId } }));
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();

    await withTenantTransaction(orgId, (tx) =>
      expect(recordInvoicePayment(tx, { organizationId: orgId, invoiceId, amount: 1 })).rejects.toThrow(),
    );

    const after = await withTenantTransaction(orgId, async (tx) => {
      await removeInvoicePayment(tx, { organizationId: orgId, invoiceId, receiptId: r2.id, actorId: null });
      return tx.quoteInvoice.findFirstOrThrow({ where: { id: invoiceId }, include: { receipts: true } });
    });
    expect(after.status).toBe("partially_paid");
    expect(after.paidAt).toBeNull();
    expect(after.receipts).toHaveLength(1);

    const events = await withTenantTransaction(orgId, (tx) =>
      tx.activityEvent.findMany({ where: { entityType: "invoice", entityId: invoiceId }, orderBy: { createdAt: "asc" } }),
    );
    expect(events.map((e) => e.action)).toEqual(["payment_recorded", "payment_recorded", "payment_removed"]);
  });

  it("keeps the same public link across re-sends", async () => {
    const [a, b] = await withTenantTransaction(orgId, async (tx) => [
      await ensureInvoicePublicToken(tx, orgId, invoiceId),
      await ensureInvoicePublicToken(tx, orgId, invoiceId),
    ]);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("renders invoice and receipt PDFs", async () => {
    const inv = await withTenantTransaction(orgId, (tx) =>
      tx.quoteInvoice.findFirstOrThrow({ where: { id: invoiceId }, include: invoiceDetailInclude }),
    );
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const input = invoicePdfInput(inv, org, "https://example.com/public/invoices/x");
    expect(input).toMatchObject({
      displayStatus: "partially_paid",
      paid: 400,
      balance: 600,
      thisInvoiceAmount: 1000,
      remainingOnContract: expect.any(Number),
    });
    expect(input.contractTotal).toBeGreaterThan(0);
    const pdf = await buildInvoicePdf(input);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(800);

    const rin = receiptPdfInput(inv, inv.receipts[0]!.id, org);
    expect(rin).toMatchObject({ receiptNumber: "RCT-0001", amount: 400, paidToDate: 400, balance: 600 });
    const rpdf = await buildReceiptPdf(rin!);
    expect(rpdf.subarray(0, 4).toString()).toBe("%PDF");
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

describe.skipIf(!privileged)("invoices — HTTP flow (issue → pay → receipt → PAID)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgA = "";
  let orgB = "";
  let quoteId = "";
  let draftQuoteId = "";
  const suffix = `invh${Date.now().toString(36)}`;
  const emails = { admin: `ih-a-${suffix}@example.com`, sales: `ih-s-${suffix}@example.com`, b: `ih-b-${suffix}@example.com` };

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
    return {
      status: r.status,
      type,
      json: (type.includes("json") ? await r.json() : {}) as Record<string, any>,
      text: type.includes("json") ? "" : type.includes("pdf") ? "%PDF" : await r.text(),
    };
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
      organizationName: `Inv HTTP A ${suffix}`,
      slug: `ih-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: emails.admin,
      password: "password12345",
    });
    const b = await createOrganizationWithAdmin({
      organizationName: `Inv HTTP B ${suffix}`,
      slug: `ih-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: emails.b,
      password: "password12345",
    });
    orgA = a.organization.id;
    orgB = b.organization.id;
    const passwordHash = await hashPassword("password12345");
    await withTenantTransaction(orgA, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: "sales" } });
      await tx.user.create({ data: { organizationId: orgA, email: emails.sales, name: "Sales", passwordHash, roleId: role.id } });
      const customer = await tx.customer.create({
        data: { organizationId: orgA, name: "Bruno Client", email: `bruno-${suffix}@example.com` },
      });
      quoteId = (
        await tx.quote.create({
          data: { organizationId: orgA, number: 21, title: "LVP install", customerId: customer.id, status: "approved", total: 5000, subtotal: 5000 },
        })
      ).id;
      draftQuoteId = (
        await tx.quote.create({
          data: { organizationId: orgA, number: 22, title: "Draft", customerId: customer.id, status: "draft", total: 900, subtotal: 900 },
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

  it("runs the whole invoice lifecycle", async () => {
    const admin = await login(emails.admin, orgA);

    // Only approved quotes can be invoiced.
    expect((await call(admin, "POST", `/api/quotes/${draftQuoteId}/invoices`, { invoice_type: "full" })).status).toBe(409);

    // Deposit 40% → redirect to the invoice module.
    const created = await call(admin, "POST", `/api/quotes/${quoteId}/invoices`, { invoice_type: "deposit", deposit_pct: 40 });
    expect(created.status).toBe(201);
    expect(created.json.data.amount).toBe(2000);
    expect(created.json.redirect).toBe(`invoice.html?id=${created.json.data.id}`);
    expect(created.json.balance.remaining_to_invoice).toBe(3000);
    const id = created.json.data.id as string;

    // Can't bill more than what is left.
    expect((await call(admin, "POST", `/api/quotes/${quoteId}/invoices`, { invoice_type: "progress", custom_amount: 3500 })).status).toBe(422);

    const billable = await call(admin, "GET", "/api/invoices/billable-quotes");
    expect(billable.json.data.find((q: any) => q.id === quoteId)?.remaining_to_invoice).toBe(3000);

    // Detail
    const d0 = await call(admin, "GET", `/api/quote-invoices/${id}`);
    expect(d0.json.data).toMatchObject({ display_status: "draft", amount: 2000, remaining_amount: 2000 });
    expect(d0.json.data.can).toEqual({ manage: true, record_payment: true });

    // Edit draft amount and due date
    const e1 = await call(admin, "PATCH", `/api/quote-invoices/${id}`, { amount: 2500, due_date: "2026-12-01" });
    expect(e1.status).toBe(200);
    expect(e1.json.data.amount).toBe(2500);
    expect(e1.json.data.line_items[0].amount).toBe(2500);

    // Share link publishes the draft; public page renders and records the view.
    const link = await call(admin, "POST", `/api/quote-invoices/${id}/public-link`, {});
    const token = String(link.json.public_url).split("/public/invoices/")[1]!;
    const pub = await fetch(`${base}/public/invoices/${token}`);
    expect(pub.status).toBe(200);
    expect(await pub.text()).toContain("INVOICE");
    const d1 = await call(admin, "GET", `/api/quote-invoices/${id}`);
    expect(d1.json.data.display_status).toBe("viewed");
    expect(d1.json.data.viewed_at).toBeTruthy();

    // Partial payment ("baixa parcial")
    const p1 = await call(admin, "POST", `/api/quote-invoices/${id}/receipts`, {
      mode: "partial",
      amount: 1000,
      payment_method: "check",
      reference_number: "1042",
      payment_date: "2026-09-30",
    });
    expect(p1.status).toBe(201);
    expect(p1.json.invoice_paid).toBe(false);
    expect(p1.json.invoice).toMatchObject({ display_status: "partially_paid", paid_amount: 1000, remaining_amount: 1500, percent_paid: 40 });

    // Over the balance is refused
    expect((await call(admin, "POST", `/api/quote-invoices/${id}/receipts`, { amount: 2000 })).status).toBe(422);
    // Voiding with payments is refused
    expect((await call(admin, "POST", `/api/quote-invoices/${id}/void`, {})).status).toBe(409);
    // Amount is locked once there are payments
    expect((await call(admin, "PATCH", `/api/quote-invoices/${id}`, { amount: 2400 })).status).toBe(409);

    // Full payment settles the rest + sends the receipt (console transport in tests → error surfaced, payment kept)
    const p2 = await call(admin, "POST", `/api/quote-invoices/${id}/receipts`, { mode: "full", payment_method: "zelle", send_email: true });
    expect(p2.status).toBe(201);
    expect(p2.json.data.amount).toBe(1500);
    expect(p2.json.invoice_paid).toBe(true);
    expect(p2.json.invoice.display_status).toBe("paid");
    expect(p2.json.email).toBeTruthy();

    // PDFs
    const pdf = await call(admin, "GET", `/api/quote-invoices/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toContain("pdf");
    const rpdf = await call(admin, "GET", `/api/invoice-receipts/${p2.json.data.id}/pdf`);
    expect(rpdf.status).toBe(200);

    // List + summary
    const list = await call(admin, "GET", "/api/invoices?status=paid");
    expect(list.json.data.map((r: any) => r.id)).toContain(id);
    expect(list.json.summary.count.paid).toBeGreaterThanOrEqual(1);
    expect(list.json.summary.received_30d).toBeGreaterThanOrEqual(1500);

    // Quote side shows the invoice with its balance
    const qInv = await call(admin, "GET", `/api/quotes/${quoteId}/invoices`);
    expect(qInv.json.data[0]).toMatchObject({ id, display_status: "paid", remaining_amount: 0 });
    expect(qInv.json.balance).toMatchObject({ quote_total: 5000, invoiced_total: 2500, remaining_to_invoice: 2500 });

    // Undo the last payment → back to partial
    const undo = await call(admin, "DELETE", `/api/quote-invoices/${id}/receipts/${p2.json.data.id}`);
    expect(undo.status).toBe(200);
    expect(undo.json.invoice.display_status).toBe("partially_paid");

    // Activity trail
    const actions = (await call(admin, "GET", `/api/quote-invoices/${id}`)).json.data.activity.map((a: any) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["created", "updated", "link_shared", "viewed", "payment_recorded", "payment_removed"]),
    );

    // Legacy EJS routes redirect to the CRM module
    const legacy = await fetch(`${base}/invoices/${id}`, { headers: { Cookie: admin }, redirect: "manual" });
    expect(legacy.status).toBe(302);
    expect(legacy.headers.get("location")).toBe(`/invoice.html?id=${id}`);
  });

  it("enforces permissions and tenant isolation", async () => {
    const admin = await login(emails.admin, orgA);
    const created = await call(admin, "POST", `/api/quotes/${quoteId}/invoices`, { invoice_type: "progress", custom_amount: 100 });
    const id = created.json.data.id as string;

    const sales = await login(emails.sales, orgA);
    expect((await call(sales, "GET", `/api/quote-invoices/${id}`)).status).toBe(200);
    expect((await call(sales, "POST", `/api/quote-invoices/${id}/receipts`, { mode: "full" })).status).toBe(403);

    const other = await login(emails.b, orgB);
    expect((await call(other, "GET", `/api/quote-invoices/${id}`)).status).toBe(404);
    expect((await call(other, "POST", `/api/quote-invoices/${id}/receipts`, { mode: "full" })).status).toBe(404);
    expect((await call(other, "GET", "/api/invoices")).json.data.map((r: any) => r.id)).not.toContain(id);

    // Drafts can be deleted; the amount returns to the quote.
    expect((await call(admin, "DELETE", `/api/quote-invoices/${id}`)).status).toBe(200);
  });
});
