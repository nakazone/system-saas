/**
 * Tile — floors, walls, showers, backsplashes, fireplaces (porcelain, ceramic, mosaic, stone tile).
 * First trade after Hardwood. Phases live in the JobPhase table: a tile job has 7, gated by cure
 * times and evidence (flood test, coverage photo). Standards behind the rules: ANSI A108.02
 * (flatness, lippage, coverage), IRC P2503.6 (flood test), TCNA (movement joints).
 * Waits are research-based defaults (estimates) — confirm with pilot companies.
 */
import type { TradePack } from "../../types.js";
import { TILE_SERVICES } from "./services.js";
import { TILE_WORK_ORDER_PROMPT } from "./work-order-prompt.js";

const L = (pt: string, en: string) => ({ "pt-BR": pt, "en-US": en });

export const tile: TradePack = {
  id: "tile",
  label: "Tile",
  services: TILE_SERVICES,
  quote: {
    tagline: "Tile · Showers · Backsplashes",
    sections: [
      { key: "supply", label: "SUPPLY" },
      { key: "prep", label: "PREP & DEMO" },
      { key: "installation", label: "INSTALLATION" },
      { key: "showers", label: "SHOWERS" },
      { key: "add_on", label: "ADD ON" },
    ],
    // Words (lowercase) that put a line in a section; checked in this order, the rest is INSTALLATION.
    match: [
      { section: "add_on", words: ["add on", "add-on", "addon", "adicional"] },
      { section: "supply", words: ["supply", "delivery", "material", "fornec", "entrega", "frete", "shipping"] },
      { section: "showers", words: ["shower", "niche", "bench", "curb", "pan", "drain", "flood test", "waterproof", "chuveiro", "nicho"] },
      { section: "prep", words: ["demo", "haul", "removal", "level", "backer", "uncoupling", "crack isolation", "heated floor", "prep", "minimum charge"] },
    ],
    fallbackSection: "installation",
    inclusions: [
      "Tile installation as listed, to the layout approved before setting",
      "Waterproofing and flood test before tile in showers and wet areas",
      "Grout, and flexible caulk at corners and changes of plane",
      "Clean-up, with extra tile left on site for future repairs",
    ],
  },
  phases: [
    {
      key: "site_ready",
      label: L("Obra pronta", "Site ready"),
      requires: [{ key: "ready_checklist", kind: "checklist", label: L("Encanamento, reforços e altura do ralo conferidos", "Plumbing, blocking and drain height checked") }],
    },
    {
      key: "prep",
      label: L("Demo e preparo", "Demo & prep"),
      requires: [{ key: "flatness", kind: "test", label: L("Planicidade do contrapiso (em 10 ft)", "Substrate flatness (per 10 ft)") }],
    },
    {
      key: "waterproofing",
      label: L("Impermeabilização", "Waterproofing"),
      // Membrane cure before the flood test (manufacturers: 24 h typical; longer when cold).
      waitAfterHours: 24,
      requires: [{ key: "membrane_photo", kind: "photo", label: L("Foto da manta nas emendas e cantos", "Membrane at seams and corners") }],
    },
    {
      key: "flood_test",
      label: L("Teste de estanqueidade", "Flood test"),
      requires: [
        { key: "flood_result", kind: "test", label: L("Resultado (altura da água e duração)", "Result (water depth and duration)") },
        { key: "water_line_photo", kind: "photo", label: L("Foto da marca d'água", "Water line photo") },
      ],
    },
    {
      key: "setting",
      label: L("Assentamento", "Setting"),
      // Mortar cure before grout (product-dependent; 24 h default).
      waitAfterHours: 24,
      requires: [{ key: "coverage_photo", kind: "photo", label: L("Foto de peça levantada (cobertura)", "Lifted tile (mortar coverage)") }],
    },
    {
      key: "grout",
      label: L("Rejunte", "Grout"),
      // Grout cure before sealing (48 h default).
      waitAfterHours: 48,
    },
    {
      key: "seal_clean",
      label: L("Selante e limpeza", "Seal & clean"),
      requires: [{ key: "finished_photo", kind: "photo", label: L("Foto do trabalho pronto", "Finished work") }],
    },
  ],
  combinedPhaseKey: "all",
  phaseStorage: "table",
  takeoff: {
    measuredKinds: ["tile", "stone"],
    specFields: {
      tile: ["material", "brand", "color", "size", "finish", "pattern", "grout", "joint"],
      stone: ["stone", "color", "size", "finish", "pattern", "grout", "joint"],
      other: ["brand", "color"],
    },
    specLabels: {
      material: "Material", brand: "Brand / product", color: "Color", size: "Tile size", finish: "Finish", pattern: "Pattern",
      grout: "Grout (type & color)", joint: "Joint width", stone: "Stone",
    },
    waste: { tile: 12, stone: 15, other: 10 },
    specSuggestions: {
      material: ["Porcelain", "Ceramic", "Glass mosaic", "Gauged porcelain panel"],
      stone: ["Marble", "Travertine", "Limestone", "Slate", "Granite", "Quartzite"],
      size: ['12" × 24"', '24" × 24"', '24" × 48"', '8" × 48" plank', '3" × 12" subway', '2" × 2" mosaic', '1" hex mosaic'],
      finish: ["Matte", "Polished", "Honed", "Textured"],
      pattern: ["Straight", "1/3 offset", "1/2 offset", "Herringbone", "Chevron", "Diagonal", "Vertical stack"],
      grout: ["Sanded cement", "Unsanded cement", "High-performance cement", "Urethane", "Epoxy"],
      joint: ['1/16"', '1/8"', '3/16"', '1/4"'],
    },
  },
  ai: {
    companyKind: "tile installation companies",
    tradeNoun: "tile",
    workOrderPrompt: TILE_WORK_ORDER_PROMPT,
  },
};
