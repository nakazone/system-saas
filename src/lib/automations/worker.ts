import { prisma } from "../prisma.js";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";
import { email } from "../email/index.js";
import { automationClock } from "./settings.js";

export type ProcessResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

/**
 * Process due scheduled messages org-by-org under tenant RLS.
 * Never processes org A rows inside org B's transaction.
 */
export async function processDueScheduledMessages(
  now: Date = automationClock.now(),
): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, sent: 0, skipped: 0, failed: 0 };
  const orgs = await prisma.organization.findMany({ select: { id: true } });

  for (const org of orgs) {
    const orgResult = await withTenantTransaction(org.id, async (tx) => {
      const due = await tx.scheduledMessage.findMany({
        where: {
          status: "pending",
          channel: "email",
          scheduledFor: { lte: now },
        },
        include: { customer: true },
        orderBy: { scheduledFor: "asc" },
        take: 50,
      });

      let sent = 0;
      let skipped = 0;
      let failed = 0;

      for (const msg of due) {
        await tx.scheduledMessage.update({
          where: { id: msg.id },
          data: { status: "processing", attempts: { increment: 1 } },
        });

        if (msg.customer?.transactionalOptOut) {
          await tx.scheduledMessage.update({
            where: { id: msg.id },
            data: { status: "skipped" },
          });
          await tx.communicationLog.create({
            data: {
              organizationId: org.id,
              channel: msg.channel,
              triggerKey: msg.triggerKey,
              entityType: msg.entityType,
              entityId: msg.entityId,
              customerId: msg.customerId,
              toAddress: msg.toAddress,
              subject: msg.subject,
              body: msg.body,
              status: "skipped",
              skipReason: "transactional_opt_out",
              scheduledMessageId: msg.id,
            },
          });
          skipped += 1;
          continue;
        }

        try {
          await email.send({
            to: msg.toAddress,
            subject: msg.subject,
            text: msg.body,
          });
          await tx.scheduledMessage.update({
            where: { id: msg.id },
            data: { status: "sent", sentAt: now, lastError: null },
          });
          await tx.communicationLog.create({
            data: {
              organizationId: org.id,
              channel: msg.channel,
              triggerKey: msg.triggerKey,
              entityType: msg.entityType,
              entityId: msg.entityId,
              customerId: msg.customerId,
              toAddress: msg.toAddress,
              subject: msg.subject,
              body: msg.body,
              status: "sent",
              scheduledMessageId: msg.id,
            },
          });
          sent += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : "send failed";
          await tx.scheduledMessage.update({
            where: { id: msg.id },
            data: { status: "failed", lastError: message },
          });
          await tx.communicationLog.create({
            data: {
              organizationId: org.id,
              channel: msg.channel,
              triggerKey: msg.triggerKey,
              entityType: msg.entityType,
              entityId: msg.entityId,
              customerId: msg.customerId,
              toAddress: msg.toAddress,
              subject: msg.subject,
              body: msg.body,
              status: "failed",
              skipReason: message,
              scheduledMessageId: msg.id,
            },
          });
          failed += 1;
        }
      }

      return { processed: due.length, sent, skipped, failed };
    });

    result.processed += orgResult.processed;
    result.sent += orgResult.sent;
    result.skipped += orgResult.skipped;
    result.failed += orgResult.failed;
  }

  return result;
}

/** Test helper: is message visible under a given tenant transaction? */
export async function messageVisibleUnderTenant(
  messageId: string,
  organizationId: string,
): Promise<boolean> {
  return withTenantTransaction(organizationId, async (tx) => {
    const msg = await tx.scheduledMessage.findFirst({ where: { id: messageId } });
    return Boolean(msg);
  });
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAutomationWorker(intervalMs = 60 * 1000): void {
  if (timer) return;
  const run = () => {
    processDueScheduledMessages().catch((err) => {
      console.error("[automations]", err);
    });
  };
  run();
  timer = setInterval(run, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
