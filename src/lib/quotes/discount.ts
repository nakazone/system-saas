/**
 * Quote discount as stored by the builder (`percentage` | `fixed`) or the DB (`percent` | `fixed`).
 * Older quotes kept the discount only inside `payload`, not on the columns.
 */

export type DiscountKind = "percent" | "fixed";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function normalizeDiscountType(raw: unknown): DiscountKind | null {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "fixed" || t === "amount") return "fixed";
  if (t === "percent" || t === "percentage" || t === "pct") return "percent";
  return null;
}

function payloadOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function readQuoteDiscount(quote: {
  subtotal?: unknown;
  discountType?: string | null;
  discountValue?: unknown;
  payload?: unknown;
}): { type: DiscountKind | null; value: number; amount: number } {
  const payload = payloadOf(quote.payload);
  const colType = normalizeDiscountType(quote.discountType);
  const colValue = Number(quote.discountValue);
  const payloadType = normalizeDiscountType(payload.discount_type ?? payload.discountType);
  const payloadValue = Number(payload.discount_value ?? payload.discountValue);
  const type = colType && colValue > 0 ? colType : payloadType;
  const value = colType && colValue > 0 ? colValue : payloadValue;
  const subtotal = Number(quote.subtotal) || 0;
  if (!type || !(value > 0) || !(subtotal > 0)) {
    return { type: null, value: 0, amount: 0 };
  }
  const amount =
    type === "percent"
      ? round2(Math.min(subtotal, subtotal * (Math.min(value, 100) / 100)))
      : round2(Math.min(value, subtotal));
  return { type, value: type === "percent" ? Math.min(value, 100) : value, amount };
}

/** Columns written by the quote builder save. */
export function discountFieldsFromBody(body: Record<string, unknown>): {
  discountType: DiscountKind | null;
  discountValue: number;
} {
  const type = normalizeDiscountType(body.discount_type ?? body.discountType);
  const value = Number(body.discount_value ?? body.discountValue ?? 0);
  if (!type || !(value > 0)) return { discountType: null, discountValue: 0 };
  return {
    discountType: type,
    discountValue: type === "percent" ? Math.min(100, value) : value,
  };
}

/**
 * What the client owes on the quote: the stored total, or subtotal − discount + tax
 * when the total was left at the pre-discount price.
 */
export function quoteContractTotal(quote: {
  subtotal?: unknown;
  taxTotal?: unknown;
  total?: unknown;
  discountType?: string | null;
  discountValue?: unknown;
  payload?: unknown;
}): number {
  const stored = round2(Number(quote.total) || 0);
  const discount = readQuoteDiscount(quote);
  if (!(discount.amount > 0)) return stored;
  const net = round2(Math.max(0, (Number(quote.subtotal) || 0) - discount.amount) + (Number(quote.taxTotal) || 0));
  if (!(net > 0)) return stored;
  if (!(stored > 0)) return net;
  return Math.min(stored, net);
}

export function discountLineLabel(type: DiscountKind, value: number): string {
  if (type === "percent") {
    const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
    return `Discount (${shown}%)`;
  }
  return "Discount";
}
