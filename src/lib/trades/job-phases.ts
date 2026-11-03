/**
 * Job phases for every trade, one way to read them and one way to close them.
 *
 * - Packs with phaseStorage "columns" (Hardwood) keep using WorkOrder.sector / installationDoneAt /
 *   sandDoneAt / sandScheduledStart exactly as before; this module only *reads* them.
 * - Packs with phaseStorage "table" keep one JobPhase row per phase. Closing a phase checks the
 *   order, the wait after the previous phase (cure, flood test) and the required evidence.
 *
 * Pure functions: callers load rows and save patches inside their tenant transaction.
 */
import type { PhaseDef, PhaseRequirement, TradePack } from "./types.js";

export type PhaseStatus = "pending" | "scheduled" | "in_progress" | "done" | "skipped";

/** A JobPhase row as stored (only the fields these rules use). */
export type JobPhaseRow = {
  phaseKey: string;
  sortOrder: number;
  status: string;
  scheduledStart?: Date | null;
  readyAt?: Date | null;
  startedAt?: Date | null;
  doneAt?: Date | null;
  evidence?: unknown;
};

/** The WorkOrder fields Hardwood phases live in. */
export type ColumnsJob = {
  sector?: string | null;
  status: string;
  scheduledStart?: Date | null;
  sandScheduledStart?: Date | null;
  installationDoneAt?: Date | null;
  sandDoneAt?: Date | null;
};

export type PhaseView = {
  key: string;
  label: string;
  order: number;
  status: PhaseStatus;
  scheduledStart: Date | null;
  readyAt: Date | null;
  doneAt: Date | null;
  /** Requirement keys still missing evidence. */
  missing: string[];
};

type Locale = keyof PhaseDef["label"];

/** `offline`: recorded on the phone without signal and sent later; `at` is the phone's time, `receivedAt` the server's. */
export type EvidenceEntry = { at: string; by?: string | null; value?: unknown; mediaId?: string | null; offline?: boolean; receivedAt?: string };
export type Evidence = Record<string, EvidenceEntry>;

export function asEvidence(raw: unknown): Evidence {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Evidence) : {};
}

function missingFor(def: PhaseDef | undefined, evidence: Evidence): string[] {
  return (def?.requires ?? []).filter((r: PhaseRequirement) => !evidence[r.key]).map((r) => r.key);
}

/* ───────────────────────────── reading ───────────────────────────── */

/**
 * Phases of a job, in order, whatever the pack stores them in.
 * Hardwood: a "both" job shows both phases; a single-sector job shows that one phase.
 */
export function readJobPhases(
  pack: TradePack,
  job: ColumnsJob,
  rows: readonly JobPhaseRow[] = [],
  locale: Locale = "pt-BR",
): PhaseView[] {
  if (pack.phaseStorage === "columns") return readColumnPhases(pack, job, locale);
  const byKey = new Map(rows.map((r) => [r.phaseKey, r]));
  return pack.phases
    .map((def, i) => ({ def, row: byKey.get(def.key), i }))
    .filter((x) => x.row)
    .map(({ def, row, i }) => ({
      key: def.key,
      label: def.label[locale],
      order: row!.sortOrder ?? i,
      status: (row!.status as PhaseStatus) || "pending",
      scheduledStart: row!.scheduledStart ?? null,
      readyAt: row!.readyAt ?? null,
      doneAt: row!.doneAt ?? null,
      missing: row!.status === "done" || row!.status === "skipped" ? [] : missingFor(def, asEvidence(row!.evidence)),
    }))
    .sort((a, b) => a.order - b.order);
}

function readColumnPhases(pack: TradePack, job: ColumnsJob, locale: Locale): PhaseView[] {
  const combined = job.sector === pack.combinedPhaseKey;
  const defs = combined ? pack.phases : pack.phases.filter((p) => p.key === job.sector).slice(0, 1);
  const list = defs.length ? defs : pack.phases.slice(0, 1);
  const jobDone = job.status === "completed" || job.status === "invoiced" || job.status === "paid";
  const views: PhaseView[] = list.map((def, i) => {
    // Only a combined job records a done time per phase; a single-phase job is done with the job.
    const doneAt = combined && def.doneAtField ? job[def.doneAtField] ?? null : null;
    const scheduledStart = combined && i > 0 ? job.sandScheduledStart ?? null : job.scheduledStart ?? null;
    return { key: def.key, label: def.label[locale], order: i, status: "pending", scheduledStart, readyAt: null, doneAt, missing: [] };
  });
  // Status: done phases first, then the first open phase follows the job status.
  let openSeen = false;
  for (const v of views) {
    if (v.doneAt || (!combined && jobDone)) {
      v.status = "done";
      continue;
    }
    if (!openSeen) {
      openSeen = true;
      v.status = job.status === "in_progress" ? "in_progress" : job.status === "scheduled" || v.scheduledStart ? "scheduled" : "pending";
    } else {
      v.status = v.scheduledStart ? "scheduled" : "pending";
    }
  }
  return views;
}

/* ───────────────────────────── creating ───────────────────────────── */

/** Rows to create for a new job of a "table" pack (empty for "columns" packs). */
export function planJobPhases(pack: TradePack): Array<Pick<JobPhaseRow, "phaseKey" | "sortOrder" | "status"> & { trade: string }> {
  if (pack.phaseStorage !== "table") return [];
  return pack.phases.map((p, i) => ({ trade: pack.id, phaseKey: p.key, sortOrder: i, status: "pending" }));
}

/* ───────────────────────────── recording evidence ───────────────────────────── */

/** Evidence after recording one requirement (unknown requirement keys are refused). */
export function recordEvidence(
  pack: TradePack,
  phaseKey: string,
  current: unknown,
  requirementKey: string,
  entry: EvidenceEntry,
): { ok: true; evidence: Evidence } | { ok: false; error: "unknown_phase" | "unknown_requirement" } {
  const def = pack.phases.find((p) => p.key === phaseKey);
  if (!def) return { ok: false, error: "unknown_phase" };
  if (!(def.requires ?? []).some((r) => r.key === requirementKey)) return { ok: false, error: "unknown_requirement" };
  return { ok: true, evidence: { ...asEvidence(current), [requirementKey]: entry } };
}

/* ───────────────────────────── closing ───────────────────────────── */

export type CompleteError =
  | { error: "unknown_phase" }
  | { error: "already_done" }
  | { error: "previous_open"; phase: string }
  | { error: "waiting"; until: Date }
  | { error: "missing_evidence"; missing: string[] }
  | { error: "failed_test"; failed: string[] };

export type CompleteResult =
  | {
      ok: true;
      /** Patch for the phase being closed. */
      phase: { phaseKey: string; status: "done"; doneAt: Date };
      /** Patch for the next phase (its earliest start), if any. */
      next: { phaseKey: string; readyAt: Date } | null;
      /** Job status after this close. */
      jobStatus: "in_progress" | "completed";
    }
  | ({ ok: false } & CompleteError);

/**
 * Close a phase of a "table" pack job. Rules, in order:
 * the previous phases are done or skipped; the previous phase's wait has passed (readyAt);
 * every requirement of this phase has evidence and no test is recorded as failed. `force` skips the wait (office override), never
 * the order or the evidence.
 */
export function completePhase(
  pack: TradePack,
  rows: readonly JobPhaseRow[],
  phaseKey: string,
  opts: { now?: Date; force?: boolean } = {},
): CompleteResult {
  const now = opts.now ?? new Date();
  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = ordered.findIndex((r) => r.phaseKey === phaseKey);
  const def = pack.phases.find((p) => p.key === phaseKey);
  if (idx === -1 || !def) return { ok: false, error: "unknown_phase" };
  const row = ordered[idx]!;
  if (row.status === "done") return { ok: false, error: "already_done" };
  const open = ordered.slice(0, idx).find((r) => r.status !== "done" && r.status !== "skipped");
  if (open) return { ok: false, error: "previous_open", phase: open.phaseKey };
  if (!opts.force && row.readyAt && row.readyAt.getTime() > now.getTime()) {
    return { ok: false, error: "waiting", until: row.readyAt };
  }
  const missing = missingFor(def, asEvidence(row.evidence));
  if (missing.length) return { ok: false, error: "missing_evidence", missing };
  // A test recorded as failed (flood test leaked) blocks the phase until it is redone.
  const failedKeys = Object.entries(asEvidence(row.evidence))
    .filter(([, e]) => e && typeof e.value === "object" && e.value !== null && (e.value as { passed?: unknown }).passed === false)
    .map(([k]) => k);
  if (failedKeys.length) return { ok: false, error: "failed_test", failed: failedKeys };

  const nextRow = ordered.slice(idx + 1).find((r) => r.status !== "skipped");
  const waitH = def.waitAfterHours ?? 0;
  const next = nextRow ? { phaseKey: nextRow.phaseKey, readyAt: new Date(now.getTime() + waitH * 3600_000) } : null;
  return {
    ok: true,
    phase: { phaseKey, status: "done", doneAt: now },
    next,
    jobStatus: nextRow ? "in_progress" : "completed",
  };
}
