/**
 * Clone a quote with a discount applied, leaving the source quote untouched.
 * Used when sharing a coupon / discounted offer via SMS or email.
 */
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { calculateQuoteTotals } from "./totals.js";
import { issuePublicAccessToken } from "./public-token.js";
import {
  computeNextQuoteNumber,
  defaultValidUntil,
  formatQuoteNumber,
} from "../settings/quotes.js";

export type DiscountKind = "percent" | "fixed";

export type DiscountedCopyResult = {
  quoteId: string;
  quoteNumber: string | null;
  sourceQuoteId: string;
  discountType: DiscountKind;
  discountValue: number;
  total: number;
  publicRawToken: string;
};

type QuoteWithLines = Prisma.QuoteGetPayload<{ include: { lineItems: true } }>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isCouponCopyPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  return p.coupon_copy === true || p.discounted_copy === true;
}

/** Prefer the latest open quote that is not itself a discounted share copy. */
export function pickSourceQuoteForDiscount<T extends { status: string; payload: unknown; updatedAt: Date }>(
  quotes: T[],
  openStatuses: Set<string>,
  normalizeStatus: (s: string) => string,
): T | null {
  const open = quotes.filter((q) => openStatuses.has(normalizeStatus(q.status)));
  const original = open.find((q) => !isCouponCopyPayload(q.payload));
  return original || open[0] || null;
}

function computeDiscountedTotals(src: QuoteWithLines, discountType: DiscountKind, discountValue: number) {
  const lines = (src.lineItems || []).map((li) => ({
    quantity: Number(li.quantity) || 0,
    unitPrice: Number(li.unitPrice) || 0,
    unitCost: Number(li.unitCost) || 0,
    amount: Number(li.amount) || undefined,
    isOptional: li.isOptional,
    isSelected: li.isSelected,
    optionGroupId: li.optionGroupId,
  }));

  if (lines.length) {
    return calculateQuoteTotals({
      lines,
      selectedOptionGroupId: src.selectedOptionGroupId,
      discountType,
      discountValue,
      taxRate: Number(src.taxRate) || 0,
    });
  }

  const sub = Number(src.subtotal) || 0;
  const discountAmount =
    discountType === "percent"
      ? round2(sub * (discountValue / 100))
      : round2(Math.min(discountValue, sub));
  const after = Math.max(0, round2(sub - discountAmount));
  const taxRate = Number(src.taxRate) || 0;
  const taxTotal =
    taxRate > 0 ? round2(after * (taxRate / 100)) : Number(src.taxTotal) || 0;
  return {
    subtotal: sub,
    discountAmount,
    taxTotal,
    total: round2(after + taxTotal),
  };
}

export async function createDiscountedQuoteCopy(
  tx: TenantPrisma,
  opts: {
    organizationId: string;
    sourceQuoteId: string;
    discountType: DiscountKind;
    discountValue: number;
    actorUserId?: string | null;
    titleSuffix?: string;
    quoteNumberPrefix?: string | null;
    quoteNextNumber?: number | null;
    quoteValidityDays?: number | null;
    markSent?: boolean;
  },
): Promise<DiscountedCopyResult | null> {
  const percentOrFixed = Math.max(0, Number(opts.discountValue) || 0);
  if (!(percentOrFixed > 0)) return null;

  const src = await tx.quote.findFirst({
    where: { id: opts.sourceQuoteId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!src) return null;

  const discountType: DiscountKind = opts.discountType === "fixed" ? "fixed" : "percent";
  const discountValue =
    discountType === "percent" ? Math.min(100, percentOrFixed) : percentOrFixed;
  const totals = computeDiscountedTotals(src, discountType, discountValue);

  const last = await tx.quote.findFirst({
    where: { organizationId: opts.organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const number = computeNextQuoteNumber(last?.number, opts.quoteNextNumber);
  const quoteNumber = formatQuoteNumber(opts.quoteNumberPrefix, number);

  const srcPayload =
    src.payload && typeof src.payload === "object" && !Array.isArray(src.payload)
      ? { ...(src.payload as Record<string, unknown>) }
      : {};
  delete srcPayload.sent_at;
  delete srcPayload.email_sent_at;
  const payload: Record<string, unknown> = {
    ...srcPayload,
    discounted_copy: true,
    coupon_copy: true,
    discounted_from: src.id,
    discount_type: discountType === "percent" ? "percentage" : "fixed",
    discount_value: discountValue,
  };

  const suffix = opts.titleSuffix != null ? String(opts.titleSuffix) : " (desconto)";
  const baseTitle = String(src.title || "Quote").replace(/\s*\(desconto\)\s*$/i, "").trim();
  const status = opts.markSent ? "sent" : "draft";
  if (opts.markSent) {
    payload.sent_at = new Date().toISOString();
  }

  const created = await tx.quote.create({
    data: {
      organizationId: opts.organizationId,
      number,
      quoteNumber,
      title: `${baseTitle}${suffix}`,
      status,
      flooringType: src.flooringType,
      areaSqft: src.areaSqft,
      wastePercent: src.wastePercent,
      materialCost: src.materialCost,
      laborCost: src.laborCost,
      materialMarkup: src.materialMarkup,
      laborMarkup: src.laborMarkup,
      discountType,
      discountValue: new Prisma.Decimal(discountValue),
      taxRate: src.taxRate,
      taxTotal: new Prisma.Decimal(totals.taxTotal),
      subtotal: new Prisma.Decimal(totals.subtotal),
      total: new Prisma.Decimal(totals.total),
      notes: src.notes,
      terms: src.terms,
      clientMessage: src.clientMessage,
      clientView: src.clientView ?? undefined,
      serviceType: src.serviceType,
      customerId: src.customerId,
      propertyId: src.propertyId,
      salespersonId: opts.actorUserId || src.salespersonId,
      leadId: src.leadId,
      builderId: src.builderId,
      selectedOptionGroupId: src.selectedOptionGroupId,
      validUntil: defaultValidUntil(opts.quoteValidityDays ?? 30),
      publicToken: randomBytes(16).toString("hex"),
      payload: payload as Prisma.InputJsonValue,
      lineItems: {
        create: (src.lineItems || []).map((li) => ({
          organizationId: opts.organizationId,
          name: li.name ?? undefined,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          unitCost: li.unitCost,
          unitPrice: li.unitPrice,
          amount: li.amount,
          isOptional: li.isOptional,
          isSelected: li.isSelected,
          itemType: li.itemType,
          sortOrder: li.sortOrder,
          productId: li.productId,
          catalogId: li.catalogId,
          meta: li.meta ?? undefined,
          roomId: null,
          optionGroupId: null,
        })),
      },
    },
    select: { id: true, quoteNumber: true, total: true },
  });

  const issued = await issuePublicAccessToken(tx, {
    organizationId: opts.organizationId,
    entityType: "quote",
    entityId: created.id,
  });

  return {
    quoteId: created.id,
    quoteNumber: created.quoteNumber,
    sourceQuoteId: src.id,
    discountType,
    discountValue,
    total: Number(created.total),
    publicRawToken: issued.rawToken,
  };
}
