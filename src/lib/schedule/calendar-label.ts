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

/** "123 Oak Street, Denver" → "123 Oak". "123 N Oak St" → "123 N Oak". */
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
  const name: string[] = [];
  if (i < tokens.length && STREET_DIR.has(tokenKey(tokens[i]))) {
    name.push(tokens[i]);
    i += 1;
  }
  if (i < tokens.length && !STREET_SUFFIX.has(tokenKey(tokens[i]))) {
    name.push(tokens[i]);
  }
  const chip = [number, ...name].filter(Boolean).join(" ");
  return chip || tokens.slice(0, 2).join(" ");
}

export function isBuilderParty(sourceType?: string | null, builderId?: string | null): boolean {
  const t = String(sourceType || "").toLowerCase();
  if (t === "particular" || t === "internal" || t === "other") return false;
  if (t === "builder" || t === "contractor" || t === "loja") return true;
  return Boolean(builderId);
}

export function builderCalendarTitle(opts: {
  nickname?: string | null;
  company?: string | null;
  fallback?: string | null;
  address?: string | null;
}): string {
  const who =
    String(opts.nickname || "").trim() ||
    String(opts.company || "").trim() ||
    String(opts.fallback || "").trim();
  const street = streetChip(opts.address);
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
  origin?: string | null;
}): string {
  if (isBuilderParty(input.sourceType, input.builderId)) {
    return builderCalendarTitle({
      nickname: input.nickname,
      company: input.company || input.builderName,
      fallback: input.customerName || input.title,
      address: input.address,
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
