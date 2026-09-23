import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";

export const crewsRouter = Router();
crewsRouter.use(requireAuth);

crewsRouter.get(
  "/",
  requirePermission("projects.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const crews = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.crew.findMany({
          include: {
            members: { include: { user: true } },
            _count: { select: { visits: true } },
          },
          orderBy: { name: "asc" },
        });
      });
      const users = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.user.findMany({ where: { status: "active" }, orderBy: { name: "asc" } });
      });
      res.render("crews/index", {
        title: "Crews",
        organization: req.organization,
        user: req.user,
        crews,
        users,
        canManage: req.user?.permissions.includes("projects.manage"),
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

crewsRouter.post(
  "/",
  requirePermission("projects.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const name = String(req.body.name || "").trim();
      if (!name) {
        res.redirect("/crews?error=name");
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.crew.create({
          data: {
            organizationId: req.organizationId!,
            name,
            color: String(req.body.color || "") || null,
          },
        });
      });
      res.redirect("/crews?success=created");
    } catch (error) {
      res.redirect("/crews?error=1");
    }
  },
);

crewsRouter.post(
  "/:id/members",
  requirePermission("projects.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        userId: z.string().uuid(),
        role: z.enum(["lead", "member"]).default("member"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/crews?error=1");
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.crewMember.upsert({
          where: {
            crewId_userId: { crewId: param(req, "id"), userId: parsed.data.userId },
          },
          create: {
            organizationId: req.organizationId!,
            crewId: param(req, "id"),
            userId: parsed.data.userId,
            role: parsed.data.role,
          },
          update: { role: parsed.data.role },
        });
      });
      res.redirect("/crews?success=member");
    } catch (error) {
      res.redirect("/crews?error=1");
    }
  },
);

crewsRouter.post(
  "/:id/members/:memberId/remove",
  requirePermission("projects.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.crewMember.deleteMany({
          where: { id: param(req, "memberId"), crewId: param(req, "id") },
        });
      });
      res.redirect("/crews?success=removed");
    } catch (error) {
      next(error);
    }
  },
);
