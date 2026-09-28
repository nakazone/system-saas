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
  assertMyJobTicket,
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
  woTicketInclude,
  dec,
  type FieldStatus,
  type PhotoItem,
} from "../lib/campo-shared.js";
import {
  isJobMediaEnabled,
  mapJobMedia,
  parsePhotoUploadMeta,
  sha256Buffer,
} from "../../lib/job-media/index.js";
import {
  JOB_REPORT_TEMPLATES,
  generateJobReportDraft,
  isJobReportAiEnabled,
  mapJobReport,
  type JobReportTemplate,
} from "../../lib/job-media/report.js";
import {
  FIELD_CHECKLIST_TEMPLATES,
  applyChecklistToggle,
  buildRecap,
  normalizeAnnotations,
  proposeChecklistFromSpeech,
  templateToChecklist,
} from "../../lib/job-media/checklist.js";
import { aiTranscribeAudio, isAiConfigured } from "../../lib/ai/client.js";
import { Prisma } from "@prisma/client";
import { recordActivity } from "../../lib/activity/record.js";
import { prisma } from "../../lib/prisma.js";

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

function mapTicket(wo: Awaited<ReturnType<typeof assertMyJobTicket>>) {
  const client = clientLabel(wo);
  const field = (wo.fieldStatus || "scheduled") as FieldStatus;
  const checklist = parseChecklist(wo.campoChecklist);
  const legacy = parsePhotos(wo.campoPhotos);
  const mediaRows = (wo.media || []).map(mapJobMedia);
  const mediaUrls = new Set(mediaRows.map((m) => m.url));
  const legacyOnly = legacy.filter((p) => !mediaUrls.has(p.url));
  const photos = [
    ...mediaRows,
    ...legacyOnly.map((p) => ({
      id: p.id,
      type: "photo",
      url: p.url,
      thumb_url: p.url,
      sha256: null as string | null,
      taken_at_device: null as string | null,
      received_at_server: p.createdAt,
      lat: null as number | null,
      lng: null as number | null,
      gps_accuracy_m: null as number | null,
      location_available: false,
      address: null as string | null,
      caption: null as string | null,
      stage: null as string | null,
      annotations: null,
      is_public: false,
      in_portfolio: false,
      ocr: null,
      client_upload_id: null as string | null,
      device_label: null as string | null,
      author_id: null as string | null,
      author_name: null as string | null,
      created_at: p.createdAt,
      createdAt: p.createdAt,
      legacy: true,
    })),
  ];
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
    job_media_enabled: true,
    job_media_ai_enabled: false,
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
        let wo = await assertMyJobTicket(tx, req.user!.id, String(req.params.id));
        if (!wo.campoChecklist) {
          const seeded = parseChecklist(null);
          wo = await tx.workOrder.update({
            where: { id: wo.id },
            data: { campoChecklist: seeded },
            include: woTicketInclude,
          });
        }
        const org = await tx.organization.findFirst({
          where: { id: req.organizationId! },
          select: { featureFlags: true },
        });
        const ticket = mapTicket(wo);
        ticket.job_media_enabled = isJobMediaEnabled(org?.featureFlags);
        ticket.job_media_ai_enabled = isJobReportAiEnabled(org?.featureFlags);
        return ticket;
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
        const wo = await assertMyJobTicket(tx, req.user!.id, String(req.params.id));
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
          include: woTicketInclude,
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
          photo_media_id: z.string().uuid().optional(),
          note: z.string().max(500).nullable().optional(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid payload" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJobTicket(tx, req.user!.id, String(req.params.id));
        let checklist = parseChecklist(wo.campoChecklist);
        if (body.data.note !== undefined) {
          checklist = checklist.map((item) =>
            item.id === body.data.item_id ? { ...item, note: body.data.note } : item,
          );
        }
        const applied = applyChecklistToggle(
          checklist,
          body.data.item_id,
          body.data.done,
          req.user!.name || null,
          body.data.photo_media_id || null,
        );
        if (!applied.ok) {
          throw Object.assign(new Error(applied.error), { status: 400 });
        }
        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoChecklist: applied.items },
          include: woTicketInclude,
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
      const raw = (req.body || {}) as Record<string, unknown>;
      const dataUrl = String(raw.data_url || raw.dataUrl || "");
      if (!dataUrl.startsWith("data:")) {
        res.status(400).json({ success: false, error: "data_url required" });
        return;
      }
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) {
        res.status(400).json({ success: false, error: "Invalid data_url" });
        return;
      }
      if (parsed.body.length > 12 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Image too large (max 12MB)" });
        return;
      }

      const meta = parsePhotoUploadMeta(raw);
      const jobId = String(req.params.id);
      const hash = sha256Buffer(parsed.body);

      const gate = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const org = await tx.organization.findFirst({
          where: { id: req.organizationId! },
          select: { featureFlags: true },
        });
        return isJobMediaEnabled(org?.featureFlags);
      });
      if (!gate) {
        res.status(403).json({ success: false, error: "Job media is not enabled for this organization" });
        return;
      }

      // Offline dedupe
      if (meta.clientUploadId) {
        const existing = await withTenantTransaction(req.organizationId!, async (tx) => {
          const row = await tx.jobMedia.findFirst({
            where: {
              organizationId: req.organizationId!,
              clientUploadId: meta.clientUploadId!,
              deletedAt: null,
            },
          });
          if (!row) return null;
          return assertMyJobTicket(tx, req.user!.id, jobId).then(mapTicket);
        });
        if (existing) {
          res.json({ success: true, data: existing, deduped: true });
          return;
        }
      }

      const key = `orgs/${req.organizationId}/jobs/${jobId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
      const stored = await storage.upload({
        key,
        body: parsed.body,
        contentType: parsed.contentType || "image/jpeg",
      });

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJob(tx, req.user!.id, jobId);
        await tx.jobMedia.create({
          data: {
            organizationId: req.organizationId!,
            workOrderId: wo.id,
            authorId: req.user!.id,
            type: "photo",
            storageKey: stored.key,
            url: stored.url,
            thumbUrl: stored.url,
            sha256: hash,
            takenAtDevice: meta.takenAtDevice,
            receivedAtServer: new Date(),
            lat: meta.lat != null ? new Prisma.Decimal(meta.lat) : null,
            lng: meta.lng != null ? new Prisma.Decimal(meta.lng) : null,
            gpsAccuracyM: meta.gpsAccuracyM != null ? new Prisma.Decimal(meta.gpsAccuracyM) : null,
            address: meta.address,
            caption: meta.caption,
            stage: meta.stage,
            isPublic: meta.isPublic,
            clientUploadId: meta.clientUploadId,
            deviceLabel: meta.deviceLabel,
          },
        });

        // Dual-write legacy JSON for older clients during transition
        const photos: PhotoItem[] = [
          ...parsePhotos(wo.campoPhotos),
          { id: randomUUID(), url: stored.url, createdAt: new Date().toISOString() },
        ];
        await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoPhotos: photos },
        });

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "work_order",
          entityId: wo.id,
          action: "job_media.created",
          actorType: "user",
          actorId: req.user!.id,
          changes: { sha256: { from: null, to: hash }, stage: { from: null, to: meta.stage } },
        });

        return mapTicket(await assertMyJobTicket(tx, req.user!.id, jobId));
      });
      res.json({ success: true, data });
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string; code?: string };
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message || "Error" });
        return;
      }
      next(error);
    }
  },
);

campoJobsRouter.patch(
  "/api/campo/jobs/:jobId/media/:mediaId",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      const body = z
        .object({
          caption: z.string().max(500).nullable().optional(),
          stage: z.enum(["before", "during", "after"]).nullable().optional(),
          is_public: z.boolean().optional(),
          annotations: z.unknown().optional(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid payload" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const row = await tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
        if (!row) {
          throw Object.assign(new Error("Foto não encontrada"), { status: 404 });
        }
        await tx.jobMedia.update({
          where: { id: row.id },
          data: {
            caption: body.data.caption !== undefined ? body.data.caption : undefined,
            stage: body.data.stage !== undefined ? body.data.stage : undefined,
            isPublic: body.data.is_public !== undefined ? body.data.is_public : undefined,
            annotationsJson:
              body.data.annotations !== undefined
                ? (normalizeAnnotations(body.data.annotations) as Prisma.InputJsonValue)
                : undefined,
          },
        });
        return mapTicket(await assertMyJobTicket(tx, req.user!.id, jobId));
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
  "/api/campo/jobs/:jobId/media/:mediaId/verify",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const row = await tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
        if (!row) {
          throw Object.assign(new Error("Foto não encontrada"), { status: 404 });
        }
        return {
          id: row.id,
          sha256: row.sha256,
          // Client re-uploads bytes to verify; without storage download we report stored hash.
          status: "stored",
          message:
            "Hash SHA-256 stored at upload. Re-upload the file to compare, or use admin integrity tools.",
        };
      });
      // Optional: if body.data_url provided, compare
      const raw = (req.body || {}) as Record<string, unknown>;
      const dataUrl = String(raw.data_url || "");
      if (dataUrl.startsWith("data:")) {
        const parsed = parseDataUrl(dataUrl);
        if (parsed) {
          const hash = sha256Buffer(parsed.body);
          res.json({
            success: true,
            data: {
              id: result.id,
              sha256_stored: result.sha256,
              sha256_provided: hash,
              valid: hash === result.sha256,
            },
          });
          return;
        }
      }
      res.json({ success: true, data: result });
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

campoJobsRouter.delete(
  "/api/campo/jobs/:jobId/media/:mediaId",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const row = await tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
        if (!row) {
          throw Object.assign(new Error("Foto não encontrada"), { status: 404 });
        }
        await tx.jobMedia.update({
          where: { id: row.id },
          data: { deletedAt: new Date() },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "work_order",
          entityId: jobId,
          action: "job_media.deleted",
          actorType: "user",
          actorId: req.user!.id,
          changes: { media_id: { from: mediaId, to: null } },
        });
        return mapTicket(await assertMyJobTicket(tx, req.user!.id, jobId));
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
        const wo = await assertMyJobTicket(tx, req.user!.id, String(req.params.id));
        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoProblemNote: body.data.note.trim() },
          include: woTicketInclude,
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
  "/api/campo/jobs/:jobId/media/:mediaId/caption-voice",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      if (!isAiConfigured()) {
        res.status(503).json({
          success: false,
          error: "Voice transcription needs OPENAI_API_KEY. Use on-device speech or type a caption.",
        });
        return;
      }
      const raw = (req.body || {}) as Record<string, unknown>;
      const dataUrl = String(raw.data_url || raw.audio_data_url || "");
      const parsed = dataUrl.startsWith("data:") ? parseDataUrl(dataUrl) : null;
      if (!parsed) {
        res.status(400).json({ success: false, error: "audio data_url required" });
        return;
      }
      if (parsed.body.length > 8 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Audio too large (max 8MB)" });
        return;
      }

      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const row = await tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
        if (!row) throw Object.assign(new Error("Foto não encontrada"), { status: 404 });
      });

      const tr = await aiTranscribeAudio({
        body: parsed.body,
        contentType: parsed.contentType || "audio/webm",
        language: String(raw.language || "en"),
      });
      if (!tr.ok) {
        res.status(502).json({ success: false, error: tr.error });
        return;
      }

      const caption = tr.text.slice(0, 500);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.jobMedia.update({
          where: { id: mediaId },
          data: { caption },
        });
        return mapTicket(await assertMyJobTicket(tx, req.user!.id, jobId));
      });
      res.json({ success: true, data, meta: { caption, model: tr.model } });
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

campoJobsRouter.get(
  "/api/campo/jobs/:id/reports",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.id);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const rows = await tx.jobReport.findMany({
          where: { workOrderId: jobId },
          orderBy: [{ createdAt: "desc" }],
          take: 20,
          include: { author: { select: { name: true } } },
        });
        return rows.map(mapJobReport);
      });
      res.json({
        success: true,
        data,
        meta: { ai_configured: isAiConfigured() },
      });
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
  "/api/campo/jobs/:id/reports/generate",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.id);
      const body = z
        .object({
          template_key: z.enum(JOB_REPORT_TEMPLATES).optional(),
          photo_ids: z.array(z.string().uuid()).max(50).optional(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid payload" });
        return;
      }

      const org = await prisma.organization.findFirst({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      if (!isJobReportAiEnabled(org?.featureFlags)) {
        res.status(403).json({
          success: false,
          error: "AI reports unavailable. Ask the office to configure OPENAI_API_KEY.",
        });
        return;
      }

      const templateKey = (body.data.template_key || "site_visit") as JobReportTemplate;
      const prepared = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJobTicket(tx, req.user!.id, jobId);
        let photos = wo.media || [];
        if (body.data.photo_ids?.length) {
          const want = new Set(body.data.photo_ids);
          photos = photos.filter((p) => want.has(p.id));
        }
        return {
          wo,
          photos: photos.map((p) => ({
            id: p.id,
            url: p.url,
            caption: p.caption,
            stage: p.stage,
            address: p.address || wo.address,
            taken_at: p.takenAtDevice?.toISOString() || p.createdAt.toISOString(),
            author_name: p.author?.name?.split(/\s+/)[0] || null,
          })),
        };
      });

      const gen = await generateJobReportDraft({
        jobTitle: prepared.wo.title,
        jobNumber: prepared.wo.number,
        client: clientLabel(prepared.wo),
        address: prepared.wo.address,
        templateKey,
        photos: prepared.photos,
      });
      if (!gen.ok) {
        res.status(502).json({ success: false, error: gen.error });
        return;
      }

      const saved = await withTenantTransaction(req.organizationId!, async (tx) => {
        const row = await tx.jobReport.create({
          data: {
            organizationId: req.organizationId!,
            workOrderId: jobId,
            authorId: req.user!.id,
            templateKey,
            title: gen.draft.title,
            status: "draft",
            summary: gen.draft.summary,
            observationsJson: gen.draft.observations as Prisma.InputJsonValue,
            issuesJson: gen.draft.issues as Prisma.InputJsonValue,
            recommendationsJson: gen.draft.recommendations as Prisma.InputJsonValue,
            nextStepsJson: gen.draft.next_steps as Prisma.InputJsonValue,
            photoIds: prepared.photos.map((p) => p.id) as Prisma.InputJsonValue,
            source: "ai",
            modelUsed: gen.model,
            tokensIn: gen.tokensIn,
            tokensOut: gen.tokensOut,
            costUsd: gen.costUsd != null ? new Prisma.Decimal(gen.costUsd) : null,
          },
          include: { author: { select: { name: true } } },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "work_order",
          entityId: jobId,
          action: "job_report.generated",
          actorType: "user",
          actorId: req.user!.id,
          changes: { report_id: { from: null, to: row.id } },
        });
        return mapJobReport(row);
      });
      res.json({ success: true, data: saved });
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

campoJobsRouter.get(
  "/api/campo/jobs/:id/checklist/templates",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, String(req.params.id));
      });
      res.json({
        success: true,
        data: FIELD_CHECKLIST_TEMPLATES.map((t) => ({
          key: t.key,
          name: t.name,
          item_count: t.items.length,
          items: t.items,
        })),
      });
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
  "/api/campo/jobs/:id/checklist/from-template",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z.object({ template_key: z.string().min(1) }).safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "template_key required" });
        return;
      }
      const items = templateToChecklist(body.data.template_key);
      if (!items) {
        res.status(404).json({ success: false, error: "Template not found" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJobTicket(tx, req.user!.id, String(req.params.id));
        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoChecklist: items },
          include: woTicketInclude,
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
  "/api/campo/jobs/:id/checklist/propose",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const raw = (req.body || {}) as Record<string, unknown>;
      let transcript = String(raw.transcript || raw.text || "").trim();
      const dataUrl = String(raw.audio_data_url || raw.data_url || "");
      if (!transcript && dataUrl.startsWith("data:")) {
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) {
          res.status(400).json({ success: false, error: "Invalid audio" });
          return;
        }
        const tr = await aiTranscribeAudio({
          body: parsed.body,
          contentType: parsed.contentType || "audio/webm",
          language: "en",
        });
        if (!tr.ok) {
          res.status(502).json({ success: false, error: tr.error });
          return;
        }
        transcript = tr.text;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, String(req.params.id));
      });
      const proposed = await proposeChecklistFromSpeech(transcript);
      if (!proposed.ok) {
        res.status(400).json({ success: false, error: proposed.error });
        return;
      }
      res.json({
        success: true,
        data: {
          transcript,
          model: proposed.model,
          items: proposed.items.map((it) => ({
            id: randomUUID(),
            text: it.text,
            photo_required: it.photo_required,
            done: false,
          })),
        },
      });
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
  "/api/campo/jobs/:id/checklist/apply",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = z
        .object({
          replace: z.boolean().optional(),
          items: z
            .array(
              z.object({
                text: z.string().min(1).max(200),
                photo_required: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(30),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid items" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJobTicket(tx, req.user!.id, String(req.params.id));
        const incoming = body.data.items.map((it) => ({
          id: randomUUID(),
          text: it.text,
          done: false,
          photo_required: Boolean(it.photo_required),
          photo_media_ids: [] as string[],
          note: null as string | null,
          done_by: null as string | null,
          done_at: null as string | null,
        }));
        const checklist = body.data.replace
          ? incoming
          : [...parseChecklist(wo.campoChecklist), ...incoming];
        const updated = await tx.workOrder.update({
          where: { id: wo.id },
          data: { campoChecklist: checklist },
          include: woTicketInclude,
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

campoJobsRouter.get(
  "/api/campo/jobs/:id/recap",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await assertMyJobTicket(tx, req.user!.id, String(req.params.id));
        const checklist = parseChecklist(wo.campoChecklist);
        const photos = wo.media || [];
        const photosByStage: Record<string, number> = { before: 0, during: 0, after: 0, general: 0 };
        for (const p of photos) {
          const key = p.stage && photosByStage[p.stage] != null ? p.stage : "general";
          photosByStage[key] = (photosByStage[key] || 0) + 1;
        }
        const last = photos[0];
        const recap = buildRecap({
          checklist,
          photoCount: photos.length,
          photosByStage,
          lastPhotoAt: last?.createdAt?.toISOString() || null,
        });
        return {
          ...recap,
          checklist_done: checklist.filter((c) => c.done).length,
          checklist_total: checklist.length,
        };
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
