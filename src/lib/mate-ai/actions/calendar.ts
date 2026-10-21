/**
 * Calendar: meetings and lead visits (a visit is a meeting tied to the lead), rescheduling one
 * or a whole day of jobs, and free time. Writes go through /api/meetings and /api/work-orders.
 */
import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import { jobLabel, resolveCustomer, resolveLead } from "./resolve.js";
import { addDays, cleanTime, dayRange, fmtDate, fmtDateTime, isIsoDay, localDay, localTime, zonedToUtc } from "./time.js";
import type { ActionContext, ActionDef, Clarify, PickItem } from "./types.js";
import { kept, num, plural, runEach, str, uuidOrNull } from "./types.js";

const enc = encodeURIComponent;
const scheduleLink = { label: "Abrir agenda", href: "schedule.html" };

const meetingSelect = {
  id: true,
  title: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  allDay: true,
  location: true,
  leadId: true,
  customer: { select: { name: true } },
  lead: { select: { name: true } },
} as const;

type MeetingRow = NonNullable<Awaited<ReturnType<ActionContext["tx"]["meeting"]["findFirst"]>>> & {
  customer: { name: string } | null;
  lead: { name: string } | null;
};

function who(m: MeetingRow): string {
  return m.lead?.name || m.customer?.name || "";
}

function meetingWhen(m: { scheduledStart: Date; allDay: boolean }, tz: string): string {
  return fmtDateTime(m.scheduledStart, tz, m.allDay);
}

/** An upcoming meeting/visit by id, person or day. */
async function resolveMeeting(ctx: ActionContext, args: Record<string, unknown>): Promise<{ row: MeetingRow } | { clarify: Clarify } | { error: string }> {
  const id = uuidOrNull(args.meeting_id);
  if (id) {
    const row = (await ctx.tx.meeting.findFirst({ where: { id }, select: meetingSelect })) as MeetingRow | null;
    if (row) return { row };
  }
  const q = str(args.who || args.meeting, 120);
  const day = isIsoDay(args.date) ? String(args.date) : null;
  const range = day ? dayRange(day, day, ctx.timezone) : null;
  const rows = (await ctx.tx.meeting.findMany({
    where: {
      status: { not: "canceled" },
      scheduledStart: range ? { gte: range.start, lt: range.end } : { gte: new Date(Date.now() - 864e5) },
    },
    select: meetingSelect,
    orderBy: { scheduledStart: "asc" },
    take: 200,
  })) as MeetingRow[];
  const scored = q ? rows.map((m) => ({ m, s: nameSimilarity(q, [m.title, m.customer?.name, m.lead?.name]) })).filter((x) => x.s >= 55) : rows.map((m) => ({ m, s: 50 }));
  if (!scored.length) return { error: q ? `Não achei compromisso futuro com “${q}”${day ? " em " + fmtDate(day) : ""}.` : "Qual compromisso? Diga com quem ou o dia." };
  const best = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s >= best - 5);
  if (top.length === 1) return { row: top[0]!.m };
  return {
    clarify: {
      question: "Qual compromisso?",
      options: top.slice(0, 6).map(({ m }) => ({ label: (m.leadId ? "Visita: " : "") + m.title, detail: [who(m), meetingWhen(m, ctx.timezone)].filter(Boolean).join(" · "), patch: { meeting_id: m.id } })),
    },
  };
}

function whenFields(date: string | null, time: string | null) {
  return [
    { label: "Dia", value: date ? fmtDate(date) : "—", edit: { path: "date", input: "date" as const, value: date } },
    { label: "Hora", value: time || "dia inteiro", edit: { path: "time", input: "text" as const, value: time } },
  ];
}

/* ───────────────────────── new meeting ───────────────────────── */

export const createMeeting: ActionDef = {
  name: "meeting.create",
  description: "Schedule a meeting or appointment (not a job, not a lead visit) with a customer or a lead, at a place.",
  args: { title: "what (e.g. 'Reunião sobre o projeto')", customer: "customer name (optional)", lead: "lead name (optional)", date: "YYYY-MM-DD", time: "HH:MM", minutes: "duration (default 60)", location: "where", notes: "notes" },
  examples: ["Marca reunião com o Mike Johnson segunda 14h no escritório", "Schedule a call with Ana tomorrow at 9"],
  permissions: ["schedule.manage"],
  async prepare(ctx, args) {
    let customer: { id: string; name: string } | null = null;
    let lead: { id: string; name: string } | null = null;
    if (str(args.customer) || uuidOrNull(args.customer_id)) {
      const r = await resolveCustomer(ctx, args);
      if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
      if (r.status === "ok") customer = r.row;
    } else if (str(args.lead) || uuidOrNull(args.lead_id)) {
      const r = await resolveLead(ctx, args);
      if (r.status === "clarify") return { kind: "clarify", clarify: r.clarify, args };
      if (r.status === "ok") lead = r.row;
    }
    const a = { ...args, ...(customer ? { customer_id: customer.id } : {}), ...(lead ? { lead_id: lead.id } : {}) };
    const date = isIsoDay(args.date) ? String(args.date) : null;
    if (!date) {
      return { kind: "clarify", args: a, clarify: { question: "Que dia?", options: [0, 1, 2].map((d) => ({ label: d === 0 ? "Hoje" : d === 1 ? "Amanhã" : fmtDate(addDays(ctx.today, d)), patch: { date: addDays(ctx.today, d) } })), search: { placeholder: "Data (ex.: 2026-10-30)", path: "date" } } };
    }
    const time = cleanTime(args.time);
    const minutes = Math.min(600, Math.max(15, Math.round(num(args.minutes) ?? 60)));
    const person = customer?.name || lead?.name || "";
    const title = str(args.title, 160) || (person ? "Reunião com " + person : "Reunião");
    const location = str(args.location, 300);
    const start = time ? zonedToUtc(date, time, ctx.timezone) : zonedToUtc(date, "00:00", ctx.timezone);
    if (!start) return { kind: "error", message: "Não entendi a data ou a hora.", args: a };
    const end = new Date(start.getTime() + (time ? minutes : 24 * 60) * 60000);
    const exec = { title, start: start.toISOString(), end: end.toISOString(), all_day: !time, location: location || null, notes: str(args.notes, 2000) || null, customer_id: customer?.id || null, lead_id: lead?.id || null };
    return {
      kind: "card",
      args: a,
      card: {
        title: "Agendar: " + title,
        subtitle: person || undefined,
        sections: [
          {
            type: "fields",
            rows: [
              ...whenFields(date, time),
              ...(time ? [{ label: "Duração", value: minutes + " min", edit: { path: "minutes", input: "number" as const, value: minutes } }] : []),
              { label: "Local", value: location || "—", edit: { path: "location", input: "text", value: location } },
            ],
          },
        ],
        confirm: { label: "Agendar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: scheduleLink,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string } }>(ctx.req, "POST", "/api/meetings", {
      title: exec.title,
      scheduled_start: exec.start,
      scheduled_end: exec.end,
      all_day: exec.all_day,
      location: exec.location,
      notes: exec.notes,
      customer_id: exec.customer_id,
      lead_id: exec.lead_id,
    });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível agendar.") };
    const id = res.json.data?.id;
    return {
      ok: true,
      title: `${exec.title} · ${fmtDateTime(new Date(String(exec.start)), ctx.timezone, Boolean(exec.all_day))}`,
      links: [scheduleLink],
      undo: id ? { meeting_id: id } : undefined,
      next: exec.lead_id && id ? { label: "Mandar convite", action: "visit.invite", args: { meeting_id: id } } : undefined,
      memory: `Scheduled "${exec.title}" on ${exec.start}`,
    };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "DELETE", "/api/meetings/" + enc(String(u.meeting_id)));
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Compromisso cancelado" };
  },
};

/* ───────────────────────── move one meeting / visit ───────────────────────── */

export const moveMeeting: ActionDef = {
  name: "meeting.move",
  description: "Reschedule a meeting or a lead visit (\"passa a visita da Ana para sexta 9h\"). Keeps its duration.",
  args: { who: "person (lead/customer) or title", date: "current day if said, to tell it apart (optional)", new_date: "YYYY-MM-DD", new_time: "HH:MM" },
  examples: ["Passa a visita da Ana para sexta 9h", "Move my meeting with Mike to Thursday 3pm"],
  permissions: ["schedule.manage"],
  async prepare(ctx, args) {
    const r = await resolveMeeting(ctx, args);
    if ("error" in r) return { kind: "error", message: r.error, args };
    if ("clarify" in r) return { kind: "clarify", clarify: r.clarify, args };
    const m = r.row;
    const a = { ...args, meeting_id: m.id };
    const newDate = isIsoDay(args.new_date) ? String(args.new_date) : null;
    if (!newDate) return { kind: "clarify", args: a, clarify: { question: `Para quando passar “${m.title}”?`, options: [1, 2, 7].map((d) => ({ label: fmtDate(addDays(localDay(m.scheduledStart, ctx.timezone), d)), patch: { new_date: addDays(localDay(m.scheduledStart, ctx.timezone), d) } })), search: { placeholder: "Data (ex.: 2026-10-30)", path: "new_date" } } };
    const newTime = cleanTime(args.new_time) || (m.allDay ? null : localTime(m.scheduledStart, ctx.timezone));
    const start = zonedToUtc(newDate, newTime || "00:00", ctx.timezone);
    if (!start) return { kind: "error", message: "Não entendi a nova data.", args: a };
    const end = new Date(start.getTime() + (m.scheduledEnd.getTime() - m.scheduledStart.getTime()));
    // Conflicts: other meetings and jobs overlapping the new slot.
    const [mt, jobs] = await Promise.all([
      ctx.tx.meeting.count({ where: { id: { not: m.id }, status: { not: "canceled" }, scheduledStart: { lt: end }, scheduledEnd: { gt: start } } }),
      ctx.tx.workOrder.count({ where: { status: { notIn: ["canceled", "completed"] }, scheduledStart: { lt: end }, scheduledEnd: { gt: start } } }),
    ]);
    const exec = { meeting_id: m.id, title: m.title, start: start.toISOString(), end: end.toISOString(), all_day: !newTime, prev: { start: m.scheduledStart.toISOString(), end: m.scheduledEnd.toISOString(), all_day: m.allDay } };
    return {
      kind: "card",
      args: a,
      card: {
        title: "Remarcar: " + m.title,
        subtitle: who(m) || undefined,
        sections: [
          { type: "fields", rows: [{ label: "Era", value: meetingWhen(m, ctx.timezone) }, ...whenFields(newDate, newTime).map((f) => ({ ...f, edit: { ...f.edit, path: f.edit.path === "date" ? "new_date" : "new_time" } }))] },
          ...(mt + jobs ? [{ type: "note" as const, tone: "warning" as const, text: `Conflito: ${plural(mt + jobs, "compromisso", "compromissos")} no mesmo horário.` }] : []),
        ],
        confirm: { label: "Remarcar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: scheduleLink,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/meetings/" + enc(String(exec.meeting_id)), { scheduled_start: exec.start, scheduled_end: exec.end, all_day: exec.all_day });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível remarcar.") };
    return {
      ok: true,
      title: `${exec.title} → ${fmtDateTime(new Date(String(exec.start)), ctx.timezone, Boolean(exec.all_day))}`,
      links: [scheduleLink],
      undo: { meeting_id: exec.meeting_id, ...(exec.prev as Record<string, unknown>) },
      memory: `Moved "${exec.title}" to ${exec.start}`,
    };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/meetings/" + enc(String(u.meeting_id)), { scheduled_start: u.start, scheduled_end: u.end, all_day: u.all_day });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Horário anterior restaurado" };
  },
};

/* ───────────────────────── cancel ───────────────────────── */

export const cancelMeeting: ActionDef = {
  name: "meeting.cancel",
  description: "Cancel a meeting or lead visit.",
  args: { who: "person or title", date: "day if said" },
  examples: ["Cancela a reunião de amanhã com o John", "Cancel Ana's visit"],
  permissions: ["schedule.manage"],
  async prepare(ctx, args) {
    const r = await resolveMeeting(ctx, args);
    if ("error" in r) return { kind: "error", message: r.error, args };
    if ("clarify" in r) return { kind: "clarify", clarify: r.clarify, args };
    const m = r.row;
    return {
      kind: "card",
      args: { ...args, meeting_id: m.id },
      card: {
        title: "Cancelar: " + m.title,
        subtitle: [who(m), meetingWhen(m, ctx.timezone)].filter(Boolean).join(" · "),
        sections: [{ type: "note", text: "Sai da agenda. Ninguém é avisado automaticamente." }],
        confirm: { label: "Cancelar compromisso", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ meeting_id: m.id, title: m.title }) } } },
        open: scheduleLink,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "DELETE", "/api/meetings/" + enc(String(exec.meeting_id)));
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível cancelar.") };
    return { ok: true, title: `${exec.title} cancelado`, links: [scheduleLink], undo: { meeting_id: exec.meeting_id }, memory: `Canceled "${exec.title}"` };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/meetings/" + enc(String(u.meeting_id)), { status: "scheduled" });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Compromisso de volta na agenda" };
  },
};

/* ───────────────────────── move a whole day of jobs ───────────────────────── */

export const rescheduleJobs: ActionDef = {
  name: "jobs.reschedule",
  description: "Move all jobs of a day to another day (rain, delay), keeping each job's time. Shows the list to confirm.",
  args: { date: "day the jobs are on (YYYY-MM-DD)", new_date: "day to move them to", crew: "only one crew (optional)" },
  examples: ["Choveu, passa todos os jobs de amanhã para quinta", "Move tomorrow's jobs to Friday"],
  permissions: ["work_orders.manage", "schedule.manage"],
  async prepare(ctx, args) {
    const from = isIsoDay(args.date) ? String(args.date) : null;
    if (!from) return { kind: "clarify", args, clarify: { question: "Os jobs de que dia?", options: [0, 1].map((d) => ({ label: d ? "Amanhã" : "Hoje", patch: { date: addDays(ctx.today, d) } })) } };
    const to = isIsoDay(args.new_date) ? String(args.new_date) : null;
    if (!to) return { kind: "clarify", args, clarify: { question: "Para que dia?", options: [1, 2, 3].map((d) => ({ label: fmtDate(addDays(from, d)), patch: { new_date: addDays(from, d) } })) } };
    const { start, end } = dayRange(from, from, ctx.timezone);
    const crew = str(args.crew, 80);
    const jobs = await ctx.tx.workOrder.findMany({
      where: { status: { notIn: ["canceled", "completed"] }, scheduledStart: { gte: start, lt: end }, ...(crew ? { crew: { name: { contains: crew, mode: "insensitive" } } } : {}) },
      select: { id: true, number: true, title: true, scheduledStart: true, scheduledEnd: true, allDay: true, crew: { select: { name: true } }, customer: { select: { name: true } } },
      orderBy: { scheduledStart: "asc" },
    });
    if (!jobs.length) return { kind: "answer", args, card: { title: `Nenhum job em ${fmtDate(from)}`, sections: [{ type: "note", text: "Nada para remarcar." }], open: scheduleLink } };
    const items: PickItem[] = jobs.map((j) => ({ id: j.id, title: jobLabel(j), detail: [j.customer?.name, j.allDay ? "dia inteiro" : localTime(j.scheduledStart!, ctx.timezone), j.crew?.name].filter(Boolean).join(" · ") }));
    const plan = jobs.map((j) => {
      // Same local time on the new day (DST-safe).
      const time = j.allDay ? "00:00" : localTime(j.scheduledStart!, ctx.timezone);
      const ns = zonedToUtc(to, time, ctx.timezone)!;
      const dur = j.scheduledEnd ? j.scheduledEnd.getTime() - j.scheduledStart!.getTime() : 0;
      return { id: j.id, label: jobLabel(j), start: ns.toISOString(), end: dur ? new Date(ns.getTime() + dur).toISOString() : null, all_day: j.allDay, prev: { start: j.scheduledStart!.toISOString(), end: j.scheduledEnd?.toISOString() || null } };
    });
    return {
      kind: "card",
      args,
      card: {
        title: `Passar ${plural(jobs.length, "job", "jobs")} de ${fmtDate(from)} para ${fmtDate(to)}`,
        sections: [{ type: "pick", items }, { type: "note", text: "Cada job mantém o horário e a equipe. Avise os clientes se precisar." }],
        confirm: { label: "Remarcar jobs", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ plan, to }) } } },
        open: scheduleLink,
      },
    };
  },
  async execute(ctx, exec) {
    const plan = kept(ctx, (exec.plan || []) as Array<{ id: string; label: string; start: string; end: string | null; all_day: boolean; prev: { start: string; end: string | null } }>);
    if (!plan.length) return { ok: false, status: 400, error: "Nenhum job marcado." };
    const r = await runEach(plan, async (p) => {
      const res = await callInternalApi(ctx.req, "PUT", "/api/work-orders/" + enc(p.id), { scheduled_start: p.start, scheduled_end: p.end, all_day: p.all_day });
      return { ok: res.ok, error: internalError(res, "falhou") };
    });
    if (!r.done.length) return { ok: false, status: 502, error: r.failed[0]?.error || "Nenhum job foi remarcado." };
    return {
      ok: true,
      title: `${plural(r.done.length, "job remarcado", "jobs remarcados")} para ${fmtDate(String(exec.to))}`,
      detail: r.failed.length ? "Falharam: " + r.failed.map((f) => f.item.label).join(", ") : r.done.map((d) => d.label).join(", "),
      links: [scheduleLink],
      undo: { plan: r.done.map((d) => ({ id: d.id, start: d.prev.start, end: d.prev.end })) },
      memory: `Moved ${r.done.length} jobs to ${exec.to}`,
    };
  },
  async undo(ctx, u) {
    const plan = (u.plan || []) as Array<{ id: string; start: string; end: string | null }>;
    const r = await runEach(plan, async (p) => {
      const res = await callInternalApi(ctx.req, "PUT", "/api/work-orders/" + enc(p.id), { scheduled_start: p.start, scheduled_end: p.end });
      return { ok: res.ok };
    });
    return { ok: true, title: `${plural(r.done.length, "job voltou", "jobs voltaram")} para o dia original` };
  },
};

/* ───────────────────────── free time ───────────────────────── */

export const freeTime: ActionDef = {
  name: "schedule.free",
  description: "Find free time in the calendar on a day or the next days (gaps between jobs and meetings, 7:00–18:00).",
  args: { date: "first day (default today)", days: "how many days (default 1, max 7)", part: "morning | afternoon (optional)" },
  examples: ["Tenho horário livre na quarta à tarde?", "When am I free this week?"],
  permissions: ["schedule.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const first = isIsoDay(args.date) ? String(args.date) : ctx.today;
    const days = Math.min(7, Math.max(1, Math.round(num(args.days) ?? 1)));
    const part = str(args.part);
    const [h0, h1] = part === "morning" ? [7, 12] : part === "afternoon" ? [12, 18] : [7, 18];
    const last = addDays(first, days - 1);
    const { start, end } = dayRange(first, last, ctx.timezone);
    const [jobs, meetings] = await Promise.all([
      ctx.tx.workOrder.findMany({ where: { status: { not: "canceled" }, scheduledStart: { gte: start, lt: end } }, select: { scheduledStart: true, scheduledEnd: true, allDay: true } }),
      ctx.tx.meeting.findMany({ where: { status: { not: "canceled" }, scheduledStart: { gte: start, lt: end } }, select: { scheduledStart: true, scheduledEnd: true, allDay: true } }),
    ]);
    const busy = [...jobs, ...meetings].map((e) => ({ s: e.scheduledStart!, e: e.scheduledEnd || new Date(e.scheduledStart!.getTime() + 3600e3), all: e.allDay }));
    const items = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(first, i);
      const open = zonedToUtc(day, String(h0).padStart(2, "0") + ":00", ctx.timezone)!;
      const close = zonedToUtc(day, String(h1).padStart(2, "0") + ":00", ctx.timezone)!;
      const today = busy.filter((b) => b.s < close && b.e > open);
      if (today.some((b) => b.all)) {
        items.push({ title: fmtDate(day), detail: "Ocupado o dia inteiro", tone: "critical" as const });
        continue;
      }
      today.sort((a, b) => a.s.getTime() - b.s.getTime());
      const gaps: string[] = [];
      let cursor = open;
      for (const b of today) {
        if (b.s.getTime() - cursor.getTime() >= 3600e3) gaps.push(`${localTime(cursor, ctx.timezone)}–${localTime(b.s, ctx.timezone)}`);
        if (b.e > cursor) cursor = b.e;
      }
      if (close.getTime() - cursor.getTime() >= 3600e3) gaps.push(`${localTime(cursor, ctx.timezone)}–${localTime(close, ctx.timezone)}`);
      items.push({ title: fmtDate(day), detail: gaps.length ? "Livre: " + gaps.join(", ") : "Sem janela de 1 hora", tone: gaps.length ? ("good" as const) : ("warning" as const), meta: today.length ? plural(today.length, "compromisso", "compromissos") : "agenda vazia" });
    }
    return { kind: "answer", args, card: { title: days === 1 ? "Horários livres em " + fmtDate(first) : "Horários livres de " + fmtDate(first) + " a " + fmtDate(last), subtitle: `Entre ${h0}h e ${h1}h, janelas de pelo menos 1 hora`, sections: [{ type: "list", items }], open: scheduleLink } };
  },
};

export const CALENDAR_ACTIONS: ActionDef[] = [createMeeting, moveMeeting, cancelMeeting, rescheduleJobs, freeTime];
