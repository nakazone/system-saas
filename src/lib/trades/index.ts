/**
 * Trade Pack registry. Code that used to hardcode flooring values asks the registry instead.
 * Phase 0: every organization runs the Hardwood pack, so nothing changes for users.
 */
import type { PackService, PhaseDef, TradeId, TradePack } from "./types.js";
import { TRADE_IDS } from "./types.js";
import { hardwood } from "./packs/hardwood/index.js";

export type { PackService, PackTakeoff, PhaseDef, PhaseDoneField, QuoteSectionDef, TradeId, TradePack } from "./types.js";
export { TRADE_IDS } from "./types.js";

export const DEFAULT_TRADE: TradeId = "hardwood";

const PACKS: Record<TradeId, TradePack> = { hardwood };

export function isTradeId(v: unknown): v is TradeId {
  return typeof v === "string" && (TRADE_IDS as readonly string[]).includes(v);
}

export function getPack(id: TradeId = DEFAULT_TRADE): TradePack {
  return PACKS[id];
}

/**
 * Normalize an organization's `tradePacks` column: unknown ids are dropped, duplicates removed,
 * and an empty list falls back to the default trade.
 */
export function normalizeTrades(raw: unknown): TradeId[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: TradeId[] = [];
  for (const v of list) {
    const id = typeof v === "string" ? v.trim().toLowerCase() : v;
    if (isTradeId(id) && !out.includes(id)) out.push(id);
  }
  return out.length ? out : [DEFAULT_TRADE];
}

/** The primary pack (first enabled trade). Drives quote sections, phases and AI wording. */
export function primaryPack(trades?: unknown): TradePack {
  return getPack(normalizeTrades(trades)[0]);
}

/**
 * Default catalog for a set of trades, in pack order. A pack's own list is kept as-is; a later
 * pack only skips services an earlier pack already brought (same category + name).
 */
export function servicesForTrades(trades?: unknown): PackService[] {
  const key = (s: PackService) => `${s.category}::${s.name.trim().toLowerCase()}`;
  const out: PackService[] = [];
  for (const id of normalizeTrades(trades)) {
    const before = new Set(out.map(key));
    for (const s of getPack(id).services) {
      if (!before.has(key(s))) out.push(s);
    }
  }
  return out;
}

/** Phase keys of the primary pack plus the "all phases" key (hardwood: installation, sand_finish, both). */
export function phaseKeys(pack: TradePack = getPack()): string[] {
  return [...pack.phases.map((p) => p.key), pack.combinedPhaseKey];
}

/** Phase label in pt-BR (the team UI default) keyed by phase key. */
export function phaseLabels(pack: TradePack = getPack(), locale: keyof PhaseDef["label"] = "pt-BR"): Record<string, string> {
  return Object.fromEntries(pack.phases.map((p) => [p.key, p.label[locale]]));
}

/** "ObraMate, a CRM for <companyKind> in the USA" — shared by every Mate prompt. */
export function productLine(pack: TradePack = getPack()): string {
  return `ObraMate, a CRM for ${pack.ai.companyKind} in the USA`;
}

/** "ObraMate is a CRM for <companyKind> in the USA." */
export function productSentence(pack: TradePack = getPack()): string {
  return `ObraMate is a CRM for ${pack.ai.companyKind} in the USA.`;
}
