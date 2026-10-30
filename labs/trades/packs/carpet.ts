/**
 * Carpet — stretch-in residential; production builders are a large share.
 * Research: CRI 105, Shaw warranty terms, CRI technical bulletins, consumer cost guides (ESTIMATES).
 */
import type { TradePack } from "../types.js";

export const carpet: TradePack = {
  id: "carpet",
  label: "Carpet",
  status: "spec",
  units: ["SY", "SF", "LF", "EA", "HR"],
  materials: [
    {
      key: "carpet",
      label: "Carpet",
      unit: "SY",
      waste: { kind: "computed", engine: "carpet-roll-layout", fallbackPercent: 10 },
      specFields: [
        { key: "manufacturer", label: "Manufacturer" },
        { key: "style", label: "Style", required: true },
        { key: "color", label: "Color", required: true },
        { key: "fiber", label: "Fiber", suggestions: ["Polyester", "Nylon", "Triexta", "Wool"] },
        { key: "construction", label: "Construction", suggestions: ["Cut pile", "Loop", "Cut & loop", "Pattern"] },
        { key: "roll_width", label: "Roll width", suggestions: ["12'", "13'6\"", "15'"], required: true },
        { key: "repeat", label: "Pattern repeat (W × L)" },
        { key: "dye_lot", label: "Dye lot", evidence: true },
      ],
    },
    {
      key: "pad",
      label: "Pad",
      unit: "SY",
      waste: { kind: "percent", value: 5 },
      specFields: [
        { key: "type", label: "Type", suggestions: ["Rebond", "Frothed foam", "Memory foam", "Rubber"] },
        { key: "density", label: "Density (lb)", evidence: true },
        { key: "thickness", label: "Thickness", evidence: true },
      ],
    },
  ],
  services: [
    { category: "Install", name: "Carpet install (stretch-in)", unit: "SY", section: "installation", refRangeUsd: [4.5, 13.5] },
    { category: "Install", name: "Pad install", unit: "SY", section: "installation" },
    { category: "Stairs", name: "Stairs — waterfall (per step)", unit: "EA", section: "stairs", refRangeUsd: [12, 30] },
    { category: "Stairs", name: "Stairs — cap & band (per step)", unit: "EA", section: "stairs", refRangeUsd: [20, 45] },
    { category: "Prep", name: "Tear-out & disposal", unit: "SF", section: "prep", refRangeUsd: [0.7, 1.6] },
    { category: "Prep", name: "Furniture moving (per room)", unit: "EA", section: "prep", refRangeUsd: [25, 75], adder: true },
    { category: "Trim", name: "Transition", unit: "EA", section: "installation", adder: true },
    { category: "Service", name: "Restretch", unit: "EA", section: "service" },
    { category: "Service", name: "Seam repair", unit: "EA", section: "service" },
  ],
  quoteSections: [
    { key: "supply", title: "Carpet & pad" },
    { key: "prep", title: "Prep" },
    { key: "installation", title: "Installation" },
    { key: "stairs", title: "Stairs" },
    { key: "service", title: "Service & repairs" },
  ],
  phases: [
    { key: "seam_approval", label: "Seam diagram approved", requires: [{ kind: "signature", label: "Customer approves seam placement" }] },
    { key: "receive_inspect", label: "Inspect goods before cutting", requires: [{ kind: "photo", label: "Roll label (style, color, dye lot)" }, { kind: "checklist", items: ["Style/color match order", "Same dye lot", "No visible defects"] }] },
    { key: "site_conditions", label: "Site conditions", requires: [{ kind: "test", label: "Temp 65–95°F, RH ≤65%", field: "site_env" }] },
    { key: "install", label: "Install", requires: [{ kind: "checklist", items: ["Power stretched", "Seams sealed", "Nap one direction"] }, { kind: "photo", label: "Seams & transitions" }] },
    { key: "walkthrough", label: "Walkthrough / punch" },
  ],
  payRules: [
    { key: "per_sy", label: "Per SY", basis: "per_unit", unit: "SY" },
    { key: "per_step", label: "Per step", basis: "per_unit", unit: "EA" },
    { key: "day", label: "Day rate", basis: "day" },
  ],
  measurement: {
    tool: "Rooms + roll layout optimizer: places drops on the roll width with nap direction, seam rules (with traffic, not across doorways, away from windows) and pattern repeat; outputs cut list and seam diagram.",
    objects: ["room", "drop", "fill", "seam", "stair", "closet", "transition"],
    outputs: ["SY to order (from cut plan)", "Cut list per roll", "Seam diagram (signable)", "Stairs by type", "Pad SY"],
    reuses: ["takeoff legend (CARPET color already detected)", "grid RLE of rooms for layout", "stairs model"],
  },
  ai: {
    vocabulary: ["SY", "drop", "fill", "seam", "nap", "dye lot", "power stretch", "waterfall", "cap and band", "restretch"],
    workOrderFields: ["style", "color", "pad", "rooms with carpet", "stairs type", "selection #"],
  },
  newModels: ["Roll layout (engine, stored in measurement JSON)"],
  openQuestions: [
    "Installer pay per SY in Denver and SY per crew/day.",
    "Builder carpet flow: design center → PO → pre-walk → back-charge.",
    "Which distributors/mills send cut orders and in what format.",
  ],
};
