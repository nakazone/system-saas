import { describe, expect, it } from "vitest";
import { buildFieldQuoteTour, tourDeposit } from "../src/lib/field-quote/tour.js";

const room = (id: string, en: string, l: string, w: string) => ({ id, label: en, en, mode: "dims", l_ft: l, l_in: "", w_ft: w, w_in: "", parts: [], services: ["demolition", "installation"] });

const data = {
  services: ["demolition", "installation"],
  svc: { installation: { material: "lvp", supply: true } },
  answers: { demolition: { existing: ["carpet"] } },
  rooms: [room("a", "Living room", "16", "12"), room("b", "Hallway", "10", "4")],
};
const lines = [
  { name: "LVP — material", quantity: 256, unit: "sq_ft", amount: 1152, meta: { service_type: "Supply" } },
  { name: "LVP installation", quantity: 232, unit: "sq_ft", amount: 928 },
  { name: "Floor removal — carpet", quantity: 232, unit: "sq_ft", amount: 348, meta: { service_type: "Demolition" } },
  { name: "Quarter round", quantity: 84, unit: "linear_ft", amount: 126 },
  { name: "Stair treads", quantity: 13, unit: "step", amount: 845 },
  { name: "Moisture barrier", quantity: 232, unit: "sq_ft", amount: 116 },
  { name: "Haul away & disposal", quantity: 1, unit: "fixed", amount: 350 },
];

describe("field quote client tour", () => {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const tour = buildFieldQuoteTour({ data, clientName: "Jennifer Walsh", companyName: "Peak Line", quoteNumber: "Q-1", total, lines, validUntil: "2026-11-25T00:00:00Z" });

  it("uses the quote's real numbers", () => {
    expect(tour.total).toBe(total);
    expect(tour.sqft).toBe(232);
    expect(tour.client_first).toBe("Jennifer");
    expect(tour.stairs).toBe(13);
    expect(tour.removal?.existing).toEqual(["carpet"]);
    expect(tour.floor?.label).toBe("Luxury vinyl plank");
    expect(tour.valid_until).toBe("2026-11-25");
  });

  it("categories add up to the total", () => {
    const sum = tour.categories.reduce((s, c) => s + c.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(total);
    expect(tour.categories.map((c) => c.label)).toEqual(expect.arrayContaining(["Flooring material", "Installation", "Old floor removal", "Stairs", "Trim & transitions", "Subfloor prep", "Haul away"]));
  });

  it("splits area and perimeter lines across rooms", () => {
    const [living, hall] = tour.rooms;
    expect(living.sqft).toBe(192);
    expect(hall.sqft).toBe(40);
    expect(living.price).toBeGreaterThan(hall.price * 4);
    // stairs and fixed items stay out of the rooms
    const roomsSum = tour.rooms.reduce((s, r) => s + r.price, 0);
    expect(roomsSum).toBeLessThan(total - 845 - 350 + 2);
  });

  it("deposit comes from the first payment item", () => {
    expect(tourDeposit({ items: [{ label: "Due on approval", percent: 30, fixedAmount: null }] }, 1000)).toEqual({ label: "Due on approval · 30%", amount: 300 });
    expect(tourDeposit({ items: [] }, 1000)).toBeNull();
  });

  it("compares Option A and Option B with their own floor and totals", () => {
    const optLines = [
      { name: "LVP installation", quantity: 232, unit: "sq_ft", amount: 928, optionGroupId: "ga" },
      { name: "LVP — material", quantity: 256, unit: "sq_ft", amount: 1152, optionGroupId: "ga", meta: { service_type: "Supply" } },
      { name: "Engineered hardwood installation", quantity: 232, unit: "sq_ft", amount: 1044, optionGroupId: "gb" },
      { name: "Engineered hardwood — material", quantity: 256, unit: "sq_ft", amount: 2176, optionGroupId: "gb", meta: { service_type: "Supply" } },
      { name: "Floor removal — carpet", quantity: 232, unit: "sq_ft", amount: 348, meta: { service_type: "Demolition" } },
    ];
    const t = buildFieldQuoteTour({
      data, clientName: "Jen", companyName: "Peak", quoteNumber: "Q-2", total: 2428, lines: optLines,
      groups: [{ id: "ga", name: "Option A · LVP", flooringType: "lvp" }, { id: "gb", name: "Option B · Engineered hardwood", flooringType: "engineered_wood" }],
      selectedGroupId: "ga", taxRate: 0,
    });
    expect(t.options).toHaveLength(2);
    expect(t.selected_option).toBe("ga");
    expect(t.total).toBe(2428);
    const b = t.options!.find((o) => o.id === "gb")!;
    expect(b.total).toBe(1044 + 2176 + 348);
    expect(b.floor?.label).toBe("Engineered hardwood");
    expect(t.options![0].floor?.label).toBe("Luxury vinyl plank");
    expect(b.room_prices.reduce((x, y) => x + y, 0)).toBeGreaterThan(t.rooms.reduce((x, r) => x + r.price, 0));
  });
});
