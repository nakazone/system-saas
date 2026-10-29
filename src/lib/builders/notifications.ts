/**
 * ObraBuilder notifications: what the subcontractor did with the builder's work
 * (accepted with a date, declined, rescheduled, on site, photos, report, completed).
 *
 * A watcher sweeps each active company link every couple of minutes, compares jobs and
 * requests with the last state it saw (BuilderJobWatch) and records a notification for each
 * change, plus a Web Push to the builder team's phones. Comparing state (instead of hooking
 * every CRM route that can move a job) catches changes made anywhere in ObraMate.
 */
import webpush from "web-push";
import { prisma } from "../prisma.js";
import { ensureWebPushConfigured, getVapidKeys } from "../push/vapid.js";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { registerJob, trackRun } from "../ops/jobs.js";
import { safeTimeZone } from "../time/zoned.js";

export type NotificationKind = "accepted" | "declined" | "scheduled" | "rescheduled" | "started" | "photos" | "report" | "completed";

type Draft = {
  kind: NotificationKind;
  title: string;
  body?: string;
  url?: string;
  companyName: string;
  organizationId: string;
  workOrderId?: string | null;
  requestId?: string | null;
};

const DONE = new Set(["completed", "needs_invoicing"]);

function whenText(d: Date | null | undefined, allDay: boolean, tz: string): string {
  if (!d) return "";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
  if (allDay) return day;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day}, ${time}`;
}

function jobLabel(j: { title: string; address: string | null; number: number | null }): string {
  const t = (j.title || "Job").trim();
  return j.number ? `${t} (#${j.number})` : t;
}

/** Pure diff: what changed between the last state seen and now. Exported for tests. */
export function diffJob(
  prev: { status: string | null; scheduledStart: Date | null; photos: number; reports: number } | null,
  now: { status: string; scheduledStart: Date | null; photos: number; reports: number },
): Array<"scheduled" | "rescheduled" | "started" | "photos" | "report" | "completed"> {
  if (!prev) return [];
  const out: Array<"scheduled" | "rescheduled" | "started" | "photos" | "report" | "completed"> = [];
  const was = prev.status || "";
  if (DONE.has(now.status) && !DONE.has(was)) out.push("completed");
  else if (now.status === "in_progress" && was !== "in_progress" && !DONE.has(was)) out.push("started");
  const a = prev.scheduledStart ? prev.scheduledStart.getTime() : null;
  const b = now.scheduledStart ? now.scheduledStart.getTime() : null;
  if (b != null && a == null && !DONE.has(now.status)) out.push("scheduled");
  else if (b != null && a != null && a !== b && !DONE.has(now.status)) out.push("rescheduled");
  if (now.photos > prev.photos) out.push("photos");
  if (now.reports > prev.reports) out.push("report");
  return out;
}

async function record(accountId: string, drafts: Draft[]): Promise<void> {
  if (!drafts.length) return;
  await prisma.builderNotification.createMany({
    data: drafts.map((d) => ({
      builderAccountId: accountId,
      kind: d.kind,
      title: d.title.slice(0, 200),
      body: d.body ? d.body.slice(0, 500) : null,
      url: d.url || null,
      companyName: d.companyName,
      organizationId: d.organizationId,
      workOrderId: d.workOrderId || null,
      requestId: d.requestId || null,
    })),
  });
  // one push per change, newest last; a burst collapses into a summary
  const payloads = drafts.length > 3
    ? [{ title: `${drafts.length} updates from ${drafts[0]!.companyName}`, body: drafts.slice(0, 3).map((d) => d.title).join(" · "), url: "#notifications", tag: "ob-updates" }]
    : drafts.map((d) => ({ title: d.title, body: d.body || d.companyName, url: d.url || "#notifications", tag: `ob-${d.kind}-${d.workOrderId || d.requestId || ""}` }));
  for (const p of payloads) await pushToAccount(accountId, p).catch(() => undefined);
}

export async function pushToAccount(accountId: string, payload: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  const rows = await prisma.builderPushSubscription.findMany({ where: { builderAccountId: accountId } });
  if (!rows.length) return 0;
  try {
    await ensureWebPushConfigured();
  } catch {
    return 0;
  }
  const body = JSON.stringify({ title: payload.title, body: payload.body, url: `/partner-portal.html${payload.url.startsWith("#") ? payload.url : ""}`, tag: payload.tag || "obrabuilder", icon: "/assets/obrabuilder/icon-192.png" });
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, { TTL: 60 * 60 * 12, urgency: "high" });
      sent += 1;
    } catch (err: unknown) {
      const status = err && typeof err === "object" && "statusCode" in err ? Number((err as { statusCode?: number }).statusCode) : 0;
      if (status === 404 || status === 410) await prisma.builderPushSubscription.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  }));
  return sent;
}

/** One sweep of one builder account. Returns how many notifications it recorded. */
export async function sweepAccount(accountId: string): Promise<number> {
  const links = await prisma.builderLink.findMany({
    where: { builderAccountId: accountId, status: "active", organizationId: { not: null }, tenantBuilderId: { not: null } },
    select: { organizationId: true, tenantBuilderId: true, companyName: true },
  });
  let total = 0;
  const since = new Date(Date.now() - 60 * 86400e3);
  for (const link of links) {
    const orgId = link.organizationId!;
    const builderId = link.tenantBuilderId!;
    const snap = await withTenantTransaction(orgId, async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { timezone: true, name: true } });
      const jobs = await tx.workOrder.findMany({
        where: { organizationId: orgId, builderId, status: { not: "canceled" }, updatedAt: { gte: since } },
        select: { id: true, number: true, title: true, address: true, status: true, scheduledStart: true, allDay: true },
        take: 300,
      });
      const ids = jobs.map((j) => j.id);
      const [media, reports, requests] = await Promise.all([
        ids.length ? tx.jobMedia.groupBy({ by: ["workOrderId"], where: { organizationId: orgId, workOrderId: { in: ids }, sharedWithPartners: true, deletedAt: null }, _count: { _all: true } }) : Promise.resolve([]),
        ids.length ? tx.jobReport.groupBy({ by: ["workOrderId"], where: { organizationId: orgId, workOrderId: { in: ids }, sharedWithPartners: true, status: "published" }, _count: { _all: true } }) : Promise.resolve([]),
        tx.partnerJobRequest.findMany({
          where: { organizationId: orgId, partnerUser: { builderId }, createdAt: { gte: since } },
          select: { id: true, title: true, status: true, workOrderId: true, reviewNote: true },
          take: 300,
        }),
      ]);
      return { tz: safeTimeZone(org?.timezone), company: link.companyName || org?.name || "The company", jobs, media, reports, requests };
    });
    const mediaBy = new Map(snap.media.map((m) => [m.workOrderId as string, m._count._all]));
    const reportBy = new Map(snap.reports.map((r) => [r.workOrderId as string, r._count._all]));
    const keys = [...snap.jobs.map((j) => `job:${j.id}`), ...snap.requests.map((r) => `req:${r.id}`)];
    const watches = keys.length ? await prisma.builderJobWatch.findMany({ where: { builderAccountId: accountId, key: { in: keys } } }) : [];
    const watchBy = new Map(watches.map((w) => [w.key, w]));
    const drafts: Draft[] = [];
    const jobById = new Map(snap.jobs.map((j) => [j.id, j]));
    const justAccepted = new Set<string>();
    // requests: accepted (with the date) / declined
    for (const r of snap.requests) {
      const w = watchBy.get(`req:${r.id}`);
      if (w && w.status === "pending" && r.status !== "pending") {
        if (r.status === "accepted") {
          const job = r.workOrderId ? jobById.get(r.workOrderId) : null;
          const when = job && job.scheduledStart ? whenText(job.scheduledStart, job.allDay, snap.tz) : "";
          if (job) justAccepted.add(job.id);
          drafts.push({
            kind: "accepted", companyName: snap.company, organizationId: orgId, requestId: r.id, workOrderId: r.workOrderId,
            title: when ? `${snap.company} accepted · ${when}` : `${snap.company} accepted your work order`,
            body: [r.title, r.reviewNote || ""].filter(Boolean).join(" — "),
            url: r.workOrderId ? `#jobs/${r.workOrderId}` : "#send",
          });
        } else if (r.status === "declined") {
          drafts.push({ kind: "declined", companyName: snap.company, organizationId: orgId, requestId: r.id, title: `${snap.company} declined a work order`, body: [r.title, r.reviewNote || ""].filter(Boolean).join(" — "), url: "#send" });
        }
      }
    }
    // jobs: dates, on site, photos, reports, completed
    for (const j of snap.jobs) {
      const w = watchBy.get(`job:${j.id}`);
      const now = { status: j.status, scheduledStart: j.scheduledStart, photos: mediaBy.get(j.id) || 0, reports: reportBy.get(j.id) || 0 };
      const changes = diffJob(w ? { status: w.status, scheduledStart: w.scheduledStart, photos: w.photos, reports: w.reports } : null, now);
      const label = jobLabel(j);
      const url = `#jobs/${j.id}`;
      for (const c of changes) {
        if ((c === "scheduled") && justAccepted.has(j.id)) continue;
        if (c === "scheduled") drafts.push({ kind: c, companyName: snap.company, organizationId: orgId, workOrderId: j.id, url, title: `Scheduled · ${whenText(j.scheduledStart, j.allDay, snap.tz)}`, body: `${label} — ${snap.company}` });
        if (c === "rescheduled") drafts.push({ kind: c, companyName: snap.company, organizationId: orgId, workOrderId: j.id, url, title: `New date · ${whenText(j.scheduledStart, j.allDay, snap.tz)}`, body: `${label} — ${snap.company} changed the date` });
        if (c === "started") drafts.push({ kind: c, companyName: snap.company, organizationId: orgId, workOrderId: j.id, url, title: `Crew on site · ${label}`, body: `${snap.company} started the job${j.address ? ` at ${j.address}` : ""}` });
        if (c === "photos") { const n = now.photos - (w ? w.photos : 0); drafts.push({ kind: c, companyName: snap.company, organizationId: orgId, workOrderId: j.id, url, title: `${n} new photo${n === 1 ? "" : "s"} · ${label}`, body: `${snap.company} shared photos from the job` }); }
        if (c === "report") drafts.push({ kind: c, companyName: snap.company, organizationId: orgId, workOrderId: j.id, url, title: `New report · ${label}`, body: `${snap.company} shared a job report` });
        if (c === "completed") drafts.push({ kind: c, companyName: snap.company, organizationId: orgId, workOrderId: j.id, url, title: `Job completed · ${label}`, body: `${snap.company} finished the job${j.address ? ` at ${j.address}` : ""}` });
      }
    }
    await record(accountId, drafts);
    total += drafts.length;
    // remember what we saw
    const upserts = [
      ...snap.jobs.map((j) => ({ key: `job:${j.id}`, status: j.status, scheduledStart: j.scheduledStart, photos: mediaBy.get(j.id) || 0, reports: reportBy.get(j.id) || 0 })),
      ...snap.requests.map((r) => ({ key: `req:${r.id}`, status: r.status, scheduledStart: null, photos: 0, reports: 0 })),
    ];
    for (const u of upserts) {
      const w = watchBy.get(u.key);
      if (w && w.status === u.status && (w.scheduledStart?.getTime() ?? null) === (u.scheduledStart?.getTime() ?? null) && w.photos === u.photos && w.reports === u.reports) continue;
      await prisma.builderJobWatch.upsert({
        where: { builderAccountId_key: { builderAccountId: accountId, key: u.key } },
        create: { builderAccountId: accountId, ...u },
        update: { status: u.status, scheduledStart: u.scheduledStart, photos: u.photos, reports: u.reports },
      });
    }
  }
  return total;
}

/** Records the request right away as "pending" so its acceptance is noticed even on the next sweep. */
export async function watchRequest(accountId: string, requestId: string): Promise<void> {
  await prisma.builderJobWatch.upsert({
    where: { builderAccountId_key: { builderAccountId: accountId, key: `req:${requestId}` } },
    create: { builderAccountId: accountId, key: `req:${requestId}`, status: "pending" },
    update: {},
  }).catch(() => undefined);
}

export async function sweepAll(): Promise<{ accounts: number; notifications: number }> {
  const accounts = await prisma.builderLink.findMany({ where: { status: "active", organizationId: { not: null } }, select: { builderAccountId: true }, distinct: ["builderAccountId"] });
  let n = 0;
  for (const a of accounts) {
    try { n += await sweepAccount(a.builderAccountId); } catch (e) { console.error("[builder-watch]", a.builderAccountId, e); }
  }
  return { accounts: accounts.length, notifications: n };
}

export async function listNotifications(member: { id: string; builderAccountId: string; notificationsSeenAt: Date | null }, limit = 40) {
  const rows = await prisma.builderNotification.findMany({ where: { builderAccountId: member.builderAccountId }, orderBy: { createdAt: "desc" }, take: Math.min(100, limit) });
  const seen = member.notificationsSeenAt ? member.notificationsSeenAt.getTime() : 0;
  return {
    unread: rows.filter((r) => r.createdAt.getTime() > seen).length,
    data: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, url: r.url, company: r.companyName, at: r.createdAt, unread: r.createdAt.getTime() > seen })),
  };
}

export async function markSeen(memberId: string): Promise<void> {
  await prisma.builderMember.update({ where: { id: memberId }, data: { notificationsSeenAt: new Date() } });
}

export async function savePushSubscription(member: { id: string; builderAccountId: string }, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | undefined): Promise<void> {
  await prisma.builderPushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { builderAccountId: member.builderAccountId, memberId: member.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) || null },
    update: { builderAccountId: member.builderAccountId, memberId: member.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) || null },
  });
}

export async function removePushSubscription(member: { builderAccountId: string }, endpoint: string): Promise<void> {
  await prisma.builderPushSubscription.deleteMany({ where: { builderAccountId: member.builderAccountId, endpoint } });
}

export async function vapidPublicKey(): Promise<string | null> {
  try { return (await getVapidKeys()).publicKey; } catch { return null; }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startBuilderWatchJob(intervalMs = 2 * 60 * 1000): void {
  if (timer) return;
  registerJob({ name: "builder-watch", label: "ObraBuilder: avisos ao builder (aceite, datas, fotos)", intervalMs, run: sweepAll });
  const run = () => {
    trackRun("builder-watch", () => sweepAll()).catch((error) => console.error("[builder-watch]", error));
  };
  timer = setInterval(run, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  setTimeout(run, 30_000).unref?.();
}
