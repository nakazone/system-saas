/**
 * Trade Packs — contract (LAB, not wired into the app).
 *
 * A Trade Pack is everything that changes from one trade to another. The core
 * (leads, customers, calendar, invoices, finance, chat, Master, billing, i18n,
 * Mate engine) stays shared; each pack plugs in its own measurement model,
 * units, catalog, specs, waste, quote sections, job phases, checklists,
 * payroll rules, AI vocabulary and PDF blocks.
 *
 * This folder lives outside `src/` on purpose: it is not compiled by the app
 * build (`tsconfig.json` includes only `src/**`), not run by the tests
 * (`vitest` includes only `tests/**`) and not imported anywhere.
 * Type-check it alone with: `npx tsc -p labs/trades`.
 */

export const TRADE_IDS = ["hardwood", "tile", "carpet", "stone", "countertops", "cabinetry"] as const;
export type TradeId = (typeof TRADE_IDS)[number];

/** Units a trade measures and prices in. */
export type Unit =
  | "SF" // square feet (floor, wall, countertop top)
  | "SY" // square yards (carpet)
  | "LF" // linear feet (trim, edge profile, base, crown, cabinetry run)
  | "EA" // each (niche, cutout, cabinet box, step)
  | "BOX" // material box (hardwood, LVP, tile)
  | "SLAB" // countertop slab
  | "HR" // hour
  | "DAY"; // day rate

export interface UnitDef {
  id: Unit;
  label: string;
  /** Conversion to a base unit of the same dimension, when one exists (SY → SF = 9). */
  toBase?: { unit: Unit; factor: number };
}

/** A product/spec field a job records for a material (today: SPEC_FIELDS in takeoff.ts). */
export interface SpecField {
  key: string;
  label: string;
  suggestions?: string[];
  required?: boolean;
  /** Field matters for warranty or claims (lot #, sealer, pad) — shown in the job record and PDF. */
  evidence?: boolean;
}

export interface MaterialKind {
  key: string;
  label: string;
  unit: Unit;
  specFields: SpecField[];
  /** Default waste rule. Some trades compute waste from a layout (carpet rolls, slab nesting). */
  waste: WasteRule;
}

export type WasteRule =
  | { kind: "percent"; value: number; byPattern?: Record<string, number> }
  | { kind: "computed"; engine: "carpet-roll-layout" | "slab-nesting"; fallbackPercent: number }
  | { kind: "none" };

/** A seed service for the Tabela de Valor (price list per customer type). */
export interface ServiceSeed {
  category: string;
  name: string;
  unit: Unit;
  /** Which quote section it prints under. */
  section: string;
  /** Payroll sector that does the work (hardwood: installation | sand_finish). */
  sector?: string;
  /** Indicative US labor range (research, 2025–2026, estimate) — never shown to customers. */
  refRangeUsd?: [number, number];
  adder?: boolean;
}

export interface QuoteSection {
  key: string;
  title: string;
}

/** A job phase. Phases may wait on cure times, inspections or other trades. */
export interface Phase {
  key: string;
  label: string;
  /** Minimum wait after the phase before the next can start (hours). */
  waitAfterHours?: number;
  /** Evidence required to close the phase (photo, test, signature). */
  requires?: Evidence[];
  /** Another trade (or builder milestone) that must be done first. */
  dependsOn?: { trade?: TradeId; milestone: string }[];
  sector?: string;
}

export type Evidence =
  | { kind: "photo"; label: string }
  | { kind: "test"; label: string; field: string } // e.g. flood test result, moisture reading
  | { kind: "signature"; label: string } // e.g. seam diagram, slab layout, dry-lay approval
  | { kind: "checklist"; items: string[] };

export interface PayRule {
  key: string;
  label: string;
  basis: "day" | "half_day" | "hour" | "per_unit";
  unit?: Unit;
}

/** What the measurement tool for the trade must produce. */
export interface MeasurementModel {
  /** Short description of the tool, for the product team. */
  tool: string;
  /** Objects the tool works with (rooms, walls, showers, roll drops, tops, runs, boxes…). */
  objects: string[];
  /** Outputs that feed the quote and the work order. */
  outputs: string[];
  /** What we already have in ObraMate/ObraBuilder that can be reused. */
  reuses: string[];
}

/** Trade-specific vocabulary and extraction hints for the Mate (WO reading, voice, actions). */
export interface AiHints {
  vocabulary: string[];
  workOrderFields: string[];
}

export interface TradePack {
  id: TradeId;
  label: string;
  /** Status of the pack in the lab. */
  status: "live" | "research" | "spec" | "prototype";
  units: Unit[];
  materials: MaterialKind[];
  services: ServiceSeed[];
  quoteSections: QuoteSection[];
  phases: Phase[];
  payRules: PayRule[];
  measurement: MeasurementModel;
  ai: AiHints;
  /** New core models the trade needs that no other pack provides. */
  newModels?: string[];
  /** Points the research could not settle — to confirm with pilot companies. */
  openQuestions: string[];
}
