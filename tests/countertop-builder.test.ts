/**
 * Countertop builder (Countertops trade, Field Quote visit): tops measured piece by piece give
 * square feet, edges, cutouts, backsplash, supports, seams and slabs, and priced quote lines whose
 * names are the Countertops services list (so the company's own price list is found first).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTERTOP_SERVICES } from "../src/lib/trades/packs/countertops/services.js";

function load() {
  const win: Record<string, any> = {};
  const doc = { getElementById: () => ({}), head: { appendChild() {} }, createElement: () => ({}) };
  new Function("window", "document", readFileSync("crm/public/countertop-builder.js", "utf8"))(win, doc);
  return win.ObTops;
}

const kitchen = {
  spec: { level: 2, material: "Quartz", color: "Calacatta Laza", thickness: "3 cm", edge: "eased", splash: "4in" },
  pieces: [
    { id: "run", name: "Sink wall", kind: "run", length: 120, depth: 25.5, sink: "undermount", faucet_holes: 1 },
    { id: "isl", name: "Island", kind: "island", length: 96, depth: 42, overhang: 12, cooktop: true, faucet_holes: 0, waterfall: { right: true } },
  ],
};

describe("countertop quantities", () => {
  it("a sink wall and an island with a bar overhang and a waterfall", () => {
    const O = load();
    const q = O.quantities(kitchen);
    expect(q.per.map((p: any) => p.sf)).toEqual([21.3, 49.5]); // 120 × 25.5 ; 96 × 54 + waterfall 54 × 36
    expect(q.sf).toBe(70.8);
    expect(q.edge_lf).toBe(30.5); // front 10 ; island 96 + 96 + 54 (the waterfall side has no edge)
    expect(q.splash_lf).toBe(10); // only the sink wall has a wall
    expect(q.waterfalls).toBe(1);
    expect(q.supports).toBe(3); // 12″ overhang on 3 cm, 96″ long
    expect(q.seams).toBe(0);
    expect(q.sinks.undermount).toBe(1);
    expect([q.cooktops, q.faucet_holes]).toEqual([1, 1]);
    expect(q.slabs).toBe(2);
  });

  it("2 cm needs support past 6″; a run longer than a slab gets a seam; full-height backsplash is square feet", () => {
    const O = load();
    const q = O.quantities({ spec: { thickness: "2 cm", splash: "full", full_h: 18 }, pieces: [{ id: "a", kind: "run", length: 150, depth: 25.5, overhang: 8 }] });
    expect(q.supports).toBe(5);
    expect(q.seams).toBe(1);
    expect(q.splash_lf).toBe(0);
    expect(q.splash_sf).toBe(18.8); // 12.5 LF × 1.5 ft
  });

  it("defaults: a wall run is 96″ × 25.5″ with the front exposed, a back wall and an undermount sink", () => {
    const O = load();
    const t = O.normalize({ pieces: [{ id: "x" }] });
    expect(t.spec).toMatchObject({ level: 2, thickness: "3 cm", edge: "eased", splash: "4in", tearout: false });
    expect(t.pieces[0]).toMatchObject({ kind: "run", length: 96, depth: 25.5, overhang: 0, sink: "undermount", faucet_holes: 1 });
    expect(t.pieces[0].edges).toEqual({ front: true, back: false, left: false, right: false });
    expect(O.normalize({ pieces: [{ id: "i", kind: "island", length: 999 }] }).pieces[0]).toMatchObject({ length: 240, depth: 42, sink: "none" });
  });
});

describe("countertop quote lines", () => {
  it("one top line per piece at the job's level, then edges, cutouts, backsplash, supports, tear-out", () => {
    const O = load();
    const lines = O.quoteLines({ ...kitchen, spec: { ...kitchen.spec, edge: "ogee", tearout: true } });
    expect(lines.map((l: any) => l.key)).toEqual([
      "ct_top_l2@run",
      "ct_top_l2@isl",
      "ct_waterfall",
      "ct_edge",
      "ct_sink_undermount",
      "ct_cooktop",
      "ct_faucet",
      "ct_splash4",
      "ct_support",
      "ct_tearout",
    ]);
    expect(lines[0]).toMatchObject({ item: "ct_top_l2", piece_id: "run", name: "Countertop – Level 2 (fabricate & install)", quantity: 21.3, unit: "sq_ft" });
    expect(lines[0].description).toBe("Sink wall · 120″ × 25.5″ · Quartz · Calacatta Laza · 3 cm");
    expect(lines[1].description).toContain("+ 12″ overhang");
    expect(lines.find((l: any) => l.key === "ct_edge")).toMatchObject({ name: "Edge Upgrade – Ogee / Full Bullnose", quantity: 30.5, unit: "linear_ft" });
    // The eased edge is included in the top: no edge line.
    expect(O.quoteLines(kitchen).some((l: any) => l.key === "ct_edge")).toBe(false);
    expect(O.quoteLines({ spec: {}, pieces: [] })).toEqual([]);
  });

  it("every item points at a Countertops service the price list gets when the trade is turned on", () => {
    const O = load();
    const names = new Set(COUNTERTOP_SERVICES.map((s) => s.name.toLowerCase().replace(/[–—]/g, "-")));
    for (const [, def] of Object.entries(O.PRICE_ITEMS as Record<string, { names: string[] }>)) for (const n of def.names) expect(names.has(n)).toBe(true);
    const rows = COUNTERTOP_SERVICES.map((s) => ({ name: s.name }));
    expect(O.matchPrice("ct_top_l4", rows)?.name).toBe("Countertop – Level 4 / Premium (fabricate & install)");
    expect(O.matchPrice("ct_splash4", rows)?.name).toBe('4" Backsplash');
    expect(O.matchPrice("ct_sink_farmhouse", [{ name: "Baseboard" }])).toBeNull();
  });
});

describe("the countertop builder on screen", () => {
  it("speaks Portuguese, Spanish and English with the same numbers", () => {
    const O = load();
    const m = () => ({ data: { tops: JSON.parse(JSON.stringify(kitchen)) }, idx: 1 });
    const en = O.html(m());
    expect(en).toContain("Top view");
    expect(en).toContain("70.8 SF");
    O.setLang("pt");
    const pt = O.html(m());
    expect(pt).toContain("Vista de cima");
    expect(pt).toContain("70.8 pé²");
    expect(pt).toContain("Cascata");
    expect(pt).not.toContain("Top view");
    expect(O.chip(kitchen, 1)).toEqual({ name: "Island", sub: "Ilha · 96″ × 54″ · 49.5 pé²" });
    O.setLang("es");
    expect(O.html(m())).toContain("Vista superior");
    expect(O.html({ data: { tops: { pieces: [] } } })).toContain("Ninguna encimera medida");
  });
});
