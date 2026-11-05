/**
 * Countertops — fabricate and install (quartz, granite, quartzite, marble, porcelain / sintered,
 * solid surface). Second trade on the trade-pack core (plan: claude/expansao-novos-oficios.md §5).
 * Rule of the pack: integrate, don't build — the shop's templater, CAD and nesting stay where they
 * are; ObraMate runs the job: gates, proof photos, approvals, crew pay and the builder side.
 * Phases live in the JobPhase table. The template is the gate that matters: cabinets set and level
 * (1/8" in 10 ft for 3 cm stone), sink and faucet on site, the decision-maker present — a lost
 * template trip is a return-trip charge. The layout approval freezes the spec.
 * Waits are research-based defaults (estimates) — confirm with pilot shops.
 */
import type { TradePack } from "../../types.js";
import { COUNTERTOP_SERVICES } from "./services.js";
import { COUNTERTOP_WORK_ORDER_PROMPT } from "./work-order-prompt.js";

const L = (pt: string, en: string) => ({ "pt-BR": pt, "en-US": en });

export const countertops: TradePack = {
  id: "countertops",
  label: "Countertops",
  services: COUNTERTOP_SERVICES,
  quote: {
    tagline: "Quartz · Granite · Quartzite",
    sections: [
      { key: "supply", label: "SLAB & DELIVERY" },
      { key: "tops", label: "COUNTERTOPS" },
      { key: "edges", label: "EDGES" },
      { key: "cutouts", label: "CUTOUTS" },
      { key: "backsplash", label: "BACKSPLASH" },
      { key: "prep", label: "PREP & SERVICE" },
      { key: "add_on", label: "ADD ON" },
    ],
    // Words (lowercase) that put a line in a section; checked in this order, the rest is COUNTERTOPS.
    match: [
      { section: "add_on", words: ["add on", "add-on", "addon", "adicional"] },
      { section: "backsplash", words: ["backsplash", "splash", "rodabanca"] },
      { section: "cutouts", words: ["cutout", "cut-out", "cut out", "faucet", "sink", "cooktop", "outlet", "hole", "furo", "cuba"] },
      { section: "edges", words: ["edge", "ogee", "bullnose", "bevel", "miter", "waterfall", "borda"] },
      { section: "prep", words: ["template", "tear-out", "tear out", "demo", "removal", "disposal", "plumbing", "reconnect", "disconnect", "return trip", "trip", "bracket", "corbel", "support", "seam"] },
      { section: "supply", words: ["slab material", "material", "delivery", "supply", "entrega", "frete"] },
    ],
    fallbackSection: "tops",
    inclusions: [
      "Digital template on site, with the layout and seams approved before cutting",
      "Fabrication to the approved template: edges, cutouts and finish as listed",
      "Installation, sink mounting and seams color-matched and leveled",
      "Clean-up; plumbing reconnection only when listed",
    ],
  },
  phases: [
    {
      key: "selection",
      label: L("Slab escolhido e reservado", "Slab selected & held"),
      requires: [{ key: "slab_photo", kind: "photo", label: L("Foto do slab com a etiqueta / lote", "Slab with its tag / lot") }],
    },
    {
      // The gate before the template trip: a site not ready costs a return trip.
      key: "site_ready",
      label: L("Cozinha pronta para o template", "Ready for template"),
      requires: [
        {
          key: "ready_checklist",
          kind: "checklist",
          label: L(
            "Cabinets fixos e nivelados (1/8\" em 10 ft), pia, torneira e cooktop no local, armários vazios",
            "Cabinets set and level (1/8\" in 10 ft), sink, faucet and cooktop on site, cabinets empty",
          ),
        },
      ],
    },
    {
      key: "template",
      label: L("Template", "Template"),
      requires: [
        { key: "template_file", kind: "photo", label: L("Foto / arquivo do template", "Template photo / file") },
        { key: "decision_maker", kind: "checklist", label: L("Responsável no local aprovou overhangs, furos e emendas", "Decision-maker on site approved overhangs, holes and seams") },
      ],
    },
    {
      // The approval freezes the spec: after it, any change is a new price and a new approval.
      key: "layout_approval",
      label: L("Layout no slab aprovado", "Slab layout approved"),
      requires: [
        { key: "layout_photo", kind: "photo", label: L("Layout das peças no slab", "Pieces laid out on the slab") },
        { key: "client_approval", kind: "checklist", label: L("Cliente aprovou emendas e veios", "Client approved seams and veining") },
      ],
    },
    { key: "fabrication", label: L("Fabricação", "Fabrication") },
    {
      key: "shop_qc",
      label: L("Conferência na oficina", "Shop QC"),
      requires: [{ key: "qc_photo", kind: "photo", label: L("Peças conferidas antes de carregar (±1/16\")", "Pieces checked before loading (±1/16\")") }],
    },
    {
      key: "install",
      label: L("Instalação", "Install"),
      // Shop lead time: fabrication takes about a week after the layout is approved (pilot to confirm).
      leadTime: { after: "layout_approval", businessDays: 7 },
      // Sink silicone / seam epoxy cure before the plumbing is reconnected (24 h typical).
      waitAfterHours: 24,
      requires: [{ key: "seams_photo", kind: "photo", label: L("Foto das emendas e dos cutouts", "Seams and cutouts") }],
    },
    {
      key: "signoff",
      label: L("Reconexão e aceite", "Reconnect & sign-off"),
      requires: [
        { key: "finished_photo", kind: "photo", label: L("Foto do trabalho pronto", "Finished work") },
        { key: "client_signoff", kind: "checklist", label: L("Cliente conferiu e aceitou", "Client walked it and accepted") },
      ],
    },
  ],
  combinedPhaseKey: "all",
  phaseStorage: "table",
  inventory: { slabs: true, usedAtPhase: "fabrication" },
  // A remade top costs a slab and a week: the shop wants to know why and on whom.
  rework: {
    reasons: [
      { key: "measure", label: { "pt-BR": "Medida / template errado", "en-US": "Wrong measurement / template" } },
      { key: "fabrication", label: { "pt-BR": "Erro de corte ou acabamento", "en-US": "Cutting or finishing error" } },
      { key: "transport", label: { "pt-BR": "Quebrou no transporte", "en-US": "Broke in transport" } },
      { key: "install", label: { "pt-BR": "Quebrou na instalação", "en-US": "Broke during install" } },
      { key: "material", label: { "pt-BR": "Defeito no slab", "en-US": "Slab defect" } },
      { key: "change", label: { "pt-BR": "Cliente mudou o projeto", "en-US": "Customer changed the design" } },
      { key: "other", label: { "pt-BR": "Outro", "en-US": "Other" } },
    ],
    responsible: [
      { key: "shop", label: { "pt-BR": "Oficina", "en-US": "Shop" } },
      { key: "templater", label: { "pt-BR": "Template", "en-US": "Templater" } },
      { key: "installer", label: { "pt-BR": "Equipe de instalação", "en-US": "Install crew" } },
      { key: "supplier", label: { "pt-BR": "Fornecedor do slab", "en-US": "Slab supplier" } },
      { key: "customer", label: { "pt-BR": "Cliente / builder", "en-US": "Customer / builder" } },
      { key: "other", label: { "pt-BR": "Outro", "en-US": "Other" } },
    ],
  },
  // The plan takeoff doesn't measure tops yet (kitchen sheets and DXF import come later).
  takeoff: {
    measuredKinds: [],
    specFields: { other: ["material", "brand", "color", "thickness", "edge"] },
    specLabels: { material: "Material", brand: "Brand", color: "Color", thickness: "Thickness", edge: "Edge profile" },
    waste: { other: 20 },
    specSuggestions: {
      material: ["Quartz", "Granite", "Quartzite", "Marble", "Porcelain", "Sintered stone", "Solid surface"],
      thickness: ["2 cm", "3 cm"],
      edge: ["Eased", "Bevel", "Half bullnose", "Ogee", "Mitered"],
    },
  },
  measurement: { tabs: ["floors", "summary"] },
  // Production pay by item: install crews are usually paid per piece of the job.
  payroll: {
    pieceItems: [
      { key: "top_sf", label: L("Bancada instalada", "Top installed"), unit: "sf", countsSqft: true },
      { key: "template", label: L("Template", "Template"), unit: "each" },
      { key: "cutout", label: L("Cutout / furo", "Cutout / hole"), unit: "each" },
      { key: "backsplash_lf", label: L("Rodabanca (backsplash)", "Backsplash"), unit: "lf" },
      { key: "tearout", label: L("Retirada de bancada", "Tear-out"), unit: "each" },
      { key: "vanity", label: L("Bancada de banheiro", "Vanity top"), unit: "each" },
    ],
  },
  ai: {
    companyKind: "countertop fabrication and installation companies",
    tradeNoun: "countertop",
    workOrderPrompt: COUNTERTOP_WORK_ORDER_PROMPT,
  },
};
