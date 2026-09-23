import { Router } from "express";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
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
} from "../../lib/reports/queries.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get(
  "/",
  requirePermission("reports.view"),
  async (req: AuthedRequest, res) => {
    res.render("reports/index", {
      title: "Reports",
      organization: req.organization,
      user: req.user,
      canViewPricing: canViewPricing(req.user),
      from: typeof req.query.from === "string" ? req.query.from : "",
      to: typeof req.query.to === "string" ? req.query.to : "",
    });
  },
);

reportsRouter.get(
  "/:kind",
  requirePermission("reports.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const kind = String(req.params.kind);
      const period = parsePeriod({
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
      });
      const format = typeof req.query.format === "string" ? req.query.format : "html";
      const showPricing = canViewPricing(req.user);

      const payload = await withTenantTransaction(req.organizationId!, async (tx) => {
        switch (kind) {
          case "conversion-source":
            return { title: "Conversion by lead source", rows: await reportConversionBySource(tx, period) };
          case "conversion-salesperson":
            return {
              title: "Conversion by salesperson",
              rows: await reportConversionBySalesperson(tx, period),
            };
          case "loss-reasons":
            return { title: "Loss reasons", rows: await reportLossReasons(tx, period) };
          case "projected-revenue":
            return { title: "Projected revenue", data: await reportProjectedRevenue(tx) };
          case "ar-aging":
            return { title: "Accounts receivable aging", data: await reportArAging(tx) };
          case "profitability":
            return { title: "Profitability", data: await reportProfitability(tx) };
          default:
            return null;
        }
      });

      if (!payload) {
        res.status(404).send("Unknown report");
        return;
      }

      if (format === "csv") {
        let csv = "";
        if (kind === "conversion-source") {
          const rows = (payload as { rows: { source: string; total: number; won: number; lost: number; conversionRate: number }[] }).rows;
          csv = toCsv(
            ["source", "total", "won", "lost", "conversion_rate"],
            rows.map((r) => [r.source, r.total, r.won, r.lost, r.conversionRate]),
          );
        } else if (kind === "conversion-salesperson") {
          const rows = (payload as { rows: { name: string; quotes: number; won: number; value: number; wonValue: number; conversionRate: number }[] }).rows;
          csv = toCsv(
            ["salesperson", "quotes", "won", "value", "won_value", "conversion_rate"],
            rows.map((r) => [
              r.name,
              r.quotes,
              r.won,
              showPricing ? r.value : "",
              showPricing ? r.wonValue : "",
              r.conversionRate,
            ]),
          );
        } else if (kind === "loss-reasons") {
          const rows = (payload as { rows: { reason: string; count: number }[] }).rows;
          csv = toCsv(
            ["reason", "count"],
            rows.map((r) => [r.reason, r.count]),
          );
        } else if (kind === "projected-revenue") {
          const data = (payload as { data: { byMonth: { month: string; amount: number }[]; total: number } }).data;
          csv = toCsv(
            ["month", "amount"],
            [
              ...data.byMonth.map((r) => [r.month, showPricing ? r.amount : ""]),
              ["total", showPricing ? data.total : ""],
            ],
          );
        } else if (kind === "ar-aging") {
          const data = (payload as { data: { buckets: Record<string, number>; total: number } }).data;
          csv = toCsv(
            ["bucket", "amount"],
            [
              ...Object.entries(data.buckets).map(([k, v]) => [k, showPricing ? v : ""]),
              ["total", showPricing ? data.total : ""],
            ],
          );
        } else if (kind === "profitability") {
          const data = (payload as {
            data: {
              byProject: { name: string; flooringType: string; revenue: number; actual: number; margin: number }[];
            };
          }).data;
          csv = toCsv(
            ["project", "flooring_type", "revenue", "actual", "margin"],
            data.byProject.map((r) => [
              r.name,
              r.flooringType,
              showPricing ? r.revenue : "",
              showPricing ? r.actual : "",
              showPricing ? r.margin : "",
            ]),
          );
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${kind}.csv"`);
        res.send(csv);
        return;
      }

      res.render("reports/show", {
        title: payload.title,
        organization: req.organization,
        user: req.user,
        kind,
        period,
        payload,
        canViewPricing: showPricing,
        from: period.from.toISOString().slice(0, 10),
        to: period.to.toISOString().slice(0, 10),
      });
    } catch (error) {
      next(error);
    }
  },
);
