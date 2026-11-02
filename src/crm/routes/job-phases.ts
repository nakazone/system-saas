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
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { myJobAccessWhere } from "../lib/campo-shared.js";
import { primaryPack, type TradePack } from "../../lib/trades/index.js";
import { readJobPhases } from "../../lib/trades/job-phases.js";
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
  // Team screens are written in pt-BR and translated in the browser; English labels go along too.
  const locale = "pt-BR" as const;
  return {
    trade: pack.id,
    storage: pack.phaseStorage,
    status: job.status,
    phases: readJobPhases(pack, job, rows, locale).map((v) => {
      const def = pack.phases.find((d) => d.key === v.key);
      return {
        key: v.key,
        label: v.label,
        label_en: def?.label["en-US"] ?? v.label,
        status: v.status,
        scheduled_start: v.scheduledStart?.toISOString() ?? null,
        ready_at: v.readyAt?.toISOString() ?? null,
        done_at: v.doneAt?.toISOString() ?? null,
        wait_after_hours: def?.waitAfterHours ?? 0,
        requires: (def?.requires ?? []).map((r) => ({ key: r.key, kind: r.kind, label: r.label[locale], label_en: r.label["en-US"], done: !v.missing.includes(r.key) || v.status === "done" })),
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
});

jobPhasesRouter.post("/api/work-orders/:id/phases/:phase/evidence/:requirement", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = evidenceBody.safeParse(req.body || {});
    if (!body.success) throw new PhaseError("Dados inválidos.", 400, "invalid");
    const jobId = jobIdOf(req);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      await reachJob(tx, req, jobId, true);
      const pack = await packOf(tx, req.organizationId!);
      if (pack.phaseStorage !== "table") throw new PhaseError("As fases deste ofício são fechadas pelo status do job.", 409, "columns_pack");
      await ensureJobPhases(tx, req.organizationId!, jobId, pack);
      if (body.data.media_id) {
        const media = await tx.jobMedia.findFirst({ where: { id: body.data.media_id, workOrderId: jobId, deletedAt: null }, select: { id: true } });
        if (!media) throw new PhaseError("Foto não encontrada neste job.", 404, "media_not_found");
      }
      const out = await addPhaseEvidence(tx, pack, jobId, String(req.params.phase), String(req.params.requirement), {
        at: new Date().toISOString(),
        by: req.user?.name ?? null,
        value: body.data.value,
        mediaId: body.data.media_id ?? null,
      });
      if (!out.ok) throw new PhaseError("Esta fase não pede essa prova.", 400, out.error);
      return phasesState(tx, req, jobId);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, next, error);
  }
});

const completeBody = z.object({ force: z.boolean().optional() });

const COMPLETE_MESSAGES: Record<string, string> = {
  previous_open: "Conclua a fase anterior primeiro.",
  waiting: "Ainda em tempo de cura da fase anterior.",
  missing_evidence: "Faltam provas para concluir esta fase.",
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
      const r = await closeJobPhase(tx, pack, jobId, String(req.params.phase), { force: body.data.force, by: { id: req.user?.id, name: req.user?.name } });
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
