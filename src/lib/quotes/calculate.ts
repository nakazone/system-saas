import { Decimal } from "@prisma/client/runtime/library";

export type QuoteCalculationInput = {
  areaSqft: number;
  wastePercent: number;
  pricePerSqft: number;
  laborPerSqft: number;
  materialMarkup: number;
  laborMarkup: number;
};

export type QuoteCalculationResult = {
  billableArea: number;
  materialCost: number;
  laborCost: number;
  materialWithMarkup: number;
  laborWithMarkup: number;
  subtotal: number;
  total: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generic flooring estimate engine.
 * Waste and markup percentages come from organization configuration, not hardcoded rules.
 */
export function calculateQuote(input: QuoteCalculationInput): QuoteCalculationResult {
  const billableArea = input.areaSqft * (1 + input.wastePercent / 100);
  const materialCost = billableArea * input.pricePerSqft;
  const laborCost = input.areaSqft * input.laborPerSqft;
  const materialWithMarkup = materialCost * (1 + input.materialMarkup / 100);
  const laborWithMarkup = laborCost * (1 + input.laborMarkup / 100);
  const subtotal = materialWithMarkup + laborWithMarkup;
  const total = subtotal;

  return {
    billableArea: round2(billableArea),
    materialCost: round2(materialCost),
    laborCost: round2(laborCost),
    materialWithMarkup: round2(materialWithMarkup),
    laborWithMarkup: round2(laborWithMarkup),
    subtotal: round2(subtotal),
    total: round2(total),
  };
}

export function toDecimal(n: number): Decimal {
  return new Decimal(n.toFixed(2));
}
