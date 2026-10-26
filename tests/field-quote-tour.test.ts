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
});
