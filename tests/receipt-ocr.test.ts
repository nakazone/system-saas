import { describe, expect, it } from "vitest";
import {
  normalizeOcrPayload,
  parseDateLoose,
  parseMoneyLoose,
} from "../src/lib/finance/receipt-ocr.js";

describe("receipt OCR helpers", () => {
  it("parses US and BR money", () => {
    expect(parseMoneyLoose("$1,234.56")).toBe(1234.56);
    expect(parseMoneyLoose("R$ 50,00")).toBe(50);
    expect(parseMoneyLoose("1.234,56")).toBe(1234.56);
    expect(parseMoneyLoose(19.99)).toBe(19.99);
    expect(parseMoneyLoose("abc")).toBeNull();
  });

  it("parses dates", () => {
    expect(parseDateLoose("2026-09-24")).toBe("2026-09-24");
    expect(parseDateLoose("24/09/2026")).toBe("2026-09-24");
  });

  it("normalizes vision JSON", () => {
    const r = normalizeOcrPayload(
      {
        vendor_name: "Home Depot",
        amount: 87.45,
        date: "2026-09-20",
        category: "materials",
        confidence: 0.9,
        description: "Lumber",
      },
      "openai_vision",
    );
    expect(r.status).toBe("extracted");
    expect(r.amount).toBe(87.45);
    expect(r.vendorName).toBe("Home Depot");
    expect(r.date).toBe("2026-09-20");
    expect(r.category).toBe("materials");
  });
});
