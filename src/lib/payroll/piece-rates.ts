/**
 * Production pay by item (trades with `payroll.pieceItems`, e.g. Tile): the crew counts what they
 * did on each job (floor SF, wall SF, shower pans, niches…) and is paid quantity × rate per item.
 *
 * Rates: the company rate per item (PieceRate.employeeId = null) and, when set, a different rate for
 * one employee. When a day closes, the rates are copied into the day (CampoShift.pieces) and its
 * payroll line, so changing a rate later never changes pay already counted.
 *
 * Hardwood has no piece items and keeps square feet × one production rate.
 */
import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { primaryPack } from "../trades/index.js";
import type { PieceItem } from "../trades/types.js";

export type PieceQty = Record<string, number>;
export type PieceLine = { key: string; label: string; unit: PieceItem["unit"]; qty: number; rate: number; amount: number };
export type RateView = {
  key: string;
  label: string;
  label_en: string;
  unit: PieceItem["unit"];
  counts_sqft: boolean;
  company: number;
  employee: number | null;
  rate: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const UNIT_LABEL: Record<PieceItem["unit"], string> = { sf: "sq ft", lf: "LF", each: "un." };

export function pieceItemsFor(trades: unknown): readonly PieceItem[] {
  return primaryPack(trades).payroll?.pieceItems ?? [];
}

/** Keep only the company's items, with non-negative quantities (2 decimals). Empty items are dropped. */
export function normalizePieces(items: readonly PieceItem[], raw: unknown): PieceQty {
  const out: PieceQty = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const it of items) {
    const q = round2(Math.max(0, num((raw as Record<string, unknown>)[it.key])));
    if (q > 0) out[it.key] = it.unit === "each" ? Math.round(q) : q;
  }
  return out;
}

/** Rate per item for this employee: their own rate when set, else the company rate, else 0. */
export function ratesFor(items: readonly PieceItem[], rows: ReadonlyArray<{ employeeId: string | null; itemKey: string; rate: unknown }>, employeeId: string | null): RateView[] {
  return items.map((it) => {
    const company = rows.find((r) => r.employeeId === null && r.itemKey === it.key);
    const own = employeeId ? rows.find((r) => r.employeeId === employeeId && r.itemKey === it.key) : undefined;
    const c = company ? num(company.rate) : 0;
    const e = own ? num(own.rate) : null;
    return { key: it.key, label: it.label["pt-BR"], label_en: it.label["en-US"], unit: it.unit, counts_sqft: Boolean(it.countsSqft), company: c, employee: e, rate: e ?? c };
  });
}

/**
 * What a day pays: quantities of every job of the day added per item, times the rate.
 * `sqft` = the items that count as square feet (floor, walls, mosaic) — for reports and the SF column.
 */
export function priceDay(items: readonly PieceItem[], rates: readonly RateView[], jobs: ReadonlyArray<{ pieces?: unknown }>) {
  const totals: PieceQty = {};
  for (const j of jobs) {
    const q = normalizePieces(items, j.pieces);
    for (const [k, v] of Object.entries(q)) totals[k] = round2((totals[k] ?? 0) + v);
  }
  const lines: PieceLine[] = items
    .filter((it) => totals[it.key])
    .map((it) => {
      const rate = rates.find((r) => r.key === it.key)?.rate ?? 0;
      const qty = totals[it.key]!;
      return { key: it.key, label: it.label["pt-BR"], unit: it.unit, qty, rate, amount: round2(qty * rate) };
    });
  const sqft = round2(items.filter((it) => it.countsSqft).reduce((s, it) => s + (totals[it.key] ?? 0), 0));
  return { lines, amount: round2(lines.reduce((s, l) => s + l.amount, 0)), sqft };
}

/** Pay from a day's saved lines (rates already copied in). */
export function piecesAmount(raw: unknown): number | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  return round2(raw.reduce((s: number, l: { amount?: unknown; qty?: unknown; rate?: unknown }) => s + (l.amount != null ? num(l.amount) : num(l.qty) * num(l.rate)), 0));
}

/* ───────────────────────────── database ───────────────────────────── */

export async function loadRates(tx: TenantPrisma, items: readonly PieceItem[], employeeId: string | null): Promise<RateView[]> {
  if (!items.length) return [];
  const rows = await tx.pieceRate.findMany({
    where: { itemKey: { in: items.map((i) => i.key) }, OR: [{ employeeId: null }, ...(employeeId ? [{ employeeId }] : [])] },
    select: { employeeId: true, itemKey: true, rate: true },
  });
  return ratesFor(items, rows, employeeId);
}

/**
 * Save rates. Company: `employeeId` null, every item gets a row. Employee: a number sets their own
 * rate for that item, `null` removes it (back to the company rate).
 */
export async function saveRates(
  tx: TenantPrisma,
  organizationId: string,
  items: readonly PieceItem[],
  employeeId: string | null,
  rates: Record<string, number | null>,
): Promise<void> {
  for (const it of items) {
    if (!(it.key in rates)) continue;
    const v = rates[it.key];
    const existing = await tx.pieceRate.findFirst({ where: { employeeId, itemKey: it.key }, select: { id: true } });
    if (v === null || v === undefined) {
      if (employeeId && existing) await tx.pieceRate.delete({ where: { id: existing.id } });
      if (!employeeId && existing) await tx.pieceRate.update({ where: { id: existing.id }, data: { rate: new Prisma.Decimal(0) } });
      continue;
    }
    const rate = new Prisma.Decimal(round2(Math.max(0, num(v))));
    if (existing) await tx.pieceRate.update({ where: { id: existing.id }, data: { rate } });
    else await tx.pieceRate.create({ data: { organizationId, employeeId, itemKey: it.key, rate } });
  }
}
