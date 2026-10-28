/** One job with Installation and Sand & Finish finishes one sector at a time. */

export type SectorFinishInput = {
  sector?: string | null;
  status: string;
  installationDoneAt?: Date | null;
  sandDoneAt?: Date | null;
};

export type SectorFinishPatch = {
  status: string;
  installationDoneAt?: Date | null;
  sandDoneAt?: Date | null;
};

/**
 * A "completed" save on a two-sector job closes Installation first, then Sand & Finish.
 * Only the second close marks the job completed. Stepping back clears the closes.
 */
export function sectorFinishPatch(existing: SectorFinishInput, nextStatus: string, now = new Date()): SectorFinishPatch {
  const both = existing.sector === "both";
  if (!both) {
    if (nextStatus === "draft" || nextStatus === "scheduled" || nextStatus === "in_progress" || nextStatus === "canceled") {
      return { status: nextStatus, installationDoneAt: null, sandDoneAt: null };
    }
    return { status: nextStatus };
  }
  if (nextStatus === "completed") {
    if (!existing.installationDoneAt) return { status: "in_progress", installationDoneAt: now };
    if (!existing.sandDoneAt) return { status: "completed", sandDoneAt: now };
    return { status: "completed" };
  }
  if (nextStatus === "in_progress") return { status: "in_progress", sandDoneAt: null };
  if (nextStatus === "scheduled" || nextStatus === "draft" || nextStatus === "canceled") {
    return { status: nextStatus, installationDoneAt: null, sandDoneAt: null };
  }
  return { status: nextStatus };
}
