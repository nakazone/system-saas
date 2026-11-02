/**
 * JobPhase rows in the database, for packs with phaseStorage "table".
 * Every function takes the caller's tenant transaction (withTenantTransaction), so RLS and the
 * tenant Prisma extension scope every read and write to the company.
 */
import type { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import {
  completePhase,
  planJobPhases,
  recordEvidence,
  type CompleteResult,
  type EvidenceEntry,
  type JobPhaseRow,
} from "./job-phases.js";
import type { TradePack } from "./types.js";

type Tx = TenantPrisma;

/** Create the phase rows of a job once (no-op for "columns" packs or when they already exist). */
export async function ensureJobPhases(tx: Tx, organizationId: string, workOrderId: string, pack: TradePack): Promise<number> {
  const plan = planJobPhases(pack);
  if (!plan.length) return 0;
  const res = await tx.jobPhase.createMany({
    data: plan.map((p) => ({ organizationId, workOrderId, trade: p.trade, phaseKey: p.phaseKey, sortOrder: p.sortOrder, status: p.status })),
    skipDuplicates: true,
  });
  return res.count;
}

export async function listJobPhases(tx: Tx, workOrderId: string): Promise<JobPhaseRow[]> {
  return tx.jobPhase.findMany({ where: { workOrderId }, orderBy: { sortOrder: "asc" } });
}

/** Record one piece of evidence (flood test result, photo, signature…) on a phase. */
export async function addPhaseEvidence(
  tx: Tx,
  pack: TradePack,
  workOrderId: string,
  phaseKey: string,
  requirementKey: string,
  entry: EvidenceEntry,
) {
  const row = await tx.jobPhase.findUnique({ where: { workOrderId_phaseKey: { workOrderId, phaseKey } } });
  if (!row) return { ok: false as const, error: "unknown_phase" as const };
  const out = recordEvidence(pack, phaseKey, row.evidence, requirementKey, entry);
  if (!out.ok) return out;
  await tx.jobPhase.update({ where: { id: row.id }, data: { evidence: out.evidence as Prisma.InputJsonValue } });
  return { ok: true as const };
}

/**
 * Close a phase: checks order, wait and evidence (see completePhase), then saves the phase,
 * the next phase's earliest start and the job status in the same transaction.
 */
export async function closeJobPhase(
  tx: Tx,
  pack: TradePack,
  workOrderId: string,
  phaseKey: string,
  opts: { now?: Date; force?: boolean; by?: { id?: string | null; name?: string | null } } = {},
): Promise<CompleteResult> {
  const rows = await listJobPhases(tx, workOrderId);
  const result = completePhase(pack, rows, phaseKey, opts);
  if (!result.ok) return result;
  await tx.jobPhase.update({
    where: { workOrderId_phaseKey: { workOrderId, phaseKey } },
    data: { status: "done", doneAt: result.phase.doneAt, doneById: opts.by?.id ?? null, doneByName: opts.by?.name ?? null },
  });
  if (result.next) {
    await tx.jobPhase.update({
      where: { workOrderId_phaseKey: { workOrderId, phaseKey: result.next.phaseKey } },
      data: { readyAt: result.next.readyAt },
    });
  }
  await tx.workOrder.update({ where: { id: workOrderId }, data: { status: result.jobStatus } });
  return result;
}
