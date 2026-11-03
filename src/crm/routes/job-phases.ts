/**
 * Job phases API — every trade. Hardwood jobs show their phases from the WorkOrder columns
 * (read-only here; Installation / Sand & Finish keep closing through the job status as before).
 * Trades with phaseStorage "table" (Tile) get their JobPhase rows on first read, record evidence
 * and close phases with the pack's order, cure waits and required evidence.
 *
 * Access like the stain routes: the office (work_orders.manage) reaches any job, the crew only
 * their jobs, work_orders.view reads. Skipping a cure wait ("force") is office-only.
 */
import { Router, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkLimit } from "../../lib/features/index.js";
import { isJobMediaEnabled, parsePhotoUploadMeta, sha256Buffer } from "../../lib/job-media/index.js";
import { storage } from "../../lib/storage/index.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { myJobAccessWhere } from "../lib/campo-shared.js";
import { primaryPack, type TradePack } from "../../lib/trades/index.js";
import { asEvidence, readJobPhases, type JobPhaseRow } from "../../lib/trades/job-phases.js";
import { addPhaseEvidence, closeJobPhase, ensureJobPhases, listJobPhases } from "../../lib/trades/job-phases-db.js";

export const jobPhasesRouter = Router();

class PhaseError extends Error {
  constructor(message: string, public status = 400, public code = "phase_error", public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function perms(req: AuthedRequest) {
  const admin = req.user?.roleKey === "admin";
  const p = req.user?.permissions || [];
  return { manage: admin || p.includes("work_orders.manage"), view: admin || p.includes("work_orders.view") || p.includes("work_orders.manage") };
}

/** Strip the calendar's ":sand" / ":installation" suffix like the jobs routes do. */
const jobIdOf = (req: AuthedRequest) => String(req.params.id || "").replace(/:(sand|installation|main)$/i, "").trim();

async function reachJob(tx: TenantPrisma, req: AuthedRequest, jobId: string, write: boolean) {
  const p = perms(req);
  const open = p.manage || (!write && p.view);
  const job = await tx.workOrder.findFirst({
    where: { id: jobId, organizationId: req.organizationId!, status: { not: "canceled" }, ...(open ? {} : myJobAccessWhere(req.user!.id)) },
    select: { id: true, status: true, sector: true, scheduledStart: true, sandScheduledStart: true, installationDoneAt: true, sandDoneAt: true },
  });
  if (!job) throw new PhaseError("Job não encontrado ou sem acesso.", 404, "not_found");
  return job;
}

async function packOf(tx: TenantPrisma, organizationId: string): Promise<TradePack> {
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { tradePacks: true } });
  return primaryPack(org?.tradePacks);
}

async function phasesState(tx: TenantPrisma, req: AuthedRequest, jobId: string) {
  const job = await reachJob(tx, req, jobId, false);
  const pack = await packOf(tx, req.organizationId!);
  if (pack.phaseStorage === "table") await ensureJobPhases(tx, req.organizationId!, jobId, pack);
  const rows = pack.phaseStorage === "table" ? await listJobPhases(tx, jobId) : [];
  const rowByKey = new Map(rows.map((r) => [r.phaseKey, r]));
  const evidenceOf = (key: string) => asEvidence(rowByKey.get(key)?.evidence);
  // Photos attached as evidence (ObraCam), shown as thumbnails on the job page.
  const mediaIds = [...new Set(rows.flatMap((r) => Object.values(asEvidence(r.evidence)).map((e) => e.mediaId).filter((id): id is string => Boolean(id))))];
  const media = mediaIds.length
    ? new Map(
        (await tx.jobMedia.findMany({ where: { id: { in: mediaIds }, workOrderId: jobId, deletedAt: null }, select: { id: true, url: true, thumbUrl: true } })).map((m) => [
          m.id,
          { id: m.id, url: m.url, thumb_url: m.thumbUrl || m.url },
        ]),
      )
    : new Map<string, { id: string; url: string; thumb_url: string }>();
  // Team screens are written in pt-BR and translated in the browser; English labels go along too.
  const locale = "pt-BR" as const;
  return {
    trade: pack.id,
    storage: pack.phaseStorage,
    status: job.status,
    can_force: perms(req).manage,
    phases: readJobPhases(pack, job, rows, locale).map((v) => {
      const def = pack.phases.find((d) => d.key === v.key);
      const row = rowByKey.get(v.key) as (JobPhaseRow & { doneByName?: string | null }) | undefined;
      const ev = evidenceOf(v.key);
      return {
        key: v.key,
        label: v.label,
        label_en: def?.label["en-US"] ?? v.label,
        status: v.status,
        scheduled_start: v.scheduledStart?.toISOString() ?? null,
        ready_at: v.readyAt?.toISOString() ?? null,
        done_at: v.doneAt?.toISOString() ?? null,
        done_by_name: row?.doneByName ?? null,
        wait_after_hours: def?.waitAfterHours ?? 0,
        requires: (def?.requires ?? []).map((r) => {
          const e = ev[r.key];
          return {
            key: r.key,
            kind: r.kind,
            label: r.label[locale],
            label_en: r.label["en-US"],
            done: Boolean(e) || v.status === "done",
            value: e?.value ?? null,
            at: e?.at ?? null,
            by: e?.by ?? null,
            photo: e?.mediaId ? media.get(e.mediaId) ?? null : null,
          };
        }),
      };
    }),
  };
}

function fail(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof PhaseError) {
    res.status(error.status).json({ success: false, error: error.message, code: error.code, ...error.extra });
    return;
  }
  next(error);
}

jobPhasesRouter.get("/api/work-orders/:id/phases", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const jobId = jobIdOf(req);
    const data = await withTenantTransaction(req.organizationId!, (tx) => phasesState(tx, req, jobId));
    res.json({ success: true, data });
  } catch (error) {
    fail(res, next, error);
  }
});

const evidenceBody = z.object({
  /** Test result (flood test depth/hours/passed, flatness reading…) or checklist answers. */
  value: z.unknown().optional(),
  /** ObraCam photo of this job. */
  media_id: z.string().uuid().optional().nullable(),
  /**
   * Or the photo itself (JPG/PNG data URL): it is saved to the job's ObraCam and linked in one
   * step, for the office and the crew alike, and so a photo taken without signal can wait in the
   * phone's queue as a single action. client_upload_id makes a resend land on the same photo.
   */
  photo: z
    .object({
      data_url: z.string().startsWith("data:").max(17_000_000),
      taken_at_device: z.string().max(40).optional().nullable(),
      address: z.string().max(400).optional().nullable(),
      device_label: z.string().max(120).optional().nullable(),
      client_upload_id: z.string().max(80).optional().nullable(),
    })
    .optional(),
  /** When the crew recorded it, if it was sent later (no signal). */
  at: z.string().datetime({ offset: true }).optional(),
});

/** Phone time for actions sent later: never in the future, at most 3 days back. */
const MAX_BACK_MS = 3 * 86_400_000;
export function clientTime(at: string | undefined, now = new Date()): Date | null {
  if (!at) return null;
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(Math.min(now.getTime(), Math.max(now.getTime() - MAX_BACK_MS, t.getTime())));
}

/** Save a phase photo to the job's ObraCam (dedupe on client_upload_id). Returns the media id. */
async function storePhasePhoto(
  req: AuthedRequest,
  jobId: string,
  photo: NonNullable<z.infer<typeof evidenceBody>["photo"]>,
): Promise<string> {
  const m = /^data:([^;]+);base64,(.+)$/.exec(photo.data_url);
  if (!m) throw new PhaseError("Foto inválida.", 400, "invalid_photo");
  const contentType = m[1]!.toLowerCase();
  if (!contentType.startsWith("image/") || contentType.includes("heic") || contentType.includes("heif")) {
    throw new PhaseError("Use uma foto JPG ou PNG.", 400, "invalid_photo");
  }
  const body = Buffer.from(m[2]!, "base64");
  if (body.length > 12 * 1024 * 1024) throw new PhaseError("Foto grande demais (máx. 12 MB).", 400, "invalid_photo");
  const meta = parsePhotoUploadMeta(photo as unknown as Record<string, unknown>);
  const orgId = req.organizationId!;
  // Access and the photo's requirement are checked first; the upload runs outside any transaction.
  const pre = await withTenantTransaction(orgId, async (tx) => {
    await reachJob(tx, req, jobId, true);
    const existing = meta.clientUploadId
      ? await tx.jobMedia.findFirst({ where: { clientUploadId: meta.clientUploadId, workOrderId: jobId, deletedAt: null }, select: { id: true } })
      : null;
    const org = await tx.organization.findFirst({ where: { id: orgId }, select: { featureFlags: true } });
    return { existing: existing?.id ?? null, enabled: isJobMediaEnabled(org?.featureFlags) };
  });
  if (pre.existing) return pre.existing;
  if (!pre.enabled) throw new PhaseError("As fotos de job não estão ativas nesta empresa.", 403, "media_disabled");
  const limit = await checkLimit(req.organizationId!, "photos_month", 1);
  if (!limit.ok) throw new PhaseError(limit.message || "Limite de fotos do mês atingido.", 403, "LIMIT_REACHED");
  const stored = await storage.upload({
    key: `orgs/${req.organizationId}/jobs/${jobId}/${Date.now()}-${randomUUID().slice(0, 8)}`,
    body,
    contentType,
  });
  const row = await withTenantTransaction(orgId, (tx) => tx.jobMedia.create({
    data: {
      organizationId: req.organizationId!,
      workOrderId: jobId,
      authorId: req.user!.id,
      type: "photo",
      storageKey: stored.key,
      url: stored.url,
      thumbUrl: stored.url,
      sha256: sha256Buffer(body),
      takenAtDevice: meta.takenAtDevice,
      receivedAtServer: new Date(),
      address: meta.address,
      stage: "during",
      isPublic: false,
      clientUploadId: meta.clientUploadId,
      deviceLabel: meta.deviceLabel || "Fases",
    },
    select: { id: true },
  }));
  return row.id;
}

jobPhasesRouter.post("/api/work-orders/:id/phases/:phase/evidence/:requirement", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = evidenceBody.safeParse(req.body || {});
    if (!body.success) throw new PhaseError("Dados inválidos.", 400, "invalid");
    const jobId = jobIdOf(req);
    const phaseKey0 = String(req.params.phase);
    const reqKey0 = String(req.params.requirement);
    let uploaded: string | null = null;
    if (body.data.photo && !body.data.media_id) {
      const pack = await withTenantTransaction(req.organizationId!, (tx) => packOf(tx, req.organizationId!));
      const def = pack.phases.find((p) => p.key === phaseKey0)?.requires?.find((r) => r.key === reqKey0);
      if (pack.phaseStorage !== "table" || !def) throw new PhaseError("Esta fase não pede essa prova.", 400, "unknown_requirement");
      if (def.kind !== "photo") throw new PhaseError("Esta prova não é uma foto.", 400, "not_photo");
      uploaded = await storePhasePhoto(req, jobId, body.data.photo);
    }
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      await reachJob(tx, req, jobId, true);
      const pack = await packOf(tx, req.organizationId!);
      if (pack.phaseStorage !== "table") throw new PhaseError("As fases deste ofício são fechadas pelo status do job.", 409, "columns_pack");
      await ensureJobPhases(tx, req.organizationId!, jobId, pack);
      const phaseKey = String(req.params.phase);
      const reqKey = String(req.params.requirement);
      const reqDef = pack.phases.find((p) => p.key === phaseKey)?.requires?.find((r) => r.key === reqKey);
      if (!reqDef) throw new PhaseError("Esta fase não pede essa prova.", 400, "unknown_requirement");
      const mediaId = body.data.media_id ?? uploaded;
      if (body.data.media_id) {
        const media = await tx.jobMedia.findFirst({ where: { id: body.data.media_id, workOrderId: jobId, deletedAt: null }, select: { id: true } });
        if (!media) throw new PhaseError("Foto não encontrada neste job.", 404, "media_not_found");
      }
      const now = new Date();
      const at = clientTime(body.data.at, now);
      const out = await addPhaseEvidence(tx, pack, jobId, phaseKey, reqKey, {
        at: (at ?? now).toISOString(),
        by: req.user?.name ?? null,
        value: body.data.value,
        mediaId,
        ...(at ? { offline: true, receivedAt: now.toISOString() } : {}),
      });
      if (!out.ok) throw new PhaseError("Esta fase não pede essa prova.", 400, out.error);
      return phasesState(tx, req, jobId);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, next, error);
  }
});

const completeBody = z.object({ force: z.boolean().optional(), at: z.string().datetime({ offset: true }).optional() });

const COMPLETE_MESSAGES: Record<string, string> = {
  previous_open: "Conclua a fase anterior primeiro.",
  waiting: "Ainda em tempo de cura da fase anterior.",
  missing_evidence: "Faltam provas para concluir esta fase.",
  failed_test: "O teste falhou. Corrija e registre o teste de novo.",
  already_done: "Esta fase já foi concluída.",
  unknown_phase: "Fase não encontrada.",
};

jobPhasesRouter.post("/api/work-orders/:id/phases/:phase/complete", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = completeBody.safeParse(req.body || {});
    if (!body.success) throw new PhaseError("Dados inválidos.", 400, "invalid");
    if (body.data.force && !perms(req).manage) throw new PhaseError("Só o escritório pode liberar a espera da cura.", 403, "force_not_allowed");
    const jobId = jobIdOf(req);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      await reachJob(tx, req, jobId, true);
      const pack = await packOf(tx, req.organizationId!);
      if (pack.phaseStorage !== "table") throw new PhaseError("As fases deste ofício são fechadas pelo status do job.", 409, "columns_pack");
      await ensureJobPhases(tx, req.organizationId!, jobId, pack);
      // Sent later from a phone without signal: the phase closes at the time the crew closed it.
      const at = clientTime(body.data.at);
      const r = await closeJobPhase(tx, pack, jobId, String(req.params.phase), { force: body.data.force, by: { id: req.user?.id, name: req.user?.name }, ...(at ? { now: at } : {}) });
      if (!r.ok) {
        const { ok: _ok, error, ...extra } = r;
        throw new PhaseError(COMPLETE_MESSAGES[error] || "Não foi possível concluir.", error === "unknown_phase" ? 404 : 409, error, extra);
      }
      return phasesState(tx, req, jobId);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, next, error);
  }
});
