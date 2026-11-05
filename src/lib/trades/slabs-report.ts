/**
 * Relatórios › Operação: stone used on jobs in the period (Countertops slab yard): how many slabs and
 * remnants went to fabrication, the square feet, what they cost (only for people who see money) and,
 * per job, the stone plus the remakes, so the office sees what the countertops really cost.
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import type { TradePack } from "./types.js";
import { slabSf } from "./slabs.js";

export type SlabsReport = {
  used: number;
  remnants_used: number;
  sq_ft: number;
  /** null when the viewer can't see money */
  cost: number | null;
  cost_per_sf: number | null;
  /** slabs used with no cost entered: the totals miss them */
  without_cost: number;
  yard: { available: number; available_sf: number; remnants: number; reserved: number };
  by_job: Array<{ job_id: string; job: string; customer: string | null; pieces: number; sq_ft: number; cost: number | null; rework_cost: number | null }>;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function slabsReport(tx: TenantPrisma, period: { from: Date; to: Date }, pack: TradePack, showCost: boolean): Promise<SlabsReport | null> {
  if (!pack.inventory?.slabs) return null;
  const [used, yard] = await Promise.all([
    tx.slab.findMany({
      where: { status: "used", usedAt: { gte: period.from, lte: period.to } },
      include: { workOrder: { select: { id: true, number: true, title: true, customer: { select: { name: true } } } } },
      orderBy: { usedAt: "desc" },
    }),
    tx.slab.findMany({ where: { status: { in: ["available", "reserved"] } }, select: { kind: true, status: true, lengthIn: true, widthIn: true } }),
  ]);
  const sf = (r: { lengthIn: unknown; widthIn: unknown }) => slabSf(Number(r.lengthIn), Number(r.widthIn));
  const totalSf = r1(used.reduce((a, r) => a + sf(r), 0));
  const withCost = used.filter((r) => r.cost != null);
  const cost = r2(withCost.reduce((a, r) => a + Number(r.cost), 0));
  const costSf = withCost.reduce((a, r) => a + sf(r), 0);

  const jobIds = [...new Set(used.map((r) => r.workOrderId).filter((id): id is string => Boolean(id)))];
  const reworks = showCost && jobIds.length ? await tx.jobRework.findMany({ where: { workOrderId: { in: jobIds } }, select: { workOrderId: true, cost: true } }) : [];
  const reworkBy = new Map<string, number>();
  for (const r of reworks) reworkBy.set(r.workOrderId, (reworkBy.get(r.workOrderId) ?? 0) + Number(r.cost ?? 0));

  const byJob = new Map<string, SlabsReport["by_job"][number]>();
  for (const r of used) {
    if (!r.workOrder) continue;
    const j =
      byJob.get(r.workOrder.id) ??
      {
        job_id: r.workOrder.id,
        job: `#${r.workOrder.number}${r.workOrder.title ? ` · ${r.workOrder.title}` : ""}`,
        customer: r.workOrder.customer?.name ?? null,
        pieces: 0,
        sq_ft: 0,
        cost: showCost ? 0 : null,
        rework_cost: showCost ? r2(reworkBy.get(r.workOrder.id) ?? 0) : null,
      };
    j.pieces += 1;
    j.sq_ft = r1(j.sq_ft + sf(r));
    if (showCost) j.cost = r2((j.cost ?? 0) + Number(r.cost ?? 0));
    byJob.set(r.workOrder.id, j);
  }

  return {
    used: used.filter((r) => r.kind === "slab").length,
    remnants_used: used.filter((r) => r.kind === "remnant").length,
    sq_ft: totalSf,
    cost: showCost ? cost : null,
    cost_per_sf: showCost && costSf > 0 ? r2(cost / costSf) : null,
    without_cost: used.length - withCost.length,
    yard: {
      available: yard.filter((r) => r.kind === "slab" && r.status === "available").length,
      available_sf: r1(yard.filter((r) => r.status === "available").reduce((a, r) => a + sf(r), 0)),
      remnants: yard.filter((r) => r.kind === "remnant" && r.status === "available").length,
      reserved: yard.filter((r) => r.status === "reserved").length,
    },
    by_job: [...byJob.values()].sort((a, b) => (b.cost ?? b.sq_ft) - (a.cost ?? a.sq_ft)).slice(0, 12),
  };
}
