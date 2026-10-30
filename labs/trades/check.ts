/** Run with: npx tsx labs/trades/check.ts — prints a summary of every pack and any consistency problem. */
import { TRADE_PACKS, validatePack } from "./index.js";

let failed = 0;
for (const p of Object.values(TRADE_PACKS)) {
  const problems = validatePack(p);
  failed += problems.length;
  console.log(
    `${p.id.padEnd(12)} ${p.status.padEnd(9)} materials=${p.materials.length} services=${p.services.length} ` +
      `phases=${p.phases.length} open=${p.openQuestions.length}${problems.length ? "  ✗" : "  ✓"}`,
  );
  for (const x of problems) console.log("   - " + x);
}
process.exit(failed ? 1 : 0);
