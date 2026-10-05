import { prisma } from "../prisma.js";
import { withTenantTransaction, type TenantPrisma } from "../tenant/prisma-tenant.js";
import { email } from "../email/index.js";
import { automationClock, parseAutomationSettings } from "./settings.js";
import {
  moveLeadToSystemStage,
  resolveLeadIdForQuote,
} from "../pipeline/move.js";
import { findStageForSlug, ensureStageForSlug } from "../leads/stage.js";
import { canonicalStageSlug } from "../dashboard/stages.js";

export type ProcessResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  stagesMoved: number;
};

function payloadLeadId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = (payload as Record<string, unknown>).leadId;
  if (typeof id !== "string") return null;
  const s = id.trim();
  return s || null;
}

/** Move quote_sent → follow_up_1 when the follow-up timer fires (email path). */
export async function maybeMoveLeadAfterQuoteFollowUp(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    entityType: string;
    entityId: string;
    payload: unknown;
    settings: ReturnType<typeof parseAutomationSettings>;
  },
): Promise<boolean> {
  if (!params.settings.quoteSentAutoFollowUpStageEnabled) return false;
  if (params.entityType !== "quote") return false;

  let leadId = payloadLeadId(params.payload);
  if (!leadId) {
    leadId = await resolveLeadIdForQuote(tx, params.entityId);
  }
  if (!leadId) return false;

  const lead = await tx.lead.findFirst({
    where: { id: leadId },
    include: { pipelineStage: true },
  });
  if (!lead) return false;

  const current =
    canonicalStageSlug(lead.pipelineStage?.slug) || canonicalStageSlug(lead.status);
  if (current !== "quote_sent") return false;

  const result = await moveLeadToSystemStage(tx, {
    organizationId: params.organizationId,
    leadId,
    slug: "follow_up_1",
    actorType: "system",
    onlyForward: true,
  });
  return result.moved;
}

/**
 * Sweep: leads stuck in quote_sent for ≥ quoteFollowUpDays (covers no-email quotes).
 * Uses latest status_changed → quote_sent activity when present, else lead.updatedAt.
 */
export async function sweepQuoteSentToFollowUp(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    settings: ReturnType<typeof parseAutomationSettings>;
    now: Date;
  },
): Promise<number> {
  if (!params.settings.quoteSentAutoFollowUpStageEnabled) return 0;

  const days = params.settings.quoteFollowUpDays;
  const cutoff = new Date(params.now.getTime() - days * 24 * 60 * 60 * 1000);

  const quoteSentStage =
    (await ensureStageForSlug(tx, "quote_sent")) || (await findStageForSlug(tx, "quote_sent"));
  if (!quoteSentStage) return 0;

  const candidates = await tx.lead.findMany({
    where: {
      OR: [{ pipelineStageId: quoteSentStage.id }, { status: { in: ["quote_sent", "Quote Sent"] } }],
    },
    include: { pipelineStage: true },
    take: 80,
  });

  let moved = 0;
  for (const lead of candidates) {
    const current =
      canonicalStageSlug(lead.pipelineStage?.slug) || canonicalStageSlug(lead.status);
    if (current !== "quote_sent") continue;

    const events = await tx.activityEvent.findMany({
      where: {
        entityType: "lead",
        entityId: lead.id,
        action: "status_changed",
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    let enteredAt = lead.updatedAt;
    for (const ev of events) {
      if (!ev.changes || typeof ev.changes !== "object" || Array.isArray(ev.changes)) continue;
      const changes = ev.changes as Record<string, unknown>;
      const sys = changes.systemSlug as { to?: string } | undefined;
      const statusTo = changes.status as { to?: string } | undefined;
      const toRaw = sys?.to ?? statusTo?.to;
      if (canonicalStageSlug(String(toRaw || "")) === "quote_sent") {
        enteredAt = ev.createdAt;
        break;
      }
    }

    if (enteredAt.getTime() > cutoff.getTime()) continue;

    const result = await moveLeadToSystemStage(tx, {
      organizationId: params.organizationId,
      leadId: lead.id,
      slug: "follow_up_1",
      actorType: "system",
      onlyForward: true,
    });
    if (result.moved) moved += 1;
  }

  return moved;
}

/**
 * Process due scheduled messages org-by-org under tenant RLS.
 * Never processes org A rows inside org B's transaction.
 */
export async function processDueScheduledMessages(
  now: Date = automationClock.now(),
): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    stagesMoved: 0,
  };
  const orgs = await prisma.organization.findMany({
    select: { id: true, automationSettings: true },
  });

  for (const org of orgs) {
    const settings = parseAutomationSettings(org.automationSettings);
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
      let stagesMoved = 0;

      for (const msg of due) {
        await tx.scheduledMessage.update({
          where: { id: msg.id },
          data: { status: "processing", attempts: { increment: 1 } },
        });

        if (msg.triggerKey === "quote_follow_up") {
          const moved = await maybeMoveLeadAfterQuoteFollowUp(tx, {
            organizationId: org.id,
            entityType: msg.entityType,
            entityId: msg.entityId,
            payload: msg.payload,
            settings,
          });
          if (moved) stagesMoved += 1;
        }

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

      const swept = await sweepQuoteSentToFollowUp(tx, {
        organizationId: org.id,
        settings,
        now,
      });
      stagesMoved += swept;

      return { processed: due.length, sent, skipped, failed, stagesMoved };
    });

    result.processed += orgResult.processed;
    result.sent += orgResult.sent;
    result.skipped += orgResult.skipped;
    result.failed += orgResult.failed;
    result.stagesMoved += orgResult.stagesMoved;
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
