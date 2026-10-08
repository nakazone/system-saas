/**
 * Faturas (invoices) — CRM JSON API.
 *
 * The invoice has its own module (invoices.html / invoice.html). Quotes only issue invoices;
 * everything after that (payments, receipts, sending, PDF with PAID stamp) happens here.
 */
import { Router, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { prisma } from "../../lib/prisma.js";
import { publicBaseUrl } from "../../lib/http/public-url.js";
import { recordActivity } from "../../lib/activity/record.js";
import { sendCustomerEmail } from "../../lib/email/index.js";
import { nextInvoiceNumber, recordInvoicePayment, seedDefaultPaymentTemplates } from "../../lib/payments/engine.js";
import {
  computeInvoiceMoney,
  computeNewInvoiceAmount,
  invoiceKindLabel,
  paymentMethodLabel,
  resolvePaymentAmount,
} from "../../lib/invoices/core.js";
import {
  clientOf,
  docOrgOf,
  ensureInvoicePublicToken,
  invoiceDetailInclude,
  invoicedTotalForQuote,
  isApprovedQuoteStatus,
  publicInvoiceUrl,
  quoteNumberOf,
  receiptPdfInput,
  removeInvoicePayment,
  renderInvoicePdf,
  resolvedInvoiceLines,
  servicesTotalOf,
  contractSummaryOf,
  syncInvoiceStatus,
  type InvoiceDetail,
} from "../../lib/invoices/service.js";
import { buildReceiptPdf } from "../../lib/invoices/pdf.js";
import { invoicedTotalForJob, jobBilling, quoteInvoiceLines } from "../../lib/invoices/job.js";
import { invoiceEmail, receiptEmail } from "../../lib/invoices/email.js";
import { parseInvoiceSettings } from "../../lib/settings/invoices.js";

export const invoicesCrmRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badId(res: Response) {
  res.status(400).json({ success: false, error: "ID inválido" });
}

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ success: false, error });
}

function baseUrl(req: AuthedRequest): string {
  return publicBaseUrl(req);
}

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00.000Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

type ListRow = Prisma.QuoteInvoiceGetPayload<{
  include: {
    quote: { select: { id: true; title: true; quoteNumber: true; number: true } };
    workOrder: {
      select: {
        id: true;
        number: true;
        title: true;
        builder: { select: { company: true; firstName: true; lastName: true; email: true } };
      };
    };
    customer: { select: { name: true; email: true } };
    receipts: { select: { amount: true; paidAt: true } };
  };
}>;

const listInclude = {
  quote: { select: { id: true, title: true, quoteNumber: true, number: true } },
  workOrder: {
    select: {
      id: true,
      number: true,
      title: true,
      builder: { select: { company: true, firstName: true, lastName: true, email: true } },
    },
  },
  customer: { select: { name: true, email: true } },
  receipts: { select: { amount: true, paidAt: true } },
} as const;

function listItem(inv: ListRow, now: Date) {
  const m = computeInvoiceMoney(inv, now);
  return {
    id: inv.id,
    invoice_number: inv.invoiceNumber,
    invoice_type: inv.invoiceType,
    invoice_type_label: invoiceKindLabel(inv.invoiceType, "pt"),
    status: inv.status,
    display_status: m.displayStatus,
    amount: m.amount,
    paid_amount: m.paid,
    paid_total: m.paid,
    remaining_amount: m.balance,
    percent_paid: m.percentPaid,
    days_overdue: m.daysOverdue,
    due_date: inv.dueDate,
    issued_at: inv.issuedAt,
    email_sent_at: inv.issuedAt,
    viewed_at: inv.viewedAt,
    paid_at: inv.paidAt,
    created_at: inv.createdAt,
    updated_at: inv.updatedAt,
    quote_id: inv.quoteId,
    quote_title: inv.quote?.title ?? null,
    quote_number: quoteNumberOf(inv.quote),
    work_order_id: inv.workOrderId,
    job_number: inv.workOrder?.number ?? null,
    job_title: inv.workOrder?.title ?? null,
    /** Short reference for lists: "Q-12" or "Job #7". */
    source_ref: inv.quote
      ? quoteNumberOf(inv.quote)
      : inv.workOrder
        ? inv.workOrder.number != null
          ? `Job #${inv.workOrder.number}`
          : "Job"
        : null,
    // Builder jobs are billed to the builder when the job has no customer.
    customer_name:
      inv.customer?.name ||
      (inv.workOrder?.builder
        ? inv.workOrder.builder.company ||
          [inv.workOrder.builder.firstName, inv.workOrder.builder.lastName].filter(Boolean).join(" ").trim() ||
          null
        : null),
    customer_email: inv.customer?.email || inv.workOrder?.builder?.email || null,
  };
}

async function loadDetail(tx: TenantPrisma, id: string) {
  return tx.quoteInvoice.findFirst({ where: { id }, include: invoiceDetailInclude });
}

async function detailPayload(tx: TenantPrisma, inv: InvoiceDetail, req: AuthedRequest) {
  const m = computeInvoiceMoney(inv);
  const client = clientOf(inv);
  const [events, siblings] = await Promise.all([
    tx.activityEvent.findMany({
      where: { entityType: "invoice", entityId: inv.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    inv.quoteId || inv.workOrderId
      ? tx.quoteInvoice.findMany({
          where: inv.quoteId ? { quoteId: inv.quoteId } : { workOrderId: inv.workOrderId },
          select: { id: true, invoiceNumber: true, invoiceType: true, amount: true, status: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([] as { id: string; invoiceNumber: string | null; invoiceType: string; amount: Prisma.Decimal; status: string }[]),
  ]);
  const userIds = [
    ...new Set(
      [...events.map((e) => e.actorId), ...inv.receipts.map((r) => r.createdById)].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  ];
  const org = await prisma.organization.findUnique({ where: { id: inv.organizationId } });
  const docOrg = org ? docOrgOf(org) : null;
  const invoiceShare = parseInvoiceSettings(
    org && "invoiceSettings" in org ? (org as { invoiceSettings?: unknown }).invoiceSettings : null,
  ).share_messages;
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const userName = (id: string | null) => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u ? u.name || u.email : null;
  };
  const quoteTotal = inv.quote ? dec(inv.quote.total) : 0;
  const invoicedTotal = siblings.filter((s) => s.status !== "void").reduce((s, x) => s + dec(x.amount), 0);
  const perms = req.user?.permissions || [];
  const isAdmin = req.user?.roleKey === "admin";
  return {
    id: inv.id,
    invoice_number: inv.invoiceNumber,
    invoice_type: inv.invoiceType,
    invoice_type_label: invoiceKindLabel(inv.invoiceType, "pt"),
    status: inv.status,
    display_status: m.displayStatus,
    amount: m.amount,
    services_total: servicesTotalOf(inv),
    paid_amount: m.paid,
    remaining_amount: m.balance,
    remaining_after_this_invoice: contractSummaryOf(inv)?.remainingAfterThisInvoice ?? 0,
    percent_paid: m.percentPaid,
    is_overdue: m.isOverdue,
    days_overdue: m.daysOverdue,
    due_date: inv.dueDate,
    issued_at: inv.issuedAt,
    viewed_at: inv.viewedAt,
    paid_at: inv.paidAt,
    voided_at: inv.voidedAt,
    sent_to: inv.sentTo,
    created_at: inv.createdAt,
    notes: inv.notes,
    payment_instructions: inv.paymentInstructions,
    public_url: inv.publicToken ? publicInvoiceUrl(baseUrl(req), inv.publicToken) : null,
    client,
    organization: docOrg
      ? { name: docOrg.name, logo_url: docOrg.logoUrl, contact: docOrg.contact, address: docOrg.address, license: docOrg.license }
      : null,
    share_sms_body: invoiceShare.sms_body,
    customer_id: inv.customerId,
    quote: inv.quote
      ? {
          id: inv.quote.id,
          title: inv.quote.title,
          number: quoteNumberOf(inv.quote),
          total: quoteTotal,
          invoiced_total: Math.round(invoicedTotal * 100) / 100,
          remaining_to_invoice: Math.max(0, Math.round((quoteTotal - invoicedTotal) * 100) / 100),
          lead_id: inv.quote.leadId,
        }
      : null,
    job: inv.workOrder
      ? (() => {
          const servicesTotal = inv.workOrder.lineItems.reduce((acc, li) => acc + dec(li.lineTotal), 0);
          const jobTotal = Math.round(servicesTotal * 100) / 100;
          return {
            id: inv.workOrder.id,
            number: inv.workOrder.number,
            title: inv.workOrder.title,
            address: inv.workOrder.address,
            status: inv.workOrder.status,
            total: jobTotal,
            invoiced_total: Math.round(invoicedTotal * 100) / 100,
            remaining_to_invoice: Math.max(0, Math.round((jobTotal - invoicedTotal) * 100) / 100),
            url: `job-detail.html?id=${encodeURIComponent(inv.workOrder.id)}`,
          };
        })()
      : null,
    sibling_invoices: siblings
      .filter((s) => s.id !== inv.id)
      .map((s) => ({
        id: s.id,
        invoice_number: s.invoiceNumber,
        invoice_type_label: invoiceKindLabel(s.invoiceType, "pt"),
        amount: dec(s.amount),
        status: s.status,
      })),
    line_items: resolvedInvoiceLines(inv).map((l) => ({
      id: l.id ?? null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      amount: l.amount,
    })),
    payments: inv.receipts.map((r) => ({
      id: r.id,
      receipt_number: r.receiptNumber,
      amount: dec(r.amount),
      paid_at: r.paidAt,
      method: r.method,
      method_label: paymentMethodLabel(r.method, "pt"),
      reference_number: r.referenceNumber,
      notes: r.notes,
      sent_at: r.sentAt,
      sent_to: r.sentTo,
      online: Boolean(r.externalPaymentId),
      created_by: userName(r.createdById),
    })),
    activity: events.map((e) => ({
      id: e.id,
      action: e.action,
      actor_type: e.actorType,
      actor_name: userName(e.actorId),
      changes: e.changes,
      created_at: e.createdAt,
    })),
    can: {
      manage: isAdmin || perms.includes("invoices.manage"),
      record_payment: isAdmin || perms.includes("invoices.record_payment"),
    },
  };
}

// ---------------------------------------------------------------------------
// List + summary

async function listInvoices(req: AuthedRequest, res: Response, next: (e: unknown) => void) {
  try {
    const now = new Date();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const status = String(req.query.status || "all").trim().toLowerCase();
    const q = String(req.query.q || req.query.search || "").trim();
    const customerId = String(req.query.customer_id || "").trim();
    const quoteId = String(req.query.quote_id || "").trim();
    const workOrderId = String(req.query.work_order_id || "").trim();

    const base: Prisma.QuoteInvoiceWhereInput = {};
    if (customerId && UUID_RE.test(customerId)) base.customerId = customerId;
    if (quoteId && UUID_RE.test(quoteId)) base.quoteId = quoteId;
    if (workOrderId && UUID_RE.test(workOrderId)) base.workOrderId = workOrderId;
    if (q) {
      base.OR = [
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { quote: { quoteNumber: { contains: q, mode: "insensitive" } } },
        { quote: { title: { contains: q, mode: "insensitive" } } },
        { workOrder: { title: { contains: q, mode: "insensitive" } } },
        { workOrder: { builder: { company: { contains: q, mode: "insensitive" } } } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { email: { contains: q, mode: "insensitive" } } },
      ];
    }

    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const where: Prisma.QuoteInvoiceWhereInput = { ...base };
    switch (status) {
      case "draft":
        where.status = "draft";
        break;
      case "unpaid":
      case "open":
        where.status = { in: ["sent", "partially_paid"] };
        break;
      case "sent":
        where.status = "sent";
        break;
      case "partially_paid":
      case "partial":
        where.status = "partially_paid";
        break;
      case "overdue":
        where.status = { in: ["sent", "partially_paid"] };
        where.dueDate = { lt: startToday };
        break;
      case "paid":
        where.status = "paid";
        break;
      case "void":
        where.status = "void";
        break;
      default:
        where.status = { not: "void" };
    }

    const include = listInclude;

    const [total, rows, all] = await withTenantTransaction(req.organizationId!, async (tx) => [
      await tx.quoteInvoice.count({ where }),
      await tx.quoteInvoice.findMany({
        where,
        include,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      // Summary covers every invoice (respecting search / client filters, not the status tab).
      await tx.quoteInvoice.findMany({
        where: { ...base, status: { not: "void" } },
        select: {
          status: true,
          amount: true,
          dueDate: true,
          viewedAt: true,
          receipts: { select: { amount: true, paidAt: true } },
        },
        take: 5000,
      }),
    ]);

    const since30 = now.getTime() - 30 * 86400000;
    const summary = {
      count: { all: 0, draft: 0, unpaid: 0, partially_paid: 0, overdue: 0, paid: 0 },
      outstanding: 0,
      overdue_amount: 0,
      draft_amount: 0,
      received_30d: 0,
    };
    for (const inv of all) {
      const m = computeInvoiceMoney({ ...inv, receipts: inv.receipts }, now);
      summary.count.all += 1;
      if (m.displayStatus === "draft") {
        summary.count.draft += 1;
        summary.draft_amount += m.balance;
      } else if (m.displayStatus === "paid") summary.count.paid += 1;
      else {
        summary.count.unpaid += 1;
        summary.outstanding += m.balance;
        if (m.displayStatus === "partially_paid") summary.count.partially_paid += 1;
        if (m.isOverdue) {
          summary.count.overdue += 1;
          summary.overdue_amount += m.balance;
        }
      }
      for (const r of inv.receipts) {
        if (r.paidAt.getTime() >= since30) summary.received_30d += dec(r.amount);
      }
    }
    for (const k of ["outstanding", "overdue_amount", "draft_amount", "received_30d"] as const) {
      summary[k] = Math.round(summary[k] * 100) / 100;
    }

    res.json({
      success: true,
      data: rows.map((r) => listItem(r, now)),
      total,
      page,
      limit,
      summary,
    });
  } catch (error) {
    next(error);
  }
}

invoicesCrmRouter.get("/api/invoices", requireCrmAuth, requireCrmPermission("invoices.view"), listInvoices);
invoicesCrmRouter.get("/api/quote-invoices", requireCrmAuth, requireCrmPermission("invoices.view"), listInvoices);

/** Approved quotes that still have value to invoice — "Nova fatura" picker. */
invoicesCrmRouter.get(
  "/api/invoices/billable-quotes",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.quote.findMany({
          where: {
            status: { in: ["approved", "accepted", "invoiced", "converted"] },
            ...(q
              ? {
                  OR: [
                    { title: { contains: q, mode: "insensitive" } },
                    { quoteNumber: { contains: q, mode: "insensitive" } },
                    { customer: { name: { contains: q, mode: "insensitive" } } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            title: true,
            quoteNumber: true,
            number: true,
            total: true,
            updatedAt: true,
            customer: { select: { name: true } },
            invoices: { where: { status: { not: "void" } }, select: { amount: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 60,
        }),
      );
      const data = rows
        .map((r) => {
          const total = dec(r.total);
          const invoiced = r.invoices.reduce((s, i) => s + dec(i.amount), 0);
          return {
            id: r.id,
            title: r.title,
            number: quoteNumberOf(r),
            customer_name: r.customer?.name || null,
            total,
            invoiced_total: Math.round(invoiced * 100) / 100,
            remaining_to_invoice: Math.max(0, Math.round((total - invoiced) * 100) / 100),
            invoice_count: r.invoices.length,
          };
        })
        .filter((r) => r.remaining_to_invoice > 0.004);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

/** Jobs (ordens de serviço) with value still to invoice — "Nova fatura" picker, fixed-price flow. */
invoicesCrmRouter.get(
  "/api/invoices/billable-jobs",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.workOrder.findMany({
          where: {
            status: { not: "canceled" },
            lineItems: { some: {} },
            ...(q
              ? {
                  OR: [
                    { title: { contains: q, mode: "insensitive" } },
                    { address: { contains: q, mode: "insensitive" } },
                    { customer: { name: { contains: q, mode: "insensitive" } } },
                    { builder: { company: { contains: q, mode: "insensitive" } } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            scheduledStart: true,
            customer: { select: { name: true } },
            builder: { select: { company: true, firstName: true, lastName: true } },
            lineItems: { select: { lineTotal: true } },
            invoices: { select: { amount: true, status: true, receipts: { select: { amount: true } } } },
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 200,
        }),
      );
      const data = rows
        .map((r) => {
          const total = r.lineItems.reduce((acc, li) => acc + dec(li.lineTotal), 0);
          const billing = jobBilling(total, r.invoices);
          const builderName = r.builder
            ? r.builder.company || [r.builder.firstName, r.builder.lastName].filter(Boolean).join(" ").trim()
            : null;
          return {
            id: r.id,
            number: r.number,
            title: r.title,
            status: r.status,
            scheduled_start: r.scheduledStart,
            customer_name: r.customer?.name || builderName || null,
            total: billing.services_total,
            invoiced_total: billing.invoiced_total,
            remaining_to_invoice: billing.remaining_to_invoice,
            invoice_count: billing.invoice_count,
          };
        })
        .filter((r) => r.remaining_to_invoice > 0.004)
        // Finished work first — that is what is waiting to be billed.
        .sort((a, b) => Number(b.status === "completed") - Number(a.status === "completed"))
        .slice(0, 60);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Issue from a quote

invoicesCrmRouter.get(
  "/api/quotes/:id/invoices",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const quoteId = String(req.params.id);
      if (!UUID_RE.test(quoteId)) return badId(res);
      const now = new Date();
      const { quote, rows } = await withTenantTransaction(req.organizationId!, async (tx) => ({
        quote: await tx.quote.findFirst({ where: { id: quoteId }, select: { total: true } }),
        rows: await tx.quoteInvoice.findMany({
          where: { quoteId },
          orderBy: { createdAt: "asc" },
          include: listInclude,
        }),
      }));
      if (!quote) return fail(res, 404, "Orçamento não encontrado");
      const data = rows.map((r) => listItem(r, now));
      const quoteTotal = dec(quote.total);
      const invoiced = data.filter((d) => d.status !== "void").reduce((s, d) => s + d.amount, 0);
      const paid = data.reduce((s, d) => s + d.paid_amount, 0);
      const paidRounded = Math.round(paid * 100) / 100;
      const invoicedRounded = Math.round(invoiced * 100) / 100;
      res.json({
        success: true,
        data,
        balance: {
          quote_total: quoteTotal,
          invoiced_total: invoicedRounded,
          remaining_to_invoice: Math.max(0, Math.round((quoteTotal - invoicedRounded) * 100) / 100),
          paid_total: paidRounded,
          remaining_due: Math.max(0, Math.round((quoteTotal - paidRounded) * 100) / 100),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

const createSchema = z.object({
  invoice_type: z.string().max(20).optional(),
  type: z.string().max(20).optional(),
  deposit_pct: z.coerce.number().optional().nullable(),
  custom_amount: z.coerce.number().optional().nullable(),
  amount: z.coerce.number().optional().nullable(),
  due_date: z.string().optional().nullable(),
  payment_instructions: z.string().max(4000).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  send_now: z.boolean().optional(),
});

invoicesCrmRouter.post(
  "/api/quotes/:id/invoices",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const quoteId = String(req.params.id);
      if (!UUID_RE.test(quoteId)) return badId(res);
      const parsed = createSchema.safeParse(req.body || {});
      if (!parsed.success) return fail(res, 400, "Dados inválidos");
      const b = parsed.data;
      const kind = String(b.invoice_type || b.type || "deposit");

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: quoteId },
          include: {
            organization: true,
            lineItems: { orderBy: { sortOrder: "asc" } },
          },
        });
        if (!quote) return { error: "Orçamento não encontrado", status: 404 } as const;
        if (!isApprovedQuoteStatus(quote.status)) {
          return { error: "Só é possível emitir fatura de um orçamento aprovado.", status: 409 } as const;
        }
        const invoicedTotal = await invoicedTotalForQuote(tx, quote.id);
        const calc = computeNewInvoiceAmount({
          kind,
          quoteTotal: dec(quote.total),
          invoicedTotal,
          depositPct: b.deposit_pct,
          customAmount: b.custom_amount ?? b.amount,
        });
        if (!calc.ok) return { error: calc.error, status: 422 } as const;

        await seedDefaultPaymentTemplates(tx, req.organizationId!);
        const invoiceNumber = await nextInvoiceNumber(tx, req.organizationId!);
        const amount = new Prisma.Decimal(calc.amount.toFixed(2));
        const due =
          parseDate(b.due_date) || new Date(Date.now() + 1 * 86400000);
        const inv = await tx.quoteInvoice.create({
          data: {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            customerId: quote.customerId,
            invoiceNumber,
            invoiceType: calc.kind,
            status: "draft",
            amount,
            dueDate: due,
            notes: b.notes?.trim() || null,
            paymentInstructions: b.payment_instructions?.trim() || quote.organization.paymentInstructions || null,
          },
        });
        const quoteNo = quoteNumberOf(quote);
        const lines = quoteInvoiceLines({
          kind: calc.kind,
          label: calc.label,
          amount: calc.amount,
          quote,
          invoicedBefore: invoicedTotal,
        });
        await tx.invoiceLineItem.createMany({
          data: lines.map((l, i) => ({
            organizationId: req.organizationId!,
            invoiceId: inv.id,
            description: l.description.slice(0, 500),
            quantity: new Prisma.Decimal(l.quantity.toFixed(2)),
            unitPrice: new Prisma.Decimal(l.unitPrice.toFixed(2)),
            amount: new Prisma.Decimal(l.amount.toFixed(2)),
            sortOrder: i + 1,
          })),
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "invoice",
          entityId: inv.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
          changes: {
            quote: { from: null, to: quoteNo },
            amount: { from: null, to: calc.amount },
            type: { from: null, to: calc.kind },
          },
        });
        return { inv, invoicedTotal: invoicedTotal + calc.amount, quoteTotal: dec(quote.total) } as const;
      });

      if ("error" in result) return fail(res, result.status ?? 400, result.error!);
      res.status(201).json({
        success: true,
        data: {
          id: result.inv.id,
          invoice_number: result.inv.invoiceNumber,
          invoice_type: result.inv.invoiceType,
          status: result.inv.status,
          amount: dec(result.inv.amount),
          due_date: result.inv.dueDate,
        },
        redirect: `invoice.html?id=${encodeURIComponent(result.inv.id)}`,
        balance: {
          quote_total: result.quoteTotal,
          invoiced_total: Math.round(result.invoicedTotal * 100) / 100,
          remaining_to_invoice: Math.max(0, Math.round((result.quoteTotal - result.invoicedTotal) * 100) / 100),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Detail / edit

invoicesCrmRouter.get(
  "/api/quote-invoices/:id",
  requireCrmAuth,
  requireCrmPermission("invoices.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await loadDetail(tx, id);
        return inv ? detailPayload(tx, inv, req) : null;
      });
      if (!data) return fail(res, 404, "Fatura não encontrada");
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

const patchSchema = z.object({
  due_date: z.string().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  payment_instructions: z.string().max(4000).optional().nullable(),
  amount: z.coerce.number().positive().optional(),
  line_description: z.string().max(2000).optional(),
});

invoicesCrmRouter.patch(
  "/api/quote-invoices/:id",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const parsed = patchSchema.safeParse(req.body || {});
      if (!parsed.success) return fail(res, 400, "Dados inválidos");
      const b = parsed.data;
      const out = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await loadDetail(tx, id);
        if (!inv) return { error: "Fatura não encontrada", status: 404 } as const;
        if (inv.status === "void") return { error: "Fatura anulada não pode ser editada.", status: 409 } as const;
        const data: Prisma.QuoteInvoiceUpdateInput = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (b.due_date !== undefined) {
          const d = parseDate(b.due_date);
          data.dueDate = d;
          changes.due_date = { from: inv.dueDate, to: d };
        }
        if (b.notes !== undefined) {
          data.notes = b.notes?.trim() || null;
          changes.notes = { from: inv.notes, to: data.notes };
        }
        if (b.payment_instructions !== undefined) {
          data.paymentInstructions = b.payment_instructions?.trim() || null;
          changes.payment_instructions = { from: inv.paymentInstructions, to: data.paymentInstructions };
        }
        if (b.amount !== undefined && Math.round(b.amount * 100) !== Math.round(dec(inv.amount) * 100)) {
          if (inv.receipts.length) {
            return { error: "Não dá para mudar o valor de uma fatura com pagamentos.", status: 409 } as const;
          }
          if (!inv.quote && inv.lineItems.length > 1) {
            return {
              error: "Fatura com os serviços do job: ajuste os serviços no job e emita de novo.",
              status: 409,
            } as const;
          }
          const others = inv.quoteId
            ? await invoicedTotalForQuote(tx, inv.quoteId, inv.id)
            : inv.workOrderId
              ? await invoicedTotalForJob(tx, inv.workOrderId, inv.id)
              : 0;
          const quoteTotal = inv.quote
            ? dec(inv.quote.total)
            : inv.workOrder
              ? inv.workOrder.lineItems.reduce((acc, li) => acc + dec(li.lineTotal), 0)
              : 0;
          if (others + b.amount > quoteTotal + 0.004) {
            return {
              error: `Valor acima do que falta faturar ($${Math.max(0, quoteTotal - others).toFixed(2)}).`,
              status: 422,
            } as const;
          }
          const amt = new Prisma.Decimal(b.amount.toFixed(2));
          data.amount = amt;
          changes.amount = { from: dec(inv.amount), to: b.amount };
          if (inv.lineItems.length === 1) {
            await tx.invoiceLineItem.update({
              where: { id: inv.lineItems[0]!.id },
              data: { unitPrice: amt, amount: amt, quantity: new Prisma.Decimal(1) },
            });
          }
        }
        if (b.line_description !== undefined && inv.lineItems.length === 1 && b.line_description.trim()) {
          await tx.invoiceLineItem.update({
            where: { id: inv.lineItems[0]!.id },
            data: { description: b.line_description.trim() },
          });
        }
        await tx.quoteInvoice.update({ where: { id }, data });
        if (Object.keys(changes).length) {
          await recordActivity(tx, {
            organizationId: req.organizationId!,
            entityType: "invoice",
            entityId: id,
            actorType: "user",
            actorId: req.user!.id,
            action: "updated",
            changes: JSON.parse(JSON.stringify(changes)),
          });
        }
        const fresh = await loadDetail(tx, id);
        return { data: await detailPayload(tx, fresh!, req) } as const;
      });
      if ("error" in out) return fail(res, out.status ?? 400, out.error!);
      res.json({ success: true, data: out.data });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Send / link / void / delete

invoicesCrmRouter.post(
  "/api/quote-invoices/:id/public-link",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const token = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await tx.quoteInvoice.findFirst({ where: { id }, select: { status: true, issuedAt: true } });
        if (!inv) throw new Error("Fatura não encontrada");
        const t = await ensureInvoicePublicToken(tx, req.organizationId!, id);
        // Sharing the link (WhatsApp/SMS) is sending: drafts are not visible on the public page.
        if (inv.status === "draft") {
          await tx.quoteInvoice.update({
            where: { id },
            data: { status: "sent", issuedAt: inv.issuedAt ?? new Date() },
          });
          await recordActivity(tx, {
            organizationId: req.organizationId!,
            entityType: "invoice",
            entityId: id,
            actorType: "user",
            actorId: req.user!.id,
            action: "link_shared",
            changes: { status: { from: "draft", to: "sent" } },
          });
        }
        return t;
      });
      res.json({ success: true, public_url: publicInvoiceUrl(baseUrl(req), token) });
    } catch (error) {
      next(error);
    }
  },
);

const sendSchema = z.object({
  to: z.string().max(200).optional().nullable(),
  message: z.string().max(4000).optional().nullable(),
  mark_only: z.boolean().optional(),
});

invoicesCrmRouter.post(
  "/api/quote-invoices/:id/send-email",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const parsed = sendSchema.safeParse(req.body || {});
      if (!parsed.success) return fail(res, 400, "Dados inválidos");
      const markOnly = Boolean(parsed.data.mark_only);

      const prep = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await loadDetail(tx, id);
        if (!inv) return { error: "Fatura não encontrada", status: 404 } as const;
        if (inv.status === "void") return { error: "Fatura anulada.", status: 409 } as const;
        const to = (parsed.data.to || "").trim() || clientOf(inv).email || "";
        if (!markOnly && !EMAIL_RE.test(to)) {
          return { error: "O cliente não tem e-mail — informe um endereço.", status: 422 } as const;
        }
        const token = await ensureInvoicePublicToken(tx, req.organizationId!, id);
        return { inv, to, token } as const;
      });
      if ("error" in prep) return fail(res, prep.status ?? 400, prep.error!);

      const publicUrl = publicInvoiceUrl(baseUrl(req), prep.token);
      let emailResult: { ok: boolean; error?: string } = { ok: true };
      if (!markOnly) {
        const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.organizationId! } });
        const m = computeInvoiceMoney(prep.inv);
        const msg = invoiceEmail({
          companyName: org.name,
          phone: org.contactPhone,
          accentColor: org.accentColor,
          primaryColor: org.primaryColor,
          clientName: clientOf(prep.inv).name,
          invoiceNumber: prep.inv.invoiceNumber || "Invoice",
          amount: m.amount,
          balance: m.balance,
          dueDate: prep.inv.dueDate,
          publicUrl,
          message: parsed.data.message,
          paymentInstructions: prep.inv.paymentInstructions || org.paymentInstructions,
        });
        const pdf = await renderInvoicePdf(prep.inv, org);
        const sent = await sendCustomerEmail({
          to: prep.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          replyTo: org.contactEmail || undefined,
          attachments: [{ filename: `${prep.inv.invoiceNumber || "invoice"}.pdf`, content: pdf }],
        });
        if (!sent.ok) emailResult = { ok: false, error: sent.error };
      }
      if (!emailResult.ok) return fail(res, 503, emailResult.error || "Falha ao enviar e-mail");

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await tx.quoteInvoice.findFirstOrThrow({ where: { id } });
        await tx.quoteInvoice.update({
          where: { id },
          data: {
            status: inv.status === "draft" ? "sent" : inv.status,
            issuedAt: inv.issuedAt ?? new Date(),
            sentTo: markOnly ? inv.sentTo : prep.to,
          },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "invoice",
          entityId: id,
          actorType: "user",
          actorId: req.user!.id,
          action: markOnly ? "marked_sent" : "sent",
          changes: markOnly ? { status: { from: inv.status, to: "sent" } } : { to: { from: null, to: prep.to } },
        });
        const fresh = await loadDetail(tx, id);
        return detailPayload(tx, fresh!, req);
      });
      res.json({ success: true, data, public_url: publicUrl });
    } catch (error) {
      next(error);
    }
  },
);

invoicesCrmRouter.post(
  "/api/quote-invoices/:id/void",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const reason = String(req.body?.reason || "").slice(0, 500) || null;
      const out = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await tx.quoteInvoice.findFirst({ where: { id }, include: { receipts: true } });
        if (!inv) return { error: "Fatura não encontrada", status: 404 } as const;
        if (inv.receipts.length) {
          return { error: "Remova os pagamentos antes de anular a fatura.", status: 409 } as const;
        }
        await tx.quoteInvoice.update({ where: { id }, data: { status: "void", voidedAt: new Date() } });
        await tx.publicAccessToken.updateMany({
          where: { entityType: "invoice", entityId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "invoice",
          entityId: id,
          actorType: "user",
          actorId: req.user!.id,
          action: "voided",
          changes: { status: { from: inv.status, to: "void" }, reason: { from: null, to: reason } },
        });
        return { ok: true } as const;
      });
      if ("error" in out) return fail(res, out.status ?? 400, out.error!);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

invoicesCrmRouter.delete(
  "/api/quote-invoices/:id",
  requireCrmAuth,
  requireCrmPermission("invoices.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const out = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await tx.quoteInvoice.findFirst({ where: { id }, include: { receipts: true } });
        if (!inv) return { error: "Fatura não encontrada", status: 404 } as const;
        if (inv.receipts.length) return { error: "Fatura com pagamentos não pode ser apagada.", status: 409 } as const;
        if (inv.status !== "draft" && inv.status !== "void") {
          return { error: "Fatura já enviada ao cliente — use Anular.", status: 409 } as const;
        }
        await tx.publicAccessToken.updateMany({
          where: { entityType: "invoice", entityId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.quoteInvoice.delete({ where: { id } });
        return { ok: true, quoteId: inv.quoteId } as const;
      });
      if ("error" in out) return fail(res, out.status ?? 400, out.error!);
      res.json({ success: true, quote_id: out.quoteId });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Payments + receipts

const paymentSchema = z.object({
  mode: z.enum(["full", "partial"]).optional(),
  amount: z.coerce.number().optional().nullable(),
  payment_date: z.string().optional().nullable(),
  paid_at: z.string().optional().nullable(),
  payment_method: z.string().max(40).optional().nullable(),
  method: z.string().max(40).optional().nullable(),
  reference_number: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  send_email: z.boolean().optional(),
  email_to: z.string().max(200).optional().nullable(),
  external_payment_id: z.string().max(200).optional().nullable(),
  processor: z.string().max(40).optional().nullable(),
});

async function emailReceipt(
  req: AuthedRequest,
  invoiceId: string,
  receiptId: string,
  toOverride?: string | null,
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const prep = await withTenantTransaction(req.organizationId!, async (tx) => {
    const inv = await loadDetail(tx, invoiceId);
    if (!inv) return null;
    const token = await ensureInvoicePublicToken(tx, req.organizationId!, invoiceId);
    return { inv, token };
  });
  if (!prep) return { ok: false, error: "Fatura não encontrada" };
  const to = (toOverride || "").trim() || clientOf(prep.inv).email || "";
  if (!EMAIL_RE.test(to)) return { ok: false, error: "O cliente não tem e-mail cadastrado." };
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.organizationId! } });
  const input = receiptPdfInput(prep.inv, receiptId, org);
  if (!input) return { ok: false, error: "Recibo não encontrado" };
  const pdf = await buildReceiptPdf(input);
  const msg = receiptEmail({
    companyName: org.name,
    phone: org.contactPhone,
    accentColor: org.accentColor,
    primaryColor: org.primaryColor,
    clientName: input.client.name,
    receiptNumber: input.receiptNumber,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    paidAt: input.paidAt,
    methodLabel: input.method ? paymentMethodLabel(input.method) : null,
    balance: input.balance,
    publicUrl: publicInvoiceUrl(baseUrl(req), prep.token),
  });
  const sent = await sendCustomerEmail({
    to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    replyTo: org.contactEmail || undefined,
    attachments: [{ filename: `${input.receiptNumber}.pdf`, content: pdf }],
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  await withTenantTransaction(req.organizationId!, async (tx) => {
    await tx.invoiceReceipt.update({ where: { id: receiptId }, data: { sentAt: new Date(), sentTo: to } });
    await recordActivity(tx, {
      organizationId: req.organizationId!,
      entityType: "invoice",
      entityId: invoiceId,
      actorType: "user",
      actorId: req.user!.id,
      action: "receipt_sent",
      changes: { receipt: { from: null, to: input.receiptNumber }, to: { from: null, to } },
    });
  });
  return { ok: true, to };
}

const receiptPreviewSchema = z.object({
  mode: z.enum(["full", "partial"]).optional(),
  amount: z.coerce.number().optional().nullable(),
  payment_date: z.string().optional().nullable(),
  paid_at: z.string().optional().nullable(),
  payment_method: z.string().max(40).optional().nullable(),
  method: z.string().max(40).optional().nullable(),
  email_to: z.string().max(200).optional().nullable(),
});

invoicesCrmRouter.post(
  "/api/quote-invoices/:id/receipt-email-preview",
  requireCrmAuth,
  requireCrmPermission("invoices.record_payment"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const parsed = receiptPreviewSchema.safeParse(req.body || {});
      if (!parsed.success) return fail(res, 400, "Dados inválidos");
      const b = parsed.data;

      const prep = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await loadDetail(tx, id);
        if (!inv) return null;
        if (inv.status === "void") return { error: "Fatura anulada.", status: 409 } as const;
        const m = computeInvoiceMoney(inv);
        const resolved = resolvePaymentAmount({
          mode: b.mode,
          amount: b.amount,
          balance: m.balance,
        });
        if (!resolved.ok) return { error: resolved.error, status: 422 } as const;
        const token = await ensureInvoicePublicToken(tx, req.organizationId!, id);
        return { inv, money: m, amount: resolved.amount, token };
      });
      if (!prep) return fail(res, 404, "Fatura não encontrada");
      if ("error" in prep) return fail(res, prep.status ?? 400, prep.error!);

      const paidAt = parseDate(b.paid_at || b.payment_date) || new Date();
      const method = b.payment_method || b.method || null;
      const client = clientOf(prep.inv);
      const to = (b.email_to || "").trim() || client.email || "";
      if (!EMAIL_RE.test(to)) {
        return fail(res, 400, "O cliente não tem e-mail cadastrado.");
      }

      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
      });
      const balanceAfter = Math.max(
        0,
        Math.round((prep.money.balance - prep.amount) * 100) / 100,
      );
      const receiptNumber = "RCT-PREVIEW";
      const msg = receiptEmail({
        companyName: org.name,
        phone: org.contactPhone,
        accentColor: org.accentColor,
        primaryColor: org.primaryColor,
        clientName: client.name,
        receiptNumber,
        invoiceNumber: prep.inv.invoiceNumber || id.slice(0, 8),
        amount: prep.amount,
        paidAt,
        methodLabel: method ? paymentMethodLabel(method) : null,
        balance: balanceAfter,
        publicUrl: publicInvoiceUrl(baseUrl(req), prep.token),
      });

      res.json({
        success: true,
        preview: true,
        to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        client_name: client.name,
        client_email: client.email,
        invoice_number: prep.inv.invoiceNumber,
        receipt_number: receiptNumber,
        amount: prep.amount,
        balance_after: balanceAfter,
        paid_at: paidAt,
        method,
        method_label: method ? paymentMethodLabel(method) : null,
        note: "O número definitivo do recibo e o PDF anexo são gerados ao registrar o pagamento.",
      });
    } catch (error) {
      next(error);
    }
  },
);

invoicesCrmRouter.post(
  "/api/quote-invoices/:id/receipts",
  requireCrmAuth,
  requireCrmPermission("invoices.record_payment"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const parsed = paymentSchema.safeParse(req.body || {});
      if (!parsed.success) return fail(res, 400, "Dados inválidos");
      const b = parsed.data;
      const paidAt = parseDate(b.paid_at || b.payment_date) || new Date();
      if (paidAt.getTime() > Date.now() + 36 * 3600000) {
        return fail(res, 422, "A data do pagamento não pode ser no futuro.");
      }

      const out = await withTenantTransaction(req.organizationId!, async (tx) => {
        const inv = await tx.quoteInvoice.findFirst({ where: { id }, include: { receipts: true } });
        if (!inv) return { error: "Fatura não encontrada", status: 404 } as const;
        if (inv.status === "void") return { error: "Fatura anulada.", status: 409 } as const;
        if (inv.status === "draft") {
          return {
            error: "Envie a fatura ao cliente antes de registrar o pagamento. Enviar não marca como paga.",
            status: 409,
          } as const;
        }
        const m = computeInvoiceMoney(inv);
        const resolved = resolvePaymentAmount({ mode: b.mode, amount: b.amount, balance: m.balance });
        if (!resolved.ok) return { error: resolved.error, status: 422 } as const;
        const receipt = await recordInvoicePayment(tx, {
          organizationId: req.organizationId!,
          invoiceId: id,
          amount: resolved.amount,
          method: b.payment_method || b.method || null,
          referenceNumber: b.reference_number?.trim() || null,
          notes: b.notes?.trim() || null,
          paidAt,
          actorId: req.user!.id,
          externalPaymentId: b.external_payment_id || null,
          processor: b.processor || null,
        });
        const updated = await syncInvoiceStatus(tx, id);
        return { receipt, invoicePaid: updated.status === "paid" } as const;
      });
      if ("error" in out) return fail(res, out.status ?? 400, out.error!);

      let email: { ok: boolean; to?: string; error?: string } | null = null;
      if (b.send_email) email = await emailReceipt(req, id, out.receipt.id, b.email_to);

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const fresh = await loadDetail(tx, id);
        return detailPayload(tx, fresh!, req);
      });
      const quoteId = data.quote?.id;
      let balance = null;
      if (quoteId) {
        balance = await withTenantTransaction(req.organizationId!, async (tx) => {
          const { getQuoteInvoiceBalance } = await import("../../lib/payments/engine.js");
          return getQuoteInvoiceBalance(tx, quoteId);
        });
      }
      res.status(201).json({
        success: true,
        data: {
          id: out.receipt.id,
          receipt_number: out.receipt.receiptNumber,
          amount: dec(out.receipt.amount),
          paid_at: out.receipt.paidAt,
          method: out.receipt.method,
        },
        invoice_paid: out.invoicePaid,
        invoice: data,
        balance,
        email,
      });
    } catch (error) {
      next(error);
    }
  },
);

invoicesCrmRouter.delete(
  "/api/quote-invoices/:id/receipts/:receiptId",
  requireCrmAuth,
  requireCrmPermission("invoices.record_payment"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const rid = String(req.params.receiptId);
      if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return badId(res);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await removeInvoicePayment(tx, {
          organizationId: req.organizationId!,
          invoiceId: id,
          receiptId: rid,
          actorId: req.user!.id,
        });
        const fresh = await loadDetail(tx, id);
        return detailPayload(tx, fresh!, req);
      });
      res.json({ success: true, invoice: data });
    } catch (error) {
      if (error instanceof Error && /não|cannot|not found/i.test(error.message)) {
        return fail(res, 409, error.message);
      }
      next(error);
    }
  },
);

invoicesCrmRouter.post(
  "/api/invoice-receipts/:receiptId/send",
  requireCrmAuth,
  requireCrmPermission("invoices.record_payment"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rid = String(req.params.receiptId);
      if (!UUID_RE.test(rid)) return badId(res);
      const receipt = await withTenantTransaction(req.organizationId!, (tx) =>
        tx.invoiceReceipt.findFirst({ where: { id: rid }, select: { invoiceId: true } }),
      );
      if (!receipt) return fail(res, 404, "Recibo não encontrado");
      const r = await emailReceipt(req, receipt.invoiceId, rid, req.body?.to);
      if (!r.ok) return fail(res, 503, r.error);
      res.json({ success: true, to: r.to });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// PDFs

invoicesCrmRouter.get(
  "/api/quote-invoices/:id/pdf",
  requireCrmAuth,
  requireCrmPermission("invoices.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return badId(res);
      const inv = await withTenantTransaction(req.organizationId!, (tx) => loadDetail(tx, id));
      if (!inv) return fail(res, 404, "Fatura não encontrada");
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.organizationId! } });
      const buf = await renderInvoicePdf(inv, org);
      const name = String(inv.invoiceNumber || "invoice").replace(/[^\w.-]+/g, "-");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${req.query.download ? "attachment" : "inline"}; filename="${name}.pdf"`,
      );
      res.send(buf);
    } catch (error) {
      next(error);
    }
  },
);

invoicesCrmRouter.get(
  "/api/invoice-receipts/:receiptId/pdf",
  requireCrmAuth,
  requireCrmPermission("invoices.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rid = String(req.params.receiptId);
      if (!UUID_RE.test(rid)) return badId(res);
      const inv = await withTenantTransaction(req.organizationId!, async (tx) => {
        const r = await tx.invoiceReceipt.findFirst({ where: { id: rid }, select: { invoiceId: true } });
        return r ? loadDetail(tx, r.invoiceId) : null;
      });
      if (!inv) return fail(res, 404, "Recibo não encontrado");
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.organizationId! } });
      const input = receiptPdfInput(inv, rid, org);
      if (!input) return fail(res, 404, "Recibo não encontrado");
      const buf = await buildReceiptPdf(input);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${req.query.download ? "attachment" : "inline"}; filename="${input.receiptNumber}.pdf"`,
      );
      res.send(buf);
    } catch (error) {
      next(error);
    }
  },
);
