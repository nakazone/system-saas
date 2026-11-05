/**
 * Relatórios › Lucro › "Por job" for trades with per-job phases (Tile, Countertops): each job worked
 * in the period with what it sells (its service lines) and what it cost — crew pay from approved
 * Folha days (split by the day's sq ft, like the Folha report), stone from the slab yard, remakes and
 * finance costs posted on the job. Only for people who see prices.
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import type { TradePack } from "./types.js";

export type JobProfitRow = {
  job_id: string;
  job: string;
  customer: string | null;
  status: string;
  revenue: number;
  /** null when the viewer has no payroll access */
  labor: number | null;
  stone: number | null;
  rework: number | null;
  other: number;
  cost: number;
  profit: number;
  /** % of revenue; null without revenue */
  margin: number | null;
};

export type JobProfitReport = {
  jobs: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  /** jobs with no service lines: their cost shows, the margin can't */
  without_revenue: number;
  has_stone: boolean;
  has_rework: boolean;
  /** crew pay counted (the viewer may see Folha) */
  has_labor: boolean;
  /** more jobs than the report adds up: the totals cover the first ones */
  truncated: boolean;
  rows: JobProfitRow[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const dec = (v: unknown) => (v == null ? 0 : Number(v) || 0);

const MAX_JOBS = 1000;

export async function jobProfitReport(tx: TenantPrisma, period: { from: Date; to: Date }, pack: TradePack, opts: { labor?: boolean } = {}): Promise<JobProfitReport | null> {
  const hasLabor = opts.labor !== false;
  if (pack.phaseStorage !== "table") return null;
  const hasStone = Boolean(pack.inventory?.slabs);
  const hasRework = Boolean(pack.rework);
  // Jobs worked in the period: on the calendar between the dates, plus the ones in the field now
  // (a countertops job runs for weeks before its install date). Not drafts or canceled.
  const jobs = await tx.workOrder.findMany({
    where: {
      OR: [
        { status: "in_progress" },
        {
          status: { in: ["scheduled", "in_progress", "completed"] },
          scheduledStart: { lte: period.to },
          OR: [{ scheduledEnd: { gte: period.from } }, { scheduledEnd: null, scheduledStart: { gte: period.from } }],
        },
      ],
    },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      customer: { select: { name: true } },
      lineItems: { select: { quantitySqft: true, unitPrice: true, lineTotal: true } },
    },
    orderBy: { scheduledStart: "desc" },
    take: MAX_JOBS + 1,
  });
  const truncated = jobs.length > MAX_JOBS;
  if (truncated) jobs.length = MAX_JOBS;
  if (!jobs.length) return { jobs: 0, revenue: 0, cost: 0, profit: 0, margin: null, without_revenue: 0, has_stone: hasStone, has_rework: hasRework, has_labor: hasLabor, truncated, rows: [] };
  const ids = jobs.map((j) => j.id);

  const [shiftJobs, slabs, reworks, costs] = await Promise.all([
    !hasLabor ? Promise.resolve([]) : tx.campoShiftJob.findMany({
      where: { workOrderId: { in: ids }, shift: { reviewStatus: "approved" } },
      select: { workOrderId: true, sqft: true, shift: { select: { amount: true, jobs: { select: { sqft: true } } } } },
    }),
    hasStone ? tx.slab.findMany({ where: { workOrderId: { in: ids }, status: { in: ["reserved", "used"] } }, select: { workOrderId: true, cost: true } }) : Promise.resolve([]),
    hasRework ? tx.jobRework.findMany({ where: { workOrderId: { in: ids } }, select: { workOrderId: true, cost: true } }) : Promise.resolve([]),
    tx.financeCost.findMany({ where: { workOrderId: { in: ids }, status: "posted" }, select: { workOrderId: true, amount: true } }),
  ]);

  const add = (m: Map<string, number>, id: string | null, v: number) => id && m.set(id, (m.get(id) ?? 0) + v);
  const labor = new Map<string, number>();
  for (const sj of shiftJobs) {
    // One day on several jobs: the pay is split by the sq ft of each, evenly when none was recorded.
    const all = sj.shift.jobs;
    const total = all.reduce((t, j) => t + dec(j.sqft), 0);
    const share = total > 0 ? dec(sj.sqft) / total : 1 / Math.max(1, all.length);
    add(labor, sj.workOrderId, dec(sj.shift.amount) * share);
  }
  const stone = new Map<string, number>();
  for (const s of slabs) add(stone, s.workOrderId, dec(s.cost));
  const rework = new Map<string, number>();
  for (const r of reworks) add(rework, r.workOrderId, dec(r.cost));
  const other = new Map<string, number>();
  for (const c of costs) add(other, c.workOrderId, dec(c.amount));

  const rows: JobProfitRow[] = jobs.map((j) => {
    const revenue = r2(j.lineItems.reduce((s, li) => s + (dec(li.lineTotal) || dec(li.quantitySqft) * dec(li.unitPrice)), 0));
    const l = hasLabor ? r2(labor.get(j.id) ?? 0) : null;
    const st = hasStone ? r2(stone.get(j.id) ?? 0) : null;
    const rw = hasRework ? r2(rework.get(j.id) ?? 0) : null;
    const o = r2(other.get(j.id) ?? 0);
    const cost = r2((l ?? 0) + (st ?? 0) + (rw ?? 0) + o);
    return {
      job_id: j.id,
      job: `#${j.number}${j.title ? ` · ${j.title}` : ""}`,
      customer: j.customer?.name ?? null,
      status: j.status,
      revenue,
      labor: l,
      stone: st,
      rework: rw,
      other: o,
      cost,
      profit: r2(revenue - cost),
      margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
    };
  });
  const revenue = r2(rows.reduce((s, r) => s + r.revenue, 0));
  const cost = r2(rows.reduce((s, r) => s + r.cost, 0));
  return {
    jobs: rows.length,
    revenue,
    cost,
    profit: r2(revenue - cost),
    margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
    without_revenue: rows.filter((r) => r.revenue <= 0).length,
    has_stone: hasStone,
    has_rework: hasRework,
    has_labor: hasLabor,
    truncated,
    // Lowest margin first: the jobs to look at.
    rows: rows.sort((a, b) => (a.margin ?? Infinity) - (b.margin ?? Infinity) || b.cost - a.cost).slice(0, 40),
  };
}
