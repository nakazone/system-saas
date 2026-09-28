/**
 * Phase 5 field extras: inspections, OCR, measurements, media board, portfolio toggle.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { storage } from "../../lib/storage/index.js";
import { mapJobMedia, sha256Buffer } from "../../lib/job-media/index.js";
import { extractLabelFromImageUrl, isFieldMeasureEnabled } from "../../lib/job-media/ocr.js";
import { aiTranscribeAudio, aiChatJson, isAiConfigured } from "../../lib/ai/client.js";
import {
  assertMyJob,
  canUseCampo,
} from "../lib/campo-shared.js";
import { prisma } from "../../lib/prisma.js";
import { recordActivity } from "../../lib/activity/record.js";

export const jobFieldExtrasRouter = Router();

function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1]!, body: Buffer.from(match[2]!, "base64") };
}

function mapInspection(row: {
  id: string;
  workOrderId: string;
  status: string;
  audioUrl?: string | null;
  audioSha256?: string | null;
  durationMs?: number | null;
  startedAtDevice?: Date | null;
  endedAtDevice?: Date | null;
  transcript?: string | null;
  summary?: string | null;
  createdAt: Date;
  marks?: { id: string; mediaId: string | null; offsetMs: number; note: string | null }[];
  author?: { name: string } | null;
}) {
  return {
    id: row.id,
    work_order_id: row.workOrderId,
    status: row.status,
    audio_url: row.audioUrl || null,
    audio_sha256: row.audioSha256 || null,
    duration_ms: row.durationMs ?? null,
    started_at_device: row.startedAtDevice?.toISOString() ?? null,
    ended_at_device: row.endedAtDevice?.toISOString() ?? null,
    transcript: row.transcript || null,
    summary: row.summary || null,
    author_name: row.author?.name?.split(/\s+/)[0] || null,
    created_at: row.createdAt.toISOString(),
    marks: (row.marks || []).map((m) => ({
      id: m.id,
      media_id: m.mediaId,
      offset_ms: m.offsetMs,
      note: m.note,
    })),
  };
}

/** Manager board: open jobs + last photo + stale flag */
jobFieldExtrasRouter.get(
  "/api/job-media/board",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const days = Math.min(30, Math.max(1, Number(req.query.days) || 3));
      const since = new Date();
      since.setDate(since.getDate() - days);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const rows = await tx.workOrder.findMany({
          where: { status: { in: ["scheduled", "in_progress", "completed"] } },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            address: true,
            fieldStatus: true,
            scheduledStart: true,
            media: {
              where: { deletedAt: null },
              orderBy: [{ createdAt: "desc" }],
              take: 1,
              select: {
                id: true,
                url: true,
                thumbUrl: true,
                createdAt: true,
                lat: true,
                lng: true,
                stage: true,
              },
            },
          },
          orderBy: [{ scheduledStart: "desc" }],
          take: 120,
        });
        return rows.map((wo) => {
          const last = wo.media[0] || null;
          const lat = last?.lat != null ? Number(last.lat) : null;
          const lng = last?.lng != null ? Number(last.lng) : null;
          return {
            id: wo.id,
            number: wo.number,
            title: wo.title,
            status: wo.status,
            field_status: wo.fieldStatus,
            address: wo.address,
            scheduled_start: wo.scheduledStart?.toISOString() ?? null,
            last_photo: last
              ? {
                  id: last.id,
                  url: last.thumbUrl || last.url,
                  created_at: last.createdAt.toISOString(),
                  stage: last.stage,
                  lat: Number.isFinite(lat) ? lat : null,
                  lng: Number.isFinite(lng) ? lng : null,
                }
              : null,
            stale: !last || last.createdAt < since,
            detail_url: `job-detail.html?id=${wo.id}`,
          };
        });
      });

      const feed = await withTenantTransaction(req.organizationId!, async (tx) => {
        const photos = await tx.jobMedia.findMany({
          where: { deletedAt: null, type: "photo" },
          orderBy: [{ createdAt: "desc" }],
          take: 40,
          include: {
            author: { select: { name: true } },
            workOrder: { select: { id: true, number: true, title: true } },
          },
        });
        return photos.map((p) => ({
          ...mapJobMedia(p),
          job_id: p.workOrderId,
          job_number: p.workOrder?.number ?? null,
          job_title: p.workOrder?.title ?? null,
        }));
      });

      res.json({ success: true, data: { jobs: data, feed }, meta: { days } });
    } catch (error) {
      next(error);
    }
  },
);

jobFieldExtrasRouter.patch(
  "/api/work-orders/:jobId/media/:mediaId/portfolio",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      const body = z.object({ in_portfolio: z.boolean() }).safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "in_portfolio required" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const row = await tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
        if (!row) throw Object.assign(new Error("Photo not found"), { status: 404 });
        const updated = await tx.jobMedia.update({
          where: { id: row.id },
          data: {
            inPortfolio: body.data.in_portfolio,
            isPublic: body.data.in_portfolio ? true : row.isPublic,
          },
          include: { author: { select: { id: true, name: true } } },
        });
        return mapJobMedia(updated);
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

jobFieldExtrasRouter.post(
  "/api/campo/jobs/:jobId/media/:mediaId/ocr",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        return tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Foto não encontrada" });
        return;
      }
      const ocr = await extractLabelFromImageUrl(row.url);
      if (!ocr.ok) {
        res.status(502).json({ success: false, error: ocr.error });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const updated = await tx.jobMedia.update({
          where: { id: row.id },
          data: {
            ocrJson: ocr.data as Prisma.InputJsonValue,
            caption: row.caption || ocr.data.serial_number || ocr.data.label_text || row.caption,
          },
          include: { author: { select: { id: true, name: true } } },
        });
        return mapJobMedia(updated);
      });
      res.json({ success: true, data, meta: { ocr: ocr.data, model: ocr.model } });
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

jobFieldExtrasRouter.post(
  "/api/campo/jobs/:id/inspections",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const jobId = String(req.params.id);
      const raw = (req.body || {}) as Record<string, unknown>;
      const audioUrl = String(raw.audio_data_url || raw.data_url || "");
      const parsed = audioUrl.startsWith("data:") ? parseDataUrl(audioUrl) : null;
      if (!parsed) {
        res.status(400).json({ success: false, error: "audio_data_url required" });
        return;
      }
      if (parsed.body.length > 20 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Audio too large (max 20MB)" });
        return;
      }
      const marksRaw = Array.isArray(raw.marks) ? raw.marks : [];
      const marks = marksRaw
        .map((m) => {
          if (!m || typeof m !== "object") return null;
          const o = m as Record<string, unknown>;
          return {
            mediaId: o.media_id || o.mediaId ? String(o.media_id || o.mediaId) : null,
            offsetMs: Math.max(0, Number(o.offset_ms ?? o.offsetMs) || 0),
            note: o.note != null ? String(o.note).slice(0, 300) : null,
          };
        })
        .filter(Boolean) as { mediaId: string | null; offsetMs: number; note: string | null }[];

      const hash = sha256Buffer(parsed.body);
      const key = `orgs/${req.organizationId}/jobs/${jobId}/inspections/${Date.now()}.webm`;
      const stored = await storage.upload({
        key,
        body: parsed.body,
        contentType: parsed.contentType || "audio/webm",
      });

      let transcript: string | null = null;
      let summary: string | null = null;
      if (isAiConfigured()) {
        const tr = await aiTranscribeAudio({
          body: parsed.body,
          contentType: parsed.contentType || "audio/webm",
          language: "en",
        });
        if (tr.ok) {
          transcript = tr.text;
          const sum = await aiChatJson({
            system:
              "Summarize a US flooring field inspection audio transcript in 3-6 bullet sentences. Return JSON { summary: string }.",
            user: transcript.slice(0, 6000),
            timeoutMs: 45_000,
          });
          if (sum.ok) {
            try {
              summary = String((JSON.parse(sum.text) as { summary?: string }).summary || "").trim() || null;
            } catch {
              summary = null;
            }
          }
        }
      }

      const startedAt = raw.started_at_device
        ? new Date(String(raw.started_at_device))
        : null;
      const endedAt = raw.ended_at_device ? new Date(String(raw.ended_at_device)) : new Date();
      const durationMs =
        raw.duration_ms != null
          ? Number(raw.duration_ms)
          : startedAt && !Number.isNaN(startedAt.getTime())
            ? Math.max(0, endedAt.getTime() - startedAt.getTime())
            : null;

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const insp = await tx.jobInspection.create({
          data: {
            organizationId: req.organizationId!,
            workOrderId: jobId,
            authorId: req.user!.id,
            status: transcript ? "done" : "processing",
            audioStorageKey: stored.key,
            audioUrl: stored.url,
            audioSha256: hash,
            durationMs: Number.isFinite(durationMs) ? Math.round(durationMs!) : null,
            startedAtDevice: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null,
            endedAtDevice: endedAt,
            transcript,
            summary,
          },
          include: { author: { select: { name: true } }, marks: true },
        });
        for (const m of marks.slice(0, 80)) {
          await tx.jobInspectionMark.create({
            data: {
              organizationId: req.organizationId!,
              inspectionId: insp.id,
              mediaId: m.mediaId,
              offsetMs: m.offsetMs,
              note: m.note,
            },
          });
        }
        const full = await tx.jobInspection.findFirst({
          where: { id: insp.id },
          include: { author: { select: { name: true } }, marks: true },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "work_order",
          entityId: jobId,
          action: "job_inspection.created",
          actorType: "user",
          actorId: req.user!.id,
          changes: { inspection_id: { from: null, to: insp.id } },
        });
        return mapInspection(full!);
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

jobFieldExtrasRouter.get(
  "/api/campo/jobs/:id/inspections",
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
        const rows = await tx.jobInspection.findMany({
          where: { workOrderId: jobId },
          orderBy: [{ createdAt: "desc" }],
          take: 20,
          include: { author: { select: { name: true } }, marks: true },
        });
        return rows.map(mapInspection);
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

jobFieldExtrasRouter.get(
  "/api/campo/jobs/:id/measurements",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const org = await prisma.organization.findFirst({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      const enabled = isFieldMeasureEnabled(org?.featureFlags);
      const jobId = String(req.params.id);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        if (!enabled) return [];
        const rows = await tx.jobMeasurement.findMany({
          where: { workOrderId: jobId },
          orderBy: [{ createdAt: "desc" }],
          take: 50,
        });
        return rows.map((r) => ({
          id: r.id,
          label: r.label,
          kind: r.kind,
          value: dec(r.value),
          unit: r.unit,
          source: r.source,
          note: r.note,
          created_at: r.createdAt.toISOString(),
        }));
      });
      res.json({ success: true, data, meta: { enabled } });
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

jobFieldExtrasRouter.post(
  "/api/campo/jobs/:id/measurements",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const org = await prisma.organization.findFirst({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      if (!isFieldMeasureEnabled(org?.featureFlags)) {
        res.status(403).json({ success: false, error: "Measurements disabled for this organization" });
        return;
      }
      const body = z
        .object({
          label: z.string().min(1).max(120),
          kind: z.enum(["length_ft", "width_ft", "area_sqft", "custom"]).optional(),
          value: z.number().positive(),
          unit: z.string().max(20).optional(),
          source: z.enum(["manual", "ar_experimental"]).optional(),
          note: z.string().max(400).nullable().optional(),
        })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid measurement" });
        return;
      }
      const jobId = String(req.params.id);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertMyJob(tx, req.user!.id, jobId);
        const row = await tx.jobMeasurement.create({
          data: {
            organizationId: req.organizationId!,
            workOrderId: jobId,
            authorId: req.user!.id,
            label: body.data.label,
            kind: body.data.kind || "area_sqft",
            value: new Prisma.Decimal(body.data.value),
            unit: body.data.unit || (body.data.kind === "area_sqft" ? "sqft" : "ft"),
            source: body.data.source || "manual",
            note: body.data.note ?? null,
          },
        });
        return {
          id: row.id,
          label: row.label,
          kind: row.kind,
          value: dec(row.value),
          unit: row.unit,
          source: row.source,
          note: row.note,
          created_at: row.createdAt.toISOString(),
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
