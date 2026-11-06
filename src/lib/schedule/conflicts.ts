/** Pure schedule conflict helpers (no DB). */

export type TimeRange = {
  id?: string;
  start: Date;
  end: Date;
  crewId?: string | null;
  assignedUserId?: string | null;
  status?: string;
};

export type ScheduleConflict = {
  withId: string;
  reason: "crew_overlap" | "assignee_overlap";
};

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Detect conflicts between a candidate visit and existing visits.
 * Ignores canceled visits and the candidate's own id when updating.
 */
export function findScheduleConflicts(
  candidate: TimeRange,
  existing: TimeRange[],
): ScheduleConflict[] {
  if (!(candidate.start instanceof Date) || !(candidate.end instanceof Date)) {
    return [];
  }
  if (candidate.end.getTime() <= candidate.start.getTime()) {
    return [];
  }

  const conflicts: ScheduleConflict[] = [];
  for (const other of existing) {
    if (other.status === "canceled") continue;
    if (candidate.id && other.id === candidate.id) continue;
    if (!overlaps(candidate, other)) continue;

    if (candidate.crewId && other.crewId && candidate.crewId === other.crewId) {
      conflicts.push({ withId: String(other.id), reason: "crew_overlap" });
      continue;
    }
    if (
      candidate.assignedUserId &&
      other.assignedUserId &&
      candidate.assignedUserId === other.assignedUserId
    ) {
      conflicts.push({ withId: String(other.id), reason: "assignee_overlap" });
    }
  }
  return conflicts;
}

export type JobDates = {
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  sandScheduledStart?: Date | null;
};

/** Every stretch of time a job takes: its main dates, plus the sand day of a two-phase job. */
export function jobScheduleWindows(job: JobDates): { start: Date; end: Date }[] {
  const windows: { start: Date; end: Date }[] = [];
  if (job.scheduledStart) {
    const hasEnd = job.scheduledEnd && job.scheduledEnd.getTime() > job.scheduledStart.getTime();
    windows.push({ start: job.scheduledStart, end: hasEnd ? job.scheduledEnd! : endOfDay(job.scheduledStart) });
  }
  if (job.sandScheduledStart) {
    windows.push({ start: job.sandScheduledStart, end: endOfDay(job.sandScheduledStart) });
  }
  return windows;
}

export type JobForConflicts = JobDates & {
  id: string;
  assignedUserId?: string | null;
  crewId?: string | null;
};

/** Other jobs that need the same person or crew at the same time. One entry per job. */
export function findJobConflicts(job: JobForConflicts, others: JobForConflicts[]): ScheduleConflict[] {
  const windows = jobScheduleWindows(job);
  const existing = others.flatMap((o) =>
    jobScheduleWindows(o).map((w) => ({ ...w, id: o.id, assignedUserId: o.assignedUserId, crewId: o.crewId })),
  );
  const found = new Map<string, ScheduleConflict>();
  for (const w of windows) {
    const hits = findScheduleConflicts({ ...w, id: job.id, assignedUserId: job.assignedUserId, crewId: job.crewId }, existing);
    for (const hit of hits) if (!found.has(hit.withId)) found.set(hit.withId, hit);
  }
  return [...found.values()];
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  x.setDate(x.getDate() + diff);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
