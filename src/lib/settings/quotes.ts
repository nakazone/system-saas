/**
 * Configurações › Orçamentos — numbering, defaults applied to new quotes,
 * client-view defaults and the company "owner" signature.
 */
import { z } from "zod";
import { DEFAULT_CLIENT_VIEW, DEFAULT_ESTIMATE_RULES } from "../tenant/defaults.js";

export type ClientView = {
  showQuantities: boolean;
  showUnitPrices: boolean;
  showLineTotals: boolean;
  showRoomBreakdown: boolean;
};

export type OwnerSignature = {
  name: string | null;
  title: string | null;
  use_auto: boolean;
  image_url: string | null;
  updated_at: string | null;
};

export type QuoteSettings = { client_view: ClientView; owner_signature: OwnerSignature };

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseQuoteSettings(raw: unknown): QuoteSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const cv = (o.client_view && typeof o.client_view === "object" ? o.client_view : {}) as Record<string, unknown>;
  const os = (o.owner_signature && typeof o.owner_signature === "object" ? o.owner_signature : {}) as Record<
    string,
    unknown
  >;
  return {
    client_view: {
      showQuantities: bool(cv.showQuantities, DEFAULT_CLIENT_VIEW.showQuantities),
      showUnitPrices: bool(cv.showUnitPrices, DEFAULT_CLIENT_VIEW.showUnitPrices),
      showLineTotals: bool(cv.showLineTotals, DEFAULT_CLIENT_VIEW.showLineTotals),
      showRoomBreakdown: bool(cv.showRoomBreakdown, DEFAULT_CLIENT_VIEW.showRoomBreakdown),
    },
    owner_signature: {
      name: str(os.name),
      title: str(os.title),
      use_auto: bool(os.use_auto, true),
      image_url: str(os.image_url),
      updated_at: str(os.updated_at),
    },
  };
}

export const PREFIX_RE = /^[A-Za-z0-9#/._-]{0,8}$/;

export function formatQuoteNumber(prefix: string | null | undefined, n: number): string {
  return `${prefix ?? "Q-"}${n}`;
}

/** Next quote number: after the last one used, never below the configured minimum. */
export function computeNextQuoteNumber(lastUsed: number | null | undefined, configuredNext: number | null | undefined) {
  const afterLast = (lastUsed ?? 1000) + 1;
  return Math.max(afterLast, configuredNext ?? 0);
}

export function defaultValidUntil(validityDays: number, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + validityDays);
  return d;
}

/** Parse a YYYY-MM-DD (or ISO) date sent by the quote builder. */
export function parseDateInput(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const quoteSettingsPatchSchema = z
  .object({
    number_prefix: z
      .string()
      .trim()
      .max(8)
      .regex(PREFIX_RE, "Use até 8 letras, números ou - _ / . #")
      .optional(),
    next_number: z.coerce.number().int().min(1).max(99_999_999).nullable().optional(),
    validity_days: z.coerce.number().int().min(1, "Mínimo 1 dia").max(365, "Máximo 365 dias").optional(),
    tax_rate: z.coerce.number().min(0, "Não pode ser negativo").max(30, "Máximo 30%").optional(),
    terms: z.string().max(20000).nullable().optional(),
    client_view: z
      .object({
        showQuantities: z.boolean(),
        showUnitPrices: z.boolean(),
        showLineTotals: z.boolean(),
        showRoomBreakdown: z.boolean(),
      })
      .optional(),
  })
  .strict();

export const ownerSignaturePutSchema = z.object({
  name: z.string().trim().min(2, "Indique o nome").max(120),
  title: z.string().trim().min(2, "Indique o cargo").max(120),
  use_auto_signature: z.boolean().optional(),
  signature_png: z
    .string()
    .regex(/^data:image\/png;base64,/, "Assinatura inválida")
    .max(1_500_000, "Assinatura muito grande")
    .optional(),
});

// ---------------------------------------------------------------------------
// Estimate rules

export const FLOORING_TYPES = DEFAULT_ESTIMATE_RULES.map((r) => r.flooringType);

export const FLOORING_LABELS: Record<string, string> = {
  hardwood: "Madeira (hardwood)",
  lvp: "Vinílico (LVP)",
  laminate: "Laminado",
  tile: "Cerâmica / porcelanato",
  carpet: "Carpete",
};

const pct = (max: number) => z.coerce.number().min(0, "Não pode ser negativo").max(max, `Máximo ${max}%`);
const money = z.coerce.number().min(0, "Não pode ser negativo").max(10_000);

export const estimateRuleRowSchema = z.object({
  flooring_type: z.string().refine((v) => FLOORING_TYPES.includes(v), "Tipo de piso inválido"),
  waste_percent: pct(100),
  material_markup: pct(500),
  labor_markup: pct(500),
  default_price_per_sqft: money,
  default_labor_per_sqft: money,
});

export const estimateRulesPutSchema = z.object({ rules: z.array(estimateRuleRowSchema).min(1).max(20) });

export function defaultEstimateRule(flooringType: string) {
  return DEFAULT_ESTIMATE_RULES.find((r) => r.flooringType === flooringType) ?? null;
}
