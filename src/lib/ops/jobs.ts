import { prisma } from "../prisma.js";

/**
 * Background jobs registry: every job registers here, runs through `trackRun` (which keeps one
 * JobStatus row up to date) and can be run on demand from Master › Operação.
 * A job is "late" when its last finish is older than 2× its interval.
 */

export type JobDef = { name: string; label: string; intervalMs: number; run: () => Promise<unknown> };

const registry = new Map<string, JobDef>();
const running = new Set<string>();

export function registerJob(def: JobDef): void {
  registry.set(def.name, def);
}

export function registeredJobs(): JobDef[] {
  return [...registry.values()];
}

function processedOf(out: unknown): number | null {
  if (typeof out === "number") return out;
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    for (const k of ["processed", "checked", "count", "sent", "nudges", "expired"]) if (typeof o[k] === "number") return o[k] as number;
  }
  return null;
}

/** Runs a job once and records the result. Skips if the same job is already running in this process. */
export async function trackRun<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (running.has(name)) return undefined;
  running.add(name);
  const def = registry.get(name);
  const started = new Date();
  const base = { label: def?.label ?? name, intervalSec: Math.round((def?.intervalMs ?? 0) / 1000) };
  await prisma.jobStatus
    .upsert({ where: { name }, create: { name, ...base, lastStartedAt: started }, update: { ...base, lastStartedAt: started } })
    .catch(() => undefined);
  try {
    const out = await fn();
    await prisma.jobStatus
      .update({
        where: { name },
        data: { lastFinishedAt: new Date(), lastOk: true, lastError: null, lastDurationMs: Date.now() - started.getTime(), lastProcessed: processedOf(out), runs: { increment: 1 } },
      })
      .catch(() => undefined);
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobStatus
      .update({
        where: { name },
        data: { lastFinishedAt: new Date(), lastOk: false, lastError: message.slice(0, 1000), lastDurationMs: Date.now() - started.getTime(), runs: { increment: 1 }, failures: { increment: 1 } },
      })
      .catch(() => undefined);
    throw error;
  } finally {
    running.delete(name);
  }
}

/** "Rodar agora" from the Master. */
export async function runJobNow(name: string): Promise<{ ok: true; processed: number | null } | { ok: false; message: string }> {
  const def = registry.get(name);
  if (!def) return { ok: false, message: "Esse job não está registrado neste servidor." };
  if (running.has(name)) return { ok: false, message: "Esse job já está rodando agora." };
  try {
    const out = await trackRun(name, def.run);
    return { ok: true, processed: processedOf(out) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Server start: a job that never ran is only "late" once the server has been up for 2× its interval. */
const BOOT_AT = Date.now();

export type JobView = {
  name: string;
  label: string;
  intervalSec: number;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastDurationMs: number | null;
  lastProcessed: number | null;
  runs: number;
  failures: number;
  late: boolean;
  running: boolean;
  canRun: boolean;
};

export async function jobsOverview(now = new Date()): Promise<JobView[]> {
  const rows = await prisma.jobStatus.findMany({ orderBy: { label: "asc" } });
  const names = new Set([...rows.map((r) => r.name), ...registry.keys()]);
  // Daily jobs also log every run in JobRun: use it when there is no status row yet (e.g. right after deploy).
  const missing = [...names].filter((n) => !rows.some((r) => r.name === n));
  const fromRuns = missing.length
    ? await Promise.all(missing.map((n) => prisma.jobRun.findFirst({ where: { name: n }, orderBy: { startedAt: "desc" } }).catch(() => null)))
    : [];
  for (const jr of fromRuns) {
    if (!jr) continue;
    rows.push({
      name: jr.name,
      label: registry.get(jr.name)?.label ?? jr.name,
      intervalSec: Math.round((registry.get(jr.name)?.intervalMs ?? 0) / 1000),
      lastStartedAt: jr.startedAt,
      lastFinishedAt: jr.finishedAt,
      lastOk: jr.ok,
      lastError: jr.error,
      lastDurationMs: jr.finishedAt ? jr.finishedAt.getTime() - jr.startedAt.getTime() : null,
      lastProcessed: jr.processed,
      runs: 1,
      failures: jr.ok === false ? 1 : 0,
      updatedAt: jr.finishedAt ?? jr.startedAt,
    });
  }
  return [...names].map((name) => {
    const r = rows.find((x) => x.name === name);
    const def = registry.get(name);
    const intervalSec = def ? Math.round(def.intervalMs / 1000) : r?.intervalSec ?? 0;
    const last = r?.lastFinishedAt ?? r?.lastStartedAt ?? null;
    return {
      name,
      label: def?.label ?? r?.label ?? name,
      intervalSec,
      lastStartedAt: r?.lastStartedAt ?? null,
      lastFinishedAt: r?.lastFinishedAt ?? null,
      lastOk: r?.lastOk ?? null,
      lastError: r?.lastError ?? null,
      lastDurationMs: r?.lastDurationMs ?? null,
      lastProcessed: r?.lastProcessed ?? null,
      runs: r?.runs ?? 0,
      failures: r?.failures ?? 0,
      late: !!intervalSec && (last ? now.getTime() - last.getTime() > 2 * intervalSec * 1000 : now.getTime() - BOOT_AT > 2 * intervalSec * 1000),
      running: running.has(name),
      canRun: !!def,
    };
  });
}
