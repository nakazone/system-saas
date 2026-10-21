/**
 * Field crew (app de campo): start the day / arrive at a job, finish the day, report a problem
 * with a photo, measurements, checklist, expenses with receipt, send the week, next job.
 * Everything goes through the /api/campo routes as the logged-in worker: they only reach their
 * own jobs and hours.
 */
import { parseCampoChecklist } from "../../job-media/checklist.js";
import { getAttachment } from "../attachments.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import { addDays, fmtDate } from "./time.js";
import type { ActionContext, ActionDef, Clarify, ExecuteContext, PrepareResult } from "./types.js";
import { CAMPO_ANY, money, num, str, uuidOrNull } from "./types.js";

const enc = encodeURIComponent;
const TICKET = (id: string) => ({ label: "Abrir job", href: "/campo/ticket.html?id=" + enc(id) });
const HOME = { label: "Abrir meu dia", href: "/campo/hoje.html" };

type FieldJob = { id: string; number: number | null; title: string; client?: string | null; address?: string | null; start_label?: string | null; maps_url?: string | null; sqft?: number };
type DayState = {
  linked: boolean;
  employee: { name: string } | null;
  day: { id: string; status: string; clock_in_label: string | null; clock_out: string | null; worked_label: string; jobs: FieldJob[]; expenses: Array<{ amount: number; description?: string | null }> } | null;
  jobs_today: FieldJob[];
};

function label(j: FieldJob): string {
  return (j.number != null ? "#" + j.number + " · " : "") + j.title;
}

async function dayState(ctx: ActionContext): Promise<DayState | { error: string }> {
  const res = await callInternalApi<{ data?: DayState }>(ctx.req, "GET", "/api/campo/dia");
  if (!res.ok || !res.json.data) return { error: internalError(res, "Não consegui abrir o seu dia.") };
  return res.json.data;
}

/** The job the worker means: by id, by number/name among today's jobs, or the screen. */
function pickJob(ctx: ActionContext, jobs: FieldJob[], args: Record<string, unknown>): { job: FieldJob } | { clarify: Clarify } | { none: true } {
  const id = uuidOrNull(args.job_id) || (ctx.screen?.type === "job" ? ctx.screen.id : null);
  if (id) {
    const hit = jobs.find((j) => j.id === id);
    if (hit) return { job: hit };
    if (uuidOrNull(args.job_id)) return { job: { id, number: null, title: "job" } };
  }
  const q = str(args.job, 120);
  if (q) {
    const n = Number((q.match(/\d{2,7}/) || [])[0]);
    const byNum = Number.isFinite(n) ? jobs.find((j) => j.number === n) : null;
    if (byNum) return { job: byNum };
    const scored = jobs.map((j) => ({ j, s: nameSimilarity(q, [j.title, j.client, j.address]) })).filter((x) => x.s >= 55).sort((a, b) => b.s - a.s);
    if (scored[0]) return { job: scored[0].j };
  }
  if (jobs.length === 1) return { job: jobs[0]! };
  if (!jobs.length) return { none: true };
  return { clarify: { question: "Qual job?", options: jobs.slice(0, 6).map((j) => ({ label: label(j), detail: [j.client, j.start_label].filter(Boolean).join(" · "), patch: { job_id: j.id } })) } };
}

function needPhoto(ctx: ExecuteContext, exec: Record<string, unknown>): string | null {
  return exec.photo_id ? getAttachment(ctx.organizationId, ctx.userId, exec.photo_id) : null;
}

const base = { permissions: [] as string[], anyPermissions: CAMPO_ANY };

/* ───────────────────────── start / arrive ───────────────────────── */

export const fieldArrive: ActionDef = {
  ...base,
  name: "campo.arrive",
  description: "Field worker: start the work day (clock in) at a job, or mark arrival at another job when the day is already running. \"Cheguei no job\".",
  args: { job: "job number or name (optional; defaults to the next job of the day)" },
  examples: ["Cheguei no job", "Cheguei na casa do John", "Comecei o dia no 1042", "I'm at the Smith job"],
  async prepare(ctx, args) {
    const st = await dayState(ctx);
    if ("error" in st) return { kind: "error", message: st.error, args };
    if (!st.linked) return { kind: "error", message: "Seu usuário não está ligado à folha. Fale com o escritório.", args };
    if (st.day?.clock_out) return { kind: "error", message: "Seu dia de hoje já foi encerrado.", args };
    const open = Boolean(st.day);
    const already = new Set((st.day?.jobs || []).map((j) => j.id));
    const choices = st.jobs_today.filter((j) => !already.has(j.id));
    const p = pickJob(ctx, open ? choices : st.jobs_today, args);
    if ("clarify" in p) return { kind: "clarify", clarify: p.clarify, args };
    const job = "job" in p ? p.job : null;
    if (open && !job) return { kind: "error", message: "Não achei outro job seu hoje. Diga o número do job.", args };
    return {
      kind: "card",
      args: { ...args, ...(job ? { job_id: job.id } : {}) },
      card: {
        title: open ? "Chegada no job " + label(job!) : "Começar o dia" + (job ? " no " + label(job) : ""),
        subtitle: job ? [job.client, job.address].filter(Boolean).join(" · ") : "Sem job agendado: começa em deslocamento",
        sections: [{ type: "note", text: open ? `Dia começou às ${st.day!.clock_in_label}. O job entra no seu dia agora.` : "Bate o ponto com a sua localização." }],
        confirm: { label: open ? "Marcar chegada" : "Começar o dia", tone: "normal", geo: !open, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ open, job_id: job?.id || null, label: job ? label(job) : "" }) } } },
        open: job ? TICKET(job.id) : HOME,
      },
    };
  },
  async execute(ctx, exec) {
    const g = ctx.geo || {};
    const res = exec.open
      ? await callInternalApi(ctx.req, "POST", "/api/campo/dia/jobs", { work_order_id: exec.job_id })
      : await callInternalApi(ctx.req, "POST", "/api/campo/dia/start", { work_order_id: exec.job_id, ...g, device_at: new Date().toISOString() });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui registrar.") };
    return {
      ok: true,
      title: exec.open ? `Chegada no ${exec.label}` : "Dia começado" + (exec.label ? ` no ${exec.label}` : ""),
      links: [exec.job_id ? TICKET(String(exec.job_id)) : HOME],
      memory: exec.open ? `Arrived at job ${exec.label}` : `Started the work day ${exec.label ? "at " + exec.label : ""}`,
    };
  },
};

/* ───────────────────────── finish the day ───────────────────────── */

export const fieldFinish: ActionDef = {
  ...base,
  name: "campo.finish",
  description: "Field worker: finish the work day (clock out), with the sq ft done on each job if said and a note.",
  args: { sqft: "sq ft done today (when there is one job)", note: "note for the office (optional)" },
  examples: ["Terminei por hoje", "Acabei, fiz 300 pés", "Clock me out"],
  async prepare(ctx, args) {
    const st = await dayState(ctx);
    if ("error" in st) return { kind: "error", message: st.error, args };
    const day = st.day;
    if (!day) return { kind: "error", message: "Você ainda não começou o dia.", args };
    if (day.clock_out) return { kind: "error", message: "Seu dia já foi encerrado.", args };
    const jobs = day.jobs;
    const said = num(args.sqft);
    const per = (args.per_job && typeof args.per_job === "object" ? args.per_job : {}) as Record<string, unknown>;
    const plan = jobs.map((j, i) => ({ work_order_id: j.id, label: label(j), sqft: num(per[j.id]) ?? (i === 0 && jobs.length === 1 && said != null ? said : num(j.sqft) ?? 0) }));
    return {
      kind: "card",
      args,
      card: {
        title: "Encerrar o dia",
        subtitle: `Começou às ${day.clock_in_label} · ${day.worked_label}`,
        sections: [
          ...(plan.length
            ? [{ type: "fields" as const, rows: plan.map((p) => ({ label: p.label, value: `${p.sqft || 0} sq ft`, edit: { path: `per_job.${p.work_order_id}`, input: "number" as const, value: p.sqft || 0 } })) }]
            : [{ type: "note" as const, text: "Nenhum job no dia." }]),
          ...(jobs.some((j) => !(j as FieldJob & { photos_today?: number }).photos_today)
            ? [{ type: "note" as const, tone: "warning" as const, text: "Sem foto de hoje em: " + jobs.filter((j) => !(j as FieldJob & { photos_today?: number }).photos_today).map(label).join(", ") + ". Se a empresa exige foto, tire antes de encerrar." }]
            : []),
          ...(day.expenses.length ? [{ type: "note" as const, text: "Despesas do dia: " + day.expenses.map((e) => money(e.amount) + (e.description ? " " + e.description : "")).join(", ") }] : []),
          { type: "fields", rows: [{ label: "Nota", value: str(args.note, 300) || "—", edit: { path: "note", input: "text", value: str(args.note, 300) } }] },
        ],
        confirm: { label: "Encerrar o dia", tone: "normal", geo: true, exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ jobs: plan.map((p) => ({ work_order_id: p.work_order_id, sqft: p.sqft })), note: str(args.note, 1000) || null }) } } },
        open: HOME,
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: DayState }>(ctx.req, "POST", "/api/campo/dia/finish", { jobs: exec.jobs, note: exec.note, ...(ctx.geo || {}), device_at: new Date().toISOString() });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui encerrar o dia.") };
    const d = res.json.data?.day;
    return { ok: true, title: "Dia encerrado" + (d?.worked_label ? ` · ${d.worked_label}` : ""), detail: "O escritório revisa e aprova.", links: [HOME], next: { label: "Enviar minhas horas da semana", action: "campo.week", args: {} }, memory: "Finished the work day" };
  },
};

/* ───────────────────────── problem on site ───────────────────────── */

export const fieldProblem: ActionDef = {
  ...base,
  name: "campo.problem",
  acceptsPhoto: true,
  description: "Field worker: report a problem on a job to the office (wet subfloor, wrong material…), with the attached photo if any.",
  args: { job: "job number or name", note: "what is wrong" },
  examples: ["Tem um problema: o contrapiso está úmido", "Problem at the Smith job: wrong color delivered"],
  async prepare(ctx, args) {
    const st = await dayState(ctx);
    if ("error" in st) return { kind: "error", message: st.error, args };
    const p = pickJob(ctx, [...(st.day?.jobs || []), ...st.jobs_today.filter((j) => !(st.day?.jobs || []).some((d) => d.id === j.id))], args);
    if ("clarify" in p) return { kind: "clarify", clarify: p.clarify, args };
    if (!("job" in p)) return { kind: "error", message: "Em qual job? Diga o número.", args };
    const note = str(args.note, 2000);
    if (note.length < 2) return { kind: "clarify", args: { ...args, job_id: p.job.id }, clarify: { question: "Qual é o problema?", options: [], search: { placeholder: "Descreva o problema", path: "note" } } };
    const photo = Boolean(getAttachment(ctx.organizationId, ctx.userId, args.photo_id));
    return {
      kind: "card",
      args: { ...args, job_id: p.job.id },
      card: {
        title: "Problema no " + label(p.job),
        badge: { text: "Avisa o escritório", tone: "warning" },
        sections: [{ type: "fields", rows: [{ label: "Problema", value: note, edit: { path: "note", input: "text", value: note } }, { label: "Foto", value: photo ? "anexada" : "sem foto (toque na câmera para anexar)" }] }],
        confirm: { label: "Avisar o escritório", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: p.job.id, label: label(p.job), note, photo_id: photo ? args.photo_id : null }) } } },
        open: TICKET(p.job.id),
      },
    };
  },
  async execute(ctx, exec) {
    const id = enc(String(exec.job_id));
    const photo = needPhoto(ctx, exec);
    if (photo) {
      const up = await callInternalApi(ctx.req, "POST", `/api/campo/jobs/${id}/photos`, { data_url: photo, caption: "Problema: " + String(exec.note).slice(0, 120) });
      if (!up.ok) return { ok: false, status: up.status, error: internalError(up, "Não consegui enviar a foto.") };
    }
    const res = await callInternalApi(ctx.req, "POST", `/api/campo/jobs/${id}/problem`, { note: exec.note });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui avisar.") };
    return { ok: true, title: "Escritório avisado", detail: `${exec.label}: ${exec.note}`, links: [TICKET(String(exec.job_id))], entity: { type: "work_order", id: String(exec.job_id) }, memory: `Reported problem on ${exec.label}` };
  },
};

/* ───────────────────────── measurement ───────────────────────── */

export const fieldMeasure: ActionDef = {
  ...base,
  name: "campo.measure",
  description: "Field worker: record a measurement on a job (a room's length × width becomes its area, or a single value).",
  args: { job: "job number or name", label: "room or place (e.g. 'Sala')", length_ft: "length in feet", width_ft: "width in feet", area_sqft: "area if said directly", value: "single value", kind: "length_ft | width_ft | area_sqft | custom" },
  examples: ["Medi a sala: 18 por 22", "Quarto 2 tem 140 pés quadrados", "Hallway is 30 feet long"],
  async prepare(ctx, args) {
    const st = await dayState(ctx);
    if ("error" in st) return { kind: "error", message: st.error, args };
    const p = pickJob(ctx, [...(st.day?.jobs || []), ...st.jobs_today], args);
    if ("clarify" in p) return { kind: "clarify", clarify: p.clarify, args };
    if (!("job" in p)) return { kind: "error", message: "Em qual job? Diga o número.", args };
    const l = num(args.length_ft);
    const w = num(args.width_ft);
    const area = num(args.area_sqft) ?? (l && w ? Math.round(l * w * 10) / 10 : null);
    const kind = area ? "area_sqft" : ["length_ft", "width_ft", "custom"].includes(str(args.kind)) ? str(args.kind) : "length_ft";
    const value = area ?? num(args.value) ?? l ?? w;
    if (!value || value <= 0) return { kind: "error", message: "Qual a medida? Ex.: “sala 18 por 22”.", args: { ...args, job_id: p.job.id } };
    const room = str(args.label, 100) || "Medição";
    const shown = area ? (l && w ? `${l} × ${w} ft = ${area} sq ft` : `${area} sq ft`) : `${value} ${kind === "custom" ? "" : "ft"}`.trim();
    return {
      kind: "card",
      args: { ...args, job_id: p.job.id },
      card: {
        title: "Medição no " + label(p.job),
        sections: [{ type: "fields", rows: [{ label: "Onde", value: room, edit: { path: "label", input: "text", value: room } }, { label: "Medida", value: shown }] }],
        confirm: { label: "Salvar medição", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: p.job.id, label: label(p.job), room, kind, value, note: l && w ? `${l} x ${w} ft` : null }) } } },
        open: TICKET(p.job.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", `/api/campo/jobs/${enc(String(exec.job_id))}/measurements`, { label: exec.room, kind: exec.kind, value: exec.value, unit: exec.kind === "area_sqft" ? "sq ft" : "ft", source: "manual", note: exec.note });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui salvar a medição.") };
    return { ok: true, title: `${exec.room}: ${exec.value} ${exec.kind === "area_sqft" ? "sq ft" : "ft"}`, links: [TICKET(String(exec.job_id))], entity: { type: "work_order", id: String(exec.job_id) }, memory: `Measured ${exec.room} on ${exec.label}` };
  },
};

/* ───────────────────────── checklist ───────────────────────── */

export const fieldChecklist: ActionDef = {
  ...base,
  name: "campo.checklist",
  description: "Field worker: tick (or untick) an item of the job's checklist.",
  args: { job: "job number or name", item: "checklist item as said", done: "true to tick (default), false to untick" },
  examples: ["Marca o checklist: rodapé feito", "Check off 'cleanup' on the Smith job"],
  async prepare(ctx, args) {
    const st = await dayState(ctx);
    if ("error" in st) return { kind: "error", message: st.error, args };
    const p = pickJob(ctx, [...(st.day?.jobs || []), ...st.jobs_today], args);
    if ("clarify" in p) return { kind: "clarify", clarify: p.clarify, args };
    if (!("job" in p)) return { kind: "error", message: "Em qual job? Diga o número.", args };
    const wo = await ctx.tx.workOrder.findFirst({ where: { id: p.job.id }, select: { campoChecklist: true } });
    const items = parseCampoChecklist(wo?.campoChecklist);
    const q = str(args.item, 120);
    const done = args.done === false || str(args.done) === "false" ? false : true;
    const picked = items.find((i) => i.id === args.item_id) || (q ? items.map((i) => ({ i, s: nameSimilarity(q, [i.text]) })).sort((a, b) => b.s - a.s).find((x) => x.s >= 50)?.i : undefined);
    const a = { ...args, job_id: p.job.id };
    if (!picked) {
      return { kind: "clarify", args: a, clarify: { question: "Qual item do checklist?", options: items.filter((i) => i.done !== done).slice(0, 8).map((i) => ({ label: i.text, patch: { item_id: i.id } })) } };
    }
    return {
      kind: "card",
      args: { ...a, item_id: picked.id },
      card: {
        title: (done ? "Marcar: " : "Desmarcar: ") + picked.text,
        subtitle: label(p.job),
        sections: picked.photo_required && done ? [{ type: "note", tone: "warning", text: "Este item pede foto: tire pelo job se o escritório cobrar." }] : [],
        confirm: { label: done ? "Marcar feito" : "Desmarcar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: p.job.id, item_id: picked.id, text: picked.text, done }) } } },
        open: TICKET(p.job.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PATCH", `/api/campo/jobs/${enc(String(exec.job_id))}/checklist`, { item_id: exec.item_id, done: exec.done });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui marcar o item.") };
    return { ok: true, title: `${exec.done ? "Feito" : "Desmarcado"}: ${exec.text}`, links: [TICKET(String(exec.job_id))], entity: { type: "work_order", id: String(exec.job_id) }, memory: `Checklist ${exec.text} ${exec.done ? "done" : "undone"}` };
  },
};

/* ───────────────────────── expense with receipt ───────────────────────── */

export const fieldExpense: ActionDef = {
  ...base,
  name: "campo.expense",
  acceptsPhoto: true,
  description: "Field worker: a reimbursement during the day (gas, material) with the attached receipt photo; reviewed with the day.",
  args: { amount: "dollars", description: "what it was (e.g. 'gasolina')" },
  examples: ["Gastei 40 de gasolina", "Comprei cola, 23 dólares", "Spent 18 on parking"],
  async prepare(ctx, args) {
    const amount = num(args.amount);
    if (!amount || amount <= 0) return { kind: "clarify", args, clarify: { question: "Qual o valor?", options: [], search: { placeholder: "Valor em $", path: "amount" } } };
    const st = await dayState(ctx);
    if ("error" in st) return { kind: "error", message: st.error, args };
    if (!st.day || st.day.clock_out) return { kind: "error", message: "Comece o dia primeiro: a despesa entra no dia de hoje.", args };
    const desc = str(args.description, 200) || "Despesa";
    const photo = Boolean(getAttachment(ctx.organizationId, ctx.userId, args.photo_id));
    return {
      kind: "card",
      args,
      card: {
        title: `Despesa: ${money(amount)}`,
        sections: [
          { type: "fields", rows: [{ label: "O quê", value: desc, edit: { path: "description", input: "text", value: desc } }, { label: "Valor", value: money(amount), edit: { path: "amount", input: "money", value: amount } }, { label: "Recibo", value: photo ? "foto anexada" : "sem foto" }] },
          ...(photo ? [] : [{ type: "note" as const, tone: "warning" as const, text: "Sem recibo o escritório pode recusar. Toque na câmera e diga de novo para anexar." }]),
        ],
        confirm: { label: "Lançar despesa", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ amount, desc, photo_id: photo ? args.photo_id : null }) } } },
        open: HOME,
      },
    };
  },
  async execute(ctx, exec) {
    let receipt: { url?: string; key?: string } = {};
    const photo = needPhoto(ctx, exec);
    if (photo) {
      const up = await callInternalApi<{ data?: { url: string; key: string } }>(ctx.req, "POST", "/api/campo/dia/recibos", { data_url: photo });
      if (!up.ok || !up.json.data) return { ok: false, status: up.status, error: internalError(up, "Não consegui enviar o recibo.") };
      receipt = up.json.data;
    }
    const res = await callInternalApi(ctx.req, "POST", "/api/campo/dia/despesas", { amount: exec.amount, description: exec.desc, receipt_url: receipt.url || null, receipt_key: receipt.key || null });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui lançar a despesa.") };
    return { ok: true, title: `Despesa de ${money(Number(exec.amount))} lançada`, detail: String(exec.desc) + (receipt.url ? " · com recibo" : ""), links: [HOME], memory: `Field expense ${money(Number(exec.amount))} ${exec.desc}` };
  },
};

/* ───────────────────────── send the week ───────────────────────── */

export const fieldWeek: ActionDef = {
  ...base,
  name: "campo.week",
  description: "Field worker: send this week's hours to the office for approval.",
  args: { note: "note (optional)" },
  examples: ["Envia minhas horas da semana", "Submit my week"],
  async prepare(ctx, args) {
    const res = await callInternalApi<{ data?: { totals?: { days: number; worked_minutes: number; amount: number } } }>(ctx.req, "GET", "/api/campo/dia/semana");
    const t = res.json.data?.totals;
    return {
      kind: "card",
      args,
      card: {
        title: "Enviar as horas da semana",
        subtitle: t ? `${t.days} dia(s) · ${Math.floor(t.worked_minutes / 60)}h${String(t.worked_minutes % 60).padStart(2, "0")} · ${money(t.amount)}` : undefined,
        sections: [{ type: "note", text: "O escritório recebe a semana para conferir e aprovar." }],
        confirm: { label: "Enviar semana", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ note: str(args.note, 400) || null }) } } },
        open: { label: "Abrir horas", href: "/campo/horas.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "POST", "/api/campo/horas/submit-week", { note: exec.note });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui enviar a semana.") };
    return { ok: true, title: "Semana enviada para aprovação", links: [{ label: "Abrir horas", href: "/campo/horas.html" }], memory: "Submitted the week" };
  },
};

/* ───────────────────────── next job ───────────────────────── */

export const fieldNext: ActionDef = {
  ...base,
  name: "campo.next",
  readOnly: true,
  description: "Field worker: my next job (address, time, client, map) and the rest of today.",
  args: {},
  examples: ["Qual meu próximo job?", "Onde eu vou agora?", "What's next?"],
  async prepare(ctx, args): Promise<PrepareResult> {
    const st = await dayState(ctx);
    if ("error" in st) return { kind: "error", message: st.error, args };
    const done = new Set((st.day?.jobs || []).map((j) => j.id));
    const left = st.jobs_today.filter((j) => !done.has(j.id));
    if (!left.length) {
      // Next working day with jobs: this week, then next week.
      let upcoming: (FieldJob & { day: string }) | undefined;
      for (const week of [ctx.today, addDays(ctx.today, 7)]) {
        const w = await callInternalApi<{ data?: { days?: Array<{ ymd: string; count: number }> } }>(ctx.req, "GET", "/api/campo/agenda?week=" + week);
        const dayWith = (w.json.data?.days || []).find((d) => d.ymd > ctx.today && d.count > 0);
        if (!dayWith) continue;
        const one = await callInternalApi<{ data?: { jobs?: FieldJob[] } }>(ctx.req, "GET", `/api/campo/agenda?week=${week}&day=${dayWith.ymd}`);
        const j = one.json.data?.jobs?.[0];
        if (j) upcoming = { ...j, day: dayWith.ymd };
        break;
      }
      return {
        kind: "answer",
        args,
        card: {
          title: "Nada mais hoje",
          subtitle: upcoming ? `Próximo: ${fmtDate(upcoming.day)} · ${label(upcoming)}` : undefined,
          sections: [{ type: "note", text: upcoming ? [upcoming.client, upcoming.address].filter(Boolean).join(" · ") : "Sem jobs agendados nos próximos dias." }],
          links: upcoming?.maps_url ? [{ label: "Abrir no mapa", href: upcoming.maps_url }] : [],
          open: { label: "Abrir agenda", href: "/campo/agenda.html" },
        },
      };
    }
    const next = left[0]!;
    return {
      kind: "answer",
      args,
      card: {
        title: "Próximo: " + label(next),
        subtitle: [next.start_label, next.client].filter(Boolean).join(" · "),
        sections: [
          { type: "fields", rows: [{ label: "Endereço", value: next.address || "—" }] },
          ...(left.length > 1 ? [{ type: "list" as const, items: left.slice(1).map((j) => ({ title: label(j), detail: [j.start_label, j.client].filter(Boolean).join(" · "), href: "/campo/ticket.html?id=" + enc(j.id) })) }] : []),
        ],
        links: next.maps_url ? [{ label: "Abrir no mapa", href: next.maps_url }] : [],
        open: TICKET(next.id),
      },
    };
  },
};

export const FIELD_ACTIONS: ActionDef[] = [fieldArrive, fieldFinish, fieldProblem, fieldMeasure, fieldChecklist, fieldExpense, fieldWeek, fieldNext];
