import { describe, expect, it } from "vitest";
import {
  matchPricingService,
  mergeMateAiCatalog,
  normalizeMateAiUnit,
  parseMateAiCommand,
  resolveCustomerUnitPrice,
} from "../src/lib/mate-ai/command.js";

describe("Mate AI command parsing", () => {
  it("parses a Portuguese command with catalog names, measures, and a US thousands separator", () => {
    const parsed = parseMateAiCommand(
      "Crie um Quote para o Cliente Ana Silva com 1000 sqft de Installation, Remoção de 500 sqft de carpet e Lixa de 1,500 sqft",
    );

    expect(parsed.customerQuery).toBe("Ana Silva");
    expect(parsed.items).toEqual([
      { serviceQuery: "installation", quantity: 1000, unit: "sq_ft" },
      { serviceQuery: "removal carpet", quantity: 500, unit: "sq_ft" },
      { serviceQuery: "sand", quantity: 1500, unit: "sq_ft" },
    ]);
  });

  it("accepts a unique exact service match and keeps ambiguity for review", () => {
    const catalog = [
      { id: "one", name: "Carpet Removal", unit: "sq ft" },
      { id: "two", name: "Hardwood Installation", unit: "sq ft" },
      { id: "three", name: "Luxury Vinyl Installation", unit: "sq_ft" },
    ];

    expect(matchPricingService("removal carpet", "sq_ft", catalog)).toEqual({
      status: "matched",
      item: catalog[0],
    });
    expect(matchPricingService("installation", "sq ft", catalog)).toEqual({
      status: "ambiguous",
      items: [catalog[1], catalog[2]],
    });
    expect(matchPricingService("carpet removal", "linear ft", catalog)).toEqual({ status: "not_found" });
  });

  it("normalizes the supported units without converting measurements", () => {
    expect(normalizeMateAiUnit("square feet")).toBe("sq_ft");
    expect(normalizeMateAiUnit("pés quadrados")).toBe("sq_ft");
    expect(normalizeMateAiUnit("linear ft")).toBe("linear_ft");
    expect(normalizeMateAiUnit("fixed")).toBe("fixed");
    expect(normalizeMateAiUnit("meters")).toBeNull();
  });

  it("selects the same customer-specific rates and fallback as the Quote Builder", () => {
    const item = {
      id: "pricing-1",
      price: 10,
      priceMin: 12,
      priceMax: 24,
      partnerPrice: 15,
      priceParticular: 0,
      priceBuilder: 0,
    };
    expect(resolveCustomerUnitPrice(item, { customerType: "particular" })).toBe(24);
    expect(resolveCustomerUnitPrice(item, { customerType: "builder" })).toBe(15);
    expect(resolveCustomerUnitPrice(item, { customerType: "contractor" })).toBe(15);
    expect(resolveCustomerUnitPrice(item, { customerType: "loja" })).toBe(12);
    expect(
      resolveCustomerUnitPrice(item, {
        customerType: "particular",
        pricingMode: "custom",
        customPricingRates: { "pricing-1": "19.25" },
      }),
    ).toBe(19.25);
    expect(
      resolveCustomerUnitPrice(item, {
        customerType: "particular",
        pricingMode: "custom",
        customPricingRates: {},
      }),
    ).toBe(24);
    expect(
      resolveCustomerUnitPrice(item, {
        customerType: "particular",
        pricingMode: "custom",
        customPricingRates: { "pricing-1": 0 },
      }),
    ).toBe(24);
  });

  it("uses Quote Catalog as primary and merges matching PricingItem rates by exact service name", () => {
    const catalog = mergeMateAiCatalog(
      [
        {
          id: "catalog-1",
          name: "Hardwood Installation",
          serviceType: "installation",
          unitType: "sq ft",
          unitPrice: 18,
          description: "Quote catalog description",
          active: true,
        },
        {
          id: "catalog-2",
          name: "Cabinet Work",
          serviceType: "custom",
          unitType: "each",
          unitPrice: 40,
          active: true,
        },
        { id: "inactive-catalog", name: "Inactive", active: false },
      ],
      [
        {
          id: "pricing-1",
          name: "hardwood installation",
          category: "installation",
          unit: "sq ft",
          price: 10,
          priceMin: 12,
          priceMax: 24,
          partnerPrice: 15,
          priceParticular: 0,
          priceBuilder: 0,
          notes: "Pricing notes override catalog description",
          active: true,
          isVisible: true,
        },
        {
          id: "pricing-2",
          name: "Carpet Removal",
          category: "removal",
          unit: "sq ft",
          price: 9,
          active: true,
          isVisible: true,
        },
        {
          id: "hidden",
          name: "Hidden Service",
          category: "installation",
          unit: "sq ft",
          price: 50,
          active: true,
          isVisible: false,
        },
      ],
    );

    expect(catalog).toHaveLength(3);
    expect(catalog[0]).toMatchObject({
      id: "catalog-1",
      source: "quote-catalog",
      pricingItemId: "pricing-1",
      defaultRate: 24,
      rateBuilder: 15,
      description: "Pricing notes override catalog description",
    });
    expect(catalog[1]).toMatchObject({ id: "catalog-2", source: "quote-catalog", defaultRate: 40 });
    expect(catalog[2]).toMatchObject({ id: "pricing-2", source: "pricing", pricingItemId: "pricing-2" });
  });

  it("rejects commands without a customer, a measure, or a supported unit", () => {
    expect(() => parseMateAiCommand("Crie um Quote com 500 sqft de Carpet Removal")).toThrow("customer_missing");
    expect(() => parseMateAiCommand("Crie um Quote para Ana Silva")).toThrow("items_missing");
    expect(() => parseMateAiCommand("Crie um Quote para Ana Silva com 0.125 sqft de Carpet Removal")).toThrow(
      "quantity_precision",
    );
    expect(() => parseMateAiCommand("Crie um Quote para Ana Silva com 5 meters de Carpet Removal")).toThrow(
      "items_missing",
    );
  });
});
