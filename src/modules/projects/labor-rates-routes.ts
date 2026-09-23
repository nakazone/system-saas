import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { param } from "../../lib/http/params.js";

export const laborRatesRouter = Router();
laborRatesRouter.use(requireAuth);

laborRatesRouter.get(
  "/",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const rates = await tx.laborRate.findMany({
          include: { user: true },
          orderBy: [{ effectiveFrom: "desc" }],
        });
        const users = await tx.user.findMany({
          where: { status: "active" },
          orderBy: { name: "asc" },
        });
        return { rates, users };
      });
      res.render("settings/labor-rates", {
        title: "Labor rates",
        organization: req.organization,
        user: req.user,
        rates: data.rates,
        users: data.users,
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

laborRatesRouter.post(
  "/",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        userId: z.string().uuid().optional().or(z.literal("")),
        roleKey: z.string().max(40).optional().or(z.literal("")),
        label: z.string().max(80).optional().or(z.literal("")),
        hourlyRate: z.coerce.number().min(0),
        effectiveFrom: z.string().min(1),
        effectiveTo: z.string().optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/settings/labor-rates?error=1");
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.laborRate.create({
          data: {
            organizationId: req.organizationId!,
            userId: parsed.data.userId || null,
            roleKey: parsed.data.roleKey || null,
            label: parsed.data.label || null,
            hourlyRate: new Prisma.Decimal(parsed.data.hourlyRate.toFixed(2)),
            effectiveFrom: new Date(parsed.data.effectiveFrom),
            effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
          },
        });
      });
      res.redirect("/settings/labor-rates?success=created");
    } catch (error) {
      res.redirect("/settings/labor-rates?error=1");
    }
  },
);

laborRatesRouter.post(
  "/:id/delete",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.laborRate.deleteMany({ where: { id: param(req, "id") } });
      });
      res.redirect("/settings/labor-rates?success=deleted");
    } catch (error) {
      next(error);
    }
  },
);
