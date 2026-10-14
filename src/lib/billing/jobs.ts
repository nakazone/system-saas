import { prisma } from "../prisma.js";
import { PLATFORM_TZ, ymdInTz } from "../../master/lib.js";
import { runBillingLadder } from "./dunning.js";
import { takeSnapshot } from "../../master/metrics.js";
import { registerJob, trackRun } from "../ops/jobs.js";
import { runServiceChecks, SERVICES } from "../ops/checks.js";
import { email as emailProvider } from "../email/index.js";
import { env } from "../../config/env.js";
import { cleanupEmailLog, EMAIL_LOG_CLEANUP_JOB } from "../email/delivery.js";

/** Runs a background job and records it in JobRun (shown in the Master). */
export async function runJob<T>(name: string, trigger: "schedule" | "manual", fn: () => Promise<T & { processed?: number }>): Promise<T> {
  const run = await prisma.jobRun.create({ data: { name, trigger } });
  try {
    const out = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, processed: Number((out as { checked?: number }).checked ?? out.processed ?? 0), detail: out as never },
    });
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error: message.slice(0, 1000) } });
    throw error;
  }
}

export const BILLING_LADDER_JOB = "billing-ladder";
/** Written by `npm run backup:check` (scripts/backup-restore-check.ts). */
export const BACKUP_CHECK_JOB = "backup-restore-check";
/** A restore test older than this shows up in the Master queue. */
export const BACKUP_CHECK_MAX_DAYS = 35;

/** Hour of the day (platform time) after which the daily ladder runs. */
const LADDER_HOUR = 6;

function hourInTz(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: PLATFORM_TZ, hour: "numeric", hourCycle: "h23" }).format(d));
}

/** True when today's ladder (platform time) has not run successfully yet and it is past 06:00. */
export async function ladderDue(now = new Date()): Promise<boolean> {
  if (hourInTz(now) < LADDER_HOUR) return false;
  const last = await prisma.jobRun.findFirst({ where: { name: BILLING_LADDER_JOB, ok: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  return !last || ymdInTz(last.startedAt) !== ymdInTz(now);
}

export const DAILY_METRICS_JOB = "daily-metrics";

/** True when today's metrics snapshot (platform time) has not been taken by the job yet. */
export async function metricsDue(now = new Date()): Promise<boolean> {
  const last = await prisma.jobRun.findFirst({ where: { name: DAILY_METRICS_JOB, ok: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  return !last || ymdInTz(last.startedAt) !== ymdInTz(now);
}

/** True when a daily job tracked in JobStatus has not finished today (platform time). */
async function dailyDue(name: string, now = new Date()): Promise<boolean> {
  const st = await prisma.jobStatus.findUnique({ where: { name }, select: { lastFinishedAt: true, lastOk: true } }).catch(() => null);
  return !st?.lastFinishedAt || !st.lastOk || ymdInTz(st.lastFinishedAt) !== ymdInTz(now);
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const DAY_MS = 86400e3;
export const SERVICE_CHECKS_JOB = "service-checks";

const metricsRun = () => runJob(DAILY_METRICS_JOB, "manual", async () => ({ processed: (await takeSnapshot()).paying }));
const ladderRun = () => runJob(BILLING_LADDER_JOB, "manual", () => runBillingLadder());

/** Service checks, plus an e-mail to the Master when a service goes down (only on the change). */
export async function serviceChecksWithAlert() {
  const before = await prisma.serviceCheck.findMany({ where: { checkedAt: { gte: new Date(Date.now() - 2 * 3600e3) } }, orderBy: { checkedAt: "desc" }, take: 60 });
  const lastStatus = new Map<string, string>();
  for (const r of before) if (!lastStatus.has(r.service)) lastStatus.set(r.service, r.status);
  const out = await runServiceChecks();
  const newlyDown = out.results.filter((r) => r.status === "down" && lastStatus.get(r.service) !== "down");
  if (newlyDown.length) {
    const master = await prisma.platformAdmin.findFirst({ where: { role: "MASTER", status: "active" }, select: { email: true } });
    if (master) {
      const names = newlyDown.map((r) => `${SERVICES.find((x) => x.key === r.service)?.name ?? r.service}: ${r.detail}`);
      await emailProvider
        .send({
          to: master.email,
          subject: `[ObraMate] Serviço fora do ar: ${newlyDown.map((r) => SERVICES.find((x) => x.key === r.service)?.name ?? r.service).join(", ")}`,
          text: [...names, "", `Veja em ${env.APP_BASE_URL.replace(/\/$/, "")}/master/operacao`].join("\n"),
          meta: { category: "internal", template: "ops_alert", organizationId: null },
        })
        .catch((e) => console.error("[ops] alert e-mail failed", e));
    }
  }
  return { checked: out.checked, down: out.down };
}

registerJob({ name: SERVICE_CHECKS_JOB, label: "Checagem dos serviços", intervalMs: 15 * 60e3, run: serviceChecksWithAlert });
registerJob({ name: DAILY_METRICS_JOB, label: "Foto diária das métricas", intervalMs: DAY_MS, run: metricsRun });
registerJob({ name: EMAIL_LOG_CLEANUP_JOB, label: "Limpeza do registro de e-mails (90 dias)", intervalMs: DAY_MS, run: cleanupEmailLog });
if (process.env.BILLING_LADDER !== "off") registerJob({ name: BILLING_LADDER_JOB, label: "Régua de cobrança", intervalMs: DAY_MS, run: ladderRun });

/**
 * Checks every 15 min:
 *  - external services (Master › Operação; e-mail to the Master when one goes down);
 *  - metrics snapshot once a day (first check after midnight, America/Denver);
 *  - e-mail send log trimmed to 90 days once a day;
 *  - billing ladder once a day after 06:00 (off with BILLING_LADDER=off).
 */
export function startPlatformJobs(): void {
  if (timer || process.env.NODE_ENV === "test") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await trackRun(SERVICE_CHECKS_JOB, serviceChecksWithAlert);
    } catch (error) {
      console.error("[jobs] service checks failed", error);
    }
    try {
      if (await metricsDue()) await trackRun(DAILY_METRICS_JOB, () => runJob(DAILY_METRICS_JOB, "schedule", async () => ({ processed: (await takeSnapshot()).paying })));
    } catch (error) {
      console.error("[jobs] metrics snapshot failed", error);
    }
    try {
      if (await dailyDue(EMAIL_LOG_CLEANUP_JOB)) await trackRun(EMAIL_LOG_CLEANUP_JOB, () => cleanupEmailLog());
    } catch (error) {
      console.error("[jobs] e-mail log cleanup failed", error);
    }
    try {
      if (process.env.BILLING_LADDER !== "off" && (await ladderDue())) await trackRun(BILLING_LADDER_JOB, () => runJob(BILLING_LADDER_JOB, "schedule", () => runBillingLadder()));
    } catch (error) {
      console.error("[jobs] billing ladder failed", error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, 15 * 60 * 1000);
  setTimeout(tick, 60 * 1000);
}
