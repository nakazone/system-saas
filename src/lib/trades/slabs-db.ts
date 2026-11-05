/** Slab yard reads and writes used by the job screens (the yard's own routes live in crm/routes/slabs.ts). */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { recordActivity } from "../activity/record.js";
import { mapSlab } from "./slabs.js";

const JOB_SELECT = { select: { id: true, number: true, title: true, customer: { select: { name: true } } } } as const;

/** Slabs held for or used on a job, for the job's Fases tab. */
export async function jobSlabs(tx: TenantPrisma, organizationId: string, workOrderId: string, showCost: boolean) {
  const rows = await tx.slab.findMany({ where: { organizationId, workOrderId }, include: { workOrder: JOB_SELECT }, orderBy: [{ reservedAt: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => mapSlab(r, showCost));
}

/**
 * The phase that cuts the stone closed (Countertops: Fabricação): the slabs reserved for the job
 * are now used. Logged on the job like a change by hand.
 */
export async function useReservedSlabs(tx: TenantPrisma, organizationId: string, workOrderId: string, actorId: string | null, at = new Date()): Promise<number> {
  const rows = await tx.slab.findMany({ where: { organizationId, workOrderId, status: "reserved" }, select: { id: true, color: true, serial: true, kind: true } });
  if (!rows.length) return 0;
  // Only the ones still reserved for this job (someone may release one at the same moment).
  await tx.slab.updateMany({ where: { id: { in: rows.map((r) => r.id) }, workOrderId, status: "reserved" }, data: { status: "used", usedAt: at } });
  for (const r of rows) {
    await recordActivity(tx, {
      organizationId,
      entityType: "work_order",
      entityId: workOrderId,
      action: "slab.used",
      actorType: actorId ? "user" : "system",
      actorId,
      changes: {
        slab_id: { from: null, to: r.id },
        slab: { from: null, to: `${r.kind === "remnant" ? "Sobra" : "Slab"} ${r.color}${r.serial ? ` · ${r.serial}` : ""}` },
        reason: { from: null, to: "phase_closed" },
      },
    });
  }
  return rows.length;
}
