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

type JobLine = { serviceName: string; quantitySqft: unknown; unitPrice: unknown; lineTotal: unknown };

export type InvoiceLineDraft = { description: string; quantity: number; unitPrice: number; amount: number };

/**
 * Invoice lines for a job invoice. When the invoice closes the job (full / final), the client
 * sees every service with quantity and table price; a final after earlier invoices subtracts
 * what was already billed. Deposits and custom amounts are a single line pointing at the job.
 */
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
    description: li.serviceName,
    quantity: Number(li.quantitySqft) || 0,
    unitPrice: Number(li.unitPrice) || 0,
    amount: money(cents(li.lineTotal)),
  }));
  if (cents(invoicedBefore) > 0) {
    const less = -money(cents(invoicedBefore));
    lines.push({ description: "Less: previously invoiced", quantity: 1, unitPrice: less, amount: less });
  }
  // Rounding guard: the lines must add up to the invoice amount.
  const sumC = lines.reduce((s, l) => s + cents(l.amount), 0);
  const diffC = cents(amount) - sumC;
  if (diffC !== 0) {
    lines.push({ description: "Adjustment", quantity: 1, unitPrice: money(diffC), amount: money(diffC) });
  }
  return lines;
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
      dueDate: input.dueDate || new Date(Date.now() + 14 * 86400000),
      notes: input.notes?.trim() || null,
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
