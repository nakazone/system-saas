/**
 * Canonical pipeline stages — server mirror of `crm/public/pipeline-stage-labels.js`
 * and `leads-kanban.js#resolveStageForLead`, so the Dashboard groups leads exactly
 * like the Leads Kanban does (lead.status first, then the stage join, then id).
 */

export const CANONICAL_STAGE_ORDER = [
  "new_lead",
  "contacted",
  "meeting_scheduled",
  "quote_sent",
  "follow_up_1",
  "stand_by",
  "won",
  "lost",
] as const;

export type CanonicalStage = (typeof CANONICAL_STAGE_ORDER)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_STAGE_ORDER);

const LEGACY_SLUG_TO_CANONICAL: Record<string, CanonicalStage> = {
  lead_received: "new_lead",
  new: "new_lead",
  contact_made: "contacted",
  qualified: "contacted",
  visit_scheduled: "meeting_scheduled",
  assessment_scheduled: "meeting_scheduled",
  measurement_done: "follow_up_1",
  followup_1: "follow_up_1",
  follow_up1: "follow_up_1",
  followup_2: "follow_up_1",
  follow_up2: "follow_up_1",
  "follow-up-2": "follow_up_1",
  followup2: "follow_up_1",
  proposal_created: "quote_sent",
  proposal_sent: "quote_sent",
  proposal: "quote_sent",
  negotiation: "follow_up_1",
  closing_attempt: "follow_up_1",
  closed_won: "won",
  closed_lost: "lost",
  production: "won",
};

/** Same default colors as the Kanban (`PIPELINE_V9_KANBAN_DEFAULTS`). */
export const CANONICAL_STAGE_COLORS: Record<CanonicalStage, string> = {
  new_lead: "#3498db",
  contacted: "#f39c12",
  meeting_scheduled: "#90EE90",
  quote_sent: "#9b59b6",
  follow_up_1: "#F1C40F",
  stand_by: "#a8a29e",
  won: "#27ae60",
  lost: "#c0392b",
};

/** Canonical slug for any raw status / stage slug; `null` when it is not a pipeline column. */
export function canonicalStageSlug(raw: string | null | undefined): CanonicalStage | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (CANONICAL_SET.has(s)) return s as CanonicalStage;
  if (LEGACY_SLUG_TO_CANONICAL[s]) return LEGACY_SLUG_TO_CANONICAL[s]!;
  const lower = s.toLowerCase().replace(/\s+/g, "_");
  if (CANONICAL_SET.has(lower)) return lower as CanonicalStage;
  return LEGACY_SLUG_TO_CANONICAL[lower] ?? null;
}

export type StageRow = {
  id: string;
  name: string;
  slug: string | null;
  order: number;
  color: string | null;
  isClosed: boolean;
};

export type LeadStageInput = {
  status: string | null;
  pipelineStageId: string | null;
  stageSlug: string | null;
};

/**
 * Column a lead belongs to. Mirrors the Kanban: explicit `lead.status` wins over a
 * stale stage join; unknown values fall back to the stage id, then the first column.
 */
export function resolveLeadStage(lead: LeadStageInput, stages: StageRow[]): CanonicalStage {
  const fromStatus = canonicalStageSlug(lead.status);
  if (fromStatus) return fromStatus;
  const fromJoin = canonicalStageSlug(lead.stageSlug);
  if (fromJoin) return fromJoin;
  if (lead.pipelineStageId) {
    const row = stages.find((s) => s.id === lead.pipelineStageId);
    const byId = canonicalStageSlug(row?.slug) ?? canonicalStageSlug(row?.name);
    if (byId) return byId;
  }
  return "new_lead";
}

export function isOpenStage(stage: CanonicalStage): boolean {
  return stage !== "won" && stage !== "lost";
}

export type DashboardStage = {
  slug: CanonicalStage;
  id: string | null;
  name: string | null;
  color: string;
  order: number;
};

/** One entry per canonical column, enriched with the tenant's own stage row when it exists. */
export function canonicalStagesFor(stages: StageRow[]): DashboardStage[] {
  return CANONICAL_STAGE_ORDER.map((slug, index) => {
    const exact = stages.find((s) => (s.slug || "") === slug);
    const row =
      exact ||
      stages.find((s) => canonicalStageSlug(s.slug) === slug) ||
      stages.find((s) => canonicalStageSlug(s.name) === slug);
    return {
      slug,
      id: row?.id ?? null,
      name: row?.name ?? null,
      color: CANONICAL_STAGE_COLORS[slug],
      order: index + 1,
    };
  });
}
