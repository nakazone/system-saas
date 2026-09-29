/**
 * Calendar math in an organization's IANA timezone (no external deps).
 *
 * The server runs in UTC (Railway), so "today" / "this month" must be derived
 * from `Organization.timezone`, never from the process clock's local time.
 */

export const DEFAULT_TIMEZONE = "America/New_York";

/** Returns a valid IANA zone, falling back to the product default. */
export function safeTimeZone(tz: string | null | undefined): string {
  const candidate = String(tz || "").trim();
  if (!candidate) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

/** Wall-clock parts of `date` as seen in `tz`. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(tz).formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Offset (ms) of `tz` from UTC at the instant `date` (e.g. -6h for Denver in summer). */
export function zoneOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * UTC instant for a wall-clock time in `tz`. Handles DST by re-checking the
 * offset at the candidate instant (gaps resolve forward, overlaps to the first).
 */
export function zonedWallTimeToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffsetMs(new Date(guess), tz);
  const second = guess - zoneOffsetMs(new Date(first), tz);
  return new Date(second);
}

/** Local midnight (in `tz`) of the day containing `date`, shifted by `addDays`. */
export function startOfZonedDay(date: Date, tz: string, addDays = 0): Date {
  const p = zonedParts(date, tz);
  const probe = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
  return zonedWallTimeToUtc(
    tz,
    probe.getUTCFullYear(),
    probe.getUTCMonth() + 1,
    probe.getUTCDate(),
  );
}

/** First instant of the month containing `date` (in `tz`), shifted by `addMonths`. */
export function startOfZonedMonth(date: Date, tz: string, addMonths = 0): Date {
  const p = zonedParts(date, tz);
  const probe = new Date(Date.UTC(p.year, p.month - 1 + addMonths, 1));
  return zonedWallTimeToUtc(tz, probe.getUTCFullYear(), probe.getUTCMonth() + 1, 1);
}

/** `YYYY-MM-DD` of `date` in `tz`. */
export function zonedDateKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Whole calendar days from `from` to `to` in `tz` (positive when `to` is later). */
export function zonedDayDiff(from: Date, to: Date, tz: string): number {
  const a = startOfZonedDay(from, tz).getTime();
  const b = startOfZonedDay(to, tz).getTime();
  return Math.round((b - a) / 86_400_000);
}
