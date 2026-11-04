/**
 * ObraCam stickers: photo labels a company defines (Samples, Delivery, Scan…).
 * A photo keeps the ids in JobMedia.stickerIds; "samples" is a system sticker the stain flow applies itself.
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";

type Tx = TenantPrisma;

/** Badge colours, all dark enough for white text (WCAG AA at 12px semibold). */
export const STICKER_COLORS = ["#B4561A", "#1D6FB8", "#2F7D4F", "#7A4BC2", "#B42318", "#8A6A00", "#0F766E", "#475467"] as const;

export const SAMPLES_KEY = "samples";

const DEFAULTS: { key: string; name: string; color: string }[] = [
  { key: SAMPLES_KEY, name: "Samples", color: "#7A4BC2" },
  { key: "delivery", name: "Delivery", color: "#1D6FB8" },
  { key: "scan", name: "Scan", color: "#0F766E" },
];

export type StickerRow = { id: string; key: string | null; name: string; color: string; sortOrder: number; archivedAt: Date | null };

export function mapSticker(s: StickerRow) {
  return { id: s.id, key: s.key, name: s.name, color: s.color, sort_order: s.sortOrder, archived: Boolean(s.archivedAt), system: s.key === SAMPLES_KEY };
}

export function isStickerColor(c: unknown): c is string {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
}

/**
 * First time a company opens stickers: create the defaults and tag its existing stain sample photos
 * with Samples. Runs inside the tenant transaction, so row-level security scopes every write.
 */
export async function ensureStickers(tx: Tx, organizationId: string): Promise<StickerRow[]> {
  // Row-level security already scopes this to the company; the explicit filter keeps privileged connections honest too.
  let rows = await tx.mediaSticker.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  if (!rows.length) {
    await tx.mediaSticker.createMany({
      data: DEFAULTS.map((d, i) => ({ organizationId, key: d.key, name: d.name, color: d.color, sortOrder: i })),
      skipDuplicates: true,
    });
    rows = await tx.mediaSticker.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const samples = rows.find((r) => r.key === SAMPLES_KEY);
    if (samples) {
      await tx.$executeRaw`UPDATE "JobMedia" SET "stickerIds" = array_append("stickerIds", ${samples.id}::uuid)
        WHERE "organizationId" = ${organizationId}::uuid AND ("caption" LIKE 'Stain sample #%' OR "caption" LIKE 'Stain samples ·%') AND NOT (${samples.id}::uuid = ANY("stickerIds"))`;
    }
  }
  return rows;
}

export async function samplesStickerId(tx: Tx, organizationId: string): Promise<string | null> {
  const rows = await ensureStickers(tx, organizationId);
  const s = rows.find((r) => r.key === SAMPLES_KEY && !r.archivedAt);
  return s ? s.id : null;
}

/** Keep only ids of this company's active stickers, de-duplicated, in the order given. */
export async function cleanStickerIds(tx: Tx, organizationId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || !ids.length) return [];
  const want = [...new Set(ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 12);
  if (!want.length) return [];
  await ensureStickers(tx, organizationId);
  const ok = await tx.mediaSticker.findMany({ where: { organizationId, id: { in: want }, archivedAt: null }, select: { id: true } });
  const set = new Set(ok.map((r) => r.id));
  return want.filter((id) => set.has(id));
}
