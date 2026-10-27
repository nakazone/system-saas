/**
 * Mate AI daily brief: at the hour each user chose (company timezone), a short summary of the
 * day — agenda, money to collect, quotes waiting, follow-ups due, crew days to approve — by
 * push and/or e-mail. Preferences live in SystemSetting under `mate_brief:<org>:<user>`.
 */
import { computeInvoiceMoney } from "../invoices/core.js";
import { prisma } from "../prisma.js";
import { registerJob, trackRun } from "../ops/jobs.js";
import { publishAppNotification } from "../notifications/publish.js";
import { sendCustomerEmail } from "../email/index.js";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { dayRange, localDay, localTime } from "./actions/time.js";

export type BriefPrefs = { enabled: boolean; hour: number; channels: Array<"push" | "email">; last_sent?: string | null };

const KEY = (org: string, user: string) => `mate_brief:${org}:${user}`;

export async function getBriefPrefs(org: string, user: string): Promise<BriefPrefs | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY(org, user) } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as BriefPrefs;
    return { enabled: Boolean(v.enabled), hour: Math.min(23, Math.max(0, Number(v.hour) || 7)), channels: (v.channels || ["push"]).filter((c) => c === "push" || c === "email"), last_sent: v.last_sent || null };
  } catch {
    return null;
  }
}

export async function setBriefPrefs(org: string, user: string, prefs: BriefPrefs): Promise<void> {
  const value = JSON.stringify(prefs);
  await prisma.systemSetting.upsert({ where: { key: KEY(org, user) }, create: { key: KEY(org, user), value }, update: { value } });
}

export type Brief = { title: string; lines: string[]; empty: boolean };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.round(n * 100) / 100);

/** The day's summary for one company (what a manager looks at first in the morning). */
export async function buildBrief(organizationId: string, timezone: string, now = new Date()): Promise<Brief> {
  const today = localDay(now, timezone);
  const { start, end } = dayRange(today, today, timezone);
  return withTenantTransaction(organizationId, async (tx) => {
    const [jobs, meetings, invoices, quotes, leads, days] = await Promise.all([
      tx.workOrder.findMany({ where: { status: { notIn: ["canceled", "completed"] }, scheduledStart: { gte: start, lt: end } }, select: { number: true, title: true, scheduledStart: true, allDay: true, crewId: true }, orderBy: { scheduledStart: "asc" }, take: 50 }),
      tx.meeting.findMany({ where: { status: { not: "canceled" }, scheduledStart: { gte: start, lt: end } }, select: { title: true, scheduledStart: true, allDay: true }, orderBy: { scheduledStart: "asc" }, take: 20 }),
      tx.quoteInvoice.findMany({ where: { status: { in: ["sent", "partially_paid"] }, dueDate: { lt: start } }, select: { amount: true, status: true, dueDate: true, receipts: { select: { amount: true } } }, take: 500 }),
      tx.quote.count({ where: { status: "sent", updatedAt: { lt: new Date(now.getTime() - 5 * 864e5) } } }),
      tx.lead.findMany({ where: { lostAt: null }, select: { metadata: true }, take: 2000, orderBy: { updatedAt: "desc" } }),
      tx.campoShift.count({ where: { reviewStatus: "pending", employeeId: { not: null } } }),
    ]);
    const overdue = invoices.map((i) => computeInvoiceMoney(i).balance).filter((b) => b > 0.004);
    const followups = leads.reduce((n, l) => {
      const m = l.metadata && typeof l.metadata === "object" && !Array.isArray(l.metadata) ? (l.metadata as Record<string, unknown>) : {};
      const list = Array.isArray(m.followups) ? (m.followups as Array<Record<string, unknown>>) : [];
      return n + list.filter((f) => f.status !== "done" && typeof f.due_date === "string" && String(f.due_date).slice(0, 10) <= today).length;
    }, 0);
    const lines: string[] = [];
    if (jobs.length) {
      const first = jobs[0]!;
      lines.push(`${jobs.length} job(s) hoje — primeiro: ${first.allDay ? "dia inteiro" : localTime(first.scheduledStart!, timezone)} ${first.number != null ? "#" + first.number + " " : ""}${first.title}`);
      const noCrew = jobs.filter((j) => !j.crewId).length;
      if (noCrew) lines.push(`${noCrew} job(s) de hoje sem equipe`);
    }
    if (meetings.length) lines.push(`${meetings.length} visita(s)/reunião(ões): ${meetings.slice(0, 3).map((m) => (m.allDay ? "" : localTime(m.scheduledStart, timezone) + " ") + m.title).join(", ")}`);
    if (overdue.length) lines.push(`${overdue.length} invoice(s) vencida(s) — ${money(overdue.reduce((s, b) => s + b, 0))} para cobrar`);
    if (quotes) lines.push(`${quotes} quote(s) enviado(s) há mais de 5 dias sem resposta`);
    if (followups) lines.push(`${followups} retorno(s) de lead para hoje`);
    if (days) lines.push(`${days} dia(s) da equipe para aprovar na folha`);
    return { title: lines.length ? "Seu dia no ObraMate" : "Dia tranquilo no ObraMate", lines: lines.length ? lines : ["Nada urgente: agenda livre e nada vencido."], empty: !lines.length };
  });
}

/** Sends due briefs: each enabled user whose local hour has come and who has not got today's. */
export async function sendDueBriefs(now = new Date()): Promise<{ sent: number }> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: "mate_brief:" } } });
  let sent = 0;
  const tzCache = new Map<string, string>();
  for (const row of rows) {
    const [, org, user] = row.key.split(":");
    if (!org || !user) continue;
    const prefs = await getBriefPrefs(org, user);
    if (!prefs?.enabled) continue;
    let tz = tzCache.get(org);
    if (!tz) {
      const o = await prisma.organization.findUnique({ where: { id: org }, select: { timezone: true } });
      tz = o?.timezone || "America/New_York";
      tzCache.set(org, tz);
    }
    const today = localDay(now, tz);
    const hour = Number(localTime(now, tz).slice(0, 2));
    if (prefs.last_sent === today || hour < prefs.hour) continue;
    const u = await prisma.user.findFirst({ where: { id: user, organizationId: org, status: "active" }, select: { email: true } });
    if (!u) continue;
    const brief = await buildBrief(org, tz, now);
    if (prefs.channels.includes("push")) {
      await publishAppNotification({
    fromMate: true,
        organizationId: org,
        type: "mate.brief",
        title: brief.title,
        body: brief.lines.join("\n").slice(0, 400),
        url: "/dashboard.html",
        tag: `mate-brief-${today}`,
        dedupeKey: `mate-brief-${user}-${today}`,
        userIds: [user],
      }).catch(() => undefined);
    }
    if (prefs.channels.includes("email") && u.email) {
      await sendCustomerEmail({ to: u.email, subject: brief.title + " · " + today, text: brief.lines.map((l) => "• " + l).join("\n") + "\n\nAbra o ObraMate e peça ao Mate: “o que eu preciso fazer hoje?”" }).catch(() => undefined);
    }
    await setBriefPrefs(org, user, { ...prefs, last_sent: today });
    sent += 1;
  }
  return { sent };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startDailyBriefJob(intervalMs = 10 * 60 * 1000): void {
  if (timer) return;
  registerJob({ name: "mate-daily-brief", label: "Mate AI: resumo do dia", intervalMs, run: () => sendDueBriefs() });
  const run = () => {
    trackRun("mate-daily-brief", () => sendDueBriefs()).catch((err) => console.error("[mate-daily-brief]", err));
  };
  timer = setInterval(run, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
