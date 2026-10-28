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

export type ReverseAddress = { address: string; street: string; city: string; state: string; postal_code: string };

/** Street address at a point (Google if keyed; Nominatim fallback). Null when unknown. */
export async function reverseGeocode(lat: number, lng: number, opts: GeocodeOpts = {}): Promise<ReverseAddress | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const key = mapsKey();
    if (key) {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address|premise&key=${encodeURIComponent(key)}`,
        { signal: ac.signal },
      );
      const j = (await r.json().catch(() => ({}))) as {
        status?: string;
        results?: { formatted_address?: string; address_components?: { long_name: string; short_name: string; types: string[] }[] }[];
      };
      const first = j.status === "OK" ? j.results?.[0] : undefined;
      if (first?.formatted_address) {
        const comp = (type: string, short = false) => {
          const c = (first.address_components || []).find((x) => x.types.includes(type));
          return c ? (short ? c.short_name : c.long_name) : "";
        };
        const street = [comp("street_number"), comp("route", true)].filter(Boolean).join(" ");
        const city = comp("locality") || comp("sublocality") || comp("administrative_area_level_3");
        const state = comp("administrative_area_level_1", true);
        const zip = comp("postal_code");
        const address = street ? `${street}, ${[city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}` : first.formatted_address.replace(/, (USA|United States)$/, "");
        return { address, street, city, state, postal_code: zip };
      }
    }
    if (opts.allowNominatim === false) return null;
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`, {
      signal: ac.signal,
      headers: { Accept: "application/json", "User-Agent": "ObraMateCRM/1.0 (builder-measure)" },
    });
    const j = (await r.json().catch(() => ({}))) as { address?: Record<string, string>; display_name?: string };
    const a = j.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.hamlet || a.suburb || "";
    const stateRaw = a["ISO3166-2-lvl4"] ? a["ISO3166-2-lvl4"].split("-")[1] || "" : a.state || "";
    const zip = a.postcode || "";
    if (!street && !j.display_name) return null;
    const address = street ? `${street}, ${[city, [stateRaw, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}` : String(j.display_name);
    return { address, street, city, state: stateRaw, postal_code: zip };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
