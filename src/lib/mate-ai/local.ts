/**
 * Local (no-AI) reader for Mate AI. Used when no AI provider is configured or the AI call
 * fails. It is deliberately forgiving with voice transcripts in Portuguese, English and
 * Spanish: "1350 pés de madeira", "mil e duzentos feet", "fatura do job 1042 para sexta".
 *
 * Instead of guessing where the customer's name starts and ends, it looks for the names of
 * this company's customers inside the sentence (tolerating typos), which is far more reliable.
 */
import { normalizeMateAiUnit, type MateAiCatalogItem } from "./command.js";
import { editDistance, jobNumberFromQuery } from "./match.js";
import type { MateAiInvoicePlan, MateAiPlan, MateAiQuotePlan } from "./interpret.js";

export type LocalCustomer = { id: string; name: string; company?: string | null };

export type LocalContext = {
  today: string; // YYYY-MM-DD in the company's timezone
  catalog: MateAiCatalogItem[];
  customers: LocalCustomer[];
};

type Unit = "sq_ft" | "linear_ft" | "fixed" | "each" | "box" | "step" | "hour";

/* ───────────────────────── text helpers ───────────────────────── */

export function foldText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return foldText(value)
    .replace(/[^a-z0-9%$#/.,:-]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^[.,:-]+|[.,:-]+$/g, ""))
    .filter(Boolean);
}

const FILLER = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "nos", "nas",
  "com", "para", "pra", "pro", "por", "que", "the", "an", "of", "and", "for", "with", "to", "in", "on", "at", "el", "la",
  "los", "las", "del", "y", "con", "mais", "tambem", "also", "plus", "please", "favor", "faz", "fazer", "fazendo", "quero",
  "preciso", "criar", "crie", "cria", "create", "make", "montar", "monte", "gerar", "gere", "novo", "nova", "new",
  "quote", "orcamento", "orcar", "estimate", "cotacao", "proposta", "presupuesto", "cliente", "customer", "client", "senhor",
  "senhora", "sr", "sra", "mr", "mrs", "ms", "dele", "dela", "ai", "mate", "esse", "essa", "este", "esta", "isso", "pe",
  "luxury", "premium", "standard", "regular", "pes", "feet", "foot", "ft", "sqft", "sq", "square", "quadrados", "quadrado", "quadradas", "sf", "pies", "cuadrados",
]);

const ACTIONS = new Set(["installation", "removal", "sand", "finish", "refinish", "repair", "leveling", "disposal", "replace"]);

/** Words that mark a variant of a base service; never preferred unless said. */
const QUALIFIERS = new Set(["additional", "add", "add-on", "extra", "addon", "adicional", "minimum", "commercial", "chevron", "herringbone"]);

/* ───────────────────────── numbers ───────────────────────── */

const NUMBER_WORDS: Record<string, number> = {
  // pt
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400,
  quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700,
  setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
  // en
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // es
  cuatro: 4, siete: 7, ocho: 8, nueve: 9, diez: 10, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, quinientos: 500, doscientos: 200, trescientos: 300,
};
const ONE_WORDS = new Set(["um", "uma", "one", "uno", "una"]);
const MULTIPLIERS: Record<string, number> = { mil: 1000, thousand: 1000, hundred: 100, cien: 100, ciento: 100 };
const NUMBER_JOINERS = new Set(["e", "and", "y"]);

/** "mil trezentos e cinquenta" → "1350"; leaves articles like "um quote" alone. */
export function wordsToDigits(text: string): string {
  const tokens = text.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const start = i;
    let total = 0;
    let current = 0;
    let used = 0;
    let lastWasNumber = false;
    let j = i;
    for (; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (NUMBER_WORDS[t] != null) {
        current += NUMBER_WORDS[t]!;
        used++;
        lastWasNumber = true;
      } else if (ONE_WORDS.has(t) && (used > 0 || MULTIPLIERS[tokens[j + 1] || ""] != null)) {
        current += 1;
        used++;
        lastWasNumber = true;
      } else if (MULTIPLIERS[t] != null) {
        const m = MULTIPLIERS[t]!;
        if (m === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * m;
          current = 0;
        }
        used++;
        lastWasNumber = true;
      } else if (/^\d{1,3}$/.test(t) && used > 0 && current === 0 && total > 0) {
        // "mil 350" (speech engines mix words and digits)
        current += Number(t);
        used++;
        lastWasNumber = true;
      } else if (NUMBER_JOINERS.has(t) && used > 0 && lastWasNumber && j + 1 < tokens.length &&
        (NUMBER_WORDS[tokens[j + 1]!] != null || ONE_WORDS.has(tokens[j + 1]!) || (total > 0 && /^\d{1,3}$/.test(tokens[j + 1]!)))) {
        lastWasNumber = false;
      } else break;
    }
    if (used > 0) {
      out.push(String(total + current));
      i = j;
    } else {
      out.push(tokens[start]!);
      i = start + 1;
    }
  }
  return out.join(" ");
}

function parseNumber(raw: string, portuguese: boolean): number | null {
  let s = raw.replace(/[$\s]/g, "");
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(s)) {
    // 1.350 / 1,350 / 1.350,50 / 1,350.50
    const decimalMatch = s.match(/([.,])(\d{1,2})$/);
    if (decimalMatch && s.split(/[.,]/).length > 2) {
      const intPart = s.slice(0, -decimalMatch[0].length).replace(/[.,]/g, "");
      return Number(intPart + "." + decimalMatch[2]);
    }
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  }
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(s) && portuguese && /\.\d{3}$/.test(s)) s = s.replace(".", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ───────────────────────── units ───────────────────────── */

const UNIT_PATTERNS: Array<[RegExp, Unit]> = [
  [/^(pes?|feet|foot|ft|pies?)\s+(lineares?|linear|lineales?)\b/, "linear_ft"],
  [/^(linear|lineares?)\s+(feet|foot|ft|pes?)\b/, "linear_ft"],
  [/^(lf|lin ft|ml)\b/, "linear_ft"],
  [/^(pes?|feet|foot|ft|pies?)\s+(quadrados?|quadradas?|square|cuadrados?)\b/, "sq_ft"],
  [/^(square|sq)\s*(feet|foot|ft|pes?)\b/, "sq_ft"],
  [/^(sq\.?\s*ft\.?|sqft|sf|ft2|ft²|square)\b/, "sq_ft"],
  [/^(pes?|feet|foot|ft|pies?)\b/, "sq_ft"],
  [/^(degraus?|steps?|escadas?|escalones?)\b/, "step"],
  [/^(caixas?|boxes|box|cajas?)\b/, "box"],
  [/^(horas?|hours?|hrs?|h)\b/, "hour"],
  [/^(unidades?|pecas?|each|units?|ea|un|piezas?|portas?|janelas?)\b/, "each"],
];

function unitAt(text: string): { unit: Unit; length: number } | null {
  for (const [re, unit] of UNIT_PATTERNS) {
    const m = text.match(re);
    if (m) return { unit, length: m[0].length };
  }
  return null;
}

/* ───────────────────────── services ───────────────────────── */

/** Spoken word → canonical service token (English, as most catalogs use it). */
const SERVICE_SYNONYMS: Record<string, string> = {
  madeira: "hardwood", madeiras: "hardwood", wood: "hardwood", hardwood: "hardwood", taco: "hardwood", tacos: "hardwood",
  assoalho: "hardwood", parquet: "hardwood", engineered: "engineered", engenheirada: "engineered", engenheirado: "engineered",
  instalacao: "installation", instalacoes: "installation", instalar: "installation", instala: "installation",
  installation: "installation", install: "installation", installing: "installation", colocar: "installation",
  colocacao: "installation", assentamento: "installation", assentar: "installation", instalacion: "installation",
  remocao: "removal", remover: "removal", retirar: "removal", retirada: "removal", tirar: "removal", arrancar: "removal",
  demolicao: "removal", demolir: "removal", removal: "removal", remove: "removal", demo: "removal", demolition: "removal",
  tearout: "removal", rip: "removal", quitar: "removal",
  carpete: "carpet", carpet: "carpet", tapete: "carpet", carpeta: "carpet", alfombra: "carpet", moquete: "carpet",
  lixa: "sand", lixar: "sand", lixamento: "sand", lixada: "sand", sanding: "sand", sand: "sand", lijar: "sand",
  acabamento: "finish", finish: "finish", finishing: "finish", verniz: "finish", envernizar: "finish", sinteco: "finish",
  refinish: "refinish", refinishing: "refinish", restauracao: "refinish", restaurar: "refinish", reforma: "refinish",
  vinil: "vinyl", vinyl: "vinyl", lvp: "vinyl", lvt: "vinyl", spc: "vinyl", vinilico: "vinyl",
  laminado: "laminate", laminate: "laminate", laminados: "laminate",
  rodape: "baseboard", rodapes: "baseboard", baseboard: "baseboard", baseboards: "baseboard", base: "baseboard",
  moldura: "trim", trim: "trim", shoe: "trim", quarter: "trim", quarto: "trim",
  degrau: "stair", degraus: "stair", escada: "stair", escadas: "stair", stair: "stair", stairs: "stair", step: "stair",
  steps: "stair", nosing: "nosing", focinho: "nosing", bocel: "nosing",
  piso: "floor", pisos: "floor", chao: "floor", floor: "floor", flooring: "floor", floors: "floor", suelo: "floor",
  ceramica: "tile", azulejo: "tile", porcelanato: "tile", tile: "tile", tiles: "tile", ladrilho: "tile",
  subfloor: "subfloor", contrapiso: "subfloor", nivelamento: "leveling", nivelar: "leveling", leveling: "leveling",
  self: "leveling", manta: "underlayment", underlayment: "underlayment", underlay: "underlayment",
  cola: "glue", glue: "glue", colado: "glue", grampo: "nail", pregado: "nail", nail: "nail", nailed: "nail",
  flutuante: "floating", floating: "floating", float: "floating",
  material: "material", materiais: "material", materials: "material", descarte: "disposal", disposal: "disposal",
  lixo: "disposal", dumpster: "disposal", cacamba: "disposal", haul: "disposal",
  movimentacao: "furniture", moveis: "furniture", furniture: "furniture",
  transicao: "transition", transition: "transition", threshold: "transition", soleira: "transition",
  trocar: "replace", troca: "replace", substituir: "replace", substituicao: "replace", replace: "replace",
  replacement: "replace", reemplazar: "replace",
  reparo: "repair", conserto: "repair", repair: "repair", reparar: "repair", consertar: "repair",
  porta: "door", portas: "door", door: "door", doors: "door",
};

function canonicalTokens(value: string): string[] {
  const text = foldText(value).replace(/\br\s*&\s*r\b|\br\s+and\s+r\b/g, " replace ");
  return words(wordsToDigits(text))
    .filter((w) => !/^\d/.test(w) && w.length > 1 && !FILLER.has(w))
    .map((w) => SERVICE_SYNONYMS[w] || w.replace(/s$/, ""));
}

function tokenHit(spoken: string, target: string): number {
  if (spoken === target) return 1;
  if (spoken.length >= 4 && target.length >= 4 && (target.startsWith(spoken) || spoken.startsWith(target))) return 0.8;
  const allowed = spoken.length >= 7 ? 2 : spoken.length >= 5 ? 1 : 0;
  return allowed && editDistance(spoken, target, allowed) <= allowed ? 0.7 : 0;
}

export type ServiceMatch = { item: MateAiCatalogItem; score: number };

function rawTokens(value: string): string[] {
  return words(foldText(value)).filter((w) => w.length > 1 && !/^\d/.test(w) && !FILLER.has(w));
}

export function rankCatalogForSpeech(spoken: string, catalog: MateAiCatalogItem[], unit: Unit | null): ServiceMatch[] {
  const said = canonicalTokens(spoken);
  if (!said.length) return [];
  const saidRaw = new Set(rawTokens(spoken));
  // No action said ("1350 pés de madeira") means installation in flooring.
  const implied = said.some((t) => ACTIONS.has(t)) ? [] : ["installation"];
  // Sanding and finishing are one job in hardwood ("lixa" → Sand & Finish).
  if (said.includes("sand")) implied.push("finish");
  if (said.includes("finish")) implied.push("sand");
  return catalog
    .map((item) => {
      const target = canonicalTokens(item.name + " " + (item.category || ""));
      const nameTokens = canonicalTokens(item.name);
      let hits = 0;
      for (const token of said) {
        let best = 0;
        for (const t of target) best = Math.max(best, tokenHit(token, t));
        hits += best;
      }
      if (!hits) return { item, score: 0 };
      const coverage = hits / said.length; // how much of what was said is explained
      // Words of the item's name nobody said ("Additional", "Nail Down") make it a worse fit.
      const unsaid = nameTokens.filter((t) => !said.some((w) => tokenHit(w, t) > 0) && !implied.includes(t));
      // A different action than the one said or implied (removal vs installation) is a worse miss.
      const wrongActions = unsaid.filter((t) => ACTIONS.has(t)).length;
      let score = Math.round(70 * coverage + 30 - 10 * unsaid.length - 10 * wrongActions);
      if (unsaid.some((t) => QUALIFIERS.has(t))) score -= 10;
      // The item's own words were said ("instalação de madeira" → an item named exactly that).
      const raw = rawTokens(item.name);
      if (raw.length) score += Math.round((12 * raw.filter((w) => saidRaw.has(w)).length) / raw.length);
      const itemUnit = normalizeMateAiUnit(item.unit);
      if (unit && itemUnit === unit) score += 6;
      else if (unit && itemUnit && itemUnit !== unit) score -= 25;
      return { item, score };
    })
    .filter((r) => r.score > 20)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
}

/** English canonical words for what was said, so the clarification can still suggest items. */
export function canonicalServiceText(spoken: string): string {
  const tokens = canonicalTokens(spoken);
  return [...new Set(tokens)].join(" ");
}

/* ───────────────────────── customers ───────────────────────── */

const NAME_SKIP = new Set(["de", "da", "do", "dos", "das", "e", "the", "and", "of", "jr", "sr", "llc", "inc", "co", "corp", "ltd"]);

function nameTokens(value: string | null | undefined): string[] {
  return words(String(value || "")).filter((w) => w.length > 1 && !NAME_SKIP.has(w) && !/^\d/.test(w));
}

function nameTokenHit(nameToken: string, spoken: string): number {
  if (nameToken === spoken) return 1;
  if (nameToken.length >= 3 && spoken.length >= 3 && (nameToken.startsWith(spoken) || spoken.startsWith(nameToken))) {
    return Math.min(nameToken.length, spoken.length) >= 4 ? 0.85 : 0;
  }
  const allowed = nameToken.length >= 7 ? 2 : nameToken.length >= 4 ? 1 : 0;
  return allowed && editDistance(nameToken, spoken, allowed) <= allowed ? 0.75 : 0;
}

const COMMON_WORDS = new Set([
  ...Object.keys(SERVICE_SYNONYMS), ...FILLER, "job", "trabalho", "obra", "invoice", "fatura", "emitir", "emita",
  "dia", "sexta", "segunda", "terca", "quarta", "quinta", "sabado", "domingo", "amanha", "hoje", "semana", "mes",
  "valor", "total", "saldo", "deposito", "sinal", "entrada", "vencimento", "due", "date", "friday", "monday",
]);

export type CustomerSpot = { customer: LocalCustomer; score: number; spoken: string[] };

/** Finds this company's customers mentioned anywhere in the sentence. */
export function spotCustomers(text: string, customers: LocalCustomer[]): CustomerSpot[] {
  const spokenWords = words(text).filter((w) => w.length > 1 && !/^\d/.test(w));
  const spots: CustomerSpot[] = [];
  for (const customer of customers) {
    let best: CustomerSpot | null = null;
    for (const source of [customer.name, customer.company]) {
      const tokens = nameTokens(source);
      if (!tokens.length) continue;
      let hits = 0;
      const used: string[] = [];
      for (const token of tokens) {
        let bestHit = 0;
        let bestWord = "";
        for (const w of spokenWords) {
          if (COMMON_WORDS.has(w) && w !== token) continue;
          const hit = nameTokenHit(token, w);
          if (hit > bestHit) {
            bestHit = hit;
            bestWord = w;
          }
        }
        if (bestHit) {
          hits += bestHit;
          used.push(bestWord);
        }
      }
      if (!hits) continue;
      const firstMatched = used.length > 0 && nameTokenHit(tokens[0]!, used[0]!) > 0;
      // Full name said → strong. Only first or last name said → candidate for "which one?".
      let score = Math.round((hits / tokens.length) * 100);
      if (used.length === tokens.length) score = Math.max(score, 80 + Math.round((hits / tokens.length) * 20));
      else if (used.length >= 1 && (firstMatched || tokens.length <= 3)) score = Math.max(score, 60);
      if (!best || score > best.score) best = { customer, score, spoken: used };
    }
    if (best && best.score >= 55) spots.push(best);
  }
  return spots.sort((a, b) => b.score - a.score);
}

/** Words after "para o cliente" / "for" when no known customer was found (new or misspelled name). */
function customerAfterMarker(text: string): string {
  const folded = foldText(text);
  const m = folded.match(/\b(?:para|pra|pro|for|do|da|de|del)\s+(?:(?:o|a|the|el|la)\s+)?(?:cliente|customer|client)\s+([a-z][a-z\s.'-]{1,60})/) ||
    folded.match(/\b(?:para|pra|pro|for)\s+(?:(?:o|a|the|el|la)\s+)?([a-z][a-z\s.'-]{1,60})/);
  if (!m) return "";
  const out: string[] = [];
  for (const w of m[1]!.split(/\s+/)) {
    if (!w || COMMON_WORDS.has(w) || /\d/.test(w)) break;
    out.push(w);
    if (out.length >= 4) break;
  }
  return out.join(" ");
}

/* ───────────────────────── dates ───────────────────────── */

const WEEKDAYS: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5,
};
const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10,
  novembro: 11, dezembro: 12, january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, enero: 1, febrero: 2, marzo: 3, mayo: 5, junio: 6, julio: 7,
  septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function isoAdd(today: string, days: number): string {
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoFrom(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Next date with this day of month, this month or next. */
function nextDayOfMonth(today: string, day: number): string | null {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  if (day >= d) {
    const same = isoFrom(y, m, day);
    if (same) return same;
  }
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return isoFrom(ny, nm, day);
}

function withYear(today: string, month: number, day: number): string | null {
  const [y] = today.split("-").map(Number) as [number];
  const candidate = isoFrom(y, month, day);
  if (!candidate) return null;
  // A date well in the past most likely means next year ("5 de janeiro" said in December).
  return candidate < isoAdd(today, -60) ? isoFrom(y + 1, month, day) : candidate;
}

export function parseSpokenDate(input: string, today: string, portuguese = true): string | null {
  const t = wordsToDigits(foldText(input)).replace(/-feira/g, "");
  if (/\bdepois de amanha\b|\bpasado manana\b/.test(t)) return isoAdd(today, 2);
  if (/\bamanha\b|\btomorrow\b|\bmanana\b/.test(t)) return isoAdd(today, 1);
  if (/\bhoje\b|\btoday\b|\bhoy\b/.test(t)) return today;
  if (/\b(fim|final|fin) d[oe]l? mes\b|\bend of (the )?month\b/.test(t)) {
    const [y, m] = today.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
  }
  let m = t.match(/\b(?:em|daqui a|in|en|dentro de)\s+(\d{1,3})\s+(dias?|days?)\b/) || t.match(/\b(\d{1,3})\s+(dias?|days?)\b/);
  if (m) return isoAdd(today, Number(m[1]));
  m = t.match(/\b(?:em|daqui a|in|en)?\s*(\d{1,2})\s+(semanas?|weeks?)\b/);
  if (m) return isoAdd(today, 7 * Number(m[1]));
  if (/\b(proxima semana|semana que vem|next week|semana que viene|proxima semana)\b/.test(t)) return isoAdd(today, 7);

  // 30/10, 10/30, 30/10/2026
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let day: number;
    let month: number;
    if (a > 12) [day, month] = [a, b];
    else if (b > 12) [month, day] = [a, b];
    else if (portuguese) [day, month] = [a, b];
    else [month, day] = [a, b];
    if (m[3]) {
      const y = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
      return isoFrom(y, month, day);
    }
    return withYear(today, month, day);
  }
  // 30 de outubro / october 30 / oct 30th
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th|o)?\s+(?:de\s+)?([a-z]+)\b/);
  if (m && MONTHS[m[2]!]) return withYear(today, MONTHS[m[2]!]!, Number(m[1]));
  m = t.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m && MONTHS[m[1]!]) return withYear(today, MONTHS[m[1]!]!, Number(m[2]));

  // sexta, sexta que vem, next friday
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp("\\b" + name + "\\b").test(t)) {
      const current = new Date(today + "T12:00:00Z").getUTCDay();
      let diff = (dow - current + 7) % 7;
      if (diff === 0) diff = 7;
      return isoAdd(today, diff);
    }
  }
  // dia 30 / day 30 / the 30th
  m = t.match(/\b(?:dia|day|el|the)\s+(\d{1,2})(?:st|nd|rd|th)?\b/) || t.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) return nextDayOfMonth(today, day);
  }
  return null;
}

/* ───────────────────────── intents ───────────────────────── */

const INVOICE_RE = /\b(invoice|invoices|fatura|faturas|faturar|fature|fatur[ae]|cobranca|cobrar|bill|billing|factura|facturar|recibo)\b/;
const QUOTE_RE = /\b(quote|quotes|orcamento|orcamentos|orcar|estimate|estimativa|cotacao|proposta|presupuesto|cotizacion|bid)\b/;

function looksPortuguese(t: string): boolean {
  return /\b(para|pra|pro|com|de|do|da|instalacao|fatura|orcamento|cliente|dia|pes)\b/.test(t);
}

/* ───────────────────────── quote ───────────────────────── */

const CLAUSE_SPLIT = /\s*(?:[,;]|\s(?:e|and|y|mais|plus|tambem|also|alem disso|depois)\s)\s*/;

type FoundItem = { quantity: number; unit: Unit | null; text: string };

function findQuoteItems(text: string, portuguese: boolean): FoundItem[] {
  const items: FoundItem[] = [];
  // Split on clause separators but keep thousands separators (1,350) intact.
  const protectedText = text.replace(/(\d),(\d{3})\b/g, "$1§$2");
  const clauses = protectedText.split(CLAUSE_SPLIT).map((c) => c.replace(/§/g, ","));
  let pendingService = "";
  for (const clause of clauses) {
    const numberRe = /(?<![\w/])(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\w/%])/g;
    const matches = [...clause.matchAll(numberRe)];
    if (!matches.length) {
      // "instalação de madeira, 1350 pés" — a service named in its own clause before the number.
      if (canonicalTokens(clause).some((w) => Object.values(SERVICE_SYNONYMS).includes(w))) pendingService = clause;
      continue;
    }
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const qty = parseNumber(match[1]!, portuguese);
      if (qty == null || qty <= 0 || qty > 1_000_000) continue;
      const afterStart = (match.index ?? 0) + match[0].length;
      const afterRaw = clause.slice(afterStart);
      const after = afterRaw.trimStart();
      // Money, percentages and dates are not quantities.
      if (/^(dolares|dollars|reais|bucks|usd|%|por cento|percent)\b/.test(after)) continue;
      if (/\$\s*$/.test(clause.slice(0, match.index ?? 0))) continue;
      const unit = unitAt(after);
      const nextIndex = matches[i + 1]?.index ?? clause.length;
      const before = clause.slice(i === 0 ? 0 : (matches[i - 1]!.index ?? 0) + matches[i - 1]![0].length, match.index ?? 0);
      const afterText = clause.slice(afterStart + (afterRaw.length - after.length) + (unit?.length ?? 0), nextIndex);
      let serviceText = (before + " " + afterText).trim();
      if (!canonicalTokens(serviceText).length && pendingService) serviceText = pendingService;
      // "14 degraus" / "14 steps": the unit word is the service.
      if (!canonicalTokens(serviceText).length && unit) serviceText = after.slice(0, unit.length);
      pendingService = "";
      items.push({ quantity: Math.round(qty * 100) / 100, unit: unit?.unit ?? null, text: serviceText });
      if (items.length >= 8) return items;
    }
  }
  return items;
}

function interpretQuote(text: string, ctx: LocalContext, spots: CustomerSpot[]): { ok: true; plan: MateAiQuotePlan } | { ok: false; error: string } {
  const portuguese = looksPortuguese(text);
  // Do not read the customer's name as a service ("Wood" family, "Floor Masters LLC").
  let serviceSource = text;
  for (const word of spots[0]?.spoken || []) serviceSource = serviceSource.replace(new RegExp("\\b" + word + "\\b", "g"), " ");
  const found = findQuoteItems(serviceSource, portuguese);
  if (!found.length) {
    return { ok: false, error: "Diga o serviço e a quantidade, por exemplo: “instalação de 1350 pés de madeira”." };
  }

  const items: MateAiQuotePlan["items"] = found.map((f) => {
    const ranked = rankCatalogForSpeech(f.text, ctx.catalog, f.unit);
    const top = ranked[0];
    const second = ranked[1];
    const confident = top && top.score >= 55 && (!second || top.score - second.score >= 6);
    const unit = f.unit ?? (confident ? (normalizeMateAiUnit(top!.item.unit) as Unit | null) : null);
    const spoken = rawTokens(f.text).join(" ");
    return {
      service_text: (confident ? spoken || f.text.trim() : spoken || canonicalServiceText(f.text) || f.text.trim()).slice(0, 200) || "serviço",
      catalog_item_id: confident ? top!.item.id : null,
      catalog_source: confident ? top!.item.source : null,
      quantity: f.quantity,
      unit,
      // Best guesses first, for the "which one?" choice.
      candidates: confident ? undefined : ranked.slice(0, 6).map((r) => ({ id: r.item.id, source: r.item.source })),
    };
  });

  const top = spots[0];
  const tied = spots.filter((s) => top && s.score >= top.score - 5);
  let customerQuery = "";
  let customerId: string | null = null;
  if (top && tied.length === 1 && top.score >= 80) customerId = top.customer.id;
  if (top) customerQuery = top.spoken.join(" ");
  if (!customerQuery) customerQuery = customerAfterMarker(text);

  return {
    ok: true,
    plan: { action: "quote", customer_query: customerQuery, customer_id: customerId, items },
  };
}

/* ───────────────────────── invoice ───────────────────────── */

function interpretInvoice(text: string, ctx: LocalContext, spots: CustomerSpot[]): { ok: true; plan: MateAiInvoicePlan } | { ok: false; error: string } {
  const portuguese = looksPortuguese(text);
  const number = jobNumberFromQuery(text) ?? (() => {
    const m = text.match(/\b(?:job|trabalho|obra|os|servico|ordem)\s+(?:numero\s+|number\s+|n\s+|#\s*)?(\d{1,7})\b/);
    return m ? Number(m[1]) : null;
  })();

  let invoiceType: MateAiInvoicePlan["invoice_type"] = "auto";
  let depositPct: number | null = null;
  let customAmount: number | null = null;
  const pct = text.match(/(\d{1,3}(?:[.,]\d+)?)\s*(?:%|por cento|percent|porciento)/);
  const money = text.match(/\$\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:dolares|dollars|bucks|usd)\b/);
  if (/\b(deposito|sinal|entrada|deposit|down payment|anticipo|adiantamento)\b/.test(text)) {
    invoiceType = "deposit";
    depositPct = pct ? Number(pct[1]!.replace(",", ".")) : null;
  } else if (/\b(saldo|restante|final|balance|remaining|resto)\b/.test(text)) invoiceType = "final";
  else if (/\b(parcial|progress|parcela|medicao)\b/.test(text) && money) invoiceType = "progress";
  else if (/\b(total|completo|completa|inteiro|inteira|full|tudo|todo)\b/.test(text)) invoiceType = "full";
  if (money && (invoiceType === "auto" || invoiceType === "progress")) {
    customAmount = parseNumber((money[1] || money[2])!, portuguese);
    if (invoiceType === "auto") invoiceType = "custom";
  }

  // Date: only the part after "vencimento/para/due/until", to avoid reading the job number.
  const dateSource = (() => {
    const m = text.match(/\b(?:vencimento|vence|vencendo|para|pra|ate|due|by|until|on|para el|para o dia|com vencimento)\b(.*)$/);
    return m ? m[1]! : text.replace(/\b(?:job|trabalho|obra|os)\s+#?\d+/g, " ");
  })();
  const dueDate = parseSpokenDate(dateSource, ctx.today, portuguese);

  const top = spots[0];
  const customerQuery = top ? top.customer.name : customerAfterMarker(text);
  if (number == null && !customerQuery) {
    return { ok: false, error: "Qual job devo faturar? Diga o número do job (ex.: “job 1042”) ou o nome do cliente." };
  }
  return {
    ok: true,
    plan: {
      action: "invoice",
      job_query: number != null ? "job " + number : "",
      job_id: null,
      customer_query: customerQuery,
      invoice_type: invoiceType,
      deposit_pct: depositPct,
      custom_amount: customAmount,
      due_date: dueDate,
    },
  };
}

/* ───────────────────────── entry ───────────────────────── */

export function interpretLocally(command: string, ctx: LocalContext): { ok: true; plan: MateAiPlan } | { ok: false; error: string } {
  const text = wordsToDigits(foldText(command));
  if (text.length < 3) return { ok: false, error: "Diga o que você precisa." };
  const spots = spotCustomers(text, ctx.customers);
  const invoice = INVOICE_RE.test(text);
  const quote = QUOTE_RE.test(text);

  if (invoice && !quote) return interpretInvoice(text, ctx, spots);
  if (quote) return interpretQuote(text, ctx, spots);
  // No keyword: a job number means invoice; quantities mean quote.
  if (jobNumberFromQuery(text) != null && !/\d+\s*(pes|feet|ft|sqft|degraus|steps)/.test(text)) return interpretInvoice(text, ctx, spots);
  const asQuote = interpretQuote(text, ctx, spots);
  if (asQuote.ok) return asQuote;
  return {
    ok: false,
    error:
      "Não entendi o pedido. Exemplos: “Quote para o John Smith, instalação de 1350 pés de madeira” ou “Invoice do job 1042 para sexta”.",
  };
}
