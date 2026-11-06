/** What the browser gets from the trade pack (window.__OM_TRADE), for CRM pages and the builder portal. */
import { primaryPack } from "./index.js";

/**
 * The company's trade pack for the browser: phase keys and labels (hardwood: Instalação / Lixa)
 * the customer quote sections and tagline, and the ObraBuilder takeoff catalog (floor kinds,
 * product fields and suggestions), so screens stop hardcoding them. Pages keep their old literals as a fallback.
 */
export function tradeInject(tradePacks: unknown, opts: { measureTabs?: readonly string[] } = {}): string {
  const pack = primaryPack(tradePacks);
  const measureTabs = opts.measureTabs ?? pack.measurement?.tabs;
  const boot = JSON.stringify({
    id: pack.id,
    // Payroll / field-app sectors: only packs whose phases live on the WorkOrder columns (Hardwood).
    // Other packs get the Hardwood sectors' fallback in the browser until their payroll is defined.
    ...(pack.phaseStorage === "columns"
      ? { phases: pack.phases.map((p) => ({ key: p.key, label: p.label })), combined: pack.combinedPhaseKey }
      : {}),
    // "table": the job page shows the Fases tab (JobPhase rows); "columns": phases follow the job status.
    phaseStorage: pack.phaseStorage,
    // Stock kept per piece (Countertops: the slab yard page and the job's slab card).
    ...(pack.inventory ? { inventory: pack.inventory } : {}),
    // ObraBuilder measurement tabs (Tile: Showers · Plan · Summary); absent = Hardwood's tabs.
    ...(measureTabs ? { measureTabs } : {}),
    // Every pack: the job's phases in order, with waits and required evidence (for the job screen).
    jobPhases: pack.phases.map((p) => ({
      key: p.key,
      label: p.label,
      waitAfterHours: p.waitAfterHours ?? 0,
      requires: (p.requires ?? []).map((r) => ({ key: r.key, kind: r.kind, label: r.label })),
    })),
    quote: {
      tagline: pack.quote.tagline,
      sections: pack.quote.sections.map((s) => ({ key: s.key, label: s.label })),
      // Packs with word rules (Tile) sort quote lines with them; Hardwood keeps the screens' own logic.
      ...(pack.quote.match ? { match: pack.quote.match, fallback: pack.quote.fallbackSection || pack.quote.sections[0]?.key } : {}),
    },
    takeoff: {
      measuredKinds: pack.takeoff.measuredKinds,
      specFields: pack.takeoff.specFields,
      specLabels: pack.takeoff.specLabels,
      specSuggestions: pack.takeoff.specSuggestions,
    },
  }).replace(/</g, "\\u003c");
  return `<script>window.__OM_TRADE=${boot}</script>`;
}

const HARDWOOD_TABS = ["stairs", "vents", "floors", "summary"] as const;

/**
 * ObraBuilder measurement tabs for a builder working with several companies: the tabs of every
 * connected company's trade, in one order (Hardwood only → its own tabs, undefined; Tile only →
 * Showers · Plan · Summary; both → Stairs · Vents · Showers · Plan · Summary).
 */
export function builderMeasureTabs(companyTrades: readonly unknown[]): string[] | undefined {
  const packs = companyTrades.map((t) => primaryPack(t));
  if (!packs.some((p) => p.measurement)) return undefined;
  const wanted = new Set<string>();
  for (const p of packs) for (const t of p.measurement?.tabs ?? HARDWOOD_TABS) wanted.add(t);
  return ["stairs", "vents", "showers", "countertops", "floors", "summary"].filter((t) => wanted.has(t));
}
