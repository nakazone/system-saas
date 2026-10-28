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
  note: text(200),
});

const stairSchema = z.object({
  id,
  name: text(80),
  species: text(60),
  finish: text(60),
  color: text(80),
  riser_material: z.enum(["same", "primed", "paint_grade", "none"]).optional().default("same"),
  steps: z.array(stepSchema).max(60).optional().default([]),
  nosings: z.array(nosingSchema).max(40).optional().default([]),
  photos: z.array(photoKey).max(12).optional().default([]),
  note: text(500),
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
});
export type MeasurementData = z.infer<typeof measurementDataSchema>;
export type Stair = z.infer<typeof stairSchema>;
export type Vent = z.infer<typeof ventSchema>;

export function parseData(raw: unknown): MeasurementData {
  const parsed = measurementDataSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { stairs: [], vents: [] };
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
  none: "fechado dos dois lados",
  left: "lado esquerdo aberto",
  right: "lado direito aberto",
  both: "os dois lados abertos",
};
const RET_LABEL: Record<string, string> = { "45": "retorno 45°", flat: "retorno reto (flat)", bullnose: "bullnose" };
const OPEN_EN: Record<string, string> = { none: "", left: "left return", right: "right return", both: "double returns" };
export const VENT_LABEL: Record<string, string> = { flush: "flush mount", self_rimming: "self-rimming (drop-in)", return_air: "return air" };

export function openLabel(open: string, ret: string): string {
  if (open === "none") return OPEN_LABEL.none!;
  return `${OPEN_LABEL[open] || open} · ${RET_LABEL[ret] || ret}`;
}

export type SummaryLine = { kind: "tread" | "riser" | "nosing" | "vent"; text: string; qty: number; uom: "EA" | "LF" };

/** Groups equal pieces: "Tread White Oak 48 × 11¼ · os dois lados abertos · retorno 45° — 8 EA". */
export function summarize(data: MeasurementData): SummaryLine[] {
  const out: SummaryLine[] = [];
  for (const stair of data.stairs) {
    const wood = [stair.species, stair.finish, stair.color].filter(Boolean).join(" · ");
    const label = stair.name || "Escada";
    const treads = new Map<string, number>();
    const risers = new Map<string, number>();
    for (const st of stair.steps) {
      if (st.tread_w || st.tread_d) {
        const k = `${fmtInches(st.tread_w)} × ${fmtInches(st.tread_d)} · ${openLabel(st.open, st.ret)}`;
        treads.set(k, (treads.get(k) || 0) + 1);
      }
      if (!st.no_riser && stair.riser_material !== "none" && (st.riser_w || st.riser_h)) {
        const k = `${fmtInches(st.riser_w)} × ${fmtInches(st.riser_h)}${st.open !== "none" ? ` · ${OPEN_LABEL[st.open]}` : ""}`;
        risers.set(k, (risers.get(k) || 0) + 1);
      }
    }
    for (const [k, n] of treads) out.push({ kind: "tread", qty: n, uom: "EA", text: `${label} · Tread${wood ? ` ${wood}` : ""} ${k}` });
    const riserWood = stair.riser_material === "primed" ? "primed" : stair.riser_material === "paint_grade" ? "paint grade" : wood;
    for (const [k, n] of risers) out.push({ kind: "riser", qty: n, uom: "EA", text: `${label} · Riser${riserWood ? ` ${riserWood}` : ""} ${k}` });
    for (const ns of stair.nosings) {
      if (!ns.length) continue;
      const type = ns.type === "overlap" ? "overlap" : ns.type === "stair_nose" ? "stair nose" : "flush";
      out.push({ kind: "nosing", qty: ns.qty || 1, uom: "EA", text: `${label} · Nosing ${type}${wood ? ` ${wood}` : ""} ${fmtInches(ns.length)}"${ns.note ? ` · ${ns.note}` : ""}` });
    }
  }
  const vents = new Map<string, number>();
  for (const v of data.vents) {
    const k = `Vent ${v.size || "?"} ${VENT_LABEL[v.type] || v.type}${[v.species, v.finish, v.color].filter(Boolean).length ? ` · ${[v.species, v.finish, v.color].filter(Boolean).join(" · ")}` : ""}`;
    vents.set(k, (vents.get(k) || 0) + (v.qty || 1));
  }
  for (const [k, n] of vents) out.push({ kind: "vent", qty: n, uom: "EA", text: k });
  return out;
}

export function counts(data: MeasurementData) {
  let treads = 0;
  let risers = 0;
  let nosings = 0;
  for (const s of data.stairs) {
    for (const st of s.steps) {
      if (st.tread_w || st.tread_d) treads += 1;
      if (!st.no_riser && s.riser_material !== "none" && (st.riser_w || st.riser_h)) risers += 1;
    }
    for (const n of s.nosings) if (n.length) nosings += n.qty || 1;
  }
  const vents = data.vents.reduce((a, v) => a + (v.qty || 1), 0);
  return { stairs: data.stairs.length, treads, risers, nosings, vents };
}

/** Text for the job notes, in the words a work order uses (e.g. "48" – double returns – 8 EA"). */
export function summaryText(m: { address: string; data: MeasurementData; measuredBy: string; measuredAt: Date | null }): string {
  const lines = summarize(m.data).map((l) => `- ${l.text} — ${l.qty} ${l.uom}`);
  const who = `${m.measuredBy}${m.measuredAt ? ` em ${m.measuredAt.toISOString().slice(0, 10)}` : ""}`;
  return [`Medição do builder (${who}):`, ...lines].join("\n");
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
  if (!row) throw new BuilderError(404, "Medição não encontrada.");
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
    created_by: names.get(row.createdByMemberId) || null,
    updated_by: row.updatedByMemberId ? names.get(row.updatedByMemberId) || null : null,
    completed_by: row.completedByMemberId ? names.get(row.completedByMemberId) || null : null,
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
});

export async function createMeasurement(member: ActiveMember, raw: unknown) {
  const parsed = headSchema.safeParse(raw);
  if (!parsed.success) throw new BuilderError(400, "Informe o endereço da obra.", "address");
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
      data: { stairs: [], vents: [] },
      createdByMemberId: member.id,
      log: [logEntry(member, "criou")],
    },
  });
  return getMeasurement(member, row.id);
}

export async function saveMeasurement(member: ActiveMember, measurementId: string, raw: unknown) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "Esta medição já foi para um job. Crie uma nova para mudar.");
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const head = headSchema.partial().safeParse(body);
  const data = measurementDataSchema.safeParse(body.data ?? row.data);
  if (!head.success || !data.success) throw new BuilderError(400, "Confira as medidas e tente de novo.");
  // Photos can only point at this measurement's own files.
  const prefix = photoPrefix(row.builderAccountId, row.id);
  for (const s of data.data.stairs) s.photos = s.photos.filter((k) => k.startsWith(prefix));
  for (const v of data.data.vents) v.photos = v.photos.filter((k) => k.startsWith(prefix));
  const h = head.data;
  await prisma.builderMeasurement.update({
    where: { id: row.id },
    data: {
      ...(h.address ? { address: h.address, addressKey: addressKey(h.address) } : {}),
      ...(h.community !== undefined ? { community: h.community || null } : {}),
      ...(h.lot !== undefined ? { lot: h.lot || null } : {}),
      ...(h.notes !== undefined ? { notes: h.notes || null } : {}),
      data: data.data,
      updatedByMemberId: member.id,
      // One log line per person per hour is enough for "who measured".
      log: shouldLogEdit(row.log, member.id) ? appendLog(row.log, logEntry(member, "editou")) : (row.log as never),
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
  if (row.status === "used") throw new BuilderError(409, "Esta medição já foi para um job.");
  const data = parseData(row.data);
  if (done && !data.stairs.length && !data.vents.length) throw new BuilderError(400, "Meça pelo menos uma escada ou um vent.");
  await prisma.builderMeasurement.update({
    where: { id: row.id },
    data: done
      ? { status: "done", completedAt: new Date(), completedByMemberId: member.id, log: appendLog(row.log, logEntry(member, "concluiu")) }
      : { status: "draft", completedAt: null, completedByMemberId: null, log: appendLog(row.log, logEntry(member, "reabriu")) },
  });
  return getMeasurement(member, row.id);
}

export async function deleteMeasurement(member: ActiveMember, measurementId: string) {
  const row = await own(member, measurementId);
  if (row.status === "used") throw new BuilderError(409, "Esta medição já está num job e não pode ser apagada.");
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
  if (row.status === "used") throw new BuilderError(409, "Esta medição já foi para um job.");
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) throw new BuilderError(400, "Foto inválida.");
  const contentType = m[1]!.toLowerCase();
  if (!PHOTO_TYPES.has(contentType)) throw new BuilderError(400, "Use foto JPG, PNG ou WebP.");
  const body = Buffer.from(m[2]!, "base64");
  if (body.length > 8 * 1024 * 1024) throw new BuilderError(400, "Foto maior que 8 MB.");
  const okSig = contentType === "image/png" ? body.subarray(0, 4).toString("hex") === "89504e47"
    : contentType === "image/jpeg" ? body.subarray(0, 3).toString("hex") === "ffd8ff"
      : body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP";
  if (!okSig) throw new BuilderError(400, "O arquivo não parece uma foto.");
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `${photoPrefix(row.builderAccountId, row.id)}${Date.now()}-${randomBytes(5).toString("hex")}.${ext}`;
  await storage.upload({ key, body, contentType });
  return { key };
}

export async function photoStream(member: ActiveMember, measurementId: string, key: string) {
  const row = await own(member, measurementId);
  if (!key.startsWith(photoPrefix(row.builderAccountId, row.id)) || key.includes("..")) throw new BuilderError(404, "Foto não encontrada.");
  const stream = await storage.getStream(key);
  if (!stream) throw new BuilderError(404, "Foto não encontrada.");
  const ext = key.split(".").pop();
  return { stream, contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
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
  return { id: p.id, address: p.address, status: p.status, counts: p.counts, summary: p.summary, measured_by: p.completed_by || p.updated_by || p.created_by, measured_at: pick.completedAt || pick.updatedAt, used_at: p.used_at };
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
  const measuredBy = (row.completedByMemberId && names.get(row.completedByMemberId)) || (row.updatedByMemberId && names.get(row.updatedByMemberId)) || names.get(row.createdByMemberId) || "Builder";
  const account = await prisma.builderAccount.findUnique({ where: { id: accountId }, select: { name: true } });
  const pdf = await measurementPdf({ builder: account?.name || "Builder", address: row.address, community: row.community, lot: row.lot, notes: row.notes, data, measuredBy, measuredAt: row.completedAt || row.updatedAt });
  const files: MeasurementPack["files"] = [{ name: `Medicao - ${row.address}.pdf`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 150), contentType: "application/pdf", body: pdf }];
  let n = 0;
  const photo = async (key: string, label: string) => {
    if (n >= 20) return;
    const body = await readBuffer(key).catch(() => null);
    if (!body) return;
    n += 1;
    const ext = key.split(".").pop() || "jpg";
    files.push({ name: `${label} ${n}.${ext}`.slice(0, 150), contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", body });
  };
  for (const s of data.stairs) for (const k of s.photos) await photo(k, `Foto ${s.name || "escada"}`);
  for (const v of data.vents) for (const k of v.photos) await photo(k, `Foto vent ${v.room || v.size}`);
  return { text: summaryText({ address: row.address, data, measuredBy, measuredAt: row.completedAt || row.updatedAt }), summary: summarize(data), files };
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
      log: appendLog(row.log, { at: new Date().toISOString(), member_id: "", name: memberName, action: "enviou com a work order" }),
    },
  });
}

/* ───────────────────────────── PDF ───────────────────────────── */

/** PDF fonts have no ⅛-style glyphs: "11¼" → "11-1/4". */
function ascii(text: string): string {
  const map: Record<string, string> = { "¼": "1/4", "½": "1/2", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅓": "1/3", "⅔": "2/3" };
  return text.replace(/(\d)?([¼½¾⅛⅜⅝⅞⅓⅔])/g, (_m, d: string | undefined, f: string) => `${d ? `${d}-` : ""}${map[f]}`);
}

export async function measurementPdf(m: { builder: string; address: string; community: string | null; lot: string | null; notes: string | null; data: MeasurementData; measuredBy: string; measuredAt: Date | null }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ink = "#221E1A";
  const muted = "#667085";
  const line = "#E5E7EB";
  const W = doc.page.width - 80;

  doc.fillColor(muted).fontSize(9).text(`MEDIÇÃO DE ESCADAS E VENTS · ${m.builder}`, 40, 40);
  doc.fillColor(ink).fontSize(18).font("Helvetica-Bold").text(m.address, 40, 54, { width: W });
  doc.font("Helvetica").fontSize(10).fillColor(muted)
    .text([m.community, m.lot ? `Lote ${m.lot}` : "", `Medido por ${m.measuredBy}${m.measuredAt ? ` em ${m.measuredAt.toISOString().slice(0, 10)}` : ""}`].filter(Boolean).join(" · "), { width: W });
  if (m.notes) doc.moveDown(0.3).fillColor(ink).text(m.notes, { width: W });
  doc.moveDown(0.8);

  const ensure = (h: number) => { if (doc.y + h > doc.page.height - 50) doc.addPage(); };
  const rule = () => { doc.strokeColor(line).lineWidth(0.6).moveTo(40, doc.y).lineTo(40 + W, doc.y).stroke(); };

  // Summary first: what the crew must bring.
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ink).text("Resumo");
  doc.moveDown(0.2);
  for (const l of summarize(m.data)) {
    const t = ascii(l.text);
    doc.font("Helvetica").fontSize(9.5);
    const h = doc.heightOfString(t, { width: W - 70 });
    ensure(h + 6);
    const y = doc.y;
    doc.fillColor(ink).text(t, 40, y, { width: W - 70 });
    doc.font("Helvetica-Bold").text(`${l.qty} ${l.uom}`, 40 + W - 60, y, { width: 60, align: "right" });
    doc.y = y + h + 5;
  }
  doc.moveDown(0.6);

  for (const s of m.data.stairs) {
    ensure(60);
    rule();
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(ink).text(s.name || "Escada", 40);
    doc.font("Helvetica").fontSize(9).fillColor(muted).text([s.species, s.finish, s.color, s.riser_material === "primed" ? "risers primed" : s.riser_material === "paint_grade" ? "risers paint grade" : s.riser_material === "none" ? "sem risers" : ""].filter(Boolean).join(" · ") || "—");
    if (s.note) doc.fillColor(ink).text(s.note, { width: W });
    doc.moveDown(0.3);
    const cols = [40, 66, 170, 274, 470];
    const head = ["#", "Tread (L × P)", "Riser (L × A)", "Lados", "Obs."];
    ensure(14);
    let y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(muted);
    head.forEach((h, i) => doc.text(h, cols[i]!, y, { width: (cols[i + 1] ?? 40 + W) - cols[i]! - 4 }));
    doc.y = y + 14;
    s.steps.forEach((st, i) => {
      y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor(ink);
      const raw = [
        String(i + 1),
        st.tread_w || st.tread_d ? `${fmtInches(st.tread_w)}" × ${fmtInches(st.tread_d)}"` : "—",
        st.no_riser || s.riser_material === "none" ? "sem riser" : st.riser_w || st.riser_h ? `${fmtInches(st.riser_w)}" × ${fmtInches(st.riser_h)}"` : "—",
        openLabel(st.open, st.ret),
        st.note || "",
      ];
      const cells = raw.map(ascii);
      const h = Math.max(12, ...cells.map((c, j) => doc.heightOfString(c || " ", { width: (cols[j + 1] ?? 40 + W) - cols[j]! - 4 })));
      if (y + h > doc.page.height - 50) { doc.addPage(); y = doc.y; }
      cells.forEach((c, j) => { if (c) doc.text(c, cols[j]!, y, { width: (cols[j + 1] ?? 40 + W) - cols[j]! - 4 }); });
      doc.y = y + h + 3;
    });
    if (s.nosings.length) {
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ink).text("Nosings", 40);
      for (const n of s.nosings) {
        ensure(12);
        doc.font("Helvetica").fontSize(9).text(ascii(`${n.qty || 1} × ${fmtInches(n.length)}" · ${n.type === "overlap" ? "overlap" : n.type === "stair_nose" ? "stair nose" : "flush"}${n.note ? ` · ${n.note}` : ""}`), 50);
      }
    }
    doc.moveDown(0.6);
  }

  if (m.data.vents.length) {
    ensure(50);
    rule();
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(ink).text("Vents", 40);
    doc.moveDown(0.2);
    for (const v of m.data.vents) {
      ensure(14);
      doc.font("Helvetica").fontSize(9.5).fillColor(ink)
        .text(`${v.qty || 1} × ${v.size || "?"} · ${VENT_LABEL[v.type] || v.type}${[v.species, v.finish, v.color].filter(Boolean).length ? ` · ${[v.species, v.finish, v.color].filter(Boolean).join(" · ")}` : ""}${v.room ? ` · ${v.room}` : ""}${v.note ? ` · ${v.note}` : ""}`, 40, doc.y, { width: W });
    }
  }
  doc.end();
  return done;
}
