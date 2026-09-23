import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import { transitionQuote, type QuoteEvent } from "../../lib/quotes/transitions.js";
import { calculateQuoteTotals, calculateRoomsEstimate, toDecimal } from "../../lib/quotes/totals.js";
import { DEFAULT_CLIENT_VIEW } from "../../lib/tenant/defaults.js";

export const quoteDetailInclude = {
  customer: true,
  property: true,
  salesperson: true,
  rooms: { orderBy: { sortOrder: "asc" as const } },
  optionGroups: { orderBy: { sortOrder: "asc" as const } },
  lineItems: { orderBy: { sortOrder: "asc" as const } },
} as const;

export async function applyQuoteTransition(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    event: QuoteEvent;
    actorType: "user" | "customer" | "system";
    actorId?: string | null;
    extraData?: Prisma.QuoteUpdateInput;
    note?: string;
  },
) {
  const quote = await tx.quote.findFirst({ where: { id: params.quoteId } });
  if (!quote) throw new Error("Quote not found");
  const result = transitionQuote(quote.status, params.event);
  if (!result.ok) throw new Error(result.error);

  const updated = await tx.quote.update({
    where: { id: quote.id },
    data: {
      status: result.next,
      ...(params.extraData ?? {}),
    },
  });

  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "quote",
    entityId: quote.id,
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.event === "approve" ? "approved" : "status_changed",
    changes: {
      status: { from: quote.status, to: result.next },
      ...(params.note ? { note: { from: null, to: params.note } } : {}),
    },
  });

  return updated;
}

export function recomputeTotalsFromQuote(quote: {
  selectedOptionGroupId: string | null;
  discountType: string | null;
  discountValue: unknown;
  taxRate: unknown;
  lineItems: Array<{
    quantity: unknown;
    unitPrice: unknown;
    unitCost: unknown;
    amount: unknown;
    isOptional: boolean;
    isSelected: boolean;
    optionGroupId: string | null;
  }>;
}) {
  return calculateQuoteTotals({
    lines: quote.lineItems.map((li) => ({
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice),
      unitCost: Number(li.unitCost),
      amount: Number(li.amount),
      isOptional: li.isOptional,
      isSelected: li.isSelected,
      optionGroupId: li.optionGroupId,
    })),
    selectedOptionGroupId: quote.selectedOptionGroupId,
    discountType: (quote.discountType as "percent" | "fixed" | null) ?? null,
    discountValue: Number(quote.discountValue),
    taxRate: Number(quote.taxRate),
  });
}

export async function persistQuoteTotals(
  tx: TenantPrisma,
  quoteId: string,
  totals: ReturnType<typeof calculateQuoteTotals>,
) {
  return tx.quote.update({
    where: { id: quoteId },
    data: {
      subtotal: toDecimal(totals.subtotal),
      taxTotal: toDecimal(totals.taxTotal),
      total: toDecimal(totals.total),
      materialCost: toDecimal(totals.materialCost),
      laborCost: toDecimal(totals.laborCost),
    },
  });
}

export type BuildRoomLinesInput = {
  organizationId: string;
  quoteId: string;
  rooms: { id: string; name: string; areaSqft: number }[];
  optionGroups: { id: string; flooringType: string | null }[];
  rulesByType: Map<
    string,
    {
      wastePercent: number;
      materialMarkup: number;
      laborMarkup: number;
      defaultPricePerSqft: number;
      defaultLaborPerSqft: number;
    }
  >;
  fallbackFlooringType: string;
};

/**
 * Rebuild material/labor lines per room × option group from estimate rules.
 * Keeps optional add-on lines (isOptional) untouched.
 */
export async function rebuildEstimateLines(tx: TenantPrisma, input: BuildRoomLinesInput) {
  await tx.quoteLineItem.deleteMany({
    where: { quoteId: input.quoteId, isOptional: false },
  });

  let sortOrder = 1;
  for (const group of input.optionGroups) {
    const flooringType = group.flooringType || input.fallbackFlooringType;
    const rule = input.rulesByType.get(flooringType);
    if (!rule) continue;
    const estimate = calculateRoomsEstimate({
      rooms: input.rooms.map((r) => ({ areaSqft: r.areaSqft })),
      wastePercent: rule.wastePercent,
      pricePerSqft: rule.defaultPricePerSqft,
      laborPerSqft: rule.defaultLaborPerSqft,
      materialMarkup: rule.materialMarkup,
      laborMarkup: rule.laborMarkup,
    });

    for (let i = 0; i < input.rooms.length; i++) {
      const room = input.rooms[i]!;
      const roomEst = estimate.rooms[i]!;
      const matUnit = rule.defaultPricePerSqft * (1 + rule.materialMarkup / 100);
      const labUnit = rule.defaultLaborPerSqft * (1 + rule.laborMarkup / 100);
      await tx.quoteLineItem.create({
        data: {
          organizationId: input.organizationId,
          quoteId: input.quoteId,
          roomId: room.id,
          optionGroupId: group.id,
          name: `${flooringType} material`,
          description: `${room.name} — ${flooringType} material`,
          quantity: toDecimal(roomEst.billableArea),
          unit: "sqft",
          unitCost: toDecimal(rule.defaultPricePerSqft),
          unitPrice: toDecimal(matUnit),
          amount: toDecimal(roomEst.materialWithMarkup),
          sortOrder: sortOrder++,
        },
      });
      await tx.quoteLineItem.create({
        data: {
          organizationId: input.organizationId,
          quoteId: input.quoteId,
          roomId: room.id,
          optionGroupId: group.id,
          name: `${flooringType} labor`,
          description: `${room.name} — ${flooringType} labor`,
          quantity: toDecimal(room.areaSqft),
          unit: "sqft",
          unitCost: toDecimal(rule.defaultLaborPerSqft),
          unitPrice: toDecimal(labUnit),
          amount: toDecimal(roomEst.laborWithMarkup),
          sortOrder: sortOrder++,
        },
      });
    }
  }
}

export function defaultValidUntil(validityDays: number, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + validityDays);
  return d;
}

export function defaultClientViewJson(): Prisma.InputJsonValue {
  return { ...DEFAULT_CLIENT_VIEW };
}
