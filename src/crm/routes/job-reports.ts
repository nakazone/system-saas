/**
 * Office + shared job media gallery and field reports (Phase 2).
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { mapJobMedia } from "../../lib/job-media/index.js";
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
