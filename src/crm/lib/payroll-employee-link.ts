/**
 * Link CRM login ↔ PayrollEmployee (by userId, or email auto-link).
 */
import type { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";

export type PayrollTx = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

export async function findLinkableUserId(
  tx: PayrollTx,
  organizationId: string,
  email: string | null | undefined,
  exceptEmployeeId?: string,
): Promise<string | null> {
  const em = email ? String(email).trim().toLowerCase() : "";
  if (!em) return null;
  const user = await tx.user.findFirst({
    where: { organizationId, email: { equals: em, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) return null;
  const taken = await tx.payrollEmployee.findFirst({
    where: {
      userId: user.id,
      ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}),
    },
    select: { id: true },
  });
  return taken ? null : user.id;
}

/**
 * Resolve the PayrollEmployee for the logged-in user.
 * 1) Direct userId link
 * 2) Same email on an unlinked employee → set userId
 */
export async function resolveOwnEmployee(
  tx: PayrollTx,
  userId: string,
  email: string | undefined | null,
) {
  let emp = await tx.payrollEmployee.findFirst({ where: { userId } });
  if (emp) return emp;

  const em = email ? String(email).trim().toLowerCase() : "";
  if (!em) return null;

  emp = await tx.payrollEmployee.findFirst({
    where: { email: { equals: em, mode: "insensitive" } },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (!emp) return null;
  if (emp.userId === userId) return emp;
  if (emp.userId != null) {
    // Email belongs to another linked employee
    return null;
  }
  return tx.payrollEmployee.update({
    where: { id: emp.id },
    data: { userId },
  });
}
