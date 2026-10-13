import { prisma } from "../prisma.js";

/** Audit line written by the system itself (Stripe webhook, billing job). */
export async function systemAudit(
  action: string,
  target: { type?: string; id?: string | null; label?: string | null; meta?: unknown },
  actorName = action.startsWith("stripe.") || action.startsWith("payment.stripe") || action === "payment.dispute" ? "Stripe" : "Sistema",
): Promise<void> {
  try {
    let label = target.label ?? null;
    if (!label && target.type === "organization" && target.id) {
      label = (await prisma.organization.findUnique({ where: { id: target.id }, select: { name: true } }))?.name ?? null;
    }
    await prisma.platformAuditLog.create({
      data: {
        actorId: null,
        actorName,
        action,
        targetType: target.type ?? null,
        targetId: target.id ?? null,
        targetLabel: label,
        meta: (target.meta ?? undefined) as never,
      },
    });
  } catch (error) {
    console.error("[audit] system audit failed", error);
  }
}
