/**
 * Samples de stain — color names and wording. Only names: the picture of each color is always the
 * photo the crew takes of the sample on the client's floor (no catalog images).
 */

/** DuraSeal stain gallery (duraseal.com/stain-gallery), 36 colors. */
export const DURASEAL_COLORS = [
  "Aged Barrel", "Antique Brown", "Cherry", "Chestnut", "Classic Gray", "Coffee Brown",
  "Colonial Maple", "Country White", "Dark Gray", "Dark Walnut", "Early American", "Ebony",
  "English Chestnut", "Espresso", "Fruitwood", "Golden Brown", "Golden Oak", "Golden Pecan",
  "Gunstock", "Heritage Brown", "Jacobean", "Medium Brown", "Neutral", "Nutmeg",
  "Provincial", "Red Mahogany", "Rosewood", "Royal Mahogany", "Rustic Beige", "Sedona Red",
  "Silvered Gray", "Special Walnut", "Spice Brown", "True Black", "Warm Gray", "Weathered Oak",
] as const;

export const WOOD_SPECIES = ["White Oak", "Red Oak", "Hickory", "Maple"] as const;

export const SAMPLE_KINDS = ["duraseal", "blend", "natural", "other"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

export type BlendPart = { color: string; percent: number };

export function parseBlend(value: unknown): BlendPart[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((p) => ({
      color: String((p as BlendPart)?.color || "").trim().slice(0, 60),
      percent: Math.round(Number((p as BlendPart)?.percent) || 0),
    }))
    .filter((p) => p.color && p.percent > 0 && p.percent <= 100)
    .slice(0, 3);
}

/** "Special Walnut" · "50% Jacobean + 50% Special Walnut" · "Natural" · "Bona · Provincial" */
export function sampleColorText(s: { kind: string; brand?: string | null; colorName: string; blend?: unknown }): string {
  if (s.kind === "blend") {
    const parts = parseBlend(s.blend);
    if (parts.length) return parts.map((p) => `${p.percent}% ${p.color}`).join(" + ");
  }
  if (s.kind === "natural") return s.colorName || "Natural";
  return s.colorName;
}

/** Short line under the name: brand / kind. */
export function sampleSubText(s: { kind: string; brand?: string | null }, locale: "en" | "pt" = "en"): string {
  if (s.kind === "duraseal") return "DuraSeal";
  if (s.kind === "blend") return locale === "pt" ? "Mistura" : "Custom blend";
  if (s.kind === "natural") return locale === "pt" ? "Sem stain" : "No stain";
  return s.brand?.trim() || (locale === "pt" ? "Outra marca" : "Other brand");
}

/** Name shown as the approved color: "Special Walnut", "Custom blend (50% Jacobean + 50% Special Walnut)". */
export function sampleDisplayName(s: { kind: string; brand?: string | null; colorName: string; blend?: unknown }): string {
  if (s.kind === "blend") return `Custom blend (${sampleColorText(s)})`;
  if (s.kind === "other" && s.brand?.trim()) return `${s.brand.trim()} ${s.colorName}`;
  return sampleColorText(s);
}

/** What the client agrees to when signing (English, stored with the approval). */
export function approvalTerms(companyName: string): string {
  const who = companyName.trim() || "the company";
  return [
    "I saw these stain samples on my own floor and I approve the color I selected.",
    "I understand that the final color varies from board to board and that photos and screens do not show the exact color.",
    `Changing the color after this approval may require re-sanding and has an extra cost charged by ${who}.`,
  ].join(" ");
}
