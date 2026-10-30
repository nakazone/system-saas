/**
 * Natural stone — floors, walls, showers, fireplaces, stairs (marble, travertine, limestone,
 * slate, granite/quartzite tile) + restoration & maintenance (honing, polishing, sealing).
 * Slab countertops are a separate pack (countertops.ts).
 * Research: Natural Stone Institute DSDM 2022, TCNA F250-STONE, MAPEI stone guide, supplier terms,
 * consumer cost guides (ESTIMATES).
 */
import type { TradePack } from "../types.js";

export const stone: TradePack = {
  id: "stone",
  label: "Natural Stone",
  status: "spec",
  units: ["SF", "LF", "EA", "HR", "DAY"],
  materials: [
    {
      key: "stone_tile",
      label: "Stone tile",
      unit: "SF",
      waste: { kind: "percent", value: 15, byPattern: { straight: 15, versailles: 20, herringbone: 25 } },
      specFields: [
        { key: "stone", label: "Stone", suggestions: ["Marble", "Travertine", "Limestone", "Slate", "Granite", "Quartzite"], required: true },
        { key: "name", label: "Name / color" },
        { key: "finish", label: "Finish", suggestions: ["Polished", "Honed", "Tumbled", "Brushed", "Flamed"] },
        { key: "size", label: "Size" },
        { key: "thickness", label: "Thickness / calibrated" },
        { key: "moisture_sensitive", label: "Moisture-sensitive (green marble, limestone)", suggestions: ["Yes", "No"], evidence: true },
        { key: "mortar", label: "Setting material", suggestions: ["White polymer thinset", "Rapid-set", "Epoxy"], evidence: true },
        { key: "lot", label: "Lot / crate #", evidence: true, required: true },
        { key: "sealer", label: "Sealer (product)", evidence: true },
      ],
    },
  ],
  services: [
    { category: "Install", name: "Stone tile install", unit: "SF", section: "installation", refRangeUsd: [5, 14] },
    { category: "Install", name: "Stair tread / riser", unit: "EA", section: "installation" },
    { category: "Install", name: "Threshold / saddle", unit: "EA", section: "installation" },
    { category: "Finish", name: "Seal", unit: "SF", section: "finishing", refRangeUsd: [0.5, 3] },
    { category: "Restoration", name: "Hone & polish", unit: "SF", section: "restoration", refRangeUsd: [1, 7] },
    { category: "Restoration", name: "Grind (lippage removal) & polish", unit: "SF", section: "restoration", refRangeUsd: [7, 30] },
    { category: "Restoration", name: "Test area", unit: "EA", section: "restoration" },
    { category: "Maintenance", name: "Maintenance plan visit", unit: "EA", section: "maintenance" },
  ],
  quoteSections: [
    { key: "supply", title: "Stone" },
    { key: "installation", title: "Installation" },
    { key: "finishing", title: "Finishing & sealing" },
    { key: "restoration", title: "Restoration" },
    { key: "maintenance", title: "Maintenance plan" },
  ],
  phases: [
    { key: "structure", label: "Substrate check", requires: [{ kind: "checklist", items: ["Deflection L/720 (two layers of plywood over joists)", "Flatness per stone spec"] }] },
    { key: "delivery_inspect", label: "Delivery inspection (48 h)", requires: [{ kind: "photo", label: "Crates & damage" }, { kind: "checklist", items: ["All material on site", "Lot/crate # recorded"] }] },
    { key: "dry_lay", label: "Dry-lay approved", requires: [{ kind: "photo", label: "Dry-lay / blend" }, { kind: "signature", label: "Customer approves color & veining" }] },
    { key: "setting", label: "Setting", requires: [{ kind: "photo", label: "95% coverage check" }], waitAfterHours: 24 },
    { key: "seal_before_grout", label: "Seal before grout (when needed)" },
    { key: "grout_seal", label: "Grout & final seal", requires: [{ kind: "test", label: "Sealer log (product, date, coats)", field: "seal_log" }] },
  ],
  payRules: [
    { key: "day", label: "Day rate", basis: "day" },
    { key: "per_sf", label: "Per SF", basis: "per_unit", unit: "SF" },
  ],
  measurement: {
    tool: "Same rooms/walls/shower tools as Tile + stair parts (treads, risers, landings) + restoration survey (areas with damage level and starting grit).",
    objects: ["room", "wall", "shower", "stair_part", "threshold", "restoration_area"],
    outputs: ["SF by stone/finish", "Extra stock (attic stock)", "Stair parts", "Restoration SF by damage level"],
    reuses: ["tile pack measurement", "stairs model", "ObraCam before/after"],
  },
  ai: {
    vocabulary: ["honed", "polished", "tumbled", "etching", "lippage", "efflorescence", "dry-lay", "lot", "crate", "diamond grit", "crystallization"],
    workOrderFields: ["stone name", "finish", "lot", "sealer", "maintenance plan"],
  },
  newModels: ["MaintenancePlan (recurring visits per customer)", "SealLog (product, date, area)"],
  openQuestions: [
    "LF/EA rates for treads, risers, thresholds.",
    "SF per day for grinding/polishing crews.",
    "Importer lead times to Denver.",
    "Is 'Stone' for the pilot slab countertops, stone tile, or both?",
  ],
};
