/**
 * Job photo GPS helpers — distance to job site and backfill WorkOrder.geo from photos.
 */
import { Prisma } from "@prisma/client";
import { distanceM, FAR_FROM_JOB_M } from "../payroll/day.js";

function num(v: unknown): number | null {
  if (v == null) return null;
  const n =
    typeof v === "object" && v !== null && "toNumber" in v
      ? (v as { toNumber: () => number }).toNumber()
      : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type GeoPoint = { lat: number; lng: number };

/** Median of photo GPS points (robust to outliers). */
export function medianGeo(points: GeoPoint[]): GeoPoint | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat).sort((a, b) => a - b);
  const lngs = points.map((p) => p.lng).sort((a, b) => a - b);
  const mid = Math.floor(points.length / 2);
  return { lat: lats[mid]!, lng: lngs[mid]! };
}

type Tx = {
  workOrder: {
    findFirst: (args: unknown) => Promise<{ geoLat: unknown; geoLng: unknown } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  jobMedia: {
    findMany: (args: unknown) => Promise<Array<{ lat: unknown; lng: unknown }>>;
  };
};

/**
 * Job site coordinates: cached WorkOrder.geo*, else median of that job's photo GPS
 * (persisted onto the WorkOrder so Folha/ObraCam can reuse it).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveJobSiteGeo(tx: any, workOrderId: string): Promise<GeoPoint | null> {
  const client = tx as Tx;
  const wo = await client.workOrder.findFirst({
    where: { id: workOrderId },
    select: { geoLat: true, geoLng: true },
  });
  const cachedLat = num(wo?.geoLat);
  const cachedLng = num(wo?.geoLng);
  if (cachedLat != null && cachedLng != null) return { lat: cachedLat, lng: cachedLng };

  const photos = await client.jobMedia.findMany({
    where: {
      workOrderId,
      deletedAt: null,
      lat: { not: null },
      lng: { not: null },
    },
    select: { lat: true, lng: true },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  const points: GeoPoint[] = [];
  for (const p of photos) {
    const lat = num(p.lat);
    const lng = num(p.lng);
    if (lat != null && lng != null) points.push({ lat, lng });
  }
  const place = medianGeo(points);
  if (!place) return null;

  await client.workOrder.update({
    where: { id: workOrderId },
    data: {
      geoLat: new Prisma.Decimal(place.lat),
      geoLng: new Prisma.Decimal(place.lng),
      geoCheckedAt: new Date(),
    },
  });
  return place;
}

export function photoDistanceFields(photo: { lat?: number | null; lng?: number | null }, jobGeo: GeoPoint | null) {
  const lat = photo.lat != null && Number.isFinite(Number(photo.lat)) ? Number(photo.lat) : null;
  const lng = photo.lng != null && Number.isFinite(Number(photo.lng)) ? Number(photo.lng) : null;
  if (lat == null || lng == null || !jobGeo) {
    return { distance_m: null as number | null, far_from_job: false, near_job: false };
  }
  const distance_m = distanceM({ lat, lng }, jobGeo);
  const far_from_job = distance_m > FAR_FROM_JOB_M;
  return { distance_m, far_from_job, near_job: !far_from_job };
}

export { FAR_FROM_JOB_M, distanceM };
