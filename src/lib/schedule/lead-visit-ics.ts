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
  client_id?: string | null;
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
  const origin = resolveLeadCalendarOriginLabel(lead) || readableLeadSource(lead?.source);
  return personCalendarTitle(name, { clientId: lead?.client_id, origin });
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
 * Practical contact card for Apple / Google Calendar notes.
 * Avoids UUIDs and fancy punctuation (calendar apps often show "?" for em dashes).
 */
export function buildLeadVisitDescription(lead: LeadVisitCalendarLead | null | undefined): string {
  const lines: string[] = [];

  const name = lead?.name ? String(lead.name).trim() : "";
  if (name) lines.push("Cliente: " + name);
  if (lead?.phone) lines.push("Tel: " + String(lead.phone).trim());
  if (lead?.email) lines.push("Email: " + String(lead.email).trim());
  const address = buildLeadVisitLocation(lead);
  if (address) lines.push("Endereco: " + address);

  const origin = resolveLeadCalendarOriginLabel(lead);
  if (origin) lines.push("Origem: " + origin);

  let out = lines.join("\n");

  const extra: string[] = [];
  const msg = lead?.message ? String(lead.message).trim() : "";
  if (msg && !isServiceSlugText(msg)) extra.push(msg);
  const notes = lead?.notes ? String(lead.notes).trim() : "";
  if (notes && notes !== msg) extra.push(notes);
  if (extra.length) {
    out += (out ? "\n\n" : "") + CALENDAR_DESC_SEPARATOR + "\n\n" + extra.join("\n\n");
  }

  return out;
}

export type MeetingCalendarLead = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  zipcode?: string | null;
  zip?: string | null;
  message?: string | null;
  source?: string | null;
  form_type?: string | null;
  marketing_platform?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  landing_page?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  client_id?: string | null;
};

/** Human origin typed on the lead (Indicação, Website). Skip slugs and landing paths. */
export function readableLeadSource(source: string | null | undefined): string {
  const src = String(source || "").trim();
  if (!src || src.length > 40) return "";
  if (src.includes("_") || /^lp[-_]/i.test(src)) return "";
  return src;
}

/**
 * Calendar name for a particular client.
 * Client ID wins over origin. ASCII hyphen so calendar apps don't show "?".
 */
export function personCalendarTitle(
  name: string | null | undefined,
  opts?: { clientId?: string | null; origin?: string | null },
): string {
  const base = String(name || "").trim() || "Cliente";
  const clientId = String(opts?.clientId || "").trim();
  if (clientId) return `${base} - ${clientId}`;
  const origin = String(opts?.origin || "").trim();
  if (origin && origin.toLowerCase() !== base.toLowerCase()) return `${base} - ${origin}`;
  return base;
}

function leadMeta(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

function metaText(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return v != null && String(v).trim() ? String(v).trim() : null;
}

/** Google / Meta when we can tell, otherwise the origin typed on the lead. */
export function originFromLeadRecord(
  lead: { source?: string | null; metadata?: unknown } | null | undefined,
): string {
  if (!lead) return "";
  const meta = leadMeta(lead.metadata);
  const origin = resolveLeadCalendarOriginLabel({
    source: lead.source,
    form_type: metaText(meta, "form_type"),
    marketing_platform: metaText(meta, "marketing_platform"),
    utm_source: metaText(meta, "utm_source"),
    utm_medium: metaText(meta, "utm_medium"),
    landing_page: metaText(meta, "landing_page"),
    gclid: metaText(meta, "gclid"),
    fbclid: metaText(meta, "fbclid"),
  });
  return origin || readableLeadSource(lead.source);
}

/** Client ID stored on the lead, when someone filled it. The job's own ID is preferred by callers. */
export function clientIdFromLeadRecord(lead: { metadata?: unknown } | null | undefined): string {
  const meta = leadMeta(lead?.metadata);
  for (const key of ["client_ref", "client_id", "job_name"]) {
    const v = metaText(meta, key);
    if (v) return v.slice(0, 120);
  }
  return "";
}

/** Title safe for Apple Calendar (ASCII hyphen, not em dash). */
export function buildMeetingCalendarSummary(opts: {
  title?: string | null;
  leadName?: string | null;
  isVisit?: boolean;
  lead?: MeetingCalendarLead | null;
  clientId?: string | null;
}): string {
  const leadName = String(opts.leadName || opts.lead?.name || "").trim();
  if (opts.isVisit && leadName) {
    const origin =
      resolveLeadCalendarOriginLabel(opts.lead) || readableLeadSource(opts.lead?.source);
    const clientId = String(opts.clientId || opts.lead?.client_id || "").trim();
    return personCalendarTitle(leadName, { clientId, origin });
  }
  const raw = String(opts.title || "").trim() || (opts.isVisit ? "Visita" : "Compromisso");
  return raw
    .replace(/\u2014|\u2013/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Notes for a saved meeting/visit in Apple Calendar.
 * Prefer lead contact card; append visit notes. Never put lead UUIDs in the body.
 */
export function buildMeetingCalendarDescription(opts: {
  notes?: string | null;
  location?: string | null;
  lead?: MeetingCalendarLead | null;
}): string {
  const lead = opts.lead || null;
  const visitNotes = String(opts.notes || "").trim();
  const location = String(opts.location || "").trim();

  if (lead && (lead.name || lead.phone || lead.email || lead.address || lead.address_line1)) {
    const card = buildLeadVisitDescription({
      ...lead,
      address: lead.address_line1 || lead.address || location || null,
      notes: null,
      message: lead.message || null,
    });
    const parts = [card];
    if (visitNotes) parts.push(CALENDAR_DESC_SEPARATOR, "Notas da visita:", visitNotes);
    else if (lead.notes && String(lead.notes).trim()) {
      parts.push(CALENDAR_DESC_SEPARATOR, String(lead.notes).trim());
    }
    return parts.filter(Boolean).join("\n\n");
  }

  const lines: string[] = [];
  if (location) lines.push("Local: " + location);
  if (visitNotes) lines.push(visitNotes);
  return lines.join("\n\n");
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
