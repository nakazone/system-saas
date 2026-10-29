/**
 * Floor plan takeoff: the builder uploads the house plans (PDF or photo), the app reads the
 * flooring legend colors, the scale and the rooms (in the browser, see partner-portal-takeoff.js)
 * and saves the result here — square feet per material, per level and per room, plus a coarse
 * grid of the floors for the 3D view. Waste % per material lives on the builder account.
 */
import { z } from "zod";

/** What kind of floor a legend entry is — drives waste, services and the 3D finish. */
export const FLOOR_KINDS = ["hardwood", "lvp", "laminate", "carpet", "rubber", "tile", "stone", "other"] as const;
export type FloorKind = (typeof FLOOR_KINDS)[number];

/** Only these are flooring jobs for now (tile, stone, shower pans, countertops stay out). */
export const FLOORING_KINDS: FloorKind[] = ["hardwood", "lvp", "laminate", "carpet", "rubber"];

export const KIND_LABEL: Record<FloorKind, string> = {
  hardwood: "Hardwood",
  lvp: "LVP",
  laminate: "Laminate",
  carpet: "Carpet",
  rubber: "Rubber floor",
  tile: "Tile",
  stone: "Stone",
  other: "Other",
};

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/);
const key = z.string().trim().min(1).max(40);

const materialSchema = z.object({
  key,
  label: z.string().trim().max(60),
  color: hex,
  kind: z.enum(FLOOR_KINDS).optional().default("other"),
  include: z.boolean().optional().default(false),
  /** Hardwood: also sand & finish on site (unfinished boards). */
  sand_finish: z.boolean().optional().default(false),
});

const roomSchema = z.object({
  id: key,
  name: z.string().trim().max(60),
  material: key,
  area_sf: z.number().min(0).max(100000),
  /** Label position in feet from the level's grid origin (for the 3D view and the plan overlay). */
  x: z.number().min(-10000).max(10000).optional().default(0),
  y: z.number().min(-10000).max(10000).optional().default(0),
  exclude: z.boolean().optional().default(false),
});

const gridSchema = z.object({
  w: z.number().int().min(1).max(1200),
  h: z.number().int().min(1).max(1200),
  /** Feet per cell. */
  cell: z.number().min(0.1).max(5),
  /** Run-length encoded material index per cell, row by row: "0x120,2x35,..." (0 = no floor). */
  rle: z.string().max(400000),
});

const levelSchema = z.object({
  id: key,
  page: z.number().int().min(1).max(200),
  name: z.string().trim().max(60),
  /** PDF points (1/72 in) per real foot, as drawn on this sheet. */
  scale_ppf: z.number().min(0.05).max(500),
  scale_auto: z.boolean().optional().default(true),
  include: z.boolean().optional().default(true),
  /** Stacking order in 3D (0 = lowest). */
  floor: z.number().int().min(-5).max(20).optional().default(0),
  rooms: z.array(roomSchema).max(300).optional().default([]),
  grid: gridSchema.nullable().optional().default(null),
  /** Small preview of the sheet (stored file key). */
  preview: z.string().trim().max(300).nullable().optional().default(null),
});

export const planSchema = z.object({
  file: z.object({
    key: z.string().trim().max(300),
    name: z.string().trim().max(200),
    type: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    pages: z.number().int().min(1).max(200).optional().default(1),
    size: z.number().int().min(0).optional().default(0),
  }).nullable().optional().default(null),
  materials: z.array(materialSchema).max(24).optional().default([]),
  levels: z.array(levelSchema).max(12).optional().default([]),
  analyzed_at: z.string().max(40).nullable().optional().default(null),
  /** Price list company the quote uses (builder link id). */
  quote_link_id: z.string().uuid().nullable().optional().default(null),
  /** Chosen price item per service line: { "hardwood:install": "<price item id>" }. */
  quote_prices: z.record(z.string().max(60), z.string().uuid()).optional().default({}),
});
export type Plan = z.infer<typeof planSchema>;

/* ───────────────────────────── settings (waste) ───────────────────────────── */

export const DEFAULT_WASTE: Record<FloorKind, number> = { hardwood: 10, lvp: 10, laminate: 10, carpet: 12, rubber: 8, tile: 12, stone: 12, other: 10 };

const settingsSchema = z.object({
  waste: z.record(z.string().max(20), z.number().min(0).max(50)).optional().default({}),
  /** Round material up to whole boxes when the box coverage is known. */
  box_sf: z.record(z.string().max(20), z.number().min(0).max(500)).optional().default({}),
});
export type TakeoffSettings = { waste: Record<FloorKind, number>; box_sf: Partial<Record<FloorKind, number>> };

export function takeoffSettings(raw: unknown): TakeoffSettings {
  const parsed = settingsSchema.safeParse(raw ?? {});
  const s = parsed.success ? parsed.data : { waste: {}, box_sf: {} };
  const pick = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).filter(([k]) => (FLOOR_KINDS as readonly string[]).includes(k)));
  return { waste: { ...DEFAULT_WASTE, ...pick(s.waste) } as Record<FloorKind, number>, box_sf: pick(s.box_sf) as Partial<Record<FloorKind, number>> };
}

export function parseTakeoffSettings(raw: unknown): TakeoffSettings | null {
  const parsed = settingsSchema.safeParse(raw ?? {});
  if (!parsed.success) return null;
  return takeoffSettings(parsed.data);
}

/* ───────────────────────────── totals ───────────────────────────── */

export type PlanTotal = { key: string; label: string; kind: FloorKind; include: boolean; sand_finish: boolean; area_sf: number; levels: Array<{ name: string; area_sf: number }> };

export function planTotals(plan: Plan | null | undefined): PlanTotal[] {
  if (!plan) return [];
  const out = new Map<string, PlanTotal>();
  for (const m of plan.materials) out.set(m.key, { key: m.key, label: m.label || KIND_LABEL[m.kind], kind: m.kind, include: m.include, sand_finish: m.sand_finish, area_sf: 0, levels: [] });
  for (const level of plan.levels) {
    if (!level.include) continue;
    for (const room of level.rooms) {
      if (room.exclude) continue;
      const t = out.get(room.material);
      if (!t) continue;
      t.area_sf += room.area_sf;
      const lv = t.levels.find((l) => l.name === level.name);
      if (lv) lv.area_sf += room.area_sf;
      else t.levels.push({ name: level.name, area_sf: room.area_sf });
    }
  }
  return [...out.values()].filter((t) => t.area_sf > 0).sort((a, b) => Number(b.include) - Number(a.include) || b.area_sf - a.area_sf);
}

export function withWaste(area: number, wastePct: number): number {
  return Math.ceil(area * (1 + wastePct / 100));
}

export function fmtSf(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} SF`;
}
