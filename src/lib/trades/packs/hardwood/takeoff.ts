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
};
