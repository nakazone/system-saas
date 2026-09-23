import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { seedDefaultPaymentTemplates } from "../../lib/payments/engine.js";
import type { PaymentTemplateItemInput } from "../../lib/payments/defaults.js";

export const paymentTemplatesRouter = Router();

paymentTemplatesRouter.use(requireAuth);

paymentTemplatesRouter.get(
  "/",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const templates = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultPaymentTemplates(tx, req.organizationId!);
        return tx.orgPaymentTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      });
      res.render("settings/payment-templates", {
        title: "Payment templates",
        organization: req.organization,
        user: req.user,
        templates,
        editing: null,
        error: null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

paymentTemplatesRouter.get(
  "/:id/edit",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const editing = await tx.orgPaymentTemplate.findFirst({ where: { id: param(req, "id") } });
        const templates = await tx.orgPaymentTemplate.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });
        return { editing, templates };
      });
      if (!result.editing) {
        res.status(404).send("Not found");
        return;
      }
      res.render("settings/payment-templates", {
        title: "Edit payment template",
        organization: req.organization,
        user: req.user,
        templates: result.templates,
        editing: result.editing,
        error: null,
        success: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

paymentTemplatesRouter.post(
  "/",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const name = String(req.body.name || "").trim();
      if (!name) {
        res.redirect("/settings/payment-templates?error=1");
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.orgPaymentTemplate.create({
          data: {
            organizationId: req.organizationId!,
            name,
            description: String(req.body.description || "") || null,
            items: [
              { label: "Deposit", percent: 50, trigger: "on_approve", sortOrder: 1 },
              { label: "Final", percent: 50, trigger: "manual", sortOrder: 2 },
            ] as unknown as Prisma.InputJsonValue,
            sortOrder: 99,
            active: true,
          },
        });
      });
      res.redirect("/settings/payment-templates?success=created");
    } catch (error) {
      res.redirect("/settings/payment-templates?error=1");
    }
  },
);

paymentTemplatesRouter.post(
  "/:id",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const items = z
        .array(
          z.object({
            label: z.string().min(1),
            percent: z.number().optional().nullable(),
            fixedAmount: z.number().optional().nullable(),
            trigger: z.enum([
              "manual",
              "on_send",
              "on_approve",
              "on_phase_start",
              "on_phase_complete",
            ]),
            phaseKey: z.string().optional().nullable(),
            sortOrder: z.number().optional(),
          }),
        )
        .parse(JSON.parse(String(req.body.itemsJson || "[]"))) as PaymentTemplateItemInput[];

      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.orgPaymentTemplate.update({
          where: { id: param(req, "id") },
          data: {
            name: String(req.body.name || "").trim(),
            description: String(req.body.description || "") || null,
            active: req.body.active === "on",
            items: items as unknown as Prisma.InputJsonValue,
          },
        });
      });
      res.redirect(`/settings/payment-templates/${param(req, "id")}/edit?success=saved`);
    } catch (error) {
      res.redirect(`/settings/payment-templates/${param(req, "id")}/edit?error=1`);
    }
  },
);
