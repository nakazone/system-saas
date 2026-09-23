import { prisma } from "../prisma.js";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { transitionQuote } from "./transitions.js";
import { recordActivity } from "../activity/record.js";

/**
 * Mark sent/changes_requested quotes past validUntil as expired.
 * Intended to run on an interval from the server process.
 */
export async function expireOverdueQuotes(now = new Date()): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let count = 0;
  for (const org of orgs) {
    const n = await withTenantTransaction(org.id, async (tx) => {
      const due = await tx.quote.findMany({
        where: {
          status: { in: ["sent", "changes_requested"] },
          validUntil: { lt: now },
        },
      });
      let expired = 0;
      for (const quote of due) {
        const result = transitionQuote(quote.status, "expire");
        if (!result.ok) continue;
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: result.next },
        });
        await recordActivity(tx, {
          organizationId: org.id,
          entityType: "quote",
          entityId: quote.id,
          actorType: "system",
          action: "status_changed",
          changes: { status: { from: quote.status, to: result.next } },
        });
        expired++;
      }
      return expired;
    });
    count += n;
  }
  return count;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startQuoteExpiryJob(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;
  const run = () => {
    expireOverdueQuotes().catch((err) => {
      console.error("[quote-expiry]", err);
    });
  };
  run();
  timer = setInterval(run, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
