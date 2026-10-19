/**
 * Mate AI agent: picks ONE action from the registry for what the user said, with arguments.
 * The model only reads the sentence (plus the screen the user is on and the last turns of the
 * conversation) and names an action; resolving records, prices and permissions is done by the
 * actions themselves against the tenant's data, and nothing changes before a confirmation.
 */
import { z } from "zod";
import { aiChatJson, isAiConfigured } from "../ai/client.js";
import type { MateAiCatalogItem } from "./command.js";
import { normalizeMateAiUnit } from "./command.js";
import { catalogRefs, mateAiChatModel, todayInTimezone, validDueDate } from "./interpret.js";
import { foldText, interpretLocally, parseSpokenDate, type LocalCustomer } from "./local.js";
import type { ActionDef } from "./actions/types.js";

/* ───────────────────────── registry ───────────────────────── */

const registry = new Map<string, ActionDef>();

export function registerAction(def: ActionDef): void {
  registry.set(def.name, def);
}

export function getAction(name: string): ActionDef | undefined {
  return registry.get(name);
}

export function listActions(): ActionDef[] {
  return [...registry.values()];
}

export function canUse(def: ActionDef, user: { roleKey?: string | null; permissions: string[] } | undefined): boolean {
  if (!user) return false;
  if (user.roleKey === "admin") return true;
  return def.permissions.every((p) => user.permissions.includes(p));
}

/* ───────────────────────── conversation ───────────────────────── */

export const memorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().max(400),
      entity: z.object({ type: z.string().max(40), id: z.string().uuid() }).nullable().optional(),
    }),
  )
  .max(12)
  .default([]);

export type MemoryLine = z.infer<typeof memorySchema>[number];

export type ScreenSummary = { type: string; id: string; label: string } | null;

export type AgentPick =
  | { kind: "action"; action: string; args: Record<string, unknown>; source: "ai" | "rules"; reply?: string }
  | { kind: "reply"; reply: string; source: "ai" | "rules" };

/* ───────────────────────── prompt ───────────────────────── */

function argLines(def: ActionDef): string {
  return Object.entries(def.args)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join("\n");
}

export function buildAgentPrompt(p: {
  actions: ActionDef[];
  catalog: MateAiCatalogItem[];
  today: string;
  weekday: string;
  timezone: string;
  screen: ScreenSummary;
  memory: MemoryLine[];
  userName?: string;
}): string {
  const refs = catalogRefs(p.catalog)
    .map(({ ref, item }) => `${ref} | ${item.name.slice(0, 80)} | ${normalizeMateAiUnit(item.unit) || item.unit}`)
    .join("\n");
  const actions = p.actions
    .map((a) => `- ${a.name}: ${a.description}\n  args:\n${argLines(a) || "    (none)"}\n  e.g. ${a.examples.slice(0, 2).map((e) => `"${e}"`).join(" · ")}`)
    .join("\n");
  const memory = p.memory.length
    ? p.memory.map((m) => `${m.role === "user" ? "User" : "Mate"}: ${m.text}${m.entity ? ` [${m.entity.type} ${m.entity.id}]` : ""}`).join("\n")
    : "(start of conversation)";
  return [
    "You are Mate AI, the assistant inside ObraMate, a CRM for flooring installation companies in the USA.",
    "People talk to you by voice or text in Portuguese, English or Spanish, often mixed, with transcription errors.",
    "Pick exactly ONE action from the list for the user's last message and fill its args from what they said.",
    "Never invent prices, IDs, people or amounts. Resolving customers, jobs and prices is done by the system.",
    "",
    `Today is ${p.weekday}, ${p.today} (timezone ${p.timezone}). Resolve relative dates ("sexta", "amanhã", "next week", "dia 30") to YYYY-MM-DD.`,
    p.userName ? `The user is ${p.userName}.` : "",
    p.screen
      ? `The user is looking at: ${p.screen.label} (${p.screen.type} ${p.screen.id}). When they say "este", "esse job", "this quote" or give no record, it is this one — leave the record args empty.`
      : "The user is not on a specific record.",
    "",
    "Recent conversation (use it for follow-ups like \"agora manda por SMS\" or \"o mesmo para o Mike\"; you may put an id shown in [brackets] into the matching *_id arg):",
    memory,
    "",
    "Actions:",
    actions,
    "",
    "Service catalog for quote items (ref | name | unit). For each service said, set service_ref to the best ref by meaning across languages",
    '("madeira"/"piso de madeira" → Hardwood Installation, "tirar carpete" → Carpet Removal, "lixa" → Sand & Finish, "rodapé" → baseboard, "degraus" → stairs/steps);',
    "null when unsure. quantity is a number (\"mil trezentos e cinquenta\" = 1350, \"1.350\" = 1350). unit: sq_ft | linear_ft | fixed | each | box | step | hour —",
    '"pés"/"feet"/"square" = sq_ft for area services, "pés lineares"/"LF" = linear_ft, "degraus"/"steps" = step.',
    refs || "(empty)",
    "",
    "Quote items shape: items: [{\"service_ref\": \"S3\"|null, \"service_text\": \"user's words\", \"quantity\": 1350, \"unit\": \"sq_ft\"}].",
    "",
    "If the message is a greeting, unclear, or not supported, use action \"none\" and write a SHORT reply in the user's language saying what you can do.",
    "If something essential is missing, still choose the action with what you have — the system will ask.",
    "",
    'Return ONLY JSON: {"action": "<name>|none", "args": {…}, "reply": string|null}',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/* ───────────────────────── model output → pick ───────────────────────── */

const pickSchema = z.object({
  action: z.string().max(60).catch("none"),
  args: z.record(z.string(), z.unknown()).catch({}).default({}),
  reply: z.string().max(600).nullable().catch(null).default(null),
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[$\s]/g, "");
  const n = /^\d{1,3}([.,]\d{3})+$/.test(s) ? Number(s.replace(/[.,]/g, "")) : Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Maps catalog refs (S1…) back to tenant catalog ids; unknown refs are dropped. */
function mapItems(raw: unknown, catalog: MateAiCatalogItem[]): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const refs = new Map(catalogRefs(catalog).map((r) => [r.ref.toUpperCase(), r.item]));
  const out: Array<Record<string, unknown>> = [];
  for (const it of raw.slice(0, 8)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const item = o.service_ref ? refs.get(String(o.service_ref).toUpperCase()) : undefined;
    const qty = toNumber(o.quantity);
    if (qty == null || qty <= 0 || qty > 1_000_000) continue;
    const unit = normalizeMateAiUnit(String(o.unit || "")) || (item ? normalizeMateAiUnit(item.unit) : null);
    out.push({
      service_text: String(o.service_text || item?.name || "").slice(0, 200),
      catalog_item_id: item?.id ?? (typeof o.catalog_item_id === "string" ? o.catalog_item_id : null),
      catalog_source: item?.source ?? (typeof o.catalog_source === "string" ? o.catalog_source : null),
      quantity: round2(qty),
      unit: unit && ["sq_ft", "linear_ft", "fixed", "each", "box", "step", "hour"].includes(unit) ? unit : null,
    });
  }
  return out;
}

/** Normalizes the args the model wrote for the actions with special shapes. */
export function normalizeArgs(action: string, args: Record<string, unknown>, catalog: MateAiCatalogItem[], today: string): Record<string, unknown> {
  const a: Record<string, unknown> = { ...args };
  if (Array.isArray(a.items)) a.items = mapItems(a.items, catalog);
  for (const k of ["date", "due_date", "to", "from"]) {
    if (typeof a[k] === "string" && a[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(a[k]))) {
      a[k] = parseSpokenDate(String(a[k]), today) ?? "";
    }
  }
  if (typeof a.due_date === "string" && a.due_date) a.due_date = validDueDate(a.due_date, today) ?? "";
  if (action === "quote.create") {
    return {
      customer_query: String(a.customer_query ?? a.customer ?? "").slice(0, 200),
      customer_id: typeof a.customer_id === "string" ? a.customer_id : null,
      items: a.items ?? [],
    };
  }
  if (action === "invoice.job") {
    return {
      job_query: String(a.job_query ?? a.job ?? "").slice(0, 200),
      job_id: typeof a.job_id === "string" ? a.job_id : null,
      customer_query: String(a.customer_query ?? a.customer ?? "").slice(0, 200),
      invoice_type: ["auto", "full", "final", "deposit", "progress", "custom"].includes(String(a.invoice_type)) ? a.invoice_type : "auto",
      deposit_pct: toNumber(a.deposit_pct),
      custom_amount: toNumber(a.custom_amount ?? a.amount),
      due_date: a.due_date || null,
    };
  }
  return a;
}

/* ───────────────────────── local reader (no AI) ───────────────────────── */

const LOCAL_INTENTS: Array<{ re: RegExp; action: string; args: (t: string, today: string) => Record<string, unknown> }> = [
  { re: /\b(agenda|o que tem|what'?s on|schedule for|programa[cç][aã]o)\b/, action: "agenda.list", args: (t, today) => ({ date: parseSpokenDate(t, today) || today }) },
  { re: /\bquanto (eu )?(faturei|fature|recebi|vendi)|\b(revenue|how much did i (bill|invoice|receive|make))\b/, action: "money.summary", args: (t) => ({ period: /semana passada|last week/.test(t) ? "last_week" : /semana|week/.test(t) ? "this_week" : /mes passado|last month/.test(t) ? "last_month" : /ano|year/.test(t) ? "this_year" : /hoje|today/.test(t) ? "today" : "this_month" }) },
  { re: /\b(vencid|atrasad|overdue|me devendo|owe me)\b/, action: "invoices.overdue", args: () => ({}) },
  { re: /\b(sem invoice|sem fatura|a faturar|falta faturar|uninvoiced|to bill|need to bill)\b/, action: "jobs.uninvoiced", args: () => ({}) },
  { re: /\b(sem resposta|nao respond|no response|waiting on)\b/, action: "quotes.followup", args: (t) => ({ days: Number(t.match(/(\d{1,2})\s*dias?/)?.[1] || 7) }) },
];

export function pickLocally(text: string, ctx: { today: string; catalog: MateAiCatalogItem[]; customers: LocalCustomer[] }): AgentPick {
  const folded = foldText(text);
  for (const intent of LOCAL_INTENTS) {
    if (intent.re.test(folded)) return { kind: "action", action: intent.action, args: intent.args(folded, ctx.today), source: "rules" };
  }
  const local = interpretLocally(text, ctx);
  if (local.ok) {
    if (local.plan.action === "quote") return { kind: "action", action: "quote.create", args: local.plan as unknown as Record<string, unknown>, source: "rules" };
    return { kind: "action", action: "invoice.job", args: local.plan as unknown as Record<string, unknown>, source: "rules" };
  }
  return { kind: "reply", reply: local.error, source: "rules" };
}

/* ───────────────────────── entry ───────────────────────── */

export async function pickAction(
  text: string,
  ctx: {
    actions: ActionDef[];
    catalog: MateAiCatalogItem[];
    customers: LocalCustomer[];
    timezone: string;
    screen: ScreenSummary;
    memory: MemoryLine[];
    userName?: string;
  },
): Promise<AgentPick> {
  const { date, weekday } = todayInTimezone(ctx.timezone);
  const allowed = new Set(ctx.actions.map((a) => a.name));
  const local = () => {
    const p = pickLocally(text, { today: date, catalog: ctx.catalog, customers: ctx.customers });
    if (p.kind === "action" && !allowed.has(p.action)) {
      return { kind: "reply" as const, reply: "Você não tem permissão para isso.", source: "rules" as const };
    }
    return p;
  };
  if (!isAiConfigured()) return local();

  const system = buildAgentPrompt({ actions: ctx.actions, catalog: ctx.catalog, today: date, weekday, timezone: ctx.timezone, screen: ctx.screen, memory: ctx.memory, userName: ctx.userName });
  let ai = await aiChatJson({ system, user: text, timeoutMs: 30_000, model: mateAiChatModel() });
  if (!ai.ok && ai.status && [400, 403, 404].includes(ai.status) && /model/i.test(ai.error)) {
    ai = await aiChatJson({ system, user: text, timeoutMs: 30_000 });
  }
  if (!ai.ok) {
    console.warn("[mate-ai] agent model unavailable, using local reader:", ai.error);
    if (/plano|limite/i.test(ai.error)) return { kind: "reply", reply: ai.error, source: "rules" };
    const p = local();
    return p.kind === "action" ? { ...p, reply: "A IA não respondeu; usei a leitura básica do pedido." } : p;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(ai.text);
  } catch {
    return local();
  }
  const parsed = pickSchema.parse(raw);
  if (parsed.action === "none" || !allowed.has(parsed.action)) {
    if (parsed.action !== "none" && getAction(parsed.action)) {
      return { kind: "reply", reply: "Você não tem permissão para isso. Peça a um administrador.", source: "ai" };
    }
    return {
      kind: "reply",
      reply:
        parsed.reply ||
        "Posso criar e editar Quotes, emitir e enviar invoices, registrar pagamentos, cuidar de leads, clientes, jobs e agenda, e responder sobre faturamento. O que você precisa?",
      source: "ai",
    };
  }
  return { kind: "action", action: parsed.action, args: normalizeArgs(parsed.action, parsed.args, ctx.catalog, date), source: "ai", reply: parsed.reply || undefined };
}

/** Applies a clarification choice or a card edit: dot paths ("items.0.catalog_item_id") → value. */
export function applyPatch(args: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>;
  for (const [path, value] of Object.entries(patch || {})) {
    const keys = path.split(".").slice(0, 6);
    if (keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) continue;
    let node: Record<string, unknown> | unknown[] = out;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      const nextIsIndex = /^\d+$/.test(keys[i + 1]!);
      const container = node as Record<string, unknown>;
      if (container[k] == null || typeof container[k] !== "object") container[k] = nextIsIndex ? [] : {};
      node = container[k] as Record<string, unknown>;
    }
    (node as Record<string, unknown>)[keys.at(-1)!] = value;
  }
  return out;
}
