import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { prisma } from "../prisma.js";
import { recordActivity } from "../activity/record.js";
import { issuePublicAccessToken } from "../quotes/public-token.js";
import { documentAddressLine, documentLicenseLine } from "../settings/organization.js";
import { computeInvoiceMoney, invoiceKindLabel, storedStatusAfterPayments } from "./core.js";
import { quoteInvoiceLines, selectedQuoteServiceLines } from "./job.js";
import { buildInvoicePdf, type DocClient, type DocOrg, type InvoicePdfInput, type ReceiptPdfInput } from "./pdf.js";

const LINK_TTL_DAYS = 365;

const siblingInvoiceSelect = {
  id: true,
  amount: true,
  status: true,
  receipts: { select: { amount: true } },
} as const;

const quoteServiceLineSelect = {
  name: true,
  description: true,
  quantity: true,
  unitPrice: true,
  amount: true,
  isOptional: true,
  isSelected: true,
  sortOrder: true,
} as const;

export const invoiceDetailInclude = {
  quote: {
    select: {
      id: true,
      title: true,
      quoteNumber: true,
      number: true,
      total: true,
      status: true,
      builderId: true,
      leadId: true,
      property: { select: { line1: true, line2: true, city: true, state: true, postalCode: true, label: true } },
      builder: { select: { company: true, firstName: true, lastName: true, email: true, phone: true } },
      invoices: { select: siblingInvoiceSelect },
      lineItems: { select: quoteServiceLineSelect, orderBy: { sortOrder: "asc" as const } },
    },
  },
  workOrder: {
    select: {
      id: true,
      number: true,
      title: true,
      address: true,
      status: true,
      scheduledStart: true,
      builderId: true,
      builder: { select: { company: true, firstName: true, lastName: true, email: true, phone: true } },
      lineItems: { select: { lineTotal: true } },
      invoices: { select: siblingInvoiceSelect },
    },
  },
  customer: { select: { id: true, name: true, email: true, phone: true } },
  lineItems: { orderBy: { sortOrder: "asc" as const } },
  receipts: { orderBy: { paidAt: "asc" as const } },
} satisfies Prisma.QuoteInvoiceInclude;

export type InvoiceDetail = Prisma.QuoteInvoiceGetPayload<{ include: typeof invoiceDetailInclude }>;

export function quoteNumberOf(q: { quoteNumber: string | null; number: number } | null | undefined): string | null {
  if (!q) return null;
  return q.quoteNumber || (q.number != null ? `Q-${q.number}` : null);
}

/** "Job #12" — the job reference printed on job invoices. */
export function jobNumberOf(wo: { number: number | null } | null | undefined): string | null {
  if (!wo) return null;
  return wo.number != null ? `#${wo.number}` : null;
}

/** Project line on documents: quote property/title, or the job title + address. */
export function projectNameOf(inv: Pick<InvoiceDetail, "quote" | "workOrder">): string | null {
  if (inv.quote) return inv.quote.property?.label || inv.quote.title || null;
  if (inv.workOrder) {
    return [inv.workOrder.title, inv.workOrder.address].filter(Boolean).join(" · ") || null;
  }
  return null;
}

export function clientOf(inv: InvoiceDetail): DocClient {
  if (!inv.quote && inv.workOrder) {
    const wo = inv.workOrder;
    const b = wo.builder;
    const builderName = b ? b.company || [b.firstName, b.lastName].filter(Boolean).join(" ").trim() : null;
    // Job billed to the customer when one is set; otherwise to the builder.
    const useBuilder = !inv.customer && Boolean(b);
    return {
      name: (useBuilder ? builderName : inv.customer?.name) || builderName || null,
      email: (useBuilder ? b?.email : inv.customer?.email) || inv.customer?.email || b?.email || null,
      phone: (useBuilder ? b?.phone : inv.customer?.phone) || inv.customer?.phone || b?.phone || null,
      address: wo.address || null,
    };
  }
  const q = inv.quote;
  const builderName = q?.builder
    ? q.builder.company || [q.builder.firstName, q.builder.lastName].filter(Boolean).join(" ").trim()
    : null;
  const isBuilder = Boolean(q?.builderId);
  const p = q?.property;
  const address = p
    ? [[p.line1, p.line2].filter(Boolean).join(", "), [p.city, [p.state, p.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" · ")
    : null;
  return {
    name: (isBuilder ? builderName : inv.customer?.name) || inv.customer?.name || builderName || null,
    email: (isBuilder ? q?.builder?.email : null) || inv.customer?.email || null,
    phone: (isBuilder ? q?.builder?.phone : null) || inv.customer?.phone || null,
    address: address || null,
  };
}

type OrgRow = Awaited<ReturnType<typeof prisma.organization.findUniqueOrThrow>>;

export function docOrgOf(org: OrgRow): DocOrg {
  const o = org as unknown as Record<string, unknown>;
  return {
    name: org.name,
    contact: [org.contactPhone, org.contactEmail].filter(Boolean).join(" · ") || null,
    address: documentAddressLine({
      addressPrivate: o.addressPrivate !== false,
      addressLine1: (o.addressLine1 as string | null) ?? null,
      addressLine2: (o.addressLine2 as string | null) ?? null,
      city: (o.city as string | null) ?? null,
      state: (o.state as string | null) ?? null,
      postalCode: (o.postalCode as string | null) ?? null,
    }),
    license: documentLicenseLine({
      showLicenseOnDocuments: Boolean(o.showLicenseOnDocuments),
      licenseNumber: (o.licenseNumber as string | null) ?? null,
      licenseState: (o.licenseState as string | null) ?? null,
    }),
    logoUrl: (o.logoUrl as string | null) ?? null,
    brandPrimary: (o.primaryColor as string | null) ?? null,
    brandAccent: (o.accentColor as string | null) ?? null,
  };
}

/** Job/contract money position for the client-facing invoice PDF summary. */
export function contractSummaryOf(inv: InvoiceDetail): {
  label: string;
  contractTotal: number;
  thisInvoice: number;
  paidOnContract: number;
  /** Job/contract total minus this invoice amount (balance left after paying this invoice). */
  remainingAfterThisInvoice: number;
} | null {
  const round = (n: number) => Math.round(n * 100) / 100;
  const thisInvoice = round(Number(inv.amount) || 0);
  const siblings =
    (inv.workOrder?.invoices as { id: string; amount: unknown; status: string; receipts?: { amount: unknown }[] }[] | undefined) ||
    (inv.quote?.invoices as { id: string; amount: unknown; status: string; receipts?: { amount: unknown }[] }[] | undefined) ||
    [];
  const live = siblings.filter((i) => i.status !== "void");
  // Always include the current invoice if sibling list is missing it (fresh create).
  const list = live.some((i) => i.id === inv.id)
    ? live
    : [...live, { id: inv.id, amount: inv.amount, status: inv.status, receipts: inv.receipts }];
  const paidOnContract = round(
    list.reduce((s, i) => s + (i.receipts || []).reduce((a, r) => a + (Number(r.amount) || 0), 0), 0),
  );
  const thisPaid = round((inv.receipts || []).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const thisBalance = round(Math.max(0, thisInvoice - thisPaid));

  let contractTotal = 0;
  let label = "Contract total";
  if (inv.workOrder) {
    label = "Job total";
    contractTotal = round((inv.workOrder.lineItems || []).reduce((s, li) => s + (Number(li.lineTotal) || 0), 0));
  } else if (inv.quote) {
    label = "Contract total";
    contractTotal = round(Number(inv.quote.total) || 0);
  }
  if (!(contractTotal > 0)) {
    // Fallback: treat the sum of non-void invoices as the contract when no job/quote total exists.
    contractTotal = round(list.reduce((s, i) => s + (Number(i.amount) || 0), 0));
    if (!(contractTotal > 0)) contractTotal = thisInvoice;
  }
  // Left on the job/contract after the client pays what is still due on this invoice.
  const remainingAfterThisInvoice = round(Math.max(0, contractTotal - paidOnContract - thisBalance));
  return {
    label,
    contractTotal,
    thisInvoice,
    paidOnContract,
    remainingAfterThisInvoice,
  };
}

/**
 * Quote invoices always show contracted services from the quote (never "Less: not due…"
 * balancing rows). Job invoices and invoices without quote services keep stored lines.
 */
export function resolvedInvoiceLines(inv: InvoiceDetail): {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  id?: string;
}[] {
  const stored = inv.lineItems.map((l) => ({
    id: l.id,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    amount: Number(l.amount),
  }));
  const quote = inv.quote;
  if (!quote) return stored;
  const selected = selectedQuoteServiceLines(quote.lineItems || []);
  if (selected.length === 0) return stored;

  const kind = String(inv.invoiceType || "other");
  return quoteInvoiceLines({
    kind,
    label: invoiceKindLabel(kind),
    amount: Number(inv.amount) || 0,
    quote,
    invoicedBefore: 0,
  });
}

/** Sum of contracted service amounts shown on the invoice (Total Services). */
export function servicesTotalOf(inv: InvoiceDetail): number {
  const lines = resolvedInvoiceLines(inv);
  const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  if (sum > 0) return Math.round(sum * 100) / 100;
  return Math.round((Number(inv.quote?.total) || Number(inv.amount) || 0) * 100) / 100;
}

/**
 * Canonical invoice PDF payload — shared by CRM download, e-mail attachment, and public link.
 * `publicUrl` is intentionally omitted so all three surfaces render identical bytes.
 */
export function invoicePdfInput(inv: InvoiceDetail, org: OrgRow, _publicUrl?: string | null): InvoicePdfInput {
  const m = computeInvoiceMoney(inv);
  const summary = contractSummaryOf(inv);
  const servicesTotal = servicesTotalOf(inv);
  return {
    org: docOrgOf(org),
    client: clientOf(inv),
    invoiceNumber: inv.invoiceNumber || "Invoice",
    kindLabel: invoiceKindLabel(inv.invoiceType),
    quoteNumber: quoteNumberOf(inv.quote),
    jobNumber: jobNumberOf(inv.workOrder),
    projectName: projectNameOf(inv),
    issueDate: inv.issuedAt || inv.createdAt,
    dueDate: inv.dueDate,
    lines: resolvedInvoiceLines(inv).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
    })),
    total: m.amount,
    servicesTotal,
    payments: inv.receipts.map((r) => ({
      receiptNumber: r.receiptNumber,
      paidAt: r.paidAt,
      method: r.method,
      reference: r.referenceNumber,
      amount: Number(r.amount),
    })),
    paid: m.paid,
    balance: m.balance,
    displayStatus: m.displayStatus,
    paidAt: inv.paidAt,
    paymentInstructions: inv.paymentInstructions || org.paymentInstructions,
    notes: inv.notes,
    publicUrl: null,
    contractTotal: summary?.contractTotal ?? null,
    contractTotalLabel: summary?.label ?? null,
    thisInvoiceAmount: summary?.thisInvoice ?? m.amount,
    paidOnContract: summary?.paidOnContract ?? m.paid,
    remainingAfterThisInvoice: summary?.remainingAfterThisInvoice ?? Math.max(0, Math.round(((summary?.contractTotal ?? m.amount) - m.amount) * 100) / 100),
  };
}

/** Same PDF buffer for CRM, e-mail, and `/public/invoices/:token/pdf`. */
export async function renderInvoicePdf(inv: InvoiceDetail, org: OrgRow): Promise<Buffer> {
  return buildInvoicePdf(invoicePdfInput(inv, org));
}

export function receiptPdfInput(
  inv: InvoiceDetail,
  receiptId: string,
  org: OrgRow,
): ReceiptPdfInput | null {
  const r = inv.receipts.find((x) => x.id === receiptId);
  if (!r) return null;
  // Balance as of this receipt (payments up to and including it, in date order).
  const idx = inv.receipts.findIndex((x) => x.id === receiptId);
  const upTo = inv.receipts.slice(0, idx + 1);
  const m = computeInvoiceMoney({ ...inv, receipts: upTo });
  return {
    org: docOrgOf(org),
    client: clientOf(inv),
    receiptNumber: r.receiptNumber || `RCT-${r.id.slice(0, 6).toUpperCase()}`,
    paidAt: r.paidAt,
    amount: Number(r.amount),
    method: r.method,
    reference: r.referenceNumber,
    notes: r.notes,
    invoiceNumber: inv.invoiceNumber || "Invoice",
    invoiceTotal: m.amount,
    paidToDate: m.paid,
    balance: m.balance,
    projectName: projectNameOf(inv),
  };
}

/**
 * Stable public link: reuse the stored raw token while it is valid, so re-sending an invoice or a
 * receipt never breaks the link the client already has.
 */
export async function ensureInvoicePublicToken(
  tx: TenantPrisma,
  organizationId: string,
  invoiceId: string,
): Promise<string> {
  const inv = await tx.quoteInvoice.findFirst({
    where: { id: invoiceId },
    select: { id: true, publicToken: true, publicTokenExpiresAt: true },
  });
  if (!inv) throw new Error("Invoice not found");
  const soon = Date.now() + 7 * 86400000;
  if (inv.publicToken && inv.publicTokenExpiresAt && inv.publicTokenExpiresAt.getTime() > soon) {
    return inv.publicToken;
  }
  const issued = await issuePublicAccessToken(tx, {
    organizationId,
    entityType: "invoice",
    entityId: inv.id,
    ttlDays: LINK_TTL_DAYS,
  });
  await tx.quoteInvoice.update({
    where: { id: inv.id },
    data: { publicToken: issued.rawToken, publicTokenExpiresAt: issued.expiresAt },
  });
  return issued.rawToken;
}

export function publicInvoiceUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, "")}/public/invoices/${encodeURIComponent(token)}`;
}

/** Recompute stored status/paidAt from the receipts currently on the invoice. */
export async function syncInvoiceStatus(tx: TenantPrisma, invoiceId: string) {
  const inv = await tx.quoteInvoice.findFirst({ where: { id: invoiceId }, include: { receipts: true } });
  if (!inv) throw new Error("Invoice not found");
  const paidTotal = inv.receipts.reduce((s, r) => s + Number(r.amount), 0);
  const status = storedStatusAfterPayments({ currentStatus: inv.status, amount: inv.amount, paidTotal });
  const lastPaid = inv.receipts.reduce<Date | null>((d, r) => (!d || r.paidAt > d ? r.paidAt : d), null);
  return tx.quoteInvoice.update({
    where: { id: inv.id },
    data: {
      status,
      paidAt: status === "paid" ? lastPaid ?? new Date() : null,
    },
  });
}

/** Delete a manual payment (Invoice2go "remove payment") and put the invoice back in the right status. */
export async function removeInvoicePayment(
  tx: TenantPrisma,
  params: { organizationId: string; invoiceId: string; receiptId: string; actorId: string | null },
) {
  const receipt = await tx.invoiceReceipt.findFirst({
    where: { id: params.receiptId, invoiceId: params.invoiceId },
  });
  if (!receipt) throw new Error("Pagamento não encontrado");
  if (receipt.externalPaymentId) {
    throw new Error("Pagamentos online não podem ser removidos aqui — faça o estorno no processador.");
  }
  await tx.invoiceReceipt.delete({ where: { id: receipt.id } });
  const updated = await syncInvoiceStatus(tx, params.invoiceId);
  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "invoice",
    entityId: params.invoiceId,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId,
    action: "payment_removed",
    changes: {
      receipt: { from: receipt.receiptNumber, to: null },
      amount: { from: Number(receipt.amount), to: null },
    },
  });
  return updated;
}

/** Sum of non-void invoices for a quote. */
export async function invoicedTotalForQuote(tx: TenantPrisma, quoteId: string, excludeInvoiceId?: string) {
  const agg = await tx.quoteInvoice.aggregate({
    where: {
      quoteId,
      status: { not: "void" },
      ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
    },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

export function isApprovedQuoteStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "approved" || s === "accepted" || s === "invoiced" || s === "converted";
}
