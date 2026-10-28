/**
 * Builder portal — reads a work order / PO / schedule export the builder already has
 * (PDF, screenshot, photo of paper or pasted e-mail text) and turns it into the fields
 * of a job request. The builder always reviews the result before anything is sent.
 */
import { z } from "zod";
import { aiChatJson, isAiConfigured } from "../ai/client.js";

/** Lines as the builder confirmed them in the portal (sent with the request). */
export const intakeItemSchema = z.object({
  area: z.string().trim().max(200).optional().default(""),
  description: z.string().trim().max(200).optional().default(""),
  detail: z.string().trim().max(200).optional().default(""),
  quantity: z.number().min(0).max(1_000_000),
  uom: z.string().trim().max(12).optional().default("SF"),
  rate: z.number().min(0).max(1_000_000).nullable().optional().default(null),
  total: z.number().min(0).max(100_000_000).nullable().optional().default(null),
  /** Service of the company's price list this line was linked to. */
  pricing_item_id: z.string().uuid().nullable().optional().default(null),
  /** Short catalog-style name, used when the service has to be created. */
  service_name: z.string().trim().max(120).optional().default(""),
  /** Unlinked line: add it to the company's services (default) or keep it on the job only. */
  create_service: z.boolean().optional().default(true),
});
export const intakeItemsSchema = z.array(intakeItemSchema).max(40);

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
  "pickup",
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

export type IntakeFields = Record<IntakeField, string>;

/** One service / labor line of the work order (what the crew does, how much, at what rate). */
export type IntakeItem = {
  /** Rooms / areas the line covers, e.g. "LL Rec Room, Hearth Room". */
  area: string;
  /** Product or service, e.g. "Paradigm Waterproof Flooring Performer 20ml – PPSPC2021 Cashew 9\"". */
  description: string;
  /** Install detail, e.g. "Attached pad", "Install moisture barrier over concrete". */
  detail: string;
  quantity: number;
  /** SF, LF, EA, SY, STEP, HR… as written. */
  uom: string;
  /** Labor rate per unit, when the order shows it. */
  rate: number | null;
  /** Line labor total, when shown. */
  total: number | null;
  /** Service of the company's price list it matches (id), or null. */
  pricing_item_id: string | null;
  /** Short generic service name ("LVP install with attached pad"), for creating it in the catalog. */
  service_name: string;
};

/** The company's services the lines are matched against. */
export type CatalogItem = { id: string; name: string; unit: string; category?: string | null };

export type IntakeResult = {
  fields: IntakeFields;
  /** Service / labor lines read from the order (empty when it has no table). */
  items: IntakeItem[];
  /** "TOTAL LABOR" printed on the order, to check the lines against. */
  labor_total: number | null;
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
- preferred_date: the job date as written (keep the text, e.g. "Monday, October 12th" or "10/12/2026"): the INSTALL DATE / start / scheduled date; when the install date is blank, use the order's "DATE BUILT" date (and add "preferred_date" to unsure)
- pickup: where the crew picks up the material, as written next to the job address or in the delivery box, usually a supplier and its order / delivery number (e.g. "TRIWEST 9176215" printed in red beside ADDRESS → "TriWest · 9176215"); add a street address only if one is printed
- square_feet: total square feet as a plain number, if shown
- material: material / wood type / product (e.g. "Engineered white oak")
- contact_name: superintendent / project manager name
- contact_phone: their phone
- contact_email: their e-mail
- notes: everything else that matters to the crew (shortages, add-ons, access, warehouse, who buys which material), short sentences
- title: a short job title: "<service_type> · <address>"
- items: array of the service / labor lines of the order, one object per line of the labor table:
  {"area": rooms covered (short, e.g. "LL Rec Room, Hearth Room, LL Bed 2 & 3, Baths, Laundry"), "description": product or service, "detail": install detail column, "quantity": number, "uom": unit as written (SF, LF, EA, SY, STEP…), "rate": labor rate per unit as a number or null, "total": line labor total as a number or null, "catalog_id": id of the matching service from the installer's catalog (given below) or null, "service_name": short generic name of the work as an installer would list it in a price list, in English, without brand / color / SKU (e.g. "LVP install with attached pad", "Moisture barrier – 6 mil poly", "End cap / transition install", "Floor protection cover")}
  Take lines from the labor / work order table. Material-only pages (purchase order, sales order, pick ticket) repeat the same products without labor: do not add those again. A line with "$ -" or no price still counts, with total null.
- labor_total: the printed labor total (e.g. "TOTAL WOOD LABOR $ 5,117.00" → 5117) as a number, or null
Documents often come from a flooring dealer / distributor (e.g. "The Colorado Floor Company") sending labor to an installer. In that case the "BUILDER:" on the page is the home builder / end client: put it in notes ("Home builder: …"), not in contact_name. "AREA #" or "Area 9" is a sales area, not a lot. The INSTALL DATE wins over "DATE BUILT"; DATE BUILT is used only when INSTALL DATE is blank.
"INSTALL DATE: TBD" (or "to be determined") means there is no date yet: leave preferred_date "" and do not use the order date.
On a "WORK ORDER" with "Sold To" and "Install At" boxes, the job address is the street line of "Install At" (with its city/state/zip); the first line there is usually "<community> #<lot>, <plan>" (e.g. "GRANBY RANCH #50, PEACH" → community "Granby Ranch", lot "50", plan "Peach"); short words like "NAIL WOOD" under it are install notes. "Sold To" is the dealer's customer, not the job. "BLDR:" in the remarks is the builder's superintendent → contact_name. "PO Number: NEED PO" means no PO yet → keep the order number (e.g. "HN001195") as external_ref.
Stair parts and vents (treads, risers, nosings, vents) are separate lines: keep their size ("48\"", "42\"", "4x10"), species and return type (e.g. "double returns", "left returns") in description/detail, with quantity and EA.
Matching to the catalog: pick the catalog service that is the same kind of work (e.g. a waterproof / LVP / SPC floor with attached pad → the LVP or vinyl plank install service; "6 mil poly" moisture barrier → moisture barrier / vapor barrier / underlayment service; end caps or transitions → transition / end cap / T-molding service; floor protection cover → floor protection service). Prefer a service whose unit fits the line's unit. Use null when nothing in the catalog is that work; never force a match.
square_feet: the main flooring square feet (the largest SF install line), not the sum of underlayment lines.
service_type: the main install, e.g. "LVP / waterproof flooring install", "Hardwood install", "Carpet install".
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
  const items = normalizeItems(raw.items);
  const laborTotal = toNumber(raw.labor_total);
  if (items.length && laborTotal != null) {
    const sum = Math.round(items.reduce((acc, it) => acc + (it.total ?? 0), 0) * 100) / 100;
    if (Math.abs(sum - laborTotal) > 0.5) {
      warnings.push(`A soma das linhas (${money(sum)}) não bate com o total da ordem (${money(laborTotal)}). Confira os serviços.`);
    }
  }
  return { fields, items, labor_total: laborTotal, check: INTAKE_FIELDS.filter((k) => check.has(k)), warnings };
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$ 3,612.00" → 3612, "$ -" / "" → null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").replace(/[,$\s]/g, "");
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Common units written on work orders → one spelling. */
export function normalizeUom(raw: string): string {
  const u = String(raw || "").trim().toUpperCase().replace(/\./g, "");
  if (["SF", "SQFT", "SQ FT", "FT2", "SQUARE FEET"].includes(u)) return "SF";
  if (["LF", "LIN FT", "LINEAR FT", "LINEAR FEET", "LNFT"].includes(u)) return "LF";
  if (["EA", "EACH", "PC", "PCS", "UNIT", "UN"].includes(u)) return "EA";
  if (["SY", "SQ YD", "SQYD", "YD2"].includes(u)) return "SY";
  if (["STEP", "STEPS", "STAIR", "STAIRS", "TREAD", "TREADS"].includes(u)) return "STEP";
  if (["HR", "HRS", "HOUR", "HOURS"].includes(u)) return "HR";
  return u.slice(0, 12);
}

/** Cleans the model's lines: numbers parsed, empty lines dropped, exact repeats merged. */
export function normalizeItems(raw: unknown): IntakeItem[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeItem[] = [];
  for (const row of raw.slice(0, 60)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const description = clean(r.description, 200);
    const detail = clean(r.detail, 200);
    const quantity = toNumber(r.quantity);
    if (!description && !detail) continue;
    if (quantity == null || quantity < 0) continue;
    let rate = toNumber(r.rate);
    let total = toNumber(r.total);
    if (total === 0 && !rate) total = null;
    if (rate == null && total != null && quantity > 0) rate = Math.round((total / quantity) * 10000) / 10000;
    if (total == null && rate != null) total = Math.round(rate * quantity * 100) / 100;
    const item: IntakeItem = { area: clean(r.area, 200), description, detail, quantity: Math.round(quantity * 100) / 100, uom: normalizeUom(clean(r.uom, 20)) || "SF", rate, total, pricing_item_id: null, service_name: clean(r.service_name, 120) };
    const same = out.find((x) => x.description.toLowerCase() === item.description.toLowerCase() && x.detail.toLowerCase() === item.detail.toLowerCase() && x.quantity === item.quantity && x.uom === item.uom);
    if (same) {
      if (same.rate == null && item.rate != null) Object.assign(same, { rate: item.rate, total: item.total });
      continue;
    }
    out.push(item);
  }
  return out.slice(0, 40);
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

/** Text printed in a PDF (helps the reader with tables; scanned pages come back empty). */
export async function pdfTextLayer(dataUrl: string, maxChars = 14_000): Promise<string> {
  try {
    const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
    if (!match) return "";
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(match[1]!, "base64")));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text])
      .map((t, i) => ({ i, t: String(t || "").replace(/[^\S\n]+/g, " ").trim() }))
      // Pages that are only a scan give a few garbage glyphs.
      .filter((p) => (p.t.match(/[A-Za-z]{3,}/g) || []).length >= 5);
    return pages.map((p) => `--- page ${p.i + 1} ---\n${p.t}`).join("\n").slice(0, maxChars);
  } catch {
    return "";
  }
}

/** Fallbacks from the PDF text when the model leaves a field empty. */
export function textLayerHints(layer: string): { pickup: string; date: string } {
  const t = String(layer || "");
  const pick = /ADDRESS:[^\n]*?\b([A-Z][A-Z-]{2,})\s+(\d{6,10})\b/.exec(t);
  const pickup = pick ? `${pick[1]!.charAt(0)}${pick[1]!.slice(1).toLowerCase()} · ${pick[2]}` : "";
  const install = /INSTALL DATE:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(t);
  const built = /DATE BUILT:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(t);
  let date = install?.[1] || built?.[1] || "";
  if (!date && /DATE BUILT:/i.test(t)) {
    // Labels and values come apart in table PDFs: take the only m/d/yyyy date on that page.
    const page = t.split(/--- page \d+ ---/).find((pg) => /DATE BUILT:/i.test(pg)) || "";
    const dates = [...new Set(page.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || [])];
    if (dates.length === 1) date = dates[0]!;
  }
  return { pickup, date };
}

/** Links each line to a catalog service: the model's choice when valid, else a name+unit match. */
export function linkCatalog(items: IntakeItem[], rawItems: unknown, catalog: CatalogItem[]): IntakeItem[] {
  if (!catalog.length) return items;
  const ids = new Set(catalog.map((c) => c.id));
  const raw = Array.isArray(rawItems) ? rawItems as Array<Record<string, unknown>> : [];
  return items.map((it) => {
    const src = raw.find((r) => clean(r?.description, 200) === it.description && clean(r?.detail, 200) === it.detail);
    const chosen = src ? String(src.catalog_id ?? "") : "";
    if (chosen && ids.has(chosen)) return { ...it, pricing_item_id: chosen };
    const sameName = it.service_name && catalog.find((c) => c.name.trim().toLowerCase() === it.service_name.trim().toLowerCase());
    if (sameName) return { ...it, pricing_item_id: sameName.id };
    const hay = new Set(`${it.description} ${it.detail}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1));
    let best: CatalogItem | null = null;
    let bestLen = 0;
    for (const c of catalog) {
      const w = c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((x) => x.length > 1);
      if (w.length >= 2 && w.every((x) => hay.has(x)) && w.length > bestLen) { best = c; bestLen = w.length; }
    }
    return { ...it, pricing_item_id: best ? best.id : null };
  });
}

export async function readWorkOrder(input: { files: IntakeFile[]; text?: string; today?: Date; catalog?: CatalogItem[] }):
  Promise<{ ok: true; result: IntakeResult; model: string } | { ok: false; error: string }> {
  const images = input.files.filter((f) => f.contentType.startsWith("image/")).map((f) => f.dataUrl);
  const pdfs = input.files.filter((f) => f.contentType === "application/pdf").map((f) => ({ filename: f.name, dataUrl: f.dataUrl }));
  const text = clean(input.text, 12_000);
  if (!images.length && !pdfs.length && !text) return { ok: false, error: "Envie um arquivo ou cole o texto do pedido." };
  const today = input.today || new Date();
  const catalog = (input.catalog || []).slice(0, 200);
  const layers = (await Promise.all(pdfs.map((f) => pdfTextLayer(f.dataUrl)))).filter(Boolean);
  const user = [
    `Today is ${today.toISOString().slice(0, 10)}.`,
    text ? `Pasted text from the builder:\n"""\n${text}\n"""` : "Read the attached work order (every page).",
    layers.length
      ? `Text layer extracted from the PDF (columns may be out of order; labels and values can be far apart — use the page images to pair them):\n"""\n${layers.join("\n").slice(0, 16_000)}\n"""`
      : "",
    catalog.length
      ? `Installer's service catalog (match each line's catalog_id to one of these ids, or null):\n${catalog.map((c) => `${c.id} | ${c.name} | unit: ${c.unit}${c.category ? ` | ${c.category}` : ""}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
  const response = await aiChatJson({ system: SYSTEM_PROMPT, user, imageUrls: images, files: pdfs, timeoutMs: 75_000 });
  if (!response.ok) return { ok: false, error: response.error };
  const raw = extractJson(response.text);
  if (!raw) return { ok: false, error: "Não consegui ler o arquivo. Confira se ele está legível." };
  const result = normalizeIntake(raw, today);
  result.items = linkCatalog(result.items, raw.items, catalog);
  const hints = textLayerHints(layers.join("\n"));
  if (!result.fields.pickup && hints.pickup) result.fields.pickup = hints.pickup;
  if (!result.fields.preferred_date && hints.date) {
    const parsed = parseWorkOrderDate(hints.date, today);
    if (parsed) {
      result.fields.preferred_date = parsed;
      if (!result.check.includes("preferred_date")) result.check.push("preferred_date");
    }
  }
  const filled = INTAKE_FIELDS.filter((k) => result.fields[k]).length + (result.items.length ? 1 : 0);
  if (filled < 2) return { ok: false, error: "Não encontrei os dados de um job neste arquivo. Preencha à mão ou envie outro arquivo." };
  return { ok: true, result, model: response.model };
}
