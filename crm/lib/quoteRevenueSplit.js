/**
 * Classificação de linhas do orçamento (quote_items) alinhada ao PDF / e-mail do quote:
 * Supply, Installation, Sand & Finishing; produtos → supply.
 */

/** @param {Record<string, unknown>} row */
export function quoteItemServiceCategory(row) {
  if (String(row.item_type || '').toLowerCase() === 'product') return 'supply';
  const st = String(row.service_type || '').trim();
  if (!st) return 'installation';
  const lower = st.toLowerCase();
  if (lower === 'supply') return 'supply';
  if (lower.includes('sand') || lower.includes('finishing')) return 'sand_finish';
  return 'installation';
}

function lineAmount(row) {
  const tp = row.total_price != null ? Number(row.total_price) : NaN;
  if (Number.isFinite(tp) && tp !== 0) return tp;
  const q = Number(row.quantity ?? row.area_sqft) || 0;
  const r = Number(row.unit_price) || 0;
  return q * r;
}

/**
 * Soma receita por serviço a partir das linhas persistidas em `quote_items`.
 * @param {Record<string, unknown>[]|null|undefined} rows
 * @returns {{ revSupply: number, revInst: number, revSand: number, lineTotal: number }}
 */
export function sumQuoteItemsRevenueByCategory(rows) {
  let revSupply = 0;
  let revInst = 0;
  let revSand = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const amt = lineAmount(row);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const cat = quoteItemServiceCategory(row);
    if (cat === 'supply') revSupply += amt;
    else if (cat === 'sand_finish') revSand += amt;
    else revInst += amt;
  }
  return {
    revSupply,
    revInst,
    revSand,
    lineTotal: revSupply + revInst + revSand,
  };
}
