/**
 * Jobs (ordens de serviço) billed straight from the job's service lines — the Builder /
 * Contractor / Loja flow, where prices come from the Tabela de Valores and no quote is sent.
 *
 * The invoice reuses the Faturas module (QuoteInvoice with quoteId = null, workOrderId set),
 * so payments, receipts, PDF, e-mail and the client link work exactly like quote invoices.
 */
import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { recordActivity } from "../activity/record.js";
import { nextInvoiceNumber, seedDefaultPaymentTemplates } from "../payments/engine.js";
import { computeNewInvoiceAmount } from "./core.js";
import { stripLockbox } from "../../modules/work-orders/public-ticket.js";

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);
const money = (c: number) => Math.round(c) / 100;

export type JobBillingStatus =
  | "no_value"
  | "to_invoice"
  | "partially_invoiced"
  | "awaiting_payment"
  | "paid";

export type JobBilling = {
  services_total: number;
  invoiced_total: number;
  paid_total: number;
  remaining_to_invoice: number;
  open_balance: number;
  invoice_count: number;
  billing_status: JobBillingStatus;
};

type BillingInvoice = {
  amount: unknown;
  status: string;
  receipts?: { amount: unknown }[];
};

/** Money position of a job: what its services are worth, what was invoiced and what came in. */
export function jobBilling(servicesTotal: number, invoices: BillingInvoice[]): JobBilling {
  const live = invoices.filter((i) => i.status !== "void");
  const totalC = cents(servicesTotal);
  const invoicedC = live.reduce((s, i) => s + cents(i.amount), 0);
  const paidC = live.reduce((s, i) => s + (i.receipts || []).reduce((a, r) => a + cents(r.amount), 0), 0);
  const remainingC = Math.max(0, totalC - invoicedC);
  const openC = Math.max(0, invoicedC - paidC);
  let status: JobBillingStatus;
  if (invoicedC <= 0) status = totalC > 0 ? "to_invoice" : "no_value";
  else if (remainingC > 0) status = "partially_invoiced";
  else if (openC > 0) status = "awaiting_payment";
  else status = "paid";
  return {
    services_total: money(totalC),
    invoiced_total: money(invoicedC),
    paid_total: money(paidC),
    remaining_to_invoice: money(remainingC),
    open_balance: money(openC),
    invoice_count: live.length,
    billing_status: status,
  };
}

export function jobBillingLabel(status: JobBillingStatus): string {
  const map: Record<JobBillingStatus, string> = {
    no_value: "Sem valor",
    to_invoice: "A faturar",
    partially_invoiced: "Faturado parcial",
    awaiting_payment: "Aguardando pagamento",
    paid: "Pago",
  };
  return map[status];
}

export function jobRef(job: { number: number | null; title: string }): string {
  return job.number != null ? `Job #${job.number} · ${job.title}` : job.title;
}

type JobLine = {
  serviceName: string;
  notes?: string | null;
  quantitySqft: unknown;
  unitPrice: unknown;
  lineTotal: unknown;
};

export type InvoiceLineDraft = { description: string; quantity: number; unitPrice: number; amount: number };

/** Quote "Nota / referência" stored in payload.job_name (also mirrored to quote.title). */
export function quoteReferenceNoteOf(quote: { payload?: unknown } | null | undefined): string | null {
  if (!quote) return null;
  const payload =
    quote.payload && typeof quote.payload === "object" && !Array.isArray(quote.payload)
      ? (quote.payload as Record<string, unknown>)
      : null;
  const fromPayload = payload?.job_name != null ? String(payload.job_name).trim() : "";
  if (fromPayload) return fromPayload.slice(0, 4000);
  return null;
}

function invoiceLineDescription(li: JobLine): string {
  const name = String(li.serviceName || "Serviço").trim() || "Serviço";
  const note = String(li.notes || "").trim();
  if (!note) return name;
  // Newline: invoice UI + PDF render the second line as a description under the service.
  const combined = `${name}\n${note}`;
  return combined.length > 500 ? combined.slice(0, 497) + "…" : combined;
}

/**
 * Invoice lines for a job invoice. When the invoice closes the job (full / final), the client
 * sees every service with quantity and table price; a final after earlier invoices subtracts
 * what was already billed. Deposits and custom amounts are a single line pointing at the job.
 */
function balanceInvoiceLines(
  lines: InvoiceLineDraft[],
  amount: number,
  invoicedBefore: number,
): InvoiceLineDraft[] {
  const out = [...lines];
  if (cents(invoicedBefore) > 0) {
    const less = -money(cents(invoicedBefore));
    out.push({ description: "Less: previously invoiced", quantity: 1, unitPrice: less, amount: less });
  }
  // Rounding / partial-billing guard: lines must add up to the invoice amount.
  const sumC = out.reduce((s, l) => s + cents(l.amount), 0);
  const diffC = cents(amount) - sumC;
  if (diffC !== 0) {
    const adj = money(diffC);
    const description =
      diffC < 0 && cents(invoicedBefore) === 0
        ? "Less: not due on this invoice"
        : "Adjustment";
    out.push({ description, quantity: 1, unitPrice: adj, amount: adj });
  }
  return out;
}

export function jobInvoiceLines(params: {
  kind: string;
  label: string;
  amount: number;
  job: { number: number | null; title: string; lineItems: JobLine[] };
  invoicedBefore: number;
}): InvoiceLineDraft[] {
  const { kind, label, amount, job, invoicedBefore } = params;
  const ref = jobRef(job);
  const itemize = (kind === "full" || kind === "final") && job.lineItems.length > 0;
  if (!itemize) {
    return [{ description: `${label} — ${ref}`, quantity: 1, unitPrice: amount, amount }];
  }
  const lines: InvoiceLineDraft[] = job.lineItems.map((li) => ({
    description: invoiceLineDescription(li),
    quantity: Number(li.quantitySqft) || 0,
    unitPrice: Number(li.unitPrice) || 0,
    amount: money(cents(li.lineTotal)),
  }));
  return balanceInvoiceLines(lines, amount, invoicedBefore);
}

type QuoteServiceLine = {
  name?: string | null;
  description: string;
  quantity: unknown;
  unitPrice: unknown;
  amount: unknown;
  isOptional?: boolean;
  isSelected?: boolean;
  meta?: unknown;
};

function quoteLineNote(li: QuoteServiceLine): string {
  const meta =
    li.meta && typeof li.meta === "object" && !Array.isArray(li.meta)
      ? (li.meta as Record<string, unknown>)
      : {};
  return meta.notes != null ? String(meta.notes).trim() : "";
}

function quoteServiceDescription(li: QuoteServiceLine): string {
  const name = String(li.name || "").trim();
  let body = String(li.description || "").trim();
  if (name && body) {
    if (body === name) body = "";
    else if (body.toLowerCase().startsWith(name.toLowerCase())) {
      body = body.slice(name.length).replace(/^[\s\n\u2014\u2013:·.\-]+/, "").trim();
    }
  }
  const note = quoteLineNote(li);
  // Service name is always the headline; description + line note sit underneath.
  const headline = name || body || "Serviço";
  const under: string[] = [];
  if (name && body && body !== name) under.push(body);
  if (note && note !== headline && note !== body) under.push(note);
  if (!under.length) return headline.slice(0, 500);
  const combined = `${headline}\n${under.join("\n")}`;
  return combined.length > 500 ? combined.slice(0, 497) + "…" : combined;
}

/** Selected quote services that belong on a client-facing invoice (mirrors Quote PDF). */
export function selectedQuoteServiceLines(lineItems: QuoteServiceLine[]): QuoteServiceLine[] {
  return (lineItems || []).filter((li) => !li.isOptional || li.isSelected);
}

/**
 * Invoice lines for a quote invoice: every contracted service (same selection as the Quote PDF).
 * Partial invoices do not add "Less: …" rows — Total Services vs Balance Due on this invoice
 * is shown in the totals block instead.
 */
export function quoteInvoiceLines(params: {
  kind: string;
  label: string;
  amount: number;
  quote: {
    title: string;
    quoteNumber?: string | null;
    number?: number | null;
    lineItems: QuoteServiceLine[];
  };
  invoicedBefore: number;
}): InvoiceLineDraft[] {
  const { label, amount, quote } = params;
  const quoteNo = quote.quoteNumber || (quote.number != null ? `Q-${quote.number}` : null);
  // Do not embed quote.title / job_name in the line — that reference belongs in invoice notes.
  const ref = quoteNo ? `Quote ${quoteNo}` : "Quote";
  const selected = selectedQuoteServiceLines(quote.lineItems);
  if (selected.length === 0) {
    return [{ description: `${label} — ${ref}`, quantity: 1, unitPrice: amount, amount }];
  }
  return selected.map((li) => ({
    description: quoteServiceDescription(li),
    quantity: Number(li.quantity) || 0,
    unitPrice: Number(li.unitPrice) || 0,
    amount: money(cents(li.amount)),
  }));
}

export type CreateJobInvoiceInput = {
  organizationId: string;
  workOrderId: string;
  actorId: string;
  kind: string;
  depositPct?: number | null;
  customAmount?: number | null;
  dueDate?: Date | null;
  notes?: string | null;
  paymentInstructions?: string | null;
};

export type CreateJobInvoiceResult =
  | { ok: true; invoice: { id: string; invoiceNumber: string | null; invoiceType: string; status: string; amount: number; dueDate: Date | null }; billing: JobBilling }
  | { ok: false; status: number; error: string };

export async function createJobInvoice(tx: TenantPrisma, input: CreateJobInvoiceInput): Promise<CreateJobInvoiceResult> {
  const job = await tx.workOrder.findFirst({
    where: { id: input.workOrderId },
    include: {
      lineItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      invoices: { select: { amount: true, status: true, receipts: { select: { amount: true } } } },
      organization: { select: { paymentInstructions: true } },
    },
  });
  if (!job) return { ok: false, status: 404, error: "Job não encontrado" };
  if (job.status === "canceled") return { ok: false, status: 409, error: "Job cancelado não pode ser faturado." };
  if (!job.customerId && !job.builderId) {
    return { ok: false, status: 422, error: "Escolha o cliente ou o builder do job antes de faturar." };
  }

  const servicesTotal = job.lineItems.reduce((s, li) => s + Number(li.lineTotal), 0);
  const before = jobBilling(servicesTotal, job.invoices);
  const calc = computeNewInvoiceAmount({
    kind: input.kind,
    quoteTotal: servicesTotal,
    invoicedTotal: before.invoiced_total,
    depositPct: input.depositPct,
    customAmount: input.customAmount,
    source: "job",
  });
  if (!calc.ok) return { ok: false, status: 422, error: calc.error };

  await seedDefaultPaymentTemplates(tx, input.organizationId);
  const invoiceNumber = await nextInvoiceNumber(tx, input.organizationId);
  const amount = new Prisma.Decimal(calc.amount.toFixed(2));
  const jobNotesForInvoice = stripLockbox(job.notes).slice(0, 4000) || null;
  const inv = await tx.quoteInvoice.create({
    data: {
      organizationId: input.organizationId,
      quoteId: null,
      workOrderId: job.id,
      customerId: job.customerId,
      invoiceNumber,
      invoiceType: calc.kind,
      status: "draft",
      amount,
      dueDate: input.dueDate || new Date(Date.now() + 1 * 86400000),
      notes: input.notes?.trim() || jobNotesForInvoice,
      paymentInstructions: input.paymentInstructions?.trim() || job.organization.paymentInstructions || null,
    },
  });
  const lines = jobInvoiceLines({
    kind: calc.kind,
    label: calc.label,
    amount: calc.amount,
    job,
    invoicedBefore: before.invoiced_total,
  });
  await tx.invoiceLineItem.createMany({
    data: lines.map((l, i) => ({
      organizationId: input.organizationId,
      invoiceId: inv.id,
      description: l.description.slice(0, 500),
      quantity: new Prisma.Decimal(l.quantity.toFixed(2)),
      unitPrice: new Prisma.Decimal(l.unitPrice.toFixed(2)),
      amount: new Prisma.Decimal(l.amount.toFixed(2)),
      sortOrder: i + 1,
    })),
  });
  await recordActivity(tx, {
    organizationId: input.organizationId,
    entityType: "invoice",
    entityId: inv.id,
    actorType: "user",
    actorId: input.actorId,
    action: "created",
    changes: {
      job: { from: null, to: job.number != null ? `#${job.number}` : job.id },
      amount: { from: null, to: calc.amount },
      type: { from: null, to: calc.kind },
    },
  });
  await recordActivity(tx, {
    organizationId: input.organizationId,
    entityType: "work_order",
    entityId: job.id,
    actorType: "user",
    actorId: input.actorId,
    action: "job_invoice.created",
    changes: { invoice: { from: null, to: invoiceNumber } },
  });

  const billing = jobBilling(servicesTotal, [...job.invoices, { amount: calc.amount, status: "draft", receipts: [] }]);
  return {
    ok: true,
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceType: inv.invoiceType,
      status: inv.status,
      amount: calc.amount,
      dueDate: inv.dueDate,
    },
    billing,
  };
}

/** Sum of non-void invoices for a job. */
export async function invoicedTotalForJob(tx: TenantPrisma, workOrderId: string, excludeInvoiceId?: string) {
  const agg = await tx.quoteInvoice.aggregate({
    where: {
      workOrderId,
      status: { not: "void" },
      ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
    },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}
