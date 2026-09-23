import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { summarizeProjectCosts } from "../projects/costs.js";

export type PeriodFilter = { from: Date; to: Date };

export function parsePeriod(query: {
  from?: string;
  to?: string;
}): PeriodFilter {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export type OpenInstallment = {
  invoiceId: string;
  dueDate: Date | null;
  balance: number;
  monthKey: string;
};

/** Open balance = invoice amount − receipts (non-void). */
export function openInvoiceBalance(invoice: {
  amount: { toString(): string } | number;
  status: string;
  receipts: { amount: { toString(): string } | number }[];
}): number {
  if (invoice.status === "void" || invoice.status === "paid") return 0;
  const paid = invoice.receipts.reduce((s, r) => s + Number(r.amount), 0);
  return Math.max(0, Number(Number(invoice.amount) - paid));
}

export function monthKey(d: Date | null, fallback: Date): string {
  const x = d ?? fallback;
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function projectedRevenueFromOpen(
  invoices: {
    id: string;
    amount: { toString(): string } | number;
    status: string;
    dueDate: Date | null;
    createdAt: Date;
    receipts: { amount: { toString(): string } | number }[];
  }[],
): { byMonth: { month: string; amount: number }[]; total: number; items: OpenInstallment[] } {
  const items: OpenInstallment[] = [];
  for (const inv of invoices) {
    const balance = openInvoiceBalance(inv);
    if (balance < 0.01) continue;
    const mk = monthKey(inv.dueDate, inv.createdAt);
    items.push({
      invoiceId: inv.id,
      dueDate: inv.dueDate,
      balance: Number(balance.toFixed(2)),
      monthKey: mk,
    });
  }
  const map = new Map<string, number>();
  for (const it of items) {
    map.set(it.monthKey, (map.get(it.monthKey) || 0) + it.balance);
  }
  const byMonth = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount: Number(amount.toFixed(2)) }));
  const total = Number(items.reduce((s, i) => s + i.balance, 0).toFixed(2));
  return { byMonth, total, items };
}

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 30) return "0-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

export function arAgingFromOpen(
  invoices: {
    id: string;
    amount: { toString(): string } | number;
    status: string;
    dueDate: Date | null;
    createdAt: Date;
    receipts: { amount: { toString(): string } | number }[];
  }[],
  now: Date,
): { buckets: Record<AgingBucket, number>; total: number } {
  const buckets: Record<AgingBucket, number> = {
    "0-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  let total = 0;
  for (const inv of invoices) {
    const balance = openInvoiceBalance(inv);
    if (balance < 0.01) continue;
    const due = inv.dueDate ?? inv.createdAt;
    const days = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
    const bucket = agingBucket(Math.max(0, days));
    buckets[bucket] += balance;
    total += balance;
  }
  for (const k of Object.keys(buckets) as AgingBucket[]) {
    buckets[k] = Number(buckets[k].toFixed(2));
  }
  return { buckets, total: Number(total.toFixed(2)) };
}

export async function reportConversionBySource(
  tx: TenantPrisma,
  period: PeriodFilter,
) {
  const leads = await tx.lead.findMany({
    where: { createdAt: { gte: period.from, lte: period.to } },
  });
  const map = new Map<string, { total: number; won: number; lost: number }>();
  for (const l of leads) {
    const src = l.source || "(none)";
    const row = map.get(src) || { total: 0, won: 0, lost: 0 };
    row.total += 1;
    if (l.status === "won" || l.status === "converted") row.won += 1;
    if (l.status === "lost") row.lost += 1;
    map.set(src, row);
  }
  return [...map.entries()].map(([source, v]) => ({
    source,
    ...v,
    conversionRate: v.total ? Number(((v.won / v.total) * 100).toFixed(1)) : 0,
  }));
}

export async function reportConversionBySalesperson(
  tx: TenantPrisma,
  period: PeriodFilter,
) {
  const quotes = await tx.quote.findMany({
    where: { createdAt: { gte: period.from, lte: period.to } },
    include: { salesperson: true },
  });
  const map = new Map<
    string,
    { name: string; quotes: number; won: number; value: number; wonValue: number }
  >();
  for (const q of quotes) {
    const id = q.salespersonId || "(unassigned)";
    const name = q.salesperson?.name || "Unassigned";
    const row = map.get(id) || { name, quotes: 0, won: 0, value: 0, wonValue: 0 };
    row.quotes += 1;
    row.value += Number(q.total);
    if (["approved", "converted"].includes(q.status)) {
      row.won += 1;
      row.wonValue += Number(q.total);
    }
    map.set(id, row);
  }
  return [...map.values()].map((v) => ({
    ...v,
    value: Number(v.value.toFixed(2)),
    wonValue: Number(v.wonValue.toFixed(2)),
    conversionRate: v.quotes ? Number(((v.won / v.quotes) * 100).toFixed(1)) : 0,
  }));
}

export async function reportLossReasons(tx: TenantPrisma, period: PeriodFilter) {
  const leads = await tx.lead.findMany({
    where: {
      status: "lost",
      lostAt: { gte: period.from, lte: period.to },
    },
    include: { lossReason: true },
  });
  const map = new Map<string, number>();
  for (const l of leads) {
    const name = l.lossReason?.name || "(none)";
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export async function reportProjectedRevenue(tx: TenantPrisma) {
  const invoices = await tx.quoteInvoice.findMany({
    where: { status: { in: ["draft", "sent", "partially_paid"] } },
    include: { receipts: true },
  });
  return projectedRevenueFromOpen(invoices);
}

export async function reportArAging(tx: TenantPrisma, now: Date = new Date()) {
  const invoices = await tx.quoteInvoice.findMany({
    where: { status: { in: ["sent", "partially_paid"] } },
    include: { receipts: true },
  });
  return arAgingFromOpen(invoices, now);
}

export async function reportProfitability(tx: TenantPrisma) {
  const projects = await tx.project.findMany({
    where: { deletedAt: null },
    include: { quote: true },
  });
  const byProject: {
    projectId: string;
    name: string;
    flooringType: string;
    revenue: number;
    actual: number;
    margin: number;
  }[] = [];
  const byFloor = new Map<string, { revenue: number; actual: number; count: number }>();

  for (const p of projects) {
    const summary = await summarizeProjectCosts(tx, p.id);
    const flooringType = p.quote?.flooringType || "(unknown)";
    byProject.push({
      projectId: p.id,
      name: p.name,
      flooringType,
      revenue: summary.revenue,
      actual: summary.actual.total,
      margin: summary.margin,
    });
    const row = byFloor.get(flooringType) || { revenue: 0, actual: 0, count: 0 };
    row.revenue += summary.revenue;
    row.actual += summary.actual.total;
    row.count += 1;
    byFloor.set(flooringType, row);
  }

  return {
    byProject,
    byFlooringType: [...byFloor.entries()].map(([flooringType, v]) => ({
      flooringType,
      count: v.count,
      revenue: Number(v.revenue.toFixed(2)),
      actual: Number(v.actual.toFixed(2)),
      margin: Number((v.revenue - v.actual).toFixed(2)),
    })),
  };
}
