import type { SessionUser } from "../../middleware/auth.js";

const MONEY_KEYS = new Set([
  "materialCost",
  "laborCost",
  "materialMarkup",
  "laborMarkup",
  "subtotal",
  "total",
  "taxTotal",
  "unitPrice",
  "amount",
  "material_cost",
  "labor_cost",
  "material_markup",
  "labor_markup",
  "tax_total",
  "unit_price",
  "price",
  "priceMin",
  "priceMax",
  "partnerPrice",
  "costPrice",
  "hourlyRate",
  "defaultPricePerSqft",
  "defaultLaborPerSqft",
  "paid_total",
  "quotes_total",
]);

export function canViewPricing(user?: Pick<SessionUser, "permissions" | "roleKey"> | null): boolean {
  if (!user) return false;
  if (user.roleKey === "admin") return true;
  return user.permissions.includes("pricing.view");
}

/**
 * Strip monetary fields from plain objects / arrays for viewers without pricing.view.
 * Mutates a shallow clone — safe to pass API payloads.
 */
export function redactMoney<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactMoney(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (MONEY_KEYS.has(key)) continue;
    if (val != null && typeof val === "object") {
      out[key] = redactMoney(val);
    } else {
      out[key] = val;
    }
  }
  return out as T;
}

export function withPricingGate<T>(user: Pick<SessionUser, "permissions" | "roleKey"> | null | undefined, value: T): T {
  if (canViewPricing(user)) return value;
  return redactMoney(value);
}
