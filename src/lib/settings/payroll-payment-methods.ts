/**
 * Folha — formas de pagamento dos funcionários (OrgCatalogItem kind).
 */
export const PAYROLL_PAYMENT_METHOD_KIND = "payroll_payment_method";

export const DEFAULT_PAYROLL_PAYMENT_METHODS = [
  { key: "zelle", label: "Zelle", description: "Pagamento via Zelle", sortOrder: 10 },
  { key: "cash", label: "Dinheiro", description: "Pagamento em dinheiro", sortOrder: 20 },
  { key: "check", label: "Cheque", description: "Cheque", sortOrder: 30 },
  { key: "ach", label: "ACH", description: "Transferência ACH / depósito direto", sortOrder: 40 },
  { key: "transfer", label: "Transferência", description: "Transferência bancária", sortOrder: 50 },
  { key: "other", label: "Outro", description: "Outra forma de pagamento", sortOrder: 60 },
] as const;

/** Built-in keys kept for backwards-compatible validation fallbacks. */
export const LEGACY_PAY_METHOD_KEYS = DEFAULT_PAYROLL_PAYMENT_METHODS.map((m) => m.key);

export function payrollMethodLabel(key: string | null | undefined, catalog?: Array<{ key: string; label: string }>): string {
  const k = String(key || "").trim();
  if (!k) return "—";
  const fromCat = catalog?.find((m) => m.key === k);
  if (fromCat?.label) return fromCat.label;
  const def = DEFAULT_PAYROLL_PAYMENT_METHODS.find((m) => m.key === k);
  return def?.label || k;
}
