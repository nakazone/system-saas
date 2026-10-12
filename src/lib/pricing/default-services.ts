/**
 * Default Tabela de Valores catalog for new organizations.
 * Names, categories, units, and descriptions only — all rates start at 0.
 */
import { Prisma } from "@prisma/client";

export type DefaultPricingService = {
  name: string;
  category: "installation" | "sand_finish" | "supply" | "custom";
  unit: string;
  description: string;
  sortOrder: number;
};

export const DEFAULT_PRICING_SERVICES: DefaultPricingService[] = [
  {
    name: "Hardwood - Nail Down",
    category: "installation",
    unit: "sq ft",
    description: "Hardwood installation, nail-down labor.",
    sortOrder: 10,
  },
  {
    name: "Hardwood - Glue & Nail Down",
    category: "installation",
    unit: "sq ft",
    description: "Hardwood installation with glue assist / full-spread glue plus nail-down.",
    sortOrder: 20,
  },
  {
    name: "Herringbone - Chevron",
    category: "installation",
    unit: "sq ft",
    description: "Create herringbone or chevron pattern on site with hardwood flooring.",
    sortOrder: 30,
  },
  {
    name: "Random Pattern",
    category: "installation",
    unit: "sq ft",
    description: "Hardwood installation in a random-width or mixed pattern.",
    sortOrder: 40,
  },
  {
    name: "LVP - Laminate",
    category: "installation",
    unit: "sq ft",
    description: "Luxury vinyl plank or laminate installation (labor).",
    sortOrder: 50,
  },
  {
    name: "Underlayment",
    category: "installation",
    unit: "sq ft",
    description: "Moisture-control underlayment (e.g. black paper or plastic).",
    sortOrder: 60,
  },
  {
    name: "Open Stair",
    category: "installation",
    unit: "step",
    description: "Open stair tread and riser installation.",
    sortOrder: 70,
  },
  {
    name: "Box Stair",
    category: "installation",
    unit: "step ft",
    description: "Boxed stair installation (treads & risers).",
    sortOrder: 80,
  },
  {
    name: "Vents",
    category: "installation",
    unit: "unit",
    description: "Supply and install flush-mount wood vents.",
    sortOrder: 90,
  },
  {
    name: "Plywood",
    category: "installation",
    unit: "sq ft",
    description: "Plywood subfloor installation (labor).",
    sortOrder: 100,
  },
  {
    name: "Sand & Finish - Natural Clear",
    category: "sand_finish",
    unit: "sq ft",
    description:
      "Refinishing with water-based polyurethane; natural clear coat (stain not included).",
    sortOrder: 200,
  },
  {
    name: "Add On: Stain",
    category: "sand_finish",
    unit: "sq ft",
    description: "Staining the floor with any color (add-on to sand & finish).",
    sortOrder: 210,
  },
  {
    name: "Add On: High Traffic Extra Coat",
    category: "sand_finish",
    unit: "sq ft",
    description:
      "Extra water-based wear coat for high-traffic areas, kids, pets, or commercial cleaning.",
    sortOrder: 220,
  },
  {
    name: "Treads & Risers",
    category: "sand_finish",
    unit: "step",
    description: "Sand and finish stair treads and risers (natural clear or stain).",
    sortOrder: 230,
  },
  {
    name: "Herringbone - Chevron",
    category: "sand_finish",
    unit: "sq ft",
    description: "Sand and finish herringbone or chevron patterned floors.",
    sortOrder: 240,
  },
  {
    name: "Hardwood - R/O & W/O - Select / #1",
    category: "supply",
    unit: "sq ft",
    description: "Supply hardwood (red oak / white oak, select / #1 grade).",
    sortOrder: 300,
  },
  {
    name: "Vents",
    category: "supply",
    unit: "unit",
    description: "Supply wood flush-mount vents.",
    sortOrder: 310,
  },
  {
    name: "Nosing",
    category: "supply",
    unit: "linear ft",
    description: "Supply stair or floor nosing.",
    sortOrder: 320,
  },
  {
    name: "Tread & Risers",
    category: "supply",
    unit: "step",
    description: "Supply solid oak treads and oak or primed pine risers.",
    sortOrder: 330,
  },
];

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
 * Seed default services (no prices). Skips names already present for the org.
 * @returns number of rows created
 */
export async function seedDefaultPricingServices(
  tx: PricingSeedTx,
  organizationId: string,
  opts: { emptyOnly?: boolean } = {},
): Promise<number> {
  const existingCount = await tx.pricingItem.count({ where: { organizationId } });
  if (opts.emptyOnly && existingCount > 0) return 0;

  const existing = await tx.pricingItem.findMany({
    where: { organizationId },
    select: { name: true, category: true },
  });
  const have = new Set(existing.map((r) => normKey(r.name, r.category)));

  const data: Prisma.PricingItemCreateManyInput[] = [];
  for (const s of DEFAULT_PRICING_SERVICES) {
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
