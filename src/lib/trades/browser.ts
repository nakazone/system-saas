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
    phases: pack.phases.map((p) => ({ key: p.key, label: p.label })),
    combined: pack.combinedPhaseKey,
    quote: { tagline: pack.quote.tagline, sections: pack.quote.sections.map((s) => ({ key: s.key, label: s.label })) },
    takeoff: {
      measuredKinds: pack.takeoff.measuredKinds,
      specFields: pack.takeoff.specFields,
      specLabels: pack.takeoff.specLabels,
      specSuggestions: pack.takeoff.specSuggestions,
    },
  }).replace(/</g, "\\u003c");
  return `<script>window.__OM_TRADE=${boot}</script>`;
}
