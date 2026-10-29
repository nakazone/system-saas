import { describe, it, expect } from "vitest";
import { linkCatalog, normalizeIntake, serviceKind, stairFlightsFromText } from "../src/lib/partner-intake/extract.js";

const CFC = `INSTALL DATE: TBD
BLDR: PETE GARCIA
STAIR TREADS:
SOLID WHITE OAK - 48" - DOUBLE RETURNS - 8 EA
SOLID WHITE OAK - 42" - LEFT RETURNS - 8 EA
STAIR RISERS:
SOLID WHITE OAK - 48" - DOUBLE RETURNS - 9 EA
SOLID WHITE OAK - 42" - LEFT RETURNS - 9 EA
INSTALL WOOD VENTS - ARTISTIC FINISHES GRAND FISHERMAN'S PIER - QTY 10`;

describe("stairs on a work order", () => {
  it("reads two flights (48\" double returns, 42\" left returns) with their risers", () => {
    expect(stairFlightsFromText(CFC)).toEqual([
      { width: 48, returns: "double", treads: 8, risers: 9, species: "White Oak" },
      { width: 42, returns: "left", treads: 8, risers: 9, species: "White Oak" },
    ]);
  });
  it("reads any width, and two flights of the same width with different returns", () => {
    expect(stairFlightsFromText(`STAIR TREADS: RED OAK - 36" - NO RETURNS - 12 EA\nSTAIR RISERS: 36" - 13 EA`)).toEqual([
      { width: 36, returns: "none", treads: 12, risers: 13, species: "Red Oak" },
    ]);
    const two = stairFlightsFromText(`STAIR TREADS: HICKORY 42" - LEFT RETURNS - 7 EA / 42" - RIGHT RETURNS - 6 EA\nSTAIR RISERS: 42" - 15 EA`);
    expect(two.map((f) => [f.width, f.returns, f.treads, f.risers])).toEqual([[42, "left", 7, 8], [42, "right", 6, 7]]);
  });
});

describe("stair sand & finish", () => {
  it("knows the kind of work whatever the wording", () => {
    expect(serviceKind("SITE FINISHED SAND/2 COAT TREADS - CUSTOM/FR&MOUNTAIN")).toBe("stair_sand_finish");
    expect(serviceKind("Sand and finish stairs")).toBe("stair_sand_finish");
    expect(serviceKind("Stair refinishing")).toBe("stair_sand_finish");
    expect(serviceKind("Stain + 3 coats on treads")).toBe("stair_sand_finish");
    expect(serviceKind("UNITY HARDWOODS 48\" WHITE OAK TREAD")).toBe("stair_tread");
    expect(serviceKind("VENT FLUSH MT FRAME 4X10")).toBe("vent");
    expect(serviceKind("Hardwood sand & finish")).toBe("floor_sand_finish");
  });
  it("names the line and links it to the company's stair finishing service", () => {
    const r = normalizeIntake({
      address: "322 Lower Ranch View Rd", notes: CFC,
      items: [
        { description: "Stair tread installation", detail: "48\" · Double Returns", quantity: 8, uom: "EA" },
        { description: "SITE FINISHED SAND/2 COAT TREADS", detail: "CUSTOM/FR&MOUNTAIN", quantity: 16, uom: "EA", rate: 50, total: 800 },
      ],
    });
    const sand = r.items.find((it) => it.service_name === "Sand & finish stair treads");
    expect(sand).toMatchObject({ quantity: 16, uom: "STEP", rate: 50 });
    expect(r.stair_finish).toBe("site");
    expect(r.stairs?.length).toBe(2);
    const linked = linkCatalog(r.items, [], [{ id: "a", name: "Stair Refinishing", unit: "each" }, { id: "b", name: "Hardwood install", unit: "sq_ft" }]);
    expect(linked.find((it) => it.service_name === "Sand & finish stair treads")?.pricing_item_id).toBe("a");
  });
  it("adds the stair finishing when the reader folded it into the treads", () => {
    const r = normalizeIntake({
      address: "322 Lower Ranch View Rd",
      notes: `${CFC}\nSITE FINISHED SAND/2 COAT TREADS 16 EA`,
      items: [{ description: "Stair tread installation", detail: "48\" · Double Returns", quantity: 8, uom: "EA" }],
    });
    expect(r.items.find((it) => it.service_name === "Sand & finish stair treads")?.quantity).toBe(16);
  });
});

describe("catalog link sanity", () => {
  it("does not link a tread install to the stair finishing service", () => {
    const items = [{ area: "", description: "UNITY HARDWOODS 48\" WHITE OAK TREAD", detail: "Double returns", quantity: 8, uom: "STEP", rate: null, total: null, pricing_item_id: null, service_name: "Stair tread installation — 48\" Double Returns" }];
    const raw = [{ description: "UNITY HARDWOODS 48\" WHITE OAK TREAD", detail: "Double returns", catalog_id: "sand" }];
    const out = linkCatalog(items, raw, [{ id: "sand", name: "Sand & finish stair treads", unit: "each" }, { id: "tread", name: "Stair tread install", unit: "each" }]);
    expect(out[0]!.pricing_item_id).toBe("tread");
  });
});
