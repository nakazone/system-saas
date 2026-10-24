/**
 * Personal reminders kept by an office employee ("Marina, me lembra sexta de ligar pro Ortiz",
 * "o que eu te pedi pra lembrar?", "já liguei pro Ortiz"). The employee who heard it is the one
 * who brings it up later in the office, on the bell and by push.
 */
import { withTenantTransaction } from "../../tenant/prisma-tenant.js";
import { nameSimilarity } from "../match.js";
import { addDays, cleanTime, fmtDate, fmtDateTime, isIsoDay, localDay, localTime, zonedToUtc } from "./time.js";
import type { ActionContext, ActionDef, ClarifyOption, ListItem } from "./types.js";
import { plural, str } from "./types.js";

const AGENT_KEY = /^[a-z0-9_-]{1,60}$/i;

async function agentFor(ctx: ActionContext, key: string | null | undefined): Promise<{ key: string; name: string }> {
  const wanted = key && AGENT_KEY.test(key) ? key : "mate";
  const agent = await ctx.tx.virtualAgent.findFirst({ where: { organizationId: ctx.organizationId, key: wanted, enabled: true }, select: { key: true, name: true } });
  return agent || { key: "mate", name: "Mate" };
}

/** Next weekday (1 = Monday) after today, as YYYY-MM-DD. */
function nextWeekday(today: string, weekday: number): string {
  const d = new Date(today + "T12:00:00Z").getUTCDay();
  const diff = ((weekday - d + 7) % 7) || 7;
  return addDays(today, diff);
}

function whenOptions(ctx: ActionContext): ClarifyOption[] {
  const now = new Date();
  const hour = Number(localTime(now, ctx.timezone).slice(0, 2));
  const out: ClarifyOption[] = [];
  if (hour < 13) out.push({ label: "Hoje à tarde", detail: "14:00", patch: { date: ctx.today, time: "14:00" } });
  else if (hour < 17) out.push({ label: "Hoje no fim do dia", detail: "17:30", patch: { date: ctx.today, time: "17:30" } });
  out.push({ label: "Amanhã cedo", detail: fmtDate(addDays(ctx.today, 1)) + " · 09:00", patch: { date: addDays(ctx.today, 1), time: "09:00" } });
  const monday = nextWeekday(ctx.today, 1);
  out.push({ label: "Segunda de manhã", detail: fmtDate(monday) + " · 09:00", patch: { date: monday, time: "09:00" } });
  return out;
}

export const reminderCreate: ActionDef = {
  name: "reminder.create",
  description:
    "The user asks YOU (the employee) to remind them of something at a time (\"me lembra amanhã às 10 de ligar pro Ortiz\", \"me cobra sexta da medição\"). Not for lead follow-ups in the CRM. You keep it and nudge them until it is done.",
  args: {
    text: "what to remember, short, in the user's words without 'me lembra' (e.g. 'ligar pro Ortiz sobre o pagamento')",
    date: "YYYY-MM-DD in the company's timezone",
    time: "HH:MM 24h; manhã → 09:00, tarde → 14:00, fim do dia → 17:30, noite → 19:00; 'daqui a 2 horas' → now + 2h",
  },
  examples: ["Me lembra amanhã às 10 de ligar pro Ortiz", "Me cobra sexta de mandar a medição da Kim", "Remind me Monday to order the oak"],
  permissions: [],
  async prepare(ctx, args) {
    const text = str(args.text, 280).replace(/^(me\s+)?(lembr[ae]|cobr[ae])\s+(de\s+)?/i, "");
    const agent = await agentFor(ctx, ctx.agentKey);
    if (text.length < 2) return { kind: "error", message: "O que você quer que eu te lembre?", args };
    const a = { ...args, text };
    if (!isIsoDay(args.date)) {
      return { kind: "clarify", args: a, clarify: { question: `Quando eu te lembro de ${text}?`, options: whenOptions(ctx) } };
    }
    const time = cleanTime(args.time) || "09:00";
    const due = zonedToUtc(String(args.date), time, ctx.timezone);
    if (!due) return { kind: "error", message: "Não entendi a data. Pode repetir o dia e a hora?", args: a };
    if (due.getTime() < Date.now() - 60_000) {
      return { kind: "clarify", args: a, message: "Esse horário já passou.", clarify: { question: "Esse horário já passou. Quando eu te lembro?", options: whenOptions(ctx) } };
    }
    return {
      kind: "card",
      args: { ...a, time },
      message: `Combinado, eu te lembro ${fmtDateTime(due, ctx.timezone).replace(" · ", " às ")}.`,
      card: {
        title: "Lembrete: " + text,
        subtitle: `${agent.name} vai te lembrar`,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Dia", value: fmtDate(String(args.date)), edit: { path: "date", input: "date", value: String(args.date) } },
              { label: "Hora", value: time, edit: { path: "time", input: "text", value: time } },
              { label: "O quê", value: text, edit: { path: "text", input: "text", value: text } },
            ],
          },
          { type: "note", text: "Se você não marcar como feito, eu volto a te chamar no horário de trabalho." },
        ],
        confirm: { label: "Combinado", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ agent_key: agent.key, agent_name: agent.name, text, due: due.toISOString() }) } } },
      },
    };
  },
  async execute(ctx, exec) {
    const due = new Date(String(exec.due));
    if (Number.isNaN(due.getTime())) return { ok: false, status: 400, error: "Data inválida." };
    const row = await withTenantTransaction(ctx.organizationId, (tx) =>
      tx.officeReminder.create({ data: { organizationId: ctx.organizationId, userId: ctx.userId, agentKey: String(exec.agent_key), text: String(exec.text).slice(0, 280), dueAt: due } }),
    );
    const when = fmtDateTime(due, ctx.timezone).replace(" · ", " às ");
    return {
      ok: true,
      title: `Combinado! Te lembro ${when}.`,
      detail: String(exec.text),
      links: [{ label: "Ver lembretes", href: `/escritorio-ia.html?agent=${encodeURIComponent(String(exec.agent_key))}` }],
      memory: `Reminder ${row.id} for ${localDay(due, ctx.timezone)} ${localTime(due, ctx.timezone)}: ${exec.text}`,
    };
  },
};

export const remindersList: ActionDef = {
  name: "reminders.list",
  description: "What the user asked to be reminded of (open reminders, the overdue first). \"o que eu te pedi pra lembrar?\", \"tenho algum lembrete hoje?\"",
  args: {},
  examples: ["O que eu te pedi pra lembrar?", "Tenho algum lembrete hoje?", "What did I ask you to remind me?"],
  permissions: [],
  readOnly: true,
  async prepare(ctx) {
    const [rows, agents] = await Promise.all([
      ctx.tx.officeReminder.findMany({ where: { organizationId: ctx.organizationId, userId: ctx.userId, status: "open" }, orderBy: { dueAt: "asc" }, take: 30 }),
      ctx.tx.virtualAgent.findMany({ where: { organizationId: ctx.organizationId }, select: { key: true, name: true } }),
    ]);
    const names = new Map(agents.map((a) => [a.key, a.name]));
    const now = Date.now();
    const items: ListItem[] = rows.map((r) => ({
      title: r.text,
      detail: `${fmtDateTime(r.dueAt, ctx.timezone)} · ${names.get(r.agentKey) || "Mate"}`,
      tone: r.dueAt.getTime() <= now ? "warning" : "neutral",
    }));
    const late = rows.filter((r) => r.dueAt.getTime() <= now).length;
    return {
      kind: "answer",
      args: {},
      message: rows.length
        ? `${plural(rows.length, "lembrete aberto", "lembretes abertos")}${late ? `, ${late} já ${late === 1 ? "passou" : "passaram"} da hora` : ""}.`
        : "Nenhum lembrete aberto. Quando quiser, é só pedir: “me lembra amanhã às 10 de…”.",
      card: { title: "Seus lembretes", sections: [{ type: "list", items, empty: "Nenhum lembrete aberto." }] },
    };
  },
};

export const reminderDone: ActionDef = {
  name: "reminder.done",
  description: "The user says a reminder is done or no longer needed (\"já liguei pro Ortiz\", \"pode tirar o lembrete da medição\").",
  args: { text: "words that identify the reminder", cancel: "true when it is no longer needed rather than done" },
  examples: ["Já liguei pro Ortiz", "Pode tirar o lembrete da medição", "I already ordered the oak"],
  permissions: [],
  async prepare(ctx, args) {
    const rows = await ctx.tx.officeReminder.findMany({ where: { organizationId: ctx.organizationId, userId: ctx.userId, status: "open" }, orderBy: { dueAt: "asc" }, take: 50 });
    if (!rows.length) return { kind: "error", message: "Você não tem lembretes abertos comigo.", args };
    const q = str(args.text, 200);
    const ranked = q ? rows.map((r) => ({ r, s: nameSimilarity(q, [r.text]) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s) : [];
    const pick = ranked[0]?.r || (rows.length === 1 ? rows[0] : null);
    if (!pick) {
      return {
        kind: "clarify",
        args,
        clarify: { question: "Qual lembrete eu tiro?", options: rows.slice(0, 6).map((r) => ({ label: r.text, detail: fmtDateTime(r.dueAt, ctx.timezone), patch: { text: r.text } })) },
      };
    }
    const cancel = args.cancel === true || args.cancel === "true";
    return {
      kind: "card",
      args,
      card: {
        title: (cancel ? "Tirar lembrete: " : "Feito: ") + pick.text,
        subtitle: fmtDateTime(pick.dueAt, ctx.timezone),
        sections: [],
        confirm: { label: cancel ? "Tirar da lista" : "Marcar como feito", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ id: pick.id, text: pick.text, cancel }) } } },
      },
    };
  },
  async execute(ctx, exec) {
    const now = new Date();
    const updated = await withTenantTransaction(ctx.organizationId, (tx) =>
      tx.officeReminder.updateMany({ where: { id: String(exec.id), userId: ctx.userId, status: "open" }, data: { status: exec.cancel ? "canceled" : "done", completedAt: now } }),
    );
    if (!updated.count) return { ok: false, status: 404, error: "Esse lembrete já tinha saído da lista." };
    return { ok: true, title: exec.cancel ? "Pronto, tirei da lista." : "Boa! Tirei da minha mesa.", detail: String(exec.text), memory: `Reminder done: ${exec.text}` };
  },
};

export const REMINDER_ACTIONS: ActionDef[] = [reminderCreate, remindersList, reminderDone];
export const REMINDER_ACTION_NAMES = new Set(REMINDER_ACTIONS.map((a) => a.name));
