/** Shared partner pricing calculation for builder portal. */

export const SHARE_LINK_EXPIRY_DAYS = 30;

export function volumeDiscountPct(areaSqft) {
  const area = Number(areaSqft) || 0;
  if (area >= 5000) return 15;
  if (area >= 2500) return 12;
  if (area >= 1000) return 8;
  if (area >= 500) return 5;
  return 0;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function calculateLine(svc, areaSqft) {
  const area = Math.max(0, parseInt(String(areaSqft), 10) || 0);
  const partnerRate = Number(svc.partner_price) || 0;
  const priceMin = Number(svc.price_min) || partnerRate;
  const priceMax = Number(svc.price_max) || partnerRate;

  const public_estimate_low = roundMoney(area * priceMin);
  const public_estimate_high = roundMoney(area * priceMax);

  const estimate_low = roundMoney(area * partnerRate);
  const estimate_high = roundMoney(area * partnerRate);
  const volumePct = volumeDiscountPct(area);
  const estimate_low_discounted = roundMoney(estimate_low * (1 - volumePct / 100));
  const estimate_high_discounted = roundMoney(estimate_high * (1 - volumePct / 100));

  const public_savings_low = roundMoney(Math.max(0, public_estimate_low - estimate_low_discounted));
  const public_savings_high = roundMoney(Math.max(0, public_estimate_high - estimate_high_discounted));

  return {
    service_id: svc.id,
    service: svc.name,
    unit: svc.unit,
    partner_rate: partnerRate,
    price_min: priceMin,
    price_max: priceMax,
    rate: partnerRate,
    area_sqft: area,
    public_estimate_low,
    public_estimate_high,
    estimate_low,
    estimate_high,
    volume_discount_pct: volumePct,
    estimate_low_discounted,
    estimate_high_discounted,
    public_savings_low,
    public_savings_high,
  };
}

export function sumCalculationLines(lines) {
  const totals = lines.reduce(
    (acc, line) => {
      acc.estimate_low += line.estimate_low || 0;
      acc.estimate_high += line.estimate_high || 0;
      acc.estimate_low_discounted += line.estimate_low_discounted || 0;
      acc.estimate_high_discounted += line.estimate_high_discounted || 0;
      acc.public_estimate_low += line.public_estimate_low || 0;
      acc.public_estimate_high += line.public_estimate_high || 0;
      acc.public_savings_low += line.public_savings_low || 0;
      acc.public_savings_high += line.public_savings_high || 0;
      acc.area_sqft += line.area_sqft || 0;
      return acc;
    },
    {
      estimate_low: 0,
      estimate_high: 0,
      estimate_low_discounted: 0,
      estimate_high_discounted: 0,
      public_estimate_low: 0,
      public_estimate_high: 0,
      public_savings_low: 0,
      public_savings_high: 0,
      area_sqft: 0,
    }
  );
  for (const k of Object.keys(totals)) {
    if (k !== 'area_sqft') totals[k] = roundMoney(totals[k]);
  }
  return totals;
}

export function shareExpiryDate(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + SHARE_LINK_EXPIRY_DAYS);
  return d;
}
