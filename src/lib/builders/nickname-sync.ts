import type { TenantPrisma } from "../tenant/prisma-tenant.js";

type Tx = TenantPrisma;

function norm(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function cleanNickname(value: unknown): string | null {
  const nick = String(value ?? "").trim().slice(0, 40);
  return nick || null;
}

/** Keep the short calendar name on the matching builder and builder customer. */
export async function mirrorNickname(
  tx: Tx,
  organizationId: string,
  nickname: string | null,
  hints: { company?: string | null; name?: string | null; email?: string | null },
  skip: { customerId?: string; builderId?: string } = {},
): Promise<void> {
  const nick = cleanNickname(nickname);
  if (!nick) return;
  const names = [hints.company, hints.name].map(norm).filter((s) => s.length >= 3);
  const email = norm(hints.email);
  if (!names.length && !email) return;

  const builders = await tx.builder.findMany({
    where: { organizationId, ...(skip.builderId ? { id: { not: skip.builderId } } : {}) },
    select: { id: true, company: true, email: true, firstName: true, lastName: true },
  });
  const builderIds = builders
    .filter((b) => {
      const company = norm(b.company);
      const person = norm([b.firstName, b.lastName].filter(Boolean).join(" "));
      const mail = norm(b.email);
      return (email && mail === email) || names.some((n) => n === company || n === person);
    })
    .map((b) => b.id);
  if (builderIds.length) {
    await tx.builder.updateMany({ where: { id: { in: builderIds } }, data: { nickname: nick } });
  }

  const customers = await tx.customer.findMany({
    where: {
      organizationId,
      customerType: { in: ["builder", "contractor", "loja"] },
      ...(skip.customerId ? { id: { not: skip.customerId } } : {}),
    },
    select: { id: true, name: true, company: true, email: true },
  });
  const customerIds = customers
    .filter((c) => {
      const name = norm(c.name);
      const company = norm(c.company);
      const mail = norm(c.email);
      return (email && mail === email) || names.some((n) => n === name || n === company);
    })
    .map((c) => c.id);
  if (customerIds.length) {
    await tx.customer.updateMany({ where: { id: { in: customerIds } }, data: { nickname: nick } });
  }
}
