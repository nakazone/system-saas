import { prisma } from "../prisma.js";

/**
 * Avisos da plataforma (Master › Comunicação › Avisos) shown as a banner at the top of the CRM.
 *  - audience: every company, companies on some plans, or chosen companies;
 *  - kind: info | maintenance | urgent — urgent can't be closed;
 *  - window: startsAt … endsAt (or until the Master takes it down).
 * One receipt per user records "seen" (first display) and "closed".
 */

export const KINDS = [
  { key: "info", label: "Informação", hint: "Novidade, dica ou recado. A pessoa pode fechar." },
  { key: "maintenance", label: "Manutenção", hint: "Parada ou lentidão prevista. A pessoa pode fechar." },
  { key: "urgent", label: "Urgente", hint: "Problema agora ou ação obrigatória. Não dá para fechar." },
] as const;
export type Kind = (typeof KINDS)[number]["key"];

export const AUDIENCES = [
  { key: "all", label: "Todas as empresas" },
  { key: "plans", label: "Por plano" },
  { key: "companies", label: "Empresas escolhidas" },
] as const;
export type Audience = (typeof AUDIENCES)[number]["key"];

/** Companies that can still open the app (others never see a banner). */
const VISIBLE_STATUSES = ["trial", "active", "past_due", "read_only"];

export type AnnouncementForApp = {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  dismissible: boolean;
};

const ORDER: Record<string, number> = { urgent: 0, maintenance: 1, info: 2 };

export function isLive(a: { startsAt: Date; endsAt: Date | null; endedAt: Date | null }, now = new Date()): boolean {
  return a.startsAt <= now && !a.endedAt && (!a.endsAt || a.endsAt > now);
}

export function reaches(a: { audience: string; plans: string[]; organizationIds: string[] }, org: { id: string; plan: string }): boolean {
  if (a.audience === "plans") return a.plans.includes(org.plan);
  if (a.audience === "companies") return a.organizationIds.includes(org.id);
  return true;
}

/** Live notices for this user, closed ones left out. Records "seen" unless `track` is false (support mode). */
export async function announcementsForApp(
  org: { id: string; plan: string; status: string },
  userId: string,
  opts: { track?: boolean; now?: Date } = {},
): Promise<AnnouncementForApp[]> {
  if (!VISIBLE_STATUSES.includes(org.status)) return [];
  const now = opts.now ?? new Date();
  const rows = await prisma.platformAnnouncement.findMany({
    where: {
      startsAt: { lte: now },
      endedAt: null,
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    include: { receipts: { where: { userId }, select: { dismissedAt: true } } },
    orderBy: { startsAt: "desc" },
    take: 30,
  });
  const live = rows
    .filter((a) => reaches(a, org))
    .filter((a) => a.kind === "urgent" || !a.receipts[0]?.dismissedAt)
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) || b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, 3);
  if (opts.track !== false) {
    const unseen = live.filter((a) => !a.receipts.length);
    if (unseen.length) {
      await prisma.platformAnnouncementReceipt
        .createMany({ data: unseen.map((a) => ({ announcementId: a.id, userId, organizationId: org.id })), skipDuplicates: true })
        .catch(() => undefined);
    }
  }
  return live.map((a) => ({
    id: a.id,
    kind: a.kind as Kind,
    title: a.title,
    body: a.body,
    link_url: a.linkUrl,
    link_label: a.linkLabel,
    dismissible: a.kind !== "urgent",
  }));
}

/** User closed the banner. Urgent notices can't be closed. */
export async function dismissAnnouncement(id: string, userId: string, organizationId: string): Promise<"ok" | "not_found" | "urgent"> {
  const a = await prisma.platformAnnouncement.findUnique({ where: { id }, select: { kind: true } }).catch(() => null);
  if (!a) return "not_found";
  if (a.kind === "urgent") return "urgent";
  const now = new Date();
  await prisma.platformAnnouncementReceipt.upsert({
    where: { announcementId_userId: { announcementId: id, userId } },
    create: { announcementId: id, userId, organizationId, dismissedAt: now },
    update: { dismissedAt: now },
  });
  return "ok";
}

/** Companies a notice reaches today and how many users saw / closed it (Master list). */
export async function reachOf(ids: string[]) {
  const [seen, closed, orgs] = await Promise.all([
    prisma.platformAnnouncementReceipt.groupBy({ by: ["announcementId"], where: { announcementId: { in: ids } }, _count: { _all: true } }),
    prisma.platformAnnouncementReceipt.groupBy({ by: ["announcementId"], where: { announcementId: { in: ids }, dismissedAt: { not: null } }, _count: { _all: true } }),
    prisma.platformAnnouncementReceipt.groupBy({ by: ["announcementId", "organizationId"], where: { announcementId: { in: ids } } }),
  ]);
  const out = new Map<string, { seen: number; closed: number; companies: number }>();
  for (const id of ids) out.set(id, { seen: 0, closed: 0, companies: 0 });
  for (const r of seen) out.get(r.announcementId)!.seen = r._count._all;
  for (const r of closed) out.get(r.announcementId)!.closed = r._count._all;
  for (const r of orgs) out.get(r.announcementId)!.companies++;
  return out;
}

/** How many companies (that can open the app) a notice targets. */
export async function targetCount(a: { audience: string; plans: string[]; organizationIds: string[] }): Promise<number> {
  const where = { status: { in: VISIBLE_STATUSES } } as Record<string, unknown>;
  if (a.audience === "plans") where.plan = { in: a.plans };
  if (a.audience === "companies") where.id = { in: a.organizationIds };
  return prisma.organization.count({ where });
}
