/**
 * CRM Relatórios hub — JSON + CSV aggregation across sales, jobs, finance, payroll.
 */
import { Router } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { canViewPricing } from "../../lib/pricing/visibility.js";
import {
  parsePeriod,
  toCsv,
  reportConversionBySource,
  reportConversionBySalesperson,
  reportLossReasons,
  reportProjectedRevenue,
  reportArAging,
  reportProfitability,
  type PeriodFilter,
} from "../../lib/reports/queries.js";
import { jobBilling } from "../../lib/invoices/job.js";
import { reportData as folhaReportData } from "./folha-admin.js";
import { loadDashboardOverview, viewerAccess } from "../../lib/dashboard/overview.js";
import { safeTimeZone } from "../../lib/time/zoned.js";

export const reportsHubRouter = Router();

const WO_STATUSES = ["draft", "scheduled", "in_progress", "completed", "canceled"] as const;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function periodFromQuery(req: AuthedRequest): PeriodFilter {
  return parsePeriod({
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
  });
}

function hasPerm(req: AuthedRequest, key: string): boolean {
  if (req.user?.roleKey === "admin") return true;
  return Boolean(req.user?.permissions?.includes(key));
}

async function buildExecutive(tx: TenantPrisma, period: PeriodFilter, req: AuthedRequest) {
  const access = viewerAccess(req.user!);
  const timezone = safeTimeZone(req.organization?.timezone);
  const overview = await loadDashboardOverview(tx, {
    organizationId: req.organizationId!,
    timezone,
    access,
  });

  const [leadsInPeriod, quotesWon, openInvoices] = await Promise.all([
    tx.lead.count({ where: { createdAt: { gte: period.from, lte: period.to } } }),
    tx.quote.findMany({
      where: {
        createdAt: { gte: period.from, lte: period.to },
        status: { in: ["approved", "converted", "accepted", "invoiced"] },
      },
      select: { total: true },
    }),
    tx.quoteInvoice.findMany({
      where: { status: { in: ["sent", "partially_paid"] } },
      include: { receipts: { select: { amount: true } } },
    }),
  ]);

  let receivables = 0;
  for (const inv of openInvoices) {
    const paid = inv.receipts.reduce((s, r) => s + dec(r.amount), 0);
    receivables += Math.max(0, dec(inv.amount) - paid);
  }

  const wonRevenue = quotesWon.reduce((s, q) => s + dec(q.total), 0);
  const kpis = (overview as { kpis?: Record<string, unknown> }).kpis || {};

  return {
    period: { from: ymd(period.from), to: ymd(period.to) },
    leads_created: leadsInPeriod,
    quotes_won_count: quotesWon.length,
    quotes_won_revenue: money(wonRevenue),
    receivables_open: money(receivables),
    overview_kpis: kpis,
    attention_count: Number((overview as { attention?: { total?: number } }).attention?.total || 0),
  };
}

async function buildJobsOps(tx: TenantPrisma, period: PeriodFilter) {
  const workOrders = await tx.workOrder.findMany({
    where: { status: { not: "canceled" } },
    select: {
      id: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      createdAt: true,
      lineItems: { select: { quantitySqft: true, unitPrice: true, lineTotal: true } },
      invoices: {
        select: {
          amount: true,
          status: true,
          receipts: { select: { amount: true } },
        },
      },
    },
  });

  const byStatus: Record<string, number> = {};
  for (const s of WO_STATUSES) byStatus[s] = 0;

  let toInvoice = 0;
  let awaitingPayment = 0;
  let scheduledInPeriod = 0;
  let completedInPeriod = 0;

  for (const wo of workOrders) {
    byStatus[wo.status] = (byStatus[wo.status] || 0) + 1;
    const servicesTotal = wo.lineItems.reduce((s, li) => {
      const lt = dec(li.lineTotal);
      if (lt) return s + lt;
      return s + dec(li.quantitySqft) * dec(li.unitPrice);
    }, 0);
    const billing = jobBilling(
      servicesTotal,
      wo.invoices.map((inv) => ({
        amount: inv.amount,
        status: inv.status,
        receipts: inv.receipts,
      })),
    );
    if (wo.status === "completed" && billing.remaining_to_invoice > 0.004) toInvoice += 1;
    if (billing.billing_status === "awaiting_payment") awaitingPayment += 1;

    const start = wo.scheduledStart;
    if (start && start >= period.from && start <= period.to) scheduledInPeriod += 1;
    if (wo.status === "completed" && wo.scheduledEnd && wo.scheduledEnd >= period.from && wo.scheduledEnd <= period.to) {
      completedInPeriod += 1;
    }
  }

  return {
    period: { from: ymd(period.from), to: ymd(period.to) },
    by_status: byStatus,
    active: (byStatus.scheduled || 0) + (byStatus.in_progress || 0),
    to_invoice: toInvoice,
    awaiting_payment: awaitingPayment,
    scheduled_in_period: scheduledInPeriod,
    completed_in_period: completedInPeriod,
    total_open: workOrders.filter((w) => w.status !== "completed").length,
  };
}

async function buildCashflow(tx: TenantPrisma, period: PeriodFilter) {
  const toEnd = new Date(period.to.getTime() + 24 * 3600 * 1000 - 1);
  const [receipts, costs, abatements, openInvoices] = await Promise.all([
    tx.invoiceReceipt.findMany({
      where: { paidAt: { gte: period.from, lte: toEnd } },
      select: { amount: true, paidAt: true },
    }),
    tx.financeCost.findMany({
      where: { status: "posted", incurredOn: { gte: period.from, lte: period.to } },
      select: { amount: true },
    }),
    tx.financePayrollAbatement.findMany({
      where: {
        status: { in: ["paid", "pending"] },
        paidOn: { gte: period.from, lte: period.to },
      },
      select: { amount: true, status: true },
    }),
    tx.quoteInvoice.findMany({
      where: { status: { in: ["sent", "partially_paid"] } },
      include: { receipts: { select: { amount: true } } },
    }),
  ]);

  const inflow = receipts.reduce((s, r) => s + dec(r.amount), 0);
  const costOut = costs.reduce((s, c) => s + dec(c.amount), 0);
  const payrollOut = abatements.filter((a) => a.status === "paid").reduce((s, a) => s + dec(a.amount), 0);
  const payrollPending = abatements.filter((a) => a.status === "pending").reduce((s, a) => s + dec(a.amount), 0);

  let receivables = 0;
  for (const inv of openInvoices) {
    const paid = inv.receipts.reduce((s, r) => s + dec(r.amount), 0);
    receivables += Math.max(0, dec(inv.amount) - paid);
  }

  return {
    from: ymd(period.from),
    to: ymd(period.to),
    inflow: money(inflow),
    outflow: money(costOut + payrollOut),
    net: money(inflow - costOut - payrollOut),
    receivables: money(receivables),
    payroll_pending: money(payrollPending),
    costs: money(costOut),
    payroll_paid: money(payrollOut),
    receipt_count: receipts.length,
    cost_count: costs.length,
  };
}

async function buildFolha(tx: TenantPrisma, period: PeriodFilter) {
  const data = await folhaReportData(tx as Parameters<typeof folhaReportData>[0], {
    from: period.from,
    to: period.to,
    employeeId: null,
    sector: null,
  });
  return {
    period: { from: ymd(period.from), to: ymd(period.to) },
    totals: data.totals,
    employees: data.employees.slice(0, 50).map((e) => ({
      id: e.id,
      name: e.name,
      sector: e.sector,
      days: e.days,
      net: e.net,
      paid: e.paid,
      earned: e.earned,
    })),
    employee_count: data.employees.length,
    jobs_cost_total: money(data.jobs.reduce((s, j) => s + j.cost, 0)),
  };
}

async function buildHubPayload(tx: TenantPrisma, period: PeriodFilter, req: AuthedRequest) {
  const showPricing = canViewPricing(req.user);
  const canFinance = hasPerm(req, "finance.view");
  const canPayroll = hasPerm(req, "payroll.view");
  const canJobs = hasPerm(req, "work_orders.view");
  const canLeads = hasPerm(req, "leads.view");
  const canQuotes = hasPerm(req, "quotes.view");

  const [
    executive,
    conversionSource,
    conversionSalesperson,
    lossReasons,
    projectedRevenue,
    arAging,
    profitability,
    jobsOps,
    cashflow,
    folha,
  ] = await Promise.all([
    canLeads || canQuotes ? buildExecutive(tx, period, req) : null,
    canLeads ? reportConversionBySource(tx, period) : null,
    canQuotes ? reportConversionBySalesperson(tx, period) : null,
    canLeads ? reportLossReasons(tx, period) : null,
    canFinance || showPricing ? reportProjectedRevenue(tx) : null,
    canFinance ? reportArAging(tx) : null,
    showPricing ? reportProfitability(tx).catch(() => null) : null,
    canJobs ? buildJobsOps(tx, period) : null,
    canFinance ? buildCashflow(tx, period) : null,
    canPayroll ? buildFolha(tx, period).catch(() => null) : null,
  ]);

  return {
    period: { from: ymd(period.from), to: ymd(period.to) },
    access: {
      reports: true,
      pricing: showPricing,
      finance: canFinance,
      payroll: canPayroll,
      jobs: canJobs,
      leads: canLeads,
      quotes: canQuotes,
    },
    executive,
    sales: {
      conversion_source: conversionSource,
      conversion_salesperson: conversionSalesperson,
      loss_reasons: lossReasons,
    },
    jobs: jobsOps,
    receivables: {
      ar_aging: arAging,
      projected_revenue: projectedRevenue,
    },
    cashflow,
    folha,
    profitability: showPricing ? profitability : null,
  };
}

type KindPayload = { title: string; data: unknown; csv?: { headers: string[]; rows: (string | number | null | undefined)[][] } };

async function buildKind(tx: TenantPrisma, kind: string, period: PeriodFilter, req: AuthedRequest): Promise<KindPayload | null> {
  const showPricing = canViewPricing(req.user);
  switch (kind) {
    case "executive": {
      const data = await buildExecutive(tx, period, req);
      return {
        title: "Resumo executivo",
        data,
        csv: {
          headers: ["metric", "value"],
          rows: [
            ["leads_created", data.leads_created],
            ["quotes_won_count", data.quotes_won_count],
            ["quotes_won_revenue", data.quotes_won_revenue],
            ["receivables_open", data.receivables_open],
            ["attention_count", data.attention_count],
          ],
        },
      };
    }
    case "conversion-source": {
      const rows = await reportConversionBySource(tx, period);
      return {
        title: "Conversão por origem",
        data: rows,
        csv: {
          headers: ["source", "total", "won", "lost", "conversion_rate"],
          rows: rows.map((r) => [r.source, r.total, r.won, r.lost, r.conversionRate]),
        },
      };
    }
    case "conversion-salesperson": {
      const rows = await reportConversionBySalesperson(tx, period);
      return {
        title: "Conversão por vendedor",
        data: rows,
        csv: {
          headers: ["name", "quotes", "won", "value", "won_value", "conversion_rate"],
          rows: rows.map((r) => [r.name, r.quotes, r.won, r.value, r.wonValue, r.conversionRate]),
        },
      };
    }
    case "loss-reasons": {
      const rows = await reportLossReasons(tx, period);
      return {
        title: "Motivos de perda",
        data: rows,
        csv: {
          headers: ["reason", "count"],
          rows: rows.map((r) => [r.reason, r.count]),
        },
      };
    }
    case "projected-revenue": {
      const data = await reportProjectedRevenue(tx);
      return {
        title: "Receita projetada",
        data,
        csv: {
          headers: ["month", "amount"],
          rows: data.byMonth.map((r) => [r.month, r.amount]),
        },
      };
    }
    case "ar-aging": {
      const data = await reportArAging(tx);
      return {
        title: "Aging de recebíveis",
        data,
        csv: {
          headers: ["bucket", "amount"],
          rows: Object.entries(data.buckets).map(([bucket, amount]) => [bucket, amount]),
        },
      };
    }
    case "profitability": {
      if (!showPricing) return null;
      const data = await reportProfitability(tx);
      return {
        title: "Lucratividade",
        data,
        csv: {
          headers: ["flooring_type", "count", "revenue", "actual", "margin"],
          rows: data.byFlooringType.map((r) => [r.flooringType, r.count, r.revenue, r.actual, r.margin]),
        },
      };
    }
    case "jobs-ops": {
      const data = await buildJobsOps(tx, period);
      return {
        title: "Jobs / operação",
        data,
        csv: {
          headers: ["metric", "value"],
          rows: [
            ...Object.entries(data.by_status).map(([k, v]) => [`status_${k}`, v]),
            ["active", data.active],
            ["to_invoice", data.to_invoice],
            ["awaiting_payment", data.awaiting_payment],
            ["scheduled_in_period", data.scheduled_in_period],
            ["completed_in_period", data.completed_in_period],
          ],
        },
      };
    }
    case "cashflow": {
      const data = await buildCashflow(tx, period);
      return {
        title: "Fluxo de caixa",
        data,
        csv: {
          headers: ["metric", "value"],
          rows: [
            ["inflow", data.inflow],
            ["outflow", data.outflow],
            ["net", data.net],
            ["receivables", data.receivables],
            ["costs", data.costs],
            ["payroll_paid", data.payroll_paid],
            ["payroll_pending", data.payroll_pending],
          ],
        },
      };
    }
    case "folha": {
      const data = await buildFolha(tx, period);
      return {
        title: "Folha",
        data,
        csv: {
          headers: ["name", "sector", "days", "earned", "net", "paid"],
          rows: data.employees.map((e) => [e.name, e.sector, e.days, e.earned, e.net, e.paid]),
        },
      };
    }
    default:
      return null;
  }
}

reportsHubRouter.get(
  "/api/reports/hub",
  requireCrmAuth,
  requireCrmPermission("reports.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const period = periodFromQuery(req);
      const data = await withTenantTransaction(req.organizationId!, (tx) => buildHubPayload(tx, period, req));
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

reportsHubRouter.get(
  "/api/reports/:kind",
  requireCrmAuth,
  requireCrmPermission("reports.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const kind = String(req.params.kind || "");
      if (kind === "hub") {
        res.status(404).json({ success: false, error: "Unknown report" });
        return;
      }
      const period = periodFromQuery(req);
      const format = typeof req.query.format === "string" ? req.query.format : "json";
      const payload = await withTenantTransaction(req.organizationId!, (tx) => buildKind(tx, kind, period, req));
      if (!payload) {
        res.status(404).json({ success: false, error: "Unknown report or missing permission" });
        return;
      }
      if (format === "csv" && payload.csv) {
        const csv = toCsv(payload.csv.headers, payload.csv.rows);
        const name = `relatorio-${kind}-${ymd(period.from)}-a-${ymd(period.to)}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
        res.send("\uFEFF" + csv);
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({
        success: true,
        data: {
          kind,
          title: payload.title,
          period: { from: ymd(period.from), to: ymd(period.to) },
          result: payload.data,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
