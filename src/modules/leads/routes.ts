import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

leadsRouter.get(
  "/",
  requirePermission("leads.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const [leads, stages] = await withTenantTransaction(req.organizationId!, async (tx) => {
        const leadsList = await tx.lead.findMany({
          include: { pipelineStage: true, owner: true },
          orderBy: { updatedAt: "desc" },
        });
        const stagesList = await tx.pipelineStage.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
        });
        return [leadsList, stagesList] as const;
      });

      res.render("leads/index", {
        title: "Leads",
        organization: req.organization,
        user: req.user,
        leads,
        stages,
      });
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.get(
  "/new",
  requirePermission("leads.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const stages = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.pipelineStage.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
        });
      });
      res.render("leads/form", {
        title: "New lead",
        organization: req.organization,
        user: req.user,
        lead: null,
        stages,
        error: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.post(
  "/",
  requirePermission("leads.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(200),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().max(40).optional().or(z.literal("")),
        source: z.string().max(80).optional().or(z.literal("")),
        pipelineStageId: z.string().uuid().optional().or(z.literal("")),
        notes: z.string().max(5000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/leads/new");
        return;
      }

      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.lead.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            source: parsed.data.source || null,
            pipelineStageId: parsed.data.pipelineStageId || null,
            notes: parsed.data.notes || null,
            ownerId: req.user!.id,
            status: "new",
          },
        });
      });
      res.redirect("/leads");
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.get(
  "/:id/edit",
  requirePermission("leads.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const lead = await tx.lead.findFirst({ where: { id: param(req, "id") } });
        const stages = await tx.pipelineStage.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
        });
        return { lead, stages };
      });
      if (!result.lead) {
        res.status(404).render("errors/not-found", {
          title: "Lead not found",
          message: "Lead not found.",
          organization: req.organization,
          user: req.user,
        });
        return;
      }
      res.render("leads/form", {
        title: "Edit lead",
        organization: req.organization,
        user: req.user,
        lead: result.lead,
        stages: result.stages,
        error: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.post(
  "/:id",
  requirePermission("leads.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(200),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().max(40).optional().or(z.literal("")),
        source: z.string().max(80).optional().or(z.literal("")),
        status: z.string().max(40),
        pipelineStageId: z.string().uuid().optional().or(z.literal("")),
        notes: z.string().max(5000).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/leads/${param(req, "id")}/edit`);
        return;
      }

      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.lead.update({
          where: { id: param(req, "id") },
          data: {
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            source: parsed.data.source || null,
            status: parsed.data.status,
            pipelineStageId: parsed.data.pipelineStageId || null,
            notes: parsed.data.notes || null,
          },
        });
      });
      res.redirect("/leads");
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.post(
  "/:id/delete",
  requirePermission("leads.delete"),
  async (req: AuthedRequest, res, next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.lead.delete({ where: { id: param(req, "id") } });
      });
      res.redirect("/leads");
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.post(
  "/:id/convert",
  requirePermission("customers.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const customer = await withTenantTransaction(req.organizationId!, async (tx) => {
        const lead = await tx.lead.findFirst({ where: { id: param(req, "id") } });
        if (!lead) throw new Error("Lead not found");
        const created = await tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            leadId: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
          },
        });
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: "converted" },
        });
        return created;
      });
      res.redirect(`/customers/${customer.id}`);
    } catch (error) {
      next(error);
    }
  },
);

export const pipelineRouter = Router();

pipelineRouter.use(requireAuth);

pipelineRouter.get(
  "/",
  requirePermission("pipeline.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const stages = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.pipelineStage.findMany({ orderBy: { order: "asc" } });
      });
      res.render("leads/pipeline", {
        title: "Pipeline stages",
        organization: req.organization,
        user: req.user,
        stages,
      });
    } catch (error) {
      next(error);
    }
  },
);

pipelineRouter.post(
  "/",
  requirePermission("pipeline.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(80),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional()
          .or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/pipeline");
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const max = await tx.pipelineStage.aggregate({ _max: { order: true } });
        await tx.pipelineStage.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            color: parsed.data.color || null,
            order: (max._max.order ?? 0) + 1,
          },
        });
      });
      res.redirect("/pipeline");
    } catch (error) {
      next(error);
    }
  },
);
