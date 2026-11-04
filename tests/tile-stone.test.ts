/**
 * Natural stone tile as a variant of the Tile pack: the job gets three more phases — stone
 * received (lot photo, count against the BOL), dry-lay approved by the client, stone sealing —
 * on when the job's title or lines say marble, travertine…, or when the office turns it on.
 */
import { describe, it, expect } from "vitest";
import { getPack } from "../src/lib/trades/index.js";
import { activeVariants, completePhase, detectVariants, planJobPhases, recordEvidence, type JobPhaseRow } from "../src/lib/trades/job-phases.js";

const tile = getPack("tile");
const T0 = new Date("2026-11-03T15:00:00Z");
const h = (n: number) => new Date(T0.getTime() + n * 3600_000);

function rows(variants: string[] = []): JobPhaseRow[] {
  return planJobPhases(tile, variants).map((p) => ({ ...p, evidence: {} }));
}
function close(list: JobPhaseRow[], key: string, at: Date, ev: Record<string, unknown> = {}) {
  const row = list.find((r) => r.phaseKey === key)!;
  for (const [k, v] of Object.entries(ev)) {
    const out = recordEvidence(tile, key, row.evidence, k, { at: at.toISOString(), value: v });
    if (!out.ok) throw new Error(`${key}.${k}: ${out.error}`);
    row.evidence = out.evidence;
  }
  const r = completePhase(tile, list, key, { now: at });
  if (!r.ok) return r;
  row.status = "done";
  row.doneAt = r.phase.doneAt;
  if (r.next) list.find((x) => x.phaseKey === r.next!.phaseKey)!.readyAt = r.next.readyAt;
  return r;
}

describe("natural stone tile (Tile pack variant)", () => {
  it("is found in the job's words, in English or Portuguese", () => {
    expect(detectVariants(tile, ["Owner's bath — Carrara marble 12x24"])).toEqual(["stone"]);
    expect(detectVariants(tile, ["Box com travertino", null])).toEqual(["stone"]);
    expect(detectVariants(tile, ["Porcelain 12x24 shower", "Floor Tile Installation"])).toEqual([]);
    expect(detectVariants(getPack("hardwood"), ["marble"])).toEqual([]);
  });

  it("a porcelain job skips the stone phases and walks exactly as before", () => {
    const list = rows();
    expect(list.filter((r) => r.status === "skipped").map((r) => r.phaseKey)).toEqual(["material_received", "dry_lay", "stone_seal"]);
    expect(activeVariants(tile, list)).toEqual([]);
    expect(close(list, "site_ready", h(0), { ready_checklist: { confirmed: true } }).ok).toBe(true);
    // Stone received is skipped, so prep comes right after site ready.
    expect(close(list, "prep", h(1), { flatness: { text: "ok" } }).ok).toBe(true);
  });

  it("a stone job asks for the lot and the client's OK on the dry-lay before setting", () => {
    const list = rows(["stone"]);
    expect(activeVariants(tile, list)).toEqual(["stone"]);
    close(list, "site_ready", h(0), { ready_checklist: { confirmed: true } });
    expect(completePhase(tile, list, "prep", { now: h(1) })).toMatchObject({ ok: false, error: "previous_open", phase: "material_received" });
    expect(close(list, "material_received", h(1), { lot_photo: { confirmed: true } })).toMatchObject({ ok: false, error: "missing_evidence", missing: ["receiving_check"] });
    expect(close(list, "material_received", h(1), { receiving_check: { confirmed: true } }).ok).toBe(true);
    close(list, "prep", h(2), { flatness: { text: "ok" } });
    close(list, "waterproofing", h(3), { membrane_photo: { confirmed: true } });
    close(list, "flood_test", h(28), { flood_result: { depth_in: 2, hours: 24, passed: true }, water_line_photo: { confirmed: true } });
    expect(completePhase(tile, list, "setting", { now: h(29) })).toMatchObject({ ok: false, error: "previous_open", phase: "dry_lay" });
    expect(close(list, "dry_lay", h(29), { dry_lay_photo: { confirmed: true }, client_approval: { confirmed: true } }).ok).toBe(true);
    close(list, "setting", h(30), { coverage_photo: { confirmed: true } });
    close(list, "grout", h(55));
    // Grout cures 48 h; the stone sealer goes on after that, then the final clean.
    expect(completePhase(tile, list, "stone_seal", { now: h(60) })).toMatchObject({ ok: false, error: "waiting" });
    expect(close(list, "stone_seal", h(104), { sealer: { text: "penetrating sealer, 2 coats" } }).ok).toBe(true);
    expect(close(list, "seal_clean", h(105), { finished_photo: { confirmed: true } })).toMatchObject({ ok: true, jobStatus: "completed" });
  });

  it("the catalog prices stone apart and the crew can be paid for sealing", () => {
    const names = tile.services.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Natural Stone Tile Installation", "Stone Dry-Lay & Layout Approval", "Natural Stone Sealing"]));
    expect(tile.payroll!.pieceItems.find((i) => i.key === "stone_seal_sf")).toMatchObject({ unit: "sf" });
  });
});
