import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { findScheduleConflicts } from "../../lib/schedule/conflicts.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { publicBaseUrl } from "../../lib/http/public-url.js";
import { ensureTempShareToken } from "../../lib/work-orders/temp-share.js";
import { notifyJobTeamPush } from "../../lib/push/notify.js";
import { param } from "../../lib/http/params.js";
import { myJobAccessWhere, parseChecklist } from "../lib/campo-shared.js";
import { randomUUID } from "node:crypto";
import { ensureJobChatChannel } from "../../lib/chat/job-channel.js";
import { jobBilling, jobBillingLabel } from "../../lib/invoices/job.js";

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
  if (role === "installer" || role === "crew_lead" || role === "subcontractor") return true;
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

/** Short worker ticket link on the brand domain: https://obramate.com/t/<token>. */
function publicJobShareUrl(req: AuthedRequest, rawToken: string): string {
  return `${publicBaseUrl(req)}/t/${rawToken}`;
}

function tempShareMessage(name: string | null | undefined, wo: { number: number | null; title: string }, url: string): string {
  const hi = `Olá${name ? ` ${name.trim().split(/\s+/)[0]}` : ""}!`;
  const ref = [wo.number ? `#${wo.number}` : "", wo.title ? `(${wo.title})` : ""].filter(Boolean).join(" ");
  return `${hi} Seu ticket do job${ref ? ` ${ref}` : ""}: ${url}`;
}

function normalizePhoneForWhatsApp(phone: string | null | undefined): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  // US local 10-digit → E.164 without +
  if (digits.length === 10) digits = `1${digits}`;
  return digits;
}

const WO_STATUSES = ["draft", "scheduled", "in_progress", "completed", "canceled"] as const;
/** Origem do job — also picks the Tabela de Valores column (particular | builder | contractor | loja). */
const WO_SOURCES = ["particular", "builder", "contractor", "loja", "internal", "other"] as const;
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
  fieldStatus?: string;
  sourceType: string;
  sourceName: string | null;
  customerId: string | null;
  builderId: string | null;
  address: string | null;
  notes: string | null;
  campoAttention?: string | null;
  campoChecklist?: unknown;
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
    pricingItem?: { unit: string } | null;
  }[];
  invoices?: { amount: unknown; status: string; receipts?: { amount: unknown }[] }[];
}) {
  const lineItems = (wo.lineItems || []).map((li) => ({
    id: li.id,
    pricing_item_id: li.pricingItemId,
    service_name: li.serviceName,
    quantity_sqft: dec(li.quantitySqft),
    unit_price: dec(li.unitPrice),
    line_total: dec(li.lineTotal),
    sort_order: li.sortOrder,
    unit: li.pricingItem?.unit || null,
  }));
  const services_total = Math.round(lineItems.reduce((sum, li) => sum + li.line_total, 0) * 100) / 100;
  const billing = wo.invoices ? jobBilling(services_total, wo.invoices) : null;
  return {
    id: wo.id,
    number: wo.number,
    title: wo.title,
    status: wo.status,
    field_status: wo.fieldStatus ?? null,
    source_type: wo.sourceType,
    source_name: wo.sourceName,
    customer_id: wo.customerId,
    builder_id: wo.builderId,
    address: wo.address,
    notes: wo.notes,
    /** "Atenção" box shown to the field crew in Campo. */
    campo_attention: wo.campoAttention ?? null,
    /** null = no checklist set for this job (Campo falls back to the default template). */
    campo_checklist:
      Array.isArray(wo.campoChecklist) && (wo.campoChecklist as unknown[]).length
        ? parseChecklist(wo.campoChecklist).map((c) => ({
            id: c.id,
            text: c.text,
            photo_required: Boolean(c.photo_required),
            done: c.done,
          }))
        : null,
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
    /** Present only for users who can see invoices. */
    billing: billing ? { ...billing, billing_status_label: jobBillingLabel(billing.billing_status) } : null,
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
  lineItems: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: { pricingItem: { select: { unit: true } } },
  },
};

/** Money position (faturado / recebido) rides along only for people who can see invoices. */
function canSeeBilling(user: AuthedRequest["user"]): boolean {
  if (!user) return false;
  if (String(user.roleKey || "") === "admin") return true;
  return (user.permissions || []).includes("invoices.view");
}

const woBillingInclude = {
  invoices: {
    where: { status: { not: "void" } },
    select: { amount: true, status: true, receipts: { select: { amount: true } } },
  },
};

function woIncludeFor(user: AuthedRequest["user"]) {
  return canSeeBilling(user) ? { ...woInclude, ...woBillingInclude } : woInclude;
}

const BILLING_FILTERS = ["to_invoice", "awaiting_payment", "paid"] as const;

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
  crew?: { members?: { userId: string }[] } | null;
}): string[] {
  const ids = new Set<string>();
  if (wo.assignedUserId) ids.add(wo.assignedUserId);
  for (const m of wo.members || []) ids.add(m.userId);
  for (const m of wo.crew?.members || []) ids.add(m.userId);
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
      const billingFilter =
        typeof req.query.billing === "string" &&
        (BILLING_FILTERS as readonly string[]).includes(req.query.billing) &&
        canSeeBilling(req.user)
          ? (req.query.billing as (typeof BILLING_FILTERS)[number])
          : null;
      const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
      const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

      const fieldScope = fieldWorkOrderScope(req.user);
      const searchOr = q
        ? [
            { title: { contains: q, mode: "insensitive" as const } },
            { sourceName: { contains: q, mode: "insensitive" as const } },
            { address: { contains: q, mode: "insensitive" as const } },
            { customer: { name: { contains: q, mode: "insensitive" as const } } },
            { builder: { company: { contains: q, mode: "insensitive" as const } } },
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
                OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: from } }],
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
        include: woIncludeFor(req.user),
        orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
        take: billingFilter ? 500 : 200,
      });
      let data = rows.map(mapWorkOrder);
      if (billingFilter) {
        data = data.filter((wo) => {
          const b = wo.billing;
          if (!b) return false;
          if (billingFilter === "to_invoice") return wo.status === "completed" && b.remaining_to_invoice > 0.004;
          if (billingFilter === "awaiting_payment") return b.open_balance > 0.004;
          return b.billing_status === "paid";
        });
      }
      res.json({ success: true, data });
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
        data: rows.map((row) => {
          const priceParticular =
            dec(row.priceParticular) || dec(row.priceMax) || dec(row.priceMin) || dec(row.price) || 0;
          const priceBuilder =
            dec(row.priceBuilder) ||
            (row.partnerPrice != null ? dec(row.partnerPrice) : 0) ||
            dec(row.priceMin) ||
            0;
          const priceContractor = dec(row.priceContractor) || priceBuilder;
          const priceLoja = dec(row.priceLoja) || dec(row.priceMin) || dec(row.price) || 0;
          return {
            id: row.id,
            name: row.name,
            category: row.category,
            unit: row.unit,
            price_particular: priceParticular,
            price_builder: priceBuilder,
            price_contractor: priceContractor,
            price_loja: priceLoja,
            /** Legacy aliases kept for older clients */
            price_min: priceLoja,
            price_max: priceParticular,
            partner_price: priceBuilder,
          };
        }),
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
        include: woIncludeFor(req.user),
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

/** Office edits the list; keep what the crew already did on items that survive (matched by id). */
function mergeOfficeChecklist(
  current: unknown,
  next: { id?: string | null; text: string; photo_required?: boolean }[],
): Prisma.InputJsonValue {
  const prev = Array.isArray(current) && current.length ? parseChecklist(current) : [];
  const byId = new Map(prev.map((c) => [c.id, c]));
  const used = new Set<string>();
  return next.map((item) => {
    let id = item.id && !used.has(item.id) ? item.id : "";
    if (!id) id = `o${randomUUID().slice(0, 8)}`;
    used.add(id);
    const old = byId.get(id);
    return {
      id,
      text: item.text.trim(),
      done: old?.done ?? false,
      photo_required: Boolean(item.photo_required),
      photo_media_ids: old?.photo_media_ids ?? [],
      note: old?.note ?? null,
      done_by: old?.done_by ?? null,
      done_at: old?.done_at ?? null,
    };
  }) as unknown as Prisma.InputJsonValue;
}

const workOrderBody = z.object({
  title: z.string().min(2).max(200),
  status: z.enum(WO_STATUSES).optional(),
  source_type: z.enum(WO_SOURCES).optional(),
  source_name: z.string().max(200).optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  builder_id: z.string().uuid().optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  campo_attention: z.string().max(2000).optional().nullable(),
  /** Checklist set by the office; done/photos already recorded by the crew are kept by id. */
  campo_checklist: z
    .array(
      z.object({
        id: z.string().max(40).optional().nullable(),
        text: z.string().trim().min(1).max(200),
        photo_required: z.boolean().optional(),
      }),
    )
    .max(40)
    .optional()
    .nullable(),
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
      // Start-only is allowed (open-ended jobs); end without start is not.
      if (!start && end) {
        res.status(400).json({ success: false, error: "Informe a data/hora de início antes do fim" });
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
          campoAttention: d.campo_attention?.trim() || null,
          ...(d.campo_checklist?.length ? { campoChecklist: mergeOfficeChecklist(null, d.campo_checklist) } : {}),
          assignedUserId: d.assigned_user_id || null,
          crewId: d.crew_id || null,
          scheduledStart: start,
          scheduledEnd: end,
        },
      });
      await syncWorkOrderMembers(req.organizationId!, row.id, d.member_user_ids);
      await syncWorkOrderLineItems(req.organizationId!, row.id, d.line_items);
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await ensureJobChatChannel(tx, req.organizationId!, row.id);
      });
      const full = await prisma.workOrder.findFirst({
        where: { id: row.id },
        include: woIncludeFor(req.user),
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
      if (!start && end) {
        res.status(400).json({ success: false, error: "Informe a data/hora de início antes do fim" });
        return;
      }
      if (start && end && end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "End must be after start" });
        return;
      }

      // Services already billed: the job total cannot drop below what was invoiced.
      if (d.line_items !== undefined || d.status === "canceled") {
        const agg = await prisma.quoteInvoice.aggregate({
          where: { organizationId: req.organizationId!, workOrderId: existing.id, status: { not: "void" } },
          _sum: { amount: true },
        });
        const invoiced = Number(agg._sum.amount ?? 0);
        if (d.status === "canceled" && invoiced > 0) {
          res.status(409).json({ success: false, error: "Este job tem faturas. Anule as faturas antes de cancelar o job." });
          return;
        }
        if (d.line_items !== undefined && invoiced > 0) {
          const newTotal = d.line_items.reduce(
            (sum, li) => sum + Math.round((Number(li.quantity_sqft) || 0) * (Number(li.unit_price) || 0) * 100) / 100,
            0,
          );
          if (newTotal + 0.004 < invoiced) {
            res.status(409).json({
              success: false,
              error: `Já foram faturados $${invoiced.toFixed(2)} neste job — o total dos serviços não pode ficar abaixo disso.`,
            });
            return;
          }
        }
      }

      const scheduleChanged =
        d.scheduled_start !== undefined &&
        (existing.scheduledStart?.getTime() ?? null) !== (start?.getTime() ?? null);

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
          ...(d.campo_attention !== undefined ? { campoAttention: d.campo_attention?.trim() || null } : {}),
          ...(d.campo_checklist !== undefined
            ? {
                campoChecklist: d.campo_checklist?.length
                  ? mergeOfficeChecklist(existing.campoChecklist, d.campo_checklist)
                  : Prisma.DbNull,
              }
            : {}),
          ...(d.assigned_user_id !== undefined
            ? { assignedUserId: d.assigned_user_id || null }
            : {}),
          ...(d.crew_id !== undefined ? { crewId: d.crew_id || null } : {}),
          ...(d.scheduled_start !== undefined || d.scheduled_end !== undefined
            ? { scheduledStart: start, scheduledEnd: end }
            : {}),
          // Re-arm start reminders when the start time moves.
          ...(scheduleChanged
            ? { startReminderSentAt: null, startNudgeSentAt: null }
            : {}),
        },
      });
      await syncWorkOrderMembers(req.organizationId!, row.id, d.member_user_ids);
      await syncWorkOrderLineItems(req.organizationId!, row.id, d.line_items);
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await ensureJobChatChannel(tx, req.organizationId!, row.id);
      });
      const full = await prisma.workOrder.findFirst({
        where: { id: row.id },
        include: woIncludeFor(req.user),
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
          d.campo_attention !== undefined ||
          d.campo_checklist !== undefined ||
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
      const openInvoices = await prisma.quoteInvoice.count({
        where: { organizationId: req.organizationId!, workOrderId: existing.id, status: { not: "void" } },
      });
      if (openInvoices > 0) {
        res.status(409).json({ success: false, error: "Este job tem faturas. Anule as faturas antes de excluir o job." });
        return;
      }
      const row = await prisma.workOrder.update({
        where: { id: existing.id },
        data: { status: "canceled" },
        include: woIncludeFor(req.user),
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
        const issued = await ensureTempShareToken(tx, {
          organizationId: req.organizationId!,
          tempWorkerId: row.id,
        });
        return { row, issued };
      });
      const url = publicJobShareUrl(req, result.issued.rawToken);
      const phone = normalizePhoneForWhatsApp(result.row.phone);
      const msg = tempShareMessage(result.row.name, wo, url);
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
      const wo = await prisma.workOrder.findFirst({
        where: { id: woId, organizationId: req.organizationId! },
        select: { number: true, title: true },
      });
      // Same link every time; `rotate` (body or ?rotate=1) issues a new one and kills the old.
      const rotate = req.body?.rotate === true || String(req.query.rotate || "") === "1";
      const issued = await withTenantTransaction(req.organizationId!, async (tx) =>
        ensureTempShareToken(tx, {
          organizationId: req.organizationId!,
          tempWorkerId: existing.id,
          rotate,
        }),
      );
      const url = publicJobShareUrl(req, issued.rawToken);
      const phone = normalizePhoneForWhatsApp(existing.phone);
      const msg = tempShareMessage(existing.name, wo || { number: null, title: "" }, url);
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
            OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: from } }],
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
        ...workOrders.map((wo) => {
          const startIso = wo.scheduledStart!.toISOString();
          const endIso = wo.scheduledEnd
            ? wo.scheduledEnd.toISOString()
            : new Date(wo.scheduledStart!.getTime() + 60 * 60 * 1000).toISOString();
          return {
            id: wo.id,
            type: "job" as const,
            title: wo.title,
            status: wo.status,
            start: startIso,
            end: endIso,
            color: wo.crew?.color || "#e8792c",
            meta: mapWorkOrder(wo),
          };
        }),
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
