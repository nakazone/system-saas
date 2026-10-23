/**
 * Mate AI agent: picks ONE action from the registry for what the user said, with arguments.
 * The model only reads the sentence (plus the screen the user is on and the last turns of the
 * conversation) and names an action; resolving records, prices and permissions is done by the
 * actions themselves against the tenant's data, and nothing changes before a confirmation.
 */
import { z } from "zod";
import { aiChatJson, aiChatTurn, isAiConfigured, noteAiError, type AiTool, type AiTurn } from "../ai/client.js";
import type { MateAiCatalogItem } from "./command.js";
import { normalizeMateAiUnit } from "./command.js";
import { catalogRefs, mateAiChatModel, todayInTimezone, validDueDate } from "./interpret.js";
import { foldText, interpretLocally, parseSpokenDate, type LocalCustomer } from "./local.js";
import type { ActionDef } from "./actions/types.js";
import { LOOKUP_TOOLS } from "./lookups.js";

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
  if (!def.permissions.every((p) => user.permissions.includes(p))) return false;
  return !def.anyPermissions?.length || def.anyPermissions.some((p) => user.permissions.includes(p));
}

/* ───────────────────────── conversation ───────────────────────── */

export const memorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().max(900),
      entity: z.object({ type: z.string().max(40), id: z.string().uuid() }).nullable().optional(),
    }),
  )
  .max(12)
  .default([]);

export type MemoryLine = z.infer<typeof memorySchema>[number];

export type ScreenSummary = { type: string; id: string; label: string } | null;

export type AgentPick =
  | { kind: "action"; action: string; args: Record<string, unknown>; source: "ai" | "rules"; reply?: string; aiError?: string }
  | { kind: "reply"; reply: string; source: "ai" | "rules"; aiError?: string };

/** The last card / question / error shown and not yet confirmed: follow-ups refer to it. */
export const pendingSchema = z
  .object({
    action: z.string().max(60),
    args: z.record(z.string(), z.unknown()),
    status: z.enum(["card", "clarify", "error", "answer"]),
    summary: z.string().max(600).default(""),
  })
  .nullable()
  .optional();

export type Pending = z.infer<typeof pendingSchema>;

/* ───────────────────────── prompt ───────────────────────── */

function argLines(def: ActionDef): string {
  return Object.entries(def.args)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join("\n");
}

/** A named office employee answering in their own voice (virtual office). */
export type AgentPersona = {
  name: string;
  title: string;
  department: string;
  description: string;
  /** The general manager (the Mate) knows the whole office. */
  manager: boolean;
  company?: string;
  /** "Lara (Assistente comercial, Comercial)". */
  colleagues: string[];
  /** What is on this employee's desk right now, from the office suggestions. */
  desk: string[];
};

function personaLines(persona: AgentPersona, userName?: string): string[] {
  const first = (userName || "").trim().split(/\s+/)[0] || "";
  return [
    `You are ${persona.name}, ${persona.title} (${persona.department}) on the team of ${persona.company || "this company"}, inside ObraMate's virtual office. ObraMate is a CRM for flooring installation companies in the USA.`,
    "You are an AI assistant with a name and a face. If someone asks whether you are a real person, say plainly that you are the company's AI assistant.",
    `Talk like a friendly coworker at the next desk: casual, warm and natural, first person, 1–3 short sentences, no lists unless asked, no emojis.${first ? ` The user is ${first}; use the name now and then.` : ""}`,
    "Answer in the user's language. In Portuguese use everyday Brazilian Portuguese (\"oi\", \"tudo certo\", \"pode deixar\", \"bora\").",
    "Small talk is welcome — greetings, \"tudo bem?\", thanks, \"como tá o dia?\", a joke, \"bom trabalho\": answer in character with a reply. When it fits, mention ONE concrete thing from your desk and offer to take care of it.",
    persona.manager
      ? "You are the general manager: you coordinate the team, know what is on everyone's desk and can say who should handle what."
      : `Your area: ${persona.description}`,
    persona.colleagues.length ? `Your colleagues: ${persona.colleagues.join("; ")}. If a request belongs to one of them, say who handles it and that they can talk to them at their desk.` : "",
    persona.desk.length ? `On your desk right now:\n${persona.desk.map((d) => `- ${d}`).join("\n")}` : "Your desk is clear right now; nothing urgent in your area.",
    "Questions about data (\"tem mais algum?\", \"quanto falta receber?\", \"quem não pagou?\", \"e além desses?\") are yours to answer: look it up (for invoices use find_invoices with status open or overdue) and reply in words with the names and amounts. For follow-ups like \"além desses\", leave out what was already mentioned in the conversation and say clearly when there is nothing else. Use a list action only when the user asks to see or act on a list.",
    "Talk about what is on your desk (\"tenho aqui…\", \"apareceram…\"). Never say you are in the middle of doing something (\"tô acompanhando\", \"tô vendo\") unless you looked it up in this conversation.",
    "Never claim you already did, sent or changed something. Work happens only through the actions below, and the user confirms each one first.",
  ];
}

/** Offline (no AI key) small talk in the employee's voice. */
export function personaLocalReply(text: string, persona: AgentPersona, userName?: string): string | null {
  const t = text.toLowerCase();
  const first = (userName || "").trim().split(/\s+/)[0] || "";
  const hi = first ? `Oi, ${first}!` : "Oi!";
  const deskLine = persona.desk.length ? ` Por aqui tem ${persona.desk[0].replace(/\.$/, "")}. Quer que eu cuide disso?` : " Por aqui está tudo em dia.";
  if (/^(oi|ol[aá]|e a[ií]|opa|bom dia|boa tarde|boa noite|hey|hi|hello|fala)\b/.test(t) || /tudo (bem|certo|bom)|como (vai|est[aá]|t[aá])/.test(t)) {
    return `${hi} Tudo certo por aqui.${deskLine}`;
  }
  if (/obrigad|valeu|thanks|brigad/.test(t)) return `Imagina${first ? `, ${first}` : ""}! Qualquer coisa, é só chamar.`;
  if (/(voc[eê]|vc) [eé] (uma )?(pessoa|humana|real|rob[oô]|ia)/.test(t)) return `Sou assistente de IA da empresa (${persona.title.toLowerCase()}). Mas pode falar comigo como com qualquer colega.`;
  return null;
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
  pending?: Pending;
  tools?: boolean;
  persona?: AgentPersona;
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
    ...(p.persona ? personaLines(p.persona, p.userName) : ["You are Mate AI, the assistant inside ObraMate, a CRM for flooring installation companies in the USA."]),
    "People talk to you by voice or text in Portuguese, English or Spanish, often mixed, with transcription errors.",
    p.persona
      ? "When the user asks for work, pick exactly ONE action from the list and fill its args from what they said; for conversation, reply."
      : "Pick exactly ONE action from the list for the user's last message and fill its args from what they said.",
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
    "When the user changes the rate/price/quantity of a CONFIRMED quote in the current screen or recent conversation, use quote.edit with line_item plus unit_price/quantity. A unit-only reference like \"sqft\" is valid; the system will match the quote's line or ask which one if several match.",
    "",
    pendingBlock(p.pending),
    "Quote items may carry unit_price (dollars per unit) when the user states a price for a line — e.g. \"a remoção de carpete é 1 dólar o pé\" → that line's unit_price: 1.",
    "History lines end with tags like [quote <id>], [invoice <id>], [job <id>], [customer <id>] for records created or changed in this conversation. When the user refers to one of them (\"o último quote\", \"esse quote\", \"o quote que você criou\", \"esse job\"), pass that exact id as quote_id / invoice_id / job_id / customer_id — the NEWEST tag of that type unless they say otherwise. Never pick another record of the same customer, and never invent ids.",
    "If the user says \"o último quote\" and no tag fits, set quote: \"latest\" (with the customer if named) — never guess a number.",
    "History lines starting with \"Proposed, NOT confirmed\" are cards the user saw but did not confirm: they do not exist in the system. When the user refers to one (\"esse quote\", \"cria um novo com esse valor\", \"envia esse\"), re-propose that action with its args (adding send for quote.create when they ask to send) instead of searching existing records.",
    "A price \"para esse cliente\" / \"pro Naka\" is a special price for that customer: on a quote line use unit_price; to save it use pricing.set with column customer.",
    "If something essential is missing, still choose the action with what you have — the system will ask.",
    ...(p.tools
      ? [
          "",
          "You can look things up before deciding (find_customers, find_jobs, find_quotes, find_invoices, find_leads, find_prices). Use them when the request depends on data (which quote, a price, who owes, a past job). Do not look up what the system resolves anyway (a clear customer name for a new quote).",
          "Finish with exactly one call: propose_action (an action from the list with its args) or reply (a short message in the user's language — answers to questions you looked up, a greeting, or what you can do).",
        ]
      : [
          "",
          p.persona
            ? "If the message is conversation (greeting, small talk, a question you can answer from your desk) or not supported, use action \"none\" and write the reply in character."
            : "If the message is a greeting, unclear, or not supported, use action \"none\" and write a SHORT reply in the user's language saying what you can do.",
          'Return ONLY JSON: {"action": "<name>|none", "args": {…}, "reply": string|null}',
        ]),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function pendingBlock(pending: Pending): string {
  if (!pending) return "";
  const args = JSON.stringify(pending.args).slice(0, 3500);
  return [
    "",
    `OPEN ITEM — the last thing shown to the user: action ${pending.action}, state ${pending.status}${pending.summary ? `: "${pending.summary}"` : ""}.`,
    pending.status === "card"
      ? "IMPORTANT: this card was only PROPOSED. The user has NOT confirmed it, so it does NOT exist in the system yet (a quote card is not a quote yet — lookups will not find it)."
      : "",
    `Its current args: ${args}`,
    "If the user's message continues, corrects or answers this item (a price, a quantity, a date, a name, \"sim\", \"não, 1500\", \"o preço é 1 dólar\", \"tira a remoção\", \"pro Mike também\"), propose the SAME action with the COMPLETE updated args: copy every existing arg and change only what they said.",
    pending.action === "quote.create"
      ? "For a price or quantity change to a line on this open quote card, keep quote.create and update that item in its args, preserving its catalog_item_id and catalog_source. This card is not a saved quote: do not call quote.edit or look up a saved quote."
      : "",
    pending.action === "quote.create"
      ? "If they ask to SEND this quote (\"envia por e-mail\", \"manda pro cliente\", \"esse quote você envia\"), propose quote.create again with the same args plus send: \"email\" (or \"sms\" / \"link\") — it creates and sends with one confirmation. Never pick an older existing quote for this."
      : "",
    "If they state a price for a customer or customer type (\"o preço para esse cliente é 80 cents\"), and the open item is a quote, put it as that line's unit_price; if they also want it saved, use pricing.set.",
    "If the message is a new, unrelated request, ignore the open item.",
  ].join("\n");
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
      ...(toNumber(o.unit_price) != null && toNumber(o.unit_price)! > 0 ? { unit_price: round2(toNumber(o.unit_price)!) } : {}),
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
      ...(["email", "sms", "link"].includes(String(a.send)) ? { send: a.send } : {}),
      ...(typeof a.send_to === "string" && a.send_to.includes("@") ? { send_to: a.send_to.trim().slice(0, 200) } : {}),
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

export type AgentCtx = {
  actions: ActionDef[];
  catalog: MateAiCatalogItem[];
  customers: LocalCustomer[];
  timezone: string;
  screen: ScreenSummary;
  memory: MemoryLine[];
  pending?: Pending;
  userName?: string;
  /** Runs a read-only lookup tool inside the tenant. */
  lookup?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Set when the user talks to a named office employee. */
  persona?: AgentPersona;
};

const MAX_TOOL_ROUNDS = 4;

function terminalTools(actions: ActionDef[]): AiTool[] {
  return [
    {
      type: "function",
      function: {
        name: "propose_action",
        description: "Finish: prepare ONE action for the user to confirm. args follow the action's arg list.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: actions.map((a) => a.name) },
            args: { type: "object", description: "Arguments for the action", additionalProperties: true },
          },
          required: ["action", "args"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reply",
        description: "Finish with a short message to the user (answer, greeting, or what you can do). No action.",
        parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      },
    },
  ];
}

function historyTurns(memory: MemoryLine[]): AiTurn[] {
  return memory.slice(-10).map((m) =>
    m.role === "user"
      ? { role: "user" as const, content: m.text }
      : { role: "assistant" as const, content: m.text + (m.entity ? ` [${m.entity.type} ${m.entity.id}]` : "") },
  );
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const WHAT_I_DO =
  "Posso criar e editar Quotes, emitir e enviar invoices, registrar pagamentos, cuidar de leads, clientes, jobs e agenda, salvar preços e responder sobre o sistema. O que você precisa?";

function finish(action: string, args: Record<string, unknown>, ctx: AgentCtx, today: string, source: "ai" | "rules"): AgentPick {
  const allowed = new Set(ctx.actions.map((a) => a.name));
  if (!allowed.has(action)) {
    if (getAction(action)) return { kind: "reply", reply: "Você não tem permissão para isso. Peça a um administrador.", source };
    return { kind: "reply", reply: WHAT_I_DO, source };
  }
  return { kind: "action", action, args: normalizeArgs(action, args, ctx.catalog, today), source };
}

/** Conversation with read-only lookups; ends in one proposed action or a reply. */
async function converseWithTools(text: string, ctx: AgentCtx, today: string, weekday: string, model: string): Promise<AgentPick | { error: string; status?: number }> {
  const system = buildAgentPrompt({ actions: ctx.actions, catalog: ctx.catalog, today, weekday, timezone: ctx.timezone, screen: ctx.screen, memory: [], userName: ctx.userName, pending: ctx.pending, tools: true, persona: ctx.persona });
  const tools = [...LOOKUP_TOOLS, ...terminalTools(ctx.actions)];
  const messages: AiTurn[] = [{ role: "system", content: system }, ...historyTurns(ctx.memory), { role: "user", content: text }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const last = round === MAX_TOOL_ROUNDS - 1;
    const res = await aiChatTurn({
      messages,
      model,
      tools: last ? terminalTools(ctx.actions) : tools,
      toolChoice: "required",
      timeoutMs: 40_000,
      countUse: round === 0,
    });
    if (!res.ok) return { error: res.error, status: res.status };
    if (!res.toolCalls.length) {
      // Some models answer in text even when a tool is required.
      const content = res.content.trim();
      if (!content) return { kind: "reply", reply: WHAT_I_DO, source: "ai" };
      const json = parseArgs(content.replace(/^```(?:json)?|```$/g, ""));
      if (typeof json.action === "string" && json.action !== "none") return finish(json.action, (json.args as Record<string, unknown>) || {}, ctx, today, "ai");
      return { kind: "reply", reply: String(json.reply || content).slice(0, 1200), source: "ai" };
    }
    const terminal = res.toolCalls.find((c) => c.function.name === "propose_action" || c.function.name === "reply");
    if (terminal) {
      const a = parseArgs(terminal.function.arguments);
      if (terminal.function.name === "reply") return { kind: "reply", reply: String(a.message || WHAT_I_DO).slice(0, 1200), source: "ai" };
      const args = a.args && typeof a.args === "object" ? (a.args as Record<string, unknown>) : {};
      return finish(String(a.action || ""), args, ctx, today, "ai");
    }
    messages.push({ role: "assistant", content: res.content || null, tool_calls: res.toolCalls.slice(0, 4) });
    for (const call of res.toolCalls.slice(0, 4)) {
      const out = ctx.lookup ? await ctx.lookup(call.function.name, parseArgs(call.function.arguments)) : { error: "lookups unavailable" };
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out).slice(0, 6000) });
    }
  }
  return { kind: "reply", reply: "Não consegui decidir. Pode dizer de outro jeito?", source: "ai" };
}

/** Older single-shot JSON mode (models/providers without tools). */
async function pickWithJson(text: string, ctx: AgentCtx, today: string, weekday: string, model: string): Promise<AgentPick | { error: string; status?: number }> {
  const system = buildAgentPrompt({ actions: ctx.actions, catalog: ctx.catalog, today, weekday, timezone: ctx.timezone, screen: ctx.screen, memory: ctx.memory, userName: ctx.userName, pending: ctx.pending, persona: ctx.persona });
  const ai = await aiChatJson({ system, user: text, timeoutMs: 30_000, model });
  if (!ai.ok) return { error: ai.error, status: ai.status };
  const parsed = pickSchema.safeParse(parseArgs(ai.text));
  if (!parsed.success) return { kind: "reply", reply: WHAT_I_DO, source: "ai" };
  if (parsed.data.action === "none") return { kind: "reply", reply: parsed.data.reply || WHAT_I_DO, source: "ai" };
  return finish(parsed.data.action, parsed.data.args, ctx, today, "ai");
}

/**
 * "hoje", "ontem", "amanhã" said by the user win over the date the model wrote. Models sometimes
 * answer with the UTC day (in the evening in the US, UTC is already tomorrow), so the day is fixed
 * here from the company's calendar. Only one relative word and no explicit date in the text.
 */
export function pinSpokenDay(text: string, action: string, args: Record<string, unknown>, today: string, actions: ActionDef[]): Record<string, unknown> {
  const def = actions.find((a) => a.name === action);
  const key = def ? (["date", "day"] as const).find((k) => k in (def.args || {})) : undefined;
  if (!key) return args;
  const t = foldText(text);
  if (/\d{1,2}\s*\/\s*\d{1,2}|\bdia\s+\d{1,2}\b|\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)) return args;
  const found = new Set<number>();
  if (/\bdepois de amanha\b/.test(t)) found.add(2);
  else if (/\bamanha\b|\btomorrow\b/.test(t)) found.add(1);
  if (/\banteontem\b/.test(t)) found.add(-2);
  else if (/\bontem\b|\byesterday\b|\bayer\b/.test(t)) found.add(-1);
  if (/\bhoje\b|\btoday\b|\bhoy\b/.test(t)) found.add(0);
  if (found.size !== 1) return args;
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + [...found][0]!);
  return { ...args, [key]: d.toISOString().slice(0, 10) };
}

export async function pickAction(text: string, ctx: AgentCtx): Promise<AgentPick> {
  const pick = await pickActionRaw(text, ctx);
  if (pick.kind !== "action") return pick;
  return { ...pick, args: pinSpokenDay(text, pick.action, pick.args, todayInTimezone(ctx.timezone).date, ctx.actions) };
}

function quoteRateFollowUp(text: string, ctx: AgentCtx): Extract<AgentPick, { kind: "action" }> | null {
  if (ctx.pending?.action === "quote.create" && ctx.pending.status === "card") return null;
  const folded = foldText(text);
  const change = /\b(muda|mude|mudar|altera|altere|alterar|atualiza|atualize|atualizar|troca|troque|trocar|change|update|set|make)\b/.test(folded);
  const price = /\b(preco|valor|price|rate|custa|cost)\b/.test(folded);
  const sqft = /\b(sq\s*ft|sqft|square\s*(foot|feet|footage)|square\s*ft|pes?\s+quadrad[oa]s?)\b/.test(folded.replace(/_/g, " "));
  if (!change || !price || !sqft) return null;
  const amountMatch = folded.match(/\b(?:para|pra|por|to|at|em)\s*\$?\s*(\d+(?:[.,]\d{1,2})?)(?!\d)/) || folded.match(/\$\s*(\d+(?:[.,]\d{1,2})?)(?!\d)/);
  if (!amountMatch) return null;
  const rawAmount = amountMatch[1]!.replace(",", ".");
  const unitPrice = Number(rawAmount);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
  const recentQuote = [...ctx.memory].reverse().find((line) => line.entity?.type === "quote")?.entity?.id;
  const quoteId = ctx.screen?.type === "quote" ? ctx.screen.id : recentQuote;
  if (!quoteId || !ctx.actions.some((action) => action.name === "quote.edit")) return null;
  return { kind: "action", action: "quote.edit", args: { quote_id: quoteId, line_item: "sq ft", unit_price: unitPrice }, source: "rules" };
}

/**
 * A quote.create card is still a proposal, so edits must rebuild that proposal rather than
 * search for or mutate a saved quote. Handle the common single-line rate change deterministically
 * before asking the model to choose an action; this also preserves the resolved catalog IDs.
 */
function pendingQuoteRateFollowUp(text: string, ctx: AgentCtx): Extract<AgentPick, { kind: "action" }> | null {
  const pending = ctx.pending;
  if (pending?.action !== "quote.create" || pending.status !== "card") return null;

  const folded = foldText(text);
  const change = /\b(muda|mude|mudar|altera|altere|alterar|atualiza|atualize|atualizar|troca|troque|trocar|change|update|set|make)\b/.test(folded);
  const price = /\b(preco|valor|price|rate|custa|cost)\b/.test(folded);
  if (!change || !price) return null;

  const amountMatch = folded.match(/\b(?:para|pra|por|to|at|em)\s*\$?\s*(\d+(?:[.,]\d{1,2})?)(?!\d)/) || folded.match(/\$\s*(\d+(?:[.,]\d{1,2})?)(?!\d)/);
  if (!amountMatch) return null;
  const unitPrice = Number(amountMatch[1]!.replace(",", "."));
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 1_000_000) return null;

  const rawItems = pending.args.items;
  if (!Array.isArray(rawItems) || rawItems.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return null;
  const items = rawItems as Array<Record<string, unknown>>;
  const requestedUnit = /\b(sq\s*ft|sqft|square\s*(foot|feet|footage)|square\s*ft|pes?\s+quadrad[oa]s?)\b/.test(folded.replace(/_/g, " "))
    ? "sq_ft"
    : /\b(linear\s*(foot|feet|ft)|lin\s*ft|lf|pes?\s+lineares?)\b/.test(folded)
      ? "linear_ft"
      : null;
  let matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!requestedUnit) return items.length === 1;
      const catalogItem = ctx.catalog.find((candidate) => candidate.id === item.catalog_item_id && candidate.source === item.catalog_source);
      const unit = normalizeMateAiUnit(String(item.unit || catalogItem?.unit || ""));
      return unit === requestedUnit;
    });

  // If multiple lines share a unit, use a service name the user repeated to select one.
  if (matches.length > 1) {
    const ignored = new Set(["preco", "valor", "price", "rate", "sq", "ft", "sqft", "square", "foot", "feet", "footage", "linear", "lin", "para", "pra", "por", "the", "per", "de", "da", "do", "no", "na", "uma", "um", "muda", "mude", "alterar", "altera", "troca", "trocar", "atualiza", "atualizar"]);
    const words = folded.split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !ignored.has(word));
    const named = matches.filter(({ item }) => {
      const catalogItem = ctx.catalog.find((candidate) => candidate.id === item.catalog_item_id && candidate.source === item.catalog_source);
      const line = foldText([item.service_text, catalogItem?.name].filter(Boolean).join(" "));
      return words.some((word) => line.includes(word));
    });
    if (named.length) matches = named;
  }
  if (matches.length !== 1) return null;

  const nextItems = items.map((item) => ({ ...item }));
  nextItems[matches[0]!.index]!.unit_price = unitPrice;
  const args = { ...pending.args, items: nextItems };
  const priceLabel = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(unitPrice);
  const selected = matches[0]!.item;
  const catalogItem = ctx.catalog.find((candidate) => candidate.id === selected.catalog_item_id && candidate.source === selected.catalog_source);
  const unit = requestedUnit || normalizeMateAiUnit(String(selected.unit || catalogItem?.unit || ""));
  const unitLabel = unit === "linear_ft" ? "linear ft" : unit === "sq_ft" ? "sq ft" : unit === "step" ? "degraus" : unit === "each" ? "unidade" : unit === "box" ? "caixa" : unit === "hour" ? "hora" : "unidade";
  const reply = /\b(change|update|set|make|price|rate)\b/.test(folded) && !/\b(muda|mude|mudar|altera|altere|alterar|atualiza|atualize|troca|troque|trocar|preco|valor)\b/.test(folded)
    ? `Done — I updated the draft to ${priceLabel} per ${unitLabel}. The revised total is below.`
    : `Certo — atualizei o rascunho para ${priceLabel} por ${unitLabel}. O novo total está abaixo.`;
  return { kind: "action", action: "quote.create", args, source: "rules", reply };
}

async function pickActionRaw(text: string, ctx: AgentCtx): Promise<AgentPick> {
  const { date, weekday } = todayInTimezone(ctx.timezone);
  const allowed = new Set(ctx.actions.map((a) => a.name));
  const pendingQuoteEdit = pendingQuoteRateFollowUp(text, ctx);
  if (pendingQuoteEdit && allowed.has(pendingQuoteEdit.action)) return pendingQuoteEdit;
  const quoteEdit = quoteRateFollowUp(text, ctx);
  if (quoteEdit && allowed.has(quoteEdit.action)) return quoteEdit;
  const local = (aiError?: string): AgentPick => {
    const chat = ctx.persona ? personaLocalReply(text, ctx.persona, ctx.userName) : null;
    if (chat) return { kind: "reply", reply: chat, source: "rules", aiError };
    const p = pickLocally(text, { today: date, catalog: ctx.catalog, customers: ctx.customers });
    if (p.kind === "action" && !allowed.has(p.action)) return { kind: "reply", reply: "Você não tem permissão para isso.", source: "rules", aiError };
    return { ...p, aiError };
  };
  if (!isAiConfigured()) return local();

  const primary = mateAiChatModel();
  const attempts: Array<{ mode: "tools" | "json"; model: string | undefined }> = [
    { mode: "tools", model: primary },
    { mode: "json", model: primary },
    { mode: "json", model: undefined },
  ];
  let lastError = "";
  for (const at of attempts) {
    const model = at.model || "";
    const r = at.mode === "tools" ? await converseWithTools(text, ctx, date, weekday, model || primary) : await pickWithJson(text, ctx, date, weekday, model);
    if (!("error" in r)) return r;
    lastError = r.error;
    noteAiError("mate-ai " + at.mode, model || "default", r.status, r.error);
    if (/plano|limite|quota|insufficient_quota|billing/i.test(r.error)) {
      return { kind: "reply", reply: /plano|limite/i.test(r.error) ? r.error : "A conta da OpenAI está sem crédito. Adicione saldo em platform.openai.com › Billing.", source: "rules", aiError: r.error };
    }
    if (r.status === 401) return { ...local(r.error), reply: "A chave da OpenAI foi recusada (401); usei a leitura básica." } as AgentPick;
  }
  const fallback = local(lastError);
  return fallback.kind === "action" ? { ...fallback, reply: "A IA não respondeu; usei a leitura básica do pedido." } : fallback;
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
