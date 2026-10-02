/**
 * Shared customer-facing quote copy (PDF page 2 + public portal).
 */
export const DEFAULT_QUOTE_INCLUSIONS = [
  "Hardwood sanding of all floors in scope",
  "Select hardwood / LVP installation as listed",
  "Baseboard remove & reinstall where noted",
  "Dust containment during sanding & finishing",
] as const;

export const DEFAULT_QUOTE_EXCLUSIONS = [
  "Stain (available as optional add-on)",
  "Subfloor repair or leveling beyond scope",
  "Moving furniture or appliances",
  "Areas marked unfinished / not in scope",
] as const;

export const DEFAULT_QUOTE_TERMS = [
  "This quote is valid until the expiration date shown. Prices assume accurate measurements and site access as discussed.",
  "Changes in scope, materials, or site conditions may require a revised quote before work continues.",
  "Natural wood and LVP may vary in color and grain; samples are representative, not exact matches.",
  "A signed approval and deposit may be required to reserve the schedule. Payment terms are listed above.",
] as const;
