/**
 * Builder portal — reads a work order / PO / schedule export the builder already has
 * (PDF, screenshot, photo of paper or pasted e-mail text) and turns it into the fields
 * of a job request. The builder always reviews the result before anything is sent.
 */
import { aiChatJson, isAiConfigured } from "../ai/client.js";

export const INTAKE_FIELDS = [
  "title",
  "address",
  "community",
  "lot",
  "plan",
  "external_ref",
  "service_type",
  "preferred_date",
  "square_feet",
  "material",
  "contact_name",
  "contact_phone",
  "contact_email",
  "notes",
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

export type IntakeFields = Record<IntakeField, string>;

export type IntakeResult = {
  fields: IntakeFields;
  /** Fields the reader was unsure about — shown as "Confira" in the review. */
  check: IntakeField[];
  /** Short notes for the builder (pt-BR), e.g. how an ambiguous value was read. */
  warnings: string[];
};

const SYSTEM_PROMPT = `You read flooring work orders, purchase orders and schedule screens that home builders send to their flooring installer.
The input may be a PDF, a screenshot of the builder's scheduling system, a photo of paper, or pasted e-mail text.
Return ONLY a JSON object with these keys (strings; use "" when absent):
- address: job site street address exactly as written (e.g. "109 Evergreen Dr"); include city/state/zip only if shown
- community: subdivision / community / neighborhood name. If a value mixes a person's name and a number (e.g. "Peter Garcia #50"), put the person in contact_name and the number in lot
- lot: lot number only
- plan: house plan / model name
- external_ref: the builder's own job #, PO # or work order # (the main one, digits/letters only)
- service_type: the trade / work requested, short (e.g. "Hardwood install", "Carpet", "Tile backsplash", "Stair nosing")
- preferred_date: requested / scheduled date as written (keep the text, e.g. "Monday, October 12th" or "10/12/2026")
- square_feet: total square feet as a plain number, if shown
- material: material / wood type / product (e.g. "Engineered white oak")
- contact_name: superintendent / project manager name
- contact_phone: their phone
- contact_email: their e-mail
- notes: everything else that matters to the crew (shortages, add-ons, access, reference/ETA numbers), one or two short sentences
- title: a short job title: "<service_type> · <address>"
- unsure: array of keys you are not confident about
- warnings: array of short notes (in Brazilian Portuguese) explaining any ambiguous reading
Never invent values. Ignore page chrome (buttons, menus, battery, time of day).`;

const MAX = { title: 160, address: 300, notes: 5000, contact_email: 254, contact_phone: 40, contact_name: 120, service_type: 100 } as const;

function clean(value: unknown, max = 200): string {
  if (value == null) return "";
  const text = String(Array.isArray(value) ? value.join(", ") : value).replace(/\s+/g, " ").trim();
  return text.slice(0, max);
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, janeiro: 0, fev: 1, feb: 1, february: 1, fevereiro: 1, mar: 2, march: 2, marco: 2, "março": 2,
  apr: 3, april: 3, abr: 3, abril: 3, may: 4, mai: 4, maio: 4, jun: 5, june: 5, junho: 5, jul: 6, july: 6, julho: 6,
  aug: 7, august: 7, ago: 7, agosto: 7, sep: 8, sept: 8, september: 8, set: 8, setembro: 8, oct: 9, october: 9, out: 9, outubro: 9,
  nov: 10, november: 10, novembro: 10, dec: 11, december: 11, dez: 11, dezembro: 11,
};

function iso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m, d));
  if (date.getUTCMonth() !== m || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Picks the year that puts a month/day closest to today (work orders rarely say the year). */
function nearestYear(m: number, d: number, today: Date): number {
  const y = today.getUTCFullYear();
  const options = [y - 1, y, y + 1];
  let best = y;
  let bestDiff = Infinity;
  for (const year of options) {
    const t = Date.UTC(year, m, d);
    const diff = Math.abs(t - today.getTime());
    if (diff < bestDiff) {
      best = year;
      bestDiff = diff;
    }
  }
  return best;
}

/** "Monday, October 12th", "Oct 12", "10/12/2026", "10/12", "2026-10-12" → YYYY-MM-DD (US order for slashes). */
export function parseWorkOrderDate(raw: string, today = new Date()): string | null {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(s);
  if (m) {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    let year = m[3] ? Number(m[3]) : nearestYear(month, day, today);
    if (year < 100) year += 2000;
    return iso(year, month, day);
  }
  m = /\b([a-zç]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/.exec(s);
  if (m && MONTHS[m[1]!] !== undefined) {
    const month = MONTHS[m[1]!]!;
    const day = Number(m[2]);
    return iso(m[3] ? Number(m[3]) : nearestYear(month, day, today), month, day);
  }
  m = /\b(\d{1,2})\s+(?:de\s+)?([a-zç]{3,9})\.?(?:\s+(?:de\s+)?(\d{4}))?/.exec(s);
  if (m && MONTHS[m[2]!] !== undefined) {
    const month = MONTHS[m[2]!]!;
    const day = Number(m[1]);
    return iso(m[3] ? Number(m[3]) : nearestYear(month, day, today), month, day);
  }
  return null;
}

/** Turns the model's JSON into clean fields + which ones need a second look. */
export function normalizeIntake(raw: Record<string, unknown>, today = new Date()): IntakeResult {
  const fields = Object.fromEntries(INTAKE_FIELDS.map((key) => [key, ""])) as IntakeFields;
  for (const key of INTAKE_FIELDS) {
    fields[key] = clean(raw[key], (MAX as Record<string, number>)[key] ?? 200);
  }
  const check = new Set<IntakeField>();
  const unsure = Array.isArray(raw.unsure) ? raw.unsure.map((k) => String(k)) : [];
  for (const key of unsure) if ((INTAKE_FIELDS as readonly string[]).includes(key)) check.add(key as IntakeField);

  const sq = fields.square_feet.replace(/[^\d.]/g, "");
  fields.square_feet = sq && Number(sq) > 0 ? String(Math.round(Number(sq) * 100) / 100) : "";
  fields.external_ref = fields.external_ref.replace(/^(job|po|wo)\s*#?\s*/i, "").replace(/^#/, "").slice(0, 60);
  fields.lot = fields.lot.replace(/^(lot|lote)\s*#?\s*/i, "").replace(/^#/, "").slice(0, 20);

  if (fields.preferred_date) {
    const parsed = parseWorkOrderDate(fields.preferred_date, today);
    if (parsed) fields.preferred_date = parsed;
    else {
      fields.preferred_date = "";
      check.add("preferred_date");
    }
  }
  if (fields.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contact_email)) {
    fields.contact_email = "";
    check.add("contact_email");
  }
  if (!fields.address) check.add("address");
  if (!fields.title) {
    const parts = [fields.service_type, fields.address].filter(Boolean);
    fields.title = parts.length ? parts.join(" · ").slice(0, MAX.title) : "";
  }
  if (!fields.title) check.add("title");

  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : [])
    .map((w) => clean(w, 240))
    .filter(Boolean)
    .slice(0, 4);
  return { fields, check: INTAKE_FIELDS.filter((k) => check.has(k)), warnings };
}

const STREET_WORDS: Record<string, string> = {
  drive: "dr", street: "st", court: "ct", lane: "ln", avenue: "ave", av: "ave", road: "rd", boulevard: "blvd",
  place: "pl", circle: "cir", parkway: "pkwy", trail: "trl", way: "way", terrace: "ter", highway: "hwy",
  north: "n", south: "s", east: "e", west: "w",
};

/** "109 Evergreen Drive, Denver CO" → "109 evergreen dr" (number + street, no city). */
export function addressKey(address: string | null | undefined): string {
  const first = String(address || "").split(/,|\n/)[0]!.toLowerCase();
  const tokens = first
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => STREET_WORDS[t] || t);
  return tokens.join(" ");
}

export type MatchCandidate = {
  id: string;
  number: number | null;
  title: string;
  address: string | null;
  status: string;
  /** External refs already linked to this job through earlier requests. */
  externalRefs?: string[];
};

export type JobMatch = { id: string; number: number | null; title: string; address: string | null; reason: "ref" | "address" };

/** Same builder job # wins; otherwise the same street address on an open job. */
export function findJobMatch(candidates: MatchCandidate[], input: { address?: string; externalRef?: string }): JobMatch | null {
  const ref = String(input.externalRef || "").trim().toLowerCase();
  if (ref.length >= 3) {
    const byRef = candidates.find((job) => {
      if ((job.externalRefs || []).some((r) => r.trim().toLowerCase() === ref)) return true;
      return new RegExp(`(^|[^0-9a-z])${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9a-z]|$)`, "i").test(job.title);
    });
    if (byRef) return { id: byRef.id, number: byRef.number, title: byRef.title, address: byRef.address, reason: "ref" };
  }
  const key = addressKey(input.address);
  if (!/^\d+\s+\S+/.test(key)) return null;
  const open = candidates.filter((job) => job.status !== "canceled");
  const same = open.filter((job) => addressKey(job.address) === key);
  const pick = same.find((job) => job.status !== "completed") || same[0];
  return pick ? { id: pick.id, number: pick.number, title: pick.title, address: pick.address, reason: "address" } : null;
}

function extractJson(text: string): Record<string, unknown> | null {
  const t = String(text || "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function isIntakeReaderConfigured(): boolean {
  return isAiConfigured();
}

export type IntakeFile = { name: string; contentType: string; dataUrl: string };

export async function readWorkOrder(input: { files: IntakeFile[]; text?: string; today?: Date }):
  Promise<{ ok: true; result: IntakeResult; model: string } | { ok: false; error: string }> {
  const images = input.files.filter((f) => f.contentType.startsWith("image/")).map((f) => f.dataUrl);
  const pdfs = input.files.filter((f) => f.contentType === "application/pdf").map((f) => ({ filename: f.name, dataUrl: f.dataUrl }));
  const text = clean(input.text, 12_000);
  if (!images.length && !pdfs.length && !text) return { ok: false, error: "Envie um arquivo ou cole o texto do pedido." };
  const today = input.today || new Date();
  const user = [
    `Today is ${today.toISOString().slice(0, 10)}.`,
    text ? `Pasted text from the builder:\n"""\n${text}\n"""` : "Read the attached work order.",
  ].join("\n\n");
  const response = await aiChatJson({ system: SYSTEM_PROMPT, user, imageUrls: images, files: pdfs, timeoutMs: 75_000 });
  if (!response.ok) return { ok: false, error: response.error };
  const raw = extractJson(response.text);
  if (!raw) return { ok: false, error: "Não consegui ler o arquivo. Confira se ele está legível." };
  const result = normalizeIntake(raw, today);
  const filled = INTAKE_FIELDS.filter((k) => result.fields[k]).length;
  if (filled < 2) return { ok: false, error: "Não encontrei os dados de um job neste arquivo. Preencha à mão ou envie outro arquivo." };
  return { ok: true, result, model: response.model };
}
