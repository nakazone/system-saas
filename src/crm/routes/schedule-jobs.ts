import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { findScheduleConflicts } from "../../lib/schedule/conflicts.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { issuePublicAccessToken } from "../../lib/quotes/public-token.js";
import { notifyJobTeamPush } from "../../lib/push/notify.js";
import { param } from "../../lib/http/params.js";
import { env } from "../../config/env.js";
import { myJobAccessWhere } from "../lib/campo-shared.js";

export const scheduleJobsRouter = Router();

const OFFICE_SEE_ALL_ROLES = new Set([
  "admin",
  "general_manager",
  "office",
  "sales",
]);

/**
 * Field / employee roles only see jobs they are on.
 * Installer & crew_lead always scoped (even if role still has *.manage).
 * Others: scoped unless they have work_orders.manage or schedule.manage.
 */
function shouldScopeJobsToSelf(user: AuthedRequest["user"]): boolean {
  if (!user?.id) return false;
  const role = String(user.roleKey || "").toLowerCase();
  if (role === "installer" || role === "crew_lead") return true;
  if (OFFICE_SEE_ALL_ROLES.has(role)) return false;
  const perms = user.permissions || [];
  // Custom roles: only org-wide managers see the full schedule/jobs board
  if (perms.includes("work_orders.manage") || perms.includes("schedule.manage")) {
    return false;
  }
  return (
    perms.includes("work_orders.view") ||
    perms.includes("schedule.view") ||
    perms.includes("payroll.self")
  );
}

/** Own jobs: assignee, job members, or job's crew. */
function fieldWorkOrderScope(user: AuthedRequest["user"]): Record<string, unknown> {
  if (!shouldScopeJobsToSelf(user)) return {};
  return myJobAccessWhere(user!.id);
}

/** Own meetings: assigned to the logged-in user. */
function fieldMeetingScope(user: AuthedRequest["user"]): Record<string, unknown> {
  if (!shouldScopeJobsToSelf(user) || !user?.id) return {};
  return { assignedUserId: user.id };
}

function publicJobShareUrl(req: AuthedRequest, rawToken: string): string {
  const base = (env.APP_BASE_URL || "").replace(/\/$/, "");
  if (base) return `${base}/public/jobs/${rawToken}`;
  const proto =
    (typeof req.get === "function" && (req.get("x-forwarded-proto") || "").split(",")[0]?.trim()) ||
    req.protocol ||
    "https";
  const host = req.get("host") || "localhost";
  return `${proto}://${host}/public/jobs/${rawToken}`;
}

function normalizePhoneForWhatsApp(phone: string | null | undefined): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  // US local 10-digit → E.164 without +
  if (digits.length === 10) digits = `1${digits}`;
  return digits;
}

const WO_STATUSES = ["draft", "scheduled", "in_progress", "completed", "canceled"] as const;
const WO_SOURCES = ["builder", "contractor", "internal", "other"] as const;
const MTG_STATUSES = ["scheduled", "completed", "canceled"] as const;

async function nextWorkOrderNumber(organizationId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
      VALUES (gen_random_uuid(), ${organizationId}::uuid, 'work_order', 1)
      ON CONFLICT ("organizationId", "kind") DO NOTHING
    `;
    const rows = await tx.$queryRaw<{ nextValue: number }[]>`
      SELECT "nextValue" FROM "DocumentSequence"
      WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
      FOR UPDATE
    `;
    const current = rows[0]?.nextValue ?? 1;
    await tx.$executeRaw`
      UPDATE "DocumentSequence"
      SET "nextValue" = ${current + 1}
      WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
    `;
    return current;
  });
}

function mapWorkOrder(wo: {
  id: string;
  number: number | null;
  title: string;
  status: string;
  sourceType: string;
  sourceName: string | null;
  customerId: string | null;
  builderId: string | null;
  address: string | null;
  notes: string | null;
  assignedUserId: string | null;
  crewId: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer?: { id: string; name: string; email?: string | null; phone?: string | null } | null;
  builder?: { id: string; firstName: string; lastName: string; company: string | null } | null;
  assignedUser?: { id: string; name: string } | null;
  crew?: { id: string; name: string; color: string | null } | null;
  members?: { userId: string; user: { id: string; name: string; email: string } }[];
  tempWorkers?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
    createdAt: Date;
  }[];
  lineItems?: {
    id: string;
    pricingItemId: string | null;
    serviceName: string;
    quantitySqft: unknown;
    unitPrice: unknown;
    lineTotal: unknown;
    sortOrder: number;
  }[];
}) {
  const lineItems = (wo.lineItems || []).map((li) => ({
    id: li.id,
    pricing_item_id: li.pricingItemId,
    service_name: li.serviceName,
    quantity_sqft: dec(li.quantitySqft),
    unit_price: dec(li.unitPrice),
    line_total: dec(li.lineTotal),
    sort_order: li.sortOrder,
  }));
  const services_total = lineItems.reduce((sum, li) => sum + li.line_total, 0);
  return {
    id: wo.id,
    number: wo.number,
    title: wo.title,
    status: wo.status,
    source_type: wo.sourceType,
    source_name: wo.sourceName,
    customer_id: wo.customerId,
    builder_id: wo.builderId,
    address: wo.address,
    notes: wo.notes,
    assigned_user_id: wo.assignedUserId,
    crew_id: wo.crewId,
    scheduled_start: wo.scheduledStart?.toISOString() ?? null,
    scheduled_end: wo.scheduledEnd?.toISOString() ?? null,
    created_at: wo.createdAt.toISOString(),
    updated_at: wo.updatedAt.toISOString(),
    customer: wo.customer
      ? {
          id: wo.customer.id,
          name: wo.customer.name,
          email: wo.customer.email ?? null,
          phone: wo.customer.phone ?? null,
        }
      : null,
    builder: wo.builder
      ? {
          id: wo.builder.id,
          name: [wo.builder.firstName, wo.builder.lastName].filter(Boolean).join(" ").trim(),
          company: wo.builder.company,
        }
      : null,
    assigned_user: wo.assignedUser
      ? { id: wo.assignedUser.id, name: wo.assignedUser.name }
      : null,
    crew: wo.crew
      ? { id: wo.crew.id, name: wo.crew.name, color: wo.crew.color }
      : null,
    members: (wo.members || []).map((m) => ({
      user_id: m.user.id,
      name: m.user.name,
      email: m.user.email,
    })),
    temp_workers: (wo.tempWorkers || []).map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      email: t.email,
      notes: t.notes,
      created_at: t.createdAt.toISOString(),
    })),
    line_items: lineItems,
    services_total,
  };
}

function mapMeeting(m: {
  id: string;
  title: string;
  status: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  location: string | null;
  notes: string | null;
  customerId: string | null;
  assignedUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer?: { id: string; name: string } | null;
  assignedUser?: { id: string; name: string } | null;
}) {
  return {
    id: m.id,
    title: m.title,
    status: m.status,
    scheduled_start: m.scheduledStart.toISOString(),
    scheduled_end: m.scheduledEnd.toISOString(),
    location: m.location,
    notes: m.notes,
    customer_id: m.customerId,
    assigned_user_id: m.assignedUserId,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
    customer: m.customer ? { id: m.customer.id, name: m.customer.name } : null,
    assigned_user: m.assignedUser
      ? { id: m.assignedUser.id, name: m.assignedUser.name }
      : null,
  };
}

const woInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  builder: { select: { id: true, firstName: true, lastName: true, company: true } },
  assignedUser: { select: { id: true, name: true } },
  crew: { select: { id: true, name: true, color: true } },
  members: {
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  tempWorkers: { orderBy: { createdAt: "asc" as const } },
  lineItems: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
};

const lineItemBody = z.object({
  pricing_item_id: z.string().uuid().optional().nullable(),
  service_name: z.string().min(1).max(200),
  quantity_sqft: z.number().min(0).max(1_000_000),
  unit_price: z.number().min(0).max(1_000_000),
});

async function syncWorkOrderMembers(
  organizationId: string,
  workOrderId: string,
  userIds: string[] | undefined,
): Promise<void> {
  if (userIds === undefined) return;
  const unique = [...new Set(userIds.map(String).filter(Boolean))];
  if (unique.length) {
    const valid = await prisma.user.findMany({
      where: { organizationId, id: { in: unique }, status: { not: "disabled" } },
      select: { id: true },
    });
    const validIds = new Set(valid.map((u) => u.id));
    const filtered = unique.filter((id) => validIds.has(id));
    await prisma.workOrderMember.deleteMany({ where: { workOrderId } });
    if (filtered.length) {
      await prisma.workOrderMember.createMany({
        data: filtered.map((userId) => ({ organizationId, workOrderId, userId })),
        skipDuplicates: true,
      });
    }
    return;
  }
  await prisma.workOrderMember.deleteMany({ where: { workOrderId } });
}

async function syncWorkOrderLineItems(
  organizationId: string,
  workOrderId: string,
  items: z.infer<typeof lineItemBody>[] | undefined,
): Promise<void> {
  if (items === undefined) return;
  await prisma.workOrderLineItem.deleteMany({ where: { workOrderId } });
  if (!items.length) return;
  const pricingIds = [
    ...new Set(items.map((i) => i.pricing_item_id).filter((id): id is string => Boolean(id))),
  ];
  const validPricing = pricingIds.length
    ? await prisma.pricingItem.findMany({
        where: { organizationId, id: { in: pricingIds } },
        select: { id: true },
      })
    : [];
  const validSet = new Set(validPricing.map((p) => p.id));
  await prisma.workOrderLineItem.createMany({
    data: items.map((item, idx) => {
      const qty = Number(item.quantity_sqft) || 0;
      const price = Number(item.unit_price) || 0;
      const pid = item.pricing_item_id && validSet.has(item.pricing_item_id) ? item.pricing_item_id : null;
      return {
        organizationId,
        workOrderId,
        pricingItemId: pid,
        serviceName: item.service_name.trim(),
        quantitySqft: new Prisma.Decimal(qty),
        unitPrice: new Prisma.Decimal(price),
        lineTotal: new Prisma.Decimal(Math.round(qty * price * 100) / 100),
        sortOrder: idx,
      };
    }),
  });
}

function teamUserIdsFromWorkOrder(wo: {
  assignedUserId: string | null;
  members?: { userId: string }[];
}): string[] {
  const ids = new Set<string>();
  if (wo.assignedUserId) ids.add(wo.assignedUserId);
  for (const m of wo.members || []) ids.add(m.userId);
  return [...ids];
}

const mtgInclude = {
  customer: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, name: true } },
} as const;

async function collectConflictHints(params: {
  organizationId: string;
  id?: string;
  scheduledStart: Date | null | undefined;
  scheduledEnd: Date | null | undefined;
  assignedUserId?: string | null;
  crewId?: string | null;
  kind: "work_order" | "meeting";
}) {
  if (!params.scheduledStart || !params.scheduledEnd) return [];
  const [workOrders, meetings] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        organizationId: params.organizationId,
        status: { not: "canceled" },
        scheduledStart: { not: null },
        scheduledEnd: { not: null },
      },
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        assignedUserId: true,
        crewId: true,
        status: true,
      },
    }),
    prisma.meeting.findMany({
      where: {
        organizationId: params.organizationId,
        status: { not: "canceled" },
      },
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        assignedUserId: true,
        status: true,
      },
    }),
  ]);

  const existing = [
    ...workOrders
      .filter((w) => w.scheduledStart && w.scheduledEnd)
      .map((w) => ({
        id: w.id,
        start: w.scheduledStart!,
        end: w.scheduledEnd!,
        assignedUserId: w.assignedUserId,
        crewId: w.crewId,
        status: w.status,
      })),
    ...meetings.map((m) => ({
      id: m.id,
      start: m.scheduledStart,
      end: m.scheduledEnd,
      assignedUserId: m.assignedUserId,
      crewId: null as string | null,
      status: m.status,
    })),
  ];

  return findScheduleConflicts(
    {
      id: params.id,
      start: params.scheduledStart,
      end: params.scheduledEnd,
      assignedUserId: params.assignedUserId,
      crewId: params.crewId,
    },
    existing,
  );
}

// ---------- Work orders ----------

scheduleJobsRouter.get(
  "/api/work-orders",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const source = typeof req.query.source === "string" ? req.query.source : "";
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

      const fieldScope = fieldWorkOrderScope(req.user);
      const searchOr = q
        ? [
            { title: { contains: q, mode: "insensitive" as const } },
            { sourceName: { contains: q, mode: "insensitive" as const } },
            { address: { contains: q, mode: "insensitive" as const } },
          ]
        : null;

      const rows = await prisma.workOrder.findMany({
        where: {
          organizationId: req.organizationId!,
          ...(status && WO_STATUSES.includes(status as (typeof WO_STATUSES)[number])
            ? { status }
            : {}),
          ...(source && WO_SOURCES.includes(source as (typeof WO_SOURCES)[number])
            ? { sourceType: source }
            : {}),
          ...(from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())
            ? {
                scheduledStart: { lte: to },
                scheduledEnd: { gte: from },
              }
            : {}),
          ...(Object.keys(fieldScope).length || searchOr
            ? {
                AND: [
                  ...(Object.keys(fieldScope).length ? [fieldScope] : []),
                  ...(searchOr ? [{ OR: searchOr }] : []),
                ],
              }
            : {}),
        },
        include: woInclude,
        orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
        take: 200,
      });
      res.json({ success: true, data: rows.map(mapWorkOrder) });
    } catch (error) {
      next(error);
    }
  },
);

/** Loja / partner pricing catalog for job service lines. */
scheduleJobsRouter.get(
  "/api/work-orders/pricing-catalog",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await prisma.pricingItem.findMany({
        where: {
          organizationId: req.organizationId!,
          active: true,
          isVisible: true,
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      res.json({
        success: true,
        data: rows.map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          unit: row.unit,
          /** Loja / cliente final */
          price_loja: dec(row.priceMin) || dec(row.price),
          price_min: dec(row.priceMin),
          price_max: dec(row.priceMax),
          /** Builder / partner */
          partner_price: row.partnerPrice != null ? dec(row.partnerPrice) : null,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.get(
  "/api/work-orders/:id",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const row = await prisma.workOrder.findFirst({
        where: {
          id: String(req.params.id),
          organizationId: req.organizationId!,
          ...fieldWorkOrderScope(req.user),
        },
        include: woInclude,
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Work order not found" });
        return;
      }
      res.json({ success: true, data: mapWorkOrder(row) });
    } catch (error) {
      next(error);
    }
  },
);

const workOrderBody = z.object({
  title: z.string().min(2).max(200),
  status: z.enum(WO_STATUSES).optional(),
  source_type: z.enum(WO_SOURCES).optional(),
  source_name: z.string().max(200).optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  builder_id: z.string().uuid().optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  assigned_user_id: z.string().uuid().optional().nullable(),
  crew_id: z.string().uuid().optional().nullable(),
  member_user_ids: z.array(z.string().uuid()).optional(),
  line_items: z.array(lineItemBody).max(50).optional(),
  scheduled_start: z.string().datetime().optional().nullable(),
  scheduled_end: z.string().datetime().optional().nullable(),
});

scheduleJobsRouter.post(
  "/api/work-orders",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = workOrderBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid work order payload" });
        return;
      }
      const d = parsed.data;
      const start = d.scheduled_start ? new Date(d.scheduled_start) : null;
      const end = d.scheduled_end ? new Date(d.scheduled_end) : null;
      if ((start && !end) || (!start && end)) {
        res.status(400).json({ success: false, error: "Provide both start and end, or neither" });
        return;
      }
      if (start && end && end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "End must be after start" });
        return;
      }

      let status = d.status ?? "draft";
      if (!d.status && start) status = "scheduled";

      const number = await nextWorkOrderNumber(req.organizationId!);
      const row = await prisma.workOrder.create({
        data: {
          organizationId: req.organizationId!,
          number,
          title: d.title.trim(),
          status,
          sourceType: d.source_type ?? "other",
          sourceName: d.source_name?.trim() || null,
          customerId: d.customer_id || null,
          builderId: d.builder_id || null,
          address: d.address?.trim() || null,
          notes: d.notes?.trim() || null,
          assignedUserId: d.assigned_user_id || null,
          crewId: d.crew_id || null,
          scheduledStart: start,
          scheduledEnd: end,
        },
      });
      await syncWorkOrderMembers(req.organizationId!, row.id, d.member_user_ids);
      await syncWorkOrderLineItems(req.organizationId!, row.id, d.line_items);
      const full = await prisma.workOrder.findFirst({
        where: { id: row.id },
        include: woInclude,
      });

      const conflicts = await collectConflictHints({
        organizationId: req.organizationId!,
        id: row.id,
        scheduledStart: start,
        scheduledEnd: end,
        assignedUserId: row.assignedUserId,
        crewId: row.crewId,
        kind: "work_order",
      });

      if (full) {
        notifyJobTeamPush(
          req.organizationId!,
          { id: full.id, title: full.title, number: full.number },
          teamUserIdsFromWorkOrder(full),
          { excludeUserId: req.user?.id, event: "created" },
        );
      }

      res.status(201).json({
        success: true,
        data: mapWorkOrder(full!),
        conflicts,
      });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.put(
  "/api/work-orders/:id",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const existing = await prisma.workOrder.findFirst({
        where: { id: String(req.params.id), organizationId: req.organizationId! },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Work order not found" });
        return;
      }
      const parsed = workOrderBody.partial().extend({ title: z.string().min(2).max(200).optional() }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid work order payload" });
        return;
      }
      const d = parsed.data;
      const start =
        d.scheduled_start === undefined
          ? existing.scheduledStart
          : d.scheduled_start
            ? new Date(d.scheduled_start)
            : null;
      const end =
        d.scheduled_end === undefined
          ? existing.scheduledEnd
          : d.scheduled_end
            ? new Date(d.scheduled_end)
            : null;
      if ((start && !end) || (!start && end)) {
        res.status(400).json({ success: false, error: "Provide both start and end, or neither" });
        return;
      }
      if (start && end && end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "End must be after start" });
        return;
      }

      const row = await prisma.workOrder.update({
        where: { id: existing.id },
        data: {
          ...(d.title !== undefined ? { title: d.title.trim() } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.source_type !== undefined ? { sourceType: d.source_type } : {}),
          ...(d.source_name !== undefined ? { sourceName: d.source_name?.trim() || null } : {}),
          ...(d.customer_id !== undefined ? { customerId: d.customer_id || null } : {}),
          ...(d.builder_id !== undefined ? { builderId: d.builder_id || null } : {}),
          ...(d.address !== undefined ? { address: d.address?.trim() || null } : {}),
          ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
          ...(d.assigned_user_id !== undefined
            ? { assignedUserId: d.assigned_user_id || null }
            : {}),
          ...(d.crew_id !== undefined ? { crewId: d.crew_id || null } : {}),
          ...(d.scheduled_start !== undefined || d.scheduled_end !== undefined
            ? { scheduledStart: start, scheduledEnd: end }
            : {}),
        },
      });
      await syncWorkOrderMembers(req.organizationId!, row.id, d.member_user_ids);
      await syncWorkOrderLineItems(req.organizationId!, row.id, d.line_items);
      const full = await prisma.workOrder.findFirst({
        where: { id: row.id },
        include: woInclude,
      });

      const conflicts = await collectConflictHints({
        organizationId: req.organizationId!,
        id: row.id,
        scheduledStart: row.scheduledStart,
        scheduledEnd: row.scheduledEnd,
        assignedUserId: row.assignedUserId,
        crewId: row.crewId,
        kind: "work_order",
      });

      if (full) {
        const shouldNotify =
          d.assigned_user_id !== undefined ||
          d.member_user_ids !== undefined ||
          d.scheduled_start !== undefined ||
          d.scheduled_end !== undefined ||
          d.status !== undefined ||
          d.address !== undefined ||
          d.line_items !== undefined;
        if (shouldNotify) {
          notifyJobTeamPush(
            req.organizationId!,
            { id: full.id, title: full.title, number: full.number },
            teamUserIdsFromWorkOrder(full),
            { excludeUserId: req.user?.id, event: "updated" },
          );
        }
      }

      res.json({ success: true, data: mapWorkOrder(full!), conflicts });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.delete(
  "/api/work-orders/:id",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const existing = await prisma.workOrder.findFirst({
        where: { id: String(req.params.id), organizationId: req.organizationId! },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Work order not found" });
        return;
      }
      const row = await prisma.workOrder.update({
        where: { id: existing.id },
        data: { status: "canceled" },
        include: woInclude,
      });
      res.json({ success: true, data: mapWorkOrder(row) });
    } catch (error) {
      next(error);
    }
  },
);

const tempWorkerBody = z.object({
  name: z.string().min(2).max(200),
  phone: z.string().max(40).optional().nullable(),
  email: z
    .string()
    .max(200)
    .optional()
    .nullable()
    .transform((v: string | null | undefined) => (v && String(v).trim() ? String(v).trim() : null))
    .refine(
      (v: string | null) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Email inválido",
    ),
  notes: z.string().max(2000).optional().nullable(),
});

scheduleJobsRouter.post(
  "/api/work-orders/:id/temp-workers",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const woId = param(req, "id");
      const wo = await prisma.workOrder.findFirst({
        where: { id: woId, organizationId: req.organizationId! },
        select: { id: true, title: true, number: true },
      });
      if (!wo) {
        res.status(404).json({ success: false, error: "Work order not found" });
        return;
      }
      const parsed = tempWorkerBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Informe o nome do funcionário temporário" });
        return;
      }
      const d = parsed.data;
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const row = await tx.workOrderTempWorker.create({
          data: {
            organizationId: req.organizationId!,
            workOrderId: wo.id,
            name: d.name.trim(),
            phone: d.phone?.trim() || null,
            email: d.email?.trim() || null,
            notes: d.notes?.trim() || null,
          },
        });
        const issued = await issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "work_order_temp",
          entityId: row.id,
          ttlDays: 60,
        });
        return { row, issued };
      });
      const url = publicJobShareUrl(req, result.issued.rawToken);
      const phone = normalizePhoneForWhatsApp(result.row.phone);
      const msg = `Olá${result.row.name ? ` ${result.row.name}` : ""}! Segue o link do job: ${url}`;
      res.status(201).json({
        success: true,
        data: {
          id: result.row.id,
          name: result.row.name,
          phone: result.row.phone,
          email: result.row.email,
          notes: result.row.notes,
          created_at: result.row.createdAt.toISOString(),
          share: {
            url,
            expires_at: result.issued.expiresAt.toISOString(),
            whatsapp_url: phone
              ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
              : `https://wa.me/?text=${encodeURIComponent(msg)}`,
            sms_url: phone
              ? `sms:${phone}?body=${encodeURIComponent(msg)}`
              : `sms:?&body=${encodeURIComponent(msg)}`,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.delete(
  "/api/work-orders/:id/temp-workers/:tempId",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const woId = param(req, "id");
      const tempId = param(req, "tempId");
      const existing = await prisma.workOrderTempWorker.findFirst({
        where: { id: tempId, workOrderId: woId, organizationId: req.organizationId! },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Funcionário temporário não encontrado" });
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.publicAccessToken.updateMany({
          where: { entityType: "work_order_temp", entityId: tempId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.workOrderTempWorker.delete({ where: { id: tempId } });
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.post(
  "/api/work-orders/:id/temp-workers/:tempId/share-link",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const woId = param(req, "id");
      const tempId = param(req, "tempId");
      const existing = await prisma.workOrderTempWorker.findFirst({
        where: { id: tempId, workOrderId: woId, organizationId: req.organizationId! },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Funcionário temporário não encontrado" });
        return;
      }
      const issued = await withTenantTransaction(req.organizationId!, async (tx) =>
        issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "work_order_temp",
          entityId: existing.id,
          ttlDays: 60,
        }),
      );
      const url = publicJobShareUrl(req, issued.rawToken);
      const phone = normalizePhoneForWhatsApp(existing.phone);
      const msg = `Olá${existing.name ? ` ${existing.name}` : ""}! Segue o link do job: ${url}`;
      res.json({
        success: true,
        data: {
          url,
          expires_at: issued.expiresAt.toISOString(),
          temp_worker_id: existing.id,
          temp_worker_name: existing.name,
          whatsapp_url: phone
            ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
            : `https://wa.me/?text=${encodeURIComponent(msg)}`,
          sms_url: phone
            ? `sms:${phone}?body=${encodeURIComponent(msg)}`
            : `sms:?&body=${encodeURIComponent(msg)}`,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------- Meetings ----------

scheduleJobsRouter.get(
  "/api/meetings",
  requireCrmAuth,
  requireCrmPermission("schedule.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
      const rows = await prisma.meeting.findMany({
        where: {
          organizationId: req.organizationId!,
          ...fieldMeetingScope(req.user),
          ...(from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())
            ? { scheduledStart: { lte: to }, scheduledEnd: { gte: from } }
            : {}),
        },
        include: mtgInclude,
        orderBy: { scheduledStart: "asc" },
        take: 200,
      });
      res.json({ success: true, data: rows.map(mapMeeting) });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.get(
  "/api/meetings/:id",
  requireCrmAuth,
  requireCrmPermission("schedule.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const row = await prisma.meeting.findFirst({
        where: {
          id: String(req.params.id),
          organizationId: req.organizationId!,
          ...fieldMeetingScope(req.user),
        },
        include: mtgInclude,
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Meeting not found" });
        return;
      }
      res.json({ success: true, data: mapMeeting(row) });
    } catch (error) {
      next(error);
    }
  },
);

const meetingBody = z.object({
  title: z.string().min(2).max(200),
  status: z.enum(MTG_STATUSES).optional(),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  location: z.string().max(500).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  assigned_user_id: z.string().uuid().optional().nullable(),
});

scheduleJobsRouter.post(
  "/api/meetings",
  requireCrmAuth,
  requireCrmPermission("schedule.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = meetingBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid meeting payload" });
        return;
      }
      const d = parsed.data;
      const start = new Date(d.scheduled_start);
      const end = new Date(d.scheduled_end);
      if (end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "End must be after start" });
        return;
      }
      const row = await prisma.meeting.create({
        data: {
          organizationId: req.organizationId!,
          title: d.title.trim(),
          status: d.status ?? "scheduled",
          scheduledStart: start,
          scheduledEnd: end,
          location: d.location?.trim() || null,
          notes: d.notes?.trim() || null,
          customerId: d.customer_id || null,
          assignedUserId: d.assigned_user_id || null,
        },
        include: mtgInclude,
      });
      const conflicts = await collectConflictHints({
        organizationId: req.organizationId!,
        id: row.id,
        scheduledStart: start,
        scheduledEnd: end,
        assignedUserId: row.assignedUserId,
        kind: "meeting",
      });
      res.status(201).json({ success: true, data: mapMeeting(row), conflicts });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.put(
  "/api/meetings/:id",
  requireCrmAuth,
  requireCrmPermission("schedule.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const existing = await prisma.meeting.findFirst({
        where: { id: String(req.params.id), organizationId: req.organizationId! },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Meeting not found" });
        return;
      }
      const parsed = meetingBody.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid meeting payload" });
        return;
      }
      const d = parsed.data;
      const start = d.scheduled_start ? new Date(d.scheduled_start) : existing.scheduledStart;
      const end = d.scheduled_end ? new Date(d.scheduled_end) : existing.scheduledEnd;
      if (end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "End must be after start" });
        return;
      }
      const row = await prisma.meeting.update({
        where: { id: existing.id },
        data: {
          ...(d.title !== undefined ? { title: d.title.trim() } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.scheduled_start !== undefined ? { scheduledStart: start } : {}),
          ...(d.scheduled_end !== undefined ? { scheduledEnd: end } : {}),
          ...(d.location !== undefined ? { location: d.location?.trim() || null } : {}),
          ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
          ...(d.customer_id !== undefined ? { customerId: d.customer_id || null } : {}),
          ...(d.assigned_user_id !== undefined
            ? { assignedUserId: d.assigned_user_id || null }
            : {}),
        },
        include: mtgInclude,
      });
      const conflicts = await collectConflictHints({
        organizationId: req.organizationId!,
        id: row.id,
        scheduledStart: row.scheduledStart,
        scheduledEnd: row.scheduledEnd,
        assignedUserId: row.assignedUserId,
        kind: "meeting",
      });
      res.json({ success: true, data: mapMeeting(row), conflicts });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.delete(
  "/api/meetings/:id",
  requireCrmAuth,
  requireCrmPermission("schedule.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const existing = await prisma.meeting.findFirst({
        where: { id: String(req.params.id), organizationId: req.organizationId! },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Meeting not found" });
        return;
      }
      const row = await prisma.meeting.update({
        where: { id: existing.id },
        data: { status: "canceled" },
        include: mtgInclude,
      });
      res.json({ success: true, data: mapMeeting(row) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------- Unified schedule events ----------

scheduleJobsRouter.get(
  "/api/schedule/events",
  requireCrmAuth,
  requireCrmPermission("schedule.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const fromRaw = typeof req.query.from === "string" ? req.query.from : "";
      const toRaw = typeof req.query.to === "string" ? req.query.to : "";
      const from = fromRaw ? new Date(fromRaw) : null;
      const to = toRaw ? new Date(toRaw) : null;
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        res.status(400).json({ success: false, error: "from and to query params required (ISO dates)" });
        return;
      }

      const [workOrders, meetings] = await Promise.all([
        prisma.workOrder.findMany({
          where: {
            organizationId: req.organizationId!,
            status: { not: "canceled" },
            scheduledStart: { not: null, lte: to },
            scheduledEnd: { not: null, gte: from },
            ...fieldWorkOrderScope(req.user),
          },
          include: woInclude,
          orderBy: { scheduledStart: "asc" },
        }),
        prisma.meeting.findMany({
          where: {
            organizationId: req.organizationId!,
            status: { not: "canceled" },
            scheduledStart: { lte: to },
            scheduledEnd: { gte: from },
            ...fieldMeetingScope(req.user),
          },
          include: mtgInclude,
          orderBy: { scheduledStart: "asc" },
        }),
      ]);

      const events = [
        ...workOrders.map((wo) => ({
          id: wo.id,
          type: "job" as const,
          title: wo.title,
          status: wo.status,
          start: wo.scheduledStart!.toISOString(),
          end: wo.scheduledEnd!.toISOString(),
          color: wo.crew?.color || "#e8792c",
          meta: mapWorkOrder(wo),
        })),
        ...meetings.map((m) => ({
          id: m.id,
          type: "meeting" as const,
          title: m.title,
          status: m.status,
          start: m.scheduledStart.toISOString(),
          end: m.scheduledEnd.toISOString(),
          color: "#3b6ea5",
          meta: mapMeeting(m),
        })),
      ].sort((a, b) => a.start.localeCompare(b.start));

      res.json({ success: true, data: events });
    } catch (error) {
      next(error);
    }
  },
);
