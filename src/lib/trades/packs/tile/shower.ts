/**
 * Shower builder (Tile): a shower described by a few dimensions — shape, width, depth, tiled height,
 * niches, bench, curb — and the quantities it takes: wall and floor tile, waterproofing, trim, curb,
 * pan / niche / bench counts. Used by the ObraBuilder measurement (Showers tab) and, later, quotes.
 *
 * Inches in, square feet / linear feet out. Rules (estimates to confirm with the pilots):
 * - Walls: width × tiled height of each wall; niche returns (4 sides × depth) are added, the niche
 *   back replaces the wall it is cut from; the bench front and the curb (top + 2 faces) are tiled
 *   with the walls.
 * - Floor: width × depth minus the bench footprint.
 * - Waterproofing: walls + whole floor + curb + niche returns + bench (front and top).
 * - Trim: open vertical edges (2 for alcove/walk-in, 1 for corner) + niche frames.
 * - Waste: 10% straight-set, 12% when the long side ≥ 24", 18% herringbone; floor 15% (mosaic cuts).
 */
import { z } from "zod";

export const SHOWER_SHAPES = ["alcove", "corner", "walkin"] as const;
export type ShowerShape = (typeof SHOWER_SHAPES)[number];
export const SHOWER_WALLS = ["left", "back", "right"] as const;
export type ShowerWall = (typeof SHOWER_WALLS)[number];

export const SHAPE_INFO: Record<ShowerShape, { label: string; walls: readonly ShowerWall[]; openEdges: number; curb: boolean }> = {
  alcove: { label: "Alcove", walls: ["left", "back", "right"], openEdges: 2, curb: true },
  corner: { label: "Corner", walls: ["back", "right"], openEdges: 1, curb: true },
  walkin: { label: "Walk-in", walls: ["left", "back", "right"], openEdges: 2, curb: false },
};

const inch = (max: number, def: number) => z.number().min(0).max(max).optional().default(def);
const text = (max: number) => z.string().trim().max(max).optional().default("");

export const showerSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: text(80),
  shape: z.enum(SHOWER_SHAPES).optional().default("alcove"),
  width: inch(240, 60),
  depth: inch(240, 36),
  /** Tiled height (IRC: at least 72" above the drain). */
  height: inch(144, 96),
  niches: z.number().int().min(0).max(6).optional().default(0),
  niche_w: inch(60, 12),
  niche_h: inch(60, 24),
  niche_d: inch(12, 3.5),
  niche_wall: z.enum(SHOWER_WALLS).optional().default("back"),
  bench: z.boolean().optional().default(false),
  bench_l: inch(120, 36),
  bench_d: inch(36, 16),
  bench_h: inch(30, 18),
  bench_wall: z.enum(SHOWER_WALLS).optional().default("left"),
  curb: z.boolean().optional().default(true),
  door: z.enum(["left", "right", "center", "none"]).optional().default("right"),
  pan: z.enum(["mortar", "foam", "prefab"]).optional().default("mortar"),
  drain: z.enum(["center", "linear"]).optional().default("center"),
  wall_tile: text(80),
  /** Long side of the wall tile, inches (drives the waste). */
  tile_long: inch(96, 24),
  pattern: z.enum(["stacked", "offset", "herringbone"]).optional().default("stacked"),
  floor_tile: text(80),
  note: text(500),
});
export type Shower = z.infer<typeof showerSchema>;

const sf = (in2: number) => in2 / 144;
const r1 = (n: number) => Math.round(n * 10) / 10;
const CURB_FACES = 4.5 + 4 + 4.5; // top + inside + outside, inches

export function wallsOf(s: Shower): { key: ShowerWall; label: string; width: number; height: number }[] {
  return SHAPE_INFO[s.shape].walls.map((k) => ({ key: k, label: k === "back" ? "Back wall" : k === "left" ? "Left wall" : "Right wall", width: k === "back" ? s.width : s.depth, height: s.height }));
}

export function hasCurb(s: Shower): boolean {
  return SHAPE_INFO[s.shape].curb && s.curb;
}

export type ShowerQuantities = {
  walls: { key: ShowerWall; label: string; width: number; height: number; sf: number }[];
  wall_sf: number;
  floor_sf: number;
  bench_top_sf: number;
  waterproofing_sf: number;
  trim_lf: number;
  curb_lf: number;
  pan: number;
  niches: number;
  bench: number;
  waste: number;
  order_wall_sf: number;
  order_floor_sf: number;
};

export function showerQuantities(s: Shower): ShowerQuantities {
  const walls = wallsOf(s);
  const wallIn2 = walls.reduce((a, w) => a + w.width * w.height, 0);
  const nicheReturns = s.niches * 2 * (s.niche_w + s.niche_h) * s.niche_d;
  const benchFront = s.bench ? s.bench_l * s.bench_h : 0;
  const benchTop = s.bench ? s.bench_l * s.bench_d : 0;
  const curbIn = hasCurb(s) ? s.width : 0;
  const curbIn2 = curbIn * CURB_FACES;
  const floorIn2 = Math.max(0, s.width * s.depth - benchTop);
  const wall = sf(wallIn2 + nicheReturns + benchFront + curbIn2);
  const floor = sf(floorIn2);
  const waste = s.pattern === "herringbone" ? 0.18 : s.tile_long >= 24 ? 0.12 : 0.1;
  const trimIn = SHAPE_INFO[s.shape].openEdges * s.height + s.niches * 2 * (s.niche_w + s.niche_h);
  return {
    walls: walls.map((w) => ({ ...w, sf: r1(sf(w.width * w.height)) })),
    wall_sf: r1(wall),
    floor_sf: r1(floor),
    bench_top_sf: r1(sf(benchTop)),
    waterproofing_sf: r1(sf(wallIn2 + s.width * s.depth + curbIn2 + nicheReturns + benchFront + benchTop)),
    trim_lf: r1(trimIn / 12),
    curb_lf: r1(curbIn / 12),
    pan: s.pan === "prefab" ? 0 : 1,
    niches: s.niches,
    bench: s.bench ? 1 : 0,
    waste,
    order_wall_sf: Math.ceil(wall * (1 + waste)),
    order_floor_sf: Math.ceil(floor * 1.15),
  };
}

const PAN_LABEL: Record<Shower["pan"], string> = { mortar: "mortar bed pan", foam: "foam pan", prefab: "prefab base" };

/** Lines for the measurement summary, the work order and the PDF (English, like the rest of the portal). */
export function showerSummaryLines(s: Shower): { kind: "shower"; text: string; qty: number; uom: "SF" | "LF" | "EA" }[] {
  const q = showerQuantities(s);
  const name = s.name || "Shower";
  const shape = `${SHAPE_INFO[s.shape].label} ${s.width}" × ${s.depth}" × ${s.height}"`;
  const out: { kind: "shower"; text: string; qty: number; uom: "SF" | "LF" | "EA" }[] = [
    { kind: "shower", qty: q.wall_sf, uom: "SF", text: `${name} · Wall tile${s.wall_tile ? ` ${s.wall_tile}` : ""} · ${shape} · order ${q.order_wall_sf} SF` },
    { kind: "shower", qty: q.floor_sf, uom: "SF", text: `${name} · Floor tile${s.floor_tile ? ` ${s.floor_tile}` : ""} · order ${q.order_floor_sf} SF` },
    { kind: "shower", qty: q.waterproofing_sf, uom: "SF", text: `${name} · Waterproofing (walls, floor, curb${s.niches ? ", niche" : ""}${s.bench ? ", bench" : ""})` },
    { kind: "shower", qty: q.trim_lf, uom: "LF", text: `${name} · Trim / edge` },
  ];
  if (q.curb_lf) out.push({ kind: "shower", qty: q.curb_lf, uom: "LF", text: `${name} · Curb` });
  if (q.pan) out.push({ kind: "shower", qty: 1, uom: "EA", text: `${name} · Shower pan · ${PAN_LABEL[s.pan]} · ${s.drain === "linear" ? "linear drain" : "center drain"}` });
  if (q.niches) out.push({ kind: "shower", qty: q.niches, uom: "EA", text: `${name} · Niche ${s.niche_w}" × ${s.niche_h}" · ${s.niche_wall} wall` });
  if (q.bench) out.push({ kind: "shower", qty: 1, uom: "EA", text: `${name} · Bench ${s.bench_l}" × ${s.bench_d}" · ${s.bench_wall} wall` });
  return out;
}
