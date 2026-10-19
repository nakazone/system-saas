import type { TenantPrisma } from "../../tenant/prisma-tenant.js";
import { matchPricingService, mergeMateAiCatalog, normalizeMateAiUnit, type MateAiCatalogItem } from "../command.js";
import { canonicalServiceText, rankCatalogForSpeech } from "../local.js";

/** Same merged catalog the Quote Builder uses (Quote Catalog first, then Pricing table). */
export async function loadMateAiCatalog(tx: TenantPrisma, organizationId: string): Promise<MateAiCatalogItem[]> {
  const [quoteCatalogRows, pricingRows] = await Promise.all([
    tx.quoteCatalogItem.findMany({
      where: { organizationId, active: true },
      select: { id: true, name: true, serviceType: true, unitType: true, unitPrice: true, description: true, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    tx.pricingItem.findMany({
      where: { organizationId, active: true, isVisible: true },
      select: {
        id: true, name: true, category: true, unit: true, price: true, priceMin: true, priceMax: true, partnerPrice: true,
        priceParticular: true, priceBuilder: true, priceContractor: true, priceLoja: true, notes: true, description: true,
        active: true, isVisible: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  return mergeMateAiCatalog(quoteCatalogRows, pricingRows);
}

export type ServicePick =
  | { status: "ok"; item: MateAiCatalogItem }
  | { status: "choose"; options: MateAiCatalogItem[] };

/** Catalog item for a spoken line: the model's pick, then exact/lexical, then ranked guesses. */
export function pickService(
  catalog: MateAiCatalogItem[],
  spec: { catalog_item_id?: unknown; catalog_source?: unknown; service_text?: unknown; unit?: unknown },
): ServicePick {
  const id = String(spec.catalog_item_id || "");
  if (id) {
    const hit = catalog.find((c) => c.id === id && (!spec.catalog_source || c.source === spec.catalog_source));
    if (hit) return { status: "ok", item: hit };
  }
  const text = String(spec.service_text || "").trim();
  const unit = normalizeMateAiUnit(String(spec.unit || "")) as "sq_ft" | null;
  if (text && unit) {
    const lexical = matchPricingService(text, unit, catalog);
    if (lexical.status === "matched") return { status: "ok", item: lexical.item };
  }
  const ranked = rankCatalogForSpeech(text, catalog, unit as never);
  const top = ranked[0];
  const second = ranked[1];
  if (top && top.score >= 55 && (!second || top.score - second.score >= 6)) return { status: "ok", item: top.item };
  const options = ranked.length ? ranked.slice(0, 6).map((r) => r.item) : catalog.filter((c) => canonicalServiceText(c.name).includes(canonicalServiceText(text))).slice(0, 6);
  return { status: "choose", options };
}

/** Quote Builder unit_type values. */
export function builderUnit(unit: string): string {
  const u = normalizeMateAiUnit(unit) || unit;
  if (u === "sq_ft" || u === "linear_ft" || u === "box" || u === "fixed") return u;
  if (u === "each" || u === "step") return "piece";
  return "fixed";
}
