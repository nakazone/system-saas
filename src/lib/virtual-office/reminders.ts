/**
 * Office reminders: what a user asked an employee to remember ("Marina, me lembra sexta de ligar
 * pro Ortiz"). In the office the employee brings it up; outside it, the bell and push nudge the
 * user at the due time and again, in working hours, until it is done — how often depends on the
 * employee's follow-up style.
 */
import { prisma } from "../prisma.js";
import { registerJob, trackRun } from "../ops/jobs.js";
import { publishAppNotification } from "../notifications/publish.js";
import { withTenantTransaction, type TenantPrisma } from "../tenant/prisma-tenant.js";
import { safeTimeZone, zonedParts } from "../time/zoned.js";

export const FOLLOW_UP_STYLES = ["light", "normal", "firm"] as const;
export type FollowUpStyle = (typeof FOLLOW_UP_STYLES)[number];

/** After the first nudge at the due time: how long to wait before asking again, and how many times in all. */
export const FOLLOW_UP_CADENCE: Record<FollowUpStyle, { repeatMs: number; max: number }> = {
  light: { repeatMs: 24 * 3600_000, max: 2 },
  normal: { repeatMs: 3 * 3600_000, max: 4 },
  firm: { repeatMs: 3600_000, max: 8 },
};

export function followUpStyle(value: unknown): FollowUpStyle {
  return FOLLOW_UP_STYLES.includes(value as FollowUpStyle) ? (value as FollowUpStyle) : "normal";
}

export type ReminderState = { status: string; dueAt: Date; nudgeCount: number; lastNudgedAt: Date | null };
export type AgentHours = { followUpStyle: string; workStartHour: number; workEndHour: number };

/** Whether to nudge now: always at the due time; repeats only in the employee's working hours. */
export function shouldNudge(reminder: ReminderState, agent: AgentHours, now: Date, timezone: string): boolean {
  if (reminder.status !== "open" || reminder.dueAt.getTime() > now.getTime()) return false;
  if (reminder.nudgeCount === 0) return true;
  const cadence = FOLLOW_UP_CADENCE[followUpStyle(agent.followUpStyle)];
  if (reminder.nudgeCount >= cadence.max) return false;
  if (reminder.lastNudgedAt && now.getTime() - reminder.lastNudgedAt.getTime() < cadence.repeatMs) return false;
  const hour = zonedParts(now, safeTimeZone(timezone)).hour;
  const start = Math.max(0, Math.min(23, agent.workStartHour));
  const end = Math.max(start + 1, Math.min(24, agent.workEndHour));
  return hour >= start && hour < end;
}

/** What the employee says when nudging (first time, then insisting). */
export function nudgeText(agentName: string, text: string, nudgeCount: number, userName?: string | null): { title: string; body: string } {
  const who = userName ? `${userName.split(/\s+/)[0]}, ` : "";
  if (nudgeCount === 0) return { title: `${agentName}: lembrete`, body: `${who}você pediu para eu lembrar: ${text}.` };
  if (nudgeCount === 1) return { title: `${agentName}: ainda está pendente`, body: `${who}passando de novo: ${text}. Já deu para fazer?` };
  return { title: `${agentName}: não esqueci`, body: `${who}continuo com isso na minha mesa: ${text}. Me avisa quando fizer que eu tiro daqui.` };
}

export type ReminderOut = {
  id: string;
  agent_key: string;
  text: string;
  due_at: string;
  status: string;
  nudges: number;
  overdue: boolean;
  completed_at: string | null;
};

export function reminderOut(r: { id: string; agentKey: string; text: string; dueAt: Date; status: string; nudgeCount: number; completedAt: Date | null }, now = new Date()): ReminderOut {
  return {
    id: r.id,
    agent_key: r.agentKey,
    text: r.text,
    due_at: r.dueAt.toISOString(),
    status: r.status,
    nudges: r.nudgeCount,
    overdue: r.status === "open" && r.dueAt.getTime() <= now.getTime(),
    completed_at: r.completedAt ? r.completedAt.toISOString() : null,
  };
}

/** Open reminders (due ones first) and the last few done, for one user and optionally one employee. */
export async function listReminders(tx: TenantPrisma, organizationId: string, userId: string, agentKey?: string | null) {
  const where = { organizationId, userId, ...(agentKey ? { agentKey } : {}) };
  const [open, done] = await Promise.all([
    tx.officeReminder.findMany({ where: { ...where, status: "open" }, orderBy: { dueAt: "asc" }, take: 50 }),
    tx.officeReminder.findMany({ where: { ...where, status: "done" }, orderBy: { completedAt: "desc" }, take: 8 }),
  ]);
  return [...open, ...done];
}

export type DueStats = { nudged: number };

/** Sends due nudges for every company. */
export async function processDueOfficeReminders(now = new Date()): Promise<DueStats> {
  const orgs = await prisma.organization.findMany({ select: { id: true, timezone: true } });
  let nudged = 0;
  for (const org of orgs) {
    const timezone = safeTimeZone(org.timezone);
    const due = await withTenantTransaction(org.id, async (tx) => {
      const rows = await tx.officeReminder.findMany({
        where: { organizationId: org.id, status: "open", dueAt: { lte: now } },
        select: { id: true, userId: true, agentKey: true, text: true, dueAt: true, status: true, nudgeCount: true, lastNudgedAt: true, user: { select: { name: true } } },
        take: 200,
      });
      if (!rows.length) return [];
      const agents = await tx.virtualAgent.findMany({
        where: { organizationId: org.id, key: { in: [...new Set(rows.map((r) => r.agentKey))] } },
        select: { key: true, name: true, followUpStyle: true, workStartHour: true, workEndHour: true },
      });
      const byKey = new Map(agents.map((a) => [a.key, a]));
      return rows
        .map((r) => ({ r, agent: byKey.get(r.agentKey) || { key: r.agentKey, name: "Mate", followUpStyle: "normal", workStartHour: 8, workEndHour: 18 } }))
        .filter(({ r, agent }) => shouldNudge(r, agent, now, timezone));
    });
    for (const { r, agent } of due) {
      const msg = nudgeText(agent.name, r.text, r.nudgeCount, r.user?.name);
      await publishAppNotification({
        organizationId: org.id,
        type: "office.reminder",
        title: msg.title,
        body: msg.body,
        url: `/escritorio-ia.html?agent=${encodeURIComponent(r.agentKey)}`,
        tag: `office-reminder-${r.id}`,
        dedupeKey: `office-reminder:${r.id}:${r.nudgeCount + 1}`,
        userIds: [r.userId],
      });
      await withTenantTransaction(org.id, (tx) =>
        tx.officeReminder.update({ where: { id: r.id }, data: { nudgeCount: { increment: 1 }, lastNudgedAt: now } }),
      );
      nudged += 1;
    }
  }
  return { nudged };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startOfficeReminderJob(intervalMs = 60_000): void {
  if (timer) return;
  registerJob({ name: "office-reminders", label: "Lembretes do Escritório IA", intervalMs, run: processDueOfficeReminders });
  const run = () => {
    trackRun("office-reminders", processDueOfficeReminders).catch((err) => console.error("[office-reminders]", err));
  };
  timer = setInterval(run, intervalMs);
  setTimeout(run, 15_000);
}
