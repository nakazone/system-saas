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
import { JOB_MEDIA_PEOPLE, mapJobMedia, sha256Buffer } from "../../lib/job-media/index.js";
import { normalizeAnnotations } from "../../lib/job-media/checklist.js";
import { cleanStickerIds, ensureStickers, isStickerColor, mapSticker } from "../../lib/job-media/stickers.js";
import { JOB_PHASES, PHASE_JOB_SELECT, jobPhaseContext, orgTimezone, phaseContextFromRow, photoPhaseFields } from "../../lib/job-media/phases.js";
import { photoDistanceFields, resolveJobSiteGeo } from "../../lib/job-media/geo.js";
import { extractLabelFromImageUrl, isFieldMeasureEnabled } from "../../lib/job-media/ocr.js";
import { aiTranscribeAudio, aiChatJson, isAiConfigured } from "../../lib/ai/client.js";
import {
  assertMyJob,
  canUseCampo,
} from "../lib/campo-shared.js";
import { fieldPayrollSector, myFieldJobsWhere } from "../lib/field-sector.js";
import { prisma } from "../../lib/prisma.js";
import { recordActivity } from "../../lib/activity/record.js";
import { jobBilling, jobBillingLabel } from "../../lib/invoices/job.js";

export const jobFieldExtrasRouter = Router();

const FIELD_ROLES = new Set(["installer", "crew_lead", "subcontractor"]);

function isFieldRole(user: AuthedRequest["user"]) {
  return FIELD_ROLES.has(String(user?.roleKey || "").toLowerCase());
}

/** Office managers see every job; ObraCrew only their Folha sector / assigned jobs. */
async function fieldBoardScope(
  tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  req: AuthedRequest,
) {
  if (!isFieldRole(req.user) || !req.user?.id) return {};
  const sector = await fieldPayrollSector(tx, req.user.id, req.organizationId!);
  return myFieldJobsWhere(req.user.id, sector);
}

/**
 * Office with manage: any job. Field / view-only: must be on the job (same as Campo ticket).
 */
async function assertJobMediaAccess(
  tx: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  req: AuthedRequest,
  jobId: string,
) {
  const manage =
    req.user?.roleKey === "admin" || (req.user?.permissions || []).includes("work_orders.manage");
  if (manage && !isFieldRole(req.user)) {
    const wo = await tx.workOrder.findFirst({ where: { id: jobId, status: { not: "canceled" } }, select: { id: true } });
    if (!wo) throw Object.assign(new Error("Obra não encontrada"), { status: 404 });
    return wo;
  }
  return assertMyJob(tx, req.user!.id, jobId);
}

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
        const tz = await orgTimezone(tx, req.organizationId!);
        const scope = await fieldBoardScope(tx, req);
        const rows = await tx.workOrder.findMany({
          where: { status: { in: ["draft", "scheduled", "in_progress", "completed"] }, ...scope },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            address: true,
            fieldStatus: true,
            sector: true,
            scheduledStart: true,
            sandScheduledStart: true,
            installationDoneAt: true,
            sandDoneAt: true,
            scheduledEnd: true,
            deliveryScheduledStart: true,
            needsDelivery: true,
            deliveries: true,
            geoLat: true,
            geoLng: true,
            sourceName: true,
            clientRef: true,
            customer: { select: { name: true, company: true, nickname: true, clientCode: true } },
            builder: { select: { company: true, firstName: true, lastName: true, nickname: true } },
            lineItems: { select: { lineTotal: true, pricingItem: { select: { category: true } } } },
            invoices: {
              select: {
                amount: true,
                status: true,
                receipts: { select: { amount: true } },
              },
            },
            media: {
              where: { deletedAt: null },
              orderBy: [{ createdAt: "desc" }],
              take: 12,
              select: {
                id: true,
                url: true,
                thumbUrl: true,
                createdAt: true,
                takenAtDevice: true,
                lat: true,
                lng: true,
                stage: true,
                caption: true,
                address: true,
                inPortfolio: true,
                deviceLabel: true,
                author: { select: { name: true } },
                takenBy: { select: { name: true } },
                stickerIds: true,
                phase: true,
              },
            },
            _count: { select: { media: { where: { deletedAt: null } } } },
          },
          orderBy: [{ scheduledStart: "desc" }],
          take: 120,
        });
        return Promise.all(
          rows.map(async (wo) => {
            const last = wo.media[0] || null;
            let jobLat = wo.geoLat != null ? Number(wo.geoLat) : null;
            let jobLng = wo.geoLng != null ? Number(wo.geoLng) : null;
            if ((!Number.isFinite(jobLat) || !Number.isFinite(jobLng)) && wo.media.some((m) => m.lat != null && m.lng != null)) {
              const site = await resolveJobSiteGeo(tx, wo.id);
              jobLat = site?.lat ?? null;
              jobLng = site?.lng ?? null;
            }
            const jobGeo =
              jobLat != null && jobLng != null && Number.isFinite(jobLat) && Number.isFinite(jobLng)
                ? { lat: jobLat, lng: jobLng }
                : null;
            const phaseCtx = phaseContextFromRow(wo, tz);
            const photos = wo.media.map((m) => {
              const lat = m.lat != null ? Number(m.lat) : null;
              const lng = m.lng != null ? Number(m.lng) : null;
              const mapped = {
                id: m.id,
                url: m.thumbUrl || m.url,
                created_at: m.createdAt.toISOString(),
                taken_at_device: m.takenAtDevice?.toISOString() ?? null,
                stage: m.stage,
                caption: m.caption || null,
                address: m.address || null,
                lat: Number.isFinite(lat) ? lat : null,
                lng: Number.isFinite(lng) ? lng : null,
                in_portfolio: m.inPortfolio,
                device_label: m.deviceLabel || null,
                author_name: m.author?.name || null,
                taken_by_name: m.takenBy?.name || m.author?.name || null,
                sticker_ids: m.stickerIds || [],
                ...photoPhaseFields(phaseCtx, m),
              };
              return { ...mapped, ...photoDistanceFields(mapped, jobGeo) };
            });
            const lastMapped = photos[0] || null;
            const builderName = wo.builder
              ? [wo.builder.firstName, wo.builder.lastName].filter(Boolean).join(" ").trim()
              : "";
            const servicesTotal =
              Math.round(
                (wo.lineItems || []).reduce((sum, li) => sum + dec(li.lineTotal), 0) * 100,
              ) / 100;
            const billing = jobBilling(servicesTotal, wo.invoices || []);
            const clientCode =
              wo.customer?.clientCode != null ? String(wo.customer.clientCode).trim() || null : null;
            return {
              id: wo.id,
              number: wo.number,
              title: wo.title,
              status: wo.status,
              field_status: wo.fieldStatus,
              sector: wo.sector || null,
              address: wo.address,
              client_ref: (wo.clientRef && String(wo.clientRef).trim()) || clientCode || null,
              client_name:
                wo.customer?.name ||
                wo.builder?.company ||
                builderName ||
                wo.sourceName ||
                null,
              customer: wo.customer
                ? {
                    name: wo.customer.name,
                    company: wo.customer.company,
                    nickname: wo.customer.nickname,
                    client_code: wo.customer.clientCode,
                  }
                : null,
              builder: wo.builder
                ? {
                    company: wo.builder.company,
                    name: builderName || null,
                    nickname: wo.builder.nickname,
                  }
                : null,
              source_name: wo.sourceName || null,
              photo_count: wo._count.media,
              scheduled_start: wo.scheduledStart?.toISOString() ?? null,
              sand_scheduled_start: wo.sandScheduledStart?.toISOString() ?? null,
              installation_done_at: wo.installationDoneAt?.toISOString() ?? null,
              sand_done_at: wo.sandDoneAt?.toISOString() ?? null,
              billing: { ...billing, billing_status_label: jobBillingLabel(billing.billing_status) },
              geo_lat: jobGeo?.lat ?? null,
              geo_lng: jobGeo?.lng ?? null,
              last_photo: lastMapped,
              phases: phaseCtx ? phaseCtx.phases : [],
              photos,
              stale: !last || last.createdAt < since,
              detail_url: `job-detail.html?id=${wo.id}`,
            };
          }),
        );
      });

      const feed = await withTenantTransaction(req.organizationId!, async (tx) => {
        const tz = await orgTimezone(tx, req.organizationId!);
        const scope = await fieldBoardScope(tx, req);
        const scopedIds = Object.keys(scope).length
          ? (
              await tx.workOrder.findMany({
                where: { status: { not: "canceled" }, ...scope },
                select: { id: true },
                take: 200,
              })
            ).map((w) => w.id)
          : null;
        const photos = await tx.jobMedia.findMany({
          where: {
            organizationId: req.organizationId!,
            deletedAt: null,
            type: "photo",
            ...(scopedIds ? { workOrderId: { in: scopedIds } } : {}),
          },
          orderBy: [{ createdAt: "desc" }],
          take: 40,
          include: {
            ...JOB_MEDIA_PEOPLE,
            workOrder: { select: { id: true, number: true, title: true, geoLat: true, geoLng: true, ...PHASE_JOB_SELECT } },
          },
        });
        return photos.map((p) => {
          const mapped = { ...mapJobMedia(p), ...photoPhaseFields(phaseContextFromRow(p.workOrder, tz), p) };
          const jobLat = p.workOrder?.geoLat != null ? Number(p.workOrder.geoLat) : null;
          const jobLng = p.workOrder?.geoLng != null ? Number(p.workOrder.geoLng) : null;
          const jobGeo =
            jobLat != null && jobLng != null && Number.isFinite(jobLat) && Number.isFinite(jobLng)
              ? { lat: jobLat, lng: jobLng }
              : null;
          return {
            ...mapped,
            ...photoDistanceFields(mapped, jobGeo),
            job_id: p.workOrderId,
            job_number: p.workOrder?.number ?? null,
            job_title: p.workOrder?.title ?? null,
            job_status: p.workOrder?.status ?? null,
            job_geo_lat: jobGeo?.lat ?? null,
            job_geo_lng: jobGeo?.lng ?? null,
          };
        });
      });

      res.json({ success: true, data: { jobs: data, feed }, meta: { days } });
    } catch (error) {
      next(error);
    }
  },
);

jobFieldExtrasRouter.delete(
  "/api/work-orders/:jobId/media/:mediaId",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertJobMediaAccess(tx, req, jobId);
        const row = await tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
        if (!row) throw Object.assign(new Error("Foto não encontrada"), { status: 404 });
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
      });
      res.json({ success: true });
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

/** ObraCam stickers (photo labels). Everyone who sees ObraCam reads them; managers create and edit. */
jobFieldExtrasRouter.get(
  "/api/job-media/stickers",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, (tx) => ensureStickers(tx, req.organizationId!));
      res.json({ success: true, data: rows.map(mapSticker) });
    } catch (error) {
      next(error);
    }
  },
);

const stickerName = z.string().trim().min(1).max(32);

jobFieldExtrasRouter.post(
  "/api/job-media/stickers",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = z.object({ name: stickerName, color: z.string().refine(isStickerColor) }).safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Informe um nome (até 32 letras) e uma cor" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const all = await ensureStickers(tx, req.organizationId!);
        const same = all.find((s) => !s.archivedAt && s.name.toLowerCase() === body.data.name.toLowerCase());
        if (same) throw Object.assign(new Error("Já existe um sticker com esse nome"), { status: 409 });
        const sortOrder = all.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
        return tx.mediaSticker.create({ data: { organizationId: req.organizationId!, name: body.data.name, color: body.data.color, sortOrder } });
      });
      res.status(201).json({ success: true, data: mapSticker(row) });
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

jobFieldExtrasRouter.patch(
  "/api/job-media/stickers/:id",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = z
        .object({ name: stickerName.optional(), color: z.string().refine(isStickerColor).optional(), archived: z.boolean().optional(), sort_order: z.number().int().min(0).max(999).optional() })
        .safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Dados do sticker inválidos" });
        return;
      }
      const d = body.data;
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const cur = await tx.mediaSticker.findFirst({ where: { id: String(req.params.id), organizationId: req.organizationId! } });
        if (!cur) throw Object.assign(new Error("Sticker não encontrado"), { status: 404 });
        if (d.name && d.name.toLowerCase() !== cur.name.toLowerCase()) {
          const same = await tx.mediaSticker.findFirst({ where: { organizationId: req.organizationId!, archivedAt: null, name: { equals: d.name, mode: "insensitive" }, NOT: { id: cur.id } } });
          if (same) throw Object.assign(new Error("Já existe um sticker com esse nome"), { status: 409 });
        }
        return tx.mediaSticker.update({
          where: { id: cur.id },
          data: {
            name: d.name,
            color: d.color,
            sortOrder: d.sort_order,
            archivedAt: d.archived === undefined ? undefined : d.archived ? cur.archivedAt || new Date() : null,
          },
        });
      });
      res.json({ success: true, data: mapSticker(row) });
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

/** People a photo can be credited to ("Tirada por"): active users, name only. */
jobFieldExtrasRouter.get(
  "/api/job-media/people",
  requireCrmAuth,
  requireCrmPermission("work_orders.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, (tx) =>
        tx.user.findMany({ where: { organizationId: req.organizationId!, status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
      );
      res.json({ success: true, data: rows.map((u) => ({ id: u.id, name: u.name || "" })) });
    } catch (error) {
      next(error);
    }
  },
);

const mediaEditBody = z
  .object({
    caption: z.string().max(500).nullable().optional(),
    stage: z.enum(["before", "during", "after"]).nullable().optional(),
    annotations: z.unknown().optional(),
    taken_by_id: z.string().uuid().nullable().optional(),
    sticker_ids: z.array(z.string().uuid()).max(12).optional(),
    /** a job phase to set it by hand, or null to go back to the automatic phase */
    phase: z.enum(JOB_PHASES).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

/** ObraCam edits on one photo: note, stage, markup layer and who took it. The photo file itself never changes. */
jobFieldExtrasRouter.patch(
  "/api/work-orders/:jobId/media/:mediaId",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      const body = mediaEditBody.safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Invalid photo changes" });
        return;
      }
      const d = body.data;
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertJobMediaAccess(tx, req, jobId);
        const row = await tx.jobMedia.findFirst({ where: { id: mediaId, workOrderId: jobId, deletedAt: null } });
        if (!row) throw Object.assign(new Error("Foto não encontrada"), { status: 404 });
        let takenById: string | null | undefined;
        if (d.taken_by_id !== undefined) {
          if (d.taken_by_id === null || d.taken_by_id === row.authorId) takenById = null;
          else {
            const u = await tx.user.findFirst({ where: { id: d.taken_by_id, organizationId: req.organizationId! }, select: { id: true } });
            if (!u) throw Object.assign(new Error("Pessoa não encontrada"), { status: 400 });
            takenById = u.id;
          }
        }
        const caption = d.caption !== undefined ? (d.caption || "").trim() || null : undefined;
        const stickerIds = d.sticker_ids !== undefined ? await cleanStickerIds(tx, req.organizationId!, d.sticker_ids) : undefined;
        const annotations =
          d.annotations !== undefined
            ? d.annotations === null
              ? Prisma.DbNull
              : (normalizeAnnotations(d.annotations) as unknown as Prisma.InputJsonValue)
            : undefined;
        const updated = await tx.jobMedia.update({
          where: { id: row.id },
          data: { caption, stage: d.stage, annotationsJson: annotations, takenById, stickerIds, phase: d.phase },
          include: JOB_MEDIA_PEOPLE,
        });
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (caption !== undefined && caption !== (row.caption || null)) changes.caption = { from: row.caption || null, to: caption };
        if (d.stage !== undefined && d.stage !== (row.stage || null)) changes.stage = { from: row.stage || null, to: d.stage };
        if (annotations !== undefined) changes.annotations = { from: null, to: d.annotations ? "updated" : "cleared" };
        if (takenById !== undefined && takenById !== (row.takenById || null)) changes.taken_by = { from: row.takenById || null, to: takenById };
        if (stickerIds !== undefined && stickerIds.join() !== (row.stickerIds || []).join()) changes.stickers = { from: row.stickerIds || [], to: stickerIds };
        if (d.phase !== undefined && d.phase !== (row.phase || null)) changes.phase = { from: row.phase || null, to: d.phase };
        if (Object.keys(changes).length) {
          await recordActivity(tx, {
            organizationId: req.organizationId!,
            entityType: "work_order",
            entityId: jobId,
            action: "job_media.edited",
            actorType: "user",
            actorId: req.user!.id,
            changes: { media_id: { from: null, to: mediaId }, ...changes },
          });
        }
        return { ...mapJobMedia(updated), ...photoPhaseFields(await jobPhaseContext(tx, req.organizationId!, jobId), updated) };
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

/** Reclassify a photo (Antes / Durante / Depois, or null for Geral) from ObraCam. */
jobFieldExtrasRouter.patch(
  "/api/work-orders/:jobId/media/:mediaId/stage",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const jobId = String(req.params.jobId);
      const mediaId = String(req.params.mediaId);
      const body = z.object({ stage: z.enum(["before", "during", "after"]).nullable() }).safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "stage must be before, during, after or null" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        await assertJobMediaAccess(tx, req, jobId);
        const row = await tx.jobMedia.findFirst({
          where: { id: mediaId, workOrderId: jobId, deletedAt: null },
        });
        if (!row) throw Object.assign(new Error("Foto não encontrada"), { status: 404 });
        const updated = await tx.jobMedia.update({
          where: { id: row.id },
          data: { stage: body.data.stage },
          include: JOB_MEDIA_PEOPLE,
        });
        if ((row.stage || null) !== body.data.stage) {
          await recordActivity(tx, {
            organizationId: req.organizationId!,
            entityType: "work_order",
            entityId: jobId,
            action: "job_media.stage_changed",
            actorType: "user",
            actorId: req.user!.id,
            changes: { stage: { from: row.stage || null, to: body.data.stage } },
          });
        }
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
