/**
 * Configurações › Jobs — feature toggles stored in Organization.featureFlags.
 */
import { z } from "zod";

export type DeliveryLocation = {
  id: string;
  name: string;
  address: string;
  /** Free-text hours, e.g. "Mon–Fri 7am–4pm". */
  hours: string;
};

export type JobsSettings = {
  /** When false, checklist UI is hidden on Jobs, job modal, and Campo. Default: on. */
  checklist_enabled: boolean;
  /** Saved pickup places for Delivery (name + address + hours). */
  delivery_locations: DeliveryLocation[];
};

export function isJobChecklistEnabled(featureFlags: unknown): boolean {
  if (featureFlags == null) return true;
  if (typeof featureFlags !== "object" || Array.isArray(featureFlags)) return true;
  const flags = featureFlags as Record<string, unknown>;
  if (flags.job_checklist === false || flags.jobChecklist === false) return false;
  return true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function parseDeliveryLocations(featureFlags: unknown): DeliveryLocation[] {
  const flags = asRecord(featureFlags);
  const raw = flags?.delivery_locations ?? flags?.deliveryLocations;
  if (!Array.isArray(raw)) return [];
  const out: DeliveryLocation[] = [];
  for (const row of raw) {
    const r = asRecord(row);
    if (!r) continue;
    const id = String(r.id || "").trim();
    const name = String(r.name || "").trim();
    const address = String(r.address || "").trim();
    const hours = String(r.hours || "").trim();
    if (!id || !name || !address) continue;
    out.push({ id, name, address, hours });
  }
  return out.slice(0, 40);
}

export function parseJobsSettings(featureFlags: unknown): JobsSettings {
  return {
    checklist_enabled: isJobChecklistEnabled(featureFlags),
    delivery_locations: parseDeliveryLocations(featureFlags),
  };
}

const deliveryLocationSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  hours: z.string().trim().max(200).optional().default(""),
});

export const jobsSettingsPatchSchema = z.object({
  checklist_enabled: z.boolean().optional(),
  delivery_locations: z.array(deliveryLocationSchema).max(40).optional(),
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
  if (patch.delivery_locations !== undefined) {
    base.delivery_locations = patch.delivery_locations.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      hours: row.hours || "",
    }));
    delete base.deliveryLocations;
  }
  return base;
}
