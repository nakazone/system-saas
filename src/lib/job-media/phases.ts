import type { TenantPrisma } from "../tenant/prisma-tenant.js";

/**
 * ObraCam job phases: Delivery → Scan → Installation → Sand & Finish → Walk Through.
 * A photo's phase comes from the day it was taken and the job's own dates, unless someone corrected it
 * (JobMedia.phase holds only that correction). Only the phases the job has show up.
 */

export const JOB_PHASES = ["delivery", "scan", "installation", "sand_finish", "walkthrough"] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

export const PHASE_LABEL: Record<JobPhase, string> = {
  delivery: "Delivery",
  scan: "Scan",
  installation: "Installation",
  sand_finish: "Sand & Finish",
  walkthrough: "Walk Through",
};

export function isPhase(v: unknown): v is JobPhase {
  return typeof v === "string" && (JOB_PHASES as readonly string[]).includes(v);
}

/** The job fields the phase rules read. Dates may be Date or ISO strings. */
export type PhaseJob = {
  status?: string | null;
  sector?: string | null;
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  sandScheduledStart?: Date | string | null;
  installationDoneAt?: Date | string | null;
  sandDoneAt?: Date | string | null;
  deliveryScheduledStart?: Date | string | null;
  needsDelivery?: boolean | null;
  deliveries?: unknown;
  /** PricingItem.category of the job's service lines (installation | sand_finish | supply | custom) */
  serviceCategories?: (string | null | undefined)[];
};

export type PhaseContext = {
  phases: JobPhase[];
  tz: string;
  deliveryDays: Set<string>;
  installStart: string | null;
  sandStart: string | null;
  doneDay: string | null;
};

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar day (YYYY-MM-DD) of an instant in the company's timezone. */
export function dayIn(tz: string, v: Date | string | null | undefined): string | null {
  const d = toDate(v);
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function phaseContext(job: PhaseJob, tz: string): PhaseContext {
  const cats = new Set((job.serviceCategories || []).filter(Boolean) as string[]);
  const sector = job.sector || "";
  const hasSand = sector === "sand_finish" || sector === "both" || cats.has("sand_finish");
  // A job with no sector and no categorised services is treated as an installation job.
  const hasInstall = sector === "installation" || sector === "both" || cats.has("installation") || !hasSand;

  const deliveryDays = new Set<string>();
  const addDelivery = (v: unknown) => {
    const k = dayIn(tz, v as string);
    if (k) deliveryDays.add(k);
  };
  addDelivery(job.deliveryScheduledStart);
  if (Array.isArray(job.deliveries)) job.deliveries.forEach((s) => addDelivery((s as { scheduled_start?: string })?.scheduled_start));
  const hasDelivery = Boolean(job.needsDelivery) || deliveryDays.size > 0;

  // Sand-only jobs keep their sand day in scheduledStart; jobs with both use sandScheduledStart.
  const installStart = hasInstall ? dayIn(tz, job.scheduledStart) : null;
  const sandStart = hasSand ? dayIn(tz, hasInstall ? job.sandScheduledStart : job.scheduledStart) : null;
  const done = job.status === "completed" ? [job.sandDoneAt, job.installationDoneAt, job.scheduledEnd].map((v) => dayIn(tz, v)).filter(Boolean).sort().pop() || null : null;

  const phases: JobPhase[] = [];
  if (hasDelivery) phases.push("delivery");
  phases.push("scan");
  if (hasInstall) phases.push("installation");
  if (hasSand) phases.push("sand_finish");
  phases.push("walkthrough");
  return { phases, tz, deliveryDays, installStart, sandStart, doneDay: done };
}

/** The phase a photo taken at `at` belongs to, by the job's dates; null when the job has no dates to go by. */
export function autoPhase(ctx: PhaseContext, at: Date | string | null | undefined): JobPhase | null {
  const d = dayIn(ctx.tz, at);
  if (!d) return null;
  if (ctx.deliveryDays.has(d) && ctx.phases.includes("delivery")) return "delivery";
  if (ctx.doneDay && d > ctx.doneDay) return "walkthrough";
  const first = ctx.installStart || ctx.sandStart;
  if (!first) return null;
  if (d < first) return "scan";
  if (ctx.sandStart && d >= ctx.sandStart) return "sand_finish";
  if (ctx.installStart) return "installation";
  return "sand_finish";
}

/** API fields for one photo: the phase shown, where it came from, and the job's phase list. */
export function photoPhaseFields(ctx: PhaseContext | null, row: { phase?: string | null; takenAtDevice?: Date | null; createdAt: Date }) {
  const manual = isPhase(row.phase) ? row.phase : null;
  const auto = ctx ? autoPhase(ctx, row.takenAtDevice || row.createdAt) : null;
  return { phase: manual || auto, phase_source: manual ? "manual" : auto ? "auto" : null };
}

type Tx = TenantPrisma;

export async function orgTimezone(tx: Tx, organizationId: string): Promise<string> {
  const org = await tx.organization.findFirst({ where: { id: organizationId }, select: { timezone: true } });
  return (org && org.timezone) || "America/New_York";
}

/** Phase context for one job, read inside the tenant transaction. */
export async function jobPhaseContext(tx: Tx, organizationId: string, workOrderId: string): Promise<PhaseContext | null> {
  const [tz, wo] = await Promise.all([
    orgTimezone(tx, organizationId),
    tx.workOrder.findFirst({ where: { id: workOrderId, organizationId }, select: PHASE_JOB_SELECT }),
  ]);
  return phaseContextFromRow(wo as unknown as PhaseJobRow | null, tz);
}

/** Prisma select for the job fields phaseContext needs. */
export const PHASE_JOB_SELECT = {
  status: true,
  sector: true,
  scheduledStart: true,
  scheduledEnd: true,
  sandScheduledStart: true,
  installationDoneAt: true,
  sandDoneAt: true,
  deliveryScheduledStart: true,
  needsDelivery: true,
  deliveries: true,
  lineItems: { select: { pricingItem: { select: { category: true } } } },
} as const;

type PhaseJobRow = Omit<PhaseJob, "serviceCategories"> & { lineItems?: { pricingItem?: { category?: string | null } | null }[] };

export function phaseContextFromRow(row: PhaseJobRow | null | undefined, tz: string): PhaseContext | null {
  if (!row) return null;
  return phaseContext({ ...row, serviceCategories: (row.lineItems || []).map((l) => l.pricingItem?.category) }, tz);
}
