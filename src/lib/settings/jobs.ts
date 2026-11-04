/**
 * Configurações › Jobs — feature toggles stored in Organization.featureFlags.
 */
import { z } from "zod";

export type JobsSettings = {
  /** When false, checklist UI is hidden on Jobs, job modal, and Campo. Default: on. */
  checklist_enabled: boolean;
  /**
   * Shop lead time in business days for trades whose install waits on the shop (Countertops:
   * from slab layout approval to install). null = the trade's default.
   */
  shop_lead_days: number | null;
};

/** The company's shop lead time (business days), or null to use the trade's default. */
export function shopLeadDays(featureFlags: unknown): number | null {
  if (!featureFlags || typeof featureFlags !== "object" || Array.isArray(featureFlags)) return null;
  const v = (featureFlags as Record<string, unknown>).shop_lead_days;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 60 ? v : null;
}

export function isJobChecklistEnabled(featureFlags: unknown): boolean {
  if (featureFlags == null) return true;
  if (typeof featureFlags !== "object" || Array.isArray(featureFlags)) return true;
  const flags = featureFlags as Record<string, unknown>;
  if (flags.job_checklist === false || flags.jobChecklist === false) return false;
  return true;
}

export function parseJobsSettings(featureFlags: unknown): JobsSettings {
  return { checklist_enabled: isJobChecklistEnabled(featureFlags), shop_lead_days: shopLeadDays(featureFlags) };
}

export const jobsSettingsPatchSchema = z.object({
  checklist_enabled: z.boolean().optional(),
  shop_lead_days: z.number().int().min(0).max(60).nullable().optional(),
});

export type JobsSettingsPatch = z.infer<typeof jobsSettingsPatchSchema>;

/** Merge patch into existing featureFlags JSON without wiping unrelated keys. */
export function applyJobsSettingsPatch(
  featureFlags: unknown,
  patch: JobsSettingsPatch,
): Record<string, unknown> {
  const base =
    featureFlags && typeof featureFlags === "object" && !Array.isArray(featureFlags)
      ? { ...(featureFlags as Record<string, unknown>) }
      : {};
  if (patch.checklist_enabled !== undefined) {
    base.job_checklist = patch.checklist_enabled;
    delete base.jobChecklist;
  }
  if (patch.shop_lead_days !== undefined) {
    if (patch.shop_lead_days === null) delete base.shop_lead_days;
    else base.shop_lead_days = patch.shop_lead_days;
  }
  return base;
}
