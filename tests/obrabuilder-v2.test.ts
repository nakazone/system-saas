import { describe, expect, it } from "vitest";
import { companyProfile } from "../src/lib/builders/accounts.js";
import { agreedPriceFor } from "../src/lib/builders/prices.js";
import { distanceM } from "../src/lib/builders/measurements.js";

describe("ObraBuilder v2 helpers", () => {
  it("builds the company card from its ObraMate profile", () => {
    const p = companyProfile({ logoUrl: "https://x/logo.png", contactPhone: "303", website: "acme.com", addressLine1: "1 Main St", city: "Denver", state: "CO", postalCode: "80202", licenseNumber: "L1", licenseState: "CO", insuranceCarrier: "Hartford", insuranceExpiresOn: new Date("2027-01-31T00:00:00Z") });
    expect(p.logo_url).toBe("https://x/logo.png");
    expect(p.website).toBe("https://acme.com");
    expect(p.address).toBe("1 Main St, Denver, CO 80202");
    expect(p.license).toBe("L1 · CO");
    expect(p.insurance).toEqual({ carrier: "Hartford", expires_on: "2027-01-31" });
    expect(companyProfile({ addressLine1: "1 Main", addressPrivate: true }).address).toBeNull();
    expect(companyProfile(undefined, "ben@gmail.com").icon_url).toBeNull();
  });
  it("finds the agreed price by catalog service, then by name", () => {
    const prices = [
      { id: "a", company_id: "c", pricing_item_id: "p1", name: "Stair tread install", unit: "step", price: 40, notes: null },
      { id: "b", company_id: "c", pricing_item_id: null, name: "Moisture barrier – 6 mil poly", unit: "sq_ft", price: 0.1, notes: null },
    ];
    expect(agreedPriceFor(prices, { pricing_item_id: "p1" })?.id).toBe("a");
    expect(agreedPriceFor(prices, { service_name: "moisture barrier 6 mil poly" })?.id).toBe("b");
    expect(agreedPriceFor(prices, { description: "Vapor White" })).toBeNull();
  });
  it("measures the distance between two points", () => {
    expect(Math.round(distanceM({ lat: 39.7392, lng: -104.9903 }, { lat: 39.7401, lng: -104.9903 }))).toBe(100);
  });
});
