/**
 * Best-effort job geocoding (Google Geocoding API) so the day's GPS can be compared
 * with the job address. Silent no-op without a key; never blocks more than ~3s.
 */
import { Prisma } from "@prisma/client";
import { withTenantTransaction } from "../tenant/prisma-tenant.js";

function mapsKey(): string | null {
  const k =
    process.env.GOOGLE_GEOCODING_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_JS_KEY ||
    process.env.GOOGLE_MAPS_KEY ||
    "";
  return k.trim() || null;
}

const RECHECK_MS = 30 * 24 * 3600_000;

export async function ensureJobGeo(organizationId: string, workOrderId: string): Promise<void> {
  const key = mapsKey();
  if (!key) return;
  try {
    const wo = await withTenantTransaction(organizationId, (tx) =>
      tx.workOrder.findFirst({ where: { id: workOrderId }, select: { address: true, geoLat: true, geoCheckedAt: true } }),
    );
    if (!wo?.address || wo.geoLat != null) return;
    if (wo.geoCheckedAt && Date.now() - wo.geoCheckedAt.getTime() < RECHECK_MS) return;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(wo.address)}&key=${encodeURIComponent(key)}`,
      { signal: ac.signal },
    ).finally(() => clearTimeout(t));
    const j = (await r.json().catch(() => ({}))) as { status?: string; results?: { geometry?: { location?: { lat: number; lng: number } } }[] };
    const loc = j.status === "OK" ? j.results?.[0]?.geometry?.location : undefined;
    await withTenantTransaction(organizationId, (tx) =>
      tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          geoCheckedAt: new Date(),
          ...(loc ? { geoLat: new Prisma.Decimal(loc.lat), geoLng: new Prisma.Decimal(loc.lng) } : {}),
        },
      }),
    );
  } catch {
    /* geocoding is optional */
  }
}
