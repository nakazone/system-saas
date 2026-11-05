/**
 * The Mate reads a slab's tag from a photo (supplier sticker or stencil on the edge): stone, color,
 * brand, size, thickness, lot / serial and supplier. Nothing is saved; the office checks the form.
 * Sizes come back in inches; anything the tag does not show stays empty.
 */
import { z } from "zod";
import { aiChatJson } from "../ai/client.js";
import { SLAB_FINISHES, SLAB_MATERIALS } from "./slabs.js";

export const SLAB_TAG_PROMPT = `You read the tag of a countertop slab (quartz, granite, quartzite, marble, porcelain) in a stone yard photo.
The tag may be a supplier sticker, a printed label, a stencil or handwriting on the slab edge.
Return JSON only:
{"material": one of ${SLAB_MATERIALS.join(" | ")} or null,
 "color": the color / product name exactly as printed (e.g. "Calacatta Laza") or null,
 "brand": the brand or manufacturer (MSI, Cambria, Caesarstone, Silestone…) or null,
 "finish": one of ${SLAB_FINISHES.join(" | ")} or null,
 "thickness_cm": 2 or 3 or null,
 "length_in": number or null, "width_in": number or null,
 "serial": the lot, bundle, block or serial number as printed or null,
 "supplier": the distributor / yard name if it differs from the brand or null,
 "notes": anything else printed that matters (grade, "seconds", bundle position) or null}
Rules:
- Sizes in inches. Convert: cm ÷ 2.54, mm ÷ 25.4; "126x63" with no unit on a US tag is inches. Length is the longer side.
- Thickness: 3cm, 30mm or 1 1/4" → 3; 2cm, 20mm or 3/4" → 2.
- Quartz brands (MSI Q, Cambria, Caesarstone, Silestone, Viatera, Hanstone) → material quartz unless the tag says otherwise.
- Never guess: a field you cannot read stays null. Do not invent a lot number.`;

const num = z.union([z.number(), z.string()]).nullable().optional();
const str = z.string().nullable().optional();

export const slabTagSchema = z.object({
  material: str,
  color: str,
  brand: str,
  finish: str,
  thickness_cm: num,
  length_in: num,
  width_in: num,
  serial: str,
  supplier: str,
  notes: str,
});

export type SlabTag = {
  material: (typeof SLAB_MATERIALS)[number] | null;
  color: string | null;
  brand: string | null;
  finish: (typeof SLAB_FINISHES)[number] | null;
  thickness_cm: 2 | 3 | null;
  length_in: number | null;
  width_in: number | null;
  serial: string | null;
  supplier: string | null;
  notes: string | null;
};

const clean = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s && !/^(null|n\/a|unknown|-)$/i.test(s) ? s.slice(0, max) : null;
};
const inches = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 6 && n <= 200 ? Math.round(n * 4) / 4 : null;
};

/** What the model said, kept only where it makes sense (known stone, sizes in range, length ≥ width). */
export function cleanSlabTag(raw: unknown): SlabTag {
  const p = slabTagSchema.safeParse(raw ?? {});
  const d = p.success ? p.data : {};
  const mat = clean(d.material, 20)?.toLowerCase();
  const fin = clean(d.finish, 20)?.toLowerCase();
  const th = Number(d.thickness_cm);
  let l = inches(d.length_in);
  let w = inches(d.width_in);
  if (l != null && w != null && w > l) [l, w] = [w, l];
  return {
    material: (SLAB_MATERIALS as readonly string[]).includes(mat ?? "") ? (mat as SlabTag["material"]) : null,
    color: clean(d.color, 80),
    brand: clean(d.brand, 80),
    finish: (SLAB_FINISHES as readonly string[]).includes(fin ?? "") ? (fin as SlabTag["finish"]) : null,
    thickness_cm: th === 2 || th === 3 ? th : null,
    length_in: l,
    width_in: w,
    serial: clean(d.serial, 80),
    supplier: clean(d.supplier, 80),
    notes: clean(d.notes, 300),
  };
}

export async function readSlabTag(dataUrl: string): Promise<{ ok: true; tag: SlabTag } | { ok: false; error: string }> {
  const r = await aiChatJson({
    system: SLAB_TAG_PROMPT,
    user: "Read this slab tag.",
    imageUrls: [dataUrl],
    imageDetail: "high",
    temperature: 0,
    timeoutMs: 45_000,
  });
  if (!r.ok) return { ok: false, error: r.error };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(r.text);
  } catch {
    return { ok: false, error: "Não deu para ler a etiqueta." };
  }
  return { ok: true, tag: cleanSlabTag(parsed) };
}
