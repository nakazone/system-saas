/**
 * Builder measurements: stairs (treads, risers, nosings) and vents measured on site by the
 * builder's team. Saved per address; when a work order for that address is sent through the
 * portal, the measurement travels with it (PDF + photos + sizes on the job).
 */
import { randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { storage } from "../storage/index.js";
import { addressKey } from "../partner-intake/extract.js";
import type { ActiveMember } from "./accounts.js";
import { BuilderError } from "./accounts.js";
import { fmtSf, planSchema, planTotals, takeoffSettings, withWaste, type Plan } from "./takeoff.js";

type MeasurementPdfDocument = InstanceType<typeof PDFDocument>;

/* ───────────────────────────── shape ───────────────────────────── */

const inches = z.number().min(0).max(2000).nullable().optional().default(null);
const text = (max: number) => z.string().trim().max(max).optional().default("");
const id = z.string().trim().min(1).max(40);
const photoKey = z.string().trim().max(300);

export const OPEN_SIDES = ["none", "left", "right", "both"] as const;
export const RETURNS = ["45", "flat", "bullnose"] as const;
export const VENT_TYPES = ["flush", "self_rimming", "return_air"] as const;

const stepSchema = z.object({
  id,
  /** A stair can finish with an extra riser before the upper floor/landing. */
  kind: z.enum(["step", "riser"]).optional().default("step"),
  tread_w: inches,
  tread_d: inches,
  riser_w: inches,
  riser_h: inches,
  open: z.enum(OPEN_SIDES).optional().default("none"),
  ret: z.enum(RETURNS).optional().default("45"),
  no_riser: z.boolean().optional().default(false),
  note: text(200),
});

const nosingSchema = z.object({
  id,
  length: inches,
  qty: z.number().int().min(0).max(500).optional().default(1),
  type: z.enum(["flush", "overlap", "stair_nose"]).optional().default("flush"),
  /** Step ID or "landing"; empty/legacy values are drawn on the last tread. */
  position: z.string().trim().max(40).optional().default(""),
  note: text(200),
});

const landingSchema = z.object({
  enabled: z.boolean().optional().default(false),
  width: inches,
  depth: inches,
});

const stairSchema = z.object({
  id,
  name: text(80),
  layout: z.enum(["straight", "round"]).optional().default("straight"),
  round_diameter: inches,
  round_center_diameter: inches,
  round_sweep: z.enum(["180", "270", "360"]).optional().default("270"),
  /** ID of the lower flight whose landing this flight starts from. */
  starts_on_landing_of: z.string().trim().max(40).nullable().optional().default(null),
  /** Which way this flight leaves the lower flight's landing, as seen walking up the lower flight. */
  turn: z.enum(["straight", "left", "right", "u_left", "u_right"]).optional().default("straight"),
  landing: landingSchema.optional().default({ enabled: false, width: null, depth: null }),
  species: text(60),
  finish: text(60),
  color: text(80),
  riser_material: z.enum(["same", "primed", "paint_grade", "none"]).optional().default("same"),
  steps: z.array(stepSchema).max(60).optional().default([]),
  nosings: z.array(nosingSchema).max(40).optional().default([]),
  photos: z.array(photoKey).max(12).optional().default([]),
  note: text(500),
  /** The stair on the floor plans this is (plan.stairs[].id). */
  plan_ref: z.string().trim().max(40).optional(),
});

const ventSchema = z.object({
  id,
  room: text(80),
  size: text(20),
  type: z.enum(VENT_TYPES).optional().default("flush"),
  species: text(60),
  finish: text(60),
  color: text(80),
  qty: z.number().int().min(0).max(500).optional().default(1),
  photos: z.array(photoKey).max(6).optional().default([]),
  note: text(300),
});

export const measurementDataSchema = z.object({
  stairs: z.array(stairSchema).max(20).optional().default([]),
  vents: z.array(ventSchema).max(80).optional().default([]),
  /** Floor plan takeoff (see takeoff.ts). */
  plan: planSchema.nullable().optional().default(null),
  /** Who took the measurements on site and when (names typed or picked from the team). */
  measured: z.object({
    names: z.array(z.string().trim().min(1).max(80)).max(6).optional().default([]),
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional().default(""),
  }).optional().default({ names: [], on: "" }),
});
export type MeasurementData = z.infer<typeof measurementDataSchema>;
export type Stair = z.infer<typeof stairSchema>;
export type Vent = z.infer<typeof ventSchema>;

export function parseData(raw: unknown): MeasurementData {
  const parsed = measurementDataSchema.safeParse(raw ?? {});
  if (!parsed.success) return { stairs: [], vents: [], plan: null, measured: { names: [], on: "" } };
  const data = parsed.data;
  const byId = new Map(data.stairs.map((stair) => [stair.id, stair]));
  for (const stair of data.stairs) {
    const parent = stair.starts_on_landing_of ? byId.get(stair.starts_on_landing_of) : null;
    if (!parent || parent.id === stair.id || !parent.landing.enabled) stair.starts_on_landing_of = null;
  }
  return data;
}

/* ───────────────────────────── inches ───────────────────────────── */

const FRACTIONS: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875, "⅓": 1 / 3, "⅔": 2 / 3 };

/** "11 1/4", "11¼", "11-1/4\"", "11.25" → 11.25. */
export function parseInches(raw: string): number | null {
  let s = String(raw || "").trim().replace(/["”″]|in\b|pol\b/gi, "").replace(/,/g, ".").trim();
  if (!s) return null;
  let extra = 0;
  for (const [ch, v] of Object.entries(FRACTIONS)) {
    if (s.includes(ch)) { extra += v; s = s.replace(ch, " "); }
  }
  const m = /^(\d+(?:\.\d+)?)?(?:[\s-]+)?(?:(\d+)\/(\d+))?\s*$/.exec(s.trim());
  if (!m || (!m[1] && !m[2] && !extra)) return null;
  const whole = m[1] ? Number(m[1]) : 0;
  const frac = m[2] && m[3] && Number(m[3]) ? Number(m[2]) / Number(m[3]) : 0;
  const n = whole + frac + extra;
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

/** 11.25 → "11¼", 48 → "48", 7.875 → "7⅞", 11.3 → "11.3". */
export function fmtInches(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const whole = Math.floor(n + 1e-9);
  const rest = Math.round((n - whole) * 1000) / 1000;
  const glyph = Object.entries(FRACTIONS).find(([, v]) => Math.abs(v - rest) < 0.002)?.[0];
  if (!rest) return String(whole);
  if (glyph) return `${whole || ""}${glyph}`;
  return String(Math.round(n * 100) / 100);
}

/* ───────────────────────────── summary ───────────────────────────── */

const OPEN_LABEL: Record<string, string> = {
  none: "closed both sides",
  left: "left side open",
  right: "right side open",
  both: "both sides open",
};
const RET_LABEL: Record<string, string> = { "45": "45° return", flat: "flat return", bullnose: "bullnose" };
const OPEN_EN: Record<string, string> = { none: "", left: "left return", right: "right return", both: "double returns" };
export const VENT_LABEL: Record<string, string> = { flush: "flush mount", self_rimming: "self-rimming (drop-in)", return_air: "return air" };

export function openLabel(open: string, ret: string): string {
  if (open === "none") return OPEN_LABEL.none!;
  return `${OPEN_LABEL[open] || open} · ${RET_LABEL[ret] || ret}`;
}

export type SummaryLine = { kind: "tread" | "riser" | "nosing" | "landing" | "vent" | "floor"; text: string; qty: number; uom: "EA" | "LF" | "SF" };

function treadSteps(stair: Stair) {
  return stair.steps.filter((step) => step.kind !== "riser" && (step.tread_w || step.tread_d));
}

function nosingPosition(stair: Stair, nosing: z.infer<typeof nosingSchema>): string {
  if (nosing.position === "landing" && stair.landing.enabled) return "landing";
  const treads = treadSteps(stair);
  const index = treads.findIndex((step) => step.id === nosing.position);
  if (index >= 0) return `tread ${index + 1}`;
  return treads.length ? `tread ${treads.length}` : "top of stair";
}

/** Groups equal pieces: "Tread White Oak 48 × 11¼ · both sides open · 45° return — 8 EA". */
export function summarize(data: MeasurementData): SummaryLine[] {
  const out: SummaryLine[] = [];
  for (const stair of data.stairs) {
    const wood = [stair.species, stair.finish, stair.color].filter(Boolean).join(" · ");
    const label = stair.name || "Stair";
    const treads = new Map<string, number>();
    const risers = new Map<string, number>();
    for (const st of stair.steps) {
      if (st.kind !== "riser" && (st.tread_w || st.tread_d)) {
        const k = `${fmtInches(st.tread_w)} × ${fmtInches(st.tread_d)} · ${openLabel(st.open, st.ret)}`;
        treads.set(k, (treads.get(k) || 0) + 1);
      }
      if (st.kind !== "riser" && !st.no_riser && stair.riser_material !== "none" && (st.riser_w || st.riser_h)) {
        const k = `${fmtInches(st.riser_w)} × ${fmtInches(st.riser_h)}${st.open !== "none" ? ` · ${OPEN_LABEL[st.open]}` : ""}`;
        risers.set(k, (risers.get(k) || 0) + 1);
      } else if (st.kind === "riser" && stair.riser_material !== "none" && (st.riser_w || st.riser_h)) {
        const k = `${fmtInches(st.riser_w)} × ${fmtInches(st.riser_h)}`;
        risers.set(k, (risers.get(k) || 0) + 1);
      }
    }
    for (const [k, n] of treads) out.push({ kind: "tread", qty: n, uom: "EA", text: `${label} · Tread${wood ? ` ${wood}` : ""} ${k}` });
    const riserWood = stair.riser_material === "primed" ? "primed" : stair.riser_material === "paint_grade" ? "paint grade" : wood;
    for (const [k, n] of risers) out.push({ kind: "riser", qty: n, uom: "EA", text: `${label} · Riser${riserWood ? ` ${riserWood}` : ""} ${k}` });
    for (const ns of stair.nosings) {
      if (!ns.length) continue;
      const type = ns.type === "overlap" ? "overlap" : ns.type === "stair_nose" ? "stair nose" : "flush";
      out.push({ kind: "nosing", qty: ns.qty || 1, uom: "EA", text: `${label} · Nosing ${type}${wood ? ` ${wood}` : ""} ${fmtInches(ns.length)}" · ${nosingPosition(stair, ns)}${ns.note ? ` · ${ns.note}` : ""}` });
    }
    if (stair.landing.enabled) {
      out.push({ kind: "landing", qty: 1, uom: "EA", text: `${label} · Landing ${wood ? `${wood} ` : ""}${fmtInches(stair.landing.width)} × ${fmtInches(stair.landing.depth)}"` });
    }
  }
  const vents = new Map<string, number>();
  for (const v of data.vents) {
    const k = `Vent ${v.size || "?"} ${VENT_LABEL[v.type] || v.type}${[v.species, v.finish, v.color].filter(Boolean).length ? ` · ${[v.species, v.finish, v.color].filter(Boolean).join(" · ")}` : ""}`;
    vents.set(k, (vents.get(k) || 0) + (v.qty || 1));
  }
  for (const [k, n] of vents) out.push({ kind: "vent", qty: n, uom: "EA", text: k });
  for (const t of planTotals(data.plan)) {
    if (!t.include) continue;
    const where = t.levels.map((l) => `${l.name} ${fmtSf(l.area_sf)}`).join(" · ");
    out.push({ kind: "floor", qty: Math.round(t.area_sf), uom: "SF", text: `Floor ${t.label}${t.spec ? ` · ${t.spec}` : ""}${t.sand_finish ? " · sand & finish on site" : ""}${where ? ` · ${where}` : ""}` });
  }
  return out;
}

export function counts(data: MeasurementData) {
  let treads = 0;
  let risers = 0;
  let nosings = 0;
  let landings = 0;
  for (const s of data.stairs) {
    for (const st of s.steps) {
      if (st.kind !== "riser" && (st.tread_w || st.tread_d)) treads += 1;
      if (st.kind === "riser" ? s.riser_material !== "none" && (st.riser_w || st.riser_h) : !st.no_riser && s.riser_material !== "none" && (st.riser_w || st.riser_h)) risers += 1;
    }
    for (const n of s.nosings) if (n.length) nosings += n.qty || 1;
    if (s.landing.enabled) landings += 1;
  }
  const vents = data.vents.reduce((a, v) => a + (v.qty || 1), 0);
  const floors = planTotals(data.plan).filter((t) => t.include);
  const floor_sf = Math.round(floors.reduce((a, t) => a + t.area_sf, 0));
  const floor_text = floors.map((t) => `${t.label} ${fmtSf(t.area_sf)}`).join(" · ");
  return { stairs: data.stairs.length, treads, risers, nosings, landings, vents, floor_sf, floor_text, plan: Boolean(data.plan && data.plan.file) };
}

/** Text for the job notes, in the words a work order uses (e.g. "48" – double returns – 8 EA"). */
export function summaryText(m: { address: string; data: MeasurementData; measuredBy: string; measuredAt: Date | null }): string {
  const shapes = m.data.stairs.filter((stair) => stair.layout === "round").map((stair) =>
    `- ${stair.name || "Stair"} · Round stair · Ø ${fmtInches(stair.round_diameter)}" outside · Ø ${fmtInches(stair.round_center_diameter)}" center · ${stair.round_sweep}° sweep`);
  const lines = [...shapes, ...summarize(m.data).map((l) => `- ${l.text} — ${l.qty} ${l.uom}`)];
  const who = `${m.measuredBy}${m.measuredAt ? ` on ${m.measuredAt.toISOString().slice(0, 10)}` : ""}`;
  return [`Builder measurement (${who}):`, ...lines].join("\n");
}

export function openSideEn(open: string): string {
  return OPEN_EN[open] || "";
}

/* ───────────────────────────── storage ───────────────────────────── */

function logEntry(member: ActiveMember, action: string) {
  return { at: new Date().toISOString(), member_id: member.id, name: member.name, action };
}

function appendLog(raw: unknown, entry: ReturnType<typeof logEntry>) {
  const list = Array.isArray(raw) ? raw.slice(-80) : [];
  return [...list, entry];
}

async function own(member: ActiveMember, measurementId: string) {
  const row = await prisma.builderMeasurement.findFirst({ where: { id: measurementId, builderAccountId: member.builderAccountId } });
  if (!row) throw new BuilderError(404, "Measurement not found.");
  return row;
}

async function memberNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map();
  const rows = await prisma.builderMember.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

type Row = Awaited<ReturnType<typeof own>>;

function present(row: Row, names: Map<string, string>, full: boolean) {
  const data = parseData(row.data);
  return {
    id: row.id,
    address: row.address,
    community: row.community,
    lot: row.lot,
    notes: row.notes,
    status: row.status,
    counts: counts(data),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    completed_at: row.completedAt,
    used_at: row.usedAt,
    work_order_id: row.workOrderId,
    lat: row.geoLat,
    lng: row.geoLng,
    created_by: names.get(row.createdByMemberId) || null,
    updated_by: row.updatedByMemberId ? names.get(row.updatedByMemberId) || null : null,
    completed_by: row.completedByMemberId ? names.get(row.completedByMemberId) || null : null,
    measured: data.measured,
    ...(full ? { data, log: Array.isArray(row.log) ? row.log : [], summary: summarize(data) } : {}),
  };
}

export async function listMeasurements(member: ActiveMember) {
  const rows = await prisma.builderMeasurement.findMany({
    where: { builderAccountId: member.builderAccountId },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  });
  const names = await memberNames(rows.flatMap((r) => [r.createdByMemberId, r.updatedByMemberId, r.completedByMemberId]));
  return rows.map((r) => present(r, names, false));
}

/** Meters between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Measurements taken near where the builder is now (same house, within ~150 m). */
export async function nearbyMeasurements(member: ActiveMember, lat: number, lng: number, radiusM = 150) {
  const rows = await prisma.builderMeasurement.findMany({
    where: { builderAccountId: member.builderAccountId, geoLat: { not: null }, geoLng: { not: null } },
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });
  const near = rows
    .map((r) => ({ r, d: distanceM({ lat, lng }, { lat: r.geoLat!, lng: r.geoLng! }) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  const names = await memberNames(near.flatMap((x) => [x.r.createdByMemberId, x.r.updatedByMemberId, x.r.completedByMemberId]));
  return near.map((x) => ({ ...present(x.r, names, false), distance_m: Math.round(x.d) }));
}

export async function getMeasurement(member: ActiveMember, measurementId: string) {
  const row = await own(member, measurementId);
  const names = await memberNames([row.createdByMemberId, row.updatedByMemberId, row.completedByMemberId]);
  return present(row, names, true);
}

const headSchema = z.object({
  address: z.string().trim().min(4).max(300),
  community: z.string().trim().max(120).optional().default(""),
  lot: z.string().trim().max(20).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

export async function createMeasurement(member: ActiveMember, raw: unknown) {
  const parsed = headSchema.safeParse(raw);
  if (!parsed.success) throw new BuilderError(400, "Enter the job address.", "address");
  const d = parsed.data;
  const key = addressKey(d.address);
  const row = await prisma.builderMeasurement.create({
    data: {
      builderAccountId: member.builderAccountId,
      address: d.address,
      addressKey: key,
      community: d.community || null,
      lot: d.lot || null,
      notes: d.notes || null,
      geoLat: d.lat ?? null,
      geoLng: d.lng ?? null,
      data: { stairs: [], vents: [] },
      createdByMemberId: member.id,
      log: [logEntry(member, "created it")],
    },
  });
  return getMeasurement(member, row.id);
}

export async function saveMeasurement(member: ActiveMember, measurementId: string, raw: unknown) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "This measurement was already sent with a job. Start a new one to change it.");
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const head = headSchema.partial().safeParse(body);
  const data = measurementDataSchema.safeParse(body.data ?? row.data);
  if (!head.success || !data.success) throw new BuilderError(400, "Check the measurements and try again.");
  // Photos can only point at this measurement's own files.
  const prefix = photoPrefix(row.builderAccountId, row.id);
  for (const s of data.data.stairs) s.photos = s.photos.filter((k) => k.startsWith(prefix));
  for (const v of data.data.vents) v.photos = v.photos.filter((k) => k.startsWith(prefix));
  if (data.data.plan) sanitizePlan(data.data.plan, prefix);
  const h = head.data;
  await prisma.builderMeasurement.update({
    where: { id: row.id },
    data: {
      ...(h.address ? { address: h.address, addressKey: addressKey(h.address) } : {}),
      ...(h.community !== undefined ? { community: h.community || null } : {}),
      ...(h.lot !== undefined ? { lot: h.lot || null } : {}),
      ...(h.notes !== undefined ? { notes: h.notes || null } : {}),
      ...(h.lat != null && h.lng != null ? { geoLat: h.lat, geoLng: h.lng } : {}),
      data: data.data,
      updatedByMemberId: member.id,
      // One log line per person per hour is enough for "who measured".
      log: shouldLogEdit(row.log, member.id) ? appendLog(row.log, logEntry(member, "edited")) : (row.log as never),
    },
  });
  return getMeasurement(member, row.id);
}

function shouldLogEdit(raw: unknown, memberId: string): boolean {
  const list = Array.isArray(raw) ? (raw as Array<{ at?: string; member_id?: string; action?: string }>) : [];
  const last = list[list.length - 1];
  if (!last || last.member_id !== memberId) return true;
  return Date.now() - new Date(last.at || 0).getTime() > 60 * 60 * 1000;
}

export async function completeMeasurement(member: ActiveMember, measurementId: string, done: boolean) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "This measurement was already sent with a job.");
  const data = parseData(row.data);
  if (done && !data.stairs.length && !data.vents.length && !planTotals(data.plan).some((t) => t.include)) throw new BuilderError(400, "Measure at least one stair, vent or floor.");
  await prisma.builderMeasurement.update({
    where: { id: row.id },
    data: done
      ? { status: "done", completedAt: new Date(), completedByMemberId: member.id, log: appendLog(row.log, logEntry(member, "completed it")) }
      : { status: "draft", completedAt: null, completedByMemberId: null, log: appendLog(row.log, logEntry(member, "reopened it")) },
  });
  return getMeasurement(member, row.id);
}

export async function deleteMeasurement(member: ActiveMember, measurementId: string) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "This measurement is on a job and can’t be deleted.");
  await prisma.builderMeasurement.delete({ where: { id: row.id } });
  const files = await storage.list(photoPrefix(row.builderAccountId, row.id)).catch(() => []);
  await Promise.all(files.map((f) => storage.delete(f.key).catch(() => undefined)));
}

export function photoPrefix(accountId: string, measurementId: string): string {
  return `builders/${accountId}/measurements/${measurementId}/`;
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function addPhoto(member: ActiveMember, measurementId: string, dataUrl: string) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "This measurement was already sent with a job.");
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) throw new BuilderError(400, "Invalid photo.");
  const contentType = m[1]!.toLowerCase();
  if (!PHOTO_TYPES.has(contentType)) throw new BuilderError(400, "Use a JPG, PNG or WebP photo.");
  const body = Buffer.from(m[2]!, "base64");
  if (body.length > 8 * 1024 * 1024) throw new BuilderError(400, "Photo is larger than 8 MB.");
  const okSig = contentType === "image/png" ? body.subarray(0, 4).toString("hex") === "89504e47"
    : contentType === "image/jpeg" ? body.subarray(0, 3).toString("hex") === "ffd8ff"
      : body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP";
  if (!okSig) throw new BuilderError(400, "That file doesn’t look like a photo.");
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `${photoPrefix(row.builderAccountId, row.id)}${Date.now()}-${randomBytes(5).toString("hex")}.${ext}`;
  await storage.upload({ key, body, contentType });
  return { key };
}

export async function photoStream(member: ActiveMember, measurementId: string, key: string) {
  const row = await own(member, measurementId);
  if (!key.startsWith(photoPrefix(row.builderAccountId, row.id)) || key.includes("..")) throw new BuilderError(404, "Photo not found.");
  const stream = await storage.getStream(key);
  if (!stream) throw new BuilderError(404, "Photo not found.");
  const ext = key.split(".").pop();
  return { stream, contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
}

/* ───────────────────────────── floor plan file ───────────────────────────── */

const PLAN_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const PLAN_MAX_BYTES = 40 * 1024 * 1024;

function sanitizePlan(plan: Plan, prefix: string) {
  if (plan.file && !plan.file.key.startsWith(prefix)) plan.file = null;
  for (const level of plan.levels) if (level.preview && !level.preview.startsWith(prefix)) level.preview = null;
  if (plan.snapshot && !plan.snapshot.startsWith(prefix)) plan.snapshot = null;
  const keys = new Set(plan.materials.map((m) => m.key));
  for (const level of plan.levels) level.rooms = level.rooms.filter((r) => keys.has(r.material));
}

/** Stores the plans (PDF or photo) for this measurement; returns the stored file reference. */
export async function addPlanFile(member: ActiveMember, measurementId: string, body: Buffer, contentType: string, name: string) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "This measurement was already sent with a job.");
  const type = contentType.toLowerCase().split(";")[0]!.trim();
  const ext = PLAN_TYPES[type];
  if (!ext) throw new BuilderError(400, "Upload the plans as a PDF, JPG or PNG.");
  if (!body.length) throw new BuilderError(400, "The file is empty.");
  if (body.length > PLAN_MAX_BYTES) throw new BuilderError(400, "The plans must be under 40 MB.");
  const sig = body.subarray(0, 4).toString("hex");
  const ok = type === "application/pdf" ? body.subarray(0, 5).toString() === "%PDF-"
    : type === "image/png" ? sig === "89504e47"
      : type === "image/jpeg" ? sig.startsWith("ffd8ff")
        : body.subarray(8, 12).toString() === "WEBP";
  if (!ok) throw new BuilderError(400, "That file doesn’t look like a PDF or image.");
  const key = `${photoPrefix(row.builderAccountId, row.id)}plan-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  await storage.upload({ key, body, contentType: type });
  const clean = String(name || "").replace(/[^\w .,()&-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || `plans.${ext}`;
  return { key, name: clean, type, size: body.length };
}

/** Small preview of a plan sheet (drawn in the browser while reading the plans). */
export async function addPlanPreview(member: ActiveMember, measurementId: string, dataUrl: string) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "This measurement was already sent with a job.");
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) throw new BuilderError(400, "Invalid preview.");
  const body = Buffer.from(m[2]!, "base64");
  if (body.length > 4 * 1024 * 1024) throw new BuilderError(400, "Preview is too large.");
  const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
  const key = `${photoPrefix(row.builderAccountId, row.id)}plan-sheet-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  await storage.upload({ key, body, contentType: m[1]! });
  return { key };
}

export async function planFileStream(member: ActiveMember, measurementId: string, key: string) {
  const row = await own(member, measurementId);
  if (!key.startsWith(photoPrefix(row.builderAccountId, row.id)) || key.includes("..") || !/\/plan-/.test(key)) throw new BuilderError(404, "File not found.");
  const stream = await storage.getStream(key);
  if (!stream) throw new BuilderError(404, "File not found.");
  const ext = key.split(".").pop() || "";
  const contentType = Object.entries(PLAN_TYPES).find(([, e]) => e === ext)?.[0] || "application/octet-stream";
  return { stream, contentType };
}

/* ───────────────────────────── work order link ───────────────────────────── */

/** The measurement for this address (not yet used first, newest first). */
export async function findMeasurementForAddress(accountId: string, address: string | null | undefined) {
  const key = addressKey(address);
  if (!/^\d+\s+\S+/.test(key)) return null;
  const rows = await prisma.builderMeasurement.findMany({
    where: { builderAccountId: accountId, addressKey: key },
    orderBy: [{ updatedAt: "desc" }],
    take: 5,
  });
  const pick = rows.find((r) => r.status !== "used") || rows[0];
  if (!pick) return null;
  const names = await memberNames([pick.createdByMemberId, pick.updatedByMemberId, pick.completedByMemberId]);
  const p = present(pick, names, true);
  return { id: p.id, address: p.address, status: p.status, counts: p.counts, summary: p.summary, measured_by: (p.measured && p.measured.names.length ? p.measured.names.join(" & ") : "") || p.completed_by || p.updated_by || p.created_by, measured_at: p.measured && p.measured.on ? new Date(`${p.measured.on}T12:00:00Z`) : pick.completedAt || pick.updatedAt, used_at: p.used_at };
}

async function readBuffer(key: string): Promise<Buffer | null> {
  const stream = await storage.getStream(key);
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export type MeasurementPack = {
  text: string;
  summary: SummaryLine[];
  files: Array<{ name: string; contentType: string; body: Buffer }>;
};

/** Everything the job needs from a measurement: the text for notes, the PDF and the photos. */
export async function measurementPack(accountId: string, measurementId: string): Promise<MeasurementPack | null> {
  const row = await prisma.builderMeasurement.findFirst({ where: { id: measurementId, builderAccountId: accountId } });
  if (!row) return null;
  const data = parseData(row.data);
  const names = await memberNames([row.createdByMemberId, row.updatedByMemberId, row.completedByMemberId]);
  const typedBy = data.measured && data.measured.names.length ? data.measured.names.join(" & ") : "";
  const measuredBy = typedBy || (row.completedByMemberId && names.get(row.completedByMemberId)) || (row.updatedByMemberId && names.get(row.updatedByMemberId)) || names.get(row.createdByMemberId) || "Builder";
  const measuredAt = data.measured && data.measured.on ? new Date(`${data.measured.on}T12:00:00Z`) : row.completedAt || row.updatedAt;
  const account = await prisma.builderAccount.findUnique({ where: { id: accountId }, select: { name: true } });
  const pdf = await measurementPdf({ accountId, builder: account?.name || "Builder", address: row.address, community: row.community, lot: row.lot, notes: row.notes, data, measuredBy, measuredAt });
  const files: MeasurementPack["files"] = [{ name: `Measurement - ${row.address}.pdf`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 150), contentType: "application/pdf", body: pdf }];
  let n = 0;
  const photo = async (key: string, label: string) => {
    if (n >= 20) return;
    const body = await readBuffer(key).catch(() => null);
    if (!body) return;
    n += 1;
    const ext = key.split(".").pop() || "jpg";
    files.push({ name: `${label} ${n}.${ext}`.slice(0, 150), contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", body });
  };
  for (const s of data.stairs) for (const k of s.photos) await photo(k, `Photo ${s.name || "stair"}`);
  for (const v of data.vents) for (const k of v.photos) await photo(k, `Photo vent ${v.room || v.size}`);
  if (data.plan?.file) {
    const body = await readBuffer(data.plan.file.key).catch(() => null);
    const ext = data.plan.file.key.split(".").pop() || "pdf";
    if (body) files.push({ name: `Plans - ${row.address}.${ext}`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 150), contentType: data.plan.file.type, body });
  }
  return { text: summaryText({ address: row.address, data, measuredBy, measuredAt }), summary: summarize(data), files };
}

export async function markMeasurementUsed(accountId: string, measurementId: string, organizationId: string, workOrderId: string | null, memberName: string) {
  const row = await prisma.builderMeasurement.findFirst({ where: { id: measurementId, builderAccountId: accountId } });
  if (!row) return;
  await prisma.builderMeasurement.update({
    where: { id: row.id },
    data: {
      status: "used",
      usedAt: new Date(),
      organizationId,
      workOrderId,
      log: appendLog(row.log, { at: new Date().toISOString(), member_id: "", name: memberName, action: "sent it with the Work Order" }),
    },
  });
}

/* ───────────────────────────── PDF ───────────────────────────── */

/** PDF fonts have no ⅛-style glyphs: "11¼" → "11-1/4". */
function ascii(text: string): string {
  const map: Record<string, string> = { "¼": "1/4", "½": "1/2", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅓": "1/3", "⅔": "2/3" };
  return text.replace(/(\d)?([¼½¾⅛⅜⅝⅞⅓⅔])/g, (_m, d: string | undefined, f: string) => `${d ? `${d}-` : ""}${map[f]}`);
}

function connectedStairChain(data: MeasurementData, start: Stair): Stair[] {
  let root = start;
  const ancestors = new Set([root.id]);
  while (root.starts_on_landing_of) {
    const parent = data.stairs.find((stair) => stair.id === root.starts_on_landing_of);
    if (!parent || !parent.landing.enabled || ancestors.has(parent.id)) break;
    ancestors.add(parent.id);
    root = parent;
  }
  const chain: Stair[] = [];
  const seen = new Set<string>();
  let current: Stair | undefined = root;
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = data.stairs.find((stair) => stair.starts_on_landing_of === chain[chain.length - 1]!.id);
  }
  return chain;
}

function drawRoundPlan(doc: MeasurementPdfDocument, stair: Stair, x: number, y: number, width: number, height: number) {
  const cx = x + 58;
  const cy = y + height / 2;
  const outer = Math.min(42, height / 2 - 10);
  const diameter = Number(stair.round_diameter) || 60;
  const centerDiameter = Number(stair.round_center_diameter) || 6;
  const inner = Math.max(6, Math.min(outer - 6, outer * centerDiameter / diameter));
  const sweep = Number(stair.round_sweep) || 270;
  const treads = stair.steps.filter((step) => step.kind !== "riser");
  const start = -90 - sweep / 2;
  doc.roundedRect(x, y, width, height, 8).fillAndStroke("#FAFBFC", "#E5E7EB");
  doc.circle(cx, cy, outer).lineWidth(1).strokeColor("#5B4632").stroke();
  doc.circle(cx, cy, inner).lineWidth(1).strokeColor("#667085").stroke();
  const polar = (radius: number, degrees: number) => [cx + radius * Math.cos(degrees * Math.PI / 180), cy + radius * Math.sin(degrees * Math.PI / 180)];
  const divisions = Math.max(1, treads.length);
  for (let i = 0; i <= divisions; i += 1) {
    const pointA = polar(inner, start + sweep * i / divisions);
    const pointB = polar(outer, start + sweep * i / divisions);
    doc.moveTo(pointA[0]!, pointA[1]!).lineTo(pointB[0]!, pointB[1]!).lineWidth(0.65).strokeColor("#98A2B3").stroke();
  }
  treads.forEach((_step, i) => {
    const p = polar((inner + outer) / 2, start + sweep * (i + 0.5) / divisions);
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#344054").text(String(i + 1), p[0]! - 3, p[1]! - 4, { width: 8, align: "center" });
  });
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#221E1A").text("ROUND / SPIRAL PLAN", x + 112, y + 13, { width: width - 124 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#667085")
    .text(`Outside diameter: ${fmtInches(stair.round_diameter)} in`, x + 112, y + 31, { width: width - 124 })
    .text(`Center opening: ${fmtInches(stair.round_center_diameter)} in`, x + 112, y + 45, { width: width - 124 })
    .text(`Sweep: ${sweep} degrees · ${treads.length} treads`, x + 112, y + 59, { width: width - 124 });
  if (stair.landing.enabled) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#B4561A")
      .text(`Landing: ${fmtInches(stair.landing.width)} × ${fmtInches(stair.landing.depth)} in`, x + 112, y + 75, { width: width - 124 });
  }
}

/** Draw each flight in order, keeping the upper flight at the landing elevation. */
function drawStairElevation(doc: MeasurementPdfDocument, flights: Stair[], x: number, y: number, width: number, height: number) {
  const stepsByFlight = flights.map((flight) => flight.steps.filter((step) => step.kind === "riser"
    ? step.riser_w || step.riser_h
    : step.tread_w || step.tread_d || step.riser_h));
  const run = flights.reduce((sum, flight, i) => sum
    + stepsByFlight[i]!.reduce((n, step) => n + (step.kind === "riser" ? 0 : Number(step.tread_d) || 11.25), 0)
    + (flight.landing.enabled ? Number(flight.landing.depth) || 18 : 0), 0);
  const rise = flights.reduce((sum, _flight, i) => sum + stepsByFlight[i]!.reduce((n, step) => n + (Number(step.riser_h) || 7.5), 0), 0);
  const scale = Math.min(2.1, (width - 28) / Math.max(run, 1), (height - 34) / Math.max(rise, 1));
  const bottom = y + height - 14;
  let cursorX = x + 12;
  let surfaceY = bottom;
  doc.roundedRect(x, y, width, height, 8).fillAndStroke("#FAFBFC", "#E5E7EB");
  doc.moveTo(x + 8, bottom).lineTo(x + width - 8, bottom).lineWidth(0.6).strokeColor("#D0D5DD").stroke();
  flights.forEach((flight, flightIndex) => {
    const color = flight.riser_material === "primed" || flight.riser_material === "paint_grade" ? "#F3F1EC" : "#D6B488";
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#344054")
      .text(ascii(`${flight.name || `Stair ${flightIndex + 1}`} · ${flight.layout === "round" ? "round/spiral (schematic elevation)" : "straight flight"}`), cursorX, y + 6, { width: Math.min(160, width / 2) });
    stepsByFlight[flightIndex]!.forEach((step, index) => {
      const stepRise = (Number(step.riser_h) || 7.5) * scale;
      const topY = surfaceY - stepRise;
      if (step.kind === "riser") {
        doc.rect(cursorX, topY, 3, stepRise).fillAndStroke("#E4E7EC", "#98A2B3");
      } else {
        const stepRun = (Number(step.tread_d) || 11.25) * scale;
        doc.rect(cursorX, topY, stepRun, 3.5).fillAndStroke(color, "#5B4632");
        doc.rect(cursorX, topY, 3, stepRise).fillAndStroke("#E4E7EC", "#98A2B3");
        doc.font("Helvetica").fontSize(6).fillColor("#667085").text(String(index + 1), cursorX + Math.max(2, stepRun / 2 - 2), topY - 8, { width: 8, align: "center" });
        const hasNosing = flight.nosings.some((nosing) => nosing.length && nosingPosition(flight, nosing) === step.id);
        if (hasNosing) doc.moveTo(cursorX, topY).lineTo(cursorX + stepRun, topY).lineWidth(1.5).strokeColor("#E7792C").stroke();
        cursorX += stepRun;
      }
      surfaceY = topY;
    });
    if (flight.landing.enabled) {
      const landingRun = (Number(flight.landing.depth) || 18) * scale;
      doc.rect(cursorX, surfaceY - 4, landingRun, 4).fillAndStroke(color, "#5B4632");
      doc.font("Helvetica-Bold").fontSize(5.8).fillColor("#344054")
        .text(ascii(`LANDING ${fmtInches(flight.landing.width)} × ${fmtInches(flight.landing.depth)} in`), cursorX, surfaceY - 13, { width: Math.max(landingRun, 36), align: "center" });
      cursorX += landingRun;
    }
  });
  doc.font("Helvetica").fontSize(7).fillColor("#667085")
    .text("Schematic elevation · dimensions in inches · tread depth determines run", x + 10, y + height - 11, { width: width - 20 });
}

function drawIllustratedSpecs(doc: MeasurementPdfDocument, stair: Stair, x: number, y: number, width: number, height: number) {
  const tread = stair.steps.find((step) => step.kind !== "riser" && (step.tread_w || step.tread_d));
  const riser = stair.steps.find((step) => step.riser_w || step.riser_h);
  const nosing = stair.nosings.find((item) => item.length);
  const gap = 8;
  const cardWidth = (width - gap * 2) / 3;
  const cards = [
    { title: "TREAD · TOP VIEW", detail: tread ? `${fmtInches(tread.tread_w)} × ${fmtInches(tread.tread_d)} in` : "Add tread dimensions", kind: "tread" as const },
    { title: "RISER · FRONT VIEW", detail: riser ? `${fmtInches(riser.riser_w)} × ${fmtInches(riser.riser_h)} in` : "Add riser dimensions", kind: "riser" as const },
    { title: "NOSING · EDGE DETAIL", detail: nosing ? `${fmtInches(nosing.length)} in · ${nosing.type.replace("_", " ")}` : "No nosing selected", kind: "nosing" as const },
  ];
  cards.forEach((card, index) => {
    const cardX = x + index * (cardWidth + gap);
    doc.roundedRect(cardX, y, cardWidth, height, 7).fillAndStroke("#FFFFFF", "#E5E7EB");
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#667085").text(card.title, cardX + 8, y + 8, { width: cardWidth - 16 });
    if (card.kind === "tread" && tread) {
      doc.rect(cardX + 19, y + 27, cardWidth - 42, 24).fillAndStroke("#D6B488", "#5B4632");
      doc.moveTo(cardX + 19, y + 28).lineTo(cardX + cardWidth - 23, y + 28).lineWidth(1.8).strokeColor("#E7792C").stroke();
      doc.font("Helvetica").fontSize(6).fillColor("#344054").text("NOSE", cardX + 21, y + 53, { width: cardWidth - 46, align: "center" });
    } else if (card.kind === "riser" && riser) {
      doc.rect(cardX + 20, y + 30, cardWidth - 44, 20).fillAndStroke(stair.riser_material === "same" ? "#D6B488" : "#F3F1EC", "#5B4632");
      doc.moveTo(cardX + 20, y + 54).lineTo(cardX + cardWidth - 24, y + 54).lineWidth(0.6).strokeColor("#667085").stroke();
      doc.font("Helvetica").fontSize(5.8).fillColor("#667085").text("WIDTH", cardX + 20, y + 56, { width: cardWidth - 44, align: "center" });
    } else if (card.kind === "nosing" && nosing) {
      doc.moveTo(cardX + 19, y + 48).lineTo(cardX + cardWidth - 22, y + 48).lineWidth(6).strokeColor("#D6B488").stroke();
      doc.moveTo(cardX + 22, y + 43).lineTo(cardX + cardWidth - 22, y + 43).lineWidth(1.7).strokeColor("#E7792C").stroke();
      doc.font("Helvetica").fontSize(5.8).fillColor("#667085").text(nosing.type === "overlap" ? "OVERLAP" : nosing.type === "stair_nose" ? "STAIR NOSE" : "FLUSH", cardX + 18, y + 54, { width: cardWidth - 36, align: "center" });
    }
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#221E1A").text(ascii(card.detail), cardX + 7, y + height - 16, { width: cardWidth - 14, align: "center" });
  });
}

type PdfInput = { accountId?: string; builder: string; address: string; community: string | null; lot: string | null; notes: string | null; data: MeasurementData; measuredBy: string; measuredAt: Date | null; status?: string };

const C = { ink: "#221E1A", muted: "#667085", line: "#E5E7EB", soft: "#F7F8FA", orange: "#E7792C", orangeSoft: "#FBEADF", olive: "#536249", white: "#FFFFFF" };

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" }) : "";
}
function sf(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} SF`;
}
function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const WOOD_TONE: Record<string, string> = { "white oak": "#D6B488", "red oak": "#C8936E", hickory: "#CDA06C", maple: "#E9D3AA", walnut: "#6E4B34", ash: "#DEC79F", "brazilian cherry": "#8E3B22" };

/** A vent seen from above: wood frame, louvers, size lines (like the app's drawing). */
function drawVent(doc: MeasurementPdfDocument, v: { size: string; type: string; species: string }, x: number, y: number, w: number, h: number) {
  const m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i.exec(String(v.size || "").trim());
  const A = m ? Number(m[1]) : 4; const B = m ? Number(m[2]) : 10;
  const vw = Math.max(A, B); const vh = Math.min(A, B);
  const scale = Math.min((w - 40) / vw, (h - 34) / vh);
  const dw = vw * scale; const dh = vh * scale; const x0 = x + (w - dw) / 2; const y0 = y + 16 + (h - 34 - dh) / 2;
  const tone = WOOD_TONE[String(v.species || "").toLowerCase()] || "#D6B488";
  if (v.type === "self_rimming") doc.roundedRect(x0 - 2, y0 + 2, dw + 4, dh + 4, 4).fill("#E4DED6");
  doc.roundedRect(x0, y0, dw, dh, v.type === "self_rimming" ? 4 : 1.5).fillAndStroke(tone, "#4A3726");
  const lip = (v.type === "self_rimming" ? 0.9 : 0.55) * scale;
  const slots = Math.max(3, Math.round(vw / 1.1));
  const inner = dw - 2 * lip - 0.7 * scale;
  for (let i = 0; i < slots; i++) {
    doc.roundedRect(x0 + lip + 0.35 * scale + (i * inner) / slots, y0 + lip + 0.35 * scale, inner / slots - 0.25 * scale, dh - 2 * lip - 0.7 * scale, 1).fillOpacity(0.78).fill("#2A1C12");
  }
  doc.fillOpacity(1);
  doc.lineWidth(0.6).strokeColor("#98A2B3");
  doc.moveTo(x0, y0 - 8).lineTo(x0 + dw, y0 - 8).stroke();
  doc.moveTo(x0 + dw + 8, y0).lineTo(x0 + dw + 8, y0 + dh).stroke();
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#475467").text(`${fmtInches(vw)}"`, x0, y0 - 17, { width: dw, align: "center" });
  doc.text(`${fmtInches(vh)}"`, x0 + dw + 11, y0 + dh / 2 - 4, { width: 30 });
}

/** Greedy rectangles of equal non-zero cells (for drawing the floors over the plan). */
function gridRects(cells: Int32Array, w: number, _h: number, x0: number, y0: number, x1: number, y1: number) {
  const done = new Uint8Array(cells.length); const out: Array<{ x: number; y: number; w: number; h: number; v: number }> = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = cells[y * w + x]!;
      if (!v || done[y * w + x]) continue;
      let rw = 1;
      while (x + rw < x1 && cells[y * w + x + rw] === v && !done[y * w + x + rw]) rw++;
      let rh = 1;
      outer: while (y + rh < y1) {
        for (let k = 0; k < rw; k++) if (cells[(y + rh) * w + x + k] !== v || done[(y + rh) * w + x + k]) break outer;
        rh++;
      }
      for (let yy = y; yy < y + rh; yy++) done.fill(1, yy * w + x, yy * w + x + rw);
      out.push({ x, y, w: rw, h: rh, v });
    }
  }
  return out;
}
function decodeRle(rle: string, n: number): Int32Array {
  const out = new Int32Array(n); let i = 0;
  for (const part of String(rle || "").split(",")) {
    if (!part) continue;
    const [v, k] = part.split("x").map(Number);
    if (v) out.fill(v, i, i + k!);
    i += k!;
  }
  return out;
}

const KIND_WORDS: Partial<Record<string, RegExp>> = { hardwood: /hard\s?wood|\bwood\b|engineered|oak/i, lvp: /\blvp\b|\blvt\b|vinyl/i, laminate: /laminate/i, carpet: /carpet/i, rubber: /rubber/i };

/** Same pricing the app shows on the Quote tab: chosen price, else matched by name (sq ft items). */
export async function planQuote(accountId: string | undefined, plan: NonNullable<MeasurementData["plan"]>) {
  if (!accountId || !plan.quote_link_id) return null;
  const [link, prices] = await Promise.all([
    prisma.builderLink.findFirst({ where: { id: plan.quote_link_id, builderAccountId: accountId }, select: { companyName: true } }),
    prisma.builderPriceItem.findMany({ where: { builderAccountId: accountId, builderLinkId: plan.quote_link_id } }),
  ]);
  if (!link || (!prices.length && !Object.keys(plan.quote_rates || {}).length)) return null;
  const list = prices.map((p) => ({ id: p.id, name: p.name, unit: p.unit, price: Number(p.price) }));
  const sq = list.filter((p) => p.unit === "sq_ft");
  const typed = (key: string) => (plan.quote_rates && plan.quote_rates[key] != null ? { id: "typed", name: "", unit: "sq_ft", price: Number(plan.quote_rates[key]) } : null);
  const pick = (key: string, test: (p: { name: string }) => boolean) => {
    const t = typed(key); if (t) return t;
    const chosen = plan.quote_prices[key];
    return (chosen && list.find((p) => p.id === chosen)) || sq.find(test) || null;
  };
  const lines: Array<{ name: string; spec: string; qty: number; rate: number | null }> = [];
  for (const t of planTotals(plan).filter((x) => x.include)) {
    const words = KIND_WORDS[t.kind] || /$^/;
    const qty = Math.ceil(t.area_sf);
    const ins = pick(`${t.key}:install`, (p) => words.test(p.name) && /install/i.test(p.name)) || pick(`${t.key}:install`, (p) => words.test(p.name) && !/sand|refinish|finish|demo|remov/i.test(p.name));
    lines.push({ name: `${t.label} install`, spec: t.spec, qty, rate: ins ? ins.price : null });
    if (t.kind === "hardwood" && t.sand_finish) {
      const s = pick(`${t.key}:sand`, (p) => /sand|refinish|finish/i.test(p.name));
      lines.push({ name: plan.materials.filter((x) => x.kind === "hardwood" && x.include).length > 1 ? `Sand & finish · ${t.label}` : "Sand & finish", spec: [t.label, ...(plan.materials.find((x) => x.key === t.key)?.spec?.color ? [plan.materials.find((x) => x.key === t.key)!.spec.color] : [])].join(" · "), qty, rate: s ? s.price : null });
    }
  }
  return { company: link.companyName, lines };
}

export async function measurementPdf(m: PdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 40, bottom: 56, left: 40, right: 40 }, bufferPages: true, info: { Title: `Measurement · ${m.address}`, Author: m.builder } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const L = 40; const W = doc.page.width - 80; const BOTTOM = doc.page.height - 60;
  const plan = m.data.plan && m.data.plan.levels.length ? m.data.plan : null;
  const settings = m.accountId ? takeoffSettings((await prisma.builderAccount.findUnique({ where: { id: m.accountId }, select: { takeoffSettings: true } }))?.takeoffSettings) : takeoffSettings({});
  const totals = plan ? planTotals(plan).filter((t) => t.include) : [];
  const cnt = counts(m.data);

  const ensure = (h: number) => { if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = 40; } };
  const section = (title: string, sub?: string) => {
    ensure(60);
    const y = doc.y + 6;
    doc.rect(L, y + 2, 3, 14).fill(C.orange);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(C.ink).text(title, L + 11, y, { width: W - 11 });
    if (sub) doc.font("Helvetica").fontSize(9).fillColor(C.muted).text(sub, L + 11, doc.y + 1, { width: W - 11 });
    doc.y += 8;
  };
  /** Table with a shaded header and zebra rows; cols are widths that add up to W. */
  const table = (cols: Array<{ w: number; label: string; align?: "left" | "right" }>, rows: string[][], opts?: { bold?: number[]; total?: string[] }) => {
    const pad = 6;
    const headH = 18;
    const drawHead = () => {
      const y = doc.y;
      doc.rect(L, y, W, headH).fill(C.soft);
      let x = L;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.muted);
      for (const c of cols) { doc.text(c.label.toUpperCase(), x + pad, y + 6, { width: c.w - pad * 2, align: c.align || "left", characterSpacing: 0.4 }); x += c.w; }
      doc.y = y + headH;
    };
    ensure(headH + 20);
    drawHead();
    rows.forEach((r, ri) => {
      doc.font("Helvetica").fontSize(9);
      const h = Math.max(18, ...r.map((cell, j) => doc.heightOfString(ascii(cell || " "), { width: cols[j]!.w - pad * 2 }) + 9));
      if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = 40; drawHead(); }
      const y = doc.y;
      if (ri % 2 === 1) doc.rect(L, y, W, h).fill("#FBFBFC");
      let x = L;
      r.forEach((cell, j) => {
        doc.font(opts?.bold?.includes(j) ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(j === 0 ? C.ink : C.ink);
        doc.text(ascii(cell || ""), x + pad, y + 5, { width: cols[j]!.w - pad * 2, align: cols[j]!.align || "left" });
        x += cols[j]!.w;
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.y = y + h;
    });
    if (opts?.total) {
      const y = doc.y; const h = 22;
      ensure(h);
      doc.rect(L, y, W, h).fill(C.ink);
      let x = L;
      opts.total.forEach((cell, j) => { doc.font("Helvetica-Bold").fontSize(9.5).fillColor(C.white).text(cell, x + pad, y + 7, { width: cols[j]!.w - pad * 2, align: cols[j]!.align || "left" }); x += cols[j]!.w; });
      doc.y = y + h;
    }
    doc.y += 10;
  };

  /** Up to 8 site photos as a row of thumbnails. */
  const photoStrip = async (keys: string[], title: string) => {
    const list = (keys || []).slice(0, 8);
    if (!list.length) return;
    const bufs = (await Promise.all(list.map((k) => readBuffer(k).catch(() => null)))).filter((b): b is Buffer => Boolean(b));
    if (!bufs.length) return;
    const per = 4; const gap = 8; const tw = (W - gap * (per - 1)) / per; const th = tw * 0.75;
    ensure(th + 24);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.muted).text(ascii(title).toUpperCase(), L, doc.y, { characterSpacing: 0.5 });
    let y = doc.y + 4;
    bufs.forEach((b, i) => {
      if (i && i % per === 0) { y += th + gap; if (y + th > BOTTOM) { doc.addPage(); y = 40; } }
      const x = L + (i % per) * (tw + gap);
      doc.save(); doc.roundedRect(x, y, tw, th, 6).clip();
      doc.rect(x, y, tw, th).fill(C.soft);
      try { doc.image(b, x, y, { cover: [tw, th], align: "center", valign: "center" }); } catch { /* bad photo */ }
      doc.restore();
    });
    doc.y = y + th + 12;
  };

  /* ── header band ── */
  doc.rect(0, 0, doc.page.width, 118).fill(C.ink);
  doc.rect(0, 118, doc.page.width, 3).fill(C.orange);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.orange).text(plan ? "FLOOR TAKEOFF & FIELD MEASUREMENT" : "FIELD MEASUREMENT", L, 30, { characterSpacing: 1.2 });
  doc.font("Helvetica-Bold").fontSize(21).fillColor(C.white).text(ascii(m.address), L, 44, { width: W - 170 });
  const sub = [m.community, m.lot ? `Lot ${m.lot}` : ""].filter(Boolean).join(" · ");
  if (sub) doc.font("Helvetica").fontSize(10).fillColor("#D0D5DD").text(sub, L, doc.y + 2, { width: W - 170 });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(C.white).text(m.builder, L + W - 160, 32, { width: 160, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor("#D0D5DD").text(`Measured by ${m.measuredBy}`, L + W - 160, 48, { width: 160, align: "right" });
  if (m.measuredAt) doc.text(fmtDate(m.measuredAt), L + W - 160, 60, { width: 160, align: "right" });
  doc.font("Helvetica").fontSize(7.5).fillColor("#98A2B3").text("ObraBuilder", L + W - 160, 92, { width: 160, align: "right" });
  doc.y = 138;

  /* ── key numbers ── */
  const tiles: Array<{ label: string; big: string; small: string; color?: string }> = [];
  for (const t of totals) {
    const w = settings.waste[t.kind] ?? 10;
    tiles.push({ label: t.label, big: sf(t.area_sf), small: `Order ${sf(withWaste(t.area_sf, w))} (+${w}%)`, color: t.color });
  }
  if (cnt.treads || cnt.risers) tiles.push({ label: "Stairs", big: `${cnt.treads} treads`, small: `${cnt.risers} risers · ${cnt.nosings} nosings` });
  if (cnt.vents) tiles.push({ label: "Vents", big: `${cnt.vents}`, small: "registers" });
  if (tiles.length) {
    const per = Math.min(4, Math.max(3, tiles.length)); const gap = 10; const tw = (W - gap * (per - 1)) / per; const th = 58;
    const top = doc.y;
    tiles.forEach((t, i) => {
      const x = L + (i % per) * (tw + gap); const y = top + Math.floor(i / per) * (th + gap);
      doc.roundedRect(x, y, tw, th, 8).fillAndStroke(C.soft, C.line);
      if (t.color) doc.roundedRect(x + 10, y + 11, 8, 8, 2).fill(t.color);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.muted).text(ascii(t.label).toUpperCase(), x + (t.color ? 23 : 10), y + 11, { width: tw - 30, characterSpacing: 0.4, lineBreak: false, ellipsis: true });
      doc.font("Helvetica-Bold").fontSize(16).fillColor(C.ink).text(t.big, x + 10, y + 24, { width: tw - 20, lineBreak: false });
      doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(t.small, x + 10, y + 43, { width: tw - 20, lineBreak: false, ellipsis: true });
    });
    doc.y = top + Math.ceil(tiles.length / per) * (th + gap) + 4;
  }
  if (m.notes) {
    const h = doc.font("Helvetica").fontSize(9.5).heightOfString(ascii(m.notes), { width: W - 24 }) + 26;
    ensure(h);
    const y = doc.y;
    doc.roundedRect(L, y, W, h, 8).fill(C.orangeSoft);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#9A4A16").text("NOTES", L + 12, y + 8, { characterSpacing: 0.6 });
    doc.font("Helvetica").fontSize(9.5).fillColor(C.ink).text(ascii(m.notes), L + 12, y + 19, { width: W - 24 });
    doc.y = y + h + 12;
  }

  /* ── floors ── */
  if (plan) {
    section("Floors", "Measured from the house plans · areas exclude walls · material to order includes the waste set in ObraBuilder");
    table(
      [{ w: 98, label: "Floor" }, { w: 196, label: "Product" }, { w: 72, label: "Measured", align: "right" }, { w: 50, label: "Waste", align: "right" }, { w: 116, label: "To order", align: "right" }],
      totals.map((t) => {
        const w = settings.waste[t.kind] ?? 10; const order = withWaste(t.area_sf, w); const box = settings.box_sf[t.kind];
        return [t.label, [t.spec, t.sand_finish ? "sand & finish on site" : ""].filter(Boolean).join(" · ") || "—", sf(t.area_sf), `${w}%`, `${sf(order)}${box ? ` · ${Math.ceil(order / box)} boxes` : ""}`];
      }),
      { bold: [0, 4], total: ["Total", "", sf(totals.reduce((a, t) => a + t.area_sf, 0)), "", sf(totals.reduce((a, t) => a + withWaste(t.area_sf, settings.waste[t.kind] ?? 10), 0))] },
    );

    const quote = await planQuote(m.accountId, plan).catch(() => null);
    if (quote && quote.lines.some((l) => l.rate != null)) {
      section("Quote", `Labor at the prices agreed with ${quote.company}`);
      const total = quote.lines.reduce((a, l) => a + (l.rate != null ? l.rate * l.qty : 0), 0);
      table(
        [{ w: 250, label: "Service" }, { w: 90, label: "Qty", align: "right" }, { w: 90, label: "Price", align: "right" }, { w: 102, label: "Total", align: "right" }],
        quote.lines.map((l) => [`${l.name}${l.spec ? `\n${l.spec}` : ""}`, sf(l.qty), l.rate != null ? `${usd(l.rate)}/sq ft` : "no price", l.rate != null ? usd(l.rate * l.qty) : "—"]),
        { bold: [3], total: ["Total labor", "", "", usd(total)] },
      );
    }

    if (plan.snapshot) {
      const img = await readBuffer(plan.snapshot).catch(() => null);
      if (img) {
        const room = BOTTOM - doc.y - 16;
        const h = room >= 150 ? Math.min(220, room) : 220;
        ensure(h + 14);
        const y = doc.y;
        doc.save();
        doc.roundedRect(L, y, W, h, 10).clip();
        doc.rect(L, y, W, h).fill("#F3F1EE");
        try { doc.image(img, L, y, { fit: [W, h], align: "center", valign: "center" }); } catch { /* bad image */ }
        doc.restore();
        doc.font("Helvetica").fontSize(8).fillColor(C.muted).text("3D model built from the plans — floors colored by type", L, y + h + 4, { width: W });
        doc.y = y + h + 18;
      }
    }

    for (const lv of plan.levels.filter((l) => l.include)) {
      const rooms = lv.rooms.filter((r) => !r.exclude && plan.materials.find((x) => x.key === r.material)?.include);
      if (!rooms.length) continue;
      doc.addPage(); doc.y = 40;
      section(lv.name, `${sf(rooms.reduce((a, r) => a + r.area_sf, 0))} counted · ${rooms.length} rooms${lv.scale_auto ? " · scale read from the plan dimensions" : " · scale set by hand"}`);
      // the plan sheet, cropped to the floors, with the counted floors colored on top
      const img = lv.preview ? await readBuffer(lv.preview).catch(() => null) : null;
      if (img && lv.grid) {
        try {
          const opened = (doc as unknown as { openImage: (b: Buffer) => { width: number; height: number } }).openImage(img);
          const g = lv.grid; const cells = decodeRle(g.rle, g.w * g.h);
          let bx0 = g.w; let by0 = g.h; let bx1 = 0; let by1 = 0;
          for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (cells[y * g.w + x]) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + 1); by1 = Math.max(by1, y + 1); }
          const m6 = Math.round(6 / g.cell);
          bx0 = Math.max(0, bx0 - m6); by0 = Math.max(0, by0 - m6); bx1 = Math.min(g.w, bx1 + m6); by1 = Math.min(g.h, by1 + m6);
          const pxX = opened.width / g.w; const pxY = opened.height / g.h;
          const cw = (bx1 - bx0) * pxX; const ch = (by1 - by0) * pxY;
          const maxH = 380; const scale = Math.min(W / cw, maxH / ch);
          const dw = cw * scale; const dh = ch * scale; const x0 = L + (W - dw) / 2; const y0 = doc.y;
          doc.save();
          doc.rect(x0, y0, dw, dh).clip();
          doc.image(opened as never, x0 - bx0 * pxX * scale, y0 - by0 * pxY * scale, { width: opened.width * scale });
          for (const r of gridRects(cells, g.w, g.h, bx0, by0, bx1, by1)) {
            const mat = plan.materials[r.v - 1];
            if (!mat || !mat.include) continue;
            doc.rect(x0 + (r.x - bx0) * pxX * scale, y0 + (r.y - by0) * pxY * scale, r.w * pxX * scale, r.h * pxY * scale).fillOpacity(0.38).fill(mat.color);
          }
          doc.fillOpacity(1);
          doc.restore();
          doc.rect(x0, y0, dw, dh).lineWidth(0.6).strokeColor(C.line).stroke();
          doc.y = y0 + dh + 8;
          // legend
          let lx = L;
          for (const t of totals) {
            const lvArea = t.levels.find((l) => l.name === lv.name)?.area_sf;
            if (!lvArea) continue;
            const label = `${t.label} ${sf(lvArea)}`;
            doc.roundedRect(lx, doc.y + 1, 8, 8, 2).fill(t.color);
            doc.font("Helvetica").fontSize(8.5).fillColor(C.ink).text(label, lx + 12, doc.y, { lineBreak: false });
            lx += 24 + doc.widthOfString(label);
          }
          doc.y += 18;
        } catch { /* plan picture is optional */ }
      }
      const half = rooms.length > 12;
      const cols = [{ w: half ? 130 : 270, label: "Room" }, { w: half ? 80 : 160, label: "Floor" }, { w: half ? 56 : 102, label: "Area", align: "right" as const }];
      if (!half) {
        table(cols, rooms.map((r) => [r.name, plan.materials.find((x) => x.key === r.material)?.label || "", sf(r.area_sf)]));
      } else {
        // two columns of rooms side by side
        const rowsA = rooms.slice(0, Math.ceil(rooms.length / 2)); const rowsB = rooms.slice(rowsA.length);
        const y = doc.y; const colW = (W - 14) / 2;
        const one = (list: typeof rooms, x: number) => {
          let yy = y;
          doc.rect(x, yy, colW, 16).fill(C.soft);
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.muted).text("ROOM", x + 6, yy + 5).text("FLOOR", x + 136, yy + 5).text("AREA", x + colW - 60, yy + 5, { width: 54, align: "right" });
          yy += 16;
          list.forEach((r, i) => {
            if (i % 2) doc.rect(x, yy, colW, 16).fill("#FBFBFC");
            doc.font("Helvetica").fontSize(8.5).fillColor(C.ink).text(ascii(r.name), x + 6, yy + 4, { width: 126, lineBreak: false, ellipsis: true })
              .text(plan.materials.find((xm) => xm.key === r.material)?.label || "", x + 136, yy + 4, { width: colW - 200, lineBreak: false, ellipsis: true })
              .font("Helvetica-Bold").text(sf(r.area_sf), x + colW - 60, yy + 4, { width: 54, align: "right" });
            yy += 16;
          });
          return yy;
        };
        const ya = one(rowsA, L); const yb = one(rowsB, L + colW + 14);
        doc.y = Math.max(ya, yb) + 12;
      }
    }
  }

  /* ── work order lines ── */
  const lines = summarize(m.data);
  if (lines.length) {
    if (plan) { doc.addPage(); doc.y = 40; }
    section("For the work order", "Grouped like the order lines — what the crew needs to bring");
    table([{ w: 452, label: "Item" }, { w: 80, label: "Qty", align: "right" }], lines.map((l) => [l.text, `${l.qty.toLocaleString("en-US")} ${l.uom}`]), { bold: [1] });
  }

  /* ── stairs ── */
  for (const s of m.data.stairs) {
    ensure(120);
    const lowerFlight = s.starts_on_landing_of ? m.data.stairs.find((flight) => flight.id === s.starts_on_landing_of) : null;
    const upperFlight = m.data.stairs.find((flight) => flight.starts_on_landing_of === s.id);
    const shape = s.layout === "round"
      ? "Round stair · Ø " + fmtInches(s.round_diameter) + "\" outside · Ø " + fmtInches(s.round_center_diameter) + "\" center · " + s.round_sweep + "° sweep"
      : "Straight stair";
    section(s.name || "Stair", ascii([shape, s.species, s.finish, s.color, s.riser_material === "primed" ? "risers primed" : s.riser_material === "paint_grade" ? "risers paint grade" : s.riser_material === "none" ? "no risers" : ""].filter(Boolean).join(" · ")));
    if (s.landing.enabled) doc.font("Helvetica").fontSize(9).fillColor(C.muted).text("Landing after final component · " + fmtInches(s.landing.width) + "\" × " + fmtInches(s.landing.depth) + "\"", L);
    if (upperFlight) doc.fillColor(C.muted).text(`Upper flight starts from this landing: ${upperFlight.name || "Stair"}.`, L);
    if (lowerFlight) doc.fillColor(C.muted).text(`Starts on the landing of ${lowerFlight.name || "Stair"}.`, L);
    if (s.note) doc.fillColor(C.ink).text(ascii(s.note), L, doc.y, { width: W });
    doc.y += 4;
    const drawPanel = (title: string, height: number, draw: (x: number, y: number, width: number, height: number) => void) => {
      ensure(height + 25);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.muted).text(title.toUpperCase(), L, doc.y, { width: W, characterSpacing: 0.5 });
      const panelY = doc.y + 5;
      draw(L, panelY, W, height);
      doc.y = panelY + height + 10;
    };
    if (s.layout === "round") drawPanel("Stair plan", 112, (x, y, width, height) => drawRoundPlan(doc, s, x, y, width, height));
    const chain = connectedStairChain(m.data, s);
    const isChainRoot = chain.length > 1 && chain[0]!.id === s.id;
    if (isChainRoot) drawPanel("Connected stair sequence", 132, (x, y, width, height) => drawStairElevation(doc, chain, x, y, width, height));
    else if (chain.length === 1) drawPanel("Stair elevation", 120, (x, y, width, height) => drawStairElevation(doc, [s], x, y, width, height));
    drawPanel("Illustrated specifications", 80, (x, y, width, height) => drawIllustratedSpecs(doc, s, x, y, width, height));
    table(
      [{ w: 70, label: "Part" }, { w: 104, label: "Tread (W × D)" }, { w: 104, label: "Riser (W × H)" }, { w: 140, label: "Sides" }, { w: 114, label: "Notes" }],
      s.steps.map((st, i) => st.kind === "riser"
        ? [`Riser only ${i + 1}`, "—", st.riser_w || st.riser_h ? `${fmtInches(st.riser_w)}" × ${fmtInches(st.riser_h)}"` : "—", "—", st.note || ""]
        : [String(i + 1), st.tread_w || st.tread_d ? `${fmtInches(st.tread_w)}" × ${fmtInches(st.tread_d)}"` : "—", st.no_riser || s.riser_material === "none" ? "no riser" : st.riser_w || st.riser_h ? `${fmtInches(st.riser_w)}" × ${fmtInches(st.riser_h)}"` : "—", openLabel(st.open, st.ret), st.note || ""]),
    );
    if (s.nosings.length) {
      table(
        [{ w: 60, label: "Qty", align: "right" }, { w: 90, label: "Length" }, { w: 110, label: "Type" }, { w: 272, label: "Position / notes" }],
        s.nosings.map((n) => [String(n.qty || 1), `${fmtInches(n.length)}"`, n.type === "overlap" ? "overlap" : n.type === "stair_nose" ? "stair nose" : "flush", [nosingPosition(s, n), n.note].filter(Boolean).join(" · ")]),
      );
    }
    await photoStrip(s.photos, `Photos · ${s.name || "stair"}`);
  }

  /* ── vents: a drawing of each, then the list ── */
  if (m.data.vents.length) {
    section("Vents", `${cnt.vents} ${cnt.vents === 1 ? "vent" : "vents"} · drawn from above, sizes in inches`);
    const per = 3; const gap = 10; const cw = (W - gap * (per - 1)) / per; const chh = 150;
    for (let i = 0; i < m.data.vents.length; i += per) {
      ensure(chh + 10);
      const y = doc.y;
      m.data.vents.slice(i, i + per).forEach((v, j) => {
        const x = L + j * (cw + gap);
        doc.roundedRect(x, y, cw, chh, 8).fillAndStroke(C.soft, C.line);
        drawVent(doc, v, x + 6, y + 6, cw - 12, 92);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(C.ink).text(`${v.qty || 1} × ${v.size || "?"}`, x + 10, y + 104, { width: cw - 20, lineBreak: false });
        doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(ascii([VENT_LABEL[v.type] || v.type, [v.species, v.finish, v.color].filter(Boolean).join(" · "), v.room].filter(Boolean).join(" · ")), x + 10, y + 118, { width: cw - 20, height: 26, ellipsis: true });
      });
      doc.y = y + chh + 10;
    }
    table(
      [{ w: 50, label: "Qty", align: "right" }, { w: 70, label: "Size" }, { w: 130, label: "Type" }, { w: 152, label: "Wood" }, { w: 130, label: "Room / notes" }],
      m.data.vents.map((v) => [String(v.qty || 1), v.size || "?", VENT_LABEL[v.type] || v.type, [v.species, v.finish, v.color].filter(Boolean).join(" · ") || "—", [v.room, v.note].filter(Boolean).join(" · ")]),
    );
    await photoStrip(m.data.vents.flatMap((v) => v.photos), "Vent photos");
  }

  /* ── footer on every page ── */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 34;
    doc.moveTo(L, y - 6).lineTo(L + W, y - 6).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C.muted).text(ascii(`${m.address} · ${m.builder}`), L, y, { width: W - 80, lineBreak: false, ellipsis: true, height: 10 });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, L + W - 80, y, { width: 80, align: "right", lineBreak: false, height: 10 });
  }
  doc.end();
  return done;
}

/* ───────────────────────────── floor quote (ObraMate quote layout) ───────────────────────────── */

/**
 * The floors of a measurement as a quote, in the same layout as a quote made in ObraMate:
 * the flooring company's logo and colors on top, the builder as the client, rooms, lines and totals.
 */
export async function floorQuotePdf(member: ActiveMember, measurementId: string, linkId?: string | null): Promise<{ name: string; body: Buffer }> {
  const row = await own(member, measurementId);
  const data = parseData(row.data);
  const plan = data.plan;
  if (!plan || !plan.levels.length) throw new BuilderError(400, "Measure the floors from the plans first.");
  const usePlan = linkId && linkId !== plan.quote_link_id ? { ...plan, quote_link_id: linkId, quote_prices: {}, quote_rates: {} } : plan;
  const quote = await planQuote(member.builderAccountId, usePlan);
  const [account, link] = await Promise.all([
    prisma.builderAccount.findUnique({ where: { id: member.builderAccountId } }),
    usePlan.quote_link_id ? prisma.builderLink.findFirst({ where: { id: usePlan.quote_link_id, builderAccountId: member.builderAccountId } }) : null,
  ]);
  const org = link?.organizationId ? await prisma.organization.findUnique({ where: { id: link.organizationId }, select: { name: true, logoUrl: true, primaryColor: true, accentColor: true, contactEmail: true, contactPhone: true, quoteValidityDays: true } }) : null;
  const settings = takeoffSettings(account?.takeoffSettings);
  const totals = planTotals(plan).filter((t) => t.include);
  const lines = (quote?.lines || planTotals(plan).filter((t) => t.include).map((t) => ({ name: `${t.label} install`, spec: t.spec, qty: Math.ceil(t.area_sf), rate: null as number | null })));
  const pdfLines = lines.map((l) => ({
    name: l.name,
    description: l.spec || "",
    quantity: l.qty,
    unit: "sq_ft",
    unitPrice: l.rate ?? 0,
    amount: Math.round((l.rate ?? 0) * l.qty * 100) / 100,
    serviceType: /sand|finish/i.test(l.name) ? "refinishing" : "installation",
    itemType: "service",
  }));
  const subtotal = pdfLines.reduce((a, l) => a + l.amount, 0);
  const rooms: Array<{ name: string; areaSqft: number }> = [];
  for (const lv of plan.levels.filter((x) => x.include)) {
    for (const r of lv.rooms) {
      const mat = plan.materials.find((x) => x.key === r.material);
      if (r.exclude || !mat?.include) continue;
      rooms.push({ name: `${r.name} (${lv.name} · ${mat.label})`, areaSqft: Math.round(r.area_sf) });
    }
  }
  const materialNote = totals.map((t) => {
    const w = settings.waste[t.kind] ?? 10;
    return `${t.label}${t.spec ? ` (${t.spec})` : ""}: ${Math.round(t.area_sf).toLocaleString("en-US")} SF measured, ${withWaste(t.area_sf, w).toLocaleString("en-US")} SF to order with ${w}% waste.`;
  }).join("\n");
  const missing = lines.filter((l) => l.rate == null).length;
  const { buildQuotePdf } = await import("../quotes/pdf.js");
  const body = await buildQuotePdf({
    organizationName: org?.name || link?.companyName || "Flooring company",
    organizationContact: [org?.contactPhone || link?.contactPhone, org?.contactEmail || link?.contactEmail].filter(Boolean).join(" · ") || null,
    organizationLogoUrl: org?.logoUrl || null,
    // ObraMate palette (ink + orange) on every builder quote
    brandPrimary: "#221E1A",
    brandAccent: "#E7792C",
    title: `Flooring · ${row.address}`,
    number: `M-${row.id.slice(0, 6).toUpperCase()}`,
    status: "draft",
    issueDate: new Date(),
    validUntil: new Date(Date.now() + (org?.quoteValidityDays || 30) * 86400e3),
    customerName: account?.name || "Builder",
    customerEmail: account?.email || null,
    customerPhone: account?.phone || null,
    projectName: [row.community, row.lot ? `Lot ${row.lot}` : ""].filter(Boolean).join(" · ") || null,
    projectAddress: row.address,
    floorAreaSqft: Math.round(totals.reduce((a, t) => a + t.area_sf, 0)),
    rooms,
    optionGroups: [],
    lines: pdfLines,
    clientView: { showQuantities: true, showUnitPrices: true, showLineTotals: true, showRoomBreakdown: true },
    subtotal,
    taxTotal: 0,
    total: subtotal,
    hideOnlineApproval: true,
    inclusions: [
      ...lines.map((l) => `${l.name}${l.spec ? ` — ${l.spec}` : ""}`),
      `Quantities from the house plans: ${totals.map((t) => `${t.label} ${Math.round(t.area_sf).toLocaleString("en-US")} SF`).join(", ")}`,
    ].slice(0, 8),
    paymentSchedule: [{ label: `Per your agreement with ${org?.name || link?.companyName || "the company"}`, amount: subtotal }],
    notes: [materialNote, missing ? `${missing} line${missing === 1 ? "" : "s"} without an agreed price yet.` : "", "Measured from the house plans in ObraBuilder. Areas exclude walls; final quantities are confirmed on site."].filter(Boolean).join("\n\n"),
    terms: null,
  });
  return { name: `Quote - ${row.address}.pdf`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 150), body };
}

/** Quote PDF for a work order on the way to a company: the order's services at the agreed prices. */
export async function orderQuotePdf(
  member: ActiveMember,
  input: { linkId: string; title: string; address: string; ref?: string; items: Array<{ name: string; detail?: string; qty: number; uom: string; rate: number | null }>; measurement?: string },
): Promise<{ name: string; body: Buffer }> {
  const [account, link] = await Promise.all([
    prisma.builderAccount.findUnique({ where: { id: member.builderAccountId } }),
    prisma.builderLink.findFirst({ where: { id: input.linkId, builderAccountId: member.builderAccountId } }),
  ]);
  if (!link) throw new BuilderError(404, "Company not found.");
  const org = link.organizationId ? await prisma.organization.findUnique({ where: { id: link.organizationId }, select: { name: true, logoUrl: true, contactEmail: true, contactPhone: true, quoteValidityDays: true } }) : null;
  const unit = (u: string) => (/^sf$|sq/i.test(u) ? "sq_ft" : /^lf$|lin/i.test(u) ? "linear_ft" : "each");
  const pdfLines = input.items.slice(0, 80).map((l) => ({
    name: l.name.slice(0, 160),
    description: (l.detail || "").slice(0, 300),
    quantity: l.qty,
    unit: unit(l.uom),
    unitPrice: l.rate ?? 0,
    amount: Math.round((l.rate ?? 0) * l.qty * 100) / 100,
    serviceType: /sand|finish/i.test(l.name) ? "refinishing" : "installation",
    itemType: "service",
  }));
  const subtotal = Math.round(pdfLines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const missing = input.items.filter((l) => l.rate == null).length;
  const { buildQuotePdf } = await import("../quotes/pdf.js");
  const company = org?.name || link.companyName || "the company";
  const body = await buildQuotePdf({
    organizationName: org?.name || link.companyName || "Flooring company",
    organizationContact: [org?.contactPhone || link.contactPhone, org?.contactEmail || link.contactEmail].filter(Boolean).join(" · ") || null,
    organizationLogoUrl: org?.logoUrl || null,
    brandPrimary: "#221E1A",
    brandAccent: "#E7792C",
    title: input.title.slice(0, 160) || `Work order · ${input.address}`,
    number: input.ref ? `PO ${input.ref}`.slice(0, 40) : `WO-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    status: "draft",
    issueDate: new Date(),
    validUntil: new Date(Date.now() + (org?.quoteValidityDays || 30) * 86400e3),
    customerName: account?.name || "Builder",
    customerEmail: account?.email || null,
    customerPhone: account?.phone || null,
    projectName: null,
    projectAddress: input.address,
    floorAreaSqft: null,
    rooms: [],
    optionGroups: [],
    lines: pdfLines,
    clientView: { showQuantities: true, showUnitPrices: true, showLineTotals: true, showRoomBreakdown: false },
    subtotal,
    taxTotal: 0,
    total: subtotal,
    hideOnlineApproval: true,
    inclusions: input.items.slice(0, 8).map((l) => `${l.name}${l.detail ? ` — ${l.detail}` : ""}`),
    paymentSchedule: [{ label: `Per your agreement with ${company}`, amount: subtotal }],
    notes: [input.measurement ? `Measured on site: ${input.measurement}` : "", missing ? `${missing} line${missing === 1 ? "" : "s"} without an agreed price yet.` : ""].filter(Boolean).join("\n\n") || null,
    terms: null,
  });
  return { name: `Quote - ${input.address}.pdf`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 150), body };
}
