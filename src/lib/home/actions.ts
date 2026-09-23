import type { TenantPrisma } from "../tenant/prisma-tenant.js";

export type ActionBlock = {
  key: string;
  label: string;
  count: number;
  href: string;
  /** Optional money amount (overdue invoices) */
  amount?: number;
};

export type ActionHomeData = {
  blocks: ActionBlock[];
  todayVisitsByCrew: { crewName: string; count: number }[];
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Pure filters used by both home counts and list pages — keep in sync via tests. */
export function staleNewLeadWhere(now: Date) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return {
    status: "new",
    createdAt: { lte: cutoff },
    OR: [{ lastContactedAt: null }, { lastContactedAt: { lte: cutoff } }],
  };
}

export function overdueAssessmentWhere(now: Date) {
  return {
    status: "scheduled",
    scheduledStart: { lt: now },
  };
}

export function staleQuoteWhere(now: Date) {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    status: { in: ["sent", "changes_requested"] },
    updatedAt: { lte: cutoff },
  };
}

export function expiringQuoteWhere(now: Date) {
  const in3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return {
    status: { in: ["sent", "changes_requested"] },
    validUntil: { gte: now, lte: in3 },
  };
}

export async function buildActionHome(
  tx: TenantPrisma,
  now: Date = new Date(),
): Promise<ActionHomeData> {
  const [
    staleLeads,
    overdueAssessments,
    staleQuotes,
    expiringQuotes,
    needsInvoice,
    overdueInvoices,
    visitsToday,
  ] = await Promise.all([
    tx.lead.count({ where: staleNewLeadWhere(now) }),
    tx.siteAssessment.count({ where: overdueAssessmentWhere(now) }),
    tx.quote.count({ where: staleQuoteWhere(now) }),
    tx.quote.count({ where: expiringQuoteWhere(now) }),
    tx.project.count({ where: { status: "needs_invoicing", deletedAt: null } }),
    tx.quoteInvoice.findMany({
      where: {
        status: { in: ["sent", "partially_paid"] },
        dueDate: { lt: now },
      },
      include: { receipts: true },
    }),
    tx.visit.findMany({
      where: {
        status: { not: "canceled" },
        scheduledStart: { gte: startOfDay(now), lte: endOfDay(now) },
      },
      include: { crew: true },
    }),
  ]);

  let overdueCount = 0;
  let overdueAmount = 0;
  for (const inv of overdueInvoices) {
    const paid = inv.receipts.reduce((s, r) => s + Number(r.amount), 0);
    const bal = Number(inv.amount) - paid;
    if (bal > 0.009) {
      overdueCount += 1;
      overdueAmount += bal;
    }
  }

  const byCrew = new Map<string, number>();
  for (const v of visitsToday) {
    const name = v.crew?.name || "Unassigned";
    byCrew.set(name, (byCrew.get(name) || 0) + 1);
  }

  const blocks: ActionBlock[] = [
    {
      key: "stale_leads",
      label: "New leads without contact (24h+)",
      count: staleLeads,
      href: "/leads?filter=stale_new",
    },
    {
      key: "overdue_assessments",
      label: "Overdue assessments",
      count: overdueAssessments,
      href: "/assessments?filter=overdue",
    },
    {
      key: "stale_quotes",
      label: "Quotes without response (7d+)",
      count: staleQuotes,
      href: "/quotes?filter=stale",
    },
    {
      key: "expiring_quotes",
      label: "Quotes expiring in 3 days",
      count: expiringQuotes,
      href: "/quotes?filter=expiring",
    },
    {
      key: "needs_invoicing",
      label: "Projects need invoicing",
      count: needsInvoice,
      href: "/projects?filter=needs_invoicing",
    },
    {
      key: "overdue_invoices",
      label: "Overdue invoices",
      count: overdueCount,
      amount: Number(overdueAmount.toFixed(2)),
      href: "/invoices?filter=overdue",
    },
  ];

  return {
    blocks,
    todayVisitsByCrew: [...byCrew.entries()].map(([crewName, count]) => ({
      crewName,
      count,
    })),
  };
}
