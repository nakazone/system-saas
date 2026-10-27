/**
 * Mate alerts that reach the phone (bell + Web Push through publishAppNotification).
 * Each alert links to a place where the next step is one tap: the job page, or the Mate
 * opened with the question already asked (`?mate_ask=`), so the answer comes with its buttons.
 */
import { registerJob, trackRun } from "../ops/jobs.js";
import { prisma } from "../prisma.js";
import { publishAppNotification } from "../notifications/publish.js";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { safeTimeZone, startOfZonedDay, zonedDateKey, zonedParts } from "../time/zoned.js";

/** Local hour (company time zone) from which the "jobs tomorrow without a crew" alert goes out. */
export const NO_CREW_ALERT_HOUR = 15;

function jobName(wo: { number: number | null; title: string }): string {
  return wo.number != null ? `Job #${wo.number}` : wo.title || "Job";
}

export function mateAskUrl(page: string, question: string): string {
  return `/${page}?mate_ask=${encodeURIComponent(question)}`;
}

/** Field crew reported a problem: the office hears it right away. */
export async function alertFieldProblem(input: {
  organizationId: string;
  reporterId: string;
  reporterName?: string | null;
  job: { id: string; number: number | null; title: string; customerName?: string | null };
  note: string;
}): Promise<void> {
  const who = input.reporterName?.trim() || "A equipe";
  const where = [jobName(input.job), input.job.customerName].filter(Boolean).join(" · ");
  await publishAppNotification({
    fromMate: true,
    organizationId: input.organizationId,
    type: "job.problem",
    title: `Problema na obra: ${where}`.slice(0, 180),
    body: `${who}: ${input.note.trim()}`.slice(0, 600),
    url: `/job-detail.html?id=${encodeURIComponent(input.job.id)}#campo`,
    tag: `job-problem-${input.job.id}`,
    dedupeKey: `job-problem-${input.job.id}-${Date.now()}`,
    excludeUserId: input.reporterId,
  });
}

export type NoCrewStats = { checked: number; sent: number };

/**
 * Once a day after 15h (company time): jobs scheduled for tomorrow with nobody assigned.
 * One alert per company per day, listing how many; the link opens the Mate with "Pôr equipe" per job.
 */
export async function processNoCrewTomorrow(now = new Date()): Promise<NoCrewStats> {
  const orgs = await prisma.organization.findMany({
    where: { status: { in: ["active", "trial", "past_due"] } },
    select: { id: true, timezone: true },
  });
  const stats: NoCrewStats = { checked: 0, sent: 0 };
  for (const org of orgs) {
    const tz = safeTimeZone(org.timezone);
    if (zonedParts(now, tz).hour < NO_CREW_ALERT_HOUR) continue;
    stats.checked += 1;
    const tomorrow = startOfZonedDay(now, tz, 1);
    const dayKey = zonedDateKey(tomorrow, tz);
    const dedupeKey = `jobs-nocrew-${dayKey}`;
    try {
      const found = await withTenantTransaction(org.id, async (tx) => {
        const already = await tx.staffNotification.findFirst({ where: { organizationId: org.id, dedupeKey }, select: { id: true } });
        if (already) return null;
        return tx.workOrder.findMany({
          where: {
            organizationId: org.id,
            status: { notIn: ["canceled", "completed"] },
            crewId: null,
            assignedUserId: null,
            members: { none: {} },
            scheduledStart: { gte: tomorrow, lt: startOfZonedDay(now, tz, 2) },
          },
          select: { id: true, number: true, title: true, customer: { select: { name: true } } },
          orderBy: { scheduledStart: "asc" },
          take: 20,
        });
      });
      if (!found || !found.length) continue;
      const names = found.slice(0, 3).map((j) => [jobName(j), j.customer?.name].filter(Boolean).join(" · "));
      const more = found.length > 3 ? ` e mais ${found.length - 3}` : "";
      await publishAppNotification({
    fromMate: true,
        organizationId: org.id,
        type: "jobs.nocrew",
        title: found.length === 1 ? "1 job amanhã sem equipe" : `${found.length} jobs amanhã sem equipe`,
        body: names.join("; ") + more + ". Toque para escolher a equipe.",
        url: mateAskUrl("jobs.html", "Quais jobs de amanhã estão sem equipe?"),
        tag: dedupeKey,
        dedupeKey,
      });
      stats.sent += 1;
    } catch (error) {
      console.error("[mate-alerts] no-crew check failed", org.id, error);
    }
  }
  return stats;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startMateAlertsJob(intervalMs = 30 * 60 * 1000): void {
  if (timer) return;
  registerJob({ name: "mate-alerts-nocrew", label: "Aviso: jobs de amanhã sem equipe", intervalMs, run: processNoCrewTomorrow });
  const run = () => {
    trackRun("mate-alerts-nocrew", () => processNoCrewTomorrow()).catch((error) => console.error("[mate-alerts]", error));
  };
  timer = setInterval(run, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  setTimeout(run, 60_000).unref?.();
}
