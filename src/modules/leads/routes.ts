import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { diffFields, recordActivity } from "../../lib/activity/record.js";
import { canViewPricing } from "../../lib/pricing/visibility.js";
import { staleNewLeadWhere } from "../../lib/home/actions.js";
import {
  assertCanDeleteOrReorderStage,
  moveLeadToSystemStage,
} from "../../lib/pipeline/move.js";

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

leadsRouter.get(
  "/",
  requirePermission("leads.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const filter = typeof req.query.filter === "string" ? req.query.filter : "";
      const ownerId = typeof req.query.ownerId === "string" ? req.query.ownerId : "";
      const now = new Date();
      const [leads, stages, metrics] = await withTenantTransaction(
        req.organizationId!,
        async (tx) => {
          const where: Record<string, unknown> = {};
          if (filter === "stale_new") Object.assign(where, staleNewLeadWhere(now));
          if (ownerId) where.ownerId = ownerId;
          const leadsList = await tx.lead.findMany({
            where,
            include: { pipelineStage: true, owner: true, lossReason: true },
            orderBy: { updatedAt: "desc" },
          });
          const stagesList = await tx.pipelineStage.findMany({
            where: { isActive: true },
            orderBy: { order: "asc" },
          });
          const open = leadsList.filter((l) => !l.pipelineStage?.isClosed).length;
          const won = leadsList.filter((l) => l.status === "won").length;
          const lost = leadsList.filter((l) => l.status === "lost").length;
          return [leadsList, stagesList, { total: leadsList.length, open, won, lost }] as const;
        },
      );

      res.render("leads/index", {
        title: "Leads",
        organization: req.organization,
        user: req.user,
        leads,
        stages,
        metrics,
        filters: { filter, ownerId },
      });
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.get(
  "/board",
  requirePermission("leads.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const ownerId = typeof req.query.ownerId === "string" ? req.query.ownerId : "";
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const stages = await tx.pipelineStage.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
        });
        const leads = await tx.lead.findMany({
          where: ownerId ? { ownerId } : undefined,
          include: {
            owner: true,
            lossReason: true,
            customers: {
              include: {
                quotes: {
                  where: { status: { in: ["sent", "changes_requested", "approved", "converted"] } },
                  orderBy: { updatedAt: "desc" },
                  take: 1,
                },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        });
        const lossReasons = await tx.lossReason.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        });
        const owners = await tx.user.findMany({
          where: { status: "active" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        });
        return { stages, leads, lossReasons, owners };
      });

      const columns = data.stages.map((stage) => ({
        stage,
        leads: data.leads
          .filter((l) => l.pipelineStageId === stage.id)
          .map((l) => {
            const quote = l.customers.flatMap((c) => c.quotes)[0];
            return {
              ...l,
              quoteTotal: quote ? Number(quote.total) : null,
            };
          }),
      }));

      res.render("leads/board", {
        title: "Pipeline board",
        organization: req.organization,
        user: req.user,
        columns,
        lossReasons: data.lossReasons,
        owners: data.owners,
        filters: { ownerId },
        canViewPricing: canViewPricing(req.user),
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.post(
  "/:id/move",
  requirePermission("leads.edit"),
  async (req: AuthedRequest, res, _next) => {
    const leadId = param(req, "id");
    try {
      const schema = z.object({
        stageId: z.string().uuid(),
        lossReasonId: z.string().uuid().optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/leads/board?error=${encodeURIComponent("Invalid move")}`);
        return;
      }

      await withTenantTransaction(req.organizationId!, async (tx) => {
        const stage = await tx.pipelineStage.findFirst({
          where: { id: parsed.data.stageId },
        });
        if (!stage) throw new Error("Stage not found");

        if (stage.slug === "lost") {
          const result = await moveLeadToSystemStage(tx, {
            organizationId: req.organizationId!,
            leadId,
            slug: "lost",
            lossReasonId: parsed.data.lossReasonId || null,
            actorType: "user",
            actorId: req.user!.id,
          });
          if (!result.moved) {
            throw new Error(
              result.reason === "loss_reason_required"
                ? "Loss reason required"
                : result.reason || "Move failed",
            );
          }
          return;
        }

        if (stage.isSystemMilestone && stage.slug) {
          const slug = stage.slug as "new" | "assessment_scheduled" | "quote_sent" | "won";
          if (["new", "assessment_scheduled", "quote_sent", "won"].includes(slug)) {
            await moveLeadToSystemStage(tx, {
              organizationId: req.organizationId!,
              leadId,
              slug,
              actorType: "user",
              actorId: req.user!.id,
            });
            return;
          }
        }

        const before = await tx.lead.findFirst({ where: { id: leadId } });
        if (!before) throw new Error("Lead not found");
        await tx.lead.update({
          where: { id: leadId },
          data: {
            pipelineStageId: stage.id,
            lossReasonId: null,
            lostAt: null,
            lastContactedAt: new Date(),
          },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "lead",
          entityId: leadId,
          actorType: "user",
          actorId: req.user!.id,
          action: "status_changed",
          changes: {
            pipelineStageId: { from: before.pipelineStageId, to: stage.id },
          },
        });
      });
      res.redirect(`/leads/board?success=${encodeURIComponent("Moved")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Move failed";
      res.redirect(`/leads/board?error=${encodeURIComponent(message)}`);
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

      const lead = await withTenantTransaction(req.organizationId!, async (tx) => {
        let stageId = parsed.data.pipelineStageId || null;
        if (!stageId) {
          const neu = await tx.pipelineStage.findFirst({
            where: { slug: "new", isActive: true },
          });
          stageId = neu?.id ?? null;
        }
        const created = await tx.lead.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            source: parsed.data.source || null,
            pipelineStageId: stageId,
            notes: parsed.data.notes || null,
            ownerId: req.user!.id,
            status: "new",
          },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "lead",
          entityId: created.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
        });
        return created;
      });
      res.redirect(`/leads/${lead.id}`);
    } catch (error) {
      next(error);
    }
  },
);

leadsRouter.get(
  "/:id",
  requirePermission("leads.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const lead = await tx.lead.findFirst({
          where: { id: param(req, "id") },
          include: { pipelineStage: true, owner: true },
        });
        if (!lead) return null;
        const activity = await tx.activityEvent.findMany({
          where: { entityType: "lead", entityId: lead.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return { lead, activity };
      });
      if (!result) {
        res.status(404).render("errors/not-found", {
          title: "Lead not found",
          message: "Lead not found.",
          organization: req.organization,
          user: req.user,
        });
        return;
      }
      res.render("leads/show", {
        title: result.lead.name,
        organization: req.organization,
        user: req.user,
        lead: result.lead,
        activity: result.activity,
      });
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
        const before = await tx.lead.findFirst({ where: { id: param(req, "id") } });
        if (!before) throw new Error("Lead not found");
        const after = await tx.lead.update({
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
        const changes = diffFields(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          ["name", "email", "phone", "source", "status", "pipelineStageId", "notes"],
        );
        const action =
          before.status !== after.status ? "status_changed" : "updated";
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "lead",
          entityId: after.id,
          actorType: "user",
          actorId: req.user!.id,
          action,
          changes,
        });
      });
      res.redirect(`/leads/${param(req, "id")}`);
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
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "lead",
          entityId: lead.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "status_changed",
          changes: { status: { from: lead.status, to: "converted" } },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "customer",
          entityId: created.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
          changes: { leadId: { from: null, to: lead.id } },
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
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const stages = await tx.pipelineStage.findMany({ orderBy: { order: "asc" } });
        const lossReasons = await tx.lossReason.findMany({ orderBy: { sortOrder: "asc" } });
        return { stages, lossReasons };
      });
      res.render("leads/pipeline", {
        title: "Pipeline stages",
        organization: req.organization,
        user: req.user,
        stages: data.stages,
        lossReasons: data.lossReasons,
        error: typeof req.query.error === "string" ? req.query.error : null,
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
        const won = await tx.pipelineStage.findFirst({
          where: { slug: "won", isSystemMilestone: true },
        });
        const insertAt =
          won?.order ??
          ((await tx.pipelineStage.aggregate({ _max: { order: true } }))._max.order ?? 0) + 1;
        if (won) {
          await tx.$executeRaw`
            UPDATE "PipelineStage"
            SET "order" = "order" + 1
            WHERE "organizationId" = ${req.organizationId!}::uuid
              AND "order" >= ${insertAt}
          `;
        }
        await tx.pipelineStage.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            color: parsed.data.color || null,
            order: insertAt,
            isSystemMilestone: false,
          },
        });
      });
      res.redirect("/pipeline");
    } catch (error) {
      next(error);
    }
  },
);

pipelineRouter.post(
  "/:id/delete",
  requirePermission("pipeline.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const stage = await tx.pipelineStage.findFirst({ where: { id: param(req, "id") } });
        if (!stage) throw new Error("Stage not found");
        assertCanDeleteOrReorderStage(stage);
        await tx.lead.updateMany({
          where: { pipelineStageId: stage.id },
          data: { pipelineStageId: null },
        });
        await tx.pipelineStage.delete({ where: { id: stage.id } });
      });
      res.redirect("/pipeline");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed";
      res.redirect(`/pipeline?error=${encodeURIComponent(message)}`);
    }
  },
);

pipelineRouter.post(
  "/loss-reasons",
  requirePermission("pipeline.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(80),
        slug: z
          .string()
          .min(1)
          .max(40)
          .regex(/^[a-z0-9_]+$/)
          .optional()
          .or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/pipeline?error=1");
        return;
      }
      const slug =
        parsed.data.slug ||
        parsed.data.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const max = await tx.lossReason.aggregate({ _max: { sortOrder: true } });
        await tx.lossReason.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            slug,
            sortOrder: (max._max.sortOrder ?? 0) + 1,
          },
        });
      });
      res.redirect("/pipeline");
    } catch (error) {
      next(error);
    }
  },
);
