import { createHash } from "node:crypto";
/**
 * Builder portal — reads a work order / PO / schedule export the builder already has
 * (PDF, screenshot, photo of paper or pasted e-mail text) and turns it into the fields
 * of a job request. The builder always reviews the result before anything is sent.
 */
import { z } from "zod";
import { aiChatJson, isAiConfigured } from "../ai/client.js";
import { zoomStrips } from "./zoom.js";
import { getPack } from "../trades/index.js";

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
  /** Short notes for the builder (English), e.g. how an ambiguous value was read. */
  warnings: string[];
  /** Stair pieces per tread width (one entry per flight), for building the measurement. */
  stairs?: StairFlightSpec[];
  /** "site" when the stair treads are sanded and finished on site, "prefinished", or "". */
  stair_finish?: "site" | "prefinished" | "";
};

export type StairFlightSpec = { width: number; returns: "double" | "left" | "right" | "none"; treads: number; risers: number; species: string };

/** The work order reading prompt comes from the trade pack (hardwood: flooring WOs, stairs, sand & finish). */
const SYSTEM_PROMPT = getPack().ai.workOrderPrompt;

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
  const items = normalizeInstallationItems(raw.items, raw);
  // what is printed wins over what the model summarized (the same file always gives the same stairs)
  const printed = stairFlightsFromText(intakeSourceText(raw));
  const rowsRead = stairFlightsFromRows(intakeSourceText(raw));
  const aiStairs = normalizeStairs(raw.stairs);
  const stairsEarly = reconcileFlights(mergeStairs(printed.length ? printed : rowsRead, aiStairs), [printed, rowsRead, aiStairs], warnings);
  // tread install lines follow the reconciled flights (one misread "9" doesn't make a 9-tread flight)
  for (const it of items) {
    if (serviceKind(`${it.service_name} ${it.description} ${it.detail}`) !== "stair_tread") continue;
    const w = Number((/\b(\d{2}(?:\.\d+)?)\s*(?:"|”|“|″|inch(?:es)?\b|in\b)/i.exec(`${it.service_name} ${it.description} ${it.detail}`) || [])[1] || 0);
    const f = w ? stairsEarly.filter((x) => x.width === w) : stairsEarly.length === 1 ? stairsEarly : [];
    const want = f.reduce((a, x) => a + x.treads, 0);
    if (want && it.quantity !== want) {
      warnings.push(`${w ? `${w}" ` : ""}tread line read as ${it.quantity}; set to the ${want} treads of that flight.`);
      it.quantity = want;
      if (it.rate != null) it.total = Math.round(it.rate * want * 100) / 100;
    }
  }
  const sandRow = stairSandRow(intakeSourceText(raw));
  let sandItem = items.find((it) => serviceKind(`${it.service_name} ${it.description} ${it.detail}`) === "stair_sand_finish");
  const treadsTotal = stairsEarly.reduce((a, f) => a + f.treads, 0);
  const risersTotal = stairsEarly.reduce((a, f) => a + f.risers, 0);
  if (!sandItem && sandRow) {
    sandItem = { area: "Stairs", description: sandRow.text.slice(0, 160), detail: "", quantity: sandRow.qty || treadsTotal, uom: "STEP", rate: sandRow.rate, total: sandRow.total, pricing_item_id: null, service_name: "Sand & finish stair treads" };
    items.push(sandItem);
  }
  if (sandItem) {
    // the printed row wins when its numbers check out (qty × rate = labor); the item code ("92")
    // or the coats ("SAND/2 COAT") are not the step count
    if (sandRow && sandRow.qty && sandRow.rate != null && sandRow.total != null) {
      sandItem.quantity = sandRow.qty; sandItem.rate = sandRow.rate; sandItem.total = sandRow.total;
    } else {
      if (sandRow?.qty && !sandItem.quantity) sandItem.quantity = sandRow.qty;
      if (sandItem.rate == null && sandRow?.rate != null) sandItem.rate = sandRow.rate;
      if (sandItem.total == null && sandRow?.total != null) sandItem.total = sandRow.total;
      // labor ÷ rate gives the steps when both are printed (800.00 ÷ 50.000 = 16)
      const byMoney = sandItem.rate && sandItem.total ? sandItem.total / sandItem.rate : 0;
      if (byMoney && Math.abs(byMoney - Math.round(byMoney)) < 0.01 && byMoney <= 500 && (!treadsTotal || (byMoney >= treadsTotal / 2 && byMoney <= treadsTotal + risersTotal))) {
        sandItem.quantity = Math.round(byMoney);
      }
      // no trustworthy row: the steps sanded are the treads of the order
      const q = Number(sandItem.quantity) || 0;
      if (treadsTotal && (q < treadsTotal / 2 || q > treadsTotal + risersTotal)) {
        warnings.push(`Stair sanding read as ${q || "no"} steps; set to the ${treadsTotal} treads on the order.`);
        sandItem.quantity = treadsTotal;
        if (sandItem.rate != null) sandItem.total = Math.round(sandItem.rate * treadsTotal * 100) / 100;
      }
    }
    sandItem.uom = "STEP";
    if (stairsEarly.length && treadsTotal) {
      // spell out what is sanded: the treads of each flight
      const per = stairsEarly.filter((f) => f.treads).map((f) => `${f.width}" ${f.treads}`).join(" + ");
      const note = `Treads: ${per} = ${treadsTotal}${risersTotal ? ` (risers ${risersTotal} not on this line)` : ""}`;
      if (!sandItem.detail.includes("Treads:")) sandItem.detail = [sandItem.detail, note].filter(Boolean).join(" · ").slice(0, 200);
    }
  }
  const laborTotal = toNumber(raw.labor_total);
  if (items.length && laborTotal != null) {
    const sum = Math.round(items.reduce((acc, it) => acc + (it.total ?? 0), 0) * 100) / 100;
    if (Math.abs(sum - laborTotal) > 0.5) {
      warnings.push(`A soma das linhas (${money(sum)}) não bate com o total da ordem (${money(laborTotal)}). Confira os serviços.`);
    }
  }
  const stairs = stairsEarly;
  const rf = String(raw.stair_finish || "").toLowerCase();
  const stair_finish: IntakeResult["stair_finish"] = items.some((it) => serviceKind(`${it.service_name} ${it.description} ${it.detail}`) === "stair_sand_finish") || rf === "site" ? "site" : rf === "prefinished" ? "prefinished" : "";
  return { fields, items, labor_total: laborTotal, check: INTAKE_FIELDS.filter((k) => check.has(k)), warnings, stairs, stair_finish };
}

function normalizeStairs(value: unknown): StairFlightSpec[] {
  if (!Array.isArray(value)) return [];
  const out: StairFlightSpec[] = [];
  for (const v of value.slice(0, 8)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const width = Number(String(r.width ?? "").replace(/[^\d.]/g, ""));
    const treads = Math.round(Number(r.treads) || 0);
    const risers = Math.round(Number(r.risers) || 0);
    if (!(width >= 18 && width <= 96) || (!treads && !risers) || treads > 60 || risers > 61) continue;
    const ret = String(r.returns || "").toLowerCase();
    out.push({ width, returns: /double|both/.test(ret) ? "double" : /left/.test(ret) ? "left" : /right/.test(ret) ? "right" : "none", treads, risers, species: clean(r.species, 40) });
  }
  return out;
}

/** The stair sand & finish row of the order, with its quantity, rate and labor when printed:
 * "SITE FINISHED SAND/2 COAT TREADS - CUSTOM/FR&MOUNTAIN  EA  16.00  50.000  800.00" → 16 × $50 = $800. */
export function stairSandRow(source: string): { text: string; qty: number | null; rate: number | null; total: number | null } | null {
  const lines = String(source || "").split(/\n+/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // a row may wrap: join it with the next line or two
    const joined = [line, lines[i + 1] || "", lines[i + 2] || ""].join(" ").replace(/\s+/g, " ");
    if (!/sand|finish|coat|stain|refinish/i.test(line)) continue;
    // the row itself, or with its wrapped second line ("SITE FINISHED SAND/2" + "COAT TREADS -")
    const kind = serviceKind(line) === "stair_sand_finish" ? "stair_sand_finish" : serviceKind(`${line} ${(lines[i + 1] || "").slice(0, 40)}`);
    if (kind !== "stair_sand_finish") continue;
    const nums = [...joined.matchAll(/(?<![\w"])(\d{1,5}(?:,\d{3})*(?:\.\d+)?)(?![\w"/'])/g)].map((m) => Number(m[1]!.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
    // quantity · rate · labor, where qty × rate ≈ labor
    for (let k = 0; k + 2 < nums.length; k++) {
      const [q, r, t] = [nums[k]!, nums[k + 1]!, nums[k + 2]!];
      if (q > 0 && q <= 500 && r > 0 && Math.abs(q * r - t) < 0.6) return { text: line.trim(), qty: q, rate: r, total: t };
    }
    const q = /(\d{1,3}(?:\.\d+)?)\s*(?:EA|STEPS?|PCS?)\b|\b(?:EA|STEPS?)\s+(\d{1,3}(?:\.\d+)?)\b/i.exec(joined);
    return { text: line.trim(), qty: q ? Number(q[1] || q[2]) : null, rate: null, total: null };
  }
  return null;
}

/** Stairs from the product rows when there is no STAIR TREADS block: 'UNITY HARDWOODS 48" WHITE OAK TREAD … 8.00'. */
export function stairFlightsFromRows(source: string): StairFlightSpec[] {
  const flights: StairFlightSpec[] = [];
  const species = (String(source).match(/white oak|red oak|hickory|maple|walnut|ash|birch|acacia/i) || [""])[0].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const all = String(source || "").split(/\n+/);
  for (let li = 0; li < all.length; li++) {
    let line = all[li]!;
    // the item's second line ("WHITE OAK TREAD") is often printed under the row with the numbers
    const nx = all[li + 1] || "";
    if (!/\bTREADS?\b|\bRISERS?\b/i.test(line) && /\bTREADS?\b|\bRISERS?\b/i.test(nx) && !/\d/.test(nx.replace(/\b\d{2}\s*(?:"|”|″)/g, ""))) line = `${line} ${nx}`;
    if (/sand|finish|coat|stain|nos(e|ing)/i.test(line)) continue;
    const w = /\b(\d{2}(?:\.\d+)?)\s*(?:"|”|″|IN\b|INCH)/i.exec(line);
    const isT = /\bTREADS?\b/i.test(line); const isR = /\bRISERS?\b/i.test(line);
    if (!w || (!isT && !isR)) continue;
    const width = Number(w[1]); if (width < 18 || width > 96) continue;
    const q = [...line.matchAll(/(?<![\w"])(\d{1,2})(?:\.0+)?(?![\w"/'])/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n !== width).pop();
    if (!q) continue;
    const r = /\b(DOUBLE|LEFT|RIGHT)\s+RETURNS?\b/i.exec(line);
    const returns: StairFlightSpec["returns"] = r ? (r[1]!.toLowerCase() as StairFlightSpec["returns"]) : "none";
    let f = flights.find((x) => x.width === width);
    if (!f) { f = { width, returns, treads: 0, risers: 0, species }; flights.push(f); }
    if (isT) f.treads += q; else f.risers += q;
    if (f.returns === "none" && returns !== "none") f.returns = returns;
  }
  return flights.filter((f) => f.treads || f.risers);
}

/** "STAIR TREADS: … 48\" - DOUBLE RETURNS - 8 EA" and "STAIR RISERS: … 48\" - … - 9 EA" read straight from the text. */
export function stairFlightsFromText(source: string): StairFlightSpec[] {
  const block = (label: RegExp, stop: RegExp) => {
    const m = label.exec(source);
    if (!m) return "";
    const rest = source.slice(m.index + m[0].length);
    const st = stop.exec(rest);
    return st ? rest.slice(0, st.index) : rest.slice(0, 600);
  };
  const stops = /\b(?:STAIR\s+(?:TREADS?|RISERS?)|INSTALL(?:ATION)?\s+(?:WOOD\s+)?VENTS?|SITE\s+FINISHED|SAND\s*(?:&|AND|\/)|\d{2}\/\d{2}\/\d{2})\b/i;
  const treads = block(/\bSTAIR\s+TREADS?\s*:?/i, stops);
  const risers = block(/\bSTAIR\s+RISERS?\s*:?/i, stops);
  const lineRe = /(\d{2}(?:\.\d+)?)\s*(?:"|”|“|″|INCH(?:ES)?\b|IN\b)?\s*[-–—:]?\s*(?:(DOUBLE|LEFT|RIGHT|SINGLE|NO|OPEN)\s+(?:SIDE\s+)?RETURNS?\s*[-–—:]*)?\s*(\d{1,2})\s*(?:EA|EACH|PCS?)\b/gi;
  const species = (source.match(/white oak|red oak|hickory|maple|walnut|ash|birch|acacia/i) || [""])[0].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  // one flight per tread width + return type, in the order the work order lists them
  const flights: StairFlightSpec[] = [];
  for (const m of treads.matchAll(lineRe)) {
    const w = Number(m[1]); if (w < 18 || w > 96) continue;
    const r = (m[2] || "").toLowerCase();
    const returns: StairFlightSpec["returns"] = r === "double" ? "double" : r === "left" ? "left" : r === "right" ? "right" : "none";
    const hit = flights.find((x) => x.width === w && x.returns === returns);
    if (hit) hit.treads += Number(m[3]);
    else flights.push({ width: w, returns, treads: Number(m[3]), risers: 0, species });
  }
  const riserBy = new Map<number, number>();
  for (const m of risers.matchAll(lineRe)) {
    const w = Number(m[1]); if (w < 18 || w > 96) continue;
    riserBy.set(w, (riserBy.get(w) || 0) + Number(m[3]));
  }
  for (const [w, n] of riserBy) {
    const same = flights.filter((x) => x.width === w);
    if (!same.length) { flights.push({ width: w, returns: "none", treads: 0, risers: n, species }); continue; }
    let left = n;
    same.forEach((x, i) => { const give = i === same.length - 1 ? left : Math.min(left, x.treads + 1); x.risers += give; left -= give; });
  }
  return flights;
}

/**
 * The same counts are printed twice on these orders (the STAIR TREADS / RISERS remarks and the
 * product rows), and the model gives its own: per flight, the count most of them agree on wins,
 * and a flight has one more riser than treads when two readings disagree.
 */
export function reconcileFlights(base: StairFlightSpec[], sources: StairFlightSpec[][], warnings?: string[]): StairFlightSpec[] {
  return base.map((f) => {
    const same = sources.map((src) => src.find((x) => x.width === f.width && (x.returns === f.returns || x.returns === "none" || f.returns === "none"))).filter((x): x is StairFlightSpec => Boolean(x));
    const pick = (vals: number[], fits: (v: number) => boolean, cur: number): number => {
      const seen = vals.filter((v) => v > 0);
      if (!seen.length) return cur;
      const tally = new Map<number, number>();
      for (const v of seen) tally.set(v, (tally.get(v) || 0) + 1);
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      // the readings that fit "one more riser than treads" first (votes are not independent: the
      // model often repeats its own misread), then the most common one
      const fitting = ranked.filter(([v]) => fits(v));
      return (fitting[0] || ranked[0])![0];
    };
    const treads = pick(same.map((x) => x.treads), (t) => same.some((x) => x.risers === t + 1), f.treads);
    const risers = pick(same.map((x) => x.risers), (r) => r === treads + 1, f.risers);
    if ((treads !== f.treads || risers !== f.risers) && warnings) {
      warnings.push(`${f.width}" flight read as ${f.treads} treads · ${f.risers} risers in one place; the order's other counts say ${treads} treads · ${risers} risers.`);
    }
    return { ...f, treads, risers };
  });
}

/** AI flights first; the text fills what the AI left out (risers, returns). */
export function mergeStairs(ai: StairFlightSpec[], text: StairFlightSpec[]): StairFlightSpec[] {
  const out = ai.map((x) => ({ ...x }));
  for (const t of text) {
    const hit = out.find((x) => x.width === t.width && (x.returns === t.returns || x.returns === "none" || t.returns === "none"));
    if (!hit) { out.push(t); continue; }
    if (!hit.treads && t.treads) hit.treads = t.treads;
    if (!hit.risers && t.risers) hit.risers = t.risers;
    if (hit.returns === "none" && t.returns !== "none") hit.returns = t.returns;
    if (!hit.species && t.species) hit.species = t.species;
  }
  return out;
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

type StairTreadInstruction = { size: string; returns: string; quantity: number };

/**
 * These work orders often put the requested work in remarks and the component counts in
 * the product table. Build a compact text view of both so those remarks can override
 * material-only tread/riser rows when creating the service lines.
 */
function intakeSourceText(raw: Record<string, unknown>): string {
  const values = [raw.raw_text, raw.notes, raw.comments, raw.additional_notes, raw.work_description, raw.description]
    .filter((value): value is string => typeof value === "string");
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      values.push(...[row.description, row.detail, row.service_name].filter((value): value is string => typeof value === "string"));
    }
  }
  return values.join("\n");
}

/** Reads lines like `48\" - DOUBLE RETURNS - 8 EA` from a STAIR TREADS scope block. */
function stairTreadInstructions(source: string): StairTreadInstruction[] {
  const start = /\bSTAIR\s+TREADS?\b\s*:?/i.exec(source);
  if (!start) return [];
  const rest = source.slice(start.index + start[0].length);
  const stop = /\b(?:STAIR\s+RISERS?|INSTALL(?:ATION)?\s+(?:WOOD\s+)?VENTS?|SITE\s+FINISHED|SAND\s*(?:&|AND|\/))\b/i.exec(rest);
  const section = stop ? rest.slice(0, stop.index) : rest.slice(0, 1800);
  const re = /\b(\d{2}(?:\.\d+)?)\s*(?:"|”|“|″|′′|INCH(?:ES)?\b|IN\b)?\s*[-–—:]?\s*(?:(DOUBLE|LEFT|RIGHT|SINGLE|NO|OPEN)\s+(?:SIDE\s+)?RETURNS?|CLOSED|BOX(?:ED)?)\s*[-–—:]*\s*(\d+(?:\.\d+)?)\s*(?:EA|EACH|PCS?|STEPS?)\b/gi;
  const found: StairTreadInstruction[] = [];
  for (const match of section.matchAll(re)) {
    const quantity = Number(match[3]);
    const width = Number(match[1]);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10_000 || width < 18 || width > 96) continue;
    const kind = (match[2] || "").toLowerCase();
    const returns = !kind || kind === "no" ? "No Returns" : `${kind[0]!.toUpperCase()}${kind.slice(1)} Returns`;
    const item = { size: match[1]!, returns, quantity };
    if (!found.some((x) => x.size === item.size && x.returns === item.returns)) found.push(item);
  }
  return found;
}

/** Converts work-order components into the installer's service-level lines. */
function normalizeInstallationItems(rawItems: unknown, raw: Record<string, unknown>): IntakeItem[] {
  let items = normalizeItems(rawItems);
  const source = intakeSourceText(raw);
  const treadSpecs = stairTreadInstructions(source);

  if (treadSpecs.length) {
    const treadRows = items.filter((item) => /\btreads?\b/i.test(`${item.description} ${item.detail}`) && !/\b(?:sand|finish)\b/i.test(`${item.description} ${item.detail}`));
    const instructionRows = treadSpecs.map((spec): IntakeItem => {
      const matching = treadRows.find((item) => new RegExp(`\\b${spec.size}\\s*(?:[\"”]|inch)?`, "i").test(`${item.description} ${item.detail}`));
      return {
        area: matching?.area || "",
        description: matching?.description || "Stair tread installation",
        detail: [matching?.detail, `${spec.size}\" · ${spec.returns}`].filter(Boolean).join(" · ").slice(0, 200),
        quantity: spec.quantity,
        uom: "STEP",
        rate: matching?.rate ?? null,
        total: matching?.total ?? null,
        pricing_item_id: null,
        service_name: `Stair tread installation — ${spec.size}\" ${spec.returns}`,
      };
    });
    const isStairComponent = (item: IntakeItem) => /\b(?:treads?|risers?)\b/i.test(`${item.description} ${item.detail}`)
      && !/\b(?:sand|finish)\b/i.test(`${item.description} ${item.detail}`);
    items = [
      ...items.filter((item) => {
        if (!isStairComponent(item)) return true;
        if (/\brisers?\b/i.test(`${item.description} ${item.detail}`)) {
          // Keep risers only when the order explicitly describes a separate riser labor line.
          const explicitRiserLabor = /\briser\s+(?:install(?:ation)?|labor|labour)\b/i.test(`${item.description} ${item.detail}`)
            || (item.total != null && item.total > 0);
          return explicitRiserLabor;
        }
        return false;
      }),
      ...instructionRows,
    ].slice(0, 40);
  } else if (items.some((item) => /\btreads?\b/i.test(`${item.description} ${item.detail}`))) {
    items = items.filter((item) => {
      if (!/\brisers?\b/i.test(`${item.description} ${item.detail}`)) return true;
      const explicitRiserLabor = /\briser\s+(?:install(?:ation)?|labor|labour)\b/i.test(`${item.description} ${item.detail}`)
        || (item.total != null && item.total > 0);
      return explicitRiserLabor;
    });
  }

  return items.map((item) => {
    const text = `${item.description} ${item.detail} ${item.service_name}`;
    const size = /\b(\d{1,2})\s*[x×]\s*(\d{1,2})\b/i.exec(text);
    if (/\bvents?\b/i.test(text)) {
      const dimensions = size ? `${size[1]}x${size[2]}` : "";
      return {
        ...item,
        uom: "EA",
        service_name: `Wood vent installation${dimensions ? ` — ${dimensions}` : ""}`,
      };
    }
    if (serviceKind(text) === "stair_sand_finish") {
      return { ...item, uom: "STEP", service_name: "Sand & finish stair treads" };
    }
    if (/\b(?:treads?|steps?)\b/i.test(text) && !/\b(?:sand|finish)\b/i.test(text)) {
      const dimension = /\b(\d{2}(?:\.\d+)?)\s*(?:"|”|“|″|inch(?:es)?\b|in\b)/i.exec(text)?.[1];
      const returnType = /\b(double|left|right|single)\s+returns?\b/i.exec(text)?.[1];
      const label = [dimension ? `${dimension}\"` : "", returnType ? `${returnType[0]!.toUpperCase()}${returnType.slice(1).toLowerCase()} Returns` : ""].filter(Boolean).join(" ");
      return { ...item, uom: "STEP", service_name: `Stair tread installation${label ? ` — ${label}` : ""}` };
    }
    return item;
  });
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
export type ServiceKind = "stair_sand_finish" | "stair_tread" | "stair_riser" | "nosing" | "vent" | "floor_sand_finish" | "other";
/** What kind of work a line or a price-list service is, whatever the wording. */
export function serviceKind(text: string): ServiceKind {
  const t = String(text || "").toLowerCase();
  const stair = /\b(?:stairs?|steps?|treads?|risers?|landing)\b/.test(t);
  const finish = /\b(?:sand(?:ing)?|re-?finish(?:ing)?|site\s*finish(?:ed)?|finish(?:ing)?\s*(?:on\s*)?site|\d\s*coats?|stain(?:ing)?|poly(?:urethane)?|screen\s*(?:&|and)\s*coat)\b/.test(t)
    || /\bsand\s*(?:&|and|\/)/.test(t);
  if (/\bvents?\b|\bregisters?\b|\bgrill(?:e|s)?\b/.test(t)) return "vent";
  if (stair && finish) return "stair_sand_finish";
  if (/\bnos(?:ing|e)s?\b/.test(t)) return "nosing";
  if (/\brisers?\b/.test(t) && !/\btreads?\b/.test(t)) return "stair_riser";
  if (stair) return "stair_tread";
  if (finish) return "floor_sand_finish";
  return "other";
}
const widthOf = (t: string) => Number((/\b(\d{2}(?:\.\d+)?)\s*(?:"|”|“|″|inch(?:es)?\b|in\b)/i.exec(t) || [])[1] || 0);

export function linkCatalog(items: IntakeItem[], rawItems: unknown, catalog: CatalogItem[]): IntakeItem[] {
  if (!catalog.length) return items;
  const ids = new Set(catalog.map((c) => c.id));
  const raw = Array.isArray(rawItems) ? rawItems as Array<Record<string, unknown>> : [];
  return items.map((it) => {
    const src = raw.find((r) => clean(r?.description, 200) === it.description && clean(r?.detail, 200) === it.detail);
    const chosen = src ? String(src.catalog_id ?? "") : "";
    if (chosen && ids.has(chosen)) {
      // the reader sometimes picks the stair finishing service for the tread install (or the other way round)
      const c = catalog.find((x) => x.id === chosen)!;
      const a = serviceKind(`${it.service_name} ${it.description} ${it.detail}`);
      const b = serviceKind(`${c.name} ${c.category || ""}`);
      // stair, vent and finishing lines only take a service of the same kind ("Hardwood - Nail Down" is not a tread install)
      if (a === "other" || a === b) return { ...it, pricing_item_id: chosen };
    }
    const sameName = it.service_name && catalog.find((c) => c.name.trim().toLowerCase() === it.service_name.trim().toLowerCase());
    if (sameName) return { ...it, pricing_item_id: sameName.id };
    const hay = new Set(`${it.description} ${it.detail}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1));
    let best: CatalogItem | null = null;
    let bestLen = 0;
    for (const c of catalog) {
      const w = c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((x) => x.length > 1);
      if (w.length >= 2 && w.every((x) => hay.has(x)) && w.length > bestLen) { best = c; bestLen = w.length; }
    }
    if (!best) {
      // same kind of work (stair sand & finish, tread install, vents…) even when worded differently
      const kind = serviceKind(`${it.service_name} ${it.description} ${it.detail}`);
      if (kind !== "other") {
        const same = catalog.filter((c) => serviceKind(`${c.name} ${c.category || ""}`) === kind);
        const w = widthOf(`${it.description} ${it.detail} ${it.service_name}`);
        best = (w && same.find((c) => widthOf(c.name) === w)) || (same.length === 1 ? same[0]! : same.find((c) => !widthOf(c.name)) || null);
      }
    }
    return { ...it, pricing_item_id: best ? best.id : null };
  });
}

/** Reads small print best of the models this account uses (env WORK_ORDER_AI_MODEL overrides). */
export const WORK_ORDER_DEFAULT_MODEL = "gpt-6-sol";
/** Bump when the reading changes, so a cached reading of the same file is not reused. */
const READ_VERSION = "2026-10-29b";
const READ_CACHE = new Map<string, { at: number; result: IntakeResult; model: string }>();

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
  // the same file always gives the same reading (the model can vary between runs)
  const cacheKey = createHash("sha256").update(JSON.stringify([READ_VERSION, images, pdfs.map((f) => f.dataUrl), text, catalog.map((c) => c.id + c.name)])).digest("hex");
  const hit = READ_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < 24 * 3600e3) return { ok: true, result: structuredClone(hit.result), model: hit.model };
  // small print (a work order on a phone screenshot): the whole image, then zoomed strips of it
  const strips: string[] = [];
  const room = Math.max(0, 16 - images.length);
  for (const img of images) { if (strips.length >= room) break; strips.push(...(await zoomStrips(img)).slice(0, room - strips.length)); }
  const userWithStrips = strips.length
    ? `${user}\n\nThe first image${images.length > 1 ? "s are the whole pages" : " is the whole page"}; the next ${strips.length} images are the same page${images.length > 1 ? "s" : ""} cut into overlapping strips from top to bottom and enlarged so the small print is readable. Read every number and word from the strips (they are sharper). A line can appear in two strips where they overlap: count it once.`
    : user;
  const call = (model?: string, timeoutMs = 60_000) => aiChatJson({
    system: SYSTEM_PROMPT, user: userWithStrips, imageUrls: [...images, ...strips], files: pdfs, timeoutMs,
    // reading, not puzzling: a reasoning model answers in seconds at low effort
    reasoningEffort: "low",
    // read the images at full resolution, and the same way every time
    imageDetail: "high", temperature: 0, maxImages: 16,
    ...(model ? { model } : {}),
  });
  const preferred = process.env.WORK_ORDER_AI_MODEL?.trim() || WORK_ORDER_DEFAULT_MODEL;
  const t0 = Date.now();
  let response = await call(preferred);
  // the account may not have the work-order model (or it was too slow): the default chat model reads it instead
  if (!response.ok && !process.env.WORK_ORDER_AI_MODEL?.trim()) {
    console.warn(`[work-order] model ${preferred} failed after ${Date.now() - t0} ms (${response.error}); using the default chat model`);
    response = await call(undefined, 45_000);
  }
  console.log(`[work-order] read in ${Date.now() - t0} ms · ${response.ok ? response.model : "failed"} · ${images.length} image(s) + ${strips.length} strip(s)`);
  if (!response.ok) return { ok: false, error: response.error };
  const raw = extractJson(response.text);
  if (!raw) return { ok: false, error: "Não consegui ler o arquivo. Confira se ele está legível." };
  const result = normalizeIntake(raw, today);
  result.items = linkCatalog(result.items, raw.items, catalog);
  if (layers.length) result.stairs = mergeStairs(result.stairs || [], stairFlightsFromText(layers.join("\n")));
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
  READ_CACHE.set(cacheKey, { at: Date.now(), result: structuredClone(result), model: response.model });
  if (READ_CACHE.size > 200) READ_CACHE.delete(READ_CACHE.keys().next().value!);
  return { ok: true, result, model: response.model };
}
