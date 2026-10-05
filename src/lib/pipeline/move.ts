import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import {
  SYSTEM_PIPELINE_SLUGS,
  type SystemPipelineSlug,
} from "../tenant/defaults.js";
import { recordActivity } from "../activity/record.js";
import { findStageForSlug, stageRank, ensureStageForSlug } from "../leads/stage.js";
import { canonicalStageSlug } from "../dashboard/stages.js";

export { SYSTEM_PIPELINE_SLUGS, type SystemPipelineSlug };

/** System milestones plus common Kanban columns used by automations. */
export type MoveablePipelineSlug = SystemPipelineSlug | "follow_up_1" | "stand_by";

export async function findSystemStage(
  tx: TenantPrisma,
  organizationId: string,
  slug: MoveablePipelineSlug | string,
) {
  const exact = await tx.pipelineStage.findFirst({
    where: { organizationId, slug, isActive: true },
  });
  // Tenants migrated from Senior Floors use other slugs (new_lead, meeting_scheduled…).
  // Ensure missing system milestones so quote send / approve never silently no-ops.
  return exact ?? (await ensureStageForSlug(tx, slug)) ?? findStageForSlug(tx, slug);
}

export async function moveLeadToSystemStage(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    leadId: string;
    slug: MoveablePipelineSlug | string;
    actorType?: "user" | "system";
    actorId?: string | null;
    /** Required when moving to lost */
    lossReasonId?: string | null;
    /** Automations: never move a lead backwards (e.g. Follow Up → Quote Sent). */
    onlyForward?: boolean;
  },
): Promise<{ moved: boolean; reason?: string }> {
  const stage = await findSystemStage(tx, params.organizationId, params.slug);
  if (!stage) return { moved: false, reason: "stage_missing" };

  const lead = await tx.lead.findFirst({ where: { id: params.leadId } });
  if (!lead) return { moved: false, reason: "lead_missing" };

  if (params.slug === "lost") {
    if (!params.lossReasonId) {
      return { moved: false, reason: "loss_reason_required" };
    }
    const reason = await tx.lossReason.findFirst({
      where: { id: params.lossReasonId, isActive: true },
    });
    if (!reason) return { moved: false, reason: "loss_reason_invalid" };
  }

  // Do not auto-regress from Won/Lost to earlier system stages
  const current = lead.pipelineStageId
    ? await tx.pipelineStage.findFirst({ where: { id: lead.pipelineStageId } })
    : null;
  const currentCanon = canonicalStageSlug(current?.slug) || canonicalStageSlug(lead.status);
  if (currentCanon === "won" || currentCanon === "lost") {
    if (params.slug !== "won" && params.slug !== "lost") {
      return { moved: false, reason: "already_closed" };
    }
  }

  const wantStatus = stage.slug || params.slug;
  if (lead.pipelineStageId === stage.id && params.slug !== "lost") {
    // Kanban reads lead.status first — heal stale status even when stage id already matches.
    if (canonicalStageSlug(lead.status) === canonicalStageSlug(wantStatus)) {
      return { moved: false, reason: "already_there" };
    }
    await tx.lead.update({ where: { id: lead.id }, data: { status: wantStatus } });
    await recordActivity(tx, {
      organizationId: params.organizationId,
      entityType: "lead",
      entityId: lead.id,
      actorType: params.actorType ?? "system",
      actorId: params.actorId ?? null,
      action: "status_changed",
      changes: {
        status: { from: lead.status, to: wantStatus },
        systemSlug: { from: current?.slug ?? null, to: params.slug },
        healed: { from: lead.status, to: wantStatus },
      },
    });
    return { moved: true, reason: "status_healed" };
  }

  if (params.onlyForward) {
    const from = Math.max(stageRank(current?.slug), stageRank(lead.status));
    if (from >= stageRank(stage.slug)) return { moved: false, reason: "not_forward" };
  }

  const data: {
    pipelineStageId: string;
    status: string;
    lossReasonId?: string | null;
    lostAt?: Date | null;
  } = {
    pipelineStageId: stage.id,
    // Keep `status` in lockstep with the stage — the CRM Kanban reads `status` first.
    status: wantStatus,
  };

  if (params.slug === "lost") {
    data.lossReasonId = params.lossReasonId!;
    data.lostAt = new Date();
  } else if (params.slug === "won") {
    data.lossReasonId = null;
    data.lostAt = null;
  }

  await tx.lead.update({ where: { id: lead.id }, data });
  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "lead",
    entityId: lead.id,
    actorType: params.actorType ?? "system",
    actorId: params.actorId ?? null,
    action: "status_changed",
    changes: {
      pipelineStageId: { from: lead.pipelineStageId, to: stage.id },
      systemSlug: { from: current?.slug ?? null, to: params.slug },
      ...(params.slug === "lost"
        ? { lossReasonId: { from: lead.lossReasonId, to: params.lossReasonId } }
        : {}),
    },
  });
  return { moved: true };
}

/** Resolve lead id from quote (direct leadId or customer.leadId). */
export async function resolveLeadIdForQuote(
  tx: TenantPrisma,
  quoteId: string,
  leadIdHint?: string | null,
): Promise<string | null> {
  const quote = await tx.quote.findFirst({
    where: { id: quoteId },
    include: { customer: true },
  });
  if (!quote) return null;
  if (quote.leadId) return quote.leadId;
  const hint = leadIdHint ? String(leadIdHint).trim() : "";
  if (hint) {
    const lead = await tx.lead.findFirst({ where: { id: hint } });
    if (lead) return lead.id;
  }
  return quote.customer?.leadId ?? null;
}

/**
 * After a quote is sent/approved: move the linked lead (and backfill quote.leadId when needed).
 * Returns whether the stage actually changed.
 */
export async function moveLeadForQuoteEvent(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    slug: "quote_sent" | "won";
    actorType?: "user" | "system";
    actorId?: string | null;
    /** Prefer this lead when the quote has no leadId yet (e.g. from send UI). */
    leadIdHint?: string | null;
    /**
     * When true, never move backwards (e.g. Follow Up → Quote Sent).
     * Send/approve actions pass false so the Kanban card lands on the target column.
     */
    onlyForward?: boolean;
  },
): Promise<{ moved: boolean; leadId: string | null; reason?: string }> {
  const leadId = await resolveLeadIdForQuote(tx, params.quoteId, params.leadIdHint);
  if (!leadId) return { moved: false, leadId: null, reason: "no_lead" };

  // Keep quote ↔ lead linked for Kanban / next sends.
  const quote = await tx.quote.findFirst({
    where: { id: params.quoteId },
    select: { leadId: true },
  });
  if (quote && !quote.leadId) {
    await tx.quote.update({ where: { id: params.quoteId }, data: { leadId } });
  }

  const result = await moveLeadToSystemStage(tx, {
    organizationId: params.organizationId,
    leadId,
    slug: params.slug,
    actorType: params.actorType,
    actorId: params.actorId,
    onlyForward: params.onlyForward === true,
  });
  return {
    moved: result.moved,
    leadId,
    reason: result.moved ? undefined : result.reason,
  };
}

const WON_QUOTE = new Set(["approved", "accepted", "converted", "invoiced"]);

/** Move the quote's lead when a CRM save changes the quote status (sent → Quote Sent, approved → Won). */
export async function syncLeadForQuoteStatus(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    previousStatus: string | null | undefined;
    nextStatus: string | null | undefined;
    actorId?: string | null;
  },
): Promise<void> {
  const prev = String(params.previousStatus || "").toLowerCase();
  const next = String(params.nextStatus || "").toLowerCase();
  if (!next) return;
  // Re-saving an already-sent quote still attempts Quote Sent (onlyForward), to heal missed moves.
  if (next === prev && next !== "sent" && !WON_QUOTE.has(next)) return;
  const slug = WON_QUOTE.has(next) ? "won" : next === "sent" ? "quote_sent" : null;
  if (!slug) return;
  if (slug === "won" && WON_QUOTE.has(prev)) return;
  await moveLeadForQuoteEvent(tx, {
    organizationId: params.organizationId,
    quoteId: params.quoteId,
    slug,
    actorType: "user",
    actorId: params.actorId ?? null,
    // Quiet status sync: don't pull Follow Up / Stand By back to Quote Sent.
    onlyForward: slug === "quote_sent",
  });
}

export function assertCanDeleteOrReorderStage(stage: {
  isSystemMilestone: boolean;
}): void {
  if (stage.isSystemMilestone) {
    throw new Error("System milestone stages cannot be deleted or reordered");
  }
}
