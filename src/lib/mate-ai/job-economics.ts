/**
 * Money of one job: labor from the field days (campo shifts) and what was sold/invoiced.
 *
 * A field day can cover several jobs. Its pay is split among them by the sq ft logged on each
 * job that day; with no sq ft, it is split evenly.
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";

export type JobLabor = {
  total: number;
  days: number;
  byEmployee: Array<{ name: string; days: number; amount: number }>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function jobLabor(tx: TenantPrisma, workOrderId: string): Promise<JobLabor> {
  const links = await tx.campoShiftJob.findMany({
    where: { workOrderId },
    select: {
      shiftId: true,
      sqft: true,
      shift: {
        select: {
          id: true,
          amount: true,
          daysWorked: true,
          status: true,
          employee: { select: { name: true } },
          user: { select: { name: true } },
          jobs: { select: { workOrderId: true, sqft: true } },
        },
      },
    },
  });
  const per = new Map<string, { name: string; days: number; amount: number }>();
  let total = 0;
  let days = 0;
  for (const l of links) {
    const s = l.shift;
    if (!s || s.status === "canceled") continue;
    const sqftAll = s.jobs.reduce((a, j) => a + Number(j.sqft || 0), 0);
    const share = sqftAll > 0 ? Number(l.sqft || 0) / sqftAll : 1 / Math.max(1, s.jobs.length);
    const amount = Number(s.amount || 0) * share;
    const d = Number(s.daysWorked || 0) * share;
    const name = s.employee?.name || s.user?.name || "Funcionário";
    const cur = per.get(name) || { name, days: 0, amount: 0 };
    cur.days += d;
    cur.amount += amount;
    per.set(name, cur);
    total += amount;
    days += d;
  }
  return {
    total: round2(total),
    days: Math.round(days * 10) / 10,
    byEmployee: [...per.values()].map((p) => ({ ...p, amount: round2(p.amount), days: Math.round(p.days * 10) / 10 })).sort((a, b) => b.amount - a.amount),
  };
}
