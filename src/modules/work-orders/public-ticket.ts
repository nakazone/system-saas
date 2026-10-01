/**
 * View helpers for the worker job ticket (public link sent to temporary workers).
 * Pure functions so they can be tested without a database.
 */
import { safeTimeZone, zonedDateKey, zonedDayDiff, zonedParts } from "../../lib/time/zoned.js";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const pad = (n: number) => String(n).padStart(2, "0");

function weekdayIndex(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

function tzAbbrev(date: Date, tz: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(date)
      .find((x) => x.type === "timeZoneName");
    return part?.value || "";
  } catch {
    return "";
  }
}

export type TicketWhen = {
  /** "Sexta, 2 de outubro" */
  day: string;
  /** "07:30" */
  start: string;
  /** "até 17:00" | "até sáb, 3 out · 17:00" | null */
  until: string | null;
  /** "Hoje" | "Amanhã" | "Em 3 dias" | "Ontem" | "Há 4 dias" */
  relative: string;
  /** "MDT" */
  zone: string;
  /** Job spans more than one day. */
  multiDay: boolean;
};

export function formatTicketWhen(
  startAt: Date | null | undefined,
  endAt: Date | null | undefined,
  timeZone: string | null | undefined,
  now = new Date(),
): TicketWhen | null {
  if (!startAt) return null;
  const tz = safeTimeZone(timeZone);
  const s = zonedParts(startAt, tz);
  const day = `${WEEKDAYS[weekdayIndex(startAt, tz)]}, ${s.day} de ${MONTHS[s.month - 1]}`;
  const start = `${pad(s.hour)}:${pad(s.minute)}`;
  let until: string | null = null;
  let multiDay = false;
  if (endAt && endAt.getTime() > startAt.getTime()) {
    const e = zonedParts(endAt, tz);
    const t = `${pad(e.hour)}:${pad(e.minute)}`;
    if (zonedDateKey(endAt, tz) === zonedDateKey(startAt, tz)) {
      until = `até ${t}`;
    } else {
      multiDay = true;
      until = `até ${WEEKDAYS_SHORT[weekdayIndex(endAt, tz)]}, ${e.day} ${MONTHS_SHORT[e.month - 1]} · ${t}`;
    }
  }
  const diff = zonedDayDiff(now, startAt, tz);
  const relative =
    diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : diff === -1 ? "Ontem" : diff > 1 ? `Em ${diff} dias` : `Há ${-diff} dias`;
  return { day, start, until, relative, zone: tzAbbrev(startAt, tz), multiDay };
}

/** "1 de dezembro de 2026" — used for "link válido até". */
export function formatLongDate(date: Date, timeZone: string | null | undefined): string {
  const p = zonedParts(date, safeTimeZone(timeZone));
  return `${p.day} de ${MONTHS[p.month - 1]} de ${p.year}`;
}

const LOCKBOX_RE = /\/lockbox\s*[#:]?\s*([0-9A-Za-z-]{2,24})\b/i;

/** Same rule as the CRM (`window.parseJobLockbox`): "/lockbox 4821" in the job notes. */
export function parseLockbox(notes: string | null | undefined): string | null {
  const m = String(notes || "").match(LOCKBOX_RE);
  return m ? m[1]! : null;
}

/** Notes without the "/lockbox 4821" token (shown as a badge instead) and its dangling separator. */
export function stripLockbox(notes: string | null | undefined): string {
  const raw = String(notes || "");
  if (!LOCKBOX_RE.test(raw)) return raw.trim();
  const out = raw.replace(new RegExp(LOCKBOX_RE.source + String.raw`\s*[—–\-:,;.]?[ \t]*`, "i"), "").trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const UNIT_LABELS: Record<string, [string, string]> = {
  sq_ft: ["sq ft", "sq ft"],
  sqft: ["sq ft", "sq ft"],
  square_feet: ["sq ft", "sq ft"],
  linear_ft: ["lin ft", "lin ft"],
  linear_feet: ["lin ft", "lin ft"],
  lf: ["lin ft", "lin ft"],
  step: ["degrau", "degraus"],
  steps: ["degrau", "degraus"],
  unit: ["un", "un"],
  units: ["un", "un"],
  each: ["un", "un"],
  piece: ["peça", "peças"],
  pieces: ["peça", "peças"],
  hour: ["h", "h"],
  hours: ["h", "h"],
  day: ["dia", "dias"],
  days: ["dia", "dias"],
  room: ["cômodo", "cômodos"],
  rooms: ["cômodo", "cômodos"],
};

/** "1,180 sq ft", "14 degraus", "" for fixed-price lines with no quantity. */
export function formatQuantity(qty: number, unit: string | null | undefined): string {
  const raw = String(unit || "sq_ft").trim().toLowerCase().replace(/\s+/g, "_");
  if (raw === "fixed" || raw === "flat") return "";
  if (!qty) return "";
  const n = qty.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const label = UNIT_LABELS[raw];
  if (!label) return `${n} ${raw.replace(/_/g, " ")}`;
  return `${n} ${qty === 1 ? label[0] : label[1]}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** US phone digits for tel:/wa.me — "" when it does not look like a phone. */
export function phoneDigits(phone: string | null | undefined): string {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) d = `1${d}`;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

/** Escaped notes with phone numbers turned into tap-to-call links (the super's number, etc.). */
export function notesToHtml(notes: string): string {
  const esc = escapeHtml(notes);
  return esc.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, (m) => {
    const d = phoneDigits(m);
    return d ? `<a href="tel:+${d}">${m}</a>` : m;
  });
}

export const JOB_STATUS_PT: Record<string, { label: string; tone: string }> = {
  draft: { label: "Rascunho", tone: "muted" },
  scheduled: { label: "Agendado", tone: "info" },
  in_progress: { label: "Em andamento", tone: "accent" },
  completed: { label: "Concluído", tone: "done" },
  canceled: { label: "Cancelado", tone: "muted" },
};

export function ticketStatus(status: string, fieldStatus: string | null | undefined) {
  if (status === "scheduled" && fieldStatus === "en_route") return { label: "Equipe a caminho", tone: "accent" };
  if (status === "scheduled" && fieldStatus === "on_site") return { label: "Em andamento", tone: "accent" };
  return JOB_STATUS_PT[status] || { label: status, tone: "muted" };
}

export const STAGE_PT: Record<string, string> = { before: "Antes", during: "Durante", after: "Depois" };

/** Google Maps search URL (opens the app on iOS/Android when installed). */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
