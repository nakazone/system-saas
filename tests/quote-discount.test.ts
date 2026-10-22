import { describe, expect, it } from "vitest";
import { quoteInvoiceLines } from "../src/lib/invoices/job.js";
import { quoteContractTotal, readQuoteDiscount } from "../src/lib/quotes/discount.js";

describe("quote discount on invoice and job value", () => {
  it("reads a percentage discount stored only in the quote payload", () => {
    const d = readQuoteDiscount({
      subtotal: 1000,
      discountType: null,
      discountValue: 0,
      payload: { discount_type: "percentage", discount_value: 10 },
    });
    expect(d).toMatchObject({ type: "percent", value: 10, amount: 100 });
  });

  it("reads a fixed discount from the columns", () => {
    const d = readQuoteDiscount({
      subtotal: 800,
      discountType: "fixed",
      discountValue: 150,
      payload: {},
    });
    expect(d.amount).toBe(150);
  });

  it("adds a negative discount line so invoice services total is the net price", () => {
    const lines = quoteInvoiceLines({
      kind: "full",
      label: "Full payment",
      amount: 900,
      invoicedBefore: 0,
      quote: {
        title: "Kitchen",
        quoteNumber: "Q-9",
        subtotal: 1000,
        discountType: null,
        discountValue: 0,
        payload: { discount_type: "percentage", discount_value: 10 },
        lineItems: [
          { name: "LVP", description: "Install", quantity: 100, unitPrice: 10, amount: 1000 },
        ],
      },
    });
    expect(lines.map((l) => l.amount)).toEqual([1000, -100]);
    expect(lines[1]?.description).toBe("Discount (10%)");
    const services = lines.reduce((s, l) => s + l.amount, 0);
    expect(services).toBe(900);
  });

  it("bills the discounted total when the stored quote total is still the full price", () => {
    expect(
      quoteContractTotal({
        subtotal: 1000,
        taxTotal: 0,
        total: 1000,
        discountType: "percent",
        discountValue: 10,
      }),
    ).toBe(900);
  });
});
