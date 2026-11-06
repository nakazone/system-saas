/**
 * Job media — field photo proof helpers (hash, mapping, feature flag).
 */
import { createHash } from "node:crypto";
import type { AuthedRequest } from "../../middleware/auth.js";
import { isPhase, type JobPhase } from "./phases.js";

export const JOB_MEDIA_STAGES = ["before", "during", "after"] as const;
export type JobMediaStage = (typeof JOB_MEDIA_STAGES)[number];

export type JobMediaRow = {
  id: string;
  type: string;
  url: string;
  thumbUrl?: string | null;
  sha256: string;
  takenAtDevice?: Date | null;
  receivedAtServer: Date;
  lat?: unknown;
  lng?: unknown;
  gpsAccuracyM?: unknown;
  address?: string | null;
  caption?: string | null;
  stage?: string | null;
  phase?: string | null;
  annotationsJson?: unknown;
  isPublic: boolean;
  sharedWithPartners?: boolean;
  inPortfolio?: boolean;
  ocrJson?: unknown;
  clientUploadId?: string | null;
  deviceLabel?: string | null;
  authorId?: string | null;
  author?: { name: string } | null;
  takenById?: string | null;
  takenBy?: { name: string } | null;
  takenAtSource?: string | null;
  locationSource?: string | null;
  cameraModel?: string | null;
  stickerIds?: string[] | null;
  createdAt: Date;
  deletedAt?: Date | null;
};

export function sha256Buffer(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export function isJobMediaEnabled(featureFlags: unknown): boolean {
  if (featureFlags == null) return true;
  if (typeof featureFlags !== "object" || Array.isArray(featureFlags)) return true;
  const flags = featureFlags as Record<string, unknown>;
  if (flags.job_media === false || flags.jobMedia === false) return false;
  return true;
}

export async function orgJobMediaEnabled(
  tx: { organization: { findFirst: (args: unknown) => Promise<{ featureFlags: unknown } | null> } },
  organizationId: string,
): Promise<boolean> {
  const org = await tx.organization.findFirst({
    where: { id: organizationId },
    select: { featureFlags: true },
  });
  return isJobMediaEnabled(org?.featureFlags);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "object" && v !== null && "toNumber" in v
    ? (v as { toNumber: () => number }).toNumber()
    : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Prefer relative /api/local-files URLs so photos work on any host (apex vs Railway). */
export function normalizeMediaUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  if (url.startsWith("/api/local-files/")) return url;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/api/local-files/")) {
      return `${u.pathname}${u.search || ""}`;
    }
  } catch {
    /* ignore */
  }
  return url;
}

/** Photos sent by a temporary worker from the ticket link have no user; the label carries the name. */
export const TEMP_DEVICE_PREFIX = "Temporário · ";

export function mapJobMedia(row: JobMediaRow) {
  const lat = numOrNull(row.lat);
  const lng = numOrNull(row.lng);
  const gps = numOrNull(row.gpsAccuracyM);
  const url = normalizeMediaUrl(row.url);
  const thumb = normalizeMediaUrl(row.thumbUrl || row.url);
  return {
    id: row.id,
    type: row.type || "photo",
    url,
    thumb_url: thumb || url,
    sha256: row.sha256,
    taken_at_device: row.takenAtDevice?.toISOString() ?? null,
    received_at_server: row.receivedAtServer.toISOString(),
    lat,
    lng,
    gps_accuracy_m: gps,
    location_available: lat != null && lng != null,
    address: row.address || null,
    caption: row.caption || null,
    stage: row.stage || null,
    annotations: row.annotationsJson ?? null,
    is_public: Boolean(row.isPublic),
    shared_with_partners: Boolean(row.sharedWithPartners),
    in_portfolio: Boolean(row.inPortfolio),
    ocr: row.ocrJson ?? null,
    client_upload_id: row.clientUploadId || null,
    device_label: row.deviceLabel || null,
    author_id: row.authorId || null,
    /** Who took it: the chosen crew member, else the uploader. */
    taken_by_id: row.takenById || row.authorId || null,
    taken_by_name: row.takenBy?.name || row.author?.name || null,
    uploaded_by_name: row.author?.name || null,
    taken_at_source: row.takenAtSource || null,
    location_source: row.locationSource || null,
    camera_model: row.cameraModel || null,
    sticker_ids: row.stickerIds || [],
    author_name:
      row.author?.name?.split(/\s+/)[0] ||
      (row.deviceLabel?.startsWith(TEMP_DEVICE_PREFIX) ? row.deviceLabel.slice(TEMP_DEVICE_PREFIX.length).split(/\s+/)[0] : null) ||
      null,
    created_at: row.createdAt.toISOString(),
    /** Campo ticket gallery compat */
    createdAt: row.createdAt.toISOString(),
  };
}

export function parsePhotoUploadMeta(body: Record<string, unknown>) {
  const stageRaw = body.stage != null ? String(body.stage) : "";
  const stage =
    stageRaw && (JOB_MEDIA_STAGES as readonly string[]).includes(stageRaw)
      ? (stageRaw as JobMediaStage)
      : null;

  // Hardwood's phases, or a trade's own (Tile, Countertops): any well-formed key here; the routes check it
  // against the job's phases (and the screens ignore a key the job doesn't have).
  const rawPhase = typeof body.phase === "string" ? body.phase.trim() : "";
  const phase: JobPhase | string | null = isPhase(rawPhase) ? rawPhase : /^[a-z][a-z0-9_]{1,39}$/.test(rawPhase) ? rawPhase : null;

  let takenAtDevice: Date | null = null;
  if (body.taken_at_device || body.takenAtDevice) {
    const d = new Date(String(body.taken_at_device || body.takenAtDevice));
    if (!Number.isNaN(d.getTime())) takenAtDevice = d;
  }

  const lat = body.lat != null && body.lat !== "" ? Number(body.lat) : null;
  const lng = body.lng != null && body.lng !== "" ? Number(body.lng) : null;
  const gps =
    body.gps_accuracy_m != null && body.gps_accuracy_m !== ""
      ? Number(body.gps_accuracy_m)
      : body.gpsAccuracyM != null
        ? Number(body.gpsAccuracyM)
        : null;

  return {
    stage,
    phase,
    caption: body.caption != null ? String(body.caption).trim().slice(0, 500) || null : null,
    takenAtDevice,
    lat: lat != null && Number.isFinite(lat) ? lat : null,
    lng: lng != null && Number.isFinite(lng) ? lng : null,
    gpsAccuracyM: gps != null && Number.isFinite(gps) ? gps : null,
    address: body.address != null ? String(body.address).slice(0, 400) || null : null,
    clientUploadId:
      body.client_upload_id || body.clientUploadId
        ? String(body.client_upload_id || body.clientUploadId).slice(0, 80)
        : null,
    deviceLabel: body.device_label || body.deviceLabel
      ? String(body.device_label || body.deviceLabel).slice(0, 120)
      : null,
    takenAtSource: pickSource(body.taken_at_source, ["exif", "file", "upload"]),
    locationSource: lat != null && lng != null ? pickSource(body.location_source, ["exif", "device"]) : null,
    cameraModel: body.camera_model ? String(body.camera_model).trim().slice(0, 80) || null : null,
    takenById: typeof body.taken_by_id === "string" && /^[0-9a-f-]{36}$/i.test(body.taken_by_id) ? body.taken_by_id : null,
    isPublic: body.is_public === true || body.isPublic === true,
  };
}

function pickSource(raw: unknown, allowed: string[]): string | null {
  const v = raw != null ? String(raw) : "";
  return allowed.includes(v) ? v : null;
}

/** Prisma include that every ObraCam media read uses, so uploader and taker names come back together. */
export const JOB_MEDIA_PEOPLE = {
  author: { select: { id: true, name: true } },
  takenBy: { select: { id: true, name: true } },
} as const;

export function requireJobMediaOr403(
  _req: AuthedRequest,
  enabled: boolean,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!enabled) {
    return { ok: false, status: 403, error: "Job media is not enabled for this organization" };
  }
  return { ok: true };
}
