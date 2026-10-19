/**
 * Finding records from what the user said, tolerant to voice transcription. Every resolver
 * returns either the record, a "which one?" question whose options patch the action args
 * with the chosen id, or a plain message when nothing matches.
 */
import { computeInvoiceMoney } from "../../invoices/core.js";
import { jobBilling } from "../../invoices/job.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";
import { jobNumberFromQuery, nameSimilarity, pickBest, searchPrefixes, type RankedMatch } from "../match.js";
import type { ActionContext, Clarify } from "./types.js";
import { money, str, uuidOrNull } from "./types.js";

export type Resolved<T> =
  | { status: "ok"; row: T }
  | { status: "clarify"; clarify: Clarify }
  | { status: "missing"; message: string };

function fmtDay(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "short" }).format(date);
}

function pick<T>(
  ranked: RankedMatch<T>[],
  query: string,
  idPath: string,
  noun: string,
  option: (row: T) => { label: string; detail?: string; id: string },
  searchPath: string,
): Resolved<T> {
  const result = pickBest(ranked, { min: 50, margin: 10 });
  if (result.status === "matched") return { status: "ok", row: result.item };
  const candidates = result.candidates;
  if (!candidates.length) {
    return {
      status: "clarify",
      clarify: {
        question: query ? `Não encontrei ${noun} “${query}”. Quer buscar de outro jeito?` : `Qual ${noun}?`,
        options: [],
        search: { placeholder: `Buscar ${noun}`, path: searchPath, clear: [idPath] },
      },
    };
  }
  return {
    status: "clarify",
    clarify: {
      question:
        result.status === "ambiguous"
          ? `Encontrei mais de um ${noun} para “${query}”. Qual deles?`
          : `Não achei exatamente “${query}”. É algum destes?`,
      options: candidates.map(({ item }) => {
        const o = option(item);
        return { label: o.label, detail: o.detail, patch: { [idPath]: o.id } };
      }),
      search: { placeholder: `Buscar outro ${noun}`, path: searchPath, clear: [idPath] },
    },
  };
}

/* ───────────────────────── customers ───────────────────────── */

export type CustomerRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  customerType: string;
};

const customerSelect = { id: true, name: true, company: true, email: true, phone: true, customerType: true } as const;

export async function customerFromScreen(ctx: ActionContext): Promise<CustomerRow | null> {
  const s = ctx.screen;
  if (!s) return null;
  let id: string | null = null;
  if (s.type === "customer") id = s.id;
  else if (s.type === "job") id = (await ctx.tx.workOrder.findFirst({ where: { id: s.id }, select: { customerId: true } }))?.customerId ?? null;
  else if (s.type === "quote") id = (await ctx.tx.quote.findFirst({ where: { id: s.id }, select: { customerId: true } }))?.customerId ?? null;
  else if (s.type === "invoice") id = (await ctx.tx.quoteInvoice.findFirst({ where: { id: s.id }, select: { customerId: true } }))?.customerId ?? null;
  if (!id) return null;
  return ctx.tx.customer.findFirst({ where: { id }, select: customerSelect });
}

export async function resolveCustomer(
  ctx: ActionContext,
  args: Record<string, unknown>,
  keys = { id: "customer_id", query: "customer" },
): Promise<Resolved<CustomerRow>> {
  const id = uuidOrNull(args[keys.id]);
  if (id) {
    const row = await ctx.tx.customer.findFirst({ where: { id }, select: customerSelect });
    if (row) return { status: "ok", row };
  }
  const query = str(args[keys.query], 200);
  if (!query) {
    const fromScreen = await customerFromScreen(ctx);
    if (fromScreen) return { status: "ok", row: fromScreen };
    return {
      status: "clarify",
      clarify: { question: "Para qual cliente?", options: [], search: { placeholder: "Nome do cliente", path: keys.query, clear: [keys.id] } },
    };
  }
  const prefixes = searchPrefixes(query);
  const rows = await ctx.tx.customer.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { company: { contains: query, mode: "insensitive" } },
        ...prefixes.flatMap((p) => [
          { name: { contains: p, mode: "insensitive" as const } },
          { company: { contains: p, mode: "insensitive" as const } },
        ]),
      ],
    },
    select: customerSelect,
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  return pick(
    rows.map((item) => ({ item, score: nameSimilarity(query, [item.name, item.company]) })),
    query,
    keys.id,
    "cliente",
    (c) => ({ id: c.id, label: c.name, detail: [c.company, c.phone || c.email].filter(Boolean).join(" · ") }),
    keys.query,
  );
}

/* ───────────────────────── leads ───────────────────────── */

export type LeadRow = { id: string; name: string; phone: string | null; email: string | null; status: string };

export async function resolveLead(ctx: ActionContext, args: Record<string, unknown>): Promise<Resolved<LeadRow>> {
  const select = { id: true, name: true, phone: true, email: true, status: true } as const;
  const id = uuidOrNull(args.lead_id);
  if (id) {
    const row = await ctx.tx.lead.findFirst({ where: { id }, select });
    if (row) return { status: "ok", row };
  }
  const query = str(args.lead, 200);
  if (!query) {
    if (ctx.screen?.type === "lead") {
      const row = await ctx.tx.lead.findFirst({ where: { id: ctx.screen.id }, select });
      if (row) return { status: "ok", row };
    }
    return { status: "clarify", clarify: { question: "Qual lead?", options: [], search: { placeholder: "Nome do lead", path: "lead", clear: ["lead_id"] } } };
  }
  const digits = query.replace(/\D/g, "");
  const prefixes = searchPrefixes(query);
  const rows = await ctx.tx.lead.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        ...prefixes.map((p) => ({ name: { contains: p, mode: "insensitive" as const } })),
        ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-4) } }] : []),
      ],
    },
    select,
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  return pick(
    rows.map((item) => ({
      item,
      score: Math.max(nameSimilarity(query, [item.name]), digits.length >= 7 && item.phone?.replace(/\D/g, "").endsWith(digits.slice(-7)) ? 100 : 0),
    })),
    query,
    "lead_id",
    "lead",
    (l) => ({ id: l.id, label: l.name, detail: [l.phone, l.status].filter(Boolean).join(" · ") }),
    "lead",
  );
}

/* ───────────────────────── jobs ───────────────────────── */

export const jobSelect = {
  id: true,
  number: true,
  title: true,
  address: true,
  status: true,
  notes: true,
  campoAttention: true,
  scheduledStart: true,
  scheduledEnd: true,
  allDay: true,
  crewId: true,
  assignedUserId: true,
  customerId: true,
  builderId: true,
  sourceName: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, company: true } },
  builder: { select: { firstName: true, lastName: true, company: true } },
  crew: { select: { id: true, name: true } },
  lineItems: { select: { lineTotal: true } },
  invoices: { select: { amount: true, status: true, receipts: { select: { amount: true } } } },
} as const;

export type JobRow = Awaited<ReturnType<ActionContext["tx"]["workOrder"]["findFirst"]>> & Record<string, unknown>;

export function jobLabel(job: { number: number | null; title: string }): string {
  return (job.number != null ? "#" + job.number + " · " : "") + job.title;
}

export function jobCustomerName(job: {
  customer?: { name: string; company: string | null } | null;
  builder?: { firstName: string; lastName: string; company: string | null } | null;
  sourceName?: string | null;
}): string {
  if (job.customer) return job.customer.name;
  if (job.builder) return job.builder.company || [job.builder.firstName, job.builder.lastName].filter(Boolean).join(" ");
  return job.sourceName || "";
}

export function jobServicesTotal(job: { lineItems: Array<{ lineTotal: unknown }> }): number {
  return job.lineItems.reduce((s, li) => s + Number(li.lineTotal || 0), 0);
}

export async function resolveJob(ctx: ActionContext, args: Record<string, unknown>) {
  type Row = NonNullable<Awaited<ReturnType<typeof loadJob>>>;
  const loadJob = (id: string) => ctx.tx.workOrder.findFirst({ where: { id }, select: jobSelect });
  const id = uuidOrNull(args.job_id);
  if (id) {
    const row = await loadJob(id);
    if (row) return { status: "ok", row } as Resolved<Row>;
  }
  const query = str(args.job, 200);
  const customerQuery = str(args.customer, 200);
  if (!query && !customerQuery) {
    if (ctx.screen?.type === "job") {
      const row = await loadJob(ctx.screen.id);
      if (row) return { status: "ok", row } as Resolved<Row>;
    }
    if (ctx.screen?.type === "quote") {
      const q = await ctx.tx.quote.findFirst({ where: { id: ctx.screen.id }, select: { workOrderId: true } });
      if (q?.workOrderId) {
        const row = await loadJob(q.workOrderId);
        if (row) return { status: "ok", row } as Resolved<Row>;
      }
    }
    return { status: "clarify", clarify: { question: "Qual job?", options: [], search: { placeholder: "Número do job, cliente ou endereço", path: "job", clear: ["job_id"] } } } as Resolved<Row>;
  }
  const number = jobNumberFromQuery(query);
  if (number != null) {
    const row = await ctx.tx.workOrder.findFirst({ where: { number }, select: jobSelect });
    if (row) return { status: "ok", row } as Resolved<Row>;
  }
  const rows = await ctx.tx.workOrder.findMany({ select: jobSelect, orderBy: { updatedAt: "desc" }, take: 400 });
  const ranked = rows.map((item) => {
    const who = [item.customer?.name, item.customer?.company, jobCustomerName(item)].filter(Boolean) as string[];
    const t = query ? nameSimilarity(query, [item.title, item.address, ...who]) : 0;
    const c = customerQuery ? nameSimilarity(customerQuery, who) : 0;
    let score = Math.max(t, c);
    if (t && c) score = Math.min(99, Math.round((t + c) / 2) + 8);
    if (item.status === "canceled") score = Math.round(score * 0.5);
    return { item, score };
  });
  return pick(
    ranked,
    query || customerQuery,
    "job_id",
    "job",
    (j) => ({
      id: j.id,
      label: jobLabel(j),
      detail: [jobCustomerName(j), j.address, j.scheduledStart ? fmtDay(j.scheduledStart, ctx.timezone) : null].filter(Boolean).join(" · "),
    }),
    "job",
  );
}

export function jobMoney(job: { lineItems: Array<{ lineTotal: unknown }>; invoices: Array<{ amount: unknown; status: string; receipts?: Array<{ amount: unknown }> }> }) {
  return jobBilling(jobServicesTotal(job), job.invoices);
}

/* ───────────────────────── quotes ───────────────────────── */

const quoteSelect = {
  id: true,
  number: true,
  quoteNumber: true,
  title: true,
  status: true,
  total: true,
  customerId: true,
  builderId: true,
  workOrderId: true,
  updatedAt: true,
  createdAt: true,
  payload: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  builder: { select: { email: true, company: true, firstName: true, lastName: true, phone: true } },
} as const;

export function quoteLabel(q: { quoteNumber: string | null; number: number; title: string }): string {
  return (q.quoteNumber || "#" + q.number) + " · " + q.title;
}

const QUOTE_STATUS_PT: Record<string, string> = {
  draft: "rascunho",
  sent: "enviado",
  changes_requested: "alteração pedida",
  approved: "aprovado",
  converted: "convertido",
  archived: "arquivado",
  expired: "expirado",
};

export function quoteStatusPt(status: string): string {
  return QUOTE_STATUS_PT[normalizeQuoteStatus(status)] || status;
}

function quoteNumberFromQuery(query: string): { n: number | null; text: string | null } {
  const text = query.match(/\b([A-Za-z]{1,4}-?\d{2,7})\b/)?.[1] || null;
  const m = query.match(/(?:#|\b(?:quote|or[cç]amento|q|estimate|n[uú]mero)\s*#?\s*)(\d{1,7})\b/i) || query.trim().match(/^#?(\d{1,7})$/);
  return { n: m ? Number(m[1]) : null, text };
}

export async function resolveQuote(
  ctx: ActionContext,
  args: Record<string, unknown>,
  filter: { openOnly?: boolean; approvedOnly?: boolean } = {},
) {
  type Row = NonNullable<Awaited<ReturnType<typeof load>>>;
  const load = (id: string) => ctx.tx.quote.findFirst({ where: { id }, select: quoteSelect });
  const id = uuidOrNull(args.quote_id);
  if (id) {
    const row = await load(id);
    if (row) return { status: "ok", row } as Resolved<Row>;
  }
  const query = str(args.quote, 200);
  if (query) {
    const { n, text } = quoteNumberFromQuery(query);
    const row = await ctx.tx.quote.findFirst({
      where: { OR: [...(n != null ? [{ number: n }] : []), ...(text ? [{ quoteNumber: { equals: text, mode: "insensitive" as const } }] : [])] },
      select: quoteSelect,
    });
    if (row) return { status: "ok", row } as Resolved<Row>;
  }
  if (!query && !str(args.customer) && ctx.screen?.type === "quote") {
    const row = await load(ctx.screen.id);
    if (row) return { status: "ok", row } as Resolved<Row>;
  }
  // By customer: their latest quotes.
  const cust = await resolveCustomer(ctx, { customer_id: args.customer_id, customer: args.customer || (query && !/\d/.test(query) ? query : "") });
  if (cust.status !== "ok") {
    if (cust.status === "clarify") return cust as Resolved<Row>;
    return { status: "missing", message: "Qual Quote? Diga o número ou o cliente." } as Resolved<Row>;
  }
  let rows = await ctx.tx.quote.findMany({
    where: { customerId: cust.row.id },
    select: quoteSelect,
    orderBy: { updatedAt: "desc" },
    take: 12,
  });
  rows = rows.filter((q) => {
    const s = normalizeQuoteStatus(q.status);
    if (filter.approvedOnly) return s === "approved" || s === "converted";
    if (filter.openOnly) return s === "draft" || s === "sent" || s === "changes_requested";
    return s !== "archived";
  });
  if (rows.length === 1) return { status: "ok", row: rows[0]! } as Resolved<Row>;
  if (!rows.length) {
    return {
      status: "missing",
      message: `${cust.row.name} não tem Quote ${filter.approvedOnly ? "aprovado" : filter.openOnly ? "em aberto" : ""}`.trim() + ".",
    } as Resolved<Row>;
  }
  return {
    status: "clarify",
    clarify: {
      question: `${cust.row.name} tem ${rows.length} Quotes. Qual deles?`,
      options: rows.slice(0, 6).map((q) => ({
        label: quoteLabel(q),
        detail: [quoteStatusPt(q.status), money(Number(q.total)), fmtDay(q.updatedAt, ctx.timezone)].join(" · "),
        patch: { quote_id: q.id },
      })),
    },
  } as Resolved<Row>;
}

/* ───────────────────────── invoices ───────────────────────── */

const invoiceSelect = {
  id: true,
  invoiceNumber: true,
  status: true,
  amount: true,
  dueDate: true,
  viewedAt: true,
  sentTo: true,
  customerId: true,
  quoteId: true,
  workOrderId: true,
  createdAt: true,
  receipts: { select: { amount: true } },
  customer: { select: { id: true, name: true, email: true } },
} as const;

export async function resolveInvoice(ctx: ActionContext, args: Record<string, unknown>, filter: { openOnly?: boolean } = {}) {
  type Row = NonNullable<Awaited<ReturnType<typeof load>>>;
  const load = (id: string) => ctx.tx.quoteInvoice.findFirst({ where: { id }, select: invoiceSelect });
  const id = uuidOrNull(args.invoice_id);
  if (id) {
    const row = await load(id);
    if (row) return { status: "ok", row } as Resolved<Row>;
  }
  const query = str(args.invoice, 200);
  if (query) {
    const m = query.match(/([A-Za-z]{2,5}-?\d{1,7})/);
    const n = query.match(/(\d{1,7})/)?.[1];
    const rows = await ctx.tx.quoteInvoice.findMany({
      where: {
        OR: [
          ...(m ? [{ invoiceNumber: { equals: m[1]!, mode: "insensitive" as const } }] : []),
          ...(n ? [{ invoiceNumber: { endsWith: n.padStart(4, "0") } }, { invoiceNumber: { endsWith: "-" + n } }] : []),
        ],
      },
      select: invoiceSelect,
      take: 5,
    });
    if (rows.length === 1) return { status: "ok", row: rows[0]! } as Resolved<Row>;
  }
  if (!query && !str(args.customer) && ctx.screen?.type === "invoice") {
    const row = await load(ctx.screen.id);
    if (row) return { status: "ok", row } as Resolved<Row>;
  }
  const cust = await resolveCustomer(ctx, { customer_id: args.customer_id, customer: args.customer });
  if (cust.status !== "ok") {
    if (cust.status === "clarify") return cust as Resolved<Row>;
    return { status: "missing", message: "Qual invoice? Diga o número ou o cliente." } as Resolved<Row>;
  }
  let rows = await ctx.tx.quoteInvoice.findMany({
    where: { customerId: cust.row.id, status: { not: "void" } },
    select: invoiceSelect,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (filter.openOnly) rows = rows.filter((r) => computeInvoiceMoney(r).balance > 0);
  if (rows.length === 1) return { status: "ok", row: rows[0]! } as Resolved<Row>;
  if (!rows.length) {
    return { status: "missing", message: `${cust.row.name} não tem invoice${filter.openOnly ? " em aberto" : ""}.` } as Resolved<Row>;
  }
  return {
    status: "clarify",
    clarify: {
      question: `${cust.row.name} tem ${rows.length} invoices${filter.openOnly ? " em aberto" : ""}. Qual delas?`,
      options: rows.slice(0, 6).map((r) => {
        const m2 = computeInvoiceMoney(r);
        return {
          label: (r.invoiceNumber || "Invoice") + " · " + money(m2.amount),
          detail: [m2.balance > 0 ? "saldo " + money(m2.balance) : "paga", r.dueDate ? "vence " + fmtDay(r.dueDate, ctx.timezone) : ""].filter(Boolean).join(" · "),
          patch: { invoice_id: r.id },
        };
      }),
    },
  } as Resolved<Row>;
}

/* ───────────────────────── crews, people, stages ───────────────────────── */

export async function resolveCrew(ctx: ActionContext, args: Record<string, unknown>) {
  const id = uuidOrNull(args.crew_id);
  if (id) {
    const row = await ctx.tx.crew.findFirst({ where: { id }, select: { id: true, name: true } });
    if (row) return { status: "ok", row: { kind: "crew" as const, id: row.id, name: row.name } } as const;
  }
  const uid = uuidOrNull(args.user_id);
  if (uid) {
    const row = await ctx.tx.user.findFirst({ where: { id: uid }, select: { id: true, name: true } });
    if (row) return { status: "ok", row: { kind: "user" as const, id: row.id, name: row.name } } as const;
  }
  const query = str(args.crew, 120);
  if (!query) return { status: "none" } as const;
  const crews = await ctx.tx.crew.findMany({ where: { active: true }, select: { id: true, name: true } });
  const users = await ctx.tx.user.findMany({ where: { status: "active" }, select: { id: true, name: true } });
  const cleaned = query.replace(/\b(equipe|crew|time|team|do|da|de|of|the)\b/gi, " ").trim() || query;
  type Who = { kind: "crew" | "user"; id: string; name: string };
  const ranked: Array<{ item: Who; score: number }> = [
    ...crews.map((c) => ({ item: { kind: "crew" as const, id: c.id, name: c.name }, score: nameSimilarity(cleaned, [c.name]) })),
    ...users.map((u) => ({ item: { kind: "user" as const, id: u.id, name: u.name }, score: nameSimilarity(cleaned, [u.name]) })),
  ];
  const result = pickBest(ranked, { min: 55, margin: 10 });
  if (result.status === "matched") return { status: "ok", row: result.item } as const;
  return {
    status: "clarify",
    clarify: {
      question: result.candidates.length ? `Qual equipe ou pessoa é “${query}”?` : `Não encontrei a equipe “${query}”.`,
      options: [
        ...result.candidates.map(({ item }) => ({
          label: item.name,
          detail: item.kind === "crew" ? "equipe" : "pessoa",
          patch: item.kind === "crew" ? { crew_id: item.id, crew: item.name } : { user_id: item.id, crew: item.name },
        })),
        { label: "Sem equipe", patch: { crew: "", crew_id: null } },
      ],
    } satisfies Clarify,
  } as const;
}

export async function resolveStage(ctx: ActionContext, wanted: string) {
  const stages = await ctx.tx.pipelineStage.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true, order: true }, orderBy: { order: "asc" } });
  const q = wanted.trim();
  if (!q) return { stage: null, stages };
  const bySlug = stages.find((s) => s.slug && s.slug.toLowerCase() === q.toLowerCase());
  if (bySlug) return { stage: bySlug, stages };
  // Keys are fragments of the default stage slugs (new, contacted, assessment_scheduled, quote_sent,
  // follow_up_1, stand_by, won, lost); custom stages still match by name.
  const SYN: Record<string, string[]> = {
    lost: ["perdido", "perdida", "lost", "perder", "perdemos", "descart"],
    won: ["ganho", "ganhou", "ganhamos", "fechado", "fechou", "won", "vendido"],
    assessment: ["visita", "visit", "medicao", "medição", "avaliacao", "avaliação", "assessment", "agendad"],
    quote_sent: ["quote enviado", "orcamento enviado", "orçamento enviado", "proposta enviada", "quote sent"],
    follow_up: ["follow", "acompanhamento", "retorno", "cobrar resposta"],
    stand_by: ["stand by", "standby", "espera", "pausado", "parado"],
    contacted: ["contatado", "contactado", "contato feito", "contacted", "falei com"],
    new: ["novo", "new", "entrada"],
  };
  let best: { s: (typeof stages)[number]; score: number } | null = null;
  for (const s of stages) {
    let score = nameSimilarity(q, [s.name, s.slug]);
    for (const [key, words] of Object.entries(SYN)) {
      const fq = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if ((s.slug || "").includes(key) && words.some((w) => fq.includes(w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) score = Math.max(score, 85);
    }
    if (!best || score > best.score) best = { s, score };
  }
  return { stage: best && best.score >= 55 ? best.s : null, stages };
}
