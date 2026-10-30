/**
 * A job that runs every phase of its trade (hardwood: Installation then Sand & Finish, sector
 * "both") finishes one phase at a time. Phases and their done-at columns come from the trade pack.
 */
import { COMBINED_PHASE, PHASE_DONE_FIELDS } from "../trades/phases.js";
import type { PhaseDoneField } from "../trades/types.js";

export type SectorFinishInput = {
  sector?: string | null;
  status: string;
} & Partial<Record<PhaseDoneField, Date | null>>;

export type SectorFinishPatch = {
  status: string;
} & Partial<Record<PhaseDoneField, Date | null>>;

const RESET_STATUSES = new Set(["draft", "scheduled", "canceled"]);

function clearAll(status: string): SectorFinishPatch {
  const patch: SectorFinishPatch = { status };
  for (const f of PHASE_DONE_FIELDS) patch[f] = null;
  return patch;
}

/**
 * A "completed" save on a combined job closes the next open phase; only closing the last phase
 * marks the job completed. Stepping back to in progress reopens the last phase; draft, scheduled
 * or canceled clear every phase.
 */
export function sectorFinishPatch(existing: SectorFinishInput, nextStatus: string, now = new Date()): SectorFinishPatch {
  if (existing.sector !== COMBINED_PHASE) {
    if (RESET_STATUSES.has(nextStatus) || nextStatus === "in_progress") return clearAll(nextStatus);
    return { status: nextStatus };
  }
  if (nextStatus === "completed") {
    const open = PHASE_DONE_FIELDS.findIndex((f) => !existing[f]);
    if (open === -1) return { status: "completed" };
    const last = open === PHASE_DONE_FIELDS.length - 1;
    return { status: last ? "completed" : "in_progress", [PHASE_DONE_FIELDS[open]!]: now };
  }
  if (nextStatus === "in_progress") {
    return { status: "in_progress", [PHASE_DONE_FIELDS[PHASE_DONE_FIELDS.length - 1]!]: null };
  }
  if (RESET_STATUSES.has(nextStatus)) return clearAll(nextStatus);
  return { status: nextStatus };
}
