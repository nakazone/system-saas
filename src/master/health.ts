import { prisma } from "../lib/prisma.js";
import { ymdInTz } from "./lib.js";

/**
 * Ficha 360°: onboarding checklist, health score and active-day tracking.
 *
 * Everything is computed from real data with a fixed number of grouped queries (independent of how many
 * companies exist), cached for a few minutes. Reads every company: needs the platform's privileged DB role,
 * like the rest of the Master.
 */

/* ───────────────────────── active days (written by the CRM) ───────────────────────── */

const seen = new Set<string>();
let seenDay = "";

/** Records that this user used the CRM today (once per user per day; support sessions don't count). */
export function markActiveDay(userId: string, organizationId: string, now = new Date()): void {
  const day = ymdInTz(now);
  if (day !== seenDay) {
    seen.clear();
    seenDay = day;
  }
  const k = `${userId}:${day}`;
  if (seen.has(k)) return;
  seen.add(k);
  void prisma.activeDay
    .createMany({ data: [{ userId, organizationId, day }], skipDuplicates: true })
    .catch(() => seen.delete(k));
}

/* ───────────────────────── onboarding ───────────────────────── */

export const ONBOARDING_STEPS = [
  { key: "team", label: "Equipe convidada" },
  { key: "prices", label: "Tabela de preços" },
  { key: "lead", label: "Primeiro lead" },
  { key: "quote", label: "Primeiro orçamento enviado" },
  { key: "job", label: "Primeiro job" },
  { key: "invoice", label: "Primeira fatura" },
] as const;
export type StepKey = (typeof ONBOARDING_STEPS)[number]["key"];

export type HealthPart = { label: string; points: number; max: number; note: string };
export type OrgHealth = {
  organizationId: string;
  steps: { key: StepKey; label: string; done: boolean; at: Date | null }[];
  stepsDone: number;
  score: number;
  band: "ok" | "warn" | "risk" | "new";
  bandLabel: string;
  parts: HealthPart[];
  activeDays14: number;
  activeUsers30: number;
  lastActive: Date | null;
  firstActive: Date | null;
  created30: number;
};

type CountMin = { n: number; first: Date | null };
function byOrg<T extends { organizationId: string }>(rows: T[], f: (r: T) => CountMin): Map<string, CountMin> {
  return new Map(rows.map((r) => [r.organizationId, f(r)]));
}

let cache: { at: number; value: Map<string, OrgHealth> } | null = null;
const TTL_MS = 5 * 60_000;

export function invalidateHealth(): void {
  cache = null;
}

/** Health of every company (or one), cached 5 minutes. */
export async function healthOf(organizationId?: string): Promise<Map<string, OrgHealth>> {
  if (!organizationId && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (organizationId && cache && Date.now() - cache.at < TTL_MS && cache.value.has(organizationId)) return new Map([[organizationId, cache.value.get(organizationId)!]]);
  const value = await compute(organizationId);
  if (!organizationId) cache = { at: Date.now(), value };
  return value;
}

async function compute(onlyOrg?: string): Promise<Map<string, OrgHealth>> {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400e3);
  const day14 = ymdInTz(new Date(now.getTime() - 13 * 86400e3));
  const day30 = ymdInTz(d30);
  const org = onlyOrg ? { organizationId: onlyOrg } : {};
  const orgs = await prisma.organization.findMany({
    where: onlyOrg ? { id: onlyOrg } : { status: { not: "canceled" } },
    select: { id: true, status: true, createdAt: true },
  });

  const [users, invites, prices, leads, quotes, jobs, invoices, recentLeads, recentQuotes, recentJobs, recentInvoices, days14, days30, dayRange, trackingStart] = await Promise.all([
    prisma.user.groupBy({ by: ["organizationId"], where: { ...org, status: { not: "disabled" } }, _count: { _all: true } }),
    prisma.invitation.groupBy({ by: ["organizationId"], where: { ...org }, _count: { _all: true }, _min: { createdAt: true } }),
    prisma.pricingItem.groupBy({ by: ["organizationId"], where: { ...org }, _count: { _all: true }, _max: { createdAt: true, updatedAt: true } }),
    prisma.lead.groupBy({ by: ["organizationId"], where: { ...org }, _count: { _all: true }, _min: { createdAt: true } }),
    prisma.quote.groupBy({ by: ["organizationId"], where: { ...org, status: { not: "draft" } }, _count: { _all: true }, _min: { createdAt: true } }),
    prisma.workOrder.groupBy({ by: ["organizationId"], where: { ...org }, _count: { _all: true }, _min: { createdAt: true } }),
    prisma.quoteInvoice.groupBy({ by: ["organizationId"], where: { ...org, status: { not: "draft" } }, _count: { _all: true }, _min: { issuedAt: true, createdAt: true } }),
    prisma.lead.groupBy({ by: ["organizationId"], where: { ...org, createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.quote.groupBy({ by: ["organizationId"], where: { ...org, createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ["organizationId"], where: { ...org, createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.quoteInvoice.groupBy({ by: ["organizationId"], where: { ...org, createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.activeDay.groupBy({ by: ["organizationId", "day"], where: { ...org, day: { gte: day14 } } }),
    prisma.activeDay.groupBy({ by: ["organizationId", "userId"], where: { ...org, day: { gte: day30 } } }),
    prisma.activeDay.groupBy({ by: ["organizationId"], where: { ...org }, _min: { createdAt: true }, _max: { createdAt: true } }),
    prisma.activeDay.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
  ]);

  const usersBy = new Map(users.map((r) => [r.organizationId, r._count._all]));
  const invitesBy = byOrg(invites, (r) => ({ n: r._count._all, first: r._min.createdAt }));
  // New companies get a default price table: the step counts only when they add or edit prices afterwards.
  const pricesTouched = new Map(prices.map((r) => {
    const a = r._max.createdAt?.getTime() ?? 0;
    const b = r._max.updatedAt?.getTime() ?? 0;
    return [r.organizationId, new Date(Math.max(a, b))] as const;
  }));
  const leadsBy = byOrg(leads, (r) => ({ n: r._count._all, first: r._min.createdAt }));
  const quotesBy = byOrg(quotes, (r) => ({ n: r._count._all, first: r._min.createdAt }));
  const jobsBy = byOrg(jobs, (r) => ({ n: r._count._all, first: r._min.createdAt }));
  const invoicesBy = byOrg(invoices, (r) => ({ n: r._count._all, first: r._min.issuedAt ?? r._min.createdAt }));
  const recent = new Map<string, number>();
  for (const list of [recentLeads, recentQuotes, recentJobs, recentInvoices]) for (const r of list) recent.set(r.organizationId, (recent.get(r.organizationId) ?? 0) + r._count._all);
  const active14 = new Map<string, number>();
  for (const r of days14) active14.set(r.organizationId, (active14.get(r.organizationId) ?? 0) + 1);
  const users30 = new Map<string, number>();
  for (const r of days30) users30.set(r.organizationId, (users30.get(r.organizationId) ?? 0) + 1);
  const rangeBy = new Map(dayRange.map((r) => [r.organizationId, { first: r._min.createdAt, last: r._max.createdAt }]));
  // Usage tracking starts with this feature; don't punish companies for days before it existed.
  const trackedDays = trackingStart ? Math.min(14, Math.max(1, Math.round((now.getTime() - new Date(`${trackingStart.day}T12:00:00Z`).getTime()) / 86400e3) + 1)) : 0;

  const out = new Map<string, OrgHealth>();
  for (const o of orgs) {
    const teamFirst = invitesBy.get(o.id)?.first ?? null;
    const stepState: Record<StepKey, { done: boolean; at: Date | null }> = {
      team: { done: (usersBy.get(o.id) ?? 0) > 1 || (invitesBy.get(o.id)?.n ?? 0) > 0, at: teamFirst },
      prices: (() => {
        const t = pricesTouched.get(o.id);
        const done = !!t && t.getTime() > o.createdAt.getTime() + 10 * 60e3;
        return { done, at: done ? t! : null };
      })(),
      lead: { done: (leadsBy.get(o.id)?.n ?? 0) > 0, at: leadsBy.get(o.id)?.first ?? null },
      quote: { done: (quotesBy.get(o.id)?.n ?? 0) > 0, at: quotesBy.get(o.id)?.first ?? null },
      job: { done: (jobsBy.get(o.id)?.n ?? 0) > 0, at: jobsBy.get(o.id)?.first ?? null },
      invoice: { done: (invoicesBy.get(o.id)?.n ?? 0) > 0, at: invoicesBy.get(o.id)?.first ?? null },
    };
    const steps = ONBOARDING_STEPS.map((s) => ({ key: s.key, label: s.label, ...stepState[s.key] }));
    const stepsDone = steps.filter((s) => s.done).length;
    const activeDays14 = active14.get(o.id) ?? 0;
    const created30 = recent.get(o.id) ?? 0;

    // The first week after tracking starts there isn't enough history: usage counts as neutral (half).
    const enoughHistory = trackedDays >= 7;
    const usagePts = enoughHistory ? Math.round(Math.min(1, activeDays14 / Math.min(10, trackedDays)) * 40) : 20;
    const onboardPts = Math.round((stepsDone / steps.length) * 25);
    const depthPts = Math.round(Math.min(1, created30 / 20) * 20);
    const payPts = o.status === "active" ? 15 : o.status === "trial" ? 10 : o.status === "past_due" ? 5 : 0;
    const parts: HealthPart[] = [
      { label: "Uso", points: usagePts, max: 40, note: enoughHistory ? `${activeDays14} dia(s) com uso nos últimos ${Math.min(14, trackedDays)}` : `medindo há ${trackedDays} dia(s) · conta como neutro até 7` },
      { label: "Onboarding", points: onboardPts, max: 25, note: `${stepsDone} de ${steps.length} passos` },
      { label: "Movimento", points: depthPts, max: 20, note: `${created30} lead(s), orçamento(s), job(s) e fatura(s) em 30 dias` },
      { label: "Pagamento", points: payPts, max: 15, note: { active: "em dia", trial: "em teste", past_due: "atrasado", read_only: "só leitura", suspended: "suspensa" }[o.status] ?? o.status },
    ];
    const score = parts.reduce((a, p) => a + p.points, 0);
    const isNew = now.getTime() - o.createdAt.getTime() < 7 * 86400e3;
    const band: OrgHealth["band"] = isNew ? "new" : score >= 70 ? "ok" : score >= 50 ? "warn" : "risk";
    out.set(o.id, {
      organizationId: o.id,
      steps,
      stepsDone,
      score,
      band,
      bandLabel: { new: "Nova", ok: "Saudável", warn: "Atenção", risk: "Risco" }[band],
      parts,
      activeDays14,
      activeUsers30: users30.get(o.id) ?? 0,
      lastActive: rangeBy.get(o.id)?.last ?? null,
      firstActive: rangeBy.get(o.id)?.first ?? null,
      created30,
    });
  }
  return out;
}
