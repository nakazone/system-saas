import webpush from "web-push";
import { prisma } from "../prisma.js";
import { ensureWebPushConfigured } from "./vapid.js";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send Web Push to all devices subscribed for an organization.
 * Safe to call fire-and-forget; invalid subscriptions are pruned.
 */
export async function notifyOrganizationPush(
  organizationId: string,
  payload: PushPayload,
  options?: { excludeUserId?: string },
): Promise<{ sent: number; pruned: number }> {
  try {
    await ensureWebPushConfigured();
  } catch (err) {
    console.error("[push] VAPID configure failed", err);
    return { sent: 0, pruned: 0 };
  }

  const where: { organizationId: string; userId?: { not: string } } = {
    organizationId,
  };
  if (options?.excludeUserId) {
    where.userId = { not: options.excludeUserId };
  }

  const rows = await prisma.pushSubscription.findMany({ where });
  if (rows.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/dashboard.html?page=leads",
    tag: payload.tag || "obramate",
  });

  let sent = 0;
  let pruned = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: "high" },
        );
        sent += 1;
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        // Gone / expired subscription
        if (status === 404 || status === 410) {
          try {
            await prisma.pushSubscription.delete({ where: { id: row.id } });
            pruned += 1;
          } catch {
            /* ignore */
          }
        } else {
          console.warn("[push] send failed", row.id, err);
        }
      }
    }),
  );

  return { sent, pruned };
}

/**
 * Send Web Push to specific users in an organization.
 */
export async function notifyUsersPush(
  organizationId: string,
  userIds: string[],
  payload: PushPayload,
  options?: { excludeUserId?: string },
): Promise<{ sent: number; pruned: number }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return { sent: 0, pruned: 0 };

  try {
    await ensureWebPushConfigured();
  } catch (err) {
    console.error("[push] VAPID configure failed", err);
    return { sent: 0, pruned: 0 };
  }

  const exclude = options?.excludeUserId;
  const targetIds = exclude ? unique.filter((id) => id !== exclude) : unique;
  if (!targetIds.length) return { sent: 0, pruned: 0 };

  const rows = await prisma.pushSubscription.findMany({
    where: { organizationId, userId: { in: targetIds } },
  });
  if (rows.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/jobs.html",
    tag: payload.tag || "obramate",
  });

  let sent = 0;
  let pruned = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: "high" },
        );
        sent += 1;
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          try {
            await prisma.pushSubscription.delete({ where: { id: row.id } });
            pruned += 1;
          } catch {
            /* ignore */
          }
        } else {
          console.warn("[push] send failed", row.id, err);
        }
      }
    }),
  );

  return { sent, pruned };
}

export function notifyJobTeamPush(
  organizationId: string,
  job: { id: string; title: string; number?: number | null },
  userIds: string[],
  options?: { excludeUserId?: string; event?: "created" | "updated" },
): void {
  const event = options?.event || "updated";
  const label = job.number != null ? `Job #${job.number}` : job.title || "Job";
  void notifyUsersPush(
    organizationId,
    userIds,
    {
      title: event === "created" ? "Novo job atribuído" : "Job atualizado",
      body: `${label}${job.title && job.number != null ? ` — ${job.title}` : ""}`,
      url: `/job-detail.html?id=${encodeURIComponent(job.id)}`,
      tag: `job-${job.id}`,
    },
    options,
  ).catch((err) => console.error("[push] job team notify", err));
}

export function notifyNewLeadPush(
  organizationId: string,
  lead: { id: string; name: string },
  options?: { excludeUserId?: string },
): void {
  void notifyOrganizationPush(
    organizationId,
    {
      title: "Novo lead",
      body: lead.name ? `${lead.name} acabou de chegar` : "Um novo lead chegou no pipeline",
      url: `/dashboard.html?page=leads`,
      tag: `lead-${lead.id}`,
    },
    options,
  ).catch((err) => console.error("[push] new lead notify", err));
}
