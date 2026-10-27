/**
 * Staff inbox + Web Push. One call writes the bell row and pings subscribed devices.
 * Field roles are skipped unless explicit userIds are passed (job, chat, payroll).
 */
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { notifyUsersPush, type PushPayload } from "../push/notify.js";

export const FIELD_ROLE_KEYS = new Set(["crew_lead", "installer", "subcontractor"]);

export function isOfficeUser(roleKey: string | null | undefined): boolean {
  return !roleKey || !FIELD_ROLE_KEYS.has(roleKey);
}

export type AppNotificationInput = {
  organizationId: string;
  type: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
  dedupeKey: string;
  /** When omitted, every active office user in the org. */
  userIds?: string[];
  excludeUserId?: string;
  /** Alerts the Mate sends himself (problem on a job, jobs without crew, daily brief) carry his face. */
  fromMate?: boolean;
};

/** Push icon for alerts the Mate sends (the fox in a circle). */
export const MATE_PUSH_ICON = "/assets/img/mascot/mate-icon-192.png?v=20261026-m1";

export function quoteLabel(quote: {
  quoteNumber?: string | null;
  number?: number | null;
  title?: string | null;
}): string {
  const num = quote.quoteNumber || (quote.number != null ? `#${quote.number}` : "Quote");
  const title = String(quote.title || "").trim();
  return title ? `${num} — ${title}` : num;
}

export function usd(amount: number): string {
  try {
    return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export async function publishAppNotification(input: AppNotificationInput): Promise<{ users: number; pushed: number }> {
  const organizationId = input.organizationId;
  const exclude = input.excludeUserId || "";
  let targets: string[] = [];
  try {
    targets = await withTenantTransaction(organizationId, async (tx) => {
      let ids = (input.userIds || []).filter(Boolean);
      if (!ids.length) {
        const users = await tx.user.findMany({
          where: { organizationId, status: "active" },
          select: { id: true, role: { select: { key: true } } },
        });
        ids = users.filter((u) => isOfficeUser(u.role?.key)).map((u) => u.id);
      }
      const unique = [...new Set(ids)].filter((id) => id && id !== exclude);
      if (!unique.length) return [];
      const existing = await tx.user.findMany({
        where: { organizationId, id: { in: unique }, status: "active" },
        select: { id: true },
      });
      const allowed = existing.map((u) => u.id);
      if (!allowed.length) return [];
      await tx.staffNotification.createMany({
        data: allowed.map((userId) => ({
          organizationId,
          userId,
          type: input.type,
          title: input.title.slice(0, 180),
          body: input.body.slice(0, 2000),
          url: input.url || null,
          dedupeKey: input.dedupeKey.slice(0, 180),
        })),
        skipDuplicates: true,
      });
      return allowed;
    });
  } catch (err) {
    console.error("[notify] inbox write failed", input.type, err);
    return { users: 0, pushed: 0 };
  }

  if (!targets.length) return { users: 0, pushed: 0 };

  const payload: PushPayload = {
    title: input.title,
    body: input.body.slice(0, 180),
    url: input.url || "/home.html",
    tag: input.tag || input.dedupeKey,
    ...(input.fromMate ? { icon: MATE_PUSH_ICON } : {}),
  };
  try {
    const pushed = await notifyUsersPush(organizationId, targets, payload, exclude ? { excludeUserId: exclude } : undefined);
    return { users: targets.length, pushed: pushed.sent };
  } catch (err) {
    console.error("[notify] push failed", input.type, err);
    return { users: targets.length, pushed: 0 };
  }
}
