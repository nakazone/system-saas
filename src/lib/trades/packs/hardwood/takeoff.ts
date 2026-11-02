/**
 * Hardwood / LVP pack: what the plan takeoff measures, which product details each floor asks
 * for, and default waste. Values moved verbatim from src/lib/builders/takeoff.ts (Phase 0).
 * Keys are plan legend kinds (hardwood, lvp, laminate, carpet, rubber, tile, stone, concrete, other).
 */
import type { PackTakeoff } from "../../types.js";

export const HARDWOOD_TAKEOFF: PackTakeoff = {
  /** Only these are flooring jobs for now (tile, stone, shower pans, countertops stay out). */
  measuredKinds: ["hardwood", "lvp", "laminate", "carpet", "rubber"],
  /** Which product details each kind of floor asks for, in print order. */
  specFields: {
    hardwood: ["species", "construction", "width", "thickness", "grade", "finish", "color", "sheen", "install", "pattern", "brand"],
    lvp: ["brand", "color", "size", "thickness", "wear", "install", "underlayment"],
    laminate: ["brand", "color", "size", "thickness", "install", "underlayment"],
    carpet: ["brand", "color", "pad"],
    rubber: ["brand", "color", "thickness"],
    tile: ["brand", "color", "size"],
    stone: ["brand", "color", "size"],
    concrete: ["color"],
    other: ["brand", "color"],
  },
  specLabels: {
    species: "Species", construction: "Construction", width: "Width", thickness: "Thickness", grade: "Grade", finish: "Finish", color: "Color / stain",
    sheen: "Sheen", install: "Install", pattern: "Pattern", brand: "Brand / product", size: "Plank size", wear: "Wear layer", underlayment: "Underlayment", pad: "Pad",
  },
  waste: { hardwood: 10, lvp: 10, laminate: 10, carpet: 12, rubber: 8, tile: 12, stone: 12, concrete: 0, other: 10 },
  /**
   * Suggestions offered in each product field (anything can still be typed). "field:kind" keys win
   * over "field" (thickness differs per floor). Moved verbatim from crm/public/partner-portal.js.
   */
  specSuggestions: {
    species: ['White Oak', 'Red Oak', 'Hickory', 'Maple', 'Walnut', 'Ash', 'Birch', 'Brazilian Cherry', 'Acacia'],
    construction: ['Engineered', 'Solid'],
    width: ['2-1/4"', '3-1/4"', '4"', '5"', '6"', '6-1/2"', '7"', '7-1/2"', '8"', '9"', '10"', 'Mixed widths'],
    'thickness:hardwood': ['3/4"', '5/8"', '9/16"', '1/2"', '3/8"'],
    'thickness:lvp': ['4 mm', '5 mm', '6 mm', '8 mm'],
    'thickness:laminate': ['7 mm', '8 mm', '10 mm', '12 mm'],
    'thickness:rubber': ['1/4"', '3/8"', '8 mm'],
    grade: ['Clear', 'Select', '#1 Common', '#2 Common', 'Character', 'Rustic'],
    finish: ['Unfinished — sand & finish on site', 'Prefinished'],
    color: ['Natural', 'Jacobean', 'Special Walnut', 'Provincial', 'Ebony', 'Classic Gray', 'Weathered Oak', 'Driftwood', 'Coffee', 'Dark Walnut'],
    sheen: ['Matte', 'Satin', 'Semi-gloss', 'Gloss'],
    install: ['Nail down', 'Glue down', 'Nail & glue', 'Floating (click)'],
    pattern: ['Straight', 'Herringbone', 'Chevron', 'Diagonal'],
    size: ['7" × 48"', '7" × 60"', '9" × 60"', '9" × 72"', '12" × 24" tile', '18" × 36" tile'],
    wear: ['12 mil', '20 mil', '22 mil', '28 mil'],
    underlayment: ['Attached pad', 'Separate underlayment', 'None'],
    pad: ['6 lb 7/16"', '8 lb 7/16"', '8 lb 1/2"', '10 lb'],
  },
};
