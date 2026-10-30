/**
 * Cabinetry — kitchen & bath cabinet dealers/designers + installers (incl. production builders).
 * Key insight: two linked lifecycles — what the customer bought (design → quote → deposit) and
 * what the factory made (each SKU: ordered → acknowledged → shipped → received → inspected → installed).
 * Research: manufacturer dealer guides (Wellborn, Bertch, MasterBrand, Barker), NKBA, KCMA,
 * consumer cost guides 2025–26 (ESTIMATES).
 */
import type { TradePack } from "../types.js";

export const cabinetry: TradePack = {
  id: "cabinetry",
  label: "Cabinetry",
  status: "spec",
  units: ["EA", "LF", "HR", "DAY"],
  materials: [
    {
      key: "cabinet",
      label: "Cabinet (SKU)",
      unit: "EA",
      waste: { kind: "none" },
      specFields: [
        { key: "manufacturer", label: "Manufacturer", required: true },
        { key: "line", label: "Line" },
        { key: "door_style", label: "Door style", required: true },
        { key: "species", label: "Species" },
        { key: "finish", label: "Finish / paint" },
        { key: "construction", label: "Construction", suggestions: ["Framed", "Frameless"] },
        { key: "box", label: "Box material" },
        { key: "drawer", label: "Drawer box" },
        { key: "hinges", label: "Hinges / slides", suggestions: ["Soft-close", "Standard"] },
        { key: "hardware", label: "Hardware (model & placement)" },
        { key: "sku", label: "SKU + modifications", required: true, evidence: true },
        { key: "ack", label: "Order acknowledgment #", evidence: true },
      ],
    },
  ],
  services: [
    { category: "Install", name: "Cabinet install (per box)", unit: "EA", section: "installation", refRangeUsd: [75, 150] },
    { category: "Install", name: "Cabinet install (per LF)", unit: "LF", section: "installation", refRangeUsd: [50, 300] },
    { category: "Trim", name: "Crown / light rail", unit: "LF", section: "trim", adder: true },
    { category: "Trim", name: "End / appliance panel", unit: "EA", section: "trim", adder: true },
    { category: "Hardware", name: "Hardware install", unit: "EA", section: "hardware" },
    { category: "Install", name: "Island / tall pantry", unit: "EA", section: "installation", adder: true },
    { category: "Prep", name: "Demo & disposal", unit: "EA", section: "prep" },
    { category: "Service", name: "Service / adjustment visit", unit: "EA", section: "service" },
    { category: "Supply", name: "Tariff surcharge", unit: "EA", section: "supply" },
  ],
  quoteSections: [
    { key: "supply", title: "Cabinets" },
    { key: "installation", title: "Installation" },
    { key: "trim", title: "Trim & panels" },
    { key: "hardware", title: "Hardware" },
    { key: "prep", title: "Prep" },
    { key: "service", title: "Service" },
  ],
  phases: [
    { key: "field_measure", label: "Field measure", requires: [{ kind: "checklist", items: ["Walls A–D, inches", "Windows/doors", "Plumbing/electrical/vents", "Ceiling height & soffits", "Appliance models"] }] },
    { key: "design_approved", label: "Design approved", requires: [{ kind: "signature", label: "Elevations & SKU list approved" }] },
    { key: "ack_review", label: "Order acknowledgment checked (24 h–3 days)", requires: [{ kind: "checklist", items: ["Every SKU/mod matches order", "Finish & door style match", "Ship date noted"] }] },
    { key: "receiving", label: "Receiving & damage check", requires: [{ kind: "checklist", items: ["Count vs bill of lading", "Damage noted on BOL", "Hidden damage reported in window"] }, { kind: "photo", label: "Damage" }] },
    { key: "install", label: "Install", requires: [{ kind: "test", label: "Level within 1/8\" in 10'", field: "level" }, { kind: "test", label: "Site humidity at install", field: "rh" }] },
    { key: "countertop_ready", label: "Ready for countertop template" },
    { key: "punch", label: "Punch & service" },
  ],
  payRules: [
    { key: "per_box", label: "Per box", basis: "per_unit", unit: "EA" },
    { key: "per_lf", label: "Per LF", basis: "per_unit", unit: "LF" },
    { key: "day", label: "Day rate", basis: "day" },
  ],
  measurement: {
    tool: "Wall-by-wall field measure (A–D clockwise from sink, inches; walls round down 1/8\", appliances round up) with openings, utilities and appliances; import SKU list from design tools; elevation view.",
    objects: ["wall", "opening", "utility", "appliance", "cabinet_run", "sku_line"],
    outputs: ["Field measure sheet", "SKU list with status", "Install LF / box count", "Countertop handoff package"],
    reuses: ["3D house (rooms/walls)", "Mate WO/PDF reading for SKU lists"],
  },
  ai: {
    vocabulary: ["SKU", "acknowledgment", "filler", "scribe", "toe kick", "light rail", "crown", "frameless", "BOL", "backorder"],
    workOrderFields: ["manufacturer", "door style", "finish", "SKU list", "plan", "options"],
  },
  newModels: ["OrderLine (SKU per job with status: ordered/acked/shipped/received/damaged/backordered/installed)", "DamageClaim", "Delivery/Receiving"],
  openQuestions: [
    "Installer pay per box/LF in Denver (2026).",
    "Can 2020 Design / ProKitchen exports be imported (format)?",
    "How builder design centers send cabinet selections to installers.",
  ],
};
