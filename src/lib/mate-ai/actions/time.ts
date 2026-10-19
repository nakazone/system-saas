/** Dates and times in the company's timezone, without extra dependencies. */

function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** "2026-10-26" + "07:00" in America/Denver → Date (UTC instant). */
export function zonedToUtc(date: string, time: string, tz: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || "00:00");
  if (!d || !t) return null;
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  let offset = tzOffsetMinutes(guess, tz);
  let utc = guess - offset * 60000;
  // Second pass handles DST edges.
  offset = tzOffsetMinutes(utc, tz);
  utc = guess - offset * 60000;
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** Local calendar day (YYYY-MM-DD) of an instant. */
export function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function localTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** UTC range covering whole local days [from, to]. */
export function dayRange(from: string, to: string, tz: string): { start: Date; end: Date } {
  return { start: zonedToUtc(from, "00:00", tz)!, end: zonedToUtc(addDays(to, 1), "00:00", tz)! };
}

export function fmtDate(day: string): string {
  const d = new Date(day + "T12:00:00Z");
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" }).format(d);
}

export function fmtDateTime(d: Date, tz: string, allDay = false): string {
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "short" }).format(d);
  return allDay ? day + " · dia inteiro" : day + " · " + localTime(d, tz);
}

export function isIsoDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function cleanTime(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})(?::|h)?(\d{2})?\s*(am|pm)?$/);
  if (!m) m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}
