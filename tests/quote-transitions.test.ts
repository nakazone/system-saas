import { describe, it, expect } from "vitest";
import { transitionQuote, normalizeQuoteStatus, canTransition } from "../src/lib/quotes/transitions.js";
import { calculateQuoteTotals, calculateRoomsEstimate } from "../src/lib/quotes/totals.js";
import { hashPublicToken, generateRawPublicToken, tokenNeedsLightVerify } from "../src/lib/quotes/public-token.js";

describe("transitionQuote", () => {
  const valid: Array<[string, Parameters<typeof transitionQuote>[1], string]> = [
    ["draft", "send", "sent"],
    ["sent", "request_changes", "changes_requested"],
    ["changes_requested", "resend", "sent"],
    ["sent", "approve", "approved"],
    ["approved", "convert", "converted"],
    ["sent", "archive", "archived"],
    ["sent", "expire", "expired"],
    ["expired", "renew", "sent"],
    ["accepted", "convert", "converted"],
  ];

  for (const [from, event, next] of valid) {
    it(`${from} + ${event} → ${next}`, () => {
      const result = transitionQuote(from, event);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.next).toBe(next);
    });
  }

  const invalid: Array<[string, Parameters<typeof transitionQuote>[1]]> = [
    ["draft", "archive"],
    ["draft", "approve"],
    ["sent", "send"],
    ["converted", "approve"],
    ["archived", "send"],
    ["approved", "send"],
  ];

  for (const [from, event] of invalid) {
    it(`rejects ${from} + ${event}`, () => {
      expect(transitionQuote(from, event).ok).toBe(false);
      expect(canTransition(from, event)).toBe(false);
    });
  }

  it("normalizes legacy statuses", () => {
    expect(normalizeQuoteStatus("accepted")).toBe("approved");
    expect(normalizeQuoteStatus("rejected")).toBe("archived");
    expect(normalizeQuoteStatus("invoiced")).toBe("approved");
  });
});

describe("calculateQuoteTotals", () => {
  it("sums selected optionals and chosen option group", () => {
    const totals = calculateQuoteTotals({
      selectedOptionGroupId: "g1",
      taxRate: 10,
      lines: [
        { quantity: 1, unitPrice: 100, amount: 100, optionGroupId: "g1" },
        { quantity: 1, unitPrice: 200, amount: 200, optionGroupId: "g2" },
        {
          quantity: 1,
          unitPrice: 50,
          amount: 50,
          isOptional: true,
          isSelected: true,
        },
        {
          quantity: 1,
          unitPrice: 80,
          amount: 80,
          isOptional: true,
          isSelected: false,
        },
      ],
    });
    expect(totals.subtotal).toBe(150);
    expect(totals.taxTotal).toBe(15);
    expect(totals.total).toBe(165);
  });

  it("sums rooms estimate", () => {
    const result = calculateRoomsEstimate({
      rooms: [{ areaSqft: 100 }, { areaSqft: 50 }],
      wastePercent: 10,
      pricePerSqft: 4,
      laborPerSqft: 2,
      materialMarkup: 0,
      laborMarkup: 0,
    });
    expect(result.billableArea).toBe(165);
    expect(result.materialCost).toBe(660);
    expect(result.laborCost).toBe(300);
    expect(result.total).toBe(960);
  });
});

describe("public tokens", () => {
  it("hashes stably and generates high-entropy tokens", () => {
    const raw = generateRawPublicToken();
    expect(raw.length).toBeGreaterThanOrEqual(40);
    expect(hashPublicToken(raw)).toHaveLength(64);
    expect(hashPublicToken(raw)).toBe(hashPublicToken(raw));
  });

  it("flags tokens older than 14 days for light verify", () => {
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const recent = new Date();
    expect(tokenNeedsLightVerify(old)).toBe(true);
    expect(tokenNeedsLightVerify(recent)).toBe(false);
  });
});
