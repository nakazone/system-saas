/**
 * Jobs beyond create/schedule/status/note: crew gaps, AI report, review request, temporary
 * workers, labor cost and adding services. Writes go through the work-order routes.
 */
import { normalizeMateAiUnit, resolveCustomerUnitPrice } from "../command.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { jobLabor } from "../job-economics.js";
import { loadMateAiCatalog, pickService } from "./catalog.js";
import { jobCustomerName, jobLabel, jobMoney, resolveJob } from "./resolve.js";
import { addDays, dayRange, fmtDateTime, localDay } from "./time.js";
import type { ActionContext, ActionDef, ListItem } from "./types.js";
import { money, num, plural, str, unitLabel } from "./types.js";

const enc = encodeURIComponent;

function jobLink(id: string) {
  return { label: "Abrir job", href: "job-detail.html?id=" + enc(id) };
}

async function jobOr(ctx: ActionContext, args: Record<string, unknown>) {
  const r = await resolveJob(ctx, args);
  if (r.status === "clarify") return { done: { kind: "clarify" as const, clarify: r.clarify, args } };
  if (r.status === "missing") return { done: { kind: "error" as const, message: r.message, args } };
  return { job: r.row };
}

/* ───────────────────────── jobs without a crew ───────────────────────── */

export const jobsWithoutCrew: ActionDef = {
  name: "jobs.nocrew",
  description: "List scheduled jobs in the next days (default 7) that have no crew or person assigned.",
  args: { days: "how many days ahead (default 7)" },
  examples: ["Quais jobs da semana estão sem equipe?", "Which jobs have no crew?"],
  permissions: ["work_orders.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const days = Math.min(30, Math.max(1, Math.round(num(args.days) ?? 7)));
    const { start, end } = dayRange(ctx.today, addDays(ctx.today, days - 1), ctx.timezone);
    const rows = await ctx.tx.workOrder.findMany({
      where: { status: { notIn: ["canceled", "completed"] }, crewId: null, assignedUserId: null, members: { none: {} }, scheduledStart: { gte: start, lt: end } },
      select: { id: true, number: true, title: true, scheduledStart: true, allDay: true, address: true, customer: { select: { name: true } } },
      orderBy: { scheduledStart: "asc" },
      take: 40,
    });
    const items: ListItem[] = rows.map((j) => ({
      title: fmtDateTime(j.scheduledStart!, ctx.timezone, j.allDay) + " · " + jobLabel(j),
      detail: [j.customer?.name, j.address].filter(Boolean).join(" · "),
      href: "job-detail.html?id=" + enc(j.id),
      tone: "warning",
      run: { label: "Pôr equipe", action: "job.schedule", args: { job_id: j.id, date: localDay(j.scheduledStart!, ctx.timezone) } },
    }));
    return {
      kind: "answer",
      args,
      card: { title: rows.length ? `${plural(rows.length, "job sem equipe", "jobs sem equipe")} nos próximos ${days} dias` : `Todos os jobs dos próximos ${days} dias têm equipe`, sections: [{ type: "list", items, empty: "Nada a atribuir." }], open: { label: "Abrir agenda", href: "schedule.html" } },
    };
  },
};

/* ───────────────────────── AI report ───────────────────────── */

const REPORT_PT: Record<string, string> = { site_visit: "Visita técnica", progress: "Andamento", delivery: "Entrega", maintenance: "Manutenção" };

export const jobReport: ActionDef = {
  name: "job.report",
  description: "Generate the job's report from its photos (site visit, progress, delivery or maintenance).",
  args: { job: "job number/title", template: "site_visit | progress | delivery | maintenance" },
  examples: ["Gera o relatório do job 1042", "Make a delivery report for the Smith job"],
  permissions: ["work_orders.view"],
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const template = str(args.template) in REPORT_PT ? str(args.template) : job.status === "completed" ? "delivery" : "progress";
    const photos = await ctx.tx.jobMedia.count({ where: { workOrderId: job.id } });
    return {
      kind: "card",
      args: { ...args, job_id: job.id, template },
      card: {
        title: "Relatório do job " + jobLabel(job),
        subtitle: jobCustomerName(job) || undefined,
        sections: [
          { type: "fields", rows: [{ label: "Tipo", value: REPORT_PT[template]!, edit: { path: "template", input: "select", value: template, options: Object.entries(REPORT_PT).map(([value, label]) => ({ value, label })) } }, { label: "Fotos", value: String(photos) }] },
          ...(photos ? [] : [{ type: "note" as const, tone: "warning" as const, text: "O job não tem fotos: o relatório sai só com os serviços." }]),
          { type: "note", text: "Fica salvo no job como rascunho; você revisa antes de mandar ao cliente." },
        ],
        confirm: { label: "Gerar relatório", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: job.id, label: jobLabel(job), template }) } } },
        open: jobLink(job.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string; title?: string } }>(ctx.req, "POST", `/api/work-orders/${enc(String(exec.job_id))}/reports/generate`, { template_key: exec.template });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível gerar o relatório.") };
    return { ok: true, title: `Relatório gerado · ${exec.label}`, detail: res.json.data?.title, links: [jobLink(String(exec.job_id))], entity: { type: "work_order", id: String(exec.job_id) }, memory: `Generated ${exec.template} report for job ${exec.label}` };
  },
};

/* ───────────────────────── review request ───────────────────────── */

export const reviewRequest: ActionDef = {
  name: "job.review",
  description: "Ask the customer of a finished job for a Google review: opens SMS, WhatsApp or e-mail with the message ready.",
  args: { job: "job number/title", customer: "customer name" },
  examples: ["Pede avaliação no Google para o John", "Ask the Smiths for a review"],
  permissions: ["work_orders.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const res = await callInternalApi<{ data?: { message: string; customer_phone: string | null; customer_email: string | null; google_review_url: string | null; whatsapp_url?: string } }>(ctx.req, "GET", `/api/work-orders/${enc(job.id)}/review-request`);
    const d = res.json.data;
    if (!res.ok || !d) return { kind: "error", message: internalError(res, "Não foi possível montar o pedido de avaliação."), args };
    const digits = (d.customer_phone || "").replace(/\D/g, "");
    const e164 = digits.length === 10 ? "1" + digits : digits;
    const links = [
      ...(digits ? [{ label: "Abrir SMS", href: `sms:${digits}?&body=${enc(d.message)}` }, { label: "WhatsApp", href: `https://wa.me/${e164}?text=${enc(d.message)}` }] : []),
      ...(d.customer_email ? [{ label: "E-mail", href: `mailto:${d.customer_email}?subject=${enc("Thank you!")}&body=${enc(d.message)}` }] : []),
    ];
    return {
      kind: "answer",
      args: { ...args, job_id: job.id },
      card: {
        title: "Pedir avaliação · " + (jobCustomerName(job) || jobLabel(job)),
        sections: [
          { type: "note", text: d.message },
          ...(d.google_review_url ? [] : [{ type: "note" as const, tone: "warning" as const, text: "Sem link do Google nas Configurações: a mensagem pede para o cliente responder." }]),
          ...(links.length ? [] : [{ type: "note" as const, tone: "warning" as const, text: "O cliente não tem telefone nem e-mail no cadastro." }]),
        ],
        links,
        open: jobLink(job.id),
      },
    };
  },
};

/* ───────────────────────── temporary worker ───────────────────────── */

export const addTempWorker: ActionDef = {
  name: "job.temp",
  description: "Add a temporary worker to a job and get the access link to send by WhatsApp or SMS.",
  args: { job: "job number/title", name: "worker's name", phone: "phone", notes: "notes" },
  examples: ["Põe o Pedro como temporário no job 1042 e manda o link", "Add a temp helper Luis 720 555 0110 to the Smith job"],
  permissions: ["work_orders.manage"],
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const name = str(args.name, 80);
    if (!name) return { kind: "clarify", args: { ...args, job_id: job.id }, clarify: { question: "Qual o nome do temporário?", options: [], search: { placeholder: "Nome", path: "name" } } };
    const phone = str(args.phone, 30);
    return {
      kind: "card",
      args: { ...args, job_id: job.id },
      card: {
        title: `Temporário no job ${jobLabel(job)}`,
        sections: [{ type: "fields", rows: [{ label: "Nome", value: name, edit: { path: "name", input: "text", value: name } }, { label: "Telefone", value: phone || "—", edit: { path: "phone", input: "text", value: phone } }] }, { type: "note", text: "Ele recebe um link para ver o job e mandar fotos, sem precisar de conta." }],
        confirm: { label: "Adicionar e gerar link", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: job.id, label: jobLabel(job), name, phone: phone || null, notes: str(args.notes, 500) || null }) } } },
        open: jobLink(job.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { name: string; share?: { url: string; whatsapp_url: string; sms_url: string } } }>(ctx.req, "POST", `/api/work-orders/${enc(String(exec.job_id))}/temp-workers`, { name: exec.name, phone: exec.phone, notes: exec.notes });
    const share = res.json.data?.share;
    if (!res.ok || !share) return { ok: false, status: res.status, error: internalError(res, "Não foi possível adicionar o temporário.") };
    return {
      ok: true,
      title: `${res.json.data?.name || exec.name} adicionado ao job ${exec.label}`,
      detail: "Link copiado",
      links: [{ label: "WhatsApp", href: share.whatsapp_url }, { label: "SMS", href: share.sms_url }],
      client: { type: "copy", text: share.url },
      entity: { type: "work_order", id: String(exec.job_id) },
      memory: `Added temp worker ${exec.name} to job ${exec.label}`,
    };
  },
};

/* ───────────────────────── labor cost ───────────────────────── */

export const jobLaborCost: ActionDef = {
  name: "job.labor",
  description: "How much labor a job cost so far: field days and pay per worker, from the campo work days.",
  args: { job: "job number/title" },
  examples: ["Quanto gastei de mão de obra no job 1042?", "Labor cost on the Smith job"],
  permissions: ["work_orders.view", "payroll.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const labor = await jobLabor(ctx.tx, job.id);
    const sold = jobMoney(job).services_total;
    return {
      kind: "answer",
      args: { ...args, job_id: job.id },
      card: {
        title: `Mão de obra do job ${jobLabel(job)}: ${money(labor.total)}`,
        subtitle: `${labor.days} dia(s) de trabalho registrados no app de campo`,
        sections: [
          labor.byEmployee.length
            ? { type: "table", columns: ["Funcionário", "Dias", "Valor"], align: ["left", "right", "right"], rows: labor.byEmployee.map((e) => [e.name, String(e.days), money(e.amount)]) }
            : { type: "note", text: "Nenhum dia de trabalho registrado neste job pelo app de campo." },
          ...(sold > 0 ? [{ type: "totals" as const, rows: [{ label: "Serviços do job", value: money(sold) }, { label: "Mão de obra", value: money(labor.total) }, { label: "Mão de obra / venda", value: Math.round((labor.total / sold) * 100) + "%", strong: true }] }] : []),
        ],
        open: jobLink(job.id),
      },
    };
  },
};

/* ───────────────────────── add services to a job ───────────────────────── */

export const addJobServices: ActionDef = {
  name: "job.add_service",
  description: "Add service lines to an existing job (priced from the table for the job's customer, or the price the user says). Raises what is left to invoice.",
  args: { job: "job number/title", items: "[{service_ref, service_text, quantity, unit, unit_price?}] like quote.create" },
  examples: ["Adiciona 200 pés de rodapé no job 1042", "Add 3 stair nosings to the Smith job at 45 each"],
  permissions: ["work_orders.manage"],
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const a = { ...args, job_id: job.id };
    const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>).slice(0, 8) : [];
    if (!items.length) return { kind: "error", message: "Quais serviços e quantidades? Ex.: “200 pés de rodapé”.", args: a };
    const [catalog, current, customer] = await Promise.all([
      loadMateAiCatalog(ctx.tx, ctx.organizationId),
      ctx.tx.workOrderLineItem.findMany({ where: { workOrderId: job.id }, select: { pricingItemId: true, serviceName: true, quantitySqft: true, unitPrice: true, notes: true }, orderBy: { sortOrder: "asc" } }),
      job.customerId ? ctx.tx.customer.findFirst({ where: { id: job.customerId }, select: { customerType: true, pricingMode: true, customPricingRates: true, name: true } }) : null,
    ]);
    const pricing = customer || { customerType: job.builderId ? "builder" : "particular", pricingMode: "table", customPricingRates: null, name: jobCustomerName(job) };
    const added: Array<{ pricing_item_id: string | null; service_name: string; quantity_sqft: number; unit_price: number; notes: null }> = [];
    const rows: string[][] = [];
    for (let i = 0; i < items.length; i++) {
      const spec = items[i]!;
      const qty = num(spec.quantity);
      if (qty == null || qty <= 0) return { kind: "error", message: `Qual a quantidade de “${str(spec.service_text)}”?`, args: a };
      const picked = pickService(catalog, spec);
      if (picked.status === "choose") {
        return { kind: "clarify", args: a, clarify: { question: `Qual serviço é “${str(spec.service_text)}”?`, options: picked.options.map((o) => ({ label: o.name, detail: normalizeMateAiUnit(o.unit) || o.unit, patch: { [`items.${i}.catalog_item_id`]: o.id, [`items.${i}.catalog_source`]: o.source } })) } };
      }
      const item = picked.item;
      const said = num(spec.unit_price);
      const rate = said != null && said > 0 ? Math.round(said * 100) / 100 : resolveCustomerUnitPrice(item, pricing) || 0;
      if (rate <= 0) {
        return { kind: "clarify", args: a, clarify: { question: `“${item.name}” não tem preço para ${pricing.name || "este cliente"}. Qual o preço por ${unitLabel(normalizeMateAiUnit(item.unit) || item.unit) || "unidade"}?`, options: [], search: { placeholder: "Preço em $", path: `items.${i}.unit_price` } } };
      }
      added.push({ pricing_item_id: item.pricingItemId, service_name: item.name, quantity_sqft: qty, unit_price: rate, notes: null });
      rows.push([item.name, `${qty.toLocaleString("en-US")} ${unitLabel(normalizeMateAiUnit(item.unit) || item.unit)}`.trim(), money(rate), money(qty * rate)]);
    }
    const before = jobMoney(job).services_total;
    const plus = added.reduce((s, x) => s + Math.round(x.quantity_sqft * x.unit_price * 100) / 100, 0);
    const lines = [
      ...current.map((c) => ({ pricing_item_id: c.pricingItemId, service_name: c.serviceName, quantity_sqft: Number(c.quantitySqft), unit_price: Number(c.unitPrice), notes: c.notes })),
      ...added,
    ];
    return {
      kind: "card",
      args: a,
      card: {
        title: "Adicionar ao job " + jobLabel(job),
        subtitle: jobCustomerName(job) || undefined,
        sections: [
          { type: "table", columns: ["Serviço", "Qtd", "Preço", "Total"], align: ["left", "right", "right", "right"], rows },
          { type: "totals", rows: [{ label: "Serviços antes", value: money(before) }, { label: "Novo total do job", value: money(before + plus), strong: true }] },
        ],
        confirm: { label: "Adicionar ao job", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: job.id, label: jobLabel(job), lines, prev: current.map((c) => ({ pricing_item_id: c.pricingItemId, service_name: c.serviceName, quantity_sqft: Number(c.quantitySqft), unit_price: Number(c.unitPrice), notes: c.notes })), plus }) } } },
        open: jobLink(job.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/work-orders/" + enc(String(exec.job_id)), { line_items: exec.lines });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível adicionar os serviços.") };
    return {
      ok: true,
      title: `+${money(Number(exec.plus))} no job ${exec.label}`,
      links: [jobLink(String(exec.job_id))],
      undo: { job_id: exec.job_id, lines: exec.prev },
      next: { label: "Faturar o que falta", action: "invoice.job", args: { job_id: exec.job_id, invoice_type: "final" } },
      entity: { type: "work_order", id: String(exec.job_id) },
      memory: `Added services (${money(Number(exec.plus))}) to job ${exec.label}`,
    };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PUT", "/api/work-orders/" + enc(String(u.job_id)), { line_items: u.lines });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer.") };
    return { ok: true, title: "Serviços do job restaurados" };
  },
};

export const JOB_MORE_ACTIONS: ActionDef[] = [jobsWithoutCrew, jobReport, reviewRequest, addTempWorker, jobLaborCost, addJobServices];
