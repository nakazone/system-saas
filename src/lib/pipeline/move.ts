import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import {
  SYSTEM_PIPELINE_SLUGS,
  type SystemPipelineSlug,
} from "../tenant/defaults.js";
import { recordActivity } from "../activity/record.js";

export { SYSTEM_PIPELINE_SLUGS, type SystemPipelineSlug };

export async function findSystemStage(
  tx: TenantPrisma,
  organizationId: string,
  slug: SystemPipelineSlug,
) {
  return tx.pipelineStage.findFirst({
    where: { organizationId, slug, isActive: true },
  });
}

export async function moveLeadToSystemStage(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    leadId: string;
    slug: SystemPipelineSlug;
    actorType?: "user" | "system";
    actorId?: string | null;
    /** Required when moving to lost */
    lossReasonId?: string | null;
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
  if (current?.slug === "won" || current?.slug === "lost") {
    if (params.slug !== "won" && params.slug !== "lost") {
      return { moved: false, reason: "already_closed" };
    }
  }

  if (lead.pipelineStageId === stage.id && params.slug !== "lost") {
    return { moved: false, reason: "already_there" };
  }

  const data: {
    pipelineStageId: string;
    status: string;
    lossReasonId?: string | null;
    lostAt?: Date | null;
  } = {
    pipelineStageId: stage.id,
    status: params.slug === "won" ? "won" : params.slug === "lost" ? "lost" : lead.status,
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
): Promise<string | null> {
  const quote = await tx.quote.findFirst({
    where: { id: quoteId },
    include: { customer: true },
  });
  if (!quote) return null;
  if (quote.leadId) return quote.leadId;
  return quote.customer?.leadId ?? null;
}

export async function moveLeadForQuoteEvent(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    slug: "quote_sent" | "won";
    actorType?: "user" | "system";
    actorId?: string | null;
  },
): Promise<void> {
  const leadId = await resolveLeadIdForQuote(tx, params.quoteId);
  if (!leadId) return;
  await moveLeadToSystemStage(tx, {
    organizationId: params.organizationId,
    leadId,
    slug: params.slug,
    actorType: params.actorType,
    actorId: params.actorId,
  });
}

export function assertCanDeleteOrReorderStage(stage: {
  isSystemMilestone: boolean;
}): void {
  if (stage.isSystemMilestone) {
    throw new Error("System milestone stages cannot be deleted or reordered");
  }
}
