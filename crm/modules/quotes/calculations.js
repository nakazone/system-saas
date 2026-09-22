/**
 * Quote totals — flooring CRM (Senior Floors).
 * total = subtotal - discountAmount + tax_total (tax_total is a stored $ amount on the quote).
 */

export function lineAmount(quantity, rate) {
  const q = Number(quantity) || 0;
  const r = Number(rate) || 0;
  return Math.round(q * r * 100) / 100;
}

export function sumItems(items) {
  if (!Array.isArray(items)) return 0;
  let s = 0;
  for (const it of items) {
    const amt =
      it.amount != null
        ? Number(it.amount)
        : lineAmount(it.quantity ?? it.qty, it.rate ?? it.unit_price);
    s += Number.isFinite(amt) ? amt : 0;
  }
  return Math.round(s * 100) / 100;
}

export function discountAmount(subtotal, discountType, discountValue) {
  const sub = Number(subtotal) || 0;
  const d = Number(discountValue) || 0;
  if (sub <= 0) return 0;
  if (discountType === 'fixed') {
    return Math.min(Math.max(0, d), sub);
  }
  return Math.min(sub * (Math.max(0, d) / 100), sub);
}

export function computeTotal(subtotal, discountType, discountValue, taxTotal) {
  const sub = Number(subtotal) || 0;
  const disc = discountAmount(sub, discountType, discountValue);
  const tax = Number(taxTotal) || 0;
  return Math.max(0, Math.round((sub - disc + tax) * 100) / 100);
}

export function normalizeItem(row) {
  const quantity = Number(row.quantity) || 0;
  const rate = Number(row.rate ?? row.unit_price) || 0;
  const amount =
    row.amount != null && row.amount !== ''
      ? Number(row.amount)
      : lineAmount(quantity, rate);
  return {
    ...row,
    quantity,
    rate,
    unit_price: rate,
    total_price: Math.round(amount * 100) / 100,
    amount: Math.round(amount * 100) / 100,
  };
}
