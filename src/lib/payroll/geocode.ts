/**
 * Best-effort job geocoding (Google Geocoding API, Nominatim fallback) so the day's
 * GPS can be compared with the job address. Silent no-op on failure; never blocks long.
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

export type LatLng = { lat: number; lng: number };

type GeocodeOpts = { timeoutMs?: number; allowNominatim?: boolean };

/** Resolve an address to coordinates (Google if keyed; optional Nominatim fallback). */
export async function geocodeAddress(address: string, opts: GeocodeOpts = {}): Promise<LatLng | null> {
  const q = String(address || "").trim();
  if (!q) return null;
  const timeoutMs = opts.timeoutMs ?? 3500;
  const allowNominatim = opts.allowNominatim !== false;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const key = mapsKey();
    if (key) {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`,
        { signal: ac.signal },
      );
      const j = (await r.json().catch(() => ({}))) as {
        status?: string;
        results?: { geometry?: { location?: { lat: number; lng: number } } }[];
      };
      const loc = j.status === "OK" ? j.results?.[0]?.geometry?.location : undefined;
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) return { lat: loc.lat, lng: loc.lng };
    }
    if (!allowNominatim) return null;
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      {
        signal: ac.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "ObraMateCRM/1.0 (dashboard-map)",
        },
      },
    );
    const j = (await r.json().catch(() => [])) as { lat?: string; lon?: string }[];
    if (!Array.isArray(j) || !j[0]) return null;
    const lat = Number(j[0].lat);
    const lng = Number(j[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function ensureJobGeo(organizationId: string, workOrderId: string): Promise<LatLng | null> {
  try {
    const wo = await withTenantTransaction(organizationId, (tx) =>
      tx.workOrder.findFirst({
        where: { id: workOrderId },
        select: { address: true, geoLat: true, geoLng: true, geoCheckedAt: true },
      }),
    );
    if (!wo) return null;
    if (wo.geoLat != null && wo.geoLng != null) {
      return { lat: Number(wo.geoLat), lng: Number(wo.geoLng) };
    }
    if (!wo.address) return null;
    if (wo.geoCheckedAt && Date.now() - wo.geoCheckedAt.getTime() < RECHECK_MS) return null;
    const loc = await geocodeAddress(wo.address);
    await withTenantTransaction(organizationId, (tx) =>
      tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          geoCheckedAt: new Date(),
          ...(loc ? { geoLat: new Prisma.Decimal(loc.lat), geoLng: new Prisma.Decimal(loc.lng) } : {}),
        },
      }),
    );
    return loc;
  } catch {
    return null;
  }
}
