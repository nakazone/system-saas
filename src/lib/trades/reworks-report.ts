/**
 * Relatórios › Operação: pieces made again in the period (Countertops remakes), by reason and by
 * who answers for them, with the cost when the viewer may see money.
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import type { TradePack } from "./types.js";

export type ReworksReport = {
  count: number;
  jobs: number;
  /** null when the viewer can't see money */
  cost: number | null;
  by_reason: Array<{ key: string; label: string; count: number; cost: number | null }>;
  by_responsible: Array<{ key: string; label: string; count: number; cost: number | null }>;
  recent: Array<{ job_id: string; job: string; piece: string; reason: string; responsible: string; cost: number | null; at: string }>;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function reworksReport(tx: TenantPrisma, period: { from: Date; to: Date }, pack: TradePack, showCost: boolean): Promise<ReworksReport | null> {
  const cfg = pack.rework;
  if (!cfg) return null;
  const rows = await tx.jobRework.findMany({
    where: { createdAt: { gte: period.from, lte: period.to } },
    orderBy: { createdAt: "desc" },
    include: { workOrder: { select: { id: true, number: true, title: true } } },
  });
  const group = (list: typeof cfg.reasons, key: "reason" | "responsible") =>
    list
      .map((o) => {
        const mine = rows.filter((r) => r[key] === o.key);
        return { key: o.key, label: o.label["pt-BR"], count: mine.length, cost: showCost ? r2(mine.reduce((a, r) => a + Number(r.cost ?? 0), 0)) : null };
      })
      .filter((g) => g.count > 0)
      .sort((a, b) => b.count - a.count || (b.cost ?? 0) - (a.cost ?? 0));
  const label = (list: typeof cfg.reasons, key: string) => list.find((o) => o.key === key)?.label["pt-BR"] ?? key;
  return {
    count: rows.length,
    jobs: new Set(rows.map((r) => r.workOrderId)).size,
    cost: showCost ? r2(rows.reduce((a, r) => a + Number(r.cost ?? 0), 0)) : null,
    by_reason: group(cfg.reasons, "reason"),
    by_responsible: group(cfg.responsible, "responsible"),
    recent: rows.slice(0, 8).map((r) => ({
      job_id: r.workOrder.id,
      job: `#${r.workOrder.number}${r.workOrder.title ? ` · ${r.workOrder.title}` : ""}`,
      piece: r.piece,
      reason: label(cfg.reasons, r.reason),
      responsible: label(cfg.responsible, r.responsible),
      cost: showCost && r.cost != null ? Number(r.cost) : null,
      at: r.createdAt.toISOString(),
    })),
  };
}
