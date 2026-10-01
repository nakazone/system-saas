/**
 * Remind crews before a scheduled job starts, nudge at start time, and
 * optionally move office status to in_progress (never auto-advances Campo fieldStatus).
 */
import { prisma } from "../prisma.js";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { parseAutomationSettings } from "../automations/settings.js";
import { notifyUsersPush } from "../push/notify.js";
import { recordActivity } from "../activity/record.js";
import { teamUserIdsForJob } from "./team.js";
import { safeTimeZone } from "../time/zoned.js";

const jobInclude = {
  customer: { select: { name: true } },
  members: { select: { userId: true } },
  crew: { select: { members: { select: { userId: true } } } },
} as const;

function formatStartLocal(iso: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: safeTimeZone(timeZone),
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(iso);
  } catch {
    return iso.toISOString();
  }
}

function jobLabel(wo: { number: number | null; title: string }): string {
  if (wo.number != null) return `Job #${wo.number}`;
  return wo.title || "Job";
}

function jobBody(wo: {
  title: string;
  number: number | null;
  address: string | null;
  customer: { name: string } | null;
  scheduledStart: Date | null;
  organizationTimezone: string;
  prefix?: string;
}): string {
  const parts: string[] = [];
  if (wo.prefix) parts.push(wo.prefix);
  const who = wo.customer?.name || wo.title;
  if (who) parts.push(who);
  if (wo.address) parts.push(wo.address);
  if (wo.scheduledStart) {
    parts.push(formatStartLocal(wo.scheduledStart, wo.organizationTimezone));
  }
  return parts.filter(Boolean).join(" · ");
}

export type JobStartReminderStats = {
  reminders: number;
  nudges: number;
  autoStarts: number;
};

export async function processDueJobStartReminders(now = new Date()): Promise<JobStartReminderStats> {
  const orgs = await prisma.organization.findMany({
    select: { id: true, timezone: true, automationSettings: true },
  });
  const stats: JobStartReminderStats = { reminders: 0, nudges: 0, autoStarts: 0 };

  for (const org of orgs) {
    const settings = parseAutomationSettings(org.automationSettings);
    if (
      !settings.jobStartReminderEnabled &&
      !settings.jobStartAtTimeNudgeEnabled &&
      !settings.jobStartAutoOfficeStatus
    ) {
      continue;
    }

    const minutesBefore = settings.jobStartReminderMinutesBefore;
    const reminderWindowStart = new Date(now.getTime());
    const reminderWindowEnd = new Date(now.getTime() + minutesBefore * 60 * 1000);
    // At-time: from start up to 20 minutes late (catch missed ticks)
    const nudgeGraceMs = 20 * 60 * 1000;
    const nudgeWindowStart = new Date(now.getTime() - nudgeGraceMs);

    await withTenantTransaction(org.id, async (tx) => {
      // --- Pre-start reminders ---
      if (settings.jobStartReminderEnabled && minutesBefore > 0) {
        const due = await tx.workOrder.findMany({
          where: {
            status: "scheduled",
            scheduledStart: { gte: reminderWindowStart, lte: reminderWindowEnd },
            startReminderSentAt: null,
            fieldStatus: { in: ["scheduled", "en_route"] },
          },
          include: jobInclude,
          take: 100,
        });

        for (const wo of due) {
          if (!wo.scheduledStart) continue;
          // Only remind when we're inside the lead window (not at the exact start — nudge handles that)
          const msUntil = wo.scheduledStart.getTime() - now.getTime();
          if (msUntil < 2 * 60 * 1000) continue;

          const userIds = teamUserIdsForJob(wo);
          if (userIds.length) {
            await notifyUsersPush(org.id, userIds, {
              title: `${jobLabel(wo)} em breve`,
              body: jobBody({
                ...wo,
                organizationTimezone: org.timezone,
                prefix: `Começa em ~${Math.max(1, Math.round(msUntil / 60000))} min`,
              }),
              url: `/campo/ticket.html?id=${encodeURIComponent(wo.id)}`,
              tag: `job-start-reminder-${wo.id}`,
            });
          }

          await tx.workOrder.update({
            where: { id: wo.id },
            data: { startReminderSentAt: now },
          });
          await recordActivity(tx, {
            organizationId: org.id,
            entityType: "work_order",
            entityId: wo.id,
            actorType: "system",
            action: "work_order.start_reminder_sent",
            changes: {
              scheduledStart: { from: null, to: wo.scheduledStart.toISOString() },
            },
          });
          stats.reminders += 1;
        }
      }

      // --- At-time nudge + optional office auto-start ---
      if (settings.jobStartAtTimeNudgeEnabled || settings.jobStartAutoOfficeStatus) {
        const dueNow = await tx.workOrder.findMany({
          where: {
            status: "scheduled",
            scheduledStart: { gte: nudgeWindowStart, lte: now },
            startNudgeSentAt: null,
          },
          include: jobInclude,
          take: 100,
        });

        for (const wo of dueNow) {
          if (!wo.scheduledStart) continue;

          let autoStarted = false;
          if (settings.jobStartAutoOfficeStatus && wo.status === "scheduled") {
            await tx.workOrder.update({
              where: { id: wo.id },
              data: {
                status: "in_progress",
                startNudgeSentAt: now,
                // Keep fieldStatus for Campo — crew still taps "Estou a caminho"
              },
            });
            await recordActivity(tx, {
              organizationId: org.id,
              entityType: "work_order",
              entityId: wo.id,
              actorType: "system",
              action: "work_order.auto_started",
              changes: { status: { from: "scheduled", to: "in_progress" } },
            });
            autoStarted = true;
            stats.autoStarts += 1;
          } else {
            await tx.workOrder.update({
              where: { id: wo.id },
              data: { startNudgeSentAt: now },
            });
          }

          if (settings.jobStartAtTimeNudgeEnabled) {
            const userIds = teamUserIdsForJob(wo);
            if (userIds.length) {
              await notifyUsersPush(org.id, userIds, {
                title: autoStarted ? `${jobLabel(wo)} — hora de começar` : `${jobLabel(wo)} começa agora`,
                body: jobBody({
                  ...wo,
                  organizationTimezone: org.timezone,
                  prefix: "Abra o ticket e confirme no Campo",
                }),
                url: `/campo/ticket.html?id=${encodeURIComponent(wo.id)}`,
                tag: `job-start-nudge-${wo.id}`,
              });
            }
            await recordActivity(tx, {
              organizationId: org.id,
              entityType: "work_order",
              entityId: wo.id,
              actorType: "system",
              action: "work_order.start_nudge_sent",
              changes: {
                scheduledStart: { from: null, to: wo.scheduledStart.toISOString() },
              },
            });
            stats.nudges += 1;
          }
        }
      }
    });
  }

  return stats;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Poll every 2 minutes for upcoming / due job starts. */
export function startJobStartReminderJob(intervalMs = 2 * 60 * 1000): void {
  if (timer) return;
  const run = () => {
    processDueJobStartReminders().catch((err) => {
      console.error("[job-start-reminder]", err);
    });
  };
  run();
  timer = setInterval(run, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
