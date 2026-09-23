import { calculateQuote, toDecimal } from "./calculate.js";

export type TotalsLineInput = {
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  amount?: number;
  isOptional?: boolean;
  isSelected?: boolean;
  optionGroupId?: string | null;
  roomId?: string | null;
};

export type TotalsInput = {
  lines: TotalsLineInput[];
  /** When set, only lines in this group (or with no group) count */
  selectedOptionGroupId?: string | null;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number;
  taxRate?: number;
};

export type TotalsResult = {
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  total: number;
  materialCost: number;
  laborCost: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function lineAmount(line: TotalsLineInput): number {
  if (line.amount != null && Number.isFinite(line.amount)) return round2(line.amount);
  return round2(line.quantity * line.unitPrice);
}

/**
 * Server-authoritative quote totals from selected optionals + chosen option group.
 */
export function calculateQuoteTotals(input: TotalsInput): TotalsResult {
  const selectedGroup = input.selectedOptionGroupId ?? null;
  const included = input.lines.filter((line) => {
    if (line.isOptional && line.isSelected === false) return false;
    if (line.optionGroupId) {
      if (!selectedGroup) return false;
      return line.optionGroupId === selectedGroup;
    }
    return true;
  });

  let subtotal = 0;
  let materialCost = 0;
  for (const line of included) {
    subtotal += lineAmount(line);
    materialCost += round2((line.unitCost ?? 0) * line.quantity);
  }
  subtotal = round2(subtotal);
  materialCost = round2(materialCost);

  const discountValue = input.discountValue ?? 0;
  let discountAmount = 0;
  if (input.discountType === "percent") {
    discountAmount = round2(subtotal * (discountValue / 100));
  } else if (input.discountType === "fixed") {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }

  const afterDiscount = round2(Math.max(0, subtotal - discountAmount));
  const taxRate = input.taxRate ?? 0;
  const taxTotal = round2(afterDiscount * (taxRate / 100));
  const total = round2(afterDiscount + taxTotal);

  return {
    subtotal,
    discountAmount,
    taxTotal,
    total,
    materialCost,
    laborCost: 0,
  };
}

export type RoomEstimateInput = {
  rooms: { areaSqft: number }[];
  wastePercent: number;
  pricePerSqft: number;
  laborPerSqft: number;
  materialMarkup: number;
  laborMarkup: number;
};

/** Sum per-room estimate engine results (same rules as total-area mode). */
export function calculateRoomsEstimate(input: RoomEstimateInput) {
  const results = input.rooms.map((room) =>
    calculateQuote({
      areaSqft: room.areaSqft,
      wastePercent: input.wastePercent,
      pricePerSqft: input.pricePerSqft,
      laborPerSqft: input.laborPerSqft,
      materialMarkup: input.materialMarkup,
      laborMarkup: input.laborMarkup,
    }),
  );
  const sum = (key: keyof (typeof results)[0]) =>
    round2(results.reduce((s, r) => s + Number(r[key]), 0));
  return {
    billableArea: sum("billableArea"),
    materialCost: sum("materialCost"),
    laborCost: sum("laborCost"),
    materialWithMarkup: sum("materialWithMarkup"),
    laborWithMarkup: sum("laborWithMarkup"),
    subtotal: sum("subtotal"),
    total: sum("total"),
    rooms: results,
  };
}

export { toDecimal, calculateQuote };
