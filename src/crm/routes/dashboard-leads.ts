import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { notifyNewLeadPush } from "../../lib/push/notify.js";

export const dashboardLeadsRouter = Router();

type LeadMeta = {
  address?: string | null;
  zipcode?: string | null;
  priority?: string | null;
  estimated_value?: number | string | null;
  next_steps?: string | null;
  qualification?: Record<string, unknown> | null;
  interactions?: Array<Record<string, unknown>>;
  followups?: Array<Record<string, unknown>>;
  visits?: Array<Record<string, unknown>>;
};

function asMeta(raw: unknown): LeadMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as LeadMeta;
}

function mapLead(l: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  metadata?: unknown;
  pipelineStageId: string | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  pipelineStage?: { name: string; color: string | null; slug: string | null; isClosed: boolean } | null;
  owner?: { id: string; name: string; email: string } | null;
}) {
  const meta = asMeta(l.metadata);
  const statusSlug = l.pipelineStage?.slug || l.status;
  return {
    id: l.id,
    name: l.name,
    email: l.email,
    phone: l.phone,
    source: l.source,
    status: statusSlug,
    notes: l.notes,
    address: meta.address ?? null,
    zipcode: meta.zipcode ?? null,
    priority: meta.priority ?? "medium",
    estimated_value: meta.estimated_value ?? null,
    next_steps: meta.next_steps ?? null,
    next_steps_notes: meta.next_steps ?? null,
    pipeline_stage_id: l.pipelineStageId,
    pipeline_stage_name: l.pipelineStage?.name ?? null,
    pipeline_stage_color: l.pipelineStage?.color ?? null,
    pipeline_stage_slug: l.pipelineStage?.slug ?? null,
    owner_id: l.ownerId,
    owner_name: l.owner?.name ?? null,
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  };
}

const leadInclude = {
  pipelineStage: true,
  owner: { select: { id: true, name: true, email: true } },
} as const;

async function resolveStageBySlug(
  tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  slug: string,
) {
  if (!slug) return null;
  return tx.pipelineStage.findFirst({
    where: {
      isActive: true,
      OR: [{ slug }, { name: { equals: slug, mode: "insensitive" } }],
    },
  });
}

async function loadLeadOrNull(
  tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  id: string,
) {
  return tx.lead.findFirst({ where: { id }, include: leadInclude });
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

dashboardLeadsRouter.get("/api/leads/quote-engagement-summary", requireCrmAuth, async (_req: AuthedRequest, res, next) => {
  try {
    res.json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/leads/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lead = await withTenantTransaction(req.organizationId!, async (tx) =>
      loadLeadOrNull(tx, String(req.params.id)),
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

dashboardLeadsRouter.get("/api/leads/:id/qualification", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lead = await withTenantTransaction(req.organizationId!, async (tx) =>
      loadLeadOrNull(tx, String(req.params.id)),
    );
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    const qual = asMeta(lead.metadata).qualification || null;
    res.json({ success: true, data: qual });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.post("/api/leads/:id/qualification", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;
    const lead = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await loadLeadOrNull(tx, id);
      if (!existing) return null;
      const meta = asMeta(existing.metadata);
      meta.qualification = {
        property_type: body.property_type ?? null,
        service_type: body.service_type ?? null,
        estimated_area: body.estimated_area ?? null,
        estimated_budget: body.estimated_budget ?? null,
        urgency: body.urgency ?? "medium",
        decision_maker: body.decision_maker ?? null,
        decision_timeline: body.decision_timeline ?? null,
        payment_type: body.payment_type ?? null,
        address_street: body.address_street ?? null,
        address_line2: body.address_line2 ?? null,
        address_city: body.address_city ?? null,
        address_state: body.address_state ?? null,
        address_zip: body.address_zip ?? null,
        qualification_notes: body.qualification_notes ?? null,
        score: body.score ?? null,
        updated_at: new Date().toISOString(),
      };
      return tx.lead.update({
        where: { id },
        data: { metadata: meta as Prisma.InputJsonValue },
        include: leadInclude,
      });
    });
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true, data: asMeta(lead.metadata).qualification });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.put("/api/leads/:id/qualification", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;
    const lead = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await loadLeadOrNull(tx, id);
      if (!existing) return null;
      const meta = asMeta(existing.metadata);
      meta.qualification = {
        ...(typeof meta.qualification === "object" && meta.qualification ? meta.qualification : {}),
        property_type: body.property_type ?? null,
        service_type: body.service_type ?? null,
        estimated_area: body.estimated_area ?? null,
        estimated_budget: body.estimated_budget ?? null,
        urgency: body.urgency ?? "medium",
        decision_maker: body.decision_maker ?? null,
        decision_timeline: body.decision_timeline ?? null,
        payment_type: body.payment_type ?? null,
        address_street: body.address_street ?? null,
        address_line2: body.address_line2 ?? null,
        address_city: body.address_city ?? null,
        address_state: body.address_state ?? null,
        address_zip: body.address_zip ?? null,
        qualification_notes: body.qualification_notes ?? null,
        score: body.score ?? null,
        updated_at: new Date().toISOString(),
      };
      return tx.lead.update({
        where: { id },
        data: { metadata: meta as Prisma.InputJsonValue },
        include: leadInclude,
      });
    });
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true, data: asMeta(lead.metadata).qualification });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/leads/:id/interactions", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lead = await withTenantTransaction(req.organizationId!, async (tx) =>
      loadLeadOrNull(tx, String(req.params.id)),
    );
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true, data: asMeta(lead.metadata).interactions || [] });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.post("/api/leads/:id/interactions", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;
    const row = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await loadLeadOrNull(tx, id);
      if (!existing) return null;
      const meta = asMeta(existing.metadata);
      const list = Array.isArray(meta.interactions) ? meta.interactions : [];
      const item = {
        id: randomUUID(),
        type: String(body.type || "note"),
        subject: body.subject != null ? String(body.subject) : null,
        notes: body.notes != null ? String(body.notes) : null,
        user_id: req.user?.id || null,
        user_name: req.user?.name || req.user?.email || null,
        created_at: new Date().toISOString(),
      };
      list.unshift(item);
      meta.interactions = list;
      await tx.lead.update({
        where: { id },
        data: { metadata: meta as Prisma.InputJsonValue, lastContactedAt: new Date() },
      });
      return item;
    });
    if (!row) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/leads/:id/followups", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lead = await withTenantTransaction(req.organizationId!, async (tx) =>
      loadLeadOrNull(tx, String(req.params.id)),
    );
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true, data: asMeta(lead.metadata).followups || [] });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.post("/api/leads/:id/followups", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;
    const row = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await loadLeadOrNull(tx, id);
      if (!existing) return null;
      const meta = asMeta(existing.metadata);
      const list = Array.isArray(meta.followups) ? meta.followups : [];
      const item = {
        id: randomUUID(),
        title: String(body.title || "Follow-up"),
        description: body.description != null ? String(body.description) : null,
        due_date: body.due_date != null ? String(body.due_date) : null,
        priority: String(body.priority || "medium"),
        status: "pending",
        assigned_to: body.assigned_to || null,
        assigned_to_name: null,
        created_at: new Date().toISOString(),
      };
      list.unshift(item);
      meta.followups = list;
      await tx.lead.update({
        where: { id },
        data: { metadata: meta as Prisma.InputJsonValue },
      });
      return item;
    });
    if (!row) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/leads/:id/proposals", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const rows = await withTenantTransaction(req.organizationId!, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id }, select: { id: true } });
      if (!lead) return null;
      const customers = await tx.customer.findMany({ where: { leadId: id }, select: { id: true } });
      const customerIds = customers.map((c) => c.id);
      if (!customerIds.length) return [];
      const quotes = await tx.quote.findMany({
        where: {
          OR: [
            { leadId: id },
            ...(customerIds.length ? [{ customerId: { in: customerIds } }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return quotes.map((q) => ({
        id: q.id,
        title: q.title || `Quote #${q.number ?? q.id.slice(0, 8)}`,
        status: q.status,
        total: q.total != null ? Number(q.total) : null,
        created_at: q.createdAt.toISOString(),
        lead_id: id,
      }));
    });
    if (rows === null) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.get("/api/visits", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const leadId = req.query.lead_id ? String(req.query.lead_id) : null;
    const dateFrom = req.query.date_from ? String(req.query.date_from) : null;
    const dateTo = req.query.date_to ? String(req.query.date_to) : null;
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo + (dateTo.length <= 10 ? "T23:59:59" : "")).getTime() : null;

    const inRange = (v: Record<string, unknown>) => {
      if (fromTs == null && toTs == null) return true;
      const raw = v.scheduled_at != null ? String(v.scheduled_at) : "";
      if (!raw) return false;
      const t = new Date(raw).getTime();
      if (Number.isNaN(t)) return false;
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
      return true;
    };

    if (leadId) {
      const lead = await withTenantTransaction(req.organizationId!, async (tx) =>
        loadLeadOrNull(tx, leadId),
      );
      if (!lead) {
        res.json({ success: true, data: [] });
        return;
      }
      const visits = (asMeta(lead.metadata).visits || []).filter(
        (v) => v && typeof v === "object" && inRange(v as Record<string, unknown>),
      );
      res.json({ success: true, data: visits });
      return;
    }

    const visits = await withTenantTransaction(req.organizationId!, async (tx) => {
      const leads = await tx.lead.findMany({
        take: 2000,
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, metadata: true },
      });
      const out: Array<Record<string, unknown>> = [];
      for (const lead of leads) {
        const list = asMeta(lead.metadata).visits || [];
        for (const v of list) {
          if (!v || typeof v !== "object") continue;
          const row = v as Record<string, unknown>;
          if (!inRange(row)) continue;
          out.push({
            ...row,
            lead_id: row.lead_id || lead.id,
            lead_name: row.lead_name || lead.name,
          });
        }
      }
      out.sort((a, b) => {
        const ta = a.scheduled_at ? new Date(String(a.scheduled_at)).getTime() : 0;
        const tb = b.scheduled_at ? new Date(String(b.scheduled_at)).getTime() : 0;
        return ta - tb;
      });
      return out;
    });
    res.json({ success: true, data: visits });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.post("/api/visits", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const leadId = body.lead_id != null ? String(body.lead_id) : "";
    if (!leadId) {
      res.status(400).json({ success: false, error: "lead_id required" });
      return;
    }
    const result = await withTenantTransaction(req.organizationId!, async (tx) => {
      const existing = await loadLeadOrNull(tx, leadId);
      if (!existing) return null;
      const meta = asMeta(existing.metadata);
      const list = Array.isArray(meta.visits) ? meta.visits : [];
      const addr =
        [body.address_line1, body.address_line2, body.city, body.zipcode].filter(Boolean).join(", ") ||
        (body.address != null ? String(body.address) : null);

      const scheduledRaw = body.scheduled_at != null ? String(body.scheduled_at) : "";
      const start = scheduledRaw ? new Date(scheduledRaw) : null;
      const end =
        start && !Number.isNaN(start.getTime())
          ? new Date(start.getTime() + 60 * 60 * 1000)
          : null;

      let assigneeId: string | null =
        body.seller_id != null && String(body.seller_id).trim()
          ? String(body.seller_id).trim()
          : body.assigned_to != null && String(body.assigned_to).trim()
            ? String(body.assigned_to).trim()
            : null;
      if (assigneeId) {
        const userOk = await tx.user.findFirst({
          where: { id: assigneeId, organizationId: req.organizationId! },
          select: { id: true },
        });
        if (!userOk) assigneeId = null;
      }

      let meetingId: string | null = null;
      if (start && end && !Number.isNaN(start.getTime())) {
        const meeting = await tx.meeting.create({
          data: {
            organizationId: req.organizationId!,
            title: `Visit — ${existing.name}`,
            status: "scheduled",
            scheduledStart: start,
            scheduledEnd: end,
            location: addr ? String(addr) : null,
            notes: body.notes != null ? String(body.notes) : null,
            assignedUserId: assigneeId,
          },
        });
        meetingId = meeting.id;
      }

      const item = {
        id: randomUUID(),
        lead_id: leadId,
        lead_name: existing.name,
        scheduled_at: start && !Number.isNaN(start.getTime()) ? start.toISOString() : scheduledRaw || null,
        address: addr,
        address_line1: body.address_line1 != null ? String(body.address_line1) : null,
        address_line2: body.address_line2 != null ? String(body.address_line2) : null,
        city: body.city != null ? String(body.city) : null,
        zipcode: body.zipcode != null ? String(body.zipcode) : null,
        notes: body.notes != null ? String(body.notes) : null,
        seller_id: assigneeId,
        assigned_to_name: null as string | null,
        status: String(body.status || "scheduled"),
        meeting_id: meetingId,
        created_at: new Date().toISOString(),
      };
      list.unshift(item);
      meta.visits = list;
      const meetingStage = await resolveStageBySlug(tx, "meeting_scheduled");
      await tx.lead.update({
        where: { id: leadId },
        data: {
          metadata: meta as Prisma.InputJsonValue,
          ...(meetingStage
            ? { pipelineStageId: meetingStage.id, status: meetingStage.slug || "meeting_scheduled" }
            : {}),
        },
      });
      const updatedLead = await loadLeadOrNull(tx, leadId);
      return {
        visit: item,
        lead: updatedLead ? mapLead(updatedLead) : null,
      };
    });
    if (!result) {
      res.status(404).json({ success: false, error: "Lead not found" });
      return;
    }
    res.status(201).json({ success: true, data: result.visit, lead: result.lead });
  } catch (error) {
    next(error);
  }
});

dashboardLeadsRouter.put("/api/visits/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const visitId = String(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;
    const leadId = body.lead_id != null ? String(body.lead_id) : null;
    const updated = await withTenantTransaction(req.organizationId!, async (tx) => {
      const leads = await tx.lead.findMany({ take: 500, orderBy: { updatedAt: "desc" } });
      for (const lead of leads) {
        const meta = asMeta(lead.metadata);
        const list = Array.isArray(meta.visits) ? meta.visits : [];
        const idx = list.findIndex((v) => String(v.id) === visitId);
        if (idx < 0) continue;
        if (leadId && lead.id !== leadId) continue;
        list[idx] = { ...list[idx], ...body, id: visitId, updated_at: new Date().toISOString() };
        meta.visits = list;
        await tx.lead.update({
          where: { id: lead.id },
          data: { metadata: meta as Prisma.InputJsonValue },
        });
        return list[idx];
      }
      return null;
    });
    if (!updated) {
      res.status(404).json({ success: false, error: "Visit not found" });
      return;
    }
    res.json({ success: true, data: updated });
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

      let pipelineStageId: string | null | undefined =
        body.pipeline_stage_id !== undefined
          ? body.pipeline_stage_id
            ? String(body.pipeline_stage_id)
            : null
          : undefined;
      let status: string | undefined = body.status !== undefined ? String(body.status) : undefined;

      if (pipelineStageId === undefined && status) {
        const stage = await resolveStageBySlug(tx, status);
        if (stage) {
          pipelineStageId = stage.id;
          status = stage.slug || status;
        }
      } else if (pipelineStageId) {
        const stage = await tx.pipelineStage.findFirst({ where: { id: pipelineStageId } });
        if (stage?.slug) status = stage.slug;
      }

      const meta = asMeta(existing.metadata);
      let metaChanged = false;
      for (const key of ["address", "zipcode", "priority", "estimated_value", "next_steps"] as const) {
        if (body[key] !== undefined) {
          (meta as Record<string, unknown>)[key] = body[key] === "" || body[key] == null ? null : body[key];
          metaChanged = true;
        }
      }

      return tx.lead.update({
        where: { id },
        data: {
          name: body.name !== undefined ? String(body.name) : undefined,
          email: body.email !== undefined ? String(body.email || "") || null : undefined,
          phone: body.phone !== undefined ? String(body.phone || "") || null : undefined,
          source: body.source !== undefined ? String(body.source || "") || null : undefined,
          notes: body.notes !== undefined ? String(body.notes || "") || null : undefined,
          status,
          pipelineStageId,
          ownerId:
            body.owner_id !== undefined ? (body.owner_id ? String(body.owner_id) : null) : undefined,
          ...(metaChanged ? { metadata: meta as Prisma.InputJsonValue } : {}),
        },
        include: leadInclude,
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
