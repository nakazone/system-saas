/** Trade registry (LAB). Not imported by the app. */
import type { TradeId, TradePack } from "./types.js";
import { hardwood } from "./packs/hardwood.js";
import { tile } from "./packs/tile.js";
import { carpet } from "./packs/carpet.js";
import { stone } from "./packs/stone.js";
import { countertops } from "./packs/countertops.js";
import { cabinetry } from "./packs/cabinetry.js";

export const TRADE_PACKS: Record<TradeId, TradePack> = { hardwood, tile, carpet, stone, countertops, cabinetry };

export function getPack(id: TradeId): TradePack {
  return TRADE_PACKS[id];
}

/** Packs an organization has turned on (future `Organization.trades`, default ["hardwood"]). */
export function packsFor(trades: readonly TradeId[] = ["hardwood"]): TradePack[] {
  return trades.map(getPack);
}

/**
 * Consistency checks for every pack: every service prints in a declared quote section,
 * units are declared, phase dependencies point at known trades. Returns a list of problems.
 */
export function validatePack(p: TradePack): string[] {
  const problems: string[] = [];
  const sections = new Set(p.quoteSections.map((s) => s.key));
  const units = new Set(p.units);
  for (const s of p.services) {
    if (!sections.has(s.section)) problems.push(`${p.id}: service "${s.name}" uses unknown section "${s.section}"`);
    if (!units.has(s.unit)) problems.push(`${p.id}: service "${s.name}" uses undeclared unit ${s.unit}`);
    if (s.refRangeUsd && s.refRangeUsd[0] > s.refRangeUsd[1]) problems.push(`${p.id}: service "${s.name}" has an inverted range`);
  }
  for (const m of p.materials) {
    if (!units.has(m.unit)) problems.push(`${p.id}: material "${m.key}" uses undeclared unit ${m.unit}`);
  }
  for (const ph of p.phases) {
    for (const d of ph.dependsOn ?? []) {
      if (d.trade && !(d.trade in TRADE_PACKS)) problems.push(`${p.id}: phase "${ph.key}" depends on unknown trade ${d.trade}`);
    }
  }
  return problems;
}
