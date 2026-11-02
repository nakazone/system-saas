/** What the browser gets from the trade pack (window.__OM_TRADE), for CRM pages and the builder portal. */
import { primaryPack } from "./index.js";

/**
 * The company's trade pack for the browser: phase keys and labels (hardwood: Instalação / Lixa)
 * the customer quote sections and tagline, and the ObraBuilder takeoff catalog (floor kinds,
 * product fields and suggestions), so screens stop hardcoding them. Pages keep their old literals as a fallback.
 */
export function tradeInject(tradePacks: unknown): string {
  const pack = primaryPack(tradePacks);
  const boot = JSON.stringify({
    id: pack.id,
    // Payroll / field-app sectors: only packs whose phases live on the WorkOrder columns (Hardwood).
    // Other packs get the Hardwood sectors' fallback in the browser until their payroll is defined.
    ...(pack.phaseStorage === "columns"
      ? { phases: pack.phases.map((p) => ({ key: p.key, label: p.label })), combined: pack.combinedPhaseKey }
      : {}),
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
