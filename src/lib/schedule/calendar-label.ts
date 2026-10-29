/**
 * Names shown on the schedule and on the external calendar feed.
 * Particular: "Name - Origin", or "Name - Client ID" when that ID is filled.
 * Builder / loja: "Nickname 123 Oak" (number + first street name).
 */
import { personCalendarTitle } from "./lead-visit-ics.js";

const STREET_SUFFIX = new Set([
  "st",
  "street",
  "ave",
  "avenue",
  "rd",
  "road",
  "dr",
  "drive",
  "blvd",
  "boulevard",
  "ln",
  "lane",
  "way",
  "ct",
  "court",
  "pl",
  "place",
  "cir",
  "circle",
  "pkwy",
  "parkway",
  "trl",
  "trail",
]);

const STREET_DIR = new Set([
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
  "north",
  "south",
  "east",
  "west",
]);

function tokenKey(token: string): string {
  return token.toLowerCase().replace(/\./g, "");
}

/** "123 N Oak Street, Denver" → "123 Oak". Always number + one street word. */
export function streetChip(address: string | null | undefined): string {
  const line = String(address || "")
    .split(",")[0]
    .trim();
  const tokens = line.split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  let i = 0;
  let number = "";
  if (/^\d/.test(tokens[0])) {
    number = tokens[0];
    i = 1;
  }
  while (i < tokens.length && STREET_DIR.has(tokenKey(tokens[i]))) i += 1;
  let street = "";
  if (i < tokens.length && !STREET_SUFFIX.has(tokenKey(tokens[i]))) {
    street = tokens[i];
  }
  const chip = [number, street].filter(Boolean).join(" ");
  return chip || tokens.slice(0, 2).join(" ");
}

/** Prefer a full "number street" chip. The job title often carries it after a dash. */
export function calendarStreet(address?: string | null, title?: string | null): string {
  const fromAddress = streetChip(address);
  if (/\d/.test(fromAddress) && /[A-Za-z]/.test(fromAddress)) return fromAddress;
  const pieces = String(title || "")
    .split(/\s+[—–-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of pieces) {
    const chip = streetChip(part);
    if (/\d/.test(chip) && /[A-Za-z]/.test(chip)) return chip;
  }
  return fromAddress;
}

export function isBuilderParty(
  sourceType?: string | null,
  builderId?: string | null,
  customerType?: string | null,
): boolean {
  const t = String(sourceType || "").toLowerCase();
  const c = String(customerType || "").toLowerCase();
  if (t === "particular" || t === "internal") return false;
  if (t === "builder" || t === "contractor" || t === "loja") return true;
  if (c === "builder" || c === "contractor" || c === "loja") return true;
  return Boolean(builderId);
}

function normName(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function samePartyName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && (long === short || long.startsWith(`${short} `));
}

export type BuilderNickRow = {
  nickname?: string | null;
  company?: string | null;
  email?: string | null;
  name?: string | null;
};

/** Nickname saved on the builder cadastro, even when the job only has the matching customer. */
export function calendarNickFromBuilders(
  direct: { nickname?: string | null; company?: string | null },
  hints: Array<string | null | undefined>,
  emails: Array<string | null | undefined>,
  builders: BuilderNickRow[],
): { nickname: string | null; company: string | null } {
  const nick = String(direct.nickname || "").trim();
  const company = String(direct.company || "").trim();
  if (nick) return { nickname: nick, company: company || null };
  const names = hints.map(normName).filter(Boolean);
  const mails = emails.map((v) => String(v || "").toLowerCase().trim()).filter(Boolean);
  let best: { nickname: string; company: string | null; score: number } | null = null;
  for (const row of builders) {
    const rowNick = String(row.nickname || "").trim();
    if (!rowNick) continue;
    const rowCompany = String(row.company || "").trim() || null;
    const rowMail = String(row.email || "").toLowerCase().trim();
    let score = 0;
    if (rowMail && mails.includes(rowMail)) score = 100;
    else {
      const rowNames = [row.company, row.name].map(normName).filter(Boolean);
      for (const rowName of rowNames) {
        for (const hint of names) {
          if (rowName === hint) score = Math.max(score, 80);
          else if (samePartyName(rowName, hint)) score = Math.max(score, 40);
        }
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { nickname: rowNick, company: company || rowCompany, score };
    }
  }
  if (best) return { nickname: best.nickname, company: best.company };
  return { nickname: null, company: company || null };
}

export function builderCalendarTitle(opts: {
  nickname?: string | null;
  company?: string | null;
  fallback?: string | null;
  address?: string | null;
  title?: string | null;
}): string {
  const who =
    String(opts.nickname || "").trim() ||
    String(opts.company || "").trim() ||
    String(opts.fallback || "").trim();
  const street = calendarStreet(opts.address, opts.title);
  return [who, street].filter(Boolean).join(" ") || street || "Job";
}

export function jobCalendarTitle(input: {
  sourceType?: string | null;
  builderId?: string | null;
  title?: string | null;
  address?: string | null;
  clientRef?: string | null;
  sourceName?: string | null;
  customerName?: string | null;
  nickname?: string | null;
  company?: string | null;
  builderName?: string | null;
  customerType?: string | null;
  origin?: string | null;
}): string {
  const nick = String(input.nickname || "").trim();
  if (nick || isBuilderParty(input.sourceType, input.builderId, input.customerType)) {
    return builderCalendarTitle({
      nickname: input.nickname,
      company: input.company || input.builderName,
      fallback: input.customerName || input.title,
      address: input.address,
      title: input.title,
    });
  }
  const name = String(input.customerName || input.sourceName || input.title || "").trim() || "Cliente";
  const typed = String(input.sourceName || "").trim();
  const origin =
    String(input.origin || "").trim() ||
    (typed && typed.toLowerCase() !== name.toLowerCase() ? typed : "");
  return personCalendarTitle(name, { clientId: input.clientRef, origin });
}

/** Timed visits always occupy one hour from the selected start. */
export function visitBlockEnd(start: Date, allDay: boolean): Date {
  return new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
}
