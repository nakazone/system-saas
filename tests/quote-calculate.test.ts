import { describe, it, expect } from "vitest";
import { calculateQuote } from "../src/lib/quotes/calculate.js";

describe("calculateQuote", () => {
  it("applies waste and markups from configuration values", () => {
    const result = calculateQuote({
      areaSqft: 100,
      wastePercent: 10,
      pricePerSqft: 5,
      laborPerSqft: 2,
      materialMarkup: 20,
      laborMarkup: 50,
    });

    // billable area = 110; material = 550; labor = 200
    // material with markup = 660; labor with markup = 300; total = 960
    expect(result.billableArea).toBe(110);
    expect(result.materialCost).toBe(550);
    expect(result.laborCost).toBe(200);
    expect(result.materialWithMarkup).toBe(660);
    expect(result.laborWithMarkup).toBe(300);
    expect(result.total).toBe(960);
  });
});
