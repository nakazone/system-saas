/**
 * Office view of what happened in the field on a job: checklist progress, hours by person,
 * measurements, the field "attention" box and any problem reported.
 *
 * The Campo routes only answer the people assigned to the job; this one follows the
 * normal Jobs visibility (office sees all, field roles only their jobs).
 */
import { Router } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { prisma } from "../../lib/prisma.js";
import { fieldStatusLabel, myJobAccessWhere, parseChecklist } from "../lib/campo-shared.js";
import { isFieldMeasureEnabled } from "../../lib/job-media/ocr.js";
import { isJobChecklistEnabled } from "../../lib/settings/jobs.js";

export const jobFieldSummaryRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFICE_ROLES = new Set(["admin", "general_manager", "office", "sales"]);
const FIELD_ROLES = new Set(["installer", "crew_lead", "subcontractor"]);

function scopeToSelf(user: AuthedRequest["user"]): boolean {
  if (!user?.id) return false;
  const role = String(user.roleKey || "").toLowerCase();
  if (FIELD_ROLES.has(role)) return true;
  if (OFFICE_ROLES.has(role)) return false;
  const p = user.permissions || [];
  return !(p.includes("work_orders.manage") || p.includes("schedule.manage"));
}

const WORK_KINDS = new Set(["on_site", "travel", "shopping"]);

export type HoursRow = { user_id: string; name: string; hours: number; on_site_hours: number; sqft: number; days: number };

/** Hours per person from clock segments (open ones count until now) plus manual entries. */
export function summarizeHours(
  segments: { startedAt: Date; endedAt: Date | null; activityKind: string; userId: string; userName: string; workDate: Date }[],
  manual: { userId: string; userName: string; entryType: string; activityKind: string | null; hours: unknown; sqft: unknown; workDate: Date }[],
  now = new Date(),
): HoursRow[] {
  const by = new Map<string, HoursRow & { dayset: Set<string> }>();
  const row = (id: string, name: string) => {
    let r = by.get(id);
    if (!r) {
      r = { user_id: id, name, hours: 0, on_site_hours: 0, sqft: 0, days: 0, dayset: new Set() };
      by.set(id, r);
    }
    return r;
  };
  for (const s of segments) {
    if (!WORK_KINDS.has(s.activityKind)) continue;
    const end = s.endedAt ?? now;
    const h = Math.max(0, (end.getTime() - s.startedAt.getTime()) / 3600000);
    const r = row(s.userId, s.userName);
    r.hours += h;
    if (s.activityKind === "on_site") r.on_site_hours += h;
    r.dayset.add(s.workDate.toISOString().slice(0, 10));
  }
  for (const m of manual) {
    const r = row(m.userId, m.userName);
    if (m.entryType === "production") {
      r.sqft += dec(m.sqft);
    } else {
      const h = dec(m.hours);
      r.hours += h;
      if (!m.activityKind || m.activityKind === "on_site") r.on_site_hours += h;
    }
    r.dayset.add(m.workDate.toISOString().slice(0, 10));
  }
  return [...by.values()]
    .map(({ dayset, ...r }) => ({
      ...r,
      hours: Math.round(r.hours * 100) / 100,
      on_site_hours: Math.round(r.on_site_hours * 100) / 100,
      sqft: Math.round(r.sqft * 100) / 100,
      days: dayset.size,
    }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}

jobFieldSummaryRouter.get(
  "/api/work-orders/:id/field",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const org = await prisma.organization.findFirst({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      const measuresOn = isFieldMeasureEnabled(org?.featureFlags);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id, ...(scopeToSelf(req.user) ? myJobAccessWhere(req.user!.id) : {}) },
          select: {
            id: true,
            status: true,
            fieldStatus: true,
            campoAttention: true,
            campoChecklist: true,
            campoProblemNote: true,
          },
        });
        if (!wo) return null;
        const [segments, manual, measurements, inspections] = await Promise.all([
          tx.campoSegment.findMany({
            where: { workOrderId: id },
            select: {
              startedAt: true,
              endedAt: true,
              activityKind: true,
              shift: { select: { workDate: true, userId: true, user: { select: { name: true, email: true } } } },
            },
          }),
          tx.campoManualEntry.findMany({
            where: { workOrderId: id },
            select: {
              entryType: true,
              activityKind: true,
              hours: true,
              sqft: true,
              workDate: true,
              userId: true,
              user: { select: { name: true, email: true } },
            },
          }),
          measuresOn
            ? tx.jobMeasurement.findMany({ where: { workOrderId: id }, orderBy: { createdAt: "desc" }, take: 30 })
            : Promise.resolve([]),
          tx.jobInspection.findMany({
            where: { workOrderId: id },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, status: true, summary: true, transcript: true, createdAt: true },
          }),
        ]);
        const checklist = parseChecklist(wo.campoChecklist);
        const hasCustomChecklist = Array.isArray(wo.campoChecklist) && (wo.campoChecklist as unknown[]).length > 0;
        const checklistOn = isJobChecklistEnabled(org?.featureFlags);
        const hours = summarizeHours(
          segments.filter((s): s is typeof s & { shift: { userId: string } } => Boolean(s.shift.userId)).map((s) => ({
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            activityKind: s.activityKind,
            userId: s.shift.userId,
            userName: s.shift.user?.name || s.shift.user?.email || "—",
            workDate: s.shift.workDate,
          })),
          manual.map((m) => ({
            userId: m.userId,
            userName: m.user?.name || m.user?.email || "—",
            entryType: m.entryType,
            activityKind: m.activityKind,
            hours: m.hours,
            sqft: m.sqft,
            workDate: m.workDate,
          })),
        );
        const field = wo.fieldStatus || "scheduled";
        return {
          field_status: field,
          field_status_label: fieldStatusLabel(field),
          attention: wo.campoAttention || null,
          problem_note: wo.campoProblemNote || null,
          checklist_enabled: checklistOn,
          checklist: checklistOn
            ? {
                items: checklist.map((c) => ({
                  id: c.id,
                  text: c.text,
                  done: c.done,
                  photo_required: Boolean(c.photo_required),
                  photos: (c.photo_media_ids || []).length,
                  done_at: c.done_at || null,
                  done_by: c.done_by || null,
                  note: c.note || null,
                })),
                done: checklist.filter((c) => c.done).length,
                total: checklist.length,
                /** false = still the default template; the crew has not set it up for this job. */
                customized: hasCustomChecklist,
              }
            : { items: [], done: 0, total: 0, customized: false },
          hours: {
            people: hours,
            total: Math.round(hours.reduce((s, r) => s + r.hours, 0) * 100) / 100,
            sqft: Math.round(hours.reduce((s, r) => s + r.sqft, 0) * 100) / 100,
          },
          measurements: measurements.map((m) => ({
            id: m.id,
            label: m.label,
            kind: m.kind,
            value: dec(m.value),
            unit: m.unit,
            note: m.note,
            created_at: m.createdAt.toISOString(),
          })),
          inspections: inspections.map((i) => ({
            id: i.id,
            status: i.status,
            summary: i.summary || (i.transcript ? i.transcript.slice(0, 280) : null),
            created_at: i.createdAt.toISOString(),
          })),
          campo_url: `/campo/ticket.html?id=${encodeURIComponent(wo.id)}`,
        };
      });
      if (!data) {
        res.status(404).json({ success: false, error: "Job não encontrado" });
        return;
      }
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);
