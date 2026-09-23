import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { convertQuoteToProject, refreshProjectStatus } from "../../lib/projects/convert.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

projectsRouter.get(
  "/",
  requirePermission("projects.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const projects = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.project.findMany({
          where: {
            deletedAt: null,
            ...(status ? { status } : {}),
          },
          include: {
            customer: true,
            quote: true,
            _count: { select: { visits: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 200,
        });
      });
      res.render("projects/index", {
        title: "Projects",
        organization: req.organization,
        user: req.user,
        projects,
        filters: { status },
        canManage: req.user?.permissions.includes("projects.manage"),
      });
    } catch (error) {
      next(error);
    }
  },
);

projectsRouter.get(
  "/:id",
  requirePermission("projects.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: param(req, "id"), deletedAt: null },
          include: {
            customer: true,
            property: true,
            quote: true,
            visits: {
              include: { crew: true, assignedUser: true },
              orderBy: { scheduledStart: "asc" },
            },
            events: { orderBy: { createdAt: "desc" }, take: 40 },
            paymentSchedule: { include: { items: { orderBy: { sortOrder: "asc" } } } },
          },
        });
        const crews = await tx.crew.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
        });
        const users = await tx.user.findMany({
          where: { status: "active" },
          orderBy: { name: "asc" },
        });
        return { project, crews, users };
      });
      if (!result.project) {
        res.status(404).send("Not found");
        return;
      }
      res.render("projects/show", {
        title: result.project.name,
        organization: req.organization,
        user: req.user,
        project: result.project,
        crews: result.crews,
        users: result.users,
        canManage: req.user?.permissions.includes("projects.manage"),
        canManageVisits: req.user?.permissions.includes("visits.manage"),
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

projectsRouter.post(
  "/from-quote/:quoteId",
  requirePermission("projects.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const project = await withTenantTransaction(req.organizationId!, async (tx) => {
        return convertQuoteToProject(tx, {
          organizationId: req.organizationId!,
          quoteId: param(req, "quoteId"),
          actorId: req.user!.id,
        });
      });
      res.redirect(`/projects/${project.id}?success=converted`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Convert failed";
      res.redirect(`/quotes/${param(req, "quoteId")}?error=${encodeURIComponent(message)}`);
    }
  },
);

projectsRouter.post(
  "/:id/status",
  requirePermission("projects.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const status = String(req.body.status || "");
      const allowed = [
        "planning",
        "scheduled",
        "in_progress",
        "needs_invoicing",
        "completed",
        "canceled",
      ];
      if (!allowed.includes(status)) {
        res.redirect(`/projects/${param(req, "id")}?error=invalid`);
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const project = await tx.project.findFirst({ where: { id: param(req, "id") } });
        if (!project) throw new Error("Not found");
        await tx.project.update({ where: { id: project.id }, data: { status } });
        await tx.projectEvent.create({
          data: {
            organizationId: req.organizationId!,
            projectId: project.id,
            type: "status_changed",
            actorId: req.user!.id,
            payload: { from: project.status, to: status },
          },
        });
      });
      res.redirect(`/projects/${param(req, "id")}?success=status`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      res.redirect(`/projects/${param(req, "id")}?error=${encodeURIComponent(message)}`);
    }
  },
);

projectsRouter.post(
  "/:id/refresh-status",
  requirePermission("projects.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await refreshProjectStatus(tx, param(req, "id"));
      });
      res.redirect(`/projects/${param(req, "id")}?success=refreshed`);
    } catch (error) {
      next(error);
    }
  },
);
