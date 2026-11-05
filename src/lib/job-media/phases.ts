import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { primaryPack, type TradePack } from "../trades/index.js";
import { asEvidence, planJobPhases, type JobPhaseRow } from "../trades/job-phases.js";

/**
 * ObraCam job phases.
 * Hardwood: Delivery → Scan → Installation → Sand & Finish → Walk Through, from the day a photo was taken
 * and the job's own dates. Trades with per-job phases (Tile, Countertops): the pack's phases, from the photo
 * being a phase's proof or else the phase that was open when it was taken.
 * JobMedia.phase holds only a correction made by hand. Only the phases the job has show up.
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
  kind?: "hardwood";
  phases: JobPhase[];
  labels: Record<string, string>;
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
  return { phases, labels: PHASE_LABEL, tz, deliveryDays, installStart, sandStart, doneDay: done };
}

/* ───────────── trades with per-job phases (Tile, Countertops) ───────────── */

export type PackPhaseContext = {
  kind: "pack";
  /** the job's phases in work order (skipped ones left out) */
  phases: string[];
  labels: Record<string, string>;
  /** when each phase closed, in the same order */
  steps: { key: string; doneAt: Date | null }[];
  /** photos attached as a phase's proof */
  proofs: Map<string, string>;
};

export type AnyPhaseContext = PhaseContext | PackPhaseContext;

/** Labels of every phase a pack can have (variant phases too), in pack order. */
export function packPhaseLabels(pack: TradePack, locale: "pt-BR" | "en-US" = "pt-BR"): Record<string, string> {
  return Object.fromEntries(pack.phases.map((p) => [p.key, p.label[locale]]));
}

/** Phase context of one job of a per-job-phase trade; a job with no phase rows yet uses the pack's plan. */
export function packPhaseContext(pack: TradePack, rows: readonly JobPhaseRow[]): PackPhaseContext {
  const list = (rows.length ? [...rows] : planJobPhases(pack)).filter((r) => r.status !== "skipped" && pack.phases.some((p) => p.key === r.phaseKey));
  list.sort((a, b) => a.sortOrder - b.sortOrder);
  const proofs = new Map<string, string>();
  for (const r of rows) {
    for (const e of Object.values(asEvidence(r.evidence))) if (e.mediaId && !proofs.has(e.mediaId)) proofs.set(e.mediaId, r.phaseKey);
  }
  return {
    kind: "pack",
    phases: list.map((r) => r.phaseKey),
    labels: packPhaseLabels(pack),
    steps: list.map((r) => ({ key: r.phaseKey, doneAt: (r as JobPhaseRow).doneAt ?? null })),
    proofs,
  };
}

/** The phase a photo belongs to on a per-job-phase trade: its proof's phase, else the phase open when it was taken. */
export function packAutoPhase(ctx: PackPhaseContext, at: Date | string | null | undefined, mediaId?: string | null): string | null {
  if (mediaId && ctx.proofs.has(mediaId)) return ctx.proofs.get(mediaId)!;
  const t = toDate(at);
  if (!t || !ctx.steps.length) return null;
  for (const s of ctx.steps) if (!s.doneAt || t.getTime() <= s.doneAt.getTime()) return s.key;
  return ctx.steps[ctx.steps.length - 1].key;
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

/** Whether a phase key can be set by hand on a photo of this job. */
export function isPhaseOf(ctx: AnyPhaseContext | null, v: unknown): v is string {
  if (typeof v !== "string") return false;
  return ctx ? Object.prototype.hasOwnProperty.call(ctx.labels, v) : isPhase(v);
}

/** API fields for one photo: the phase shown, its name, and where it came from. */
export function photoPhaseFields(ctx: AnyPhaseContext | null, row: { id?: string; phase?: string | null; takenAtDevice?: Date | null; createdAt: Date }) {
  const manual = isPhaseOf(ctx, row.phase) ? row.phase : null;
  const at = row.takenAtDevice || row.createdAt;
  const pack = ctx?.kind === "pack";
  const auto = !ctx ? null : ctx.kind === "pack" ? packAutoPhase(ctx, at, row.id) : autoPhase(ctx, at);
  const phase = manual || auto;
  const labels = ctx ? ctx.labels : PHASE_LABEL;
  const proof = pack && !manual && auto && row.id ? (ctx as PackPhaseContext).proofs.get(row.id) === auto : false;
  return {
    phase,
    phase_label: phase ? (labels as Record<string, string>)[phase] ?? null : null,
    // manual | auto | proof (attached to that phase as evidence)
    phase_source: manual ? "manual" : proof ? "proof" : auto ? "auto" : null,
    // how the automatic phase is worked out: the job's dates (Hardwood) or its open phase (per-job phases)
    phase_mode: pack ? "phases" : "dates",
  };
}

/** Every phase the company's photos can take, in work order, for filters and the bulk "Fase" sheet. */
export function phaseCatalog(pack: TradePack): Array<[string, string]> {
  if (pack.phaseStorage === "table") return pack.phases.map((p) => [p.key, p.label["pt-BR"]]);
  return JOB_PHASES.map((k) => [k, PHASE_LABEL[k]]);
}

type Tx = TenantPrisma;

export async function orgTimezone(tx: Tx, organizationId: string): Promise<string> {
  const org = await tx.organization.findFirst({ where: { id: organizationId }, select: { timezone: true } });
  return (org && org.timezone) || "America/New_York";
}

export async function orgPack(tx: Tx, organizationId: string): Promise<TradePack> {
  const org = await tx.organization.findFirst({ where: { id: organizationId }, select: { tradePacks: true } });
  return primaryPack(org?.tradePacks);
}

/**
 * Per-job-phase contexts for many jobs at once, or null when the company's trade keeps hardwood phases.
 * The returned function gives the context of one job (its pack plan when it has no rows yet).
 */
export async function packPhaseContexts(tx: Tx, organizationId: string, workOrderIds: readonly string[], pack?: TradePack) {
  const p = pack ?? (await orgPack(tx, organizationId));
  if (p.phaseStorage !== "table") return null;
  const ids = [...new Set(workOrderIds.filter(Boolean))];
  const rows = ids.length
    ? await tx.jobPhase.findMany({
        where: { organizationId, workOrderId: { in: ids } },
        select: { workOrderId: true, phaseKey: true, sortOrder: true, status: true, doneAt: true, evidence: true },
      })
    : [];
  const byJob = new Map<string, JobPhaseRow[]>();
  for (const r of rows) {
    const list = byJob.get(r.workOrderId) || [];
    list.push(r);
    byJob.set(r.workOrderId, list);
  }
  const cache = new Map<string, PackPhaseContext>();
  return (workOrderId: string): PackPhaseContext => {
    let c = cache.get(workOrderId);
    if (!c) cache.set(workOrderId, (c = packPhaseContext(p, byJob.get(workOrderId) || [])));
    return c;
  };
}

/** Phase context for one job, read inside the tenant transaction. */
export async function jobPhaseContext(tx: Tx, organizationId: string, workOrderId: string): Promise<AnyPhaseContext | null> {
  const pack = await packPhaseContexts(tx, organizationId, [workOrderId]);
  if (pack) return pack(workOrderId);
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
