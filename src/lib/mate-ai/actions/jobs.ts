import { withTenantTransaction } from "../../tenant/prisma-tenant.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { jobCustomerName, jobLabel, resolveCrew, resolveCustomer, resolveJob, resolveQuote, jobSelect, quoteLabel } from "./resolve.js";
import { cleanTime, dayRange, fmtDateTime, isIsoDay, localDay, localTime, zonedToUtc } from "./time.js";
import type { ActionDef, ExecuteContext, ExecuteResult } from "./types.js";
import { str, uuidOrNull } from "./types.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";

const JOB_STATUS_PT: Record<string, string> = {
  draft: "rascunho",
  scheduled: "agendado",
  in_progress: "em andamento",
  completed: "concluído",
  canceled: "cancelado",
};

function scheduleText(start: Date | null, end: Date | null, allDay: boolean, tz: string): string {
  if (!start) return "sem data";
  let s = fmtDateTime(start, tz, allDay);
  if (end && !allDay && localDay(end, tz) === localDay(start, tz)) s += "–" + localTime(end, tz);
  return s;
}

function jobLink(id: string) {
  return { label: "Abrir job", href: "job-detail.html?id=" + encodeURIComponent(id) };
}

async function putJob(ctx: ExecuteContext, id: string, body: Record<string, unknown>) {
  return callInternalApi(ctx.req, "PUT", "/api/work-orders/" + encodeURIComponent(id), body);
}

/* ───────────────────────── schedule ───────────────────────── */

export const scheduleJob: ActionDef = {
  name: "job.schedule",
  description: "Schedule or reschedule an existing job: date, start time, optional end time and crew/person.",
  args: {
    job: "job number (e.g. '1042'), title or address as said",
    customer: "customer name when the job is identified by customer",
    date: "YYYY-MM-DD",
    time: "HH:MM 24h start, empty for all day",
    end_time: "HH:MM 24h, optional",
    crew: "crew or person name, optional",
  },
  examples: ["Agenda o job 1042 para segunda às 7h com a equipe do Carlos", "Move the Smith job to Friday 8am"],
  permissions: ["work_orders.manage", "schedule.manage"],
  async prepare(ctx, args) {
    const job = await resolveJob(ctx, args);
    if (job.status === "clarify") return { kind: "clarify", clarify: job.clarify, args };
    if (job.status === "missing") return { kind: "error", message: job.message, args };
    const j = job.row;
    if (j.status === "canceled" || j.status === "completed") {
      return { kind: "error", message: `O job ${jobLabel(j)} está ${JOB_STATUS_PT[j.status]}; não dá para agendar.`, args };
    }
    const date = str(args.date);
    if (!isIsoDay(date)) {
      return {
        kind: "clarify",
        args: { ...args, job_id: j.id },
        clarify: {
          question: `Para quando agendar o job ${jobLabel(j)}?`,
          options: [1, 2, 3].map((n) => {
            const d = new Date(ctx.today + "T12:00:00Z");
            d.setUTCDate(d.getUTCDate() + n);
            const day = d.toISOString().slice(0, 10);
            return { label: new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "short" }).format(d), patch: { date: day } };
          }),
          search: { placeholder: "Data (AAAA-MM-DD)", path: "date" },
        },
      };
    }
    const time = cleanTime(args.time);
    const endTime = cleanTime(args.end_time);
    const crew = await resolveCrew(ctx, args);
    if (crew.status === "clarify") return { kind: "clarify", clarify: crew.clarify, args: { ...args, job_id: j.id } };

    const allDay = !time;
    const start = zonedToUtc(date, time || "00:00", ctx.timezone)!;
    let end: Date | null = null;
    if (endTime) end = zonedToUtc(date, endTime, ctx.timezone);
    else if (!allDay && j.scheduledStart && j.scheduledEnd && !j.allDay) {
      end = new Date(start.getTime() + (j.scheduledEnd.getTime() - j.scheduledStart.getTime()));
    }
    if (end && end <= start) return { kind: "error", message: "O fim precisa ser depois do início.", args };

    const crewId = crew.status === "ok" && crew.row.kind === "crew" ? crew.row.id : uuidOrNull(args.crew_id);
    const userId = crew.status === "ok" && crew.row.kind === "user" ? crew.row.id : uuidOrNull(args.user_id);
    const crewName = crew.status === "ok" ? crew.row.name : j.crew?.name || "";

    // Conflicts: same crew/person busy that day.
    const { start: d0, end: d1 } = dayRange(date, date, ctx.timezone);
    const who = crewId || j.crewId;
    const conflicts = who || userId || j.assignedUserId
      ? await ctx.tx.workOrder.findMany({
          where: {
            id: { not: j.id },
            status: { notIn: ["canceled", "completed"] },
            scheduledStart: { gte: d0, lt: d1 },
            OR: [
              ...(who ? [{ crewId: who }] : []),
              ...((userId || j.assignedUserId) ? [{ assignedUserId: userId || j.assignedUserId }] : []),
            ],
          },
          select: { number: true, title: true, scheduledStart: true, allDay: true },
          take: 5,
        })
      : [];

    const exec = {
      job_id: j.id,
      label: jobLabel(j),
      scheduled_start: start.toISOString(),
      scheduled_end: end ? end.toISOString() : null,
      all_day: allDay,
      crew_id: crewId ?? undefined,
      assigned_user_id: userId ?? undefined,
      set_status: j.status === "draft" ? "scheduled" : undefined,
      prev: {
        scheduled_start: j.scheduledStart ? j.scheduledStart.toISOString() : null,
        scheduled_end: j.scheduledEnd ? j.scheduledEnd.toISOString() : null,
        all_day: j.allDay,
        crew_id: j.crewId,
        assigned_user_id: j.assignedUserId,
        status: j.status,
      },
    };
    return {
      kind: "card",
      args: { ...args, job_id: j.id },
      card: {
        title: "Agendar job " + jobLabel(j),
        subtitle: jobCustomerName(j) || undefined,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Antes", value: scheduleText(j.scheduledStart, j.scheduledEnd, j.allDay, ctx.timezone) },
              { label: "Data", value: scheduleText(start, end, allDay, ctx.timezone), edit: { path: "date", input: "date", value: date } },
              { label: "Início", value: time || "dia inteiro", edit: { path: "time", input: "text", value: time || "" } },
              { label: "Equipe", value: crewName || "sem equipe" },
              ...(j.address ? [{ label: "Endereço", value: j.address }] : []),
            ],
          },
          ...(conflicts.length
            ? [{
                type: "note" as const,
                tone: "warning" as const,
                text:
                  "Mesmo dia, mesma equipe: " +
                  conflicts.map((c) => jobLabel(c) + (c.scheduledStart ? " (" + (c.allDay ? "dia inteiro" : localTime(c.scheduledStart, ctx.timezone)) + ")" : "")).join("; "),
              }]
            : []),
        ],
        confirm: { label: "Agendar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: jobLink(j.id),
      },
    };
  },
  async execute(ctx, exec) {
    const body: Record<string, unknown> = {
      scheduled_start: exec.scheduled_start,
      scheduled_end: exec.scheduled_end,
      all_day: exec.all_day,
    };
    if (exec.crew_id) body.crew_id = exec.crew_id;
    if (exec.assigned_user_id) body.assigned_user_id = exec.assigned_user_id;
    if (exec.set_status) body.status = exec.set_status;
    const res = await putJob(ctx, String(exec.job_id), body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível agendar o job.") };
    const start = new Date(String(exec.scheduled_start));
    const end = exec.scheduled_end ? new Date(String(exec.scheduled_end)) : null;
    const when = scheduleText(start, end, Boolean(exec.all_day), ctx.timezone);
    return {
      ok: true,
      title: "Job " + exec.label + " agendado",
      detail: when,
      links: [jobLink(String(exec.job_id)), { label: "Ver agenda", href: "schedule.html" }],
      undo: { job_id: exec.job_id, body: exec.prev },
      entity: { type: "work_order", id: String(exec.job_id) },
      memory: `Scheduled job ${exec.label} for ${when}`,
    };
  },
  async undo(ctx, undo) {
    const prev = (undo.body || {}) as Record<string, unknown>;
    const res = await putJob(ctx, String(undo.job_id), {
      scheduled_start: prev.scheduled_start ?? null,
      scheduled_end: prev.scheduled_end ?? null,
      all_day: Boolean(prev.all_day),
      crew_id: prev.crew_id ?? null,
      assigned_user_id: prev.assigned_user_id ?? null,
      ...(prev.status ? { status: prev.status } : {}),
    });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Agendamento desfeito", entity: { type: "work_order", id: String(undo.job_id) } };
  },
};

/* ───────────────────────── status ───────────────────────── */

const STATUS_WORDS: Array<[RegExp, string]> = [
  [/conclu|termin|finaliz|complet|done|finish/i, "completed"],
  [/andamento|come[cç]|inici|start|progress/i, "in_progress"],
  [/agendad|schedul/i, "scheduled"],
];

export const setJobStatus: ActionDef = {
  name: "job.status",
  description: "Change a job's status to completed, in_progress or scheduled (does NOT issue invoices).",
  args: { job: "job number/title/address", customer: "customer name", status: "completed | in_progress | scheduled" },
  examples: ["Marca o job 1042 como concluído", "Job do John começou hoje"],
  permissions: ["work_orders.manage", "schedule.manage"],
  async prepare(ctx, args) {
    const job = await resolveJob(ctx, args);
    if (job.status === "clarify") return { kind: "clarify", clarify: job.clarify, args };
    if (job.status === "missing") return { kind: "error", message: job.message, args };
    const j = job.row;
    let status = str(args.status);
    if (!["completed", "in_progress", "scheduled"].includes(status)) {
      status = STATUS_WORDS.find(([re]) => re.test(status))?.[1] || "";
    }
    if (!status) {
      return {
        kind: "clarify",
        args: { ...args, job_id: j.id },
        clarify: {
          question: `Qual o novo status do job ${jobLabel(j)}?`,
          options: [
            { label: "Concluído", patch: { status: "completed" } },
            { label: "Em andamento", patch: { status: "in_progress" } },
            { label: "Agendado", patch: { status: "scheduled" } },
          ],
        },
      };
    }
    if (j.status === "canceled") return { kind: "error", message: `O job ${jobLabel(j)} está cancelado.`, args };
    if (j.status === status) return { kind: "error", message: `O job ${jobLabel(j)} já está ${JOB_STATUS_PT[status]}.`, args };
    const exec = { job_id: j.id, label: jobLabel(j), status, prev_status: j.status };
    return {
      kind: "card",
      args: { ...args, job_id: j.id, status },
      card: {
        title: "Mudar status do job " + jobLabel(j),
        subtitle: jobCustomerName(j) || undefined,
        sections: [
          { type: "fields", rows: [{ label: "Agora", value: JOB_STATUS_PT[j.status] || j.status }, { label: "Novo", value: JOB_STATUS_PT[status]! }] },
          ...(status === "completed" ? [{ type: "note" as const, text: "Não emite invoice. Depois, se quiser: “invoice do job " + (j.number ?? "") + "”." }] : []),
        ],
        confirm: { label: "Marcar como " + JOB_STATUS_PT[status], tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: jobLink(j.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await putJob(ctx, String(exec.job_id), { status: exec.status });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível mudar o status.") };
    const isDone = exec.status === "completed";
    return {
      ok: true,
      title: "Job " + exec.label + " " + JOB_STATUS_PT[String(exec.status)],
      links: [jobLink(String(exec.job_id))],
      undo: { job_id: exec.job_id, status: exec.prev_status },
      next: isDone ? { label: "Emitir invoice", action: "invoice.job", args: { job_id: exec.job_id, job: "", customer_query: "", invoice_type: "auto" } } : undefined,
      entity: { type: "work_order", id: String(exec.job_id) },
      memory: `Job ${exec.label} marked ${exec.status}`,
    };
  },
  async undo(ctx, undo) {
    const res = await putJob(ctx, String(undo.job_id), { status: undo.status });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Status restaurado", entity: { type: "work_order", id: String(undo.job_id) } };
  },
};

/* ───────────────────────── note ───────────────────────── */

export const addJobNote: ActionDef = {
  name: "job.note",
  description: "Add a note to a job, or an attention note for the field crew (campo).",
  args: { job: "job number/title/address", customer: "customer name", text: "the note", target: "notes | field (field = shown to the crew as ATENÇÃO)" },
  examples: ["Nota no job 1042: cliente pediu rodapé branco", "Avisa a equipe no job do John que o portão é pelo fundo"],
  permissions: ["work_orders.manage", "schedule.manage"],
  async prepare(ctx, args) {
    const text = str(args.text, 1500);
    const job = await resolveJob(ctx, args);
    if (job.status === "clarify") return { kind: "clarify", clarify: job.clarify, args };
    if (job.status === "missing") return { kind: "error", message: job.message, args };
    const j = job.row;
    if (!text) return { kind: "error", message: "Qual é a nota?", args: { ...args, job_id: j.id } };
    const field = str(args.target) === "field" ? "field" : "notes";
    const exec = { job_id: j.id, label: jobLabel(j), text, field };
    return {
      kind: "card",
      args: { ...args, job_id: j.id },
      card: {
        title: (field === "field" ? "Atenção para o campo no job " : "Nota no job ") + jobLabel(j),
        subtitle: jobCustomerName(j) || undefined,
        sections: [
          { type: "fields", rows: [{ label: field === "field" ? "Atenção (equipe vê)" : "Nota", value: text, edit: { path: "text", input: "text", value: text } }] },
        ],
        confirm: { label: "Adicionar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: jobLink(j.id),
      },
    };
  },
  async execute(ctx, exec) {
    const field = exec.field === "field" ? "campoAttention" : "notes";
    const current = await withTenantTransaction(ctx.organizationId, (tx) =>
      tx.workOrder.findFirst({ where: { id: String(exec.job_id) }, select: { notes: true, campoAttention: true } }),
    );
    if (!current) return { ok: false, status: 404, error: "Job não encontrado." };
    const before = (field === "notes" ? current.notes : current.campoAttention) || "";
    const stamp = new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.timezone, day: "2-digit", month: "2-digit" }).format(new Date());
    const line = field === "notes" ? `[${stamp}] ${exec.text}` : String(exec.text);
    const after = (before ? before.trimEnd() + "\n" : "") + line;
    const max = field === "notes" ? 8000 : 2000;
    if (after.length > max) return { ok: false, status: 422, error: "As notas do job estão cheias; edite no job." };
    const res = await putJob(ctx, String(exec.job_id), field === "notes" ? { notes: after } : { campo_attention: after });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível salvar a nota.") };
    return {
      ok: true,
      title: "Nota adicionada no job " + exec.label,
      detail: String(exec.text),
      links: [jobLink(String(exec.job_id))],
      undo: { job_id: exec.job_id, field, before },
      entity: { type: "work_order", id: String(exec.job_id) },
      memory: `Added note to job ${exec.label}`,
    };
  },
  async undo(ctx, undo) {
    const body = undo.field === "campoAttention" ? { campo_attention: undo.before || null } : { notes: undo.before || null };
    const res = await putJob(ctx, String(undo.job_id), body);
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Nota removida", entity: { type: "work_order", id: String(undo.job_id) } };
  },
};

/* ───────────────────────── create ───────────────────────── */

export const createJob: ActionDef = {
  name: "job.create",
  description: "Create a new job for a customer (optionally with date, time, crew), or the job of an approved quote.",
  args: {
    customer: "customer name",
    quote: "quote number when creating the job from an approved quote",
    title: "short job title, e.g. 'Kitchen hardwood'",
    address: "job address",
    date: "YYYY-MM-DD optional",
    time: "HH:MM optional",
    crew: "crew or person optional",
    notes: "optional",
  },
  examples: ["Cria o job da obra do John a partir do quote aprovado", "Novo job para Maria Silva, troca de piso da cozinha, quinta 8h"],
  permissions: ["work_orders.manage"],
  async prepare(ctx, args) {
    // From an approved quote → same function the approval uses.
    if (str(args.quote) || uuidOrNull(args.quote_id) || ctx.screen?.type === "quote") {
      const q = await resolveQuote(ctx, args, { approvedOnly: true });
      if (q.status === "clarify") return { kind: "clarify", clarify: q.clarify, args };
      if (q.status === "missing") return { kind: "error", message: q.message, args };
      const quote = q.row;
      if (!["approved", "converted"].includes(normalizeQuoteStatus(quote.status))) {
        return { kind: "error", message: `O Quote ${quoteLabel(quote)} ainda não foi aprovado.`, args };
      }
      if (quote.workOrderId) {
        const existing = await ctx.tx.workOrder.findFirst({ where: { id: quote.workOrderId }, select: { id: true, number: true, title: true } });
        if (existing) {
          return {
            kind: "answer",
            args,
            card: {
              title: "Este Quote já tem job",
              sections: [{ type: "fields", rows: [{ label: "Job", value: jobLabel(existing) }] }],
              links: [jobLink(existing.id)],
            },
          };
        }
      }
      const exec = { mode: "from_quote", quote_id: quote.id, label: quoteLabel(quote) };
      return {
        kind: "card",
        args: { ...args, quote_id: quote.id },
        card: {
          title: "Criar job do Quote " + quoteLabel(quote),
          sections: [{ type: "note", text: "Usa os serviços e o cliente do Quote, como na aprovação." }],
          confirm: { label: "Criar job", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        },
      };
    }

    const cust = await resolveCustomer(ctx, args);
    if (cust.status === "clarify") return { kind: "clarify", clarify: cust.clarify, args };
    if (cust.status === "missing") return { kind: "error", message: cust.message, args };
    const c = cust.row;
    const crew = await resolveCrew(ctx, args);
    if (crew.status === "clarify") return { kind: "clarify", clarify: crew.clarify, args: { ...args, customer_id: c.id } };
    const title = str(args.title, 200) || c.name;
    const date = str(args.date);
    const time = cleanTime(args.time);
    const start = isIsoDay(date) ? zonedToUtc(date, time || "00:00", ctx.timezone) : null;
    const address = str(args.address, 500);
    const type = ["particular", "builder", "contractor", "loja"].includes(c.customerType) ? c.customerType : "particular";
    const exec = {
      mode: "new",
      body: {
        title: title.length >= 2 ? title : title + " job",
        customer_id: c.id,
        source_type: type,
        address: address || null,
        notes: str(args.notes, 4000) || null,
        scheduled_start: start ? start.toISOString() : null,
        all_day: start ? !time : false,
        crew_id: crew.status === "ok" && crew.row.kind === "crew" ? crew.row.id : null,
        assigned_user_id: crew.status === "ok" && crew.row.kind === "user" ? crew.row.id : null,
      },
      label: title,
    };
    return {
      kind: "card",
      args: { ...args, customer_id: c.id },
      card: {
        title: "Criar job para " + c.name,
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Título", value: exec.body.title, edit: { path: "title", input: "text", value: exec.body.title } },
              { label: "Endereço", value: address || "—", edit: { path: "address", input: "text", value: address } },
              { label: "Data", value: start ? scheduleText(start, null, !time, ctx.timezone) : "sem data", edit: { path: "date", input: "date", value: isIsoDay(date) ? date : "" } },
              { label: "Equipe", value: crew.status === "ok" ? crew.row.name : "sem equipe" },
            ],
          },
          { type: "note", text: "Os serviços e preços do job são adicionados na tela do job." },
        ],
        confirm: { label: "Criar job", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
      },
    };
  },
  async execute(ctx, exec): Promise<ExecuteResult> {
    if (exec.mode === "from_quote") {
      const { ensureWorkOrderOnApprove } = await import("../../work-orders/from-quote.js");
      const job = await withTenantTransaction(ctx.organizationId, (tx) =>
        ensureWorkOrderOnApprove(tx, { organizationId: ctx.organizationId, quoteId: String(exec.quote_id), actorId: ctx.userId }),
      );
      if (!job?.id) return { ok: false, status: 409, error: "Não foi possível criar o job deste Quote." };
      const row = await withTenantTransaction(ctx.organizationId, (tx) => tx.workOrder.findFirst({ where: { id: job.id }, select: jobSelect }));
      return {
        ok: true,
        title: "Job " + (row ? jobLabel(row) : "") + " criado",
        links: [jobLink(job.id)],
        next: { label: "Agendar", action: "job.schedule", args: { job_id: job.id } },
        entity: { type: "work_order", id: job.id },
        memory: `Created job ${row ? jobLabel(row) : job.id} from quote ${exec.label}`,
      };
    }
    const res = await callInternalApi<{ data?: { id: string; number?: number; title?: string } }>(ctx.req, "POST", "/api/work-orders", exec.body);
    if (!res.ok || !res.json.data?.id) return { ok: false, status: res.status, error: internalError(res, "Não foi possível criar o job.") };
    const d = res.json.data;
    const label = jobLabel({ number: d.number ?? null, title: d.title || String(exec.label) });
    return {
      ok: true,
      title: "Job " + label + " criado",
      links: [jobLink(d.id)],
      next: (exec.body as Record<string, unknown>).scheduled_start ? undefined : { label: "Agendar", action: "job.schedule", args: { job_id: d.id } },
      entity: { type: "work_order", id: d.id },
      memory: `Created job ${label}`,
    };
  },
};
