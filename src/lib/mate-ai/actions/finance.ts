/**
 * Money questions and costs: cash flow, receivables, a cost (optionally for a job), a receipt
 * photo read into a cost, the week at a glance and month vs month.
 */
import { computeInvoiceMoney } from "../../invoices/core.js";
import { getAttachment } from "../attachments.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { jobLabel, resolveJob } from "./resolve.js";
import { addDays, dayRange, fmtDate, isIsoDay } from "./time.js";
import type { ActionContext, ActionDef, ListItem } from "./types.js";
import { dayIn, money, num, str } from "./types.js";

const FIN = { label: "Abrir Fluxo", href: "finance.html" };
const round2 = (n: number) => Math.round(n * 100) / 100;

const CATEGORIES: Record<string, string> = { materials: "Material", services: "Serviços", utilities: "Contas", travel: "Combustível / viagem", equipment: "Equipamento", taxes: "Impostos", other: "Outro" };
function category(v: unknown): string {
  const t = str(v, 40).toLowerCase();
  if (/mater|piso|cola|madeira|lumber|supply|home depot|floor/.test(t)) return "materials";
  if (/gas|combust|fuel|viag|travel|uber|parking|estacion/.test(t)) return "travel";
  if (/equip|ferram|tool|rent|alug/.test(t)) return "equipment";
  if (/imposto|tax/.test(t)) return "taxes";
  if (/luz|água|internet|phone|util|conta/.test(t)) return "utilities";
  if (/servi|subcontr|dump|lixo/.test(t)) return "services";
  return t in CATEGORIES ? t : "other";
}

async function optionalJob(ctx: ActionContext, args: Record<string, unknown>) {
  if (!str(args.job) && !args.job_id) return { job: null };
  const r = await resolveJob(ctx, args);
  if (r.status === "clarify") return { clarify: r.clarify };
  if (r.status === "missing") return { error: r.message };
  return { job: r.row };
}

/* ───────────────────────── cash flow ───────────────────────── */

export const cashflow: ActionDef = {
  name: "finance.cashflow",
  description: "Cash flow: money in (payments received) and out (costs, crew pay) in the last N days, and what is expected to come in next (open invoices by due date).",
  args: { days: "period in days (default 30)" },
  examples: ["Como está meu caixa?", "Fluxo de caixa do mês", "Cash flow"],
  permissions: ["finance.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const days = Math.min(365, Math.max(7, Math.round(num(args.days) ?? 30)));
    const from = dayRange(addDays(ctx.today, -(days - 1)), ctx.today, ctx.timezone);
    const [receipts, costs, pay, open] = await Promise.all([
      ctx.tx.invoiceReceipt.aggregate({ where: { paidAt: { gte: from.start, lt: from.end } }, _sum: { amount: true } }),
      ctx.tx.financeCost.aggregate({ where: { status: "posted", incurredOn: { gte: from.start, lt: from.end } }, _sum: { amount: true } }),
      ctx.tx.payrollPayment.aggregate({ where: { status: "paid", paidOn: { gte: from.start, lt: from.end } }, _sum: { amount: true } }),
      ctx.tx.quoteInvoice.findMany({ where: { status: { in: ["sent", "partially_paid"] } }, select: { amount: true, status: true, dueDate: true, receipts: { select: { amount: true } } }, take: 2000 }),
    ]);
    const inn = Number(receipts._sum.amount || 0);
    const out = Number(costs._sum.amount || 0) + Number(pay._sum.amount || 0);
    const next30 = addDays(ctx.today, 30);
    let overdue = 0;
    let soon = 0;
    let later = 0;
    for (const i of open) {
      const bal = computeInvoiceMoney(i).balance;
      if (bal <= 0) continue;
      const due = dayIn(i.dueDate, ctx.timezone);
      if (due && due < ctx.today) overdue += bal;
      else if (!due || due <= next30) soon += bal;
      else later += bal;
    }
    return {
      kind: "answer",
      args,
      card: {
        title: `Caixa dos últimos ${days} dias: ${money(inn - out)}`,
        subtitle: `Entrou ${money(inn)} · saiu ${money(out)}`,
        sections: [
          { type: "totals", rows: [{ label: "Recebido de clientes", value: money(inn) }, { label: "Custos lançados", value: money(Number(costs._sum.amount || 0)) }, { label: "Folha paga", value: money(Number(pay._sum.amount || 0)) }, { label: "Saldo do período", value: money(inn - out), strong: true }] },
          { type: "totals", rows: [{ label: "A receber vencido", value: money(overdue) }, { label: "A receber nos próximos 30 dias", value: money(soon) }, { label: "Depois", value: money(later) }, { label: "Projeção 30 dias (vencido + próximos)", value: money(overdue + soon), strong: true }] },
        ],
        open: FIN,
      },
    };
  },
};

/* ───────────────────────── receivables ───────────────────────── */

export const receivables: ActionDef = {
  name: "finance.receivables",
  description: "What customers owe: open invoice balances by due date (overdue, until a date, later), biggest first.",
  args: { until: "YYYY-MM-DD (default end of this month)" },
  examples: ["Quanto tenho a receber até o fim do mês?", "Accounts receivable"],
  permissions: ["invoices.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const until = isIsoDay(args.until) ? String(args.until) : (() => { const d = new Date(ctx.today + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); })();
    const rows = await ctx.tx.quoteInvoice.findMany({ where: { status: { in: ["sent", "partially_paid"] } }, select: { id: true, invoiceNumber: true, amount: true, status: true, dueDate: true, receipts: { select: { amount: true } }, customer: { select: { name: true } } }, take: 2000 });
    const open = rows.map((r) => ({ r, bal: computeInvoiceMoney(r).balance, due: dayIn(r.dueDate, ctx.timezone) })).filter((x) => x.bal > 0.004);
    const inWindow = open.filter((x) => !x.due || x.due <= until);
    const overdue = open.filter((x) => x.due && x.due < ctx.today);
    const sum = (l: typeof open) => round2(l.reduce((s, x) => s + x.bal, 0));
    const items: ListItem[] = inWindow.sort((a, b) => b.bal - a.bal).slice(0, 12).map((x) => ({ title: `${x.r.customer?.name || "Cliente"} · ${money(x.bal)}`, detail: `${x.r.invoiceNumber || "Invoice"}${x.due ? " · vence " + fmtDate(x.due) : ""}`, href: "invoice.html?id=" + encodeURIComponent(x.r.id), tone: x.due && x.due < ctx.today ? "critical" : "neutral" }));
    return {
      kind: "answer",
      args: { ...args, until },
      card: {
        title: `A receber até ${fmtDate(until)}: ${money(sum(inWindow))}`,
        subtitle: `${money(sum(overdue))} já vencido · ${money(sum(open))} em aberto no total`,
        sections: [{ type: "list", items, empty: "Nada a receber nesse prazo." }],
        open: { label: "Abrir Invoices", href: "invoices.html" },
      },
    };
  },
};

/* ───────────────────────── a cost ───────────────────────── */

export const addCost: ActionDef = {
  name: "finance.cost",
  acceptsPhoto: true,
  description: "Record a company cost (material, gas, equipment…), optionally for a job, with the attached receipt photo if any.",
  args: { amount: "dollars", description: "what was bought", vendor: "store / supplier", job: "job number if it was for a job", category: "materials | travel | equipment | services | utilities | taxes | other", date: "YYYY-MM-DD (default today)" },
  examples: ["Gastei 340 na Home Depot para o job 1042", "Paguei 120 de aluguel da lixadeira", "Spent 85 on glue for the Smith job"],
  permissions: ["finance.manage"],
  async prepare(ctx, args) {
    const amount = num(args.amount);
    if (!amount || amount <= 0) return { kind: "clarify", args, clarify: { question: "Qual o valor?", options: [], search: { placeholder: "Valor em $", path: "amount" } } };
    const j = await optionalJob(ctx, args);
    if ("clarify" in j && j.clarify) return { kind: "clarify", clarify: j.clarify, args };
    if ("error" in j && j.error) return { kind: "error", message: j.error, args };
    const job = "job" in j ? j.job : null;
    const vendor = str(args.vendor, 120);
    const desc = str(args.description, 200) || (vendor ? "Compra · " + vendor : "Custo");
    const cat = category(args.category || desc + " " + vendor);
    const date = isIsoDay(args.date) ? String(args.date) : ctx.today;
    const photo = Boolean(getAttachment(ctx.organizationId, ctx.userId, args.photo_id));
    return {
      kind: "card",
      args: { ...args, ...(job ? { job_id: job.id } : {}), category: cat },
      card: {
        title: `Custo de ${money(amount)}`,
        subtitle: job ? "Job " + jobLabel(job) : undefined,
        sections: [{ type: "fields", rows: [{ label: "O quê", value: desc, edit: { path: "description", input: "text", value: desc } }, { label: "Onde", value: vendor || "—", edit: { path: "vendor", input: "text", value: vendor } }, { label: "Categoria", value: CATEGORIES[cat]!, edit: { path: "category", input: "select", value: cat, options: Object.entries(CATEGORIES).map(([value, label]) => ({ value, label })) } }, { label: "Data", value: fmtDate(date), edit: { path: "date", input: "date", value: date } }, { label: "Recibo", value: photo ? "foto anexada" : "sem foto" }] }],
        confirm: { label: "Lançar custo", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ amount, desc, vendor: vendor || null, cat, date, job_id: job?.id || null, job: job ? jobLabel(job) : null, photo_id: photo ? args.photo_id : null }) } } },
        open: FIN,
      },
    };
  },
  async execute(ctx, exec) {
    const photo = exec.photo_id ? getAttachment(ctx.organizationId, ctx.userId, exec.photo_id) : null;
    const res = await callInternalApi<{ data?: { id: string } }>(ctx.req, "POST", "/api/finance/costs", { description: exec.desc, amount: exec.amount, incurred_on: exec.date, category: exec.cat, vendor_name: exec.vendor, work_order_id: exec.job_id, ...(photo ? { receipt_data_url: photo } : {}) });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui lançar o custo.") };
    return { ok: true, title: `Custo de ${money(Number(exec.amount))} lançado`, detail: [exec.desc, exec.job ? "job " + exec.job : null].filter(Boolean).join(" · "), links: [FIN], ...(exec.job_id ? { entity: { type: "work_order", id: String(exec.job_id) } } : {}), memory: `Cost ${money(Number(exec.amount))} ${exec.desc}${exec.job ? " for job " + exec.job : ""}` };
  },
};

/* ───────────────────────── receipt photo → cost ───────────────────────── */

export const scanReceipt: ActionDef = {
  name: "finance.scan",
  acceptsPhoto: true,
  description: "Read the attached receipt photo (store, total, date) and record it as a cost, optionally for a job. Needs a photo attached.",
  args: { job: "job number if it was for a job", amount: "total if the user said it (overrides the reading)" },
  examples: ["[foto do recibo] lança isso", "Lança esse recibo no job 1042"],
  permissions: ["finance.manage"],
  async prepare(ctx, args) {
    if (!getAttachment(ctx.organizationId, ctx.userId, args.photo_id)) return { kind: "error", message: "Anexe a foto do recibo (botão da câmera) e diga de novo.", args };
    const j = await optionalJob(ctx, args);
    if ("clarify" in j && j.clarify) return { kind: "clarify", clarify: j.clarify, args };
    const job = "job" in j ? j.job : null;
    const said = num(args.amount);
    return {
      kind: "card",
      args: { ...args, ...(job ? { job_id: job.id } : {}) },
      card: {
        title: "Lançar recibo da foto",
        subtitle: job ? "Job " + jobLabel(job) : undefined,
        sections: [{ type: "note", text: "Leio loja, total e data do recibo e lanço como custo" + (said ? ` de ${money(said)}` : "") + ". Você confere depois em Fluxo." }],
        confirm: { label: "Ler e lançar", tone: "money", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ photo_id: args.photo_id, job_id: job?.id || null, job: job ? jobLabel(job) : null, amount: said }) } } },
        open: FIN,
      },
    };
  },
  async execute(ctx, exec) {
    const photo = getAttachment(ctx.organizationId, ctx.userId, exec.photo_id);
    if (!photo) return { ok: false, status: 410, error: "A foto expirou. Anexe de novo." };
    const res = await callInternalApi<{ data?: { id: string; amount?: number; vendor_name?: string | null; description?: string; incurred_on?: string } }>(ctx.req, "POST", "/api/finance/costs/scan", { receipt_data_url: photo, work_order_id: exec.job_id, ...(exec.amount ? { amount: exec.amount } : {}) });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui ler o recibo.") };
    const d: { amount?: number; vendor_name?: string | null; description?: string } = res.json.data || {};
    return { ok: true, title: `Recibo lançado${d.amount ? ": " + money(Number(d.amount)) : ""}`, detail: [d.vendor_name, d.description, exec.job ? "job " + exec.job : null].filter(Boolean).join(" · "), links: [FIN], memory: `Scanned receipt ${d.amount ? money(Number(d.amount)) : ""}` };
  },
};

/* ───────────────────────── the week at a glance ───────────────────────── */

export const weekGlance: ActionDef = {
  name: "dashboard.week",
  description: "How the business is doing this week: new leads, open quotes, jobs this week, invoiced, received and what customers owe.",
  args: {},
  examples: ["Como está a semana?", "Resumo da semana", "How's this week going?"],
  permissions: ["invoices.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const monday = addDays(ctx.today, -((new Date(ctx.today + "T12:00:00Z").getUTCDay() + 6) % 7));
    const wk = dayRange(monday, addDays(monday, 6), ctx.timezone);
    const [leads, quotes, jobs, issued, received, open] = await Promise.all([
      ctx.tx.lead.count({ where: { createdAt: { gte: wk.start, lt: wk.end } } }),
      ctx.tx.quote.findMany({ where: { status: { in: ["draft", "sent", "changes_requested"] } }, select: { total: true } }),
      ctx.tx.workOrder.count({ where: { status: { not: "canceled" }, scheduledStart: { gte: wk.start, lt: wk.end } } }),
      ctx.tx.quoteInvoice.aggregate({ where: { status: { not: "void" }, issuedAt: { gte: wk.start, lt: wk.end } }, _sum: { amount: true } }),
      ctx.tx.invoiceReceipt.aggregate({ where: { paidAt: { gte: wk.start, lt: wk.end } }, _sum: { amount: true } }),
      ctx.tx.quoteInvoice.findMany({ where: { status: { in: ["sent", "partially_paid"] } }, select: { amount: true, status: true, dueDate: true, receipts: { select: { amount: true } } }, take: 2000 }),
    ]);
    const owed = round2(open.reduce((s, i) => s + computeInvoiceMoney(i).balance, 0));
    return {
      kind: "answer",
      args,
      card: {
        title: `Semana de ${fmtDate(monday)}`,
        sections: [
          { type: "totals", rows: [{ label: "Leads novos", value: String(leads) }, { label: "Quotes em aberto", value: `${quotes.length} · ${money(quotes.reduce((s, q) => s + Number(q.total), 0))}` }, { label: "Jobs na agenda", value: String(jobs) }, { label: "Faturado na semana", value: money(Number(issued._sum.amount || 0)) }, { label: "Recebido na semana", value: money(Number(received._sum.amount || 0)) }, { label: "Clientes devem", value: money(owed), strong: true }] },
        ],
        open: { label: "Abrir Início", href: "dashboard.html" },
      },
    };
  },
};

/* ───────────────────────── month vs month ───────────────────────── */

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const compareMonths: ActionDef = {
  name: "dashboard.compare",
  description: "Compare two months: invoiced, received, quotes approved (count and value) and average ticket. Defaults to this month vs last month.",
  args: { month: "YYYY-MM (default this month)", vs: "YYYY-MM (default the month before)" },
  examples: ["Compara outubro com setembro", "Como foi este mês comparado ao passado?", "Compare this month with last month"],
  permissions: ["invoices.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const a = /^\d{4}-\d{2}$/.test(str(args.month)) ? str(args.month) : ctx.today.slice(0, 7);
    const prev = (() => { const [y, m] = a.split("-").map(Number) as [number, number]; const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); })();
    const b = /^\d{4}-\d{2}$/.test(str(args.vs)) ? str(args.vs) : prev;
    const stats = async (ym: string) => {
      const { from, to } = monthBounds(ym);
      const r = dayRange(from, to, ctx.timezone);
      const [inv, rec, approved] = await Promise.all([
        ctx.tx.quoteInvoice.aggregate({ where: { status: { not: "void" }, issuedAt: { gte: r.start, lt: r.end } }, _sum: { amount: true } }),
        ctx.tx.invoiceReceipt.aggregate({ where: { paidAt: { gte: r.start, lt: r.end } }, _sum: { amount: true } }),
        ctx.tx.quote.findMany({ where: { status: { in: ["approved", "converted"] }, OR: [{ signedAt: { gte: r.start, lt: r.end } }, { signedAt: null, updatedAt: { gte: r.start, lt: r.end } }] }, select: { total: true } }),
      ]);
      const sold = approved.reduce((s, q) => s + Number(q.total), 0);
      return { invoiced: Number(inv._sum.amount || 0), received: Number(rec._sum.amount || 0), count: approved.length, sold, ticket: approved.length ? sold / approved.length : 0 };
    };
    const [x, y] = await Promise.all([stats(a), stats(b)]);
    const name = (ym: string) => MONTHS_PT[Number(ym.slice(5)) - 1] + (ym.slice(0, 4) !== ctx.today.slice(0, 4) ? " " + ym.slice(0, 4) : "");
    const delta = (p: number, q: number) => (q > 0 ? `${p >= q ? "+" : ""}${Math.round(((p - q) / q) * 100)}%` : p > 0 ? "novo" : "—");
    return {
      kind: "answer",
      args: { ...args, month: a, vs: b },
      card: {
        title: `${name(a)} × ${name(b)}`,
        sections: [
          {
            type: "table",
            columns: ["", name(a), name(b), "Variação"],
            align: ["left", "right", "right", "right"],
            rows: [
              ["Faturado", money(x.invoiced), money(y.invoiced), delta(x.invoiced, y.invoiced)],
              ["Recebido", money(x.received), money(y.received), delta(x.received, y.received)],
              ["Quotes aprovados", `${x.count} · ${money(x.sold)}`, `${y.count} · ${money(y.sold)}`, delta(x.sold, y.sold)],
              ["Ticket médio", money(x.ticket), money(y.ticket), delta(x.ticket, y.ticket)],
            ],
          },
        ],
        open: { label: "Abrir Relatórios", href: "relatorios.html" },
      },
    };
  },
};

export const FINANCE_ACTIONS: ActionDef[] = [cashflow, receivables, addCost, scanReceipt, weekGlance, compareMonths];
