/**
 * Mate AI interpreter: turns a free-form (often voice-transcribed) command into a structured,
 * validated action plan. The LLM only *reads* the sentence and picks catalog entries by
 * reference — customers, jobs and prices are always resolved against the tenant database
 * by the routes, and nothing is created without the user's review.
 *
 * When AI is not configured (or the call fails) we fall back to the rule-based parser.
 */
import { z } from "zod";
import { aiChatJson, isAiConfigured } from "../ai/client.js";
import { normalizeMateAiUnit, parseMateAiCommand, type MateAiCatalogItem } from "./command.js";
import { interpretLocally, type LocalCustomer } from "./local.js";

export const MATE_AI_UNITS = ["sq_ft", "linear_ft", "fixed", "each", "box", "step", "hour"] as const;
export const MATE_AI_INVOICE_TYPES = ["auto", "full", "final", "deposit", "progress", "custom"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const quoteItemSchema = z.object({
  service_text: z.string().trim().max(200).default(""),
  catalog_item_id: z.string().uuid().nullable().optional(),
  catalog_source: z.enum(["quote-catalog", "pricing"]).nullable().optional(),
  quantity: z.number().positive().max(1_000_000),
  unit: z.enum(MATE_AI_UNITS).nullable().optional(),
  /** Ranked catalog guesses to offer first when the service is not certain. */
  candidates: z
    .array(z.object({ id: z.string().uuid(), source: z.enum(["quote-catalog", "pricing"]) }))
    .max(8)
    .optional(),
});

export const quotePlanSchema = z.object({
  action: z.literal("quote"),
  customer_query: z.string().trim().max(200).default(""),
  customer_id: z.string().uuid().nullable().optional(),
  items: z.array(quoteItemSchema).min(1).max(8),
});

export const invoicePlanSchema = z.object({
  action: z.literal("invoice"),
  job_query: z.string().trim().max(200).default(""),
  job_id: z.string().uuid().nullable().optional(),
  customer_query: z.string().trim().max(200).default(""),
  invoice_type: z.enum(MATE_AI_INVOICE_TYPES).default("auto"),
  deposit_pct: z.number().positive().max(100).nullable().optional(),
  custom_amount: z.number().positive().max(9_999_999_999.99).nullable().optional(),
  due_date: z.string().regex(ISO_DATE).nullable().optional(),
});

/** The plan travels back and forth with the browser so picks (customer, service, job) do not re-run the AI. */
export const mateAiPlanSchema = z.discriminatedUnion("action", [quotePlanSchema, invoicePlanSchema]);

export type MateAiQuotePlan = z.infer<typeof quotePlanSchema>;
export type MateAiInvoicePlan = z.infer<typeof invoicePlanSchema>;
export type MateAiPlan = z.infer<typeof mateAiPlanSchema>;

export type InterpretResult =
  | { ok: true; plan: MateAiPlan; source: "ai" | "rules"; warning?: string }
  | { ok: false; error: string; source: "ai" | "rules" };

export type InterpretContext = {
  timezone: string;
  now?: Date;
  catalog: MateAiCatalogItem[];
  /** Company customers, used by the local reader to find names inside the sentence. */
  customers?: LocalCustomer[];
};

/* ───────────────────────── dates ───────────────────────── */

export function todayInTimezone(timezone: string, now = new Date()): { date: string; weekday: string } {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "America/New_York";
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
  return { date, weekday };
}

/** Accepts only real calendar dates within a sane window around today. */
export function validDueDate(value: unknown, today: string): string | null {
  const s = String(value || "").trim();
  if (!ISO_DATE.test(s)) return null;
  const d = new Date(s + "T12:00:00.000Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  const base = new Date(today + "T12:00:00.000Z").getTime();
  const days = (d.getTime() - base) / 86_400_000;
  if (days < -365 || days > 730) return null;
  return s;
}

/* ───────────────────────── prompt ───────────────────────── */

const MAX_CATALOG_IN_PROMPT = 400;

export function catalogRefs(catalog: MateAiCatalogItem[]): Array<{ ref: string; item: MateAiCatalogItem }> {
  return catalog.slice(0, MAX_CATALOG_IN_PROMPT).map((item, index) => ({ ref: "S" + (index + 1), item }));
}

export function buildInterpretSystemPrompt(ctx: { today: string; weekday: string; timezone: string; refs: Array<{ ref: string; item: MateAiCatalogItem }> }): string {
  const catalogLines = ctx.refs
    .map(({ ref, item }) => {
      const unit = normalizeMateAiUnit(item.unit) || item.unit;
      const category = item.category ? " | " + item.category.slice(0, 40) : "";
      return ref + " | " + item.name.slice(0, 90) + " | " + unit + category;
    })
    .join("\n");

  return [
    "You are Mate AI, the assistant inside ObraMate, a CRM for flooring installation companies in the USA.",
    "Users speak Portuguese, English, Spanish or a mix, usually by voice, so expect transcription errors, missing accents and spelled-out numbers.",
    "Read ONE command and return ONLY a JSON object describing the action. Never invent prices, customers or IDs.",
    "",
    "Today is " + ctx.weekday + ", " + ctx.today + " (timezone " + ctx.timezone + ").",
    "",
    "Supported actions:",
    '- "quote": create a quote/orçamento/estimate for a customer with one or more services.',
    '- "invoice": issue an invoice/fatura/cobrança for an existing job (trabalho/obra/serviço/OS).',
    '- "unknown": anything else, or when the request cannot be understood.',
    "",
    "Service catalog of this company (ref | name | unit | category):",
    catalogLines || "(empty)",
    "",
    "Rules for quotes:",
    "- For each service mentioned, set service_ref to the ref of the best catalog entry. Match by meaning across languages",
    '  (e.g. "instalação de madeira" / "piso de madeira" → a Hardwood Installation entry; "tirar o carpete" → Carpet Removal;',
    '  "lixar e envernizar" / "lixa" → Sand & Finish; "rodapé" → baseboard; "degraus"/"escada" → stairs/steps; "vinil"/"LVP"; "laminado").',
    "- If two entries fit equally well, or none fits, set service_ref to null and keep the user's words in service_text.",
    "- service_text: the user's own words for the service (short).",
    '- quantity: a number. Convert words and formats: "mil trezentos e cinquenta" = 1350, "1.350" (pt) = 1350, "1,350" (en) = 1350, "1350,5" = 1350.5.',
    '- unit: one of sq_ft, linear_ft, fixed, each, box, step, hour. In flooring, "pés", "pés quadrados", "feet", "square", "sqft", "pé" for an area service mean sq_ft;',
    '  "pés lineares", "linear", "LF" mean linear_ft; "degraus"/"steps" mean step; "caixas" mean box; "horas" mean hour; "unidades"/"peças" mean each.',
    "  If the user gives no unit, use the unit of the chosen catalog entry.",
    "- customer: the customer's name exactly as said (no titles like 'cliente', 'o', 'a', 'Mr').",
    "",
    "Rules for invoices:",
    '- job: how the user identified the job (number like "1042" or "#1042", title, address, or description). Empty string if only the customer was given.',
    "- customer: customer/builder name if mentioned, else empty string.",
    '- invoice_type: "deposit" (sinal/entrada/depósito), "progress" (parcial), "final" (saldo/restante/final), "full" (total/completo/inteiro), "custom" (a specific dollar amount), or "auto" when not said.',
    "- deposit_pct: percentage for deposits when said (e.g. 30), else null. amount: dollar amount for custom invoices, else null.",
    '- due_date: the date the user gave for the invoice ("para dia 30", "vencimento sexta", "due next Friday", "fim do mês"), resolved to YYYY-MM-DD relative to today; null if none.',
    "",
    "If something essential is missing (no customer for a quote, no service/quantity, no job or customer for an invoice), still return what you have and put a short question in the user's language in \"question\".",
    "",
    "JSON shape (all keys required):",
    '{"action":"quote"|"invoice"|"unknown","customer":string,"items":[{"service_ref":string|null,"service_text":string,"quantity":number|null,"unit":string|null}],"job":string,"invoice_type":string,"deposit_pct":number|null,"amount":number|null,"due_date":string|null,"question":string|null,"language":"pt"|"en"|"es"}',
  ].join("\n");
}

/* ───────────────────────── model output → plan ───────────────────────── */

const looseNumber = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const s = String(value).trim().replace(/[$\s]/g, "");
  // "1.350" / "1,350" → 1350 ; "1350,5" → 1350.5
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  return Number(s.replace(",", "."));
}, z.number().finite().nullable().catch(null));

const modelOutputSchema = z.object({
  action: z.enum(["quote", "invoice", "unknown"]).catch("unknown"),
  customer: z.string().nullable().catch(null).default(null),
  items: z
    .array(
      z.object({
        service_ref: z.string().nullable().catch(null).default(null),
        service_text: z.string().nullable().catch(null).default(null),
        quantity: looseNumber.default(null),
        unit: z.string().nullable().catch(null).default(null),
      }),
    )
    .catch([])
    .default([]),
  job: z.string().nullable().catch(null).default(null),
  invoice_type: z.string().nullable().catch(null).default(null),
  deposit_pct: looseNumber.default(null),
  amount: looseNumber.default(null),
  due_date: z.string().nullable().catch(null).default(null),
  question: z.string().nullable().catch(null).default(null),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

function unitFrom(value: string | null | undefined): (typeof MATE_AI_UNITS)[number] | null {
  if (!value) return null;
  const direct = MATE_AI_UNITS.find((u) => u === value);
  if (direct) return direct;
  const normalized = normalizeMateAiUnit(value);
  return (MATE_AI_UNITS as readonly string[]).includes(normalized || "") ? (normalized as (typeof MATE_AI_UNITS)[number]) : null;
}

function cleanName(value: string | null | undefined): string {
  return String(value || "")
    .replace(/^\s*(?:(?:o|a|the|para|for)\s+)?(?:cliente|customer|client)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Validates the model's JSON against the catalog refs we sent. Unknown refs are dropped
 * (the route then falls back to lexical matching on service_text) — the model can never
 * introduce an item that is not in this tenant's catalog.
 */
export function planFromModelOutput(
  raw: unknown,
  refs: Array<{ ref: string; item: MateAiCatalogItem }>,
  today: string,
): { ok: true; plan: MateAiPlan } | { ok: false; error: string } {
  const out = modelOutputSchema.safeParse(raw);
  if (!out.success) return { ok: false, error: "Não consegui entender o comando." };
  const data = out.data;
  const question = data.question?.trim() || null;

  if (data.action === "quote") {
    const byRef = new Map(refs.map((r) => [r.ref.toUpperCase(), r.item]));
    const items: MateAiQuotePlan["items"] = [];
    for (const raw of data.items.slice(0, 8)) {
      const item = raw.service_ref ? byRef.get(String(raw.service_ref).trim().toUpperCase()) : undefined;
      const quantity = raw.quantity == null ? NaN : round2(raw.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) continue;
      const unit = unitFrom(raw.unit) || (item ? unitFrom(item.unit) : null);
      items.push({
        service_text: String(raw.service_text || item?.name || "").trim().slice(0, 200),
        catalog_item_id: item?.id ?? null,
        catalog_source: item?.source ?? null,
        quantity,
        unit,
      });
    }
    if (!items.length) {
      return { ok: false, error: question || "Diga o serviço e a quantidade, por exemplo: “1350 sqft de instalação de hardwood”." };
    }
    const customer = cleanName(data.customer);
    return {
      ok: true,
      plan: { action: "quote", customer_query: customer, customer_id: null, items },
    };
  }

  if (data.action === "invoice") {
    const job = String(data.job || "").trim().slice(0, 200);
    const customer = cleanName(data.customer);
    if (!job && !customer) {
      return { ok: false, error: question || "Qual job devo faturar? Diga o número do job ou o nome do cliente." };
    }
    const type = (MATE_AI_INVOICE_TYPES as readonly string[]).includes(String(data.invoice_type))
      ? (data.invoice_type as MateAiInvoicePlan["invoice_type"])
      : "auto";
    const depositPct = data.deposit_pct != null && data.deposit_pct > 0 && data.deposit_pct <= 100 ? round2(data.deposit_pct) : null;
    const amount = data.amount != null && data.amount > 0 && data.amount <= 9_999_999_999.99 ? round2(data.amount) : null;
    return {
      ok: true,
      plan: {
        action: "invoice",
        job_query: job,
        job_id: null,
        customer_query: customer,
        invoice_type: type === "custom" && amount == null ? "auto" : type,
        deposit_pct: depositPct,
        custom_amount: amount,
        due_date: validDueDate(data.due_date, today),
      },
    };
  }

  return {
    ok: false,
    error:
      question ||
      "Ainda não sei fazer isso. Posso criar Quotes (“Quote para Maria com 800 sqft de hardwood”) e emitir invoices de jobs (“Fatura do job 1042 para dia 30”).",
  };
}

/* ───────────────────────── fallback ───────────────────────── */

export function planFromRules(command: string): { ok: true; plan: MateAiPlan } | { ok: false; error: string } {
  try {
    const parsed = parseMateAiCommand(command);
    return {
      ok: true,
      plan: {
        action: "quote",
        customer_query: parsed.customerQuery,
        customer_id: null,
        items: parsed.items.map((item) => ({
          service_text: item.serviceQuery,
          catalog_item_id: null,
          catalog_source: null,
          quantity: item.quantity,
          unit: unitFrom(item.unit),
        })),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "parse_failed" };
  }
}

/* ───────────────────────── entry point ───────────────────────── */

/** Fast, inexpensive current model for short JSON extraction (gpt-4o/4.1 leave the API in Jan 2027). */
export const MATE_AI_DEFAULT_MODEL = "gpt-6-luna";
export const MATE_AI_DEFAULT_TRANSCRIBE_MODEL = "gpt-transcribe";

export function mateAiChatModel(): string {
  return process.env.MATE_AI_MODEL?.trim() || MATE_AI_DEFAULT_MODEL;
}

export function mateAiTranscribeModel(): string {
  return process.env.MATE_AI_TRANSCRIBE_MODEL?.trim() || MATE_AI_DEFAULT_TRANSCRIBE_MODEL;
}

export async function interpretMateAiCommand(command: string, ctx: InterpretContext): Promise<InterpretResult> {
  const text = String(command || "").trim();
  const { date, weekday } = todayInTimezone(ctx.timezone, ctx.now);
  const local = () => interpretLocally(text, { today: date, catalog: ctx.catalog, customers: ctx.customers || [] });

  if (!isAiConfigured()) {
    const result = local();
    return result.ok ? { ...result, source: "rules" } : { ok: false, error: result.error, source: "rules" };
  }

  const refs = catalogRefs(ctx.catalog);
  const system = buildInterpretSystemPrompt({ today: date, weekday, timezone: ctx.timezone, refs });
  let ai = await aiChatJson({ system, user: text, timeoutMs: 30_000, model: mateAiChatModel() });
  if (!ai.ok && ai.status && [400, 403, 404].includes(ai.status) && /model/i.test(ai.error)) {
    // Model not available for this key/provider: use the account's default chat model.
    console.warn("[mate-ai] model " + mateAiChatModel() + " unavailable, using default:", ai.error);
    ai = await aiChatJson({ system, user: text, timeoutMs: 30_000 });
  }

  if (!ai.ok) {
    console.warn("[mate-ai] interpreter unavailable, using local reader:", ai.error);
    const result = local();
    if (result.ok) return { ...result, source: "rules", warning: "A IA não respondeu; usei a leitura básica do pedido." };
    return { ok: false, error: /plano|limite/i.test(ai.error) ? ai.error : result.error, source: "rules" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(ai.text);
  } catch {
    const result = local();
    return result.ok ? { ...result, source: "rules" } : { ok: false, error: "Não consegui entender o comando. Tente de novo.", source: "ai" };
  }
  const result = planFromModelOutput(parsedJson, refs, date);
  return result.ok ? { ...result, source: "ai" } : { ok: false, error: result.error, source: "ai" };
}
