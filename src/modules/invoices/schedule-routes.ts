import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import {
  applyTemplateToQuote,
  seedDefaultPaymentTemplates,
  upsertQuotePaymentSchedule,
  validatePaymentSchedule,
  fromCents,
} from "../../lib/payments/engine.js";

export const paymentSchedulesRouter = Router();

paymentSchedulesRouter.use(requireAuth);

const itemSchema = z.object({
  label: z.string().min(1).max(120),
  percent: z.coerce.number().optional().nullable(),
  fixedAmount: z.coerce.number().optional().nullable(),
  trigger: z
    .enum(["manual", "on_send", "on_approve", "on_phase_start", "on_phase_complete"])
    .default("manual"),
  phaseKey: z.string().max(80).optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
});

paymentSchedulesRouter.post(
  "/quotes/:quoteId",
  requirePermission("invoices.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const quoteId = param(req, "quoteId");
      let items: z.infer<typeof itemSchema>[] = [];
      if (typeof req.body.itemsJson === "string" && req.body.itemsJson.trim()) {
        const parsedJson = JSON.parse(req.body.itemsJson);
        items = z.array(itemSchema).parse(parsedJson);
      } else {
        // form rows: label[], percent[], trigger[]
        const labels = ([] as string[]).concat(req.body.label || []).filter(Boolean);
        const percents = ([] as string[]).concat(req.body.percent || []);
        const triggers = ([] as string[]).concat(req.body.trigger || []);
        items = labels.map((label, i) => ({
          label: String(label),
          percent: percents[i] !== "" && percents[i] != null ? Number(percents[i]) : null,
          fixedAmount: null,
          trigger: (triggers[i] as z.infer<typeof itemSchema>["trigger"]) || "manual",
          phaseKey: null,
          sortOrder: i + 1,
        }));
      }

      await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({ where: { id: quoteId } });
        if (!quote) throw new Error("Quote not found");
        await upsertQuotePaymentSchedule(tx, {
          organizationId: req.organizationId!,
          quoteId,
          items,
          quoteTotal: Number(quote.total),
        });
      });
      res.redirect(`/quotes/${quoteId}?success=${encodeURIComponent("Payment schedule saved")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed";
      res.redirect(`/quotes/${param(req, "quoteId")}?error=${encodeURIComponent(message)}`);
    }
  },
);

paymentSchedulesRouter.post(
  "/quotes/:quoteId/apply-template",
  requirePermission("invoices.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const quoteId = param(req, "quoteId");
      const templateId = String(req.body.templateId || "");
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultPaymentTemplates(tx, req.organizationId!);
        const quote = await tx.quote.findFirst({ where: { id: quoteId } });
        if (!quote) throw new Error("Quote not found");
        await applyTemplateToQuote(tx, {
          organizationId: req.organizationId!,
          quoteId,
          templateId,
          quoteTotal: Number(quote.total),
        });
      });
      res.redirect(`/quotes/${quoteId}?success=${encodeURIComponent("Template applied")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/quotes/${param(req, "quoteId")}?error=${encodeURIComponent(message)}`);
    }
  },
);

paymentSchedulesRouter.get(
  "/preview",
  requirePermission("invoices.manage"),
  async (req: AuthedRequest, res) => {
    const total = Number(req.query.total || 0);
    try {
      const items = z.array(itemSchema).parse(JSON.parse(String(req.query.items || "[]")));
      const result = validatePaymentSchedule(items, total);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json({
        ok: true,
        amounts: result.amountsCents.map(fromCents),
      });
    } catch {
      res.status(400).json({ ok: false, error: "Invalid preview payload" });
    }
  },
);
