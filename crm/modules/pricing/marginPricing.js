/**
 * Pure pricing helpers — margin % as number (35 = 35%), non-negative.
 */

export const DEFAULT_CATEGORY_MARGINS = {
  Hardwood: 35,
  LVP: 25,
  Engineered: 30,
  Accessories: 50,
};

export function sellPriceFromCostAndMarkup(cost, markupPercentage) {
  const c = Number(cost) || 0;
  const m = Math.max(0, Number(markupPercentage) || 0);
  return Math.round(c * (1 + m / 100) * 10000) / 10000;
}

export function markupFromCostAndSell(cost, sell) {
  const c = Number(cost) || 0;
  const s = Number(sell) || 0;
  if (c <= 0) return 0;
  return Math.round(((s - c) / c) * 10000) / 100;
}

export function lineCost(quantity, costPrice) {
  const q = Number(quantity) || 0;
  const c = Number(costPrice) || 0;
  return Math.round(q * c * 100) / 100;
}

export function lineRevenue(quantity, sellPrice) {
  const q = Number(quantity) || 0;
  const s = Number(sellPrice) || 0;
  return Math.round(q * s * 100) / 100;
}

/**
 * @param {Array<{ quantity?: number, cost_price?: number|null, rate?: number, unit_price?: number, item_type?: string }>} items
 */
export function summarizeQuoteProfit(items) {
  let totalCost = 0;
  let totalRevenue = 0;
  for (const it of items || []) {
    const q = Number(it.quantity) || 0;
    const cost = Number(it.cost_price);
    const sell = Number(it.rate ?? it.unit_price ?? it.sell_price) || 0;
    if (it.item_type === 'product' && Number.isFinite(cost) && cost >= 0) {
      totalCost += Math.round(q * cost * 100) / 100;
    }
    totalRevenue += Math.round(q * sell * 100) / 100;
  }
  const grossProfit = Math.round((totalRevenue - totalCost) * 100) / 100;
  const marginPct =
    totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : null;
  return {
    total_cost: totalCost,
    total_revenue: totalRevenue,
    gross_profit: grossProfit,
    margin_percent: marginPct,
  };
}

export function validateMarkup(markupPct) {
  const m = Number(markupPct);
  if (!Number.isFinite(m) || m < 0) return { ok: false, error: 'Margin must be ≥ 0.' };
  const warnings = [];
  if (m < 15) warnings.push('Margin below 15% — confirm with manager.');
  return { ok: true, warnings };
}

export function defaultMarginForCategory(category, tableRow) {
  if (tableRow != null && Number.isFinite(Number(tableRow.margin_percentage))) {
    return Number(tableRow.margin_percentage);
  }
  const c = String(category || '').trim();
  return DEFAULT_CATEGORY_MARGINS[c] ?? 25;
}
