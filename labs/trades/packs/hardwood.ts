/**
 * Hardwood / LVP / Laminate — the pack that is LIVE today, written as a pack.
 * It mirrors what is hardcoded in the app now (see docs/phase-0-inventory.md):
 * src/lib/pricing/default-services.ts, src/lib/work-orders/sector-finish.ts,
 * src/lib/quotes/pdf.ts, src/lib/field-quote/tour.ts, src/lib/builders/takeoff.ts.
 * Phase 0 = make the app read this instead of the hardcoded values, with no change for users.
 */
import type { TradePack } from "../types.js";

export const hardwood: TradePack = {
  id: "hardwood",
  label: "Hardwood & LVP",
  status: "live",
  units: ["SF", "LF", "EA", "BOX", "HR", "DAY"],
  materials: [
    {
      key: "hardwood",
      label: "Hardwood",
      unit: "SF",
      waste: { kind: "percent", value: 10, byPattern: { straight: 10, diagonal: 12, herringbone: 15 } },
      specFields: [
        { key: "species", label: "Species", suggestions: ["White Oak", "Red Oak", "Hickory", "Maple", "Walnut"] },
        { key: "construction", label: "Construction", suggestions: ["Solid", "Engineered"] },
        { key: "width", label: "Width" },
        { key: "thickness", label: "Thickness" },
        { key: "grade", label: "Grade" },
        { key: "finish", label: "Finish", suggestions: ["Prefinished", "Unfinished (sand & finish on site)"] },
        { key: "stain", label: "Color / stain" },
        { key: "sheen", label: "Sheen" },
        { key: "installation", label: "Installation", suggestions: ["Nail down", "Glue down", "Floating"] },
        { key: "pattern", label: "Pattern" },
        { key: "brand", label: "Brand" },
      ],
    },
    {
      key: "lvp",
      label: "LVP",
      unit: "SF",
      waste: { kind: "percent", value: 10 },
      specFields: [
        { key: "brand", label: "Brand" },
        { key: "color", label: "Color" },
        { key: "plank", label: "Plank size" },
        { key: "thickness", label: "Thickness" },
        { key: "wear_layer", label: "Wear layer" },
        { key: "installation", label: "Installation" },
        { key: "underlayment", label: "Underlayment" },
      ],
    },
    {
      key: "laminate",
      label: "Laminate",
      unit: "SF",
      waste: { kind: "percent", value: 10 },
      specFields: [
        { key: "brand", label: "Brand" },
        { key: "color", label: "Color" },
        { key: "plank", label: "Plank size" },
        { key: "thickness", label: "Thickness" },
        { key: "underlayment", label: "Underlayment" },
      ],
    },
  ],
  services: [
    { category: "Installation", name: "Hardwood install", unit: "SF", section: "installation", sector: "installation" },
    { category: "Installation", name: "LVP install", unit: "SF", section: "installation", sector: "installation" },
    { category: "Sand & Finish", name: "Sand & finish (3 coats)", unit: "SF", section: "sand_finish", sector: "sand_finish" },
    { category: "Stairs", name: "Stair tread", unit: "EA", section: "installation", sector: "installation" },
    { category: "Additional services", name: "Baseboard", unit: "LF", section: "installation", sector: "installation", adder: true },
  ],
  quoteSections: [
    { key: "supply", title: "Supply" },
    { key: "installation", title: "Installation" },
    { key: "sand_finish", title: "Sand & Finish" },
  ],
  phases: [
    { key: "acclimation", label: "Acclimation", requires: [{ kind: "test", label: "Moisture reading", field: "moisture_pct" }] },
    { key: "installation", label: "Installation", sector: "installation", requires: [{ kind: "photo", label: "Installed floor" }] },
    { key: "sand_finish", label: "Sand & finish", sector: "sand_finish", waitAfterHours: 48 },
  ],
  payRules: [
    { key: "full_day", label: "Full day", basis: "day" },
    { key: "half_day", label: "Half day", basis: "half_day" },
    { key: "double", label: "Double", basis: "day" },
  ],
  measurement: {
    tool: "Rooms (rectangles/polygons) + stairs + vents; ObraBuilder reads plan legends and builds a 3D house.",
    objects: ["room", "stair", "vent"],
    outputs: ["SF per material (net + waste)", "stairs (treads/risers/nosings/returns)", "vents"],
    reuses: ["field-quote/tour.ts", "builders/takeoff.ts", "builders/measurements.ts", "partner-portal-3d.js"],
  },
  ai: {
    vocabulary: ["sand & finish", "nosing", "flush mount vent", "acclimation", "stain", "sheen"],
    workOrderFields: ["community", "lot", "plan", "PO", "pickup", "install date", "stairs", "vents"],
  },
  openQuestions: [],
};
