import { prisma } from "../prisma.js";
import { PLATFORM_TZ, ymdInTz } from "../../master/lib.js";
import { runBillingLadder } from "./dunning.js";

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

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Checks every 15 min; runs the billing ladder once a day after 06:00 (America/Denver). */
export function startPlatformJobs(): void {
  if (timer || process.env.NODE_ENV === "test" || process.env.BILLING_LADDER === "off") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (await ladderDue()) await runJob(BILLING_LADDER_JOB, "schedule", () => runBillingLadder());
    } catch (error) {
      console.error("[jobs] billing ladder failed", error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, 15 * 60 * 1000);
  setTimeout(tick, 60 * 1000);
}
