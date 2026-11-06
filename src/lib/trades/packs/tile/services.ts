/**
 * Tile pack — default Tabela de Valores catalog (rates start at 0, like Hardwood).
 * Names follow how US tile contractors list their price book: floor and wall SF priced apart,
 * shower components per unit, trims per linear foot, prep adders separate.
 * Research: labs/trades/docs and claude/expansao-novos-oficios.md (typical ranges in the notes).
 * Categories stay within the Tabela de Valor groups (installation / supply / custom).
 */
import type { PackService } from "../../types.js";

const svc = (sortOrder: number, name: string, category: PackService["category"], unit: string, description = ""): PackService => ({
  name,
  category,
  unit,
  description,
  sortOrder,
});

export const TILE_SERVICES: PackService[] = [
  // Floors
  svc(10, "Floor Tile Installation", "installation", "sq ft", "Porcelain / ceramic up to 12x24. Labor only."),
  svc(20, "Large Format Floor Tile (15\"+)", "installation", "sq ft", "Any side 15\" or longer. Needs flatness 1/8\" in 10 ft."),
  svc(30, "Wood-Look Plank Tile", "installation", "sq ft", "8x48 and similar; 1/3 offset max."),
  svc(40, "Mosaic Floor Tile", "installation", "sq ft", "Sheet mosaic."),
  svc(50, "Pattern Adder – Herringbone / Chevron", "installation", "sq ft", "Added to the base floor or wall rate."),
  svc(60, "Pattern Adder – Diagonal", "installation", "sq ft", "Added to the base floor or wall rate."),
  // Walls & backsplash
  svc(100, "Wall Tile Installation", "installation", "sq ft", "Wainscot, accent and tub surround walls."),
  svc(110, "Backsplash Installation", "installation", "sq ft", "Includes outlet cuts."),
  svc(120, "Fireplace Surround / Hearth", "installation", "sq ft"),
  // Showers
  svc(200, "Shower Walls Installation", "installation", "sq ft", "Tile to 72\" above the drain minimum, usually to the ceiling."),
  svc(210, "Shower Floor (Mosaic)", "installation", "sq ft"),
  svc(220, "Shower Pan – Mortar Bed with Liner", "installation", "unit", "Pre-slope, liner, clamping drain. Flood test before tile."),
  svc(230, "Shower Pan – Foam Tray System", "installation", "unit"),
  svc(240, "Linear Drain Installation", "installation", "unit"),
  svc(250, "Shower Niche", "installation", "unit", "Waterproofed; standard 12x24."),
  svc(260, "Shower Bench", "installation", "unit"),
  svc(270, "Shower Curb", "installation", "unit"),
  svc(280, "Shower Waterproofing Membrane", "installation", "sq ft", "Sheet or liquid membrane on walls and floor."),
  svc(290, "Flood Test", "installation", "unit", "Plug the drain, 2\" of water, recorded with photos."),
  // Natural stone (marble, travertine, limestone, slate…)
  svc(150, "Natural Stone Tile Installation", "installation", "sq ft", "Marble, travertine, limestone, slate. 95% mortar coverage; stiffer floor (L/720)."),
  svc(160, "Stone Dry-Lay & Layout Approval", "installation", "unit", "Pieces laid out dry; client approves color, veining and layout before setting."),
  svc(170, "Natural Stone Sealing", "installation", "sq ft", "Penetrating sealer, coats as the stone needs."),
  // Trims
  svc(300, "Metal Edge Profile / Trim", "installation", "linear ft"),
  svc(310, "Bullnose / Pencil Trim", "installation", "linear ft"),
  svc(320, "Tile Base", "installation", "linear ft"),
  svc(330, "Movement Joint / Caulk Line", "installation", "linear ft", "Perimeter and changes of plane."),
  // Prep & demo
  svc(400, "Tile Demo & Haul Away", "custom", "sq ft"),
  svc(410, "Self-Leveling Underlayment", "custom", "sq ft", "Per 1/8\" of depth."),
  svc(420, "Cement Backer Board", "custom", "sq ft"),
  svc(430, "Uncoupling Membrane", "custom", "sq ft"),
  svc(440, "Crack Isolation Membrane", "custom", "sq ft"),
  svc(450, "Heated Floor System Installation", "custom", "sq ft", "Mat or cable; ohm readings before and after tile. Electrician separate."),
  svc(460, "Grout Sealing", "custom", "sq ft"),
  svc(470, "Minimum Charge", "custom", "fixed", "Small jobs and repairs."),
  svc(480, "Return Trip – Site Not Ready", "custom", "unit", "Crew trip lost because the site was not ready for tile."),
  // Supply
  svc(900, "Supply: Tile", "supply", "sq ft"),
  svc(910, "Supply: Setting Materials (Mortar, Grout, Membrane)", "supply", "fixed"),
  svc(920, "Delivery Fee", "supply", "fixed", "Material delivery to job site"),
];
