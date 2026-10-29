import { describe, it, expect } from "vitest";
import { fmtInches, parseInches, summarize, counts, parseData } from "../src/lib/builders/measurements.js";
import { measuredFor } from "../src/lib/builders/jobs.js";

describe("inches", () => {
  it("reads the ways people write them", () => {
    expect(parseInches("48")).toBe(48);
    expect(parseInches("11 1/4")).toBe(11.25);
    expect(parseInches("11¼")).toBe(11.25);
    expect(parseInches("11-1/4\"")).toBe(11.25);
    expect(parseInches("7.875")).toBe(7.875);
    expect(parseInches("abc")).toBeNull();
    expect(parseInches("")).toBeNull();
  });
  it("prints fractions back", () => {
    expect(fmtInches(11.25)).toBe("11¼");
    expect(fmtInches(7.875)).toBe("7⅞");
    expect(fmtInches(48)).toBe("48");
    expect(fmtInches(null)).toBe("—");
  });
});

describe("measurement summary", () => {
  const data = parseData({
    stairs: [{
      id: "s1", name: "Escada principal", species: "White Oak", finish: "Prefinished", riser_material: "same",
      steps: [
        { id: "a", tread_w: 48, tread_d: 11.25, riser_w: 48, riser_h: 7.5, open: "both", ret: "45" },
        { id: "b", tread_w: 48, tread_d: 11.25, riser_w: 48, riser_h: 7.5, open: "both", ret: "45" },
        { id: "c", tread_w: 42, tread_d: 11.25, riser_w: 42, riser_h: 7.5, open: "left", ret: "flat" },
      ],
      nosings: [{ id: "n", length: 48, qty: 1, type: "flush" }],
    }],
    vents: [{ id: "v1", size: "4x10", type: "flush", species: "White Oak", qty: 6 }, { id: "v2", size: "4x10", type: "flush", species: "White Oak", qty: 4 }],
  });
  it("groups equal pieces like a work order", () => {
    const s = summarize(data);
    expect(s.find((l) => l.kind === "tread" && l.text.includes("48 × 11¼"))?.qty).toBe(2);
    expect(s.find((l) => l.kind === "tread" && l.text.includes("42 × 11¼"))?.text).toContain("left side open · flat return");
    expect(s.find((l) => l.kind === "vent")?.qty).toBe(10);
    expect(counts(data)).toEqual({ stairs: 1, treads: 3, risers: 3, nosings: 1, landings: 0, vents: 10 });
  });
  it("puts measured sizes on the matching order line", () => {
    const lines = summarize(data);
    expect(measuredFor({ description: "UNITY HARDWOODS 48\" WHITE OAK TREAD", detail: "" }, lines)).toMatch(/^Measured: .*48 × 11¼/);
    expect(measuredFor({ description: "Vent flush mount 4x10", detail: "" }, lines)).toMatch(/4x10/);
    expect(measuredFor({ description: "Sand & finish", detail: "" }, lines)).toBe("");
  });
});

describe("width filter", () => {
  it("gives a 42\" tread line only the 42\" treads", () => {
    const lines = [
      { kind: "tread", text: "Escada · Tread White Oak 48 × 11¼ · os dois lados abertos · retorno 45°", qty: 8, uom: "EA" },
      { kind: "tread", text: "Basement · Tread White Oak 42 × 11¼ · left side open · flat return", qty: 8, uom: "EA" },
    ];
    const out = measuredFor({ description: "UNITY HARDWOODS 42\" WHITE OAK TREAD", detail: "Left returns" }, lines);
    expect(out).toContain("42 × 11¼");
    expect(out).not.toContain("48 ×");
  });
});

import { matchPickup, pickupOrderNumber, pickupText } from "../src/lib/builders/pickups.js";

describe("pickup locations", () => {
  const locs = [
    { id: "1", name: "TriWest Henderson", address: "9751 E 102nd Ave, Henderson, CO 80640", aliases: ["TRIWEST", "Tri West"], phone: null, hours: "7am–3pm", notes: null, is_default: false },
    { id: "2", name: "CFC Arvada", address: "5420 Ward Rd, Arvada, CO", aliases: ["CFC"], phone: null, hours: null, notes: null, is_default: false },
  ];
  it("links the supplier named on the work order", () => {
    expect(matchPickup(locs, "Triwest · 9176215")?.id).toBe("1");
    expect(matchPickup(locs, "TRI WEST 9176215")?.id).toBe("1");
    expect(matchPickup(locs, "Home Depot")).toBeNull();
  });
  it("keeps the supplier order number", () => {
    expect(pickupOrderNumber("Triwest · 9176215")).toBe("9176215");
    expect(pickupText(locs[0]!, "9176215")).toBe("TriWest Henderson — 9751 E 102nd Ave, Henderson, CO 80640 · Order 9176215 · 7am–3pm");
  });
});

import { formatQuantityEn, formatTicketWhenEn, ticketStatusEn } from "../src/modules/work-orders/public-ticket.js";

describe("ObraBuilder ticket texts in English", () => {
  it("formats the job date and status in English", () => {
    const start = new Date("2026-10-02T13:30:00Z");
    const w = formatTicketWhenEn(start, new Date("2026-10-02T23:00:00Z"), "America/Denver", new Date("2026-10-01T18:00:00Z"))!;
    expect(w.day).toBe("Friday, Oct 2");
    expect(w.start).toBe("7:30 AM");
    expect(w.until).toBe("until 5:00 PM");
    expect(w.relative).toBe("Tomorrow");
    expect(ticketStatusEn("scheduled", "on_site")).toBe("On site");
    expect(ticketStatusEn("draft", null)).toBe("Awaiting schedule");
    expect(formatQuantityEn(9, "step")).toBe("9 steps");
    expect(formatQuantityEn(1200, "sq_ft")).toBe("1,200 sq ft");
  });
});
