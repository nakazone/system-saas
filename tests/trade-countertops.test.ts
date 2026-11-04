/**
 * Countertops — the second trade on the trade-pack core. Pack data, quote PDF sections, what the
 * screens receive, the work order prompt contract, the job's gates (ready for template, layout
 * approval) and crew pay items. Nothing here changes Hardwood or Tile.
 */
import { describe, it, expect } from "vitest";
import { getPack, normalizeTrades, primaryPack, servicesForTrades } from "../src/lib/trades/index.js";
import { tradeInject } from "../src/lib/trades/browser.js";
import { groupItemsForPdf } from "../src/lib/quotes/pdf.js";
import { completePhase, planJobPhases, recordEvidence, type JobPhaseRow } from "../src/lib/trades/job-phases.js";
import { pieceItemsFor } from "../src/lib/payroll/piece-rates.js";

const ct = getPack("countertops");
const hardwood = getPack("hardwood");
const tile = getPack("tile");
const boot = (trades: unknown) => JSON.parse(tradeInject(trades).replace(/^<script>window\.__OM_TRADE=/, "").replace(/<\/script>$/, ""));

describe("Countertops pack", () => {
  it("is selectable and never replaces Hardwood by default", () => {
    expect(normalizeTrades(["countertops"])).toEqual(["countertops"]);
    expect(primaryPack(["countertops"]).id).toBe("countertops");
    expect(primaryPack(undefined).id).toBe("hardwood");
  });

  it("catalog: tops by level, edges, cutouts, backsplash, prep — rates at zero, Tabela groups, no duplicates", () => {
    const names = ct.services.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Countertop – Level 1 (fabricate & install)", "Undermount Sink Cutout", "4\" Backsplash", "Template Visit", "Return Trip – Site Not Ready"]));
    for (const s of ct.services) expect(["installation", "supply", "custom"]).toContain(s.category);
    expect(new Set(names).size).toBe(names.length);
    // A design center selling floors and tops gets both catalogs; Delivery once per name.
    const both = servicesForTrades(["hardwood", "countertops"]);
    expect(both.length).toBeGreaterThan(hardwood.services.length);
  });

  it("quote PDF: tops, edges, cutouts, backsplash and prep, sorted by the line's name first", () => {
    const g = groupItemsForPdf([
      { name: "Countertop – Level 2 (fabricate & install)", description: "Kitchen perimeter, 3 cm", serviceType: "installation", amount: 3200 },
      { name: "Island Top", serviceType: "installation", amount: 1400 },
      { name: "Edge Upgrade – Ogee / Full Bullnose", serviceType: "installation", amount: 380 },
      { name: "Undermount Sink Cutout", serviceType: "installation", amount: 250 },
      { name: "Faucet / Accessory Hole", serviceType: "installation", amount: 40 },
      { name: "4\" Backsplash", description: "Sink wall", serviceType: "installation", amount: 300 },
      { name: "Countertop Tear-Out & Disposal", serviceType: "custom", amount: 350 },
      { name: "Template Visit", serviceType: "custom", amount: 150 },
      { name: "Slab Material", serviceType: "supply", amount: 2400 },
    ] as never, ct);
    expect(g.map((s) => [s.key, s.items.map((i) => i.name)])).toEqual([
      ["supply", ["Slab Material"]],
      ["tops", ["Countertop – Level 2 (fabricate & install)", "Island Top"]],
      ["edges", ["Edge Upgrade – Ogee / Full Bullnose"]],
      ["cutouts", ["Undermount Sink Cutout", "Faucet / Accessory Hole"]],
      ["backsplash", ["4\" Backsplash"]],
      ["prep", ["Countertop Tear-Out & Disposal", "Template Visit"]],
    ]);
    expect(g.reduce((s, x) => s + x.sectionTotal, 0)).toBe(8470);
    expect(ct.quote.tagline).toBe("Quartz · Granite · Quartzite");
  });

  it("screens: phases in the JobPhase table, no payroll sectors, no plan takeoff kinds yet", () => {
    const t = boot(["countertops"]);
    expect(t.id).toBe("countertops");
    expect(t.phases).toBeUndefined();
    expect(t.phaseStorage).toBe("table");
    expect(t.jobPhases.map((p: { key: string }) => p.key)).toEqual(["selection", "site_ready", "template", "layout_approval", "fabrication", "shop_qc", "install", "signoff"]);
    expect(t.takeoff.measuredKinds).toEqual([]);
    expect(t.quote.sections.map((s: { key: string }) => s.key)).toEqual(["supply", "tops", "edges", "cutouts", "backsplash", "prep", "add_on"]);
    expect(t.measureTabs).toEqual(["floors", "summary"]);
  });

  it("work order prompt asks for the same JSON keys as the other packs (same reader)", () => {
    const keys = (p: string) => [...p.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(keys(ct.ai.workOrderPrompt)).toEqual(keys(hardwood.ai.workOrderPrompt));
    expect(keys(ct.ai.workOrderPrompt)).toEqual(keys(tile.ai.workOrderPrompt));
    expect(ct.ai.workOrderPrompt).toContain("countertop work orders");
  });

  it("the template waits for a ready kitchen, and the layout must be approved before fabrication", () => {
    const rows: JobPhaseRow[] = planJobPhases(ct).map((p) => ({ ...p, evidence: {} }));
    const at = (n: number) => new Date(Date.UTC(2026, 10, 4, 15 + n));
    const close = (key: string, n: number, ev: Record<string, unknown> = {}) => {
      const row = rows.find((r) => r.phaseKey === key)!;
      for (const [k, v] of Object.entries(ev)) {
        const out = recordEvidence(ct, key, row.evidence, k, { at: at(n).toISOString(), value: v });
        if (!out.ok) throw new Error(out.error);
        row.evidence = out.evidence;
      }
      const r = completePhase(ct, rows, key, { now: at(n) });
      if (r.ok) {
        row.status = "done";
        row.doneAt = r.phase.doneAt;
        if (r.next) rows.find((x) => x.phaseKey === r.next!.phaseKey)!.readyAt = r.next.readyAt;
      }
      return r;
    };
    expect(close("selection", 0, { slab_photo: true }).ok).toBe(true);
    expect(completePhase(ct, rows, "template", { now: at(1) })).toMatchObject({ ok: false, error: "previous_open", phase: "site_ready" });
    expect(close("site_ready", 1, { ready_checklist: { confirmed: true } }).ok).toBe(true);
    expect(close("template", 2, { template_file: true })).toMatchObject({ ok: false, error: "missing_evidence", missing: ["decision_maker"] });
    expect(close("template", 2, { decision_maker: { confirmed: true } }).ok).toBe(true);
    expect(completePhase(ct, rows, "fabrication", { now: at(3) })).toMatchObject({ ok: false, error: "previous_open", phase: "layout_approval" });
    expect(close("layout_approval", 3, { layout_photo: true, client_approval: { confirmed: true } }).ok).toBe(true);
    expect(close("fabrication", 30).ok).toBe(true);
    expect(close("shop_qc", 31, { qc_photo: true }).ok).toBe(true);
    expect(close("install", 50, { seams_photo: true }).ok).toBe(true);
    // Plumbing reconnects after the sink silicone cures (24 h).
    expect(completePhase(ct, rows, "signoff", { now: at(60) })).toMatchObject({ ok: false, error: "waiting" });
    expect(close("signoff", 75, { finished_photo: true, client_signoff: { confirmed: true } })).toMatchObject({ ok: true, jobStatus: "completed" });
  });

  it("crew pay by item: tops by SF (counts as the day's SF), templates, cutouts, tear-outs", () => {
    expect(pieceItemsFor(["countertops"]).map((i) => i.key)).toEqual(["top_sf", "template", "cutout", "backsplash_lf", "tearout", "vanity"]);
    expect(pieceItemsFor(["countertops"]).filter((i) => i.countsSqft).map((i) => i.key)).toEqual(["top_sf"]);
  });
});

describe("countertops: shop lead time before install", () => {
  it("business days skip the weekend and keep the time", async () => {
    const { addBusinessDays } = await import("../src/lib/trades/job-phases.js");
    // Wed 4 Nov 2026 15:00 UTC + 7 business days = Fri 13 Nov 15:00 UTC
    expect(addBusinessDays(new Date("2026-11-04T15:00:00Z"), 7).toISOString()).toBe("2026-11-13T15:00:00.000Z");
    // Fri + 1 = Mon
    expect(addBusinessDays(new Date("2026-11-06T09:00:00Z"), 1).toISOString()).toBe("2026-11-09T09:00:00.000Z");
    expect(addBusinessDays(new Date("2026-11-06T09:00:00Z"), 0).toISOString()).toBe("2026-11-06T09:00:00.000Z");
  });

  it("install is earliest 7 business days after the slab layout is approved; nothing before it is done", async () => {
    const { phaseEarliest } = await import("../src/lib/trades/job-phases.js");
    const { getPack } = await import("../src/lib/trades/index.js");
    const pack = getPack("countertops");
    const install = pack.phases.find((p) => p.key === "install");
    expect(install?.leadTime).toEqual({ after: "layout_approval", businessDays: 7 });
    const rows = (status: string, doneAt: Date | null) => [{ phaseKey: "layout_approval", sortOrder: 3, status, doneAt }];
    expect(phaseEarliest(install, rows("pending", null))).toBeNull();
    expect(phaseEarliest(install, rows("done", new Date("2026-11-04T15:00:00Z")))?.toISOString()).toBe("2026-11-13T15:00:00.000Z");
    // Other phases have no lead time.
    expect(phaseEarliest(pack.phases.find((p) => p.key === "template"), rows("done", new Date()))).toBeNull();
  });
});
