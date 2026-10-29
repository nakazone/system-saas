import { describe, it, expect } from "vitest";
import { parseData, summarize, counts } from "../src/lib/builders/measurements.js";
import { measuredFor } from "../src/lib/builders/jobs.js";
import { planTotals, takeoffSettings, parseTakeoffSettings, withWaste, specText } from "../src/lib/builders/takeoff.js";

const plan = {
  file: { key: "builders/a/measurements/m/plan-1.pdf", name: "plans.pdf", type: "application/pdf", pages: 3, size: 1000 },
  materials: [
    { key: "hardwood-1", label: "Hardwood", color: "#fcca9f", kind: "hardwood", include: true, sand_finish: true },
    { key: "lvp-2", label: "LVP", color: "#b7dcae", kind: "lvp", include: true },
    { key: "tile-3", label: "Tile", color: "#f7bed7", kind: "tile", include: false },
  ],
  levels: [
    { id: "lv1", page: 1, name: "Lower level", scale_ppf: 4.12, floor: 0, rooms: [
      { id: "r1", name: "Rec. Room", material: "lvp-2", area_sf: 263.4, x: 10, y: 10 },
      { id: "r2", name: "Bedroom 2", material: "lvp-2", area_sf: 247, x: 20, y: 10 },
      { id: "r3", name: "Steam", material: "tile-3", area_sf: 51 },
      { id: "r4", name: "Storage", material: "lvp-2", area_sf: 100, exclude: true },
    ], grid: { w: 2, h: 1, cell: 0.5, rle: "2x1,1x1" } },
    { id: "lv2", page: 2, name: "Main level", scale_ppf: 4.13, floor: 1, rooms: [
      { id: "r5", name: "Great Room", material: "hardwood-1", area_sf: 653 },
      { id: "r6", name: "Kitchen", material: "hardwood-1", area_sf: 157 },
    ] },
    { id: "lv3", page: 3, name: "Upper level", scale_ppf: 4.13, floor: 2, include: false, rooms: [
      { id: "r7", name: "Flex", material: "hardwood-1", area_sf: 248 },
    ] },
  ],
};

describe("floor plan takeoff", () => {
  const data = parseData({ stairs: [], vents: [], plan });
  it("keeps the plan in the measurement", () => {
    expect(data.plan?.levels).toHaveLength(3);
    expect(data.plan?.materials[0]?.sand_finish).toBe(true);
  });
  it("adds up each floor over counted rooms and levels", () => {
    const t = planTotals(data.plan);
    const hw = t.find((x) => x.key === "hardwood-1")!;
    const lvp = t.find((x) => x.key === "lvp-2")!;
    expect(hw.area_sf).toBe(810); // upper level is left out
    expect(lvp.area_sf).toBeCloseTo(510.4); // storage room left out
    expect(t.find((x) => x.key === "tile-3")?.include).toBe(false);
  });
  it("puts the counted floors on the work order", () => {
    const s = summarize(data).filter((l) => l.kind === "floor");
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ uom: "SF", qty: 810 });
    expect(s[0]!.text).toContain("sand & finish");
    expect(counts(data)).toMatchObject({ floor_sf: 1320, plan: true });
    expect(measuredFor({ description: "LVP install", detail: "" }, summarize(data))).toMatch(/LVP · Lower level 510 SF \(510 SF\)/);
    expect(measuredFor({ description: "Sand & finish", detail: "" }, summarize(data))).toMatch(/Hardwood/);
  });
  it("waste settings fall back to defaults and stay in range", () => {
    expect(takeoffSettings({}).waste.hardwood).toBe(10);
    expect(takeoffSettings({ waste: { lvp: 7, bogus: 3 } }).waste).toMatchObject({ lvp: 7, hardwood: 10 });
    expect(parseTakeoffSettings({ waste: { lvp: 80 } })).toBeNull();
    expect(withWaste(1000, 10)).toBe(1100);
  });
  it("prints the product the builder picked", () => {
    expect(specText({ kind: "hardwood", spec: { species: "White Oak", construction: "Engineered", width: '7"', thickness: '5/8"', finish: "Unfinished — sand & finish on site", color: "Natural" } }))
      .toBe('White Oak · Engineered · 7" × 5/8" · Unfinished · Natural');
    expect(specText({ kind: "lvp", spec: { brand: "Coretec", wear: "20 mil" } })).toBe("Coretec · 20 mil wear layer");
    const d = parseData({ plan: { ...plan, materials: plan.materials.map((m) => (m.key === "lvp-2" ? { ...m, spec: { brand: "Coretec" } } : m)) } });
    expect(summarize(d).find((l) => l.text.includes("LVP"))?.text).toContain("Coretec");
  });
  it("drops a broken plan instead of failing the measurement", () => {
    expect(parseData({ plan: { levels: "nope" } }).plan).toBeNull();
  });
});
