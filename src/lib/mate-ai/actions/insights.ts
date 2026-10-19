/**
 * Read-only questions: agenda, money, balances and follow-up lists. Each answer is a card;
 * list rows can carry a follow-up action ("Faturar", "Lembrar") the user taps.
 */
import { computeInvoiceMoney } from "../../invoices/core.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";
import { jobCustomerName, jobLabel, jobMoney, jobSelect, quoteLabel, resolveCrew, resolveCustomer } from "./resolve.js";
import { addDays, dayRange, fmtDate, isIsoDay, localDay, localTime } from "./time.js";
import type { ActionContext, ActionDef, ListItem } from "./types.js";
import { money, num, str } from "./types.js";

/* ───────────────────────── periods ───────────────────────── */

export type Period = { from: string; to: string; label: string };

export function periodFor(key: string, today: string, from?: unknown, to?: unknown): Period {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0, 12)).toISOString().slice(0, 10);
  switch (key) {
    case "today":
      return { from: today, to: today, label: "hoje" };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1), label: "ontem" };
    case "this_week":
      return { from: monday, to: today, label: "esta semana" };
    case "last_week":
      return { from: addDays(monday, -7), to: addDays(monday, -1), label: "semana passada" };
    case "last_month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${String(pm).padStart(2, "0")}-01`, to: lastOfMonth(py, pm), label: "mês passado" };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: today, label: String(y) };
    case "last_year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
    case "custom":
      if (isIsoDay(from) && isIsoDay(to) && String(from) <= String(to)) {
        return { from: String(from), to: String(to), label: fmtDate(String(from)) + " – " + fmtDate(String(to)) };
      }
      return { from: monthStart, to: today, label: "este mês" };
    case "this_month":
    default:
      return { from: monthStart, to: today, label: "este mês" };
  }
}

/** Same number of days right before the period (for "compared with"). */
function previousPeriod(p: Period): Period {
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5) + 1;
  return { from: addDays(p.from, -days), to: addDays(p.from, -1), label: "período anterior" };
}

async function moneyIn(ctx: ActionContext, p: Period) {
  const { start, end } = dayRange(p.from, p.to, ctx.timezone);
  const [invoices, receipts] = await Promise.all([
    ctx.tx.quoteInvoice.findMany({
      where: { status: { notIn: ["void", "draft"] }, OR: [{ issuedAt: { gte: start, lt: end } }, { issuedAt: null, createdAt: { gte: start, lt: end } }] },
      select: { amount: true },
    }),
    ctx.tx.invoiceReceipt.findMany({ where: { paidAt: { gte: start, lt: end }, invoice: { status: { not: "void" } } }, select: { amount: true } }),
  ]);
  return {
    invoiced: invoices.reduce((s, r) => s + Number(r.amount), 0),
    invoiceCount: invoices.length,
    received: receipts.reduce((s, r) => s + Number(r.amount), 0),
    receiptCount: receipts.length,
  };
}

function delta(now: number, before: number): string {
  if (before <= 0) return now > 0 ? "novo" : "—";
  const pct = Math.round(((now - before) / before) * 100);
  return (pct > 0 ? "+" : "") + pct + "%";
}

/* ───────────────────────── money summary ───────────────────────── */

export const moneySummary: ActionDef = {
  name: "money.summary",
  description: "Answer how much was invoiced (faturado) and received (recebido) in a period, compared with the previous period, plus what is still open.",
  args: { period: "today | yesterday | this_week | last_week | this_month | last_month | this_year | last_year | custom", from: "YYYY-MM-DD for custom", to: "YYYY-MM-DD for custom" },
  examples: ["Quanto faturei este mês?", "Quanto recebi semana passada?", "Revenue last month vs September"],
  permissions: ["invoices.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const p = periodFor(str(args.period) || "this_month", ctx.today, args.from, args.to);
    const prev = previousPeriod(p);
    const [now, before, open] = await Promise.all([
      moneyIn(ctx, p),
      moneyIn(ctx, prev),
      ctx.tx.quoteInvoice.findMany({ where: { status: { in: ["sent", "partially_paid"] } }, select: { status: true, amount: true, dueDate: true, receipts: { select: { amount: true } } } }),
    ]);
    let openTotal = 0;
    let overdueTotal = 0;
    for (const inv of open) {
      const m = computeInvoiceMoney(inv);
      openTotal += m.balance;
      if (m.isOverdue) overdueTotal += m.balance;
    }
    return {
      kind: "answer",
      args: { ...args, period: str(args.period) || "this_month" },
      card: {
        title: "Dinheiro · " + p.label,
        subtitle: fmtDate(p.from) + (p.from !== p.to ? " – " + fmtDate(p.to) : ""),
        sections: [
          {
            type: "table",
            columns: ["", p.label, "Antes", "Variação"],
            align: ["left", "right", "right", "right"],
            rows: [
              ["Faturado (" + now.invoiceCount + " invoices)", money(now.invoiced), money(before.invoiced), delta(now.invoiced, before.invoiced)],
              ["Recebido (" + now.receiptCount + " pagamentos)", money(now.received), money(before.received), delta(now.received, before.received)],
            ],
          },
          {
            type: "totals",
            rows: [
              { label: "Em aberto hoje", value: money(openTotal) },
              { label: "Vencido", value: money(overdueTotal), strong: overdueTotal > 0 },
            ],
          },
          { type: "note", text: "“Antes” = os mesmos " + (Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5) + 1) + " dias imediatamente anteriores." },
        ],
        links: [{ label: "Abrir Invoices", href: "invoices.html" }, { label: "Relatórios", href: "relatorios.html" }],
      },
    };
  },
};

/* ───────────────────────── customer balance ───────────────────────── */

export const customerBalance: ActionDef = {
  name: "customer.balance",
  description: "How much a customer owes: open invoices and balances.",
  args: { customer: "customer name" },
  examples: ["Quanto o Mike Torres me deve?", "What does Pereira Homes owe?"],
  permissions: ["invoices.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const c = await resolveCustomer(ctx, args);
    if (c.status === "clarify") return { kind: "clarify", clarify: c.clarify, args };
    if (c.status === "missing") return { kind: "error", message: c.message, args };
    const rows = await ctx.tx.quoteInvoice.findMany({
      where: { customerId: c.row.id, status: { notIn: ["void", "draft"] } },
      select: { id: true, invoiceNumber: true, status: true, amount: true, dueDate: true, receipts: { select: { amount: true } } },
      orderBy: { dueDate: "asc" },
    });
    const items: ListItem[] = [];
    let total = 0;
    for (const r of rows) {
      const m = computeInvoiceMoney(r);
      if (m.balance <= 0) continue;
      total += m.balance;
      items.push({
        title: (r.invoiceNumber || "Invoice") + " · " + money(m.balance),
        detail: m.isOverdue ? `vencida há ${m.daysOverdue} dia(s)` : r.dueDate ? "vence " + fmtDate(localDay(new Date(r.dueDate), ctx.timezone)) : "sem vencimento",
        tone: m.isOverdue ? "critical" : "neutral",
        href: "invoice.html?id=" + encodeURIComponent(r.id),
        run: { label: "Registrar pagamento", action: "payment.record", args: { invoice_id: r.id } },
      });
    }
    return {
      kind: "answer",
      args: { ...args, customer_id: c.row.id },
      card: {
        title: c.row.name + (total > 0 ? " deve " + money(total) : " não deve nada"),
        sections: [{ type: "list", items, empty: "Nenhuma invoice em aberto." }],
        links: [{ label: "Abrir cliente", href: "customers.html?id=" + encodeURIComponent(c.row.id) }],
      },
    };
  },
};

/* ───────────────────────── agenda ───────────────────────── */

export const agendaList: ActionDef = {
  name: "agenda.list",
  description: "What is scheduled on a day or range (jobs and lead visits), optionally for one crew/person. Also 'who is free'.",
  args: { date: "YYYY-MM-DD (default today)", to: "YYYY-MM-DD end of range, optional", crew: "crew/person name, optional" },
  examples: ["O que tem amanhã?", "Agenda da equipe do Carlos na quinta", "What's on this week?"],
  permissions: ["work_orders.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const from = isIsoDay(args.date) ? String(args.date) : ctx.today;
    const to = isIsoDay(args.to) && String(args.to) >= from ? String(args.to) : from;
    if (Date.parse(to) - Date.parse(from) > 31 * 864e5) return { kind: "error", message: "Peça no máximo um mês de agenda.", args };
    const crew = await resolveCrew(ctx, args);
    if (crew.status === "clarify") return { kind: "clarify", clarify: crew.clarify, args };
    const crewFilter = crew.status === "ok" ? (crew.row.kind === "crew" ? { crewId: crew.row.id } : { assignedUserId: crew.row.id }) : {};
    const { start, end } = dayRange(from, to, ctx.timezone);
    const [jobs, visits] = await Promise.all([
      ctx.tx.workOrder.findMany({
        where: { status: { not: "canceled" }, scheduledStart: { gte: start, lt: end }, ...crewFilter },
        select: jobSelect,
        orderBy: { scheduledStart: "asc" },
        take: 80,
      }),
      crew.status === "ok" && crew.row.kind === "crew"
        ? Promise.resolve([])
        : ctx.tx.meeting.findMany({
            where: { status: { not: "canceled" }, scheduledStart: { gte: start, lt: end }, ...(crew.status === "ok" ? { assignedUserId: crew.row.id } : {}) },
            select: { id: true, title: true, scheduledStart: true, allDay: true, leadId: true },
            orderBy: { scheduledStart: "asc" },
            take: 40,
          }),
    ]);
    type Row = { at: Date; item: ListItem };
    const rows: Row[] = [
      ...jobs.map((j) => ({
        at: j.scheduledStart!,
        item: {
          title: (j.allDay ? "Dia inteiro" : localTime(j.scheduledStart!, ctx.timezone)) + " · " + jobLabel(j),
          detail: [jobCustomerName(j), j.address, j.crew?.name].filter(Boolean).join(" · "),
          meta: from !== to ? fmtDate(localDay(j.scheduledStart!, ctx.timezone)) : undefined,
          href: "job-detail.html?id=" + encodeURIComponent(j.id),
        },
      })),
      ...visits.map((v) => ({
        at: v.scheduledStart,
        item: {
          title: (v.allDay ? "Dia inteiro" : localTime(v.scheduledStart, ctx.timezone)) + " · Visita: " + v.title,
          meta: from !== to ? fmtDate(localDay(v.scheduledStart, ctx.timezone)) : undefined,
          href: v.leadId ? "lead-detail.html?id=" + encodeURIComponent(v.leadId) : "schedule.html",
          tone: "accent" as const,
        },
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    const label = from === to ? (from === ctx.today ? "Hoje" : from === addDays(ctx.today, 1) ? "Amanhã" : fmtDate(from)) : fmtDate(from) + " – " + fmtDate(to);
    return {
      kind: "answer",
      args,
      card: {
        title: "Agenda · " + label + (crew.status === "ok" ? " · " + crew.row.name : ""),
        subtitle: `${jobs.length} job(s)${visits.length ? `, ${visits.length} visita(s)` : ""}`,
        sections: [{ type: "list", items: rows.map((r) => r.item), empty: "Nada agendado." }],
        links: [{ label: "Abrir agenda", href: "schedule.html" }],
      },
    };
  },
};

/* ───────────────────────── follow-up lists ───────────────────────── */

export async function uninvoicedJobs(ctx: ActionContext, limit = 40) {
  const jobs = await ctx.tx.workOrder.findMany({
    where: { status: "completed" },
    select: jobSelect,
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  return jobs
    .map((j) => ({ j, b: jobMoney(j) }))
    .filter(({ b }) => b.remaining_to_invoice > 0.004)
    .slice(0, limit);
}

export const jobsToInvoice: ActionDef = {
  name: "jobs.uninvoiced",
  description: "List completed jobs that still have value to invoice.",
  args: {},
  examples: ["Quais jobs estão concluídos e sem invoice?", "What do I still need to bill?"],
  permissions: ["invoices.view", "work_orders.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const list = await uninvoicedJobs(ctx);
    const total = list.reduce((s, { b }) => s + b.remaining_to_invoice, 0);
    return {
      kind: "answer",
      args,
      card: {
        title: list.length ? `${list.length} job(s) concluído(s) a faturar · ${money(total)}` : "Nenhum job concluído sem invoice",
        sections: [
          {
            type: "list",
            items: list.map(({ j, b }) => ({
              title: jobLabel(j) + " · " + money(b.remaining_to_invoice),
              detail: jobCustomerName(j) || undefined,
              href: "job-detail.html?id=" + encodeURIComponent(j.id),
              run: { label: "Faturar", action: "invoice.job", args: { job_id: j.id, job_query: "", customer_query: "", invoice_type: "auto" } },
            })),
          },
        ],
      },
    };
  },
};

export async function staleQuotes(ctx: ActionContext, days: number, limit = 40) {
  const cutoff = new Date(Date.now() - days * 864e5);
  const rows = await ctx.tx.quote.findMany({
    where: { status: { in: ["sent", "viewed", "created", "changes_requested"] }, updatedAt: { lt: cutoff } },
    select: { id: true, number: true, quoteNumber: true, title: true, status: true, total: true, viewedAt: true, updatedAt: true, payload: true, customer: { select: { name: true, phone: true } } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  return rows.filter((q) => normalizeQuoteStatus(q.status) !== "approved");
}

export const quotesFollowUp: ActionDef = {
  name: "quotes.followup",
  description: "List sent quotes without an answer for N days (default 7), with whether the customer opened them.",
  args: { days: "number of days without answer (default 7)" },
  examples: ["Quais quotes estão sem resposta há mais de 7 dias?", "Quotes waiting on customers"],
  permissions: ["quotes.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const days = Math.min(90, Math.max(1, Math.round(num(args.days) ?? 7)));
    const list = await staleQuotes(ctx, days);
    const total = list.reduce((s, q) => s + Number(q.total), 0);
    return {
      kind: "answer",
      args: { ...args, days },
      card: {
        title: list.length ? `${list.length} Quote(s) sem resposta há ${days}+ dias · ${money(total)}` : `Nenhum Quote parado há ${days}+ dias`,
        sections: [
          {
            type: "list",
            items: list.map((q) => {
              const waited = Math.floor((Date.now() - q.updatedAt.getTime()) / 864e5);
              return {
                title: quoteLabel(q) + " · " + money(Number(q.total)),
                detail: [q.customer?.name, q.viewedAt ? "cliente abriu" : "não abriu", waited + " dias"].filter(Boolean).join(" · "),
                tone: q.viewedAt ? ("accent" as const) : ("neutral" as const),
                href: "quote-builder.html?id=" + encodeURIComponent(q.id),
                run: { label: "Reenviar", action: "quote.send", args: { quote_id: q.id } },
              };
            }),
          },
        ],
      },
    };
  },
};

export async function overdueInvoices(ctx: ActionContext, limit = 40) {
  const rows = await ctx.tx.quoteInvoice.findMany({
    where: { status: { in: ["sent", "partially_paid"] }, dueDate: { lt: new Date() } },
    select: { id: true, invoiceNumber: true, status: true, amount: true, dueDate: true, receipts: { select: { amount: true } }, customer: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
    take: 200,
  });
  return rows.map((r) => ({ r, m: computeInvoiceMoney(r) })).filter(({ m }) => m.isOverdue && m.balance > 0).slice(0, limit);
}

export const invoicesOverdue: ActionDef = {
  name: "invoices.overdue",
  description: "List overdue invoices with their balances.",
  args: {},
  examples: ["Quem está me devendo?", "Invoices vencidas", "Overdue invoices"],
  permissions: ["invoices.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const list = await overdueInvoices(ctx);
    const total = list.reduce((s, { m }) => s + m.balance, 0);
    return {
      kind: "answer",
      args,
      card: {
        title: list.length ? `${list.length} invoice(s) vencida(s) · ${money(total)}` : "Nenhuma invoice vencida",
        sections: [
          {
            type: "list",
            items: list.map(({ r, m }) => ({
              title: (r.invoiceNumber || "Invoice") + " · " + money(m.balance),
              detail: [r.customer?.name, `vencida há ${m.daysOverdue} dia(s)`].filter(Boolean).join(" · "),
              tone: "critical" as const,
              href: "invoice.html?id=" + encodeURIComponent(r.id),
              run: { label: "Reenviar", action: "invoice.send", args: { invoice_id: r.id } },
            })),
          },
        ],
        links: [{ label: "Abrir Invoices", href: "invoices.html" }],
      },
    };
  },
};

export async function approvedWithoutJob(ctx: ActionContext, limit = 20) {
  return ctx.tx.quote.findMany({
    where: { status: { in: ["approved", "accepted", "invoiced"] }, workOrderId: null },
    select: { id: true, number: true, quoteNumber: true, title: true, total: true, customer: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}
