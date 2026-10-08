import { prisma } from "../lib/prisma.js";
import {
  avatarBg,
  cyclePriceCents,
  daysUntil,
  dueChip,
  dueDateOf,
  initials,
  monthlyCents,
  money,
  orgStatusPill,
  planLabel,
  shortDate,
  type Pill,
} from "./lib.js";

const orgSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  plan: true,
  billingCycle: true,
  planPriceCents: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  contactEmail: true,
  contactPhone: true,
  billingContactName: true,
  billingContactEmail: true,
  billingContactPhone: true,
  city: true,
  state: true,
  timezone: true,
  stripeCustomerId: true,
  suspendedAt: true,
  canceledAt: true,
  cancelReason: true,
  createdAt: true,
  _count: { select: { users: true } },
} as const;

export type OrgRow = Awaited<ReturnType<typeof loadOrgs>>[number];

/** Owner = earliest admin user of each organization. */
async function ownersByOrg(orgIds: string[]): Promise<Map<string, { id: string; name: string; email: string }>> {
  if (!orgIds.length) return new Map();
  const admins = await prisma.user.findMany({
    where: { organizationId: { in: orgIds }, role: { key: "admin" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, organizationId: true },
  });
  const map = new Map<string, { id: string; name: string; email: string }>();
  for (const a of admins) if (!map.has(a.organizationId)) map.set(a.organizationId, { id: a.id, name: a.name, email: a.email });
  // Fallback: earliest user of any role
  const missing = orgIds.filter((id) => !map.has(id));
  if (missing.length) {
    const users = await prisma.user.findMany({
      where: { organizationId: { in: missing } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, organizationId: true },
    });
    for (const u of users) if (!map.has(u.organizationId)) map.set(u.organizationId, { id: u.id, name: u.name, email: u.email });
  }
  return map;
}

export async function loadOrgs(where: Record<string, unknown> = {}) {
  const orgs = await prisma.organization.findMany({ where, select: orgSelect, orderBy: { createdAt: "desc" } });
  const owners = await ownersByOrg(orgs.map((o) => o.id));
  const now = new Date();
  return orgs.map((o) => {
    const due = dueDateOf(o);
    const days = daysUntil(due, now);
    const owner = owners.get(o.id) ?? null;
    const price = cyclePriceCents(o);
    return {
      ...o,
      owner,
      ownerName: owner?.name ?? "—",
      ownerEmail: owner?.email ?? o.contactEmail ?? "",
      ownerPhone: o.contactPhone ?? "",
      users: o._count.users,
      due,
      days,
      dueLabel: shortDate(due, now),
      dueKind: o.status === "trial" ? "Fim do trial" : "Renovação",
      pill: orgStatusPill(o.status, days),
      chip: o.status === "canceled" ? ({ label: "Cancelada", tone: "muted" } as Pill) : dueChip(days),
      planText: o.status === "trial" ? `Trial · ${planLabel(o.plan)}` : planLabel(o.plan),
      cycleText: o.billingCycle === "annual" ? "Anual" : "Mensal",
      priceCents: price,
      priceText: o.status === "trial" || o.status === "canceled" ? "—" : money(price) + (o.billingCycle === "annual" ? "/ano" : "/mês"),
      monthlyCents: o.status === "active" || o.status === "past_due" ? monthlyCents(o) : 0,
      initials: initials(o.name),
      avatarBg: avatarBg(o.id),
      overdue: days != null && days < 0 && o.status !== "canceled",
    };
  });
}

export async function loadOrg(id: string) {
  const [o] = await loadOrgs({ id });
  return o ?? null;
}

/** Map of userId → number of live CRM sessions (express-session store). */
export async function sessionCounts(): Promise<Map<string, number>> {
  try {
    const rows = await prisma.$queryRaw<{ uid: string; n: bigint }[]>`
      SELECT sess->>'userId' AS uid, COUNT(*)::bigint AS n
      FROM "session"
      WHERE expire > NOW() AND sess->>'userId' IS NOT NULL
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.uid, Number(r.n)]));
  } catch {
    return new Map();
  }
}

export async function endUserSessions(userIds: string[]): Promise<number> {
  if (!userIds.length) return 0;
  try {
    return await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ANY(${userIds}::text[])`;
  } catch {
    return 0;
  }
}

export async function endOrgSessions(organizationId: string): Promise<number> {
  try {
    return await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'organizationId' = ${organizationId}`;
  } catch {
    return 0;
  }
}

export const USER_STATUS_PILL: Record<string, Pill> = {
  active: { label: "Ativo", tone: "ink" },
  invited: { label: "Convidado", tone: "warn" },
  suspended: { label: "Bloqueado", tone: "danger" },
  disabled: { label: "Desativado", tone: "muted" },
};

export async function loadUsers(where: Record<string, unknown> = {}) {
  const [users, sessions] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ organization: { name: "asc" } }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        mustChangePassword: true,
        createdAt: true,
        organizationId: true,
        organization: { select: { id: true, name: true, status: true } },
        role: { select: { key: true, name: true } },
      },
    }),
    sessionCounts(),
  ]);
  return users.map((u) => {
    const orgBlocked = u.organization.status === "suspended" || u.organization.status === "canceled";
    const pill = orgBlocked && u.status === "active"
      ? ({ label: u.organization.status === "suspended" ? "Empresa suspensa" : "Empresa cancelada", tone: "dark" } as Pill)
      : USER_STATUS_PILL[u.status] ?? { label: u.status, tone: "muted" };
    return {
      ...u,
      roleName: u.role?.name ?? "Sem papel",
      isAdmin: u.role?.key === "admin",
      orgName: u.organization.name,
      sessions: sessions.get(u.id) ?? 0,
      pill,
      initials: initials(u.name),
      avatarBg: avatarBg(u.id),
      created: shortDate(u.createdAt),
    };
  });
}

export const PAYMENT_PILL: Record<string, Pill> = {
  paid: { label: "Pago", tone: "ink" },
  refunded: { label: "Estornado", tone: "muted" },
};

export const METHOD_LABEL: Record<string, string> = {
  card: "Cartão",
  ach: "ACH",
  zelle: "Zelle",
  check: "Cheque",
  cash: "Dinheiro",
  other: "Outro",
};

export async function loadPayments(where: Record<string, unknown> = {}, take = 300) {
  const rows = await prisma.platformPayment.findMany({
    where,
    orderBy: { paidAt: "desc" },
    take,
    include: { organization: { select: { id: true, name: true } } },
  });
  return rows.map((p) => ({
    ...p,
    orgName: p.organization.name,
    amountText: money(p.amountCents),
    paidLabel: shortDate(p.paidAt),
    periodText: p.periodStart && p.periodEnd ? `${shortDate(p.periodStart)} → ${shortDate(p.periodEnd)}` : "—",
    methodText: METHOD_LABEL[p.method] ?? p.method,
    pill: PAYMENT_PILL[p.status] ?? { label: p.status, tone: "muted" },
  }));
}

export function startOfMonthInTz(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit" }).format(now);
  return new Date(`${ymd}-01T07:00:00Z`);
}
