/**
 * Pickup locations of a builder account: supplier yards and warehouses where crews collect
 * delivered material. A work order that names the supplier ("TRIWEST 9176215") is linked to
 * the saved location, so the job shows the full address and the order number.
 */
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { ActiveMember } from "./accounts.js";
import { BuilderError } from "./accounts.js";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(4).max(300),
  aliases: z.array(z.string().trim().min(2).max(40)).max(12).optional().default([]),
  phone: z.string().trim().max(40).optional().default(""),
  hours: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
  is_default: z.boolean().optional().default(false),
});

type Row = Awaited<ReturnType<typeof prisma.builderPickupLocation.findFirst>>;

function present(r: NonNullable<Row>) {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    aliases: r.aliases,
    phone: r.phone,
    hours: r.hours,
    notes: r.notes,
    is_default: r.isDefault,
  };
}
export type PickupLocation = ReturnType<typeof present>;

export async function listPickups(accountId: string): Promise<PickupLocation[]> {
  const rows = await prisma.builderPickupLocation.findMany({ where: { builderAccountId: accountId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], take: 100 });
  return rows.map(present);
}

function cleanAliases(list: string[], name: string): string[] {
  const all = [...list, name].map((a) => a.trim()).filter(Boolean);
  const seen = new Set<string>();
  return all.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
}

export async function savePickup(member: ActiveMember, id: string | null, raw: unknown): Promise<PickupLocation> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BuilderError(400, "Enter a name and the address of the pickup location.");
  const d = parsed.data;
  const data = {
    name: d.name,
    address: d.address,
    aliases: cleanAliases(d.aliases, d.name),
    phone: d.phone || null,
    hours: d.hours || null,
    notes: d.notes || null,
    isDefault: d.is_default,
  };
  if (d.is_default) await prisma.builderPickupLocation.updateMany({ where: { builderAccountId: member.builderAccountId }, data: { isDefault: false } });
  if (id) {
    const row = await prisma.builderPickupLocation.findFirst({ where: { id, builderAccountId: member.builderAccountId } });
    if (!row) throw new BuilderError(404, "Pickup location not found.");
    return present(await prisma.builderPickupLocation.update({ where: { id }, data }));
  }
  const count = await prisma.builderPickupLocation.count({ where: { builderAccountId: member.builderAccountId } });
  if (count >= 100) throw new BuilderError(400, "You can save up to 100 pickup locations.");
  return present(await prisma.builderPickupLocation.create({ data: { ...data, builderAccountId: member.builderAccountId } }));
}

export async function deletePickup(member: ActiveMember, id: string): Promise<void> {
  const row = await prisma.builderPickupLocation.findFirst({ where: { id, builderAccountId: member.builderAccountId } });
  if (!row) throw new BuilderError(404, "Pickup location not found.");
  await prisma.builderPickupLocation.delete({ where: { id } });
}

function norm(text: string): string {
  return ` ${String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Supplier order / delivery number next to the supplier name ("TRIWEST 9176215" → "9176215"). */
export function pickupOrderNumber(text: string): string {
  return /\b(\d{5,12})\b/.exec(String(text || ""))?.[1] || "";
}

/** The saved location a work order points to: an alias (whole word) found in the pickup text. */
export function matchPickup(locations: PickupLocation[], text: string): PickupLocation | null {
  const hay = norm(text);
  if (!hay.trim()) return null;
  let best: PickupLocation | null = null;
  let bestLen = 0;
  for (const loc of locations) {
    for (const alias of [...loc.aliases, loc.name]) {
      const a = norm(alias).trim();
      if (a.length < 2) continue;
      if (hay.includes(` ${a} `) && a.length > bestLen) {
        best = loc;
        bestLen = a.length;
      }
    }
  }
  return best;
}

/** What the job shows: "TriWest Henderson — 9751 E 102nd Ave, Henderson, CO · Order 9176215". */
export function pickupText(loc: PickupLocation, order: string): string {
  return [`${loc.name} — ${loc.address}`, order ? `Order ${order}` : "", loc.hours ? loc.hours : "", loc.phone ? loc.phone : ""].filter(Boolean).join(" · ").slice(0, 200);
}

export async function pickupForWorkOrder(accountId: string, pickup: string, extraText = ""): Promise<{ location: PickupLocation; text: string } | null> {
  const locations = await listPickups(accountId);
  if (!locations.length) return null;
  const loc = matchPickup(locations, `${pickup} ${extraText}`);
  if (!loc) return null;
  return { location: loc, text: pickupText(loc, pickupOrderNumber(pickup)) };
}
