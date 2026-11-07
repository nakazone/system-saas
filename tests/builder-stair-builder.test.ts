import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
import { counts, measurementGaps, parseData, summarize } from "../src/lib/builders/measurements.js";

type Stair = Record<string, any>;
const sandbox: { window: { PpStairs?: any } } = { window: {} };
vm.runInNewContext(readFileSync(resolve("crm/public/partner-portal-stairs.js"), "utf8"), sandbox);
const S = sandbox.window.PpStairs;
const flight = (extra: Stair = {}): Stair => ({ id: "f1", name: "Main stair", species: "White Oak", finish: "Prefinished", color: "", riser_material: "same", steps: [], landing: { enabled: false }, ...extra });

describe("building a flight from counts", () => {
  it("starts with one more riser than treads", () => {
    const s = flight();
    expect(S.setTreads(s, 12)).toEqual({ treads: 12, risers: 13 });
    expect(s.steps.at(-1).kind).toBe("riser");
    expect(s.steps.filter((x: Stair) => x.kind === "step")).toHaveLength(12);
  });
  it("keeps the risers in rhythm as treads go up and down", () => {
    const s = flight();
    S.setTreads(s, 5);
    expect(S.setTreads(s, 6)).toEqual({ treads: 6, risers: 7 });
    expect(S.setTreads(s, 2)).toEqual({ treads: 2, risers: 3 });
    expect(S.setTreads(s, 0)).toEqual({ treads: 0, risers: 0 });
    expect(s.steps).toHaveLength(0);
  });
  it("leaves a riser count typed by hand alone", () => {
    const s = flight();
    S.setTreads(s, 10);
    S.setRisers(s, 4);
    expect(S.counts(s)).toEqual({ treads: 10, risers: 4 });
    expect(S.setTreads(s, 11)).toEqual({ treads: 11, risers: 4 });
  });
  it("takes risers away and gives them back", () => {
    const s = flight();
    S.setTreads(s, 3);
    S.setRisers(s, 0);
    expect(S.counts(s)).toEqual({ treads: 3, risers: 0 });
    expect(s.steps.every((x: Stair) => x.no_riser)).toBe(true);
    S.setRisers(s, 4);
    expect(S.counts(s)).toEqual({ treads: 3, risers: 4 });
  });
  it("never goes over the 60 pieces the server accepts", () => {
    const s = flight();
    S.setTreads(s, 200);
    expect(s.steps.length).toBeLessThanOrEqual(60);
    expect(parseData({ stairs: [s] }).stairs[0]!.steps.length).toBe(s.steps.length);
  });
  it("applies one size to every piece, and new steps get it too", () => {
    const s = flight();
    S.setTreads(s, 3);
    S.applyTread(s, "tread_w", 36);
    S.applyTread(s, "tread_d", 11.25);
    S.applyRiser(s, "riser_h", 7.5);
    S.setTreads(s, 4);
    const tops = s.steps.filter((x: Stair) => x.kind === "step");
    expect(tops.every((x: Stair) => x.tread_w === 36 && x.tread_d === 11.25 && x.riser_h === 7.5)).toBe(true);
    expect(s.steps.at(-1).riser_w).toBe(36); // the riser follows the tread width
    expect(s.steps.at(-1).riser_h).toBe(7.5);
  });
  it("remembers sizes typed before there are any steps", () => {
    const s = flight();
    S.applyTread(s, "tread_w", 42);
    S.applyRiser(s, "riser_h", 7.75);
    expect(S.readSpec(s).tread_w).toEqual({ value: 42, mixed: false });
    S.setTreads(s, 2);
    expect(s.steps[0].tread_w).toBe(42);
    expect(s.steps[0].riser_h).toBe(7.75);
  });
  it("says mixed instead of hiding different sizes", () => {
    const s = flight({ steps: [{ id: "a", kind: "step", tread_w: 48, tread_d: 11 }, { id: "b", kind: "step", tread_w: 42, tread_d: 11 }] });
    expect(S.readSpec(s).tread_w).toEqual({ value: null, mixed: true });
    expect(S.readSpec(s).tread_d).toEqual({ value: 11, mixed: false });
  });
});

describe("landing in square feet", () => {
  it("reads the ways people say it", () => {
    expect(S.parseSqft("16")).toBe(16);
    expect(S.parseSqft("16 sf")).toBe(16);
    expect(S.parseSqft("16,5 sq ft")).toBe(16.5);
    expect(S.parseSqft("4x4")).toBe(16);
    expect(S.parseSqft("3.5 × 4")).toBe(14);
    expect(S.parseSqft("abc")).toBeNull();
    expect(S.parseSqft("0")).toBeNull();
    expect(S.parseSqft("")).toBeNull();
  });
  it("works out a width and depth for the drawings", () => {
    const s = flight({ landing: { enabled: true, sqft: 12 }, spec: { tread_w: 36 } });
    S.syncLanding(s, null);
    expect(s.landing.width).toBe(36);
    expect(s.landing.depth).toBe(48);
  });
  it("makes room for both flights on a U turn", () => {
    const lower = flight({ landing: { enabled: true, sqft: 18 }, spec: { tread_w: 36 } });
    const upper = flight({ id: "f2", turn: "u_left", spec: { tread_w: 36 } });
    S.syncLanding(lower, upper);
    expect(lower.landing.width).toBe(74);
  });
});

describe("what travels to the server", () => {
  const stair = () => {
    const s = flight({ riser_species: "Maple", riser_finish: "Primed", riser_open: "left", riser_ret: "flat" });
    S.setTreads(s, 2);
    S.applyTread(s, "tread_w", 36);
    S.applyTread(s, "tread_d", 11.25);
    S.applyRiser(s, "riser_h", 7.5);
    return s;
  };
  it("keeps the new fields and writes the riser's own wood and side", () => {
    const data = parseData({ stairs: [stair()] });
    expect(data.stairs[0]!.riser_species).toBe("Maple");
    const riser = summarize(data).find((l) => l.kind === "riser");
    expect(riser?.text).toContain("Maple · Primed");
    expect(riser?.text).toContain("left side open · flat return");
    expect(riser?.qty).toBe(3);
    expect(counts(data).risers).toBe(3);
  });
  it("shows a landing in square feet", () => {
    const s = stair();
    s.landing = { enabled: true, sqft: 16, direction: "left" };
    S.syncLanding(s, null);
    const data = parseData({ stairs: [s] });
    expect(data.stairs[0]!.landing.direction).toBe("left");
    expect(summarize(data).find((l) => l.kind === "landing")?.text).toContain("16 SF");
  });
  it("accepts metal vents", () => {
    const data = parseData({ vents: [{ id: "v", size: "4x10", type: "metal", qty: 3 }] });
    expect(data.vents[0]!.type).toBe("metal");
    expect(summarize(data)[0]!.text).toContain("metal");
  });
  it("agrees with the page on what is still missing", () => {
    const s = flight();
    S.setTreads(s, 2);
    const raw = { stairs: [s, { ...flight({ id: "f2", name: "Back stair" }) }] };
    expect(measurementGaps(parseData(raw))).toEqual(S.gaps(raw).map((g: { text: string }) => g.text));
    expect(measurementGaps(parseData(raw))).toEqual(["Main stair: 2 treads need a size", "Main stair: 3 risers need a size", "Back stair: how many treads?"]);
    expect(measurementGaps(parseData({ stairs: [stair()] }))).toEqual([]);
  });
  it("still reads a stair saved before this", () => {
    const old = parseData({ stairs: [{ id: "x", riser_material: "primed", landing: { enabled: true, width: 36, depth: 36 }, steps: [{ id: "a", tread_w: 36, tread_d: 11, riser_w: 36, riser_h: 7 }] }] });
    expect(old.stairs[0]!.landing.sqft).toBeNull();
    expect(old.stairs[0]!.riser_open).toBeNull();
    expect(summarize(old).find((l) => l.kind === "riser")?.text).toContain("primed");
    expect(measurementGaps(old)).toEqual([]);
  });
});
