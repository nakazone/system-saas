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
      "ct_edge_ogee",
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
    expect(lines.find((l: any) => l.key === "ct_edge_ogee")).toMatchObject({ name: "Edge Upgrade – Ogee / Full Bullnose", quantity: 30.5, unit: "linear_ft" });
    // The eased edge is included in the top: no edge line.
    expect(O.quoteLines(kitchen).some((l: any) => /^ct_edge/.test(l.key))).toBe(false);
    expect(O.quoteLines({ spec: {}, pieces: [] })).toEqual([]);
    // The Field Quote looks a line's price up by its key: every key (without the piece) is its item.
    for (const edge of ["bevel", "ogee", "mitered"]) {
      const all = O.quoteLines({ spec: { edge, splash: "full", tearout: true }, pieces: [{ id: "a", sink: "farmhouse", cooktop: true, outlets: 1, overhang: 14, waterfall: { left: true } }, { id: "b", kind: "vanity", sink: "dropin" }] });
      for (const l of all) {
        expect(l.key.split("@")[0]).toBe(l.item);
        expect(O.PRICE_ITEMS[l.item]).toBeTruthy();
      }
    }
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

describe("the server computes the same countertop numbers as the builder", () => {
  it("topsQuantities matches ObTops.quantities", async () => {
    const { topsQuantities, normalizeTops } = await import("../src/lib/trades/packs/countertops/tops.js");
    const O = load();
    const cases = [
      kitchen,
      { spec: { thickness: "2 cm", splash: "full", full_h: 18, edge: "mitered" }, pieces: [{ id: "a", kind: "run", length: 150, depth: 25.5, overhang: 8, sink: "farmhouse" }] },
      { spec: { splash: "none" }, pieces: [{ id: "v", kind: "vanity" }, { id: "i", kind: "island", length: 999, waterfall: { left: true, right: true } }] },
    ];
    for (const c of cases) {
      expect(topsQuantities(c)).toEqual(O.quantities(c));
      expect(normalizeTops(c)).toEqual(O.normalize(c));
    }
  });
});

describe("client tour of a countertops quote", () => {
  it("brings the tops, each with its own top line and a share of the rest", async () => {
    const { buildFieldQuoteTour } = await import("../src/lib/field-quote/tour.js");
    const O = load();
    const lines = O.quoteLines(kitchen).map((l: any) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, amount: Math.round(l.quantity * (O.PRICE_ITEMS[l.item].rate) * 100) / 100, meta: { top_key: l.key } }));
    const total = lines.reduce((a: number, l: any) => a + l.amount, 0);
    const tour = buildFieldQuoteTour({ data: {}, clientName: "Laura Bennett", companyName: "Summit Stone Tops", quoteNumber: "Q-1003", total, lines, tops: kitchen });
    expect(tour.rooms).toEqual([]);
    expect(tour.tops).not.toBeNull();
    const t = tour.tops!;
    expect(t).toMatchObject({ sf: 70.8, edge_lf: 30.5, seams: 0, slabs: 2, waterfalls: 1, supports: 3, edge_label: "Eased edge", splash_label: '4" backsplash' });
    expect(t.pieces.map((p) => p.name)).toEqual(["Sink wall", "Island"]);
    // Every dollar lands on a top: own top line + the shared lines by square feet.
    expect(Math.abs(t.pieces.reduce((a, p) => a + p.price, 0) - total)).toBeLessThanOrEqual(1);
    expect(t.cutouts).toEqual([{ label: "Undermount sink", qty: 1 }, { label: "Cooktop", qty: 1 }, { label: "Faucet holes", qty: 1 }]);
    expect(tour.categories.map((c) => c.label)).toEqual(expect.arrayContaining(["Countertops", "Edges", "Sink, cooktop & cutouts", "Backsplash", "Supports & removal"]));
    expect(tour.sqft).toBe(70.8);
    expect(tour.details).toEqual([]);
  });

  it("a flooring visit has no tops", async () => {
    const { buildFieldQuoteTour } = await import("../src/lib/field-quote/tour.js");
    const tour = buildFieldQuoteTour({ data: { rooms: [{ label: "Living", l_ft: 12, w_ft: 10 }] }, clientName: "A", companyName: "B", quoteNumber: "1", total: 100, lines: [{ name: "LVP installation", quantity: 120, unit: "sq_ft", amount: 100 }] });
    expect(tour.tops).toBeNull();
  });
});

describe("Field Quote questions of a countertops visit", () => {
  const catalog = (trade: string) => {
    const win: Record<string, any> = { __OM_TRADE: { id: trade } };
    new Function("window", readFileSync("crm/public/field-quote-catalog.js", "utf8"))(win);
    return win.FQ_CATALOG.QUESTIONS;
  };
  it("asks what decides the template trip; risky answers go to the job's 'Para o campo'", () => {
    const Q = catalog("countertops");
    expect(Q.countertops.map((q: any) => q.id)).toEqual(["cabinets", "sink_faucet", "sink_model", "cooktop_model", "plumbing", "existing_top", "wall_tile", "slab"]);
    const cab = Q.countertops.find((q: any) => q.id === "cabinets");
    expect([cab.attentionIf("ready"), cab.attentionIf("installing"), cab.attentionIf("not_yet")]).toEqual([false, true, true]);
    expect(Q.countertops.find((q: any) => q.id === "plumbing").attentionIf("plumber")).toBe(true);
    // Heavy furniture is a flooring question.
    expect(Q.general.find((q: any) => q.id === "heavy_items").show()).toBe(false);
    expect(catalog("hardwood").general.find((q: any) => q.id === "heavy_items").show()).toBe(true);
  });
});
