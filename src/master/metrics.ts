import { prisma } from "../lib/prisma.js";
import { monthlyCents, ymdInTz } from "./lib.js";

/**
 * Métricas do negócio.
 *
 * - A snapshot (PlatformDailyMetric) is taken once a day after midnight in Denver and kept forever:
 *   MRR, companies by state, active users and each paying company's monthly value.
 * - Months before the first snapshot are rebuilt from platform payments (period covered ÷ months),
 *   and marked as "estimado".
 * - Movement, churn, trial funnel, module usage and active users are computed from these and from product data.
 */

const DAY = 86400e3;

/* ───────────────────────── daily snapshot ───────────────────────── */

export async function currentOrgMrr(): Promise<{ map: Record<string, number>; counts: Record<string, number> }> {
  const orgs = await prisma.organization.findMany({ select: { id: true, status: true, plan: true, billingCycle: true, planPriceCents: true } });
  const map: Record<string, number> = {};
  const counts: Record<string, number> = { active: 0, trial: 0, past_due: 0, read_only: 0, suspended: 0, canceled: 0 };
  for (const o of orgs) {
    counts[o.status] = (counts[o.status] ?? 0) + 1;
    if (o.status === "active" || o.status === "past_due") map[o.id] = monthlyCents(o);
  }
  return { map, counts };
}

async function activeUserCounts(now = new Date()) {
  const today = ymdInTz(now);
  const d7 = ymdInTz(new Date(now.getTime() - 6 * DAY));
  const d30 = ymdInTz(new Date(now.getTime() - 29 * DAY));
  const [dau, wau, mau] = await Promise.all([
    prisma.activeDay.findMany({ where: { day: today }, distinct: ["userId"], select: { userId: true } }),
    prisma.activeDay.findMany({ where: { day: { gte: d7 } }, distinct: ["userId"], select: { userId: true } }),
    prisma.activeDay.findMany({ where: { day: { gte: d30 } }, distinct: ["userId"], select: { userId: true } }),
  ]);
  return { dau: dau.length, wau: wau.length, mau: mau.length };
}

/** Takes (or refreshes) the snapshot for a day. Safe to run more than once a day. */
export async function takeSnapshot(now = new Date(), day = ymdInTz(now)) {
  const [{ map, counts }, users] = await Promise.all([currentOrgMrr(), activeUserCounts(now)]);
  const data = {
    mrrCents: Object.values(map).reduce((a, b) => a + b, 0),
    paying: Object.keys(map).length,
    trial: counts.trial ?? 0,
    pastDue: counts.past_due ?? 0,
    readOnly: counts.read_only ?? 0,
    suspended: counts.suspended ?? 0,
    canceled: counts.canceled ?? 0,
    ...users,
    orgMrr: map,
  };
  await prisma.platformDailyMetric.upsert({ where: { day }, create: { day, ...data }, update: data });
  return { day, ...data };
}

/** First snapshot of the day happens when the job runs or when someone opens Métricas, whichever comes first. */
export async function ensureTodaySnapshot(now = new Date()): Promise<void> {
  const day = ymdInTz(now);
  const has = await prisma.platformDailyMetric.findUnique({ where: { day }, select: { day: true } });
  if (!has) await takeSnapshot(now, day);
}

/* ───────────────────────── MRR by month ───────────────────────── */

export type MonthPoint = {
  ym: string;
  label: string;
  mrrCents: number;
  paying: number;
  estimated: boolean;
  orgMrr: Record<string, number>;
  /** Same month rebuilt from payments — used to compare with an estimated month on equal terms. */
  estOrgMrr: Record<string, number>;
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]}${m === 1 ? " " + String(y).slice(2) : ""}`;
}

/** Last day (YYYY-MM-DD) of each of the last N months, current month = today. */
export function monthEnds(n: number, now = new Date()): { ym: string; endDay: string; endAt: Date }[] {
  const today = ymdInTz(now);
  const [y, m] = today.split("-").map(Number);
  const out: { ym: string; endDay: string; endAt: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const lastDay = `${ym}-${String(last.getUTCDate()).padStart(2, "0")}`;
    const endDay = i === 0 ? today : lastDay;
    out.push({ ym, endDay, endAt: new Date(`${endDay}T23:00:00-07:00`) });
  }
  return out;
}

/** Monthly value of each company at an instant, rebuilt from paid platform payments covering that instant. */
export function mrrFromPayments(payments: { organizationId: string; amountCents: number; periodStart: Date | null; periodEnd: Date | null; paidAt: Date }[], at: Date): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of payments) {
    const start = p.periodStart ?? p.paidAt;
    const end = p.periodEnd ?? new Date(start.getTime() + 30 * DAY);
    if (start.getTime() > at.getTime() || end.getTime() <= at.getTime()) continue;
    const days = Math.max(1, (end.getTime() - start.getTime()) / DAY);
    const months = days > 300 ? 12 : Math.max(1, Math.round(days / 30));
    map[p.organizationId] = (map[p.organizationId] ?? 0) + Math.round(p.amountCents / months);
  }
  return map;
}

export async function mrrByMonth(n = 12, now = new Date()): Promise<MonthPoint[]> {
  const ends = monthEnds(n, now);
  const [snapshots, payments] = await Promise.all([
    prisma.platformDailyMetric.findMany({ where: { day: { gte: ends[0].endDay.slice(0, 8) + "01", lte: ends[ends.length - 1].endDay } }, orderBy: { day: "asc" } }),
    prisma.platformPayment.findMany({ where: { status: "paid" }, select: { organizationId: true, amountCents: true, periodStart: true, periodEnd: true, paidAt: true } }),
  ]);
  return ends.map((e) => {
    // Latest snapshot within that month, at or before the month end.
    const snap = [...snapshots].reverse().find((s) => s.day.startsWith(e.ym) && s.day <= e.endDay);
    const estOrgMrr = mrrFromPayments(payments, e.endAt);
    if (snap) {
      return { ym: e.ym, label: monthLabel(e.ym), mrrCents: snap.mrrCents, paying: snap.paying, estimated: false, orgMrr: (snap.orgMrr ?? {}) as Record<string, number>, estOrgMrr };
    }
    return { ym: e.ym, label: monthLabel(e.ym), mrrCents: Object.values(estOrgMrr).reduce((a, b) => a + b, 0), paying: Object.keys(estOrgMrr).length, estimated: true, orgMrr: estOrgMrr, estOrgMrr };
  });
}

/* ───────────────────────── movement and churn ───────────────────────── */

export type Movement = {
  ym: string;
  label: string;
  newCents: number;
  expansionCents: number;
  reactivationCents: number;
  contractionCents: number;
  churnCents: number;
  netCents: number;
  startMrr: number;
  endMrr: number;
  startPaying: number;
  churnedCompanies: number;
  logoChurnPct: number | null;
  revenueChurnPct: number | null;
  estimated: boolean;
};

/** Month-by-month movement between consecutive month ends (needs one extra month at the start). */
export function movementFrom(points: MonthPoint[]): Movement[] {
  const out: Movement[] = [];
  const everPaid = new Set<string>();
  for (const id of Object.keys(points[0]?.estOrgMrr ?? {})) everPaid.add(id);
  for (let i = 1; i < points.length; i++) {
    // Compare like with like: two daily snapshots, or both months rebuilt from payments.
    const real = !points[i].estimated && !points[i - 1].estimated;
    const prev = real ? points[i - 1].orgMrr : points[i - 1].estOrgMrr;
    const cur = real ? points[i].orgMrr : points[i].estOrgMrr;
    const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    const m: Movement = {
      ym: points[i].ym,
      label: points[i].label,
      newCents: 0,
      expansionCents: 0,
      reactivationCents: 0,
      contractionCents: 0,
      churnCents: 0,
      netCents: 0,
      startMrr: sum(prev),
      endMrr: points[i].mrrCents,
      startPaying: Object.keys(prev).length,
      churnedCompanies: 0,
      logoChurnPct: null,
      revenueChurnPct: null,
      estimated: points[i].estimated || points[i - 1].estimated,
    };
    for (const id of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
      const a = prev[id] ?? 0;
      const b = cur[id] ?? 0;
      if (a === 0 && b > 0) {
        if (everPaid.has(id)) m.reactivationCents += b;
        else m.newCents += b;
      } else if (a > 0 && b === 0) {
        m.churnCents += a;
        m.churnedCompanies++;
      } else if (b > a) m.expansionCents += b - a;
      else if (b < a) m.contractionCents += a - b;
    }
    for (const id of Object.keys(cur)) everPaid.add(id);
    m.netCents = m.newCents + m.expansionCents + m.reactivationCents - m.contractionCents - m.churnCents;
    m.logoChurnPct = m.startPaying ? Math.round((m.churnedCompanies / m.startPaying) * 1000) / 10 : null;
    m.revenueChurnPct = m.startMrr ? Math.round(((m.churnCents + m.contractionCents) / m.startMrr) * 1000) / 10 : null;
    out.push(m);
  }
  return out;
}

/* ───────────────────────── trial funnel ───────────────────────── */

export type FunnelWeek = { weekStart: string; label: string; signups: number; activated: number; paid: number };

/** Companies by signup week (Monday, Denver): activated = sent a quote within 7 days; paid = has a paid platform payment. */
export async function trialFunnel(weeks = 12, now = new Date()): Promise<{ weeks: FunnelWeek[]; totals: { signups: number; activated: number; paid: number } }> {
  const todayUtc = new Date(`${ymdInTz(now)}T12:00:00Z`);
  const dow = (todayUtc.getUTCDay() + 6) % 7; // 0 = Monday
  const thisMonday = new Date(todayUtc.getTime() - dow * DAY);
  const firstMonday = new Date(thisMonday.getTime() - (weeks - 1) * 7 * DAY);
  const since = new Date(`${firstMonday.toISOString().slice(0, 10)}T00:00:00-06:00`);
  const orgs = await prisma.organization.findMany({ where: { createdAt: { gte: since } }, select: { id: true, createdAt: true } });
  const ids = orgs.map((o) => o.id);
  const [quotes, paid] = await Promise.all([
    ids.length ? prisma.quote.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, status: { not: "draft" } }, _min: { createdAt: true } }) : Promise.resolve([]),
    ids.length ? prisma.platformPayment.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, status: "paid" }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const firstQuote = new Map(quotes.map((q) => [q.organizationId, q._min.createdAt]));
  const paidSet = new Set(paid.map((p) => p.organizationId));
  const list: FunnelWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const ws = new Date(firstMonday.getTime() + i * 7 * DAY);
    const key = ws.toISOString().slice(0, 10);
    const [, mm, dd] = key.split("-").map(Number);
    list.push({ weekStart: key, label: `${dd} ${MONTHS[mm - 1]}`, signups: 0, activated: 0, paid: 0 });
  }
  for (const o of orgs) {
    const local = new Date(`${ymdInTz(o.createdAt)}T12:00:00Z`);
    const idx = Math.floor((local.getTime() - firstMonday.getTime()) / (7 * DAY));
    const w = list[idx];
    if (!w) continue;
    w.signups++;
    const fq = firstQuote.get(o.id);
    if (fq && fq.getTime() - o.createdAt.getTime() <= 7 * DAY) w.activated++;
    if (paidSet.has(o.id)) w.paid++;
  }
  const totals = list.reduce((a, w) => ({ signups: a.signups + w.signups, activated: a.activated + w.activated, paid: a.paid + w.paid }), { signups: 0, activated: 0, paid: 0 });
  return { weeks: list, totals };
}

/* ───────────────────────── module usage ───────────────────────── */

export type ModuleUse = { key: string; name: string; d7: number; d30: number; pct7: number; pct30: number };

/** Share of live companies (not canceled or suspended) that created something in each module in the last 7 / 30 days. */
export async function moduleUsage(now = new Date()): Promise<{ base: number; modules: ModuleUse[] }> {
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d30 = new Date(now.getTime() - 30 * DAY);
  const live = await prisma.organization.findMany({ where: { status: { notIn: ["canceled", "suspended"] } }, select: { id: true } });
  const liveIds = new Set(live.map((o) => o.id));
  type Row = { organizationId: string; _max: { createdAt: Date | null } };
  type Src = { key: string; name: string; q: (since: Date) => Promise<Row[]> };
  // One row per company with its most recent record in the window (grouped in the database).
  const g = (model: { groupBy: (args: unknown) => Promise<unknown> }) => (since: Date) =>
    model.groupBy({ by: ["organizationId"], where: { createdAt: { gte: since } }, _max: { createdAt: true } }) as Promise<Row[]>;
  const sources: Src[] = [
    { key: "leads", name: "Leads", q: g(prisma.lead as never) },
    { key: "quotes", name: "Quotes", q: g(prisma.quote as never) },
    { key: "jobs", name: "Jobs", q: g(prisma.workOrder as never) },
    { key: "invoices", name: "Invoices", q: g(prisma.quoteInvoice as never) },
    { key: "calendar", name: "Calendar", q: g(prisma.meeting as never) },
    { key: "job_media", name: "ObraCam", q: g(prisma.jobMedia as never) },
    { key: "chat", name: "ObraChat", q: g(prisma.chatMessage as never) },
    { key: "payroll", name: "Folha", q: g(prisma.payrollTimesheet as never) },
    { key: "finance", name: "Fluxo de caixa", q: g(prisma.financeCost as never) },
    { key: "field_quote", name: "Field Quote", q: g(prisma.fieldQuote as never) },
  ];
  const base = liveIds.size;
  const modules = await Promise.all(
    sources.map(async (src) => {
      const rows = (await src.q(d30).catch(() => [])).filter((r) => liveIds.has(r.organizationId));
      const d30n = rows.length;
      const d7n = rows.filter((r) => (r._max.createdAt?.getTime() ?? 0) >= d7.getTime()).length;
      return { key: src.key, name: src.name, d7: d7n, d30: d30n, pct7: base ? Math.round((d7n / base) * 100) : 0, pct30: base ? Math.round((d30n / base) * 100) : 0 };
    }),
  );
  modules.sort((a, b) => b.pct30 - a.pct30 || b.pct7 - a.pct7);
  return { base, modules };
}

/* ───────────────────────── active users ───────────────────────── */

export async function activeUsersDaily(days = 30, now = new Date()): Promise<{ day: string; label: string; users: number }[]> {
  const first = ymdInTz(new Date(now.getTime() - (days - 1) * DAY));
  const rows = await prisma.activeDay.groupBy({ by: ["day"], where: { day: { gte: first } }, _count: { _all: true } });
  const by = new Map(rows.map((r) => [r.day, r._count._all]));
  const out: { day: string; label: string; users: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = ymdInTz(new Date(now.getTime() - i * DAY));
    const [, mm, dd] = d.split("-").map(Number);
    out.push({ day: d, label: `${dd} ${MONTHS[mm - 1]}`, users: by.get(d) ?? 0 });
  }
  return out;
}

export async function activeUsersNow(now = new Date()) {
  return activeUserCounts(now);
}
