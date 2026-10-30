import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { managerIdOrNull, managerName } from "../../lib/customers/managers.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { findScheduleConflicts } from "../../lib/schedule/conflicts.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { publicBaseUrl } from "../../lib/http/public-url.js";
import { ensureTempShareToken } from "../../lib/work-orders/temp-share.js";
import { alignLinkedJobAndQuote, ensureQuoteDiscountOnJob, ensureQuoteDiscountsOnJobs, syncLinkedJobFromQuote, syncLinkedQuoteFromJob } from "../../lib/work-orders/from-quote.js";
import { sectorFinishPatch } from "../../lib/work-orders/sector-finish.js";
import { notifyJobTeamPush } from "../../lib/push/notify.js";
import { param } from "../../lib/http/params.js";
import { myJobAccessWhere, parseChecklist } from "../lib/campo-shared.js";
import { randomUUID } from "node:crypto";
import { ensureJobChatChannel } from "../../lib/chat/job-channel.js";
import { foldUnlinkedQuoteInvoices, jobBilling, jobBillingLabel } from "../../lib/invoices/job.js";
import { isJobChecklistEnabled } from "../../lib/settings/jobs.js";
import {
  parseScheduleSettings,
  resolveJobCalendar,
  resolveJobColor,
  resolveMeetingColor,
  resolveVisitCalendarId,
  resolveVisitColor,
} from "../../lib/settings/schedule.js";
import { formatUsPhone } from "../../lib/phone.js";
import { formatPersonName } from "../../lib/name.js";
import { storage } from "../../lib/storage/index.js";
import { signIcsAccessToken } from "../../lib/schedule/signed-ics-token.js";
import { buildSingleEventIcs, meetingStatusToIcs } from "../../lib/schedule/ics.js";
import {
  buildMeetingCalendarDescription,
  buildMeetingCalendarSummary,
  clientIdFromLeadRecord,
  originFromLeadRecord,
  personCalendarTitle,
} from "../../lib/schedule/lead-visit-ics.js";
import { calendarNickFromBuilders, isBuilderParty, jobCalendarTitle, visitBlockEnd } from "../../lib/schedule/calendar-label.js";
import { phaseKeys } from "../../lib/trades/index.js";
import { COMBINED_PHASE, PHASE_KEYS, phaseLabel } from "../../lib/trades/phases.js";

/** Job phases from the trade pack (hardwood: installation, sand_finish, both). */
const WO_SECTORS: readonly string[] = phaseKeys();

function normalizeWoSector(raw: unknown): string | null {
  const v = String(raw || "").trim().toLowerCase();
  return WO_SECTORS.includes(v) ? v : null;
}

async function resolveRelatedWorkOrderId(
  organizationId: string,
  relatedId: string | null | undefined,
  selfId?: string | null,
): Promise<string | null> {
  if (!relatedId) return null;
  if (selfId && relatedId === selfId) {
    const err = new Error("Um job não pode se ligar a si mesmo") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const hit = await prisma.workOrder.findFirst({
    where: { id: relatedId, organizationId, status: { not: "canceled" } },
    select: { id: true },
  });
  if (!hit) {
    const err = new Error("Job de Instalação ligado não encontrado") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  return hit.id;
}

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

function quoteNoteOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const note = String((payload as Record<string, unknown>).job_name || "").trim();
  return note || null;
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
  clientRef?: string | null;
  managerId?: string | null;
  notes: string | null;
  campoAttention?: string | null;
  needsDelivery?: boolean;
  deliveryPickupAddress?: string | null;
  deliveryNotes?: string | null;
  deliveryAttachmentUrl?: string | null;
  deliveryAttachmentKey?: string | null;
  deliveryAttachmentName?: string | null;
  deliveryAttachmentSharedWithPartners?: boolean;
  campoChecklist?: unknown;
  assignedUserId: string | null;
  crewId: string | null;
  sector?: string | null;
  relatedWorkOrderId?: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  sandScheduledStart?: Date | null;
  installationDoneAt?: Date | null;
  sandDoneAt?: Date | null;
  allDay?: boolean;
  createdAt: Date;
  updatedAt: Date;
  customer?: { id: string; name: string; clientCode?: string | null; customerType?: string | null; email?: string | null; phone?: string | null; managers?: unknown } | null;
  builder?: { id: string; firstName: string; lastName: string; company: string | null; nickname?: string | null } | null;
  assignedUser?: { id: string; name: string } | null;
  crew?: { id: string; name: string; color: string | null } | null;
  relatedWorkOrder?: { id: string; number: number | null; title: string; sector: string | null; status: string } | null;
  relatedChildren?: { id: string; number: number | null; title: string; sector: string | null; status: string }[];
  members?: { userId: string; user: { id: string; name: string; email: string } }[];
  tempWorkers?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
    createdAt: Date;
  }[];
  quotes?: { quoteNumber: string | null; title: string; leadId?: string | null; payload?: unknown }[];
  lineItems?: {
    id: string;
    pricingItemId: string | null;
    serviceName: string;
    notes?: string | null;
    quantitySqft: unknown;
    unitPrice: unknown;
    lineTotal: unknown;
    sortOrder: number;
    pricingItem?: { unit: string } | null;
  }[];
  invoices?: { id?: string; invoiceNumber?: string | null; amount: unknown; status: string; receipts?: { amount: unknown }[] }[];
}) {
  const linkedQuote = (wo.quotes || []).find((q) => q.quoteNumber) || wo.quotes?.[0] || null;
  const quoteNote = quoteNoteOf(linkedQuote?.payload);
  const lineItems = (wo.lineItems || []).map((li) => ({
    id: li.id,
    pricing_item_id: li.pricingItemId,
    service_name: li.serviceName,
    notes: li.notes && li.notes !== "quote-discount" ? li.notes : null,
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
    quote_number: linkedQuote?.quoteNumber || null,
    quote_title: linkedQuote?.title || null,
    lead_name: null as string | null,
    title: wo.title,
    status: wo.status,
    field_status: wo.fieldStatus ?? null,
    source_type: wo.sourceType,
    source_name: wo.sourceName,
    customer_id: wo.customerId,
    customer_type: wo.customer?.customerType || null,
    builder_id: wo.builderId,
    address: wo.address,
    client_ref: (wo.clientRef && String(wo.clientRef).trim()) || quoteNote || null,
    manager_id: wo.managerId || null,
    manager_name: managerName(wo.customer?.managers, wo.managerId),
    notes: wo.notes,
    /** "Atenção" box shown to the field crew in Campo. */
    campo_attention: wo.campoAttention ?? null,
    /** Pickup leftover material from the job site. */
    needs_delivery: Boolean(wo.needsDelivery),
    delivery_pickup_address: wo.deliveryPickupAddress || null,
    delivery_notes: wo.deliveryNotes || null,
    delivery_attachment: wo.deliveryAttachmentUrl
      ? {
          url: wo.deliveryAttachmentUrl,
          name: wo.deliveryAttachmentName || "Anexo",
          key: wo.deliveryAttachmentKey || null,
          shared_with_partners: Boolean(wo.deliveryAttachmentSharedWithPartners),
        }
      : null,
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
    sector: wo.sector ?? null,
    related_work_order_id: wo.relatedWorkOrderId ?? null,
    related_work_order: wo.relatedWorkOrder
      ? {
          id: wo.relatedWorkOrder.id,
          number: wo.relatedWorkOrder.number,
          title: wo.relatedWorkOrder.title,
          sector: wo.relatedWorkOrder.sector,
          status: wo.relatedWorkOrder.status,
        }
      : null,
    related_children: (wo.relatedChildren || []).map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      sector: c.sector,
      status: c.status,
    })),
    scheduled_start: wo.scheduledStart?.toISOString() ?? null,
    scheduled_end: wo.scheduledEnd?.toISOString() ?? null,
    sand_scheduled_start: wo.sandScheduledStart?.toISOString() ?? null,
    installation_done_at: wo.installationDoneAt?.toISOString() ?? null,
    sand_done_at: wo.sandDoneAt?.toISOString() ?? null,
    all_day: Boolean(wo.scheduledStart || wo.sandScheduledStart),
    created_at: wo.createdAt.toISOString(),
    updated_at: wo.updatedAt.toISOString(),
    customer: wo.customer
      ? {
          id: wo.customer.id,
          name: wo.customer.name,
          client_code: wo.customer.clientCode != null ? String(wo.customer.clientCode).trim() || null : null,
          display_name: (() => {
            const n = String(wo.customer.name || "").trim();
            const code = wo.customer.clientCode != null ? String(wo.customer.clientCode).trim() : "";
            return code ? (n ? `${n} - ${code}` : code) : n;
          })(),
          email: wo.customer.email ?? null,
          phone: formatUsPhone(wo.customer.phone ?? null),
        }
      : null,
    builder: wo.builder
      ? {
          id: wo.builder.id,
          name: [wo.builder.firstName, wo.builder.lastName].filter(Boolean).join(" ").trim(),
          company: wo.builder.company,
          nickname: wo.builder.nickname ? String(wo.builder.nickname).trim() || null : null,
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
    invoices: wo.invoices
      ? wo.invoices
          .filter((inv) => inv.id && inv.status !== "void")
          .map((inv) => ({
            id: inv.id as string,
            invoice_number: inv.invoiceNumber || null,
            status: inv.status,
          }))
      : [],
  };
}

function mapMeeting(m: {
  id: string;
  title: string;
  status: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  allDay?: boolean;
  location: string | null;
  notes: string | null;
  customerId: string | null;
  assignedUserId: string | null;
  calendarId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  leadId?: string | null;
  customer?: { id: string; name: string } | null;
  assignedUser?: { id: string; name: string } | null;
  lead?: { id: string; name: string; phone: string | null; email: string | null; notes?: string | null; metadata: unknown } | null;
}) {
  const leadMeta =
    m.lead?.metadata && typeof m.lead.metadata === "object" && !Array.isArray(m.lead.metadata)
      ? (m.lead.metadata as Record<string, unknown>)
      : {};
  return {
    id: m.id,
    title: m.title,
    status: m.status,
    scheduled_start: m.scheduledStart.toISOString(),
    scheduled_end: m.scheduledEnd.toISOString(),
    all_day: Boolean(m.allDay),
    location: m.location,
    notes: m.notes,
    customer_id: m.customerId,
    assigned_user_id: m.assignedUserId,
    calendar_id: m.calendarId || null,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
    customer: m.customer ? { id: m.customer.id, name: m.customer.name } : null,
    assigned_user: m.assignedUser
      ? { id: m.assignedUser.id, name: m.assignedUser.name }
      : null,
    lead_id: m.leadId ?? null,
    lead: m.lead
      ? {
          id: m.lead.id,
          name: m.lead.name,
          phone: formatUsPhone(m.lead.phone),
          email: m.lead.email,
          notes: m.lead.notes ?? null,
          address: leadMeta.address != null ? String(leadMeta.address) : null,
        }
      : null,
  };
}

const relatedWoSelect = {
  id: true,
  number: true,
  title: true,
  sector: true,
  status: true,
} as const;

const woInclude = {
  customer: { select: { id: true, name: true, company: true, nickname: true, clientCode: true, customerType: true, email: true, phone: true, managers: true } },
  builder: { select: { id: true, firstName: true, lastName: true, company: true, email: true, nickname: true } },
  assignedUser: { select: { id: true, name: true } },
  crew: { select: { id: true, name: true, color: true } },
  relatedWorkOrder: { select: relatedWoSelect },
  relatedChildren: {
    where: { status: { not: "canceled" } },
    select: relatedWoSelect,
    orderBy: { createdAt: "asc" as const },
  },
  members: {
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  tempWorkers: { orderBy: { createdAt: "asc" as const } },
  quotes: {
    select: { quoteNumber: true, title: true, leadId: true, payload: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
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
    orderBy: { createdAt: "asc" as const },
    select: { id: true, invoiceNumber: true, amount: true, status: true, receipts: { select: { amount: true } } },
  },
};

function woIncludeFor(user: AuthedRequest["user"]) {
  return canSeeBilling(user) ? { ...woInclude, ...woBillingInclude } : woInclude;
}

async function leadNamesById(
  organizationId: string,
  rows: { quotes?: { leadId?: string | null }[] }[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows.flatMap((row) => (row.quotes || []).map((quote) => quote.leadId).filter((id): id is string => Boolean(id))),
    ),
  ];
  if (!ids.length) return new Map();
  const leads = await prisma.lead.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(leads.filter((lead) => lead.name.trim()).map((lead) => [lead.id, lead.name.trim()]));
}

function applyQuoteLead<T extends ReturnType<typeof mapWorkOrder>>(
  mapped: T,
  leadName: string | null,
): T {
  if (!leadName) return mapped;
  const source = String(mapped.source_name || "").trim();
  const placeholder = !source || /^orçamento\b/i.test(source) || /^quote\b/i.test(source);
  return {
    ...mapped,
    lead_name: leadName,
    source_name:
      !mapped.customer_id && !mapped.builder_id && placeholder ? leadName.slice(0, 200) : mapped.source_name,
  };
}

const BILLING_FILTERS = ["to_invoice", "awaiting_payment", "paid"] as const;

const lineItemBody = z.object({
  pricing_item_id: z.string().uuid().optional().nullable(),
  service_name: z.string().min(1).max(200),
  quantity_sqft: z.number().min(0).max(1_000_000),
  unit_price: z.number().min(-1_000_000).max(1_000_000),
  notes: z.string().max(2000).optional().nullable(),
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
        notes: item.notes != null && String(item.notes).trim() ? String(item.notes).trim().slice(0, 2000) : null,
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
  crew?: unknown;
}): string[] {
  const ids = new Set<string>();
  if (wo.assignedUserId) ids.add(wo.assignedUserId);
  for (const m of wo.members || []) ids.add(m.userId);
  const crew = wo.crew as { members?: { userId: string }[] } | null | undefined;
  for (const m of crew?.members || []) ids.add(m.userId);
  return [...ids];
}

const mtgInclude = {
  customer: { select: { id: true, name: true, clientCode: true } },
  assignedUser: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true, phone: true, email: true, notes: true, source: true, metadata: true } },
} as const;

/** Keep the lead's visit (Lead.metadata.visits) in step when its meeting changes on the agenda. */
async function syncLeadVisitFromMeeting(
  organizationId: string,
  meeting: { id: string; leadId: string | null; scheduledStart: Date; location: string | null; notes: string | null; status: string; assignedUserId: string | null },
) {
  if (!meeting.leadId) return;
  await withTenantTransaction(organizationId, async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: meeting.leadId! } });
    if (!lead || !lead.metadata || typeof lead.metadata !== "object" || Array.isArray(lead.metadata)) return;
    const meta = lead.metadata as Record<string, unknown>;
    const visits = Array.isArray(meta.visits) ? (meta.visits as Array<Record<string, unknown>>) : [];
    const idx = visits.findIndex((v) => String(v.meeting_id || "") === meeting.id);
    if (idx < 0) return;
    visits[idx] = {
      ...visits[idx],
      scheduled_at: meeting.scheduledStart.toISOString(),
      address: meeting.location,
      notes: meeting.notes,
      seller_id: meeting.assignedUserId,
      status: meeting.status === "canceled" ? "cancelled" : meeting.status,
      updated_at: new Date().toISOString(),
    };
    meta.visits = visits;
    await tx.lead.update({ where: { id: lead.id }, data: { metadata: meta as Prisma.InputJsonValue } });
  });
}

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
      const pinId =
        typeof req.query.id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.query.id.trim())
          ? req.query.id.trim()
          : "";
      const jobNumber = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
      const leadHits = q
        ? await prisma.lead.findMany({
            where: { organizationId: req.organizationId!, name: { contains: q, mode: "insensitive" } },
            select: { id: true },
            take: 40,
          })
        : [];
      const leadIds = leadHits.map((lead) => lead.id);
      // Drop the first letter so a one-letter miss ("Invision") still matches "Envision".
      const stem = q.length >= 5 ? q.slice(1) : "";
      const searchOr = q
        ? [
            { title: { contains: q, mode: "insensitive" as const } },
            { sourceName: { contains: q, mode: "insensitive" as const } },
            { clientRef: { contains: q, mode: "insensitive" as const } },
            ...(stem
              ? [
                  { title: { contains: stem, mode: "insensitive" as const } },
                  { sourceName: { contains: stem, mode: "insensitive" as const } },
                ]
              : []),
            { address: { contains: q, mode: "insensitive" as const } },
            { customer: { name: { contains: q, mode: "insensitive" as const } } },
            { customer: { company: { contains: q, mode: "insensitive" as const } } },
            ...(stem
              ? [
                  { customer: { name: { contains: stem, mode: "insensitive" as const } } },
                  { customer: { company: { contains: stem, mode: "insensitive" as const } } },
                ]
              : []),
            { customer: { address: { contains: q, mode: "insensitive" as const } } },
            { builder: { company: { contains: q, mode: "insensitive" as const } } },
            { builder: { firstName: { contains: q, mode: "insensitive" as const } } },
            { builder: { lastName: { contains: q, mode: "insensitive" as const } } },
            ...(stem
              ? [
                  { builder: { company: { contains: stem, mode: "insensitive" as const } } },
                  { builder: { firstName: { contains: stem, mode: "insensitive" as const } } },
                  { builder: { lastName: { contains: stem, mode: "insensitive" as const } } },
                ]
              : []),
            { quotes: { some: { quoteNumber: { contains: q, mode: "insensitive" } } } },
            { quotes: { some: { title: { contains: q, mode: "insensitive" } } } },
            { quotes: { some: { payload: { path: ["job_name"], string_contains: q } } } },
            ...(leadIds.length ? [{ quotes: { some: { leadId: { in: leadIds } } } }] : []),
            ...(stem ? [{ quotes: { some: { title: { contains: stem, mode: "insensitive" } } } }] : []),
            ...(jobNumber != null ? [{ number: jobNumber }] : []),
          ]
        : null;

      const rows = await prisma.workOrder.findMany({
        where: {
          organizationId: req.organizationId!,
          ...(status && WO_STATUSES.includes(status as (typeof WO_STATUSES)[number])
            ? { status }
            : {}),
          ...(source && WO_SOURCES.includes(source as (typeof WO_SOURCES)[number])
            ? {
                // Builder filter includes legacy "contractor" rows (same pricing column).
                sourceType:
                  source === "builder" ? { in: ["builder", "contractor"] as const } : source,
              }
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
        orderBy: [{ createdAt: "desc" }],
        take: billingFilter ? 500 : 200,
      });
      if (pinId && !rows.some((row) => row.id === pinId)) {
        const extra = await prisma.workOrder.findFirst({
          where: { id: pinId, organizationId: req.organizationId!, ...fieldScope },
          include: woIncludeFor(req.user),
        });
        if (extra) rows.unshift(extra);
      }
      // Jobs that arrived through the builder portal stay on the list even when they
      // are older than the newest 200. Opening one from Pedidos is not required.
      const portalLinks = await prisma.partnerJobRequest.findMany({
        where: {
          organizationId: req.organizationId!,
          OR: [{ workOrderId: { not: null } }, { status: "pending", targetWorkOrderId: { not: null } }],
        },
        select: { workOrderId: true, targetWorkOrderId: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 400,
      });
      const portalSet = new Set<string>();
      const portalOrder: string[] = [];
      for (const link of portalLinks) {
        const id = link.workOrderId || (link.status === "pending" ? link.targetWorkOrderId : null);
        if (!id || portalSet.has(id)) continue;
        portalSet.add(id);
        portalOrder.push(id);
      }
      const have = new Set(rows.map((row) => row.id));
      const missing = q ? [] : portalOrder.filter((id) => !have.has(id)).slice(0, 80);
      if (missing.length) {
        const extras = await prisma.workOrder.findMany({
          where: {
            id: { in: missing },
            organizationId: req.organizationId!,
            status: { in: ["draft", "scheduled", "in_progress"] },
            ...(Object.keys(fieldScope).length ? { AND: [fieldScope] } : {}),
          },
          include: woIncludeFor(req.user),
        });
        const byId = new Map(extras.map((row) => [row.id, row]));
        for (const id of missing) {
          const row = byId.get(id);
          if (row) rows.push(row);
        }
      }
      const changedIds = await withTenantTransaction(req.organizationId!, (tx) =>
        ensureQuoteDiscountsOnJobs(
          tx,
          req.organizationId!,
          rows.map((row) => row.id),
        ),
      );
      if (changedIds.length) {
        const freshLines = await prisma.workOrderLineItem.findMany({
          where: { workOrderId: { in: changedIds }, organizationId: req.organizationId! },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: { pricingItem: { select: { unit: true } } },
        });
        const byJob = new Map<string, typeof freshLines>();
        for (const line of freshLines) {
          const list = byJob.get(line.workOrderId) || [];
          list.push(line);
          byJob.set(line.workOrderId, list);
        }
        for (const row of rows) {
          const next = byJob.get(row.id);
          if (next) row.lineItems = next;
        }
      }
      if (canSeeBilling(req.user)) {
        await withTenantTransaction(req.organizationId!, (tx) => foldUnlinkedQuoteInvoices(tx, rows));
      }
      const leadNames = await leadNamesById(req.organizationId!, rows);
      let data = rows.map((row) => ({
        ...applyQuoteLead(mapWorkOrder(row), row.quotes?.[0]?.leadId ? leadNames.get(row.quotes[0].leadId) || null : null),
        from_portal: portalSet.has(row.id),
      }));
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
      const jobId = String(req.params.id);
      try {
        await withTenantTransaction(req.organizationId!, async (tx) => {
          const quote = await tx.quote.findFirst({
            where: { workOrderId: jobId },
            select: { id: true },
            orderBy: { updatedAt: "desc" },
          });
          if (quote) {
            await alignLinkedJobAndQuote(tx, {
              organizationId: req.organizationId!,
              workOrderId: jobId,
            });
            const { linkQuoteInvoicesToWorkOrder } = await import("../../lib/work-orders/from-quote.js");
            await linkQuoteInvoicesToWorkOrder(tx, quote.id, jobId);
            return;
          }
          await ensureQuoteDiscountOnJob(tx, req.organizationId!, jobId);
        });
      } catch (err) {
        console.error("[jobs] sync quote onto job failed", {
          jobId,
          err: err instanceof Error ? err.message : err,
        });
      }
      const row = await prisma.workOrder.findFirst({
        where: {
          id: jobId,
          organizationId: req.organizationId!,
          ...fieldWorkOrderScope(req.user),
        },
        include: woIncludeFor(req.user),
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Work order not found" });
        return;
      }
      const leadNames = await leadNamesById(req.organizationId!, [row]);
      const leadName = row.quotes?.[0]?.leadId ? leadNames.get(row.quotes[0].leadId) || null : null;
      res.json({ success: true, data: applyQuoteLead(mapWorkOrder(row), leadName) });
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
  client_ref: z.string().max(120).optional().nullable(),
  manager_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  campo_attention: z.string().max(2000).optional().nullable(),
  needs_delivery: z.boolean().optional(),
  delivery_pickup_address: z.string().max(500).optional().nullable(),
  delivery_notes: z.string().max(4000).optional().nullable(),
  clear_delivery_attachment: z.boolean().optional(),
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
  sector: z.enum(WO_SECTORS as [string, ...string[]]).optional().nullable(),
  related_work_order_id: z.string().uuid().optional().nullable(),
  member_user_ids: z.array(z.string().uuid()).optional(),
  line_items: z.array(lineItemBody).max(50).optional(),
  scheduled_start: z.string().datetime().optional().nullable(),
  scheduled_end: z.string().datetime().optional().nullable(),
  sand_scheduled_start: z.string().datetime().optional().nullable(),
  all_day: z.boolean().optional(),
});

async function managerForJob(
  organizationId: string,
  customerId: string | null,
  builderId: string | null,
  managerId: string | null | undefined,
): Promise<string | null> {
  if (!managerId) return null;
  let ownerId = customerId;
  if (!ownerId && builderId) {
    const builder = await prisma.builder.findFirst({
      where: { id: builderId, organizationId },
      select: { customerId: true },
    });
    ownerId = builder?.customerId || null;
  }
  if (!ownerId) {
    const err = new Error("Cadastre o builder em Clients para atribuir um manager.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const customer = await prisma.customer.findFirst({
    where: { id: ownerId, organizationId },
    select: { managers: true },
  });
  return managerIdOrNull(customer?.managers, managerId);
}

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
      if (d.campo_checklist !== undefined) {
        const org = await prisma.organization.findUnique({
          where: { id: req.organizationId! },
          select: { featureFlags: true },
        });
        if (!isJobChecklistEnabled(org?.featureFlags)) delete d.campo_checklist;
      }
      const start = d.scheduled_start ? new Date(d.scheduled_start) : null;
      const end = d.scheduled_end ? new Date(d.scheduled_end) : null;
      // Start-only is allowed (open-ended jobs); end without start is not.
      if (!start && end) {
        res.status(400).json({ success: false, error: "Informe a data/hora de início antes do fim" });
        return;
      }
      if (start && end && end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "O fim precisa ser depois do início" });
        return;
      }

      let status = d.status ?? "draft";
      if (!d.status && start) status = "scheduled";

      const relatedId = await resolveRelatedWorkOrderId(
        req.organizationId!,
        d.related_work_order_id || null,
      ).catch((e: Error & { status?: number }) => {
        res.status(e.status || 400).json({ success: false, error: e.message });
        return "__abort__" as const;
      });
      if (relatedId === "__abort__") return;

      const managerId = await managerForJob(
        req.organizationId!,
        d.customer_id || null,
        d.builder_id || null,
        d.manager_id,
      ).catch((e: Error & { status?: number }) => {
        res.status(e.status || 400).json({ success: false, error: e.message });
        return "__abort__" as const;
      });
      if (managerId === "__abort__") return;

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
          clientRef: d.client_ref?.trim() || null,
          managerId,
          notes: d.notes?.trim() || null,
          campoAttention: d.campo_attention?.trim() || null,
          needsDelivery: d.needs_delivery === true,
          deliveryPickupAddress: d.needs_delivery === true ? d.delivery_pickup_address?.trim() || null : null,
          deliveryNotes: d.needs_delivery === true ? d.delivery_notes?.trim() || null : null,
          ...(d.campo_checklist?.length ? { campoChecklist: mergeOfficeChecklist(null, d.campo_checklist) } : {}),
          assignedUserId: d.assigned_user_id || null,
          crewId: d.crew_id || null,
          sector: normalizeWoSector(d.sector),
          relatedWorkOrderId: relatedId,
          scheduledStart: start,
          scheduledEnd: end,
          sandScheduledStart:
            normalizeWoSector(d.sector) === COMBINED_PHASE && d.sand_scheduled_start
              ? new Date(d.sand_scheduled_start)
              : null,
          allDay: Boolean(start),
        },
      });
      await syncWorkOrderMembers(req.organizationId!, row.id, d.member_user_ids);
      await syncWorkOrderLineItems(req.organizationId!, row.id, d.line_items);
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await ensureJobChatChannel(tx, req.organizationId!, row.id);
        if (d.line_items !== undefined) {
          await ensureQuoteDiscountOnJob(tx, req.organizationId!, row.id);
        }
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
  requireCrmPermission("work_orders.manage", "schedule.manage"),
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
      if (d.campo_checklist !== undefined) {
        const org = await prisma.organization.findUnique({
          where: { id: req.organizationId! },
          select: { featureFlags: true },
        });
        if (!isJobChecklistEnabled(org?.featureFlags)) delete d.campo_checklist;
      }
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
        res.status(400).json({ success: false, error: "O fim precisa ser depois do início" });
        return;
      }

      let relatedResolved: string | null | undefined = undefined;
      if (d.related_work_order_id !== undefined) {
        try {
          relatedResolved = await resolveRelatedWorkOrderId(
            req.organizationId!,
            d.related_work_order_id || null,
            existing.id,
          );
        } catch (e) {
          const err = e as Error & { status?: number };
          res.status(err.status || 400).json({ success: false, error: err.message });
          return;
        }
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

      const finish = d.status !== undefined ? sectorFinishPatch(existing, d.status) : null;
      let managerId: string | null | undefined = undefined;
      if (d.manager_id !== undefined) {
        const resolved = await managerForJob(
          req.organizationId!,
          d.customer_id !== undefined ? d.customer_id || null : existing.customerId,
          d.builder_id !== undefined ? d.builder_id || null : existing.builderId,
          d.manager_id,
        ).catch((e: Error & { status?: number }) => {
          res.status(e.status || 400).json({ success: false, error: e.message });
          return "__abort__" as const;
        });
        if (resolved === "__abort__") return;
        managerId = resolved;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const updated = await tx.workOrder.update({
          where: { id: existing.id },
          data: {
          ...(d.title !== undefined ? { title: d.title.trim() } : {}),
          ...(finish
            ? {
                status: finish.status,
                ...("installationDoneAt" in finish ? { installationDoneAt: finish.installationDoneAt } : {}),
                ...("sandDoneAt" in finish ? { sandDoneAt: finish.sandDoneAt } : {}),
              }
            : {}),
          ...(d.source_type !== undefined ? { sourceType: d.source_type } : {}),
          ...(d.source_name !== undefined ? { sourceName: d.source_name?.trim() || null } : {}),
          ...(d.customer_id !== undefined ? { customerId: d.customer_id || null } : {}),
          ...(d.builder_id !== undefined ? { builderId: d.builder_id || null } : {}),
          ...(d.builder_id !== undefined && (d.builder_id || null) !== existing.builderId
            ? { deliveryAttachmentSharedWithPartners: false }
            : {}),
          ...(d.address !== undefined ? { address: d.address?.trim() || null } : {}),
          ...(d.client_ref !== undefined ? { clientRef: d.client_ref?.trim().slice(0, 120) || null } : {}),
          ...(managerId !== undefined ? { managerId } : {}),
          // New address → forget the cached job location (re-geocoded on the next work day).
          ...(d.address !== undefined && (d.address?.trim() || null) !== existing.address
            ? { geoLat: null, geoLng: null, geoCheckedAt: null }
            : {}),
          ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
          ...(d.campo_attention !== undefined ? { campoAttention: d.campo_attention?.trim() || null } : {}),
          ...(d.needs_delivery !== undefined ? { needsDelivery: d.needs_delivery === true } : {}),
          ...(d.needs_delivery === false
            ? {
                deliveryPickupAddress: null,
                deliveryNotes: null,
                deliveryAttachmentUrl: null,
                deliveryAttachmentKey: null,
                deliveryAttachmentName: null,
                deliveryAttachmentSharedWithPartners: false,
              }
            : {
                ...(d.delivery_pickup_address !== undefined
                  ? { deliveryPickupAddress: d.delivery_pickup_address?.trim() || null }
                  : {}),
                ...(d.delivery_notes !== undefined ? { deliveryNotes: d.delivery_notes?.trim() || null } : {}),
                ...(d.clear_delivery_attachment
                  ? { deliveryAttachmentUrl: null, deliveryAttachmentKey: null, deliveryAttachmentName: null, deliveryAttachmentSharedWithPartners: false }
                  : {}),
              }),
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
          ...(d.line_items !== undefined && d.title === undefined ? { title: existing.title } : {}),
          ...(d.sector !== undefined ? { sector: normalizeWoSector(d.sector) } : {}),
          ...(relatedResolved !== undefined ? { relatedWorkOrderId: relatedResolved } : {}),
          ...(d.scheduled_start !== undefined || d.scheduled_end !== undefined
            ? { scheduledStart: start, scheduledEnd: end, allDay: Boolean(start) }
            : {}),
          ...(d.sand_scheduled_start !== undefined || (d.sector !== undefined && normalizeWoSector(d.sector) !== COMBINED_PHASE)
            ? {
                sandScheduledStart:
                  (d.sector !== undefined ? normalizeWoSector(d.sector) : existing.sector) === COMBINED_PHASE &&
                  d.sand_scheduled_start
                    ? new Date(d.sand_scheduled_start)
                    : null,
              }
            : {}),
          // Re-arm start reminders when the start time moves.
          ...(scheduleChanged
            ? { startReminderSentAt: null, startNudgeSentAt: null }
            : {}),
          },
        });
        if (d.builder_id !== undefined && (d.builder_id || null) !== existing.builderId) {
          await Promise.all([
            tx.jobMedia.updateMany({ where: { workOrderId: existing.id }, data: { sharedWithPartners: false } }),
            tx.jobReport.updateMany({ where: { workOrderId: existing.id }, data: { sharedWithPartners: false } }),
          ]);
        }
        if (d.client_ref !== undefined) {
          const quote = await tx.quote.findFirst({
            where: { workOrderId: existing.id },
            orderBy: { updatedAt: "desc" },
          });
          if (quote) {
            const payload =
              quote.payload && typeof quote.payload === "object" && !Array.isArray(quote.payload)
                ? { ...(quote.payload as Record<string, unknown>) }
                : {};
            payload.job_name = d.client_ref?.trim().slice(0, 120) || null;
            await tx.quote.update({
              where: { id: quote.id },
              data: { payload: payload as Prisma.InputJsonValue },
            });
          }
        }
        return updated;
      });
      await syncWorkOrderMembers(req.organizationId!, row.id, d.member_user_ids);
      await syncWorkOrderLineItems(req.organizationId!, row.id, d.line_items);
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await ensureJobChatChannel(tx, req.organizationId!, row.id);
        if (d.line_items !== undefined) {
          await syncLinkedQuoteFromJob(tx, { organizationId: req.organizationId!, workOrderId: row.id });
          await ensureQuoteDiscountOnJob(tx, req.organizationId!, row.id);
        }
      });
      if (existing.status === "canceled" && d.status && d.status !== "canceled") {
        try {
          await withTenantTransaction(req.organizationId!, async (tx) => {
            const quote = await tx.quote.findFirst({
              where: { workOrderId: row.id },
              select: { id: true },
              orderBy: { updatedAt: "desc" },
            });
            if (quote) {
              await syncLinkedJobFromQuote(tx, {
                organizationId: req.organizationId!,
                quoteId: quote.id,
              });
            }
          });
        } catch (err) {
          console.error("[jobs] reopen sync failed", {
            jobId: row.id,
            err: err instanceof Error ? err.message : err,
          });
        }
      }
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

      const leadNames = await leadNamesById(req.organizationId!, [full!]);
      const leadName = full!.quotes?.[0]?.leadId ? leadNames.get(full!.quotes[0].leadId) || null : null;
      res.json({ success: true, data: applyQuoteLead(mapWorkOrder(full!), leadName), conflicts });
    } catch (error) {
      next(error);
    }
  },
);

function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1]!, body: Buffer.from(match[2]!, "base64") };
}

/** Office upload for Delivery attachment (PO / PDF / photo). */
scheduleJobsRouter.post(
  "/api/work-orders/:id/delivery-attachment",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.id);
      const raw = (req.body || {}) as Record<string, unknown>;
      const dataUrl = String(raw.data_url || raw.dataUrl || "");
      const fileName = String(raw.file_name || raw.fileName || "anexo").slice(0, 180);
      if (!dataUrl.startsWith("data:")) {
        res.status(400).json({ success: false, error: "data_url obrigatório" });
        return;
      }
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) {
        res.status(400).json({ success: false, error: "Arquivo inválido" });
        return;
      }
      if (parsed.body.length > 12 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Arquivo grande demais (máx. 12MB)" });
        return;
      }
      const existing = await prisma.workOrder.findFirst({
        where: { id: jobId, organizationId: req.organizationId!, status: { not: "canceled" } },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Job não encontrado" });
        return;
      }
      const ct = String(parsed.contentType || "").toLowerCase();
      const ext = ct.includes("pdf")
        ? "pdf"
        : ct.includes("png")
          ? "png"
          : ct.includes("jpeg") || ct.includes("jpg")
            ? "jpg"
            : ct.includes("webp")
              ? "webp"
              : "bin";
      const key = `orgs/${req.organizationId}/jobs/${jobId}/delivery/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
      const stored = await storage.upload({
        key,
        body: parsed.body,
        contentType: parsed.contentType || "application/octet-stream",
      });
      const row = await prisma.workOrder.update({
        where: { id: existing.id },
        data: {
          needsDelivery: true,
          deliveryAttachmentUrl: stored.url,
          deliveryAttachmentKey: stored.key,
          deliveryAttachmentName: fileName || `anexo.${ext}`,
          deliveryAttachmentSharedWithPartners: false,
        },
        include: woIncludeFor(req.user),
      });
      res.status(201).json({ success: true, data: mapWorkOrder(row) });
    } catch (error) {
      next(error);
    }
  },
);

scheduleJobsRouter.patch(
  "/api/work-orders/:id/delivery-attachment/share-with-partner",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z.object({ shared_with_partners: z.boolean() }).safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Informe se o arquivo deve ser compartilhado." });
        return;
      }
      const jobId = String(req.params.id);
      const existing = await prisma.workOrder.findFirst({
        where: { id: jobId, organizationId: req.organizationId!, status: { not: "canceled" } },
        select: { id: true, builderId: true, deliveryAttachmentKey: true, customer: { select: { customerType: true } } },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Job não encontrado" });
        return;
      }
      const customerType = String(existing.customer?.customerType || "").toLowerCase();
      const hasPartner = Boolean(existing.builderId) || ["builder", "contractor"].includes(customerType);
      if (parsed.data.shared_with_partners && (!hasPartner || !existing.deliveryAttachmentKey)) {
        res.status(409).json({ success: false, error: "Vincule um parceiro e anexe um arquivo antes de compartilhar." });
        return;
      }
      const updated = await prisma.workOrder.update({
        where: { id: existing.id },
        data: { deliveryAttachmentSharedWithPartners: parsed.data.shared_with_partners },
        select: { deliveryAttachmentSharedWithPartners: true },
      });
      res.json({ success: true, data: { shared_with_partners: updated.deliveryAttachmentSharedWithPartners } });
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
            name: formatPersonName(d.name),
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
        res.status(404).json({ success: false, error: "Compromisso não encontrado" });
        return;
      }
      res.json({ success: true, data: mapMeeting(row) });
    } catch (error) {
      next(error);
    }
  },
);

/** One-shot .ics → Apple Calendar (?link=1 = public URL JSON; else inline .ics). */
scheduleJobsRouter.get(
  "/api/meetings/:id/calendar.ics",
  requireCrmAuth,
  requireCrmPermission("schedule.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const wantLink =
        String(req.query.link || "") === "1" ||
        String(req.headers.accept || "").includes("application/json");
      const row = await prisma.meeting.findFirst({
        where: {
          id: String(req.params.id),
          organizationId: req.organizationId!,
          ...fieldMeetingScope(req.user),
        },
        include: {
          lead: { select: { id: true, name: true, phone: true, email: true, notes: true, source: true, metadata: true } },
        },
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Compromisso não encontrado" });
        return;
      }
      const token = signIcsAccessToken("meeting", req.organizationId!, row.id);
      const publicUrl = `${publicBaseUrl(req).replace(/\/$/, "")}/feeds/meeting/${token}.ics`;
      if (wantLink) {
        res.setHeader("Cache-Control", "no-store");
        res.json({ success: true, data: { url: publicUrl } });
        return;
      }
      const leadMeta =
        row.lead?.metadata && typeof row.lead.metadata === "object" && !Array.isArray(row.lead.metadata)
          ? (row.lead.metadata as Record<string, unknown>)
          : {};
      const metaStr = (key: string) => {
        const v = leadMeta[key];
        return v != null && String(v).trim() ? String(v).trim() : null;
      };
      const leadForCal = row.lead
        ? {
            name: row.lead.name,
            phone: formatUsPhone(row.lead.phone),
            email: row.lead.email,
            notes: row.lead.notes,
            source: row.lead.source,
            address: metaStr("address"),
            address_line1: metaStr("address_line1") || metaStr("address"),
            address_line2: metaStr("address_line2"),
            city: metaStr("city"),
            zipcode: metaStr("zipcode"),
            message: metaStr("message"),
            form_type: metaStr("form_type"),
            marketing_platform: metaStr("marketing_platform"),
            utm_source: metaStr("utm_source"),
            utm_medium: metaStr("utm_medium"),
            landing_page: metaStr("landing_page"),
            gclid: metaStr("gclid"),
            fbclid: metaStr("fbclid"),
          }
        : null;
      const summary = buildMeetingCalendarSummary({
        title: row.title,
        leadName: row.lead?.name,
        isVisit: Boolean(row.leadId),
        lead: leadForCal,
        clientId: clientIdFromLeadRecord(row.lead),
      });
      const description = buildMeetingCalendarDescription({
        notes: row.notes,
        location: row.location,
        lead: leadForCal,
      });
      const ics = buildSingleEventIcs(
        {
          uid: `meeting-${row.id}@obramate.com`,
          summary,
          description: description || undefined,
          location: row.location || leadForCal?.address_line1 || leadForCal?.address || undefined,
          start: row.scheduledStart,
          end: row.scheduledEnd,
          stamp: row.updatedAt || new Date(),
          status: meetingStatusToIcs(row.status),
        },
        { name: summary || "ObraMate" },
      );
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="meeting.ics"');
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(ics);
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
  all_day: z.boolean().optional(),
  location: z.string().max(500).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  assigned_user_id: z.string().uuid().optional().nullable(),
  calendar_id: z.string().uuid().optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
});

scheduleJobsRouter.post(
  "/api/meetings",
  requireCrmAuth,
  requireCrmPermission("schedule.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = meetingBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Dados do compromisso inválidos" });
        return;
      }
      const d = parsed.data;
      const start = new Date(d.scheduled_start);
      let end = new Date(d.scheduled_end);
      if (d.lead_id) end = visitBlockEnd(start, Boolean(d.all_day));
      if (end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "O fim precisa ser depois do início" });
        return;
      }
      const row = await prisma.meeting.create({
        data: {
          organizationId: req.organizationId!,
          title: d.title.trim(),
          status: d.status ?? "scheduled",
          scheduledStart: start,
          scheduledEnd: end,
          allDay: Boolean(d.all_day),
          location: d.location?.trim() || null,
          notes: d.notes?.trim() || null,
          customerId: d.customer_id || null,
          assignedUserId: d.assigned_user_id || null,
          calendarId: d.calendar_id || null,
          leadId: d.lead_id || null,
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
        res.status(404).json({ success: false, error: "Compromisso não encontrado" });
        return;
      }
      const parsed = meetingBody.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Dados do compromisso inválidos" });
        return;
      }
      const d = parsed.data;
      const start = d.scheduled_start ? new Date(d.scheduled_start) : existing.scheduledStart;
      let end = d.scheduled_end ? new Date(d.scheduled_end) : existing.scheduledEnd;
      const isVisit = Boolean(d.lead_id !== undefined ? d.lead_id : existing.leadId);
      const allDay = d.all_day !== undefined ? Boolean(d.all_day) : Boolean(existing.allDay);
      const touchesTime =
        d.scheduled_start !== undefined || d.scheduled_end !== undefined || d.all_day !== undefined;
      if (isVisit && touchesTime) end = visitBlockEnd(start, allDay);
      if (end.getTime() <= start.getTime()) {
        res.status(400).json({ success: false, error: "O fim precisa ser depois do início" });
        return;
      }
      const row = await prisma.meeting.update({
        where: { id: existing.id },
        data: {
          ...(d.title !== undefined ? { title: d.title.trim() } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.scheduled_start !== undefined || (isVisit && touchesTime) ? { scheduledStart: start } : {}),
          ...(d.scheduled_end !== undefined || (isVisit && touchesTime) ? { scheduledEnd: end } : {}),
          ...(d.all_day !== undefined ? { allDay: Boolean(d.all_day) } : {}),
          ...(d.location !== undefined ? { location: d.location?.trim() || null } : {}),
          ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
          ...(d.customer_id !== undefined ? { customerId: d.customer_id || null } : {}),
          ...(d.assigned_user_id !== undefined
            ? { assignedUserId: d.assigned_user_id || null }
            : {}),
          ...(d.calendar_id !== undefined ? { calendarId: d.calendar_id || null } : {}),
          ...(d.lead_id !== undefined ? { leadId: d.lead_id || null } : {}),
        },
        include: mtgInclude,
      });
      await syncLeadVisitFromMeeting(req.organizationId!, row);
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
        res.status(404).json({ success: false, error: "Compromisso não encontrado" });
        return;
      }
      const row = await prisma.meeting.update({
        where: { id: existing.id },
        data: { status: "canceled" },
        include: mtgInclude,
      });
      await syncLeadVisitFromMeeting(req.organizationId!, row);
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

      const [workOrders, meetings, org, nickBuilders] = await Promise.all([
        prisma.workOrder.findMany({
          where: {
            organizationId: req.organizationId!,
            status: { not: "canceled" },
            AND: [
              {
                OR: [
                  {
                    scheduledStart: { not: null, lte: to },
                    OR: [{ scheduledEnd: null }, { scheduledEnd: { gte: from } }],
                  },
                  { sandScheduledStart: { gte: from, lte: to } },
                ],
              },
              ...(shouldScopeJobsToSelf(req.user) && req.user?.id ? [myJobAccessWhere(req.user.id)] : []),
            ],
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
        prisma.organization.findUnique({
          where: { id: req.organizationId! },
          select: { scheduleSettings: true },
        }),
        prisma.builder.findMany({
          where: { organizationId: req.organizationId!, nickname: { not: null } },
          select: { nickname: true, company: true, email: true, firstName: true, lastName: true },
        }),
      ]);

      const sched = parseScheduleSettings(org?.scheduleSettings);
      const visitCalId = resolveVisitCalendarId(sched);
      const quoteLeadIds = [
        ...new Set(
          workOrders.flatMap((wo) =>
            (wo.quotes || []).map((q) => q.leadId).filter((id): id is string => Boolean(id)),
          ),
        ),
      ];
      const originLeads = quoteLeadIds.length
        ? await prisma.lead.findMany({
            where: { organizationId: req.organizationId!, id: { in: quoteLeadIds } },
            select: { id: true, source: true, metadata: true },
          })
        : [];
      const originByLead = new Map(originLeads.map((lead) => [lead.id, lead]));
      const jobEvents = workOrders.flatMap((wo) => {
        const slots: Array<{ at: Date; sand: boolean }> = [];
        const awaitingSand =
          wo.sector === COMBINED_PHASE && Boolean(wo.installationDoneAt) && !wo.sandDoneAt && wo.status !== "canceled";
        if (wo.scheduledStart && !awaitingSand) slots.push({ at: wo.scheduledStart, sand: false });
        if (wo.sector === COMBINED_PHASE && wo.sandScheduledStart) slots.push({ at: wo.sandScheduledStart, sand: true });
        return slots.map(({ at, sand }) => {
          const sector = sand ? PHASE_KEYS[1]! : wo.sector === COMBINED_PHASE ? PHASE_KEYS[0]! : wo.sector;
          const jobCal = resolveJobCalendar(sched, sector);
          const endIso = new Date(at.getTime() + 24 * 60 * 60 * 1000).toISOString();
          const sectorLabel = sand ? phaseLabel(PHASE_KEYS[1]!, "en-US") : wo.sector === COMBINED_PHASE ? phaseLabel(PHASE_KEYS[0]!, "en-US") : "";
          const quote = wo.quotes?.[0];
          const lead = quote?.leadId ? originByLead.get(quote.leadId) : undefined;
          const clientRef =
            (wo.clientRef && String(wo.clientRef).trim()) ||
            quoteNoteOf(quote?.payload) ||
            clientIdFromLeadRecord(lead) ||
            null;
          const builderName = wo.builder
            ? [wo.builder.firstName, wo.builder.lastName].filter(Boolean).join(" ").trim()
            : null;
          const builderParty = isBuilderParty(wo.sourceType, wo.builderId, wo.customer?.customerType);
          const directNick = wo.customer?.nickname || (builderParty ? wo.builder?.nickname : null);
          const who = builderParty
            ? calendarNickFromBuilders(
                { nickname: directNick, company: wo.builder?.company || wo.customer?.company },
                [wo.builder?.company, builderName, wo.customer?.company, wo.customer?.name, wo.sourceName],
                [wo.builder?.email, wo.customer?.email],
                nickBuilders.map((b) => ({
                  nickname: b.nickname,
                  company: b.company,
                  email: b.email,
                  name: [b.firstName, b.lastName].filter(Boolean).join(" ").trim(),
                })),
              )
            : { nickname: directNick, company: wo.builder?.company || wo.customer?.company || null };
          const base = jobCalendarTitle({
            sourceType: wo.sourceType,
            builderId: wo.builderId,
            title: wo.title,
            address: wo.address,
            clientRef,
            sourceName: wo.sourceName,
            customerName: wo.customer?.name,
            customerType: wo.customer?.customerType,
            nickname: who.nickname,
            company: who.company,
            builderName,
            origin: originFromLeadRecord(lead),
          });
          const calendarName = sectorLabel ? `${base} · ${sectorLabel}` : base;
          return {
            id: sand ? `${wo.id}:sand` : wo.id,
            type: "job" as const,
            title: wo.title,
            label: calendarName,
            status: wo.status,
            start: at.toISOString(),
            end: endIso,
            all_day: true,
            calendar_id: jobCal.id,
            color: resolveJobColor(sched, wo.crew?.color || null, sector),
            meta: { ...mapWorkOrder(wo), date_role: sand ? "sand" : "main" },
          };
        });
      });
      const events = [
        ...jobEvents,
        ...meetings.map((m) => ({
          id: m.id,
          // A meeting booked from a lead is a site visit.
          type: (m.leadId ? "visit" : "meeting") as "visit" | "meeting",
          title: m.leadId && m.lead ? m.lead.name : m.title,
          label:
            m.leadId && m.lead
              ? personCalendarTitle(m.lead.name, {
                  origin: originFromLeadRecord(m.lead),
                  clientId: clientIdFromLeadRecord(m.lead),
                })
              : m.title,
          status: m.status,
          start: m.scheduledStart.toISOString(),
          end: m.scheduledEnd.toISOString(),
          all_day: Boolean(m.allDay),
          // Visits / meetings follow Configurações › Agenda (visits fall back to meetings calendar).
          calendar_id: m.leadId ? visitCalId : m.calendarId || "meetings",
          color: m.leadId ? resolveVisitColor(sched) : resolveMeetingColor(sched, m.calendarId),
          meta: mapMeeting(m),
        })),
      ].sort((a, b) => a.start.localeCompare(b.start));

      res.json({ success: true, data: events });
    } catch (error) {
      next(error);
    }
  },
);
