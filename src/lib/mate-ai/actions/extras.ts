/**
 * Mate actions on the routes created for the map: daily brief, visit invite e-mail, job day
 * summary and job margin.
 */
import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import { jobLabel, resolveJob } from "./resolve.js";
import { fmtDate, fmtDateTime, isIsoDay } from "./time.js";
import type { ActionContext, ActionDef } from "./types.js";
import { isEmail, money, num, str, uuidOrNull } from "./types.js";

const enc = encodeURIComponent;

async function jobOr(ctx: ActionContext, args: Record<string, unknown>) {
  const r = await resolveJob(ctx, args);
  if (r.status === "clarify") return { done: { kind: "clarify" as const, clarify: r.clarify, args } };
  if (r.status === "missing") return { done: { kind: "error" as const, message: r.message, args } };
  return { job: r.row };
}

/* ───────────────────────── daily brief ───────────────────────── */

type BriefPrefs = { enabled: boolean; hour: number; channels: Array<"push" | "email"> };

export const scheduleBrief: ActionDef = {
  name: "brief.schedule",
  description: "Turn on (or off) my daily summary at a time — agenda, money to collect, quotes waiting, follow-ups, crew days — by phone notification (push) and/or e-mail. Also 'show me today's summary'.",
  args: { hour: "0–23 (default 7)", channels: "push | email | both (default push)", enabled: "false to turn off", now: "true to just show today's summary" },
  examples: ["Me manda o resumo do dia às 7h", "Resumo diário por e-mail às 6", "Para de mandar o resumo", "Me mostra o resumo de hoje"],
  permissions: [],
  async prepare(ctx, args) {
    const cur = await callInternalApi<{ data?: { prefs: BriefPrefs; preview?: { title: string; lines: string[] } } }>(ctx.req, "GET", "/api/mate-ai/brief?preview=1");
    const d = cur.json.data;
    if (!cur.ok || !d) return { kind: "error", message: internalError(cur, "Não consegui abrir o resumo."), args };
    const preview = d.preview || { title: "Seu dia", lines: [] };
    if (args.now === true || str(args.now) === "true") {
      return { kind: "answer", args, card: { title: preview.title, sections: [{ type: "list", items: preview.lines.map((l) => ({ title: l })) }], ...(d.prefs.enabled ? {} : { links: [] }) } };
    }
    const off = args.enabled === false || str(args.enabled) === "false";
    const hour = Math.min(23, Math.max(0, Math.round(num(args.hour) ?? d.prefs.hour ?? 7)));
    const ch = str(args.channels).toLowerCase();
    const channels: Array<"push" | "email"> = /both|ambos|os dois/.test(ch) ? ["push", "email"] : /mail/.test(ch) ? ["email"] : /push|notif|celular/.test(ch) ? ["push"] : d.prefs.channels?.length ? d.prefs.channels : ["push"];
    const label = channels.map((c) => (c === "push" ? "notificação no celular" : "e-mail")).join(" e ");
    return {
      kind: "card",
      args: { ...args, hour, channels: channels.join(",") },
      card: {
        title: off ? "Desligar o resumo diário" : `Resumo do dia às ${hour}h`,
        subtitle: off ? undefined : label,
        sections: off
          ? []
          : [
              { type: "fields", rows: [{ label: "Hora", value: hour + "h", edit: { path: "hour", input: "number", value: hour } }, { label: "Por", value: label, edit: { path: "channels", input: "select", value: channels.join(","), options: [{ value: "push", label: "Notificação" }, { value: "email", label: "E-mail" }, { value: "push,email", label: "Os dois" }] } }] },
              { type: "note", text: "Exemplo de hoje: " + (preview.lines.slice(0, 3).join(" · ") || "nada urgente") },
              ...(channels.includes("push") ? [{ type: "note" as const, text: "A notificação chega nos aparelhos onde você ativou as notificações do ObraMate." }] : []),
            ],
        confirm: { label: off ? "Desligar" : "Ligar resumo", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ enabled: !off, hour, channels }) } } },
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/mate-ai/brief", { enabled: exec.enabled, hour: exec.hour, channels: exec.channels });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui salvar.") };
    return { ok: true, title: exec.enabled ? `Resumo diário ligado: ${exec.hour}h` : "Resumo diário desligado", memory: exec.enabled ? `Daily brief on at ${exec.hour}h` : "Daily brief off" };
  },
};

/* ───────────────────────── visit invite ───────────────────────── */

export const visitInvite: ActionDef = {
  name: "visit.invite",
  description: "E-mail the lead/customer the calendar invite (.ics) of a scheduled visit or meeting.",
  args: { who: "person (lead/customer) or meeting title", date: "day if said", to: "e-mail if different" },
  examples: ["Manda o convite da visita para a Ana", "Send Mike the meeting invite"],
  permissions: ["schedule.manage"],
  async prepare(ctx, args) {
    const id = uuidOrNull(args.meeting_id);
    const rows = await ctx.tx.meeting.findMany({
      where: { status: { not: "canceled" }, ...(id ? { id } : { scheduledStart: { gte: new Date(Date.now() - 864e5) } }) },
      select: { id: true, title: true, scheduledStart: true, allDay: true, location: true, lead: { select: { name: true, email: true } }, customer: { select: { name: true, email: true } } },
      orderBy: { scheduledStart: "asc" },
      take: 100,
    });
    const q = str(args.who, 80);
    const day = isIsoDay(args.date) ? String(args.date) : null;
    const hits = id ? rows : rows.filter((m) => (!q || nameSimilarity(q, [m.title, m.lead?.name, m.customer?.name]) >= 55) && (!day || m.scheduledStart.toISOString().slice(0, 10) === day));
    if (!hits.length) return { kind: "error", message: q ? `Não achei visita futura com “${q}”.` : "De qual visita?", args };
    if (hits.length > 1) return { kind: "clarify", args, clarify: { question: "Qual visita?", options: hits.slice(0, 6).map((m) => ({ label: m.title, detail: [m.lead?.name || m.customer?.name, fmtDateTime(m.scheduledStart, ctx.timezone, m.allDay)].filter(Boolean).join(" · "), patch: { meeting_id: m.id } })) } };
    const m = hits[0]!;
    const person = m.lead || m.customer;
    const to = str(args.to, 200) || person?.email || "";
    const a = { ...args, meeting_id: m.id };
    if (!isEmail(to)) return { kind: "clarify", args: a, clarify: { question: `${person?.name || "O cliente"} não tem e-mail. Para qual e-mail mandar?`, options: [], search: { placeholder: "email@exemplo.com", path: "to" } } };
    return {
      kind: "card",
      args: a,
      card: {
        title: "Convite: " + m.title,
        subtitle: fmtDateTime(m.scheduledStart, ctx.timezone, m.allDay) + (m.location ? " · " + m.location : ""),
        badge: { text: "Vai para o cliente", tone: "warning" },
        sections: [{ type: "fields", rows: [{ label: "Para", value: to, edit: { path: "to", input: "text", value: to } }] }, { type: "note", text: "O cliente recebe um e-mail com o horário e o convite para pôr na agenda. Notas internas não vão." }],
        confirm: { label: "Enviar convite", tone: "send", checkbox: "Enviar para " + to, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ meeting_id: m.id, to, title: m.title }) } } },
        open: { label: "Abrir agenda", href: "schedule.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/meetings/${enc(String(exec.meeting_id))}/send-invite`, { to: exec.to });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui enviar o convite.") };
    return { ok: true, title: "Convite enviado", detail: `${exec.title} · para ${exec.to}`, memory: `Sent invite for ${exec.title} to ${exec.to}` };
  },
};

/* ───────────────────────── job day summary ───────────────────────── */

export const jobDaySummary: ActionDef = {
  name: "chat.summary",
  description: "What happened on a job on a day (default today): messages in its channel, photos, who worked, problems — summarized.",
  args: { job: "job number/title", day: "YYYY-MM-DD (default today)" },
  examples: ["O que aconteceu hoje no job 1042?", "Resume o dia de ontem no job do John", "What happened at the Smith job today?"],
  permissions: ["work_orders.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const day = isIsoDay(args.day) ? String(args.day) : ctx.today;
    const res = await callInternalApi<{ data?: { day: string; summary: string; ai: boolean; counts: { messages: number; photos: number; workers: number } } }>(ctx.req, "POST", `/api/chat/jobs/${enc(job.id)}/summary`, { day });
    const d = res.json.data;
    if (!res.ok || !d) return { kind: "error", message: internalError(res, "Não consegui resumir o dia."), args };
    return {
      kind: "answer",
      args: { ...args, job_id: job.id },
      card: {
        title: `${jobLabel(job)} · ${day === ctx.today ? "hoje" : fmtDate(day)}`,
        subtitle: `${d.counts.messages} mensagens · ${d.counts.photos} fotos · ${d.counts.workers} pessoa(s)`,
        sections: [{ type: "note", text: d.summary }],
        links: [{ label: "Abrir job", href: "job-detail.html?id=" + enc(job.id) }, { label: "Abrir ObraChat", href: "chat.html" }],
      },
    };
  },
};

/* ───────────────────────── job margin ───────────────────────── */

export const jobMargin: ActionDef = {
  name: "job.margin",
  description: "Profit of a job: sold/invoiced, labor (field days), material and other costs launched for it, margin in $ and %.",
  args: { job: "job number/title" },
  examples: ["Qual foi a margem do job 1042?", "Quanto lucrei no job do John?", "Margin on the Smith job"],
  permissions: ["work_orders.view"],
  anyPermissions: ["finance.view", "payroll.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const res = await callInternalApi<{ data?: { revenue: number; invoiced: number; received: number; labor: number; labor_days: number; costs: number; cost_lines: Array<{ description: string; amount: number }>; margin: number; margin_pct: number | null } }>(ctx.req, "GET", `/api/work-orders/${enc(job.id)}/margin`);
    const d = res.json.data;
    if (!res.ok || !d) return { kind: "error", message: internalError(res, "Não consegui calcular a margem."), args };
    return {
      kind: "answer",
      args: { ...args, job_id: job.id },
      card: {
        title: `Margem do ${jobLabel(job)}: ${money(d.margin)}${d.margin_pct != null ? ` (${d.margin_pct}%)` : ""}`,
        sections: [
          { type: "totals", rows: [{ label: "Venda (serviços)", value: money(d.revenue) }, { label: `Mão de obra (${d.labor_days} dia(s))`, value: "−" + money(d.labor) }, { label: "Material e custos", value: "−" + money(d.costs) }, { label: "Margem", value: money(d.margin), strong: true }] },
          { type: "fields", rows: [{ label: "Faturado", value: money(d.invoiced) }, { label: "Recebido", value: money(d.received) }] },
          ...(d.cost_lines.length ? [{ type: "list" as const, items: d.cost_lines.map((c) => ({ title: c.description, detail: money(c.amount) })) }] : [{ type: "note" as const, text: "Nenhum custo lançado para este job. Diga, por exemplo: “gastei 340 na Home Depot para o job " + (job.number ?? "") + "”." }]),
        ],
        links: [{ label: "Abrir job", href: "job-detail.html?id=" + enc(job.id) }],
      },
    };
  },
};

export const EXTRA_ACTIONS: ActionDef[] = [scheduleBrief, visitInvite, jobDaySummary, jobMargin];
