/**
 * Configurações › Indicações — stored in Organization.referralSettings.
 * Program: Particular cashback = % of paid invoice (project slice) for all tenants.
 */
import { z } from "zod";

export type ReferralSettings = {
  enabled: boolean;
  /** Percent of paid invoice amount credited to the Particular referrer. */
  percent: number;
  /** Days until unused credit expires; null = no expiry. */
  credit_validity_days: number | null;
};

const DEFAULTS: ReferralSettings = {
  enabled: false,
  percent: 5,
  credit_validity_days: null,
};

export function parseReferralSettings(raw: unknown): ReferralSettings {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
  const o = raw as Record<string, unknown>;
  const percent = Number(o.percent);
  const days = o.credit_validity_days == null || o.credit_validity_days === ""
    ? null
    : Number(o.credit_validity_days);
  return {
    enabled: o.enabled === true,
    percent: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent * 100) / 100 : DEFAULTS.percent,
    credit_validity_days:
      days != null && Number.isFinite(days) && days > 0 ? Math.min(3650, Math.floor(days)) : null,
  };
}

export const referralSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  percent: z.number().min(0).max(100).optional(),
  credit_validity_days: z.number().int().min(1).max(3650).nullable().optional(),
});

export type ReferralSettingsPatch = z.infer<typeof referralSettingsPatchSchema>;

export function applyReferralSettingsPatch(
  current: unknown,
  patch: ReferralSettingsPatch,
): ReferralSettings {
  const base = parseReferralSettings(current);
  if (patch.enabled !== undefined) base.enabled = patch.enabled;
  if (patch.percent !== undefined) base.percent = Math.round(patch.percent * 100) / 100;
  if (patch.credit_validity_days !== undefined) base.credit_validity_days = patch.credit_validity_days;
  return base;
}
