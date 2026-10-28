/**
 * Prices a builder agreed with each flooring company, per service. When the builder sends a work
 * order to that company, lines without a price get the agreed one, and a different order rate
 * is flagged in the review.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { ActiveMember } from "./accounts.js";
import { BuilderError } from "./accounts.js";

export const PRICE_UNITS = ["sq_ft", "linear_ft", "step", "each", "hour", "fixed"] as const;

const schema = z.object({
  company_id: z.string().uuid(),
  pricing_item_id: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  name: z.string().trim().min(2).max(160),
  unit: z.enum(PRICE_UNITS).optional().default("each"),
  price: z.coerce.number().min(0).max(1_000_000),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

type Row = NonNullable<Awaited<ReturnType<typeof prisma.builderPriceItem.findFirst>>>;
function present(r: Row) {
  return { id: r.id, company_id: r.builderLinkId, pricing_item_id: r.pricingItemId, name: r.name, unit: r.unit, price: Number(r.price), notes: r.notes };
}
export type BuilderPrice = ReturnType<typeof present>;

async function linkOf(accountId: string, linkId: string) {
  const link = await prisma.builderLink.findFirst({ where: { id: linkId, builderAccountId: accountId, status: { in: ["active", "invited"] } } });
  if (!link) throw new BuilderError(404, "Company not found.");
  return link;
}

export async function listPrices(accountId: string, linkId?: string): Promise<BuilderPrice[]> {
  const rows = await prisma.builderPriceItem.findMany({
    where: { builderAccountId: accountId, ...(linkId ? { builderLinkId: linkId } : {}) },
    orderBy: [{ name: "asc" }],
    take: 1000,
  });
  return rows.map(present);
}

export async function savePrice(member: ActiveMember, id: string | null, raw: unknown): Promise<BuilderPrice> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BuilderError(400, "Enter the service name and the price.");
  const d = parsed.data;
  await linkOf(member.builderAccountId, d.company_id);
  const data = {
    builderLinkId: d.company_id,
    pricingItemId: d.pricing_item_id || null,
    name: d.name,
    unit: d.unit,
    price: new Prisma.Decimal(d.price.toFixed(2)),
    notes: d.notes || null,
  };
  if (id) {
    const row = await prisma.builderPriceItem.findFirst({ where: { id, builderAccountId: member.builderAccountId } });
    if (!row) throw new BuilderError(404, "Price not found.");
    return present(await prisma.builderPriceItem.update({ where: { id }, data }));
  }
  const count = await prisma.builderPriceItem.count({ where: { builderAccountId: member.builderAccountId, builderLinkId: d.company_id } });
  if (count >= 500) throw new BuilderError(400, "You can save up to 500 prices per company.");
  return present(await prisma.builderPriceItem.create({ data: { ...data, builderAccountId: member.builderAccountId } }));
}

export async function deletePrice(member: ActiveMember, id: string): Promise<void> {
  const row = await prisma.builderPriceItem.findFirst({ where: { id, builderAccountId: member.builderAccountId } });
  if (!row) throw new BuilderError(404, "Price not found.");
  await prisma.builderPriceItem.delete({ where: { id } });
}

/** Copies every price of one company to another (same services, e.g. a second installer). */
export async function copyPrices(member: ActiveMember, fromLinkId: string, toLinkId: string): Promise<number> {
  await linkOf(member.builderAccountId, fromLinkId);
  await linkOf(member.builderAccountId, toLinkId);
  const src = await prisma.builderPriceItem.findMany({ where: { builderAccountId: member.builderAccountId, builderLinkId: fromLinkId } });
  const have = new Set((await prisma.builderPriceItem.findMany({ where: { builderAccountId: member.builderAccountId, builderLinkId: toLinkId }, select: { name: true } })).map((r) => r.name.toLowerCase()));
  const rows = src.filter((r) => !have.has(r.name.toLowerCase())).map((r) => ({
    builderAccountId: member.builderAccountId, builderLinkId: toLinkId, pricingItemId: null, name: r.name, unit: r.unit, price: r.price, notes: r.notes,
  }));
  if (rows.length) await prisma.builderPriceItem.createMany({ data: rows });
  return rows.length;
}

function norm(t: string): string {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Agreed price for a work-order line: same catalog service first, then the same name. */
export function agreedPriceFor(prices: BuilderPrice[], line: { pricing_item_id?: string | null; service_name?: string | null; description?: string | null }): BuilderPrice | null {
  if (line.pricing_item_id) {
    const byId = prices.find((p) => p.pricing_item_id === line.pricing_item_id);
    if (byId) return byId;
  }
  const names = [line.service_name, line.description].map((n) => norm(n || "")).filter(Boolean);
  return prices.find((p) => names.includes(norm(p.name))) || null;
}
