/**
 * Campo agenda + ticket (field-safe status, checklist, photos).
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { storage } from "../../lib/storage/index.js";
import { requireCrmAuth } from "../http.js";
import {
  assertMyJob,
  canUseCampo,
  ctaLabel,
  clientLabel,
  FIELD_STATUSES,
  fieldStatusLabel,
  hhmm,
  mapJobCard,
  myJobAccessWhere,
  nextFieldStatus,
  parseChecklist,
  parsePhotos,
  shortClient,
  teamLabel,
  woListInclude,
  dec,
  type FieldStatus,
  type PhotoItem,
} from "../lib/campo-shared.js";

export const campoJobsRouter = Router();

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeekMon(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1]!, body: Buffer.from(match[2]!, "base64") };
}

async function syncPontoForFieldStatus(
  tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  organizationId: string,
  userId: string,
  jobId: string,
  fieldStatus: FieldStatus,
) {
  const shift = await tx.campoShift.findFirst({
    where: { userId, status: "open" },
  });
  if (!shift) return;
  const now = new Date();
  await tx.campoSegment.updateMany({
    where: { shiftId: shift.id, endedAt: null },
    data: { endedAt: now },
  });
  if (fieldStatus === "en_route") {
    await tx.campoSegment.create({
      data: {
        organizationId,
        shiftId: shift.id,
        activityKind: "travel",
        workOrderId: null,
        startedAt: now,
      },
    });
  } else if (fieldStatus === "on_site") {
    await tx.campoSegment.create({
      data: {
        organizationId,
        shiftId: shift.id,
        activityKind: "on_site",
        workOrderId: jobId,
        startedAt: now,
      },
    });
  }
}

function mapTicket(wo: Awaited<ReturnType<typeof assertMyJob>>) {
  const client = clientLabel(wo);
  const field = (wo.fieldStatus || "scheduled") as FieldStatus;
  const checklist = parseChecklist(wo.campoChecklist);
  const photos = parsePhotos(wo.campoPhotos);
  const doneCount = checklist.filter((c) => c.done).length;
  const sqft = (wo.lineItems || []).reduce((s, li) => s + dec(li.quantitySqft), 0);
  const scope = (wo.lineItems || []).map((li) => ({
    id: li.id,
    name: li.serviceName,
    sqft: dec(li.quantitySqft),
  }));
  const today = ymdLocal(new Date());
  const startYmd = wo.scheduledStart ? ymdLocal(wo.scheduledStart) : null;
  let whenLabel = "Sem horário";
  if (wo.scheduledStart) {
    const dayPart = startYmd === today ? "Hoje" : startYmd || "";
    const range = `${hhmm(wo.scheduledStart)}${wo.scheduledEnd ? ` – ${hhmm(wo.scheduledEnd)}` : ""}`;
    whenLabel = dayPart ? `${dayPart} · ${range}` : range;
  }

  const attention =
    wo.campoAttention ||
    (wo.notes && /aten[cç][aã]o/i.test(wo.notes) ? wo.notes : null);

  return {
    id: wo.id,
    number: wo.number,
    title: wo.title,
    client,
    client_short: shortClient(client),
    address: wo.address || "",
    notes: wo.notes,
    attention,
    field_status: field,
    field_status_label: fieldStatusLabel(field),
    raw_status: wo.status,
    when_label: whenLabel,
    start: wo.scheduledStart ? hhmm(wo.scheduledStart) : null,
    end: wo.scheduledEnd ? hhmm(wo.scheduledEnd) : null,
    scheduled_start: wo.scheduledStart?.toISOString() ?? null,
    scheduled_end: wo.scheduledEnd?.toISOString() ?? null,
    team: teamLabel(wo),
    crew_name: wo.crew?.name || null,
    sqft_total: Math.round(sqft * 100) / 100,
    scope,
    checklist,
    checklist_done: doneCount,
    checklist_total: checklist.length,
    photos,
    photos_count: photos.length,
    problem_note: wo.campoProblemNote || null,
    cta_label: ctaLabel(field),
    next_status: nextFieldStatus(field),
    stepper: FIELD_STATUSES.map((s) => ({
      key: s,
      label: fieldStatusLabel(s),
      active: s === field,
      done:
        FIELD_STATUSES.indexOf(s) < FIELD_STATUSES.indexOf(field) ||
        (field === "completed" && s === "completed"),
    })),
  };
}

campoJobsRouter.get(
  "/api/campo/agenda",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const weekParam = String(req.query.week || "").trim();
      let weekStart: Date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
        weekStart = startOfWeekMon(new Date(weekParam + "T12:00:00"));
      } else {
        weekStart = startOfWeekMon(new Date());
      }
      const weekEnd = addDays(weekStart, 7);
      const selectedParam = String(req.query.day || "").trim();
      const selectedYmd = /^\d{4}-\d{2}-\d{2}$/.test(selectedParam)
        ? selectedParam
        : ymdLocal(new Date());

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const rows = await tx.workOrder.findMany({
          where: {
            status: { not: "canceled" },
            ...myJobAccessWhere(req.user!.id),
            scheduledStart: { gte: weekStart, lt: weekEnd },
          },
          include: woListInclude,
          orderBy: [{ scheduledStart: "asc" }, { createdAt: "asc" }],
          take: 200,
        });

        const byDay = new Map<string, typeof rows>();
        for (const wo of rows) {
          if (!wo.scheduledStart) continue;
          const key = ymdLocal(wo.scheduledStart);
          const list = byDay.get(key) || [];
          list.push(wo);
          byDay.set(key, list);
        }

        const today = ymdLocal(new Date());
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = addDays(weekStart, i);
          const ymd = ymdLocal(d);
          const jobs = byDay.get(ymd) || [];
          const dots: string[] = [];
          if (jobs.some((j) => j.fieldStatus === "completed" || j.status === "completed")) {
            dots.push("green");
          }
          if (jobs.some((j) => j.fieldStatus !== "completed" && j.status !== "completed")) {
            dots.push("orange");
          }
          days.push({
            ymd,
            day_num: d.getDate(),
            is_today: ymd === today,
            label:
              ymd === today
                ? "Hoje"
                : ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.getDay()],
            dots,
            count: jobs.length,
          });
        }

        const selectedJobs = (byDay.get(selectedYmd) || []).map((j) => mapJobCard(j));
        const end = addDays(weekStart, 6);
        const monShort = [
          "jan",
          "fev",
          "mar",
          "abr",
          "mai",
          "jun",
          "jul",
          "ago",
          "set",
          "out",
          "nov",
          "dez",
        ];
        const range_label = `${weekStart.getDate()} – ${end.getDate()} ${monShort[end.getMonth()]}`;

        return {
          week_start: ymdLocal(weekStart),
          week_end: ymdLocal(end),
          range_label,
          selected_day: selectedYmd,
          days,
          jobs: selectedJobs,
        };
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

campoJobsRouter.get(
  "/api/campo/jobs/:id",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        let wo = await assertMyJob(tx, req.user!.id, String(req.params.id));
        if (!wo.campoChecklist) {
          const seeded = parseChecklist(null);
          wo = await tx.workOrder.update({
            where: { id: wo.id },
            data: { campoChecklist: seeded },
            include: woListInclude,
          });
        }
        return mapTicket(wo);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoJobsRouter.post(
  "/api/campo/jobs/:id/field-status",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z
        .object({
          field_status: z.enum(FIELD_STATUSES).optional(),
          advance: z.boolean().optional(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid payload" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJob(tx, req.user!.id, String(req.params.id));
        let next: FieldStatus;
        if (body.data.advance) {
          const n = nextFieldStatus(wo.fieldStatus || "scheduled");
          if (!n) {
            throw Object.assign(new Error("Visita já concluída"), { status: 409 });
          }
          next = n;
        } else if (body.data.field_status) {
          next = body.data.field_status;
        } else {
          throw Object.assign(new Error("field_status or advance required"), { status: 400 });
        }

        const officePatch: { status?: string; fieldStatus: string } = {
          fieldStatus: next,
        };
        if (next === "en_route" || next === "on_site") {
          if (wo.status === "scheduled" || wo.status === "draft") {
            officePatch.status = "in_progress";
          }
        }
        if (next === "completed") {
          officePatch.status = "completed";
        }

        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: officePatch,
          include: woListInclude,
        });

        await syncPontoForFieldStatus(
          tx,
          req.organizationId!,
          req.user!.id,
          wo.id,
          next,
        );

        return mapTicket(updated);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoJobsRouter.patch(
  "/api/campo/jobs/:id/checklist",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z
        .object({
          item_id: z.string().min(1),
          done: z.boolean(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid payload" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJob(tx, req.user!.id, String(req.params.id));
        const checklist = parseChecklist(wo.campoChecklist).map((item) =>
          item.id === body.data.item_id ? { ...item, done: body.data.done } : item,
        );
        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoChecklist: checklist },
          include: woListInclude,
        });
        return mapTicket(updated);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoJobsRouter.post(
  "/api/campo/jobs/:id/photos",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z
        .object({
          data_url: z.string().min(32),
        })
        .safeParse(req.body || {});
      if (!body.success || !body.data.data_url.startsWith("data:")) {
        res.status(400).json({ success: false, error: "data_url required" });
        return;
      }
      const parsed = parseDataUrl(body.data.data_url);
      if (!parsed) {
        res.status(400).json({ success: false, error: "Invalid data_url" });
        return;
      }

      const jobId = String(req.params.id);
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
      });

      const key = `orgs/${req.organizationId}/campo/${jobId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
      const stored = await storage.upload({
        key,
        body: parsed.body,
        contentType: parsed.contentType,
      });

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJob(tx, req.user!.id, jobId);
        const photos: PhotoItem[] = [
          ...parsePhotos(wo.campoPhotos),
          { id: randomUUID(), url: stored.url, createdAt: new Date().toISOString() },
        ];
        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoPhotos: photos },
          include: woListInclude,
        });
        return mapTicket(updated);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoJobsRouter.post(
  "/api/campo/jobs/:id/problem",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z
        .object({
          note: z.string().min(2).max(2000),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "note required" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJob(tx, req.user!.id, String(req.params.id));
        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoProblemNote: body.data.note.trim() },
          include: woListInclude,
        });
        return mapTicket(updated);
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);
