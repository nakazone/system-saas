/**
 * Read-only lookups the model may call while understanding a request ("o quote do Naka da semana
 * passada", "quanto custa a remoção de carpete para builder?"). Each returns a few compact rows
 * scoped to the tenant; the model never sees more than it needs to pick the right record.
 */
import { computeInvoiceMoney } from "../invoices/core.js";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import type { AiTool } from "../ai/client.js";
import { normalizeMateAiUnit, resolveCustomerUnitPrice, type MateAiCatalogItem } from "./command.js";
import { rankCatalogForSpeech } from "./local.js";
import { jobNumberFromQuery, nameSimilarity, searchPrefixes } from "./match.js";
import { jobCustomerName, jobMoney, jobSelect } from "./actions/resolve.js";
import { catalogRefs } from "./interpret.js";

export type LookupCtx = { tx: TenantPrisma; timezone: string; catalog: MateAiCatalogItem[] };

const day = (d: Date | null | undefined, tz: string) =>
  d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d) : null;

const str = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);

function rank<T>(rows: T[], score: (r: T) => number, max = 6): T[] {
  return rows
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.r);
}

function nameWhere(query: string, fields: string[]) {
  const prefixes = searchPrefixes(query);
  return {
    OR: [query, ...prefixes].flatMap((p) => fields.map((f) => ({ [f]: { contains: p, mode: "insensitive" as const } }))),
  };
}

async function findCustomers(ctx: LookupCtx, a: Record<string, unknown>) {
  const q = str(a.query);
  if (!q) return { rows: [] };
  const rows = await ctx.tx.customer.findMany({
    where: nameWhere(q, ["name", "company"]),
    select: { id: true, name: true, company: true, customerType: true, phone: true, email: true, address: true },
    take: 200,
    orderBy: { updatedAt: "desc" },
  });
  return { rows: rank(rows, (c) => nameSimilarity(q, [c.name, c.company])).map((c) => ({ id: c.id, name: c.name, company: c.company, type: c.customerType, phone: c.phone, email: c.email, address: c.address })) };
}

async function findLeads(ctx: LookupCtx, a: Record<string, unknown>) {
  const q = str(a.query);
  if (!q) return { rows: [] };
  const rows = await ctx.tx.lead.findMany({
    where: nameWhere(q, ["name"]),
    select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true },
    take: 200,
    orderBy: { updatedAt: "desc" },
  });
  return { rows: rank(rows, (l) => nameSimilarity(q, [l.name])).map((l) => ({ id: l.id, name: l.name, phone: l.phone, email: l.email, stage: l.status, created: day(l.createdAt, ctx.timezone) })) };
}

async function findJobs(ctx: LookupCtx, a: Record<string, unknown>) {
  const q = str(a.query);
  const n = jobNumberFromQuery(q);
  const rows = await ctx.tx.workOrder.findMany({
    where: n != null ? { number: n } : { status: a.status ? str(a.status, 20) : undefined },
    select: jobSelect,
    orderBy: { updatedAt: "desc" },
    take: n != null ? 1 : 300,
  });
  const picked = n != null || !q ? rows.slice(0, 6) : rank(rows, (j) => nameSimilarity(q, [j.title, j.address, jobCustomerName(j)]));
  return {
    rows: picked.map((j) => {
      const b = jobMoney(j);
      return {
        id: j.id,
        number: j.number,
        title: j.title,
        customer: jobCustomerName(j),
        status: j.status,
        scheduled: day(j.scheduledStart, ctx.timezone),
        address: j.address,
        services_total: b.services_total,
        invoiced: b.invoiced_total,
        to_invoice: b.remaining_to_invoice,
      };
    }),
  };
}

async function findQuotes(ctx: LookupCtx, a: Record<string, unknown>) {
  const q = str(a.query);
  const customer = str(a.customer);
  const n = q.match(/(\d{1,7})/)?.[1];
  const rows = await ctx.tx.quote.findMany({
    where: n ? { OR: [{ number: Number(n) }, { quoteNumber: { contains: n } }] } : customer ? { customer: nameWhere(customer, ["name", "company"]) } : {},
    select: { id: true, number: true, quoteNumber: true, title: true, status: true, total: true, updatedAt: true, customer: { select: { name: true } }, lineItems: { select: { name: true, quantity: true, unit: true, unitPrice: true }, take: 8 } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
  const picked = customer && !n ? rank(rows, (r) => nameSimilarity(customer, [r.customer?.name])) : rows.slice(0, 6);
  return {
    rows: picked.map((r) => ({
      id: r.id,
      number: r.quoteNumber || "#" + r.number,
      title: r.title,
      customer: r.customer?.name ?? null,
      status: r.status,
      total: Number(r.total),
      updated: day(r.updatedAt, ctx.timezone),
      lines: r.lineItems.map((l) => `${l.name} · ${Number(l.quantity)} ${l.unit || ""} × ${Number(l.unitPrice)}`),
    })),
  };
}

async function findInvoices(ctx: LookupCtx, a: Record<string, unknown>) {
  const q = str(a.query);
  const customer = str(a.customer);
  const n = q.match(/(\d{1,7})/)?.[1];
  const rows = await ctx.tx.quoteInvoice.findMany({
    where: {
      status: { not: "void" },
      ...(n ? { invoiceNumber: { contains: n } } : customer ? { customer: nameWhere(customer, ["name", "company"]) } : {}),
    },
    select: { id: true, invoiceNumber: true, status: true, amount: true, dueDate: true, receipts: { select: { amount: true } }, customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const picked = customer && !n ? rank(rows, (r) => nameSimilarity(customer, [r.customer?.name])) : rows.slice(0, 6);
  return {
    rows: picked.map((r) => {
      const m = computeInvoiceMoney(r);
      return { id: r.id, number: r.invoiceNumber, customer: r.customer?.name ?? null, status: m.displayStatus, amount: m.amount, balance: m.balance, due: day(r.dueDate, ctx.timezone) };
    }),
  };
}

async function findPrices(ctx: LookupCtx, a: Record<string, unknown>) {
  const service = str(a.service);
  const type = str(a.customer_type, 20) || "particular";
  const ranked = service ? rankCatalogForSpeech(service, ctx.catalog, null).slice(0, 6).map((r) => r.item) : ctx.catalog.slice(0, 12);
  const refs = new Map(catalogRefs(ctx.catalog).map((r) => [r.item.id + r.item.source, r.ref]));
  return {
    customer_type: type,
    rows: ranked.map((item) => ({
      ref: refs.get(item.id + item.source) || null,
      name: item.name,
      unit: normalizeMateAiUnit(item.unit) || item.unit,
      price: resolveCustomerUnitPrice(item, { customerType: type, pricingMode: "table", customPricingRates: null }) || null,
    })),
  };
}

const RUN: Record<string, (ctx: LookupCtx, a: Record<string, unknown>) => Promise<unknown>> = {
  find_customers: findCustomers,
  find_leads: findLeads,
  find_jobs: findJobs,
  find_quotes: findQuotes,
  find_invoices: findInvoices,
  find_prices: findPrices,
};

export async function runLookup(ctx: LookupCtx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const fn = RUN[name];
  if (!fn) return { error: "unknown tool" };
  try {
    return await fn(ctx, args || {});
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 200) : "lookup failed" };
  }
}

const q = (desc: string) => ({ type: "object", properties: { query: { type: "string", description: desc } }, required: ["query"] });

export const LOOKUP_TOOLS: AiTool[] = [
  { type: "function", function: { name: "find_customers", description: "Search customers by name or company (typo tolerant).", parameters: q("name as said") } },
  { type: "function", function: { name: "find_leads", description: "Search leads by name.", parameters: q("name as said") } },
  {
    type: "function",
    function: {
      name: "find_jobs",
      description: "Search jobs (work orders) by number, title, address or customer; shows status, schedule and what is left to invoice.",
      parameters: { type: "object", properties: { query: { type: "string" }, status: { type: "string", enum: ["draft", "scheduled", "in_progress", "completed", "canceled"] } } },
    },
  },
  {
    type: "function",
    function: {
      name: "find_quotes",
      description: "Search quotes by number or customer; shows status, total and lines.",
      parameters: { type: "object", properties: { query: { type: "string", description: "quote number" }, customer: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "find_invoices",
      description: "Search invoices by number or customer; shows amount, balance, status and due date.",
      parameters: { type: "object", properties: { query: { type: "string", description: "invoice number" }, customer: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "find_prices",
      description: "Price-table prices for a service (per unit) for a customer type. Use before answering price questions.",
      parameters: {
        type: "object",
        properties: { service: { type: "string" }, customer_type: { type: "string", enum: ["particular", "builder", "contractor", "loja"] } },
        required: ["service"],
      },
    },
  },
];
