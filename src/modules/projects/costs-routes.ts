import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import {
  profitabilityCsv,
  resolveHourlyRate,
  summarizeProjectCosts,
} from "../../lib/projects/costs.js";

export const projectCostsRouter = Router({ mergeParams: true });
projectCostsRouter.use(requireAuth);

projectCostsRouter.get(
  "/:id/costs.csv",
  requirePermission("costs.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const project = await tx.project.findFirst({ where: { id: param(req, "id") } });
        if (!project) return null;
        const summary = await summarizeProjectCosts(tx, project.id);
        return { csv: profitabilityCsv(project.name, summary), name: project.name };
      });
      if (!result) {
        res.status(404).send("Not found");
        return;
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="profitability-${result.name.replace(/[^a-z0-9_-]+/gi, "-")}.csv"`,
      );
      res.send(result.csv);
    } catch (error) {
      next(error);
    }
  },
);

projectCostsRouter.post(
  "/:id/materials",
  requirePermission("projects.manage"),
  requirePermission("costs.view"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        description: z.string().min(1).max(200),
        sku: z.string().max(80).optional().or(z.literal("")),
        vendor: z.string().max(120).optional().or(z.literal("")),
        quantityOrdered: z.coerce.number().min(0),
        unitCost: z.coerce.number().min(0),
        notes: z.string().max(2000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/projects/${param(req, "id")}?error=invalid`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.materialOrder.create({
          data: {
            organizationId: req.organizationId!,
            projectId: param(req, "id"),
            description: parsed.data.description,
            sku: parsed.data.sku || null,
            vendor: parsed.data.vendor || null,
            quantityOrdered: new Prisma.Decimal(parsed.data.quantityOrdered),
            unitCost: new Prisma.Decimal(parsed.data.unitCost.toFixed(2)),
            status: "ordered",
            notes: parsed.data.notes || null,
          },
        });
      });
      res.redirect(`/projects/${param(req, "id")}?success=material`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/projects/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

projectCostsRouter.post(
  "/:id/materials/:orderId",
  requirePermission("projects.manage"),
  requirePermission("costs.view"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        quantityReceived: z.coerce.number().min(0).optional(),
        quantityUsed: z.coerce.number().min(0).optional(),
        status: z.enum(["ordered", "partial", "received", "canceled"]).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/projects/${param(req, "id")}?error=invalid`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const data: Prisma.MaterialOrderUpdateInput = {};
        if (parsed.data.quantityReceived != null) {
          data.quantityReceived = new Prisma.Decimal(parsed.data.quantityReceived);
        }
        if (parsed.data.quantityUsed != null) {
          data.quantityUsed = new Prisma.Decimal(parsed.data.quantityUsed);
        }
        if (parsed.data.status) data.status = parsed.data.status;
        await tx.materialOrder.update({
          where: { id: param(req, "orderId") },
          data,
        });
      });
      res.redirect(`/projects/${param(req, "id")}?success=material-updated`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/projects/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

projectCostsRouter.post(
  "/:id/expenses",
  requirePermission("projects.manage"),
  requirePermission("costs.view"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        description: z.string().min(1).max(200),
        category: z.enum(["material", "labor", "travel", "other"]).default("other"),
        amount: z.coerce.number().positive(),
        incurredOn: z.string().min(1),
        materialOrderId: z.string().uuid().optional().or(z.literal("")),
        notes: z.string().max(2000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/projects/${param(req, "id")}?error=invalid`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.expense.create({
          data: {
            organizationId: req.organizationId!,
            projectId: param(req, "id"),
            description: parsed.data.description,
            category: parsed.data.category,
            amount: new Prisma.Decimal(parsed.data.amount.toFixed(2)),
            incurredOn: new Date(parsed.data.incurredOn),
            materialOrderId: parsed.data.materialOrderId || null,
            notes: parsed.data.notes || null,
            status: "approved",
          },
        });
      });
      res.redirect(`/projects/${param(req, "id")}?success=expense`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/projects/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

projectCostsRouter.post(
  "/:id/labor",
  requirePermission("projects.manage"),
  requirePermission("costs.view"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        userId: z.string().uuid().optional().or(z.literal("")),
        workDate: z.string().min(1),
        hours: z.coerce.number().positive(),
        hourlyRate: z.coerce.number().min(0).optional(),
        notes: z.string().max(2000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/projects/${param(req, "id")}?error=invalid`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const workDate = new Date(parsed.data.workDate);
        let rate = parsed.data.hourlyRate;
        if (rate == null || Number.isNaN(rate)) {
          const user = parsed.data.userId
            ? await tx.user.findFirst({
                where: { id: parsed.data.userId },
                include: { role: true },
              })
            : null;
          rate = await resolveHourlyRate(tx, {
            organizationId: req.organizationId!,
            userId: parsed.data.userId || null,
            roleKey: user?.role?.key ?? null,
            on: workDate,
          });
        }
        const amount = Number((parsed.data.hours * rate).toFixed(2));
        await tx.laborEntry.create({
          data: {
            organizationId: req.organizationId!,
            projectId: param(req, "id"),
            userId: parsed.data.userId || null,
            workDate,
            hours: new Prisma.Decimal(parsed.data.hours),
            rateSnapshot: new Prisma.Decimal(rate.toFixed(2)),
            amount: new Prisma.Decimal(amount.toFixed(2)),
            notes: parsed.data.notes || null,
          },
        });
      });
      res.redirect(`/projects/${param(req, "id")}?success=labor`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/projects/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);
