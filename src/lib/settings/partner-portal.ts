import { z } from "zod";

export const DEFAULT_PARTNER_REQUEST_MODE = "review" as const;
export const partnerPortalSettingsPatchSchema = z.object({
  request_mode: z.enum(["review", "automatic"]),
}).strict();

export type PartnerRequestMode = z.infer<typeof partnerPortalSettingsPatchSchema>["request_mode"];
export type PartnerPortalSettings = { request_mode: PartnerRequestMode };

export function parsePartnerPortalSettings(raw: unknown): PartnerPortalSettings {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).request_mode
    : undefined;
  return { request_mode: value === "automatic" ? "automatic" : DEFAULT_PARTNER_REQUEST_MODE };
}
