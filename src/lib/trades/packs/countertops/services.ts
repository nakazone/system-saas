/**
 * Countertops pack — default Tabela de Valores catalog (rates start at 0, like every pack).
 * Names follow how US fabricators list their price book: tops by price level (Level 1/2/3, how
 * builders buy), then edges per linear foot, cutouts per unit, backsplash, prep and service trips.
 * Research: claude/expansao-novos-oficios.md §5 (typical ranges there are estimates).
 */
import type { PackService } from "../../types.js";

const svc = (sortOrder: number, name: string, category: PackService["category"], unit: string, description = ""): PackService => ({
  name,
  category,
  unit,
  description,
  sortOrder,
});

export const COUNTERTOP_SERVICES: PackService[] = [
  // Tops (fabricate + install), by price level
  svc(10, "Countertop – Level 1 (fabricate & install)", "installation", "sq ft", "Entry colors. 3 cm, eased edge, standard overhang."),
  svc(20, "Countertop – Level 2 (fabricate & install)", "installation", "sq ft"),
  svc(30, "Countertop – Level 3 (fabricate & install)", "installation", "sq ft"),
  svc(40, "Countertop – Level 4 / Premium (fabricate & install)", "installation", "sq ft", "Quartzite, marble, exotic colors."),
  svc(50, "Vanity Top / Remnant", "installation", "unit", "Bath vanity from a remnant, with sink cutout."),
  svc(60, "Island Top", "installation", "sq ft"),
  // Edges
  svc(100, "Edge Upgrade – Bevel / Half Bullnose", "installation", "linear ft", "Added to the eased edge included in the top."),
  svc(110, "Edge Upgrade – Ogee / Full Bullnose", "installation", "linear ft"),
  svc(120, "Mitered Edge (laminated)", "installation", "linear ft"),
  svc(130, "Waterfall Edge (per side)", "installation", "unit"),
  // Cutouts
  svc(200, "Undermount Sink Cutout", "installation", "unit", "Polished cutout, sink mounted with clips and silicone."),
  svc(210, "Farmhouse / Apron Sink Cutout", "installation", "unit"),
  svc(220, "Drop-In Sink / Vanity Bowl Cutout", "installation", "unit"),
  svc(230, "Cooktop Cutout", "installation", "unit"),
  svc(240, "Faucet / Accessory Hole", "installation", "unit"),
  svc(250, "Outlet Cutout", "installation", "unit"),
  // Backsplash
  svc(300, "4\" Backsplash", "installation", "linear ft"),
  svc(310, "Full-Height Backsplash", "installation", "sq ft"),
  // Prep & service
  svc(400, "Template Visit", "custom", "unit", "Digital template on site; cabinets set and level, sink and faucet on site."),
  svc(410, "Countertop Tear-Out & Disposal", "custom", "unit"),
  svc(420, "Plumbing Disconnect / Reconnect", "custom", "unit"),
  svc(430, "Support Bracket / Corbel", "custom", "unit", "Overhangs past 10\" (3 cm) or 6\" (2 cm) need support."),
  svc(440, "Return Trip – Site Not Ready", "custom", "unit", "Template or install trip lost because the site was not ready."),
  svc(450, "Seam Upgrade / Extra Seam", "custom", "unit"),
  // Supply
  svc(500, "Slab Material", "supply", "sq ft", "Slab sold separately (customer-selected slab)."),
  svc(510, "Delivery", "supply", "unit"),
];
