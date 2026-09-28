/**
 * Office + shared job media gallery and field reports (Phase 2).
 */
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
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
  parseReportPatch,
  type JobReportTemplate,
} from "../../lib/job-media/report.js";
import { buildJobReportPdf } from "../../lib/job-media/report-pdf.js";
import { isAiConfigured } from "../../lib/ai/client.js";
import { recordActivity } from "../../lib/activity/record.js";
import { storage } from "../../lib/storage/index.js";
import { prisma } from "../../lib/prisma.js";

export const jobReportsRouter = Router();

function clientLabel(wo: {
  customer?: { name?: string | null } | null;
  builder?: { firstName?: string | null; lastName?: string | null; company?: string | null } | null;
  sourceName?: string | null;
}) {
  return (
    wo.customer?.name ||
    wo.builder?.company ||
    [wo.builder?.firstName, wo.builder?.lastName].filter(Boolean).join(" ").trim() ||
    wo.sourceName ||
    "Client"
  );
}

async function loadWoForReport(tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0], jobId: string) {
  return tx.workOrder.findFirst({
    where: { id: jobId, status: { not: "canceled" } },
    include: {
      customer: { select: { name: true } },
      builder: { select: { firstName: true, lastName: true, company: true } },
      media: {
        where: { deletedAt: null, type: "photo" },
        orderBy: [{ createdAt: "desc" }],
        take: 80,
        include: { author: { select: { name: true } } },
      },
    },
  });
}

jobReportsRouter.get(
  "/api/work-orders/media-health",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const days = Math.min(30, Math.max(1, Number(req.query.days) || 3));
      const since = new Date();
      since.setDate(since.getDate() - days);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const open = await tx.workOrder.findMany({
          where: {
            status: { in: ["scheduled", "in_progress"] },
          },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            address: true,
            scheduledStart: true,
            media: {
              where: { deletedAt: null },
              orderBy: [{ createdAt: "desc" }],
              take: 1,
              select: { id: true, createdAt: true, url: true },
            },
          },
          orderBy: [{ scheduledStart: "asc" }],
          take: 100,
        });
        return open
          .map((wo) => {
            const last = wo.media[0] || null;
            const stale = !last || last.createdAt < since;
            return {
              id: wo.id,
              number: wo.number,
              title: wo.title,
              status: wo.status,
              address: wo.address,
              scheduled_start: wo.scheduledStart?.toISOString() ?? null,
              last_photo_at: last?.createdAt?.toISOString() ?? null,
              last_photo_url: last?.url ?? null,
              stale,
              days_without_photo: last
                ? Math.floor((Date.now() - last.createdAt.getTime()) / 86_400_000)
                : null,
            };
          })
          .filter((r) => r.stale);
      });
      res.json({ success: true, data, meta: { days } });
    } catch (error) {
      next(error);
    }
  },
);

jobReportsRouter.get(
  "/api/work-orders/:id/media",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.id);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: jobId },
          select: { id: true },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const rows = await tx.jobMedia.findMany({
          where: { workOrderId: jobId, deletedAt: null },
          orderBy: [{ createdAt: "desc" }],
          take: 200,
          include: { author: { select: { id: true, name: true } } },
        });
        return rows.map(mapJobMedia);
      });
      res.json({ success: true, data, meta: { ai_configured: isAiConfigured() } });
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

function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1]!, body: Buffer.from(match[2]!, "base64") };
}

/** Office upload — any staff with work_orders.manage (not limited to assigned crew). */
jobReportsRouter.post(
  "/api/work-orders/:id/media",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.id);
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
      const ct = String(parsed.contentType || "").toLowerCase();
      if (ct.includes("heic") || ct.includes("heif")) {
        res.status(400).json({
          success: false,
          error: "HEIC is not supported. Please upload a JPG or PNG.",
        });
        return;
      }
      if (parsed.body.length > 12 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Image too large (max 12MB)" });
        return;
      }

      const org = await prisma.organization.findFirst({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      if (!isJobMediaEnabled(org?.featureFlags)) {
        res.status(403).json({ success: false, error: "Job media is not enabled for this organization" });
        return;
      }

      const meta = parsePhotoUploadMeta(raw);
      const hash = sha256Buffer(parsed.body);

      if (meta.clientUploadId) {
        const existing = await withTenantTransaction(req.organizationId!, async (tx) => {
          return tx.jobMedia.findFirst({
            where: {
              organizationId: req.organizationId!,
              clientUploadId: meta.clientUploadId!,
              deletedAt: null,
            },
            include: { author: { select: { id: true, name: true } } },
          });
        });
        if (existing) {
          res.json({ success: true, data: mapJobMedia(existing), deduped: true });
          return;
        }
      }

      const key = `orgs/${req.organizationId}/jobs/${jobId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
      const stored = await storage.upload({
        key,
        body: parsed.body,
        contentType: ct.startsWith("image/") ? parsed.contentType : "image/jpeg",
      });

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: jobId, status: { not: "canceled" } },
          select: { id: true, address: true },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });

        const row = await tx.jobMedia.create({
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
            address: meta.address || wo.address || null,
            caption: meta.caption,
            stage: meta.stage,
            isPublic: meta.isPublic,
            clientUploadId: meta.clientUploadId,
            deviceLabel: meta.deviceLabel || "Office web",
          },
          include: { author: { select: { id: true, name: true } } },
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

        return mapJobMedia(row);
      });

      console.info("[job-media] uploaded", {
        jobId,
        mediaId: data.id,
        bytes: parsed.body.length,
        urlKind: String(data.url || "").startsWith("data:") ? "data-url" : "http",
      });

      res.status(201).json({ success: true, data });
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

jobReportsRouter.get(
  "/api/work-orders/:id/reports",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.id);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({ where: { id: jobId }, select: { id: true } });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const rows = await tx.jobReport.findMany({
          where: { workOrderId: jobId },
          orderBy: [{ createdAt: "desc" }],
          take: 40,
          include: { author: { select: { name: true } } },
        });
        return rows.map(mapJobReport);
      });
      const org = await prisma.organization.findFirst({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      res.json({
        success: true,
        data,
        meta: {
          ai_configured: isAiConfigured(),
          ai_enabled: isJobReportAiEnabled(org?.featureFlags),
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

jobReportsRouter.post(
  "/api/work-orders/:id/reports/generate",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
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
        select: { name: true, featureFlags: true },
      });
      if (!isJobReportAiEnabled(org?.featureFlags)) {
        res.status(403).json({
          success: false,
          error: "AI reports are not available. Configure OPENAI_API_KEY or enable job_media_ai.",
        });
        return;
      }

      const templateKey = (body.data.template_key || "site_visit") as JobReportTemplate;

      const prepared = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await loadWoForReport(tx, jobId);
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
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
            isPublic: false,
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
          changes: {
            report_id: { from: null, to: row.id },
            model: { from: null, to: gen.model },
          },
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

jobReportsRouter.patch(
  "/api/work-orders/:jobId/reports/:reportId",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.jobId);
      const reportId = String(req.params.reportId);
      const patch = parseReportPatch((req.body || {}) as Record<string, unknown>);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const row = await tx.jobReport.findFirst({
          where: { id: reportId, workOrderId: jobId },
        });
        if (!row) throw Object.assign(new Error("Report not found"), { status: 404 });
        const updated = await tx.jobReport.update({
          where: { id: row.id },
          data: {
            title: patch.title,
            summary: patch.summary,
            observationsJson:
              patch.observations !== undefined
                ? (patch.observations as Prisma.InputJsonValue)
                : undefined,
            issuesJson:
              patch.issues !== undefined ? (patch.issues as Prisma.InputJsonValue) : undefined,
            recommendationsJson:
              patch.recommendations !== undefined
                ? (patch.recommendations as Prisma.InputJsonValue)
                : undefined,
            nextStepsJson:
              patch.next_steps !== undefined
                ? (patch.next_steps as Prisma.InputJsonValue)
                : undefined,
            isPublic: patch.isPublic,
            status: patch.status,
            publishedAt:
              patch.status === "published"
                ? new Date()
                : patch.status === "draft"
                  ? null
                  : undefined,
          },
          include: { author: { select: { name: true } } },
        });
        return mapJobReport(updated);
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

jobReportsRouter.get(
  "/api/work-orders/:jobId/reports/:reportId/pdf",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.jobId);
      const reportId = String(req.params.reportId);
      const payload = await withTenantTransaction(req.organizationId!, async (tx) => {
        const row = await tx.jobReport.findFirst({
          where: { id: reportId, workOrderId: jobId },
          include: { author: { select: { name: true } } },
        });
        if (!row) throw Object.assign(new Error("Report not found"), { status: 404 });
        const wo = await tx.workOrder.findFirst({
          where: { id: jobId },
          include: {
            customer: { select: { name: true } },
            builder: { select: { firstName: true, lastName: true, company: true } },
          },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const org = await prisma.organization.findFirst({
          where: { id: req.organizationId! },
          select: { name: true },
        });
        return { row: mapJobReport(row), wo, orgName: org?.name || "ObraMate" };
      });

      const pdf = await buildJobReportPdf({
        organizationName: payload.orgName,
        jobTitle: payload.wo.title,
        jobNumber: payload.wo.number,
        client: clientLabel(payload.wo),
        address: payload.wo.address,
        templateKey: payload.row.template_key,
        report: {
          title: payload.row.title,
          summary: payload.row.summary,
          observations: payload.row.observations,
          issues: payload.row.issues,
          recommendations: payload.row.recommendations,
          next_steps: payload.row.next_steps,
          status: payload.row.status,
          created_at: payload.row.created_at,
        },
        photoCount: payload.row.photo_ids.length,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="job-report-${payload.wo.number ?? "draft"}.pdf"`,
      );
      res.send(pdf);
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
