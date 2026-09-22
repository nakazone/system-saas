import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { withTenantTransaction } from "../lib/tenant/prisma-tenant.js";

/**
 * Minimal SF-compatible APIs so the vendored CRM UI can boot against SaaS data.
 * Expand toward full senior-floors-system route parity in later phases.
 */
export const crmApiRouter = Router();

function requireOrg(req: AuthedRequest, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (!req.organizationId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return false;
  }
  return true;
}

crmApiRouter.get("/api/pipeline-stages", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!requireOrg(req, res)) return;
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
        slug: s.name.toLowerCase().replace(/\s+/g, "_"),
        order_num: s.order,
        color: s.color,
        is_closed: 0,
        is_active: s.isActive ? 1 : 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});

crmApiRouter.get("/api/leads", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!requireOrg(req, res)) return;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, leads] = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where = {};
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
      data: leads.map((l) => ({
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
        owner_id: l.ownerId,
        owner_name: l.owner?.name ?? null,
        created_at: l.createdAt,
        updated_at: l.updatedAt,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
});

crmApiRouter.get("/api/leads/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!requireOrg(req, res)) return;
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
    res.json({
      success: true,
      data: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        status: lead.status,
        notes: lead.notes,
        pipeline_stage_id: lead.pipelineStageId,
        pipeline_stage_name: lead.pipelineStage?.name ?? null,
        owner_id: lead.ownerId,
        owner_name: lead.owner?.name ?? null,
        created_at: lead.createdAt,
        updated_at: lead.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

crmApiRouter.post("/api/leads", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!requireOrg(req, res)) return;
    const parsed = z
      .object({
        name: z.string().min(1),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        source: z.string().optional(),
        notes: z.string().optional(),
        status: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid lead payload" });
      return;
    }

    const lead = await withTenantTransaction(req.organizationId!, async (tx) => {
      const firstStage = await tx.pipelineStage.findFirst({
        where: { isActive: true },
        orderBy: { order: "asc" },
      });
      return tx.lead.create({
        data: {
          organizationId: req.organizationId!,
          name: parsed.data.name,
          email: parsed.data.email || null,
          phone: parsed.data.phone || null,
          source: parsed.data.source || null,
          notes: parsed.data.notes || null,
          status: parsed.data.status || "new",
          pipelineStageId: firstStage?.id ?? null,
          ownerId: req.user?.id ?? null,
        },
      });
    });

    res.status(201).json({ success: true, data: lead, lead_id: lead.id });
  } catch (error) {
    next(error);
  }
});

crmApiRouter.get("/api/dashboard/stats", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!requireOrg(req, res)) return;
    const stats = await withTenantTransaction(req.organizationId!, async (tx) => {
      const [leadsTotal, customersTotal, quotesTotal, stages] = await Promise.all([
        tx.lead.count(),
        tx.customer.count(),
        tx.quote.count(),
        tx.pipelineStage.findMany({
          where: { isActive: true },
          orderBy: { order: "asc" },
          include: { _count: { select: { leads: true } } },
        }),
      ]);
      return { leadsTotal, customersTotal, quotesTotal, stages };
    });

    res.json({
      success: true,
      period: String(req.query.period || "overall"),
      data: {
        leads_total: stats.leadsTotal,
        customers_total: stats.customersTotal,
        quotes_total: stats.quotesTotal,
        leads_by_stage: stats.stages.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          count: s._count.leads,
        })),
        // Placeholders until full SF dashboard port
        revenue_projected: 0,
        conversion_rate: 0,
      },
    });
  } catch (error) {
    next(error);
  }
});
