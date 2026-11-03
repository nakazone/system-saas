/**
 * Tile shower builder: quantities from a few dimensions, and showers kept in the ObraBuilder
 * measurement (summary, work order text). Hardwood measurements are unchanged.
 */
import { describe, it, expect } from "vitest";
import { showerQuantities, showerSchema, showerSummaryLines, wallsOf } from "../src/lib/trades/packs/tile/shower.js";
import { counts, measurementDataSchema, parseData, summarize, summaryText } from "../src/lib/builders/measurements.js";
import { tradeInject } from "../src/lib/trades/browser.js";

const owner = showerSchema.parse({
  id: "s1",
  name: "Owner's bath shower",
  shape: "alcove",
  width: 60,
  depth: 36,
  height: 96,
  niches: 1,
  niche_w: 12,
  niche_h: 24,
  niche_d: 3.5,
  bench: true,
  bench_l: 36,
  bench_d: 16,
  bench_h: 18,
  curb: true,
  wall_tile: "12x24 porcelain",
  tile_long: 24,
  floor_tile: "2x2 mosaic",
});

describe("shower quantities", () => {
  it("alcove 60 × 36 × 96 with a niche, a bench and a curb", () => {
    const q = showerQuantities(owner);
    expect(q.walls.map((w) => [w.key, w.sf])).toEqual([["left", 24], ["back", 40], ["right", 24]]);
    // 88 SF of walls + 1.75 niche returns + 4.5 bench front + 5.4 curb
    expect(q.wall_sf).toBe(99.7);
    expect(q.floor_sf).toBe(11); // 15 SF − 4 SF bench footprint
    expect(q.waterproofing_sf).toBe(118.7);
    expect(q.trim_lf).toBe(22); // 2 open edges × 8 ft + niche frame 6 ft
    expect(q.curb_lf).toBe(5);
    expect([q.pan, q.niches, q.bench]).toEqual([1, 1, 1]);
    expect(q.waste).toBe(0.12);
    expect(q.order_wall_sf).toBe(112);
    expect(q.order_floor_sf).toBe(13);
  });

  it("corner showers have two walls and one open edge; walk-ins have no curb", () => {
    const corner = showerSchema.parse({ id: "c", shape: "corner", width: 48, depth: 48, height: 84 });
    expect(wallsOf(corner).map((w) => w.key)).toEqual(["back", "right"]);
    const qc = showerQuantities(corner);
    expect(qc.walls.reduce((a, w) => a + w.sf, 0)).toBe(56); // 2 × 48 × 84 / 144
    expect(qc.trim_lf).toBe(7);
    const walk = showerQuantities(showerSchema.parse({ id: "w", shape: "walkin", width: 72, depth: 42, height: 96, curb: true }));
    expect(walk.curb_lf).toBe(0);
  });

  it("waste follows the tile: 10% small straight-set, 18% herringbone; a prefab base needs no pan", () => {
    expect(showerQuantities(showerSchema.parse({ id: "a", tile_long: 12 })).waste).toBe(0.1);
    expect(showerQuantities(showerSchema.parse({ id: "b", pattern: "herringbone" })).waste).toBe(0.18);
    expect(showerQuantities(showerSchema.parse({ id: "p", pan: "prefab" })).pan).toBe(0);
  });

  it("schema: sensible defaults and limits", () => {
    const d = showerSchema.parse({ id: "x" });
    expect(d).toMatchObject({ shape: "alcove", width: 60, depth: 36, height: 96, niches: 0, bench: false, curb: true });
    expect(showerSchema.safeParse({ id: "x", width: 999 }).success).toBe(false);
    expect(showerSchema.safeParse({ id: "x", niches: 9 }).success).toBe(false);
  });

  it("summary lines name the shower and carry SF / LF / EA", () => {
    const lines = showerSummaryLines(owner);
    expect(lines[0]).toMatchObject({ uom: "SF", qty: 99.7 });
    expect(lines[0]!.text).toBe(`Owner's bath shower · Wall tile 12x24 porcelain · Alcove 60" × 36" × 96" · order 112 SF`);
    expect(lines.map((l) => l.uom)).toEqual(["SF", "SF", "SF", "LF", "LF", "EA", "EA", "EA"]);
    expect(lines.find((l) => l.text.includes("Niche"))!.text).toContain(`Niche 12" × 24" · back wall`);
  });
});

describe("showers in the ObraBuilder measurement", () => {
  it("are kept by the measurement data and show in the summary and the work order text", () => {
    const data = parseData({ showers: [owner], stairs: [], vents: [] });
    expect(data.showers).toHaveLength(1);
    expect(counts(data)).toMatchObject({ showers: 1, shower_wall_sf: 99.7, stairs: 0, vents: 0 });
    const lines = summarize(data);
    expect(lines.every((l) => l.kind === "shower")).toBe(true);
    const text = summaryText({ address: "1083 Golf Estates Point", data, measuredBy: "Rafa", measuredAt: null });
    expect(text).toContain("- Owner's bath shower · Wall tile 12x24 porcelain · Alcove 60\" × 36\" × 96\" · order 112 SF — 99.7 SF");
  });

  it("a hardwood measurement without showers reads exactly as before", () => {
    const data = measurementDataSchema.parse({ vents: [{ id: "v1", size: "4x10", qty: 2 }] });
    expect(data.showers).toEqual([]);
    expect(summarize(data)).toEqual([{ kind: "vent", qty: 2, uom: "EA", text: "Vent 4x10 flush mount" }]);
  });

  it("the portal learns the trade's tabs: Tile = Showers · Plan · Summary; Hardwood keeps its own", () => {
    const boot = (t: string[]) => JSON.parse(tradeInject(t).replace(/^<script>window\.__OM_TRADE=/, "").replace(/<\/script>$/, ""));
    expect(boot(["tile"]).measureTabs).toEqual(["showers", "floors", "summary"]);
    expect(boot(["hardwood"]).measureTabs).toBeUndefined();
  });
});

describe("ObraBuilder tabs for a builder with several companies", () => {
  it("are the tabs of every connected company's trade", async () => {
    const { builderMeasureTabs } = await import("../src/lib/trades/browser.js");
    expect(builderMeasureTabs([])).toBeUndefined();
    expect(builderMeasureTabs([["hardwood"], ["hardwood"]])).toBeUndefined();
    expect(builderMeasureTabs([["tile"]])).toEqual(["showers", "floors", "summary"]);
    expect(builderMeasureTabs([["hardwood"], ["tile"]])).toEqual(["stairs", "vents", "showers", "floors", "summary"]);
  });
});

describe("the portal computes the same quantities as the server", () => {
  it("runs partner-portal-showers.js on the same showers", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("crm/public/partner-portal-showers.js", "utf8");
    const win: Record<string, any> = {};
    new Function("window", "document", src)(win, {});
    const cases = [
      owner,
      showerSchema.parse({ id: "c", shape: "corner", width: 48, depth: 48, height: 84, niches: 2, pattern: "herringbone" }),
      showerSchema.parse({ id: "w", shape: "walkin", width: 72, depth: 42, height: 96, bench: true, bench_wall: "back", drain: "linear", tile_long: 12 }),
      showerSchema.parse({ id: "p", pan: "prefab", width: 32, depth: 32, height: 72, curb: false }),
    ];
    for (const s of cases) expect(win.ObShowers.quantities(s)).toEqual(showerQuantities(s));
  });

  it("speaks English in the builder portal and Portuguese in the Field Quote, with the same numbers", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("crm/public/partner-portal-showers.js", "utf8");
    const win: Record<string, any> = {};
    const doc = { getElementById: () => ({}), head: { appendChild() {} }, createElement: () => ({}) };
    new Function("window", "document", src)(win, doc);
    const m = () => ({ data: { showers: [owner] }, status: "draft", showerIdx: 0 });
    const en = win.ObShowers.html(m());
    expect(en).toContain("Top view");
    expect(en).toContain("99.7 SF");
    win.ObShowers.setLang("pt");
    const pt = win.ObShowers.html(m());
    expect(pt).toContain("Vista de cima");
    expect(pt).toContain("99.7 pé²");
    expect(pt).toContain("Soleira");
    expect(pt).not.toContain("Top view");
    expect(win.ObShowers.chipSub(owner, 0)).toEqual({ name: "Owner's bath shower", sub: "3 paredes · 60″ × 36″ · nicho, banco" });
    expect(win.ObShowers.quantities(owner)).toEqual(showerQuantities(owner));
  });
});

describe("Field Quote: showers become priced quote lines", () => {
  it("prices each shower item from the Tile services list by name, else the default", async () => {
    const { readFileSync } = await import("node:fs");
    const fq = readFileSync("crm/public/partner-portal-showers.js", "utf8");
    const { TILE_SERVICES } = await import("../src/lib/trades/packs/tile/services.js");
    // Every shower item points at a Tile service that the company's price list gets when it turns Tile on.
    const names = [...fq.matchAll(/names: \['([^']+)'\]/g)].map((x) => x[1]);
    expect(names.length).toBe(11);
    const tile = new Set(TILE_SERVICES.map((s) => s.name.toLowerCase().replace(/[–—]/g, "-")));
    for (const n of names) expect(tile.has(n)).toBe(true);
  });
});

describe("shower quote lines (Field Quote and quote editor)", () => {
  it("one line per item of each shower, tied to the shower id, in English", async () => {
    const { readFileSync } = await import("node:fs");
    const win: Record<string, any> = {};
    new Function("window", "document", readFileSync("crm/public/partner-portal-showers.js", "utf8"))(win, {});
    const O = win.ObShowers;
    const lines = O.quoteLines([owner, { ...owner, id: "s2", name: "Hall bath", niches: 0, bench: false, pan: "prefab", drain: "linear" }]);
    expect(lines.filter((l: any) => l.shower_id === "s1").map((l: any) => l.item)).toEqual(["sh_wall", "sh_floor", "sh_pan_mortar", "sh_membrane", "sh_flood", "sh_niche", "sh_bench", "sh_curb", "sh_trim"]);
    expect(lines.filter((l: any) => l.shower_id === "s2").map((l: any) => l.item)).toEqual(["sh_wall", "sh_floor", "sh_drain", "sh_membrane", "sh_curb", "sh_trim"]);
    const wall = lines[0];
    expect(wall).toMatchObject({ name: "Shower walls — tile installation", quantity: 99.7, unit: "sq_ft" });
    expect(wall.description.startsWith("Owner's bath shower · ")).toBe(true);
    // Price list rows are found by the Tile service's name, dashes evened out.
    expect(O.matchPrice("sh_pan_mortar", [{ name: "Shower Pan – Mortar Bed with Liner" }])?.name).toBe("Shower Pan – Mortar Bed with Liner");
    expect(O.matchPrice("sh_bench", [{ name: "Baseboard" }])).toBeNull();
  });
});
