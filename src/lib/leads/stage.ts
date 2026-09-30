/**
 * Lead stage + duplicate helpers shared by the CRM lead API and pipeline automations.
 *
 * A lead's column is stored twice (`lead.status` slug and `lead.pipelineStageId`). Every
 * write goes through `findStageForSlug` / `ensureStageForSlug` so both always point at the
 * same tenant stage, whatever slug dialect the caller uses ("new" vs "new_lead",
 * "assessment_scheduled" vs "meeting_scheduled", …).
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { getTenantContext } from "../tenant/prisma-tenant.js";
import { CANONICAL_STAGE_ORDER, canonicalStageSlug, type CanonicalStage } from "../dashboard/stages.js";
import { DEFAULT_PIPELINE_STAGES } from "../tenant/defaults.js";

type StageRecord = Awaited<ReturnType<TenantPrisma["pipelineStage"]["findFirst"]>>;

/** Canonical Kanban column → default tenant slug used when creating a missing stage. */
const CANONICAL_TO_DEFAULT_SLUG: Record<CanonicalStage, string> = {
  new_lead: "new",
  meeting_scheduled: "assessment_scheduled",
  quote_sent: "quote_sent",
  follow_up_1: "follow_up_1",
  stand_by: "stand_by",
  won: "won",
  lost: "lost",
};

/** Active tenant stage for any slug / legacy slug / stage name, or null when unknown. */
export async function findStageForSlug(tx: TenantPrisma, raw: string | null | undefined): Promise<StageRecord> {
  const value = String(raw || "").trim();
  if (!value) return null;
  const stages = await tx.pipelineStage.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
  const exact = stages.find((s) => (s.slug || "") === value);
  if (exact) return exact;
  const canon = canonicalStageSlug(value);
  if (!canon) return null;
  return (
    stages.find((s) => canonicalStageSlug(s.slug) === canon) ??
    stages.find((s) => canonicalStageSlug(s.name) === canon) ??
    null
  );
}

/**
 * Resolve a stage for a Kanban/UI slug, creating the default row when the tenant is missing it.
 * Use on write paths so known columns never return "Estágio desconhecido".
 */
export async function ensureStageForSlug(
  tx: TenantPrisma,
  raw: string | null | undefined,
): Promise<StageRecord> {
  const existing = await findStageForSlug(tx, raw);
  if (existing) return existing;

  const value = String(raw || "").trim();
  if (!value) return null;
  const canon = canonicalStageSlug(value);
  if (!canon) return null;

  const defaultSlug = CANONICAL_TO_DEFAULT_SLUG[canon];
  const def = DEFAULT_PIPELINE_STAGES.find((s) => s.slug === defaultSlug);
  if (!def) return null;

  const inactive = await tx.pipelineStage.findFirst({ where: { slug: def.slug } });
  if (inactive) {
    if (!inactive.isActive) {
      return tx.pipelineStage.update({
        where: { id: inactive.id },
        data: {
          isActive: true,
          name: inactive.name || def.name,
          color: inactive.color || def.color,
        },
      });
    }
    return inactive;
  }

  const organizationId = getTenantContext().organizationId;
  const takenOrders = new Set(
    (await tx.pipelineStage.findMany({ select: { order: true } })).map((s) => s.order),
  );
  let order = def.order;
  while (takenOrders.has(order)) order += 1;

  try {
    return await tx.pipelineStage.create({
      data: {
        organizationId,
        name: def.name,
        slug: def.slug,
        order,
        color: def.color,
        isClosed: def.isClosed,
        isSystemMilestone: def.isSystemMilestone,
        isActive: true,
      },
    });
  } catch {
    return findStageForSlug(tx, def.slug);
  }
}

/** Ensure every canonical Kanban column exists for the tenant (idempotent). */
export async function ensureCanonicalPipelineStages(tx: TenantPrisma): Promise<StageRecord[]> {
  const out: StageRecord[] = [];
  for (const canon of CANONICAL_STAGE_ORDER) {
    const stage = await ensureStageForSlug(tx, canon);
    if (stage) out.push(stage);
  }
  return out;
}

/** Position in the sales funnel (new_lead = 0 … won = 5, lost = 6); -1 when unknown. */
export function stageRank(slugOrName: string | null | undefined): number {
  const canon = canonicalStageSlug(slugOrName);
  return canon ? CANONICAL_STAGE_ORDER.indexOf(canon) : -1;
}

export function canonicalOf(slugOrName: string | null | undefined): CanonicalStage | null {
  return canonicalStageSlug(slugOrName);
}

export type DuplicateLead = { id: string; name: string; status: string | null; match: "phone" | "email" };

/** Existing lead with the same e-mail (case-insensitive) or the last 10 phone digits. */
export async function findDuplicateLead(
  tx: TenantPrisma,
  organizationId: string,
  input: { email?: string | null; phone?: string | null },
): Promise<DuplicateLead | null> {
  const email = String(input.email || "").trim().toLowerCase();
  const digits = String(input.phone || "").replace(/\D/g, "");
  const phoneKey = digits.length >= 7 ? digits.slice(-10) : "";
  if (!email && !phoneKey) return null;
  const rows = await tx.$queryRaw<{ id: string; name: string; status: string | null; email: string | null }[]>`
    SELECT l.id, l.name, l.status, l.email
      FROM "Lead" l
     WHERE l."organizationId" = ${organizationId}::uuid
       AND (
         (${email}::text <> '' AND lower(l.email) = ${email}::text)
         OR (${phoneKey}::text <> '' AND right(regexp_replace(coalesce(l.phone, ''), '\\D', '', 'g'), 10) = ${phoneKey}::text)
       )
     ORDER BY l."createdAt" DESC
     LIMIT 1`;
  const hit = rows[0];
  if (!hit) return null;
  return {
    id: hit.id,
    name: hit.name,
    status: hit.status,
    match: email && String(hit.email || "").toLowerCase() === email ? "email" : "phone",
  };
}
