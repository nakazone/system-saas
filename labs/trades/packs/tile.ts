/**
 * Tile — floors, walls, showers, backsplashes, fireplaces.
 * Research: labs/trades/docs/pesquisa (ANSI A108.02-2023, IRC P2503.6, TCNA, consumer cost guides 2025–26).
 * Ranges are ESTIMATES from consumer guides; confirm with pilot companies.
 */
import type { TradePack } from "../types.js";

export const tile: TradePack = {
  id: "tile",
  label: "Tile",
  status: "spec",
  units: ["SF", "LF", "EA", "BOX", "HR", "DAY"],
  materials: [
    {
      key: "floor_tile",
      label: "Floor tile",
      unit: "SF",
      waste: {
        kind: "percent",
        value: 10,
        byPattern: { straight: 10, offset: 12, diagonal: 20, herringbone: 20, mosaic: 25 },
      },
      specFields: [
        { key: "material", label: "Material", suggestions: ["Porcelain", "Ceramic", "Natural stone", "Glass", "Gauged porcelain panel"] },
        { key: "size", label: "Size" },
        { key: "thickness", label: "Thickness" },
        { key: "finish", label: "Finish", suggestions: ["Matte", "Polished", "Textured"] },
        { key: "pattern", label: "Pattern", suggestions: ["Straight", "1/3 offset", "Diagonal", "Herringbone", "Chevron"] },
        { key: "layout_start", label: "Layout start / centerline" },
        { key: "grout", label: "Grout type & color", evidence: true },
        { key: "joint", label: "Joint width" },
        { key: "mortar", label: "Mortar", evidence: true },
        { key: "substrate", label: "Underlayment / backer", suggestions: ["Cement board", "Foam board", "Uncoupling membrane", "Mortar bed"], evidence: true },
        { key: "trim", label: "Edge trim / profile" },
        { key: "heated", label: "Heated floor system" },
        { key: "lot", label: "Shade / lot #", evidence: true },
      ],
    },
    {
      key: "wall_tile",
      label: "Wall tile",
      unit: "SF",
      waste: { kind: "percent", value: 10, byPattern: { straight: 10, offset: 12, herringbone: 20, mosaic: 25 } },
      specFields: [
        { key: "material", label: "Material" },
        { key: "size", label: "Size" },
        { key: "pattern", label: "Pattern" },
        { key: "grout", label: "Grout type & color", evidence: true },
        { key: "waterproofing", label: "Waterproofing", suggestions: ["Sheet membrane", "Liquid membrane", "Foam board system"], evidence: true },
        { key: "height", label: "Tile height" },
        { key: "lot", label: "Shade / lot #", evidence: true },
      ],
    },
  ],
  services: [
    { category: "Floors", name: "Floor tile install", unit: "SF", section: "installation", refRangeUsd: [5, 15] },
    { category: "Walls", name: "Wall tile install", unit: "SF", section: "installation", refRangeUsd: [7, 20] },
    { category: "Showers", name: "Shower walls (labor, flat)", unit: "EA", section: "showers", refRangeUsd: [400, 1800] },
    { category: "Showers", name: "Shower pan / drain", unit: "EA", section: "showers", refRangeUsd: [200, 800] },
    { category: "Showers", name: "Niche", unit: "EA", section: "showers", refRangeUsd: [100, 400], adder: true },
    { category: "Showers", name: "Bench", unit: "EA", section: "showers", refRangeUsd: [200, 600], adder: true },
    { category: "Showers", name: "Waterproofing", unit: "EA", section: "showers", refRangeUsd: [150, 600] },
    { category: "Trim", name: "Bullnose / metal profile", unit: "LF", section: "installation" },
    { category: "Prep", name: "Demo", unit: "SF", section: "prep", refRangeUsd: [2, 7] },
    { category: "Prep", name: "Self-leveling", unit: "SF", section: "prep", refRangeUsd: [2, 5] },
    { category: "Adders", name: "Large format (15\"+) adder", unit: "SF", section: "installation", adder: true },
    { category: "Adders", name: "Pattern adder (herringbone/diagonal)", unit: "SF", section: "installation", adder: true },
    { category: "Kitchen", name: "Backsplash", unit: "SF", section: "installation" },
  ],
  quoteSections: [
    { key: "supply", title: "Supply" },
    { key: "prep", title: "Prep & demo" },
    { key: "installation", title: "Installation" },
    { key: "showers", title: "Showers" },
  ],
  phases: [
    { key: "readiness", label: "Site ready check", requires: [{ kind: "checklist", items: ["Plumbing rough-in done", "Framing/blocking for niches & bench", "Valve and drain height confirmed"] }] },
    { key: "demo_prep", label: "Demo & substrate prep", requires: [{ kind: "test", label: "Flatness (per 10 ft)", field: "flatness" }] },
    { key: "waterproofing", label: "Backer & waterproofing", requires: [{ kind: "photo", label: "Membrane at seams/corners" }] },
    {
      key: "flood_test",
      label: "Flood test",
      requires: [
        { kind: "test", label: "Flood test (water level + duration)", field: "flood_test" },
        { kind: "photo", label: "Water line marked" },
      ],
      dependsOn: [{ milestone: "Pan inspection (when permit)" }],
    },
    { key: "setting", label: "Setting", requires: [{ kind: "photo", label: "Coverage check (lifted tile)" }], waitAfterHours: 24 },
    { key: "grout", label: "Grout", waitAfterHours: 72 },
    { key: "seal_clean", label: "Seal & clean", requires: [{ kind: "photo", label: "Finished" }] },
  ],
  payRules: [
    { key: "day", label: "Day rate", basis: "day" },
    { key: "per_sf", label: "Piece rate per SF", basis: "per_unit", unit: "SF" },
    { key: "per_shower", label: "Per shower", basis: "per_unit", unit: "EA" },
  ],
  measurement: {
    tool: "Rooms for floors + a shower builder in 3D (walls width × height, niche, bench, curb, pan, drain) + backsplash runs.",
    objects: ["room", "wall", "shower", "niche", "bench", "curb", "backsplash_run", "trim_run"],
    outputs: ["Floor SF", "Wall SF", "Trim LF", "Counts (niches, benches, pans, drains)", "Boxes to order by tile size", "Layout notes"],
    reuses: ["builders/measurements.ts stair 3D engine", "takeoff legend (TILE color already detected)", "3D house"],
  },
  ai: {
    vocabulary: ["LFT", "Schluter", "bullnose", "niche", "curb", "linear drain", "flood test", "lippage", "uncoupling", "thinset", "grout joint"],
    workOrderFields: ["shower count", "tile height", "niche", "bench", "tile size", "pattern", "grout color", "selection #"],
  },
  openQuestions: [
    "Piece rates for setters in Denver (per SF / per shower).",
    "How builders send tile selections (option sheet layout).",
    "Flood test duration used locally (code 15 min vs 24 h practice).",
    "Cure times by mortar/grout product to drive phase waits.",
  ],
};
