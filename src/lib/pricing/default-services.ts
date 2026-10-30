/**
 * Default Tabela de Valores catalog for new organizations.
 * Names, categories, units, and descriptions only — all rates start at 0.
 */
import { Prisma } from "@prisma/client";
import { getPack, servicesForTrades, type PackService } from "../trades/index.js";

export type DefaultPricingService = PackService;

/** The catalog lives in the trade packs (src/lib/trades); this is the Hardwood one. */
export const DEFAULT_PRICING_SERVICES: readonly DefaultPricingService[] = getPack("hardwood").services;

type PricingSeedTx = {
  pricingItem: {
    count: (args: { where: { organizationId: string } }) => Promise<number>;
    findMany: (args: {
      where: { organizationId: string };
      select: { name: true; category: true };
    }) => Promise<Array<{ name: string; category: string }>>;
    createMany: (args: { data: Prisma.PricingItemCreateManyInput[] }) => Promise<{ count: number }>;
  };
};

function normKey(name: string, category: string) {
  return `${category.trim().toLowerCase()}::${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * Seed default services (no prices) from the organization's trade packs (default: Hardwood).
 * Skips names already present for the org.
 * @returns number of rows created
 */
export async function seedDefaultPricingServices(
  tx: PricingSeedTx,
  organizationId: string,
  opts: { emptyOnly?: boolean; trades?: unknown } = {},
): Promise<number> {
  const existingCount = await tx.pricingItem.count({ where: { organizationId } });
  if (opts.emptyOnly && existingCount > 0) return 0;

  const existing = await tx.pricingItem.findMany({
    where: { organizationId },
    select: { name: true, category: true },
  });
  const have = new Set(existing.map((r) => normKey(r.name, r.category)));

  const data: Prisma.PricingItemCreateManyInput[] = [];
  for (const s of servicesForTrades(opts.trades)) {
    if (have.has(normKey(s.name, s.category))) continue;
    data.push({
      organizationId,
      name: s.name,
      category: s.category,
      unit: s.unit,
      description: s.description || null,
      notes: s.description || null,
      price: new Prisma.Decimal(0),
      priceMin: new Prisma.Decimal(0),
      priceMax: new Prisma.Decimal(0),
      partnerPrice: null,
      priceParticular: new Prisma.Decimal(0),
      priceBuilder: new Prisma.Decimal(0),
      priceContractor: new Prisma.Decimal(0),
      priceLoja: new Prisma.Decimal(0),
      isVisible: true,
      isLocked: false,
      active: true,
      sortOrder: s.sortOrder,
    });
  }

  if (!data.length) return 0;
  const result = await tx.pricingItem.createMany({ data });
  return result.count;
}
