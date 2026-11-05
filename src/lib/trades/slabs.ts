/**
 * Countertops slab yard: slabs and remnants (leftovers cut from a slab), each with its size, tag and
 * where it sits. A slab is reserved for a job when the customer picks it, then used when it goes to
 * fabrication; what is left over can come back as a remnant for vanities and small tops.
 */
import { z } from "zod";

export const SLAB_KINDS = ["slab", "remnant"] as const;
export const SLAB_MATERIALS = ["quartz", "granite", "quartzite", "marble", "porcelain", "other"] as const;
export const SLAB_FINISHES = ["polished", "honed", "leathered", "other"] as const;
export const SLAB_STATUSES = ["available", "reserved", "used", "scrapped"] as const;
export type SlabStatus = (typeof SLAB_STATUSES)[number];

export const MATERIAL_LABEL: Record<(typeof SLAB_MATERIALS)[number], { "pt-BR": string; "en-US": string }> = {
  quartz: { "pt-BR": "Quartzo", "en-US": "Quartz" },
  granite: { "pt-BR": "Granito", "en-US": "Granite" },
  quartzite: { "pt-BR": "Quartzito", "en-US": "Quartzite" },
  marble: { "pt-BR": "Mármore", "en-US": "Marble" },
  porcelain: { "pt-BR": "Porcelanato", "en-US": "Porcelain" },
  other: { "pt-BR": "Outro", "en-US": "Other" },
};

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === "" ? null : v));
/** Inches, up to a jumbo slab (about 136" × 80") with room to spare. */
const inches = z.coerce.number().positive().max(200);

export const slabFields = {
  kind: z.enum(SLAB_KINDS).optional(),
  material: z.enum(SLAB_MATERIALS),
  color: text(80).min(1),
  brand: optText(80),
  finish: z.enum(SLAB_FINISHES).nullable().optional(),
  thickness_cm: z.coerce.number().int().refine((v) => v === 2 || v === 3, "2 ou 3 cm").optional(),
  length_in: inches,
  width_in: inches,
  serial: optText(80),
  supplier: optText(80),
  location: optText(60),
  cost: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  notes: optText(1000),
};

export const createSlabSchema = z.object(slabFields);
export const updateSlabSchema = z
  .object({
    ...slabFields,
    material: slabFields.material.optional(),
    color: slabFields.color.optional(),
    length_in: inches.optional(),
    width_in: inches.optional(),
    /** Only these two by hand; reserve / release / use have their own routes. */
    status: z.enum(["available", "scrapped"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nada para mudar");

/** Square feet of a slab (length × width in inches). */
export function slabSf(lengthIn: number, widthIn: number): number {
  return Math.round(((lengthIn * widthIn) / 144) * 10) / 10;
}

/** Whether a piece of `needL` × `needW` inches fits on the slab, turned either way. */
export function slabFits(slab: { lengthIn: number; widthIn: number }, needL: number, needW: number): boolean {
  const [a, b] = [Math.max(slab.lengthIn, slab.widthIn), Math.min(slab.lengthIn, slab.widthIn)];
  const [x, y] = [Math.max(needL, needW), Math.min(needL, needW)];
  return a >= x && b >= y;
}

/** "120x30", "120 x 30", "120×30" → [120, 30]. */
export function parseFits(raw: unknown): [number, number] | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(raw ?? ""));
  if (!m) return null;
  const l = Number(m[1]);
  const w = Number(m[2]);
  return l > 0 && w > 0 ? [l, w] : null;
}

type SlabRow = {
  id: string;
  kind: string;
  material: string;
  color: string;
  brand: string | null;
  finish: string | null;
  thicknessCm: number;
  lengthIn: unknown;
  widthIn: unknown;
  serial: string | null;
  supplier: string | null;
  location: string | null;
  cost: unknown;
  status: string;
  workOrderId: string | null;
  reservedAt: Date | null;
  usedAt: Date | null;
  parentId: string | null;
  photoUrl: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  workOrder?: { id: string; number: number | null; title: string | null; customer?: { name: string | null } | null } | null;
};

/** API shape of a slab; the cost only for people who see prices. */
export function mapSlab(row: SlabRow, showCost: boolean) {
  const lengthIn = Number(row.lengthIn);
  const widthIn = Number(row.widthIn);
  const mat = MATERIAL_LABEL[row.material as keyof typeof MATERIAL_LABEL] ?? MATERIAL_LABEL.other;
  return {
    id: row.id,
    kind: row.kind,
    material: row.material,
    material_label: mat["pt-BR"],
    color: row.color,
    brand: row.brand,
    finish: row.finish,
    thickness_cm: row.thicknessCm,
    length_in: lengthIn,
    width_in: widthIn,
    sq_ft: slabSf(lengthIn, widthIn),
    serial: row.serial,
    supplier: row.supplier,
    location: row.location,
    ...(showCost ? { cost: row.cost == null ? null : Number(row.cost) } : {}),
    status: row.status,
    job: row.workOrder
      ? { id: row.workOrder.id, number: row.workOrder.number, title: row.workOrder.title, customer: row.workOrder.customer?.name ?? null }
      : row.workOrderId
        ? { id: row.workOrderId, number: null, title: null, customer: null }
        : null,
    reserved_at: row.reservedAt?.toISOString() ?? null,
    used_at: row.usedAt?.toISOString() ?? null,
    parent_id: row.parentId,
    photo_url: row.photoUrl,
    notes: row.notes,
    created_by_name: row.createdByName,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Totals for the yard header: what is free to sell, and what is held for jobs. */
export function yardSummary(rows: readonly { kind: string; status: string; lengthIn: unknown; widthIn: unknown }[]) {
  const sum = (f: (r: (typeof rows)[number]) => boolean) =>
    rows.filter(f).reduce((a, r) => ({ n: a.n + 1, sf: Math.round((a.sf + slabSf(Number(r.lengthIn), Number(r.widthIn))) * 10) / 10 }), { n: 0, sf: 0 });
  return {
    available_slabs: sum((r) => r.kind === "slab" && r.status === "available"),
    available_remnants: sum((r) => r.kind === "remnant" && r.status === "available"),
    reserved: sum((r) => r.status === "reserved"),
  };
}
