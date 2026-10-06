/**
 * Configurações › Jobs — feature toggles stored in Organization.featureFlags.
 */
import { z } from "zod";

export type JobsSettings = {
  /** When false, checklist UI is hidden on Jobs, job modal, and Campo. Default: on. */
  checklist_enabled: boolean;
};

export function isJobChecklistEnabled(featureFlags: unknown): boolean {
  if (featureFlags == null) return true;
  if (typeof featureFlags !== "object" || Array.isArray(featureFlags)) return true;
  const flags = featureFlags as Record<string, unknown>;
  if (flags.job_checklist === false || flags.jobChecklist === false) return false;
  return true;
}

export function parseJobsSettings(featureFlags: unknown): JobsSettings {
  return { checklist_enabled: isJobChecklistEnabled(featureFlags) };
}

export const jobsSettingsPatchSchema = z.object({
  checklist_enabled: z.boolean().optional(),
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
  return base;
}
