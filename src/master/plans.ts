import { prisma } from "../lib/prisma.js";
import { PLAN_ANNUAL_CENTS, PLAN_LABEL, PLAN_MONTHLY_CENTS } from "./lib.js";

export type PlanRow = Awaited<ReturnType<typeof prisma.plan.findMany>>[number];

let cache: PlanRow[] = [];
let loadedAt = 0;

/** Reloads the plan catalog into memory (and into the sync price maps in lib.ts). */
export async function refreshPlans(): Promise<PlanRow[]> {
  try {
    const rows = await prisma.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { monthlyCents: "asc" }] });
    if (rows.length) {
      for (const k of Object.keys(PLAN_MONTHLY_CENTS)) if (!rows.some((r) => r.key === k)) delete PLAN_MONTHLY_CENTS[k];
      for (const r of rows) {
        PLAN_MONTHLY_CENTS[r.key] = r.monthlyCents;
        PLAN_ANNUAL_CENTS[r.key] = r.annualCents;
        PLAN_LABEL[r.key] = r.name;
      }
      cache = rows;
    }
    loadedAt = Date.now();
  } catch (error) {
    console.error("[plans] refresh failed", error);
  }
  return cache;
}

/** Catalog, refreshed at most once a minute. */
export async function plans(): Promise<PlanRow[]> {
  if (!cache.length || Date.now() - loadedAt > 60_000) await refreshPlans();
  return cache;
}

export async function planByKey(key: string | null | undefined): Promise<PlanRow | null> {
  const k = String(key || "").toLowerCase();
  return (await plans()).find((p) => p.key === k) ?? null;
}

/** Trial length for new companies (from the plan, default 30). */
export async function trialDaysFor(key = "starter"): Promise<number> {
  return (await planByKey(key))?.trialDays ?? 30;
}
