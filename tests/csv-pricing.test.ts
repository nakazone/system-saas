import { describe, it, expect } from "vitest";
import { mapRows, parseCsv, suggestMapping } from "../src/lib/imports/csv.js";
import { canViewPricing, redactMoney } from "../src/lib/pricing/visibility.js";

describe("parseCsv", () => {
  it("parses quoted fields and commas", () => {
    const { headers, rows } = parseCsv('name,email\n"Doe, Jane",jane@example.com\nBob,bob@x.com');
    expect(headers).toEqual(["name", "email"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["Doe, Jane", "jane@example.com"]);
  });

  it("maps and validates customer rows", () => {
    const { headers, rows } = parseCsv(
      "Name,Email,Phone,Address\nAcme,bad-email,555,123 Main\nValid,ok@ex.com,555-1,456 Oak",
    );
    const mapping = suggestMapping(headers, "customers");
    const mapped = mapRows(headers, rows, mapping, "customers");
    expect(mapped[0]!.errors.some((e) => e.includes("email"))).toBe(true);
    expect(mapped[1]!.errors).toEqual([]);
    expect(mapped[1]!.data.name).toBe("Valid");
    expect(mapped[1]!.data.line1).toBe("456 Oak");
  });
});

describe("pricing visibility", () => {
  it("denies installer without pricing.view", () => {
    expect(canViewPricing({ roleKey: "installer", permissions: ["visits.view"] })).toBe(false);
  });

  it("allows sales with pricing.view", () => {
    expect(canViewPricing({ roleKey: "sales", permissions: ["pricing.view"] })).toBe(true);
  });

  it("redacts monetary keys", () => {
    const redacted = redactMoney({
      title: "Q1",
      total: 100,
      lineItems: [{ description: "Floor", unitPrice: 5, amount: 50 }],
    });
    expect(redacted).toEqual({
      title: "Q1",
      lineItems: [{ description: "Floor" }],
    });
  });
});
