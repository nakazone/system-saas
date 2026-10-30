/**
 * Kitchen countertops — fabricate + install (quartz, granite, quartzite, marble, porcelain/sintered,
 * solid surface, laminate, butcher block).
 * Research: OSHA silica / CA SB 20, Moraware & Slabsmith docs, fabricator trade press, consumer
 * cost guides 2026 (ESTIMATES), vendor estimates flagged in notes.
 */
import type { TradePack } from "../types.js";

export const countertops: TradePack = {
  id: "countertops",
  label: "Countertops",
  status: "spec",
  units: ["SF", "LF", "EA", "SLAB", "HR"],
  materials: [
    {
      key: "slab",
      label: "Slab top",
      unit: "SF",
      waste: { kind: "computed", engine: "slab-nesting", fallbackPercent: 20 },
      specFields: [
        { key: "material", label: "Material", suggestions: ["Quartz", "Granite", "Quartzite", "Marble", "Porcelain", "Sintered stone", "Solid surface", "Laminate", "Butcher block"], required: true },
        { key: "brand_color", label: "Brand / color", required: true },
        { key: "thickness", label: "Thickness", suggestions: ["2cm", "3cm"] },
        { key: "finish", label: "Finish", suggestions: ["Polished", "Honed", "Leathered"] },
        { key: "edge", label: "Edge profile", suggestions: ["Eased", "Bevel", "Half bullnose", "Ogee", "Mitered"] },
        { key: "sink", label: "Sink model & mount", required: true },
        { key: "faucet_holes", label: "Faucet holes (count/spread)" },
        { key: "cooktop", label: "Cooktop / range model" },
        { key: "backsplash", label: "Backsplash", suggestions: ["None", "4\"", "Full height"] },
        { key: "slab_ids", label: "Slab IDs / lot", evidence: true },
        { key: "seams", label: "Seam locations (approved)", evidence: true },
      ],
    },
  ],
  services: [
    { category: "Tops", name: "Fabricate & install — level 1", unit: "SF", section: "tops" },
    { category: "Tops", name: "Fabricate & install — level 2", unit: "SF", section: "tops" },
    { category: "Tops", name: "Fabricate & install — level 3", unit: "SF", section: "tops" },
    { category: "Edges", name: "Upgraded edge (ogee)", unit: "LF", section: "edges", refRangeUsd: [15, 25] },
    { category: "Edges", name: "Mitered edge", unit: "LF", section: "edges", refRangeUsd: [20, 40] },
    { category: "Edges", name: "Waterfall (per side)", unit: "EA", section: "edges", refRangeUsd: [500, 2000] },
    { category: "Cutouts", name: "Undermount sink cutout", unit: "EA", section: "cutouts", refRangeUsd: [150, 400] },
    { category: "Cutouts", name: "Cooktop cutout", unit: "EA", section: "cutouts", refRangeUsd: [150, 300] },
    { category: "Cutouts", name: "Faucet hole", unit: "EA", section: "cutouts" },
    { category: "Backsplash", name: "4\" backsplash", unit: "LF", section: "backsplash", refRangeUsd: [15, 40] },
    { category: "Backsplash", name: "Full-height backsplash", unit: "SF", section: "backsplash", refRangeUsd: [30, 60] },
    { category: "Prep", name: "Tear-out", unit: "EA", section: "prep", refRangeUsd: [200, 500] },
    { category: "Service", name: "Return trip (site not ready)", unit: "EA", section: "service" },
  ],
  quoteSections: [
    { key: "tops", title: "Countertops" },
    { key: "edges", title: "Edges" },
    { key: "cutouts", title: "Cutouts" },
    { key: "backsplash", title: "Backsplash" },
    { key: "prep", title: "Prep" },
    { key: "service", title: "Service" },
  ],
  phases: [
    { key: "selection", label: "Slab selected & held", requires: [{ kind: "photo", label: "Slab tag / photo" }] },
    {
      key: "template",
      label: "Template",
      dependsOn: [{ trade: "cabinetry", milestone: "Cabinets set, level (1/8\" in 10') and secured" }],
      requires: [{ kind: "checklist", items: ["Sink & faucet on site", "Appliance specs on site", "Decision-maker present"] }, { kind: "photo", label: "Template / digital file" }],
    },
    { key: "layout_approval", label: "Slab layout approved", requires: [{ kind: "signature", label: "Seams & veining approved" }] },
    { key: "fabrication", label: "Fabrication (saw/CNC/edge)", sector: "shop" },
    { key: "qc", label: "Shop QC", requires: [{ kind: "photo", label: "Pieces before loading" }] },
    { key: "install", label: "Install", sector: "install", requires: [{ kind: "photo", label: "Seams & cutouts" }] },
  ],
  payRules: [
    { key: "hour", label: "Hourly (shop)", basis: "hour" },
    { key: "per_job", label: "Per install", basis: "per_unit", unit: "EA" },
  ],
  measurement: {
    tool: "Countertop drawing (runs, L/U, islands, peninsulas) with edges, cutouts, overhangs, backsplash; import DXF from digital templating devices; slab nesting view for layout approval.",
    objects: ["top_piece", "edge", "cutout", "backsplash", "seam", "overhang_support"],
    outputs: ["Top SF", "Edge LF by profile", "Cutout counts", "Backsplash LF/SF", "Slab count & nesting", "DXF for CNC"],
    reuses: ["ObraCam (slab photos)", "Quote PDF", "ObraBuilder plan reading (kitchen sheet)"],
  },
  ai: {
    vocabulary: ["template", "remnant", "slab", "eased edge", "ogee", "mitered", "undermount", "seam", "overhang", "3cm"],
    workOrderFields: ["level/group", "color", "edge", "sink", "backsplash", "plan", "lot"],
  },
  newModels: ["Slab (id, lot, dims, photo, status: available/held/used)", "Remnant", "FabricationTask (shop queue)", "SilicaCompliance (training, exposure monitoring)"],
  openQuestions: [
    "Builder price sheets by level (CFC and Denver builders).",
    "Shop throughput (SF/day per saw, CNC).",
    "Do pilots use digital templating devices (DXF import priority)?",
    "Colorado silica rules/insurance expectations after the 2026 Denver verdict.",
  ],
};
