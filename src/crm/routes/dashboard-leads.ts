import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { notifyNewLeadPush } from "../../lib/push/notify.js";

export const dashboardLeadsRouter = Router();

function mapLead(l: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  pipelineStageId: string | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  pipelineStage?: { name: string; color: string | null; slug: string | null; isClosed: boolean } | null;
  owner?: { id: string; name: string; email: string } | null;
}) {
  return {
    id: l.id,
    name: l.name,
    email: l.email,
    phone: l.phone,
    source: l.source,
    status: l.status,
    notes: l.notes,
    pipeline_stage_id: l.pipelineStageId,
    pipeline_stage_name: l.pipelineStage?.name ?? null,
    pipeline_stage_color: l.pipelineStage?.color ?? null,
    pipeline_stage_slug: l.pipelineStage?.slug ?? null,
    owner_id: l.ownerId,
    owner_name: l.owner?.name ?? null,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

dashboardLeadsRouter.get("/api/pipeline-stages", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const stages = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.pipelineStage.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
      }),
    );
    res.json({
      success: true,
      data: stages.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug || s.name.toLowerCase().replace(/\s+/g, "_"),
        order_num: s.order,
        color: s.color,
        is_closed: s.isClosed ? 1 : 0,
        is_active: s.isActive ? 1 : 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/leads", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const stageId = req.query.pipeline_stage_id ? String(req.query.pipeline_stage_id) : null;
    const search = String(req.query.q || req.query.search || "").trim();

    const [total, leads] = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where: Prisma.LeadWhereInput = {};
      if (stageId) where.pipelineStageId = stageId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ];
      }
      const count = await tx.lead.count({ where });
      const rows = await tx.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { pipelineStage: true, owner: { select: { id: true, name: true, email: true } } },
      });
      return [count, rows] as const;
    });

    res.json({
      success: true,
      data: leads.map(mapLead),
      total,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/leads/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lead = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.lead.findFirst({
        where: { id: String(req.params.id) },
        include: { pipelineStage: true, owner: { select: { id: true, name: true, email: true } } },
      }),
    );
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true, data: mapLead(lead) });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.post("/api/leads", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const emptyToUndef = (v: unknown) =>
      v === null || v === undefined || v === "" || v === "null" ? undefined : v;

    const parsed = z
      .object({
        name: z.string().min(1),
        email: z.preprocess(
          emptyToUndef,
          z.string().email().optional(),
        ),
        phone: z.preprocess(emptyToUndef, z.string().optional()),
        source: z.preprocess(emptyToUndef, z.string().optional()),
        notes: z.preprocess(emptyToUndef, z.string().optional()),
        status: z.preprocess(emptyToUndef, z.string().optional()),
        zipcode: z.preprocess(emptyToUndef, z.string().optional()),
        message: z.preprocess(emptyToUndef, z.string().optional()),
        priority: z.preprocess(emptyToUndef, z.string().optional()),
        estimated_value: z.preprocess(
          (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v),
          z.union([z.number(), z.string()]).optional(),
        ),
        pipeline_stage_id: z.preprocess(
          emptyToUndef,
          z.string().uuid().optional(),
        ),
        owner_id: z.preprocess(emptyToUndef, z.string().uuid().optional()),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Invalid lead payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    const noteParts = [parsed.data.notes, parsed.data.message, parsed.data.zipcode ? `CEP: ${parsed.data.zipcode}` : null]
      .filter(Boolean)
      .map(String);
    const notesMerged = noteParts.length ? noteParts.join("\n") : null;

    const lead = await withTenantTransaction(req.organizationId!, async (tx) => {
      let stageId = parsed.data.pipeline_stage_id ?? null;
      if (!stageId) {
        const firstStage = await tx.pipelineStage.findFirst({
          where: { isActive: true },
          orderBy: { order: "asc" },
        });
        stageId = firstStage?.id ?? null;
      }
      return tx.lead.create({
        data: {
          organizationId: req.organizationId!,
          name: parsed.data.name.trim(),
          email: parsed.data.email || null,
          phone: parsed.data.phone || null,
          source: parsed.data.source || null,
          notes: notesMerged,
          status: parsed.data.status || "new",
          pipelineStageId: stageId,
          ownerId: parsed.data.owner_id ?? req.user?.id ?? null,
        },
        include: { pipelineStage: true, owner: { select: { id: true, name: true, email: true } } },
      });
    });

    notifyNewLeadPush(
      req.organizationId!,
      { id: lead.id, name: lead.name },
      { excludeUserId: req.user?.id },
    );

    res.status(201).json({ success: true, data: mapLead(lead), lead_id: lead.id });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.put("/api/leads/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const body = req.body || {};
    const lead = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await tx.lead.findFirst({ where: { id } });
      if (!existing) return null;
      return tx.lead.update({
        where: { id },
        data: {
          name: body.name !== undefined ? String(body.name) : undefined,
          email: body.email !== undefined ? String(body.email || "") || null : undefined,
          phone: body.phone !== undefined ? String(body.phone || "") || null : undefined,
          source: body.source !== undefined ? String(body.source || "") || null : undefined,
          notes: body.notes !== undefined ? String(body.notes || "") || null : undefined,
          status: body.status !== undefined ? String(body.status) : undefined,
          pipelineStageId:
            body.pipeline_stage_id !== undefined
              ? body.pipeline_stage_id
                ? String(body.pipeline_stage_id)
                : null
              : undefined,
          ownerId:
            body.owner_id !== undefined ? (body.owner_id ? String(body.owner_id) : null) : undefined,
        },
        include: { pipelineStage: true, owner: { select: { id: true, name: true, email: true } } },
      });
    });
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true, data: mapLead(lead) });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.delete("/api/leads/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await tx.lead.findFirst({ where: { id } });
      if (!existing) return false;
      await tx.lead.delete({ where: { id } });
      return true;
    });
    if (!ok) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/dashboard/stats", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const period = String(req.query.period || "month").toLowerCase();
    const stats = await withTenantTransaction(req.organizationId!, async (tx) => {
      const now = new Date();
      let since: Date | null = null;
      if (period === "today") {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === "week") {
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === "overall") {
        since = null;
      } else {
        since = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      const leadWhere = since ? { createdAt: { gte: since } } : {};
      const quoteWhere = since ? { createdAt: { gte: since } } : {};

      const [
        leadsTotal,
        leadsNewToday,
        customersTotal,
        quotesTotal,
        quotesAccepted,
        quoteSum,
        stages,
        recentLeads,
        orphanLeads,
        wonStage,
        lostStage,
      ] = await Promise.all([
        tx.lead.count({ where: leadWhere }),
        tx.lead.count({
          where: {
            createdAt: {
              gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            },
          },
        }),
        tx.customer.count(),
        tx.quote.count({ where: quoteWhere }),
        tx.quote.count({ where: { ...quoteWhere, status: { in: ["accepted", "invoiced"] } } }),
        tx.quote.aggregate({
          where: { status: { in: ["accepted", "invoiced", "sent"] } },
          _sum: { total: true },
        }),
        tx.pipelineStage.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
          include: { _count: { select: { leads: true } } },
        }),
        tx.lead.findMany({
          take: 8,
          orderBy: { createdAt: "desc" },
          include: { pipelineStage: true },
        }),
        tx.lead.count({ where: { pipelineStageId: null } }),
        tx.pipelineStage.findFirst({ where: { OR: [{ slug: "won" }, { slug: "closed_won" }] } }),
        tx.pipelineStage.findFirst({ where: { OR: [{ slug: "lost" }, { slug: "closed_lost" }] } }),
      ]);

      const closedWon = wonStage
        ? await tx.lead.count({ where: { pipelineStageId: wonStage.id } })
        : 0;
      const closedLost = lostStage
        ? await tx.lead.count({ where: { pipelineStageId: lostStage.id } })
        : 0;

      const firstStage = stages[0];
      const urgentLeads = firstStage
        ? await tx.lead.findMany({
            where: {
              pipelineStageId: firstStage.id,
              createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            },
            take: 20,
            orderBy: { createdAt: "desc" },
          })
        : [];

      return {
        leadsTotal,
        leadsNewToday,
        customersTotal,
        quotesTotal,
        quotesAccepted,
        quoteSum: dec(quoteSum._sum.total),
        stages,
        recentLeads,
        orphanLeads,
        closedWon,
        closedLost,
        urgentLeads,
      };
    });

    const pipelineFunnel = stats.stages.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      color: s.color,
      count: s._count.leads,
    }));

    res.json({
      success: true,
      period,
      generated_at: new Date().toISOString(),
      pipeline: {
        leads_received: stats.leadsTotal,
        leads_new_today: stats.leadsNewToday,
        contact_pending: 0,
        visits_scheduled: 0,
        visits_completed: 0,
        visits_today: 0,
        leads_in_proposal: 0,
        proposals_sent: stats.quotesTotal,
        proposals_open_count: Math.max(0, stats.quotesTotal - stats.quotesAccepted),
        proposals_open_value: 0,
        closed_won_count: stats.closedWon,
        closed_won_value: stats.quoteSum,
        closed_lost_count: stats.closedLost,
        in_production: 0,
        followups_pending: 0,
        followups_overdue: 0,
        followups_due_today: 0,
        customers_total: stats.customersTotal,
      },
      conversion: {
        lead_to_visit_rate: 0,
        visit_to_proposal_rate: 0,
        proposal_win_rate:
          stats.closedWon + stats.closedLost > 0
            ? Math.round((stats.closedWon / (stats.closedWon + stats.closedLost)) * 1000) / 10
            : 0,
        proposal_wins: stats.closedWon,
        proposal_losses: stats.closedLost,
        avg_deal_value:
          stats.quotesAccepted > 0
            ? Math.round((stats.quoteSum / stats.quotesAccepted) * 100) / 100
            : 0,
        avg_ticket_quotes_count: stats.quotesAccepted,
        avg_ticket_quotes_total: stats.quoteSum,
      },
      financial: {
        revenue_month: stats.quoteSum,
        revenue_projected: stats.quoteSum,
        expenses_month: 0,
        profit_month: stats.quoteSum,
        avg_margin: 0,
      },
      alerts: [],
      recent_leads: stats.recentLeads.map((l) => ({
        id: l.id,
        name: l.name,
        pipeline_stage: l.pipelineStage?.name || "—",
        stage_id: l.pipelineStageId,
        slug: l.pipelineStage?.slug,
        source: l.source || "—",
        created_at: l.createdAt,
      })),
      pipeline_funnel: pipelineFunnel,
      orphan_leads_count: stats.orphanLeads,
      charts: { funnel: pipelineFunnel },
      visits_today_detail: [],
      new_leads_urgent: stats.urgentLeads.map((l) => ({
        id: l.id,
        name: l.name,
        created_at: l.createdAt,
      })),
      new_leads_urgent_count: stats.urgentLeads.length,
      upcoming_visits: [],
    });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get(
  "/api/dashboard/fix-orphan-leads",
  requireCrmAuth,
  requireCrmPermission("leads.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const stage =
          (await tx.pipelineStage.findFirst({
            where: { OR: [{ slug: "new_lead" }, { slug: "lead_received" }] },
            orderBy: { order: "asc" },
          })) ||
          (await tx.pipelineStage.findFirst({ where: { isActive: true }, orderBy: { order: "asc" } }));
        if (!stage) return { stageId: null as string | null, updated: 0 };
        const orphans = await tx.lead.findMany({ where: { pipelineStageId: null }, select: { id: true } });
        if (orphans.length) {
          await tx.lead.updateMany({
            where: { pipelineStageId: null },
            data: { pipelineStageId: stage.id },
          });
        }
        return { stageId: stage.id, updated: orphans.length };
      });
      if (!result.stageId) {
        res.status(400).json({ success: false, error: "No pipeline stage found" });
        return;
      }
      res.json({
        success: true,
        pipeline_stage_id: result.stageId,
        updated: result.updated,
      });
    } catch (error) {
      next(error);
    }
  },
);
