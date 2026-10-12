/**
 * Lead visit → one-shot .ics for Apple / Google Calendar (mobile gesture-safe).
 * Title/description/location match the CRM visit calendar format.
 */

import { buildSingleEventIcs } from "./ics.js";
import { safeTimeZone, zonedParts, zonedWallTimeToUtc } from "../time/zoned.js";

export type LeadVisitCalendarLead = {
  id?: string | number | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  zipcode?: string | null;
  zip?: string | null;
  message?: string | null;
  notes?: string | null;
  source?: string | null;
  form_type?: string | null;
  marketing_platform?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  landing_page?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
};

/** Snap using the process clock (prefer snapToNextHalfHourInZone on the server). */
export function snapToNextHalfHour(fromDate: Date = new Date()): Date {
  const d = new Date(fromDate);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) return d;
  if (m < 30) d.setMinutes(30);
  else {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  }
  return d;
}

/** Next :00 / :30 wall-clock instant in the org timezone (Railway runs UTC). */
export function snapToNextHalfHourInZone(fromDate: Date = new Date(), timezone?: string | null): Date {
  const tz = safeTimeZone(timezone);
  const p = zonedParts(fromDate, tz);
  let hour = p.hour;
  let minute = p.minute;
  let day = p.day;
  let month = p.month;
  let year = p.year;
  if (minute === 0 || minute === 30) {
    /* already on a slot — keep current if seconds were zeroed conceptually */
  } else if (minute < 30) {
    minute = 30;
  } else {
    minute = 0;
    hour += 1;
    if (hour >= 24) {
      hour = 0;
      const next = zonedWallTimeToUtc(tz, year, month, day + 1, 0, 0);
      const np = zonedParts(next, tz);
      year = np.year;
      month = np.month;
      day = np.day;
    }
  }
  return zonedWallTimeToUtc(tz, year, month, day, hour, minute);
}

/** ASCII separator (avoids "?" in calendar apps). */
export const CALENDAR_DESC_SEPARATOR = "----------------------------------";

function norm(s: unknown): string {
  return String(s || "")
    .trim()
    .toLowerCase();
}

export function isServiceSlugText(text: unknown): boolean {
  const t = String(text || "").trim();
  if (!t || t.length < 4) return false;
  if (/\s/.test(t) && !t.includes("_")) return false;
  return /^[a-z0-9][a-z0-9_&-]*$/i.test(t) && (t.includes("_") || t.includes("&"));
}

export function resolveLeadCalendarOriginLabel(lead: LeadVisitCalendarLead | null | undefined): string {
  if (!lead || typeof lead !== "object") return "";

  const platform = String(lead.marketing_platform || "").trim();
  if (/^meta$/i.test(platform)) return "Meta";
  if (/^google$/i.test(platform)) return "Google";

  if (String(lead.fbclid || "").trim()) return "Meta";

  const utm = norm(lead.utm_source);
  const src = norm(lead.source);
  const medium = norm(lead.utm_medium);

  if (
    utm.includes("facebook") ||
    utm.includes("instagram") ||
    utm === "fb" ||
    utm.includes("meta") ||
    medium.includes("facebook") ||
    src.includes("facebook") ||
    src.includes("instagram") ||
    src.includes("meta")
  ) {
    return "Meta";
  }

  if (String(lead.gclid || "").trim()) return "Google";

  if (utm.includes("google") || utm === "adwords" || src.includes("google") || /^google/i.test(platform)) {
    return "Google";
  }

  const landing = String(lead.landing_page || "").trim();
  const formType = norm(lead.form_type);
  if (landing) return "Google";
  if (formType && formType !== "manual" && !formType.includes("facebook") && !formType.includes("meta")) {
    return "Google";
  }

  return "";
}

export function buildLeadVisitSummary(lead: LeadVisitCalendarLead | null | undefined): string {
  const name = (lead?.name ? String(lead.name) : "Lead").trim() || "Lead";
  const origin = resolveLeadCalendarOriginLabel(lead);
  return origin ? `${name} - ${origin}` : name;
}

export function buildLeadVisitLocation(lead: LeadVisitCalendarLead | null | undefined): string {
  if (!lead || typeof lead !== "object") return "";
  const line1 = String(lead.address_line1 || lead.address || "").trim();
  const line2 = String(lead.address_line2 || "").trim();
  const city = String(lead.city || "").trim();
  const zip = String(lead.zipcode || lead.zip || "").trim();
  const parts = [line1, line2, city, zip].filter(Boolean);
  return parts.length ? parts.join(", ") : line1;
}

/**
 * Cliente / Tel / Email / Address / Lead #
 * blank line + separator + optional notes
 */
export function buildLeadVisitDescription(lead: LeadVisitCalendarLead | null | undefined): string {
  const lines: string[] = [];

  const name = lead?.name ? String(lead.name).trim() : "";
  if (name) lines.push("Cliente: " + name);
  if (lead?.phone) lines.push("Tel: " + String(lead.phone).trim());
  if (lead?.email) lines.push("Email: " + String(lead.email).trim());
  const address = buildLeadVisitLocation(lead);
  if (address) lines.push("Address: " + address);
  if (lead?.id != null && lead.id !== "") lines.push("Lead #" + String(lead.id));

  let out = lines.join("\n");
  out += "\n\n" + CALENDAR_DESC_SEPARATOR;

  const extra: string[] = [];
  const msg = lead?.message ? String(lead.message).trim() : "";
  if (msg && !isServiceSlugText(msg)) extra.push(msg);
  const notes = lead?.notes ? String(lead.notes).trim() : "";
  if (notes && notes !== msg) extra.push(notes);
  if (extra.length) {
    out += "\n\n" + extra.join("\n\n");
  }

  return out;
}

export function buildLeadVisitIcs(
  lead: LeadVisitCalendarLead,
  options?: { start?: Date; durationMinutes?: number; timezone?: string | null },
): string {
  const start =
    options?.start instanceof Date
      ? options.start
      : snapToNextHalfHourInZone(new Date(), options?.timezone);
  const durationMinutes =
    typeof options?.durationMinutes === "number" && options.durationMinutes > 0
      ? options.durationMinutes
      : 60;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const summary = buildLeadVisitSummary(lead);
  const uid = `lead-visit-${lead?.id != null ? String(lead.id) : "0"}-${Date.now()}@obramate.com`;

  return buildSingleEventIcs(
    {
      uid,
      summary,
      description: buildLeadVisitDescription(lead),
      location: buildLeadVisitLocation(lead) || undefined,
      start,
      end,
      stamp: new Date(),
      status: "TENTATIVE",
    },
    { name: summary || "ObraMate", prodId: "-//ObraMate//LeadVisit//PT" },
  );
}
