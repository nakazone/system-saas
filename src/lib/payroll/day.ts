/**
 * Dia de trabalho — pure rules (no DB): expected start/end from the employee's default
 * schedule, worked/overtime minutes, pay and the reasons a day needs the office to look.
 */
import { calcTimesheetLineAmount, type PayrollEmpRates } from "../../crm/lib/payroll-calc.js";
import { safeTimeZone, zonedParts, zonedWallTimeToUtc } from "../time/zoned.js";

export type DaySchedule = {
  scheduleStartMode: string; // job | fixed
  scheduleStartTime: string; // HH:MM
  scheduleEndTime: string; // HH:MM
  lunchMinutes: number;
  countEarlyStart: boolean;
};

export const DAY_FLAG_LABELS: Record<string, string> = {
  manual: "Lançado sem bater o ponto",
  auto_closed: "Esqueceu de finalizar — fechado pelo sistema",
  far_start: "Começou longe do job",
  far_end: "Finalizou longe do job",
  no_gps: "Sem localização",
  overtime_high: "Muita hora extra",
  short_day: "Dia curto (menos de 4h)",
  past_day: "Lançado depois do dia",
  no_photos: "Sem fotos do dia",
  no_job: "Sem job informado",
  period_closed: "Semana já fechada",
  reimbursement: "Reembolso / recibo para conferir",
};

/** Distance (m) beyond which a start/finish is "far from the job". */
export const FAR_FROM_JOB_M = 500;
/** Overtime above this needs a look. */
export const HIGH_OVERTIME_MIN = 180;
export const SHORT_DAY_MIN = 240;
export const OT_ROUND_MIN = 15;

export function parseHHMM(v: string | null | undefined, fallback = "07:00"): { h: number; m: number } {
  const m = String(v || "").match(/^(\d{1,2}):(\d{2})$/) || fallback.match(/^(\d{1,2}):(\d{2})$/)!;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return { h, m: mm };
}

export function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v);
}

/** `workDate` is the calendar day (stored as UTC midnight of that date). */
export function wallTimeOn(workDate: Date, hhmm: string, tz: string): Date {
  const { h, m } = parseHHMM(hhmm);
  return zonedWallTimeToUtc(
    safeTimeZone(tz),
    workDate.getUTCFullYear(),
    workDate.getUTCMonth() + 1,
    workDate.getUTCDate(),
    h,
    m,
  );
}

/** Calendar day (UTC-midnight Date) of an instant, in the org timezone. */
export function workDateFor(at: Date, tz: string): Date {
  const p = zonedParts(at, safeTimeZone(tz));
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** When the day is expected to start/end. "job" mode uses the first scheduled job that day. */
export function expectedTimes(
  workDate: Date,
  schedule: DaySchedule,
  tz: string,
  firstJobStart: Date | null,
): { start: Date; end: Date } {
  const fixedStart = wallTimeOn(workDate, schedule.scheduleStartTime, tz);
  let start = fixedStart;
  if (schedule.scheduleStartMode === "job" && firstJobStart && ymd(workDateFor(firstJobStart, tz)) === ymd(workDate)) {
    start = firstJobStart;
  }
  let end = wallTimeOn(workDate, schedule.scheduleEndTime, tz);
  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 8 * 3600_000);
  return { start, end };
}

function roundMinutes(min: number, step = OT_ROUND_MIN): number {
  if (min <= 0) return 0;
  return Math.round(min / step) * step;
}

/**
 * Worked minutes (minus lunch) and overtime: time after the expected end
 * (plus before the expected start when `countEarlyStart`), rounded to 15 min.
 */
export function computeDayMinutes(input: {
  clockIn: Date;
  clockOut: Date;
  lunchMinutes: number;
  expectedStart: Date;
  expectedEnd: Date;
  countEarlyStart: boolean;
}): { workedMinutes: number; overtimeMinutes: number } {
  const total = Math.max(0, Math.round((input.clockOut.getTime() - input.clockIn.getTime()) / 60000));
  const lunch = total > 5 * 60 ? Math.max(0, input.lunchMinutes) : 0;
  const workedMinutes = Math.max(0, total - lunch);
  let ot = Math.max(0, (input.clockOut.getTime() - input.expectedEnd.getTime()) / 60000);
  if (input.countEarlyStart) ot += Math.max(0, (input.expectedStart.getTime() - input.clockIn.getTime()) / 60000);
  return { workedMinutes, overtimeMinutes: Math.min(roundMinutes(ot), workedMinutes) };
}

export function dayAmount(
  emp: PayrollEmpRates,
  q: { daysWorked: number; overtimeMinutes: number; sqft: number },
): number {
  return calcTimesheetLineAmount(emp, {
    daysWorked: q.daysWorked,
    overtimeHours: Math.round((q.overtimeMinutes / 60) * 100) / 100,
    sqft: q.sqft,
  });
}

/** Great-circle distance in meters. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/** Closest distance from a point to any known job location (null when nothing to compare). */
export function nearestDistance(
  point: { lat: number; lng: number } | null,
  places: { lat: number; lng: number }[],
): number | null {
  if (!point || !places.length) return null;
  return Math.min(...places.map((p) => distanceM(point, p)));
}

export function reviewFlags(input: {
  source: string;
  requireGps: boolean;
  hasStartGps: boolean;
  hasEndGps: boolean;
  startDistanceM: number | null;
  endDistanceM: number | null;
  overtimeMinutes: number;
  workedMinutes: number;
  jobCount: number;
  pastDay: boolean;
  missingPhotos: boolean;
  payType: string;
}): string[] {
  const f: string[] = [];
  if (input.source === "manual") f.push("manual");
  if (input.source === "auto_closed") f.push("auto_closed");
  if (input.requireGps && input.source === "clock" && (!input.hasStartGps || !input.hasEndGps)) f.push("no_gps");
  if (input.startDistanceM != null && input.startDistanceM > FAR_FROM_JOB_M) f.push("far_start");
  if (input.endDistanceM != null && input.endDistanceM > FAR_FROM_JOB_M) f.push("far_end");
  if (input.payType !== "production" && input.overtimeMinutes > HIGH_OVERTIME_MIN) f.push("overtime_high");
  if (input.workedMinutes < SHORT_DAY_MIN) f.push("short_day");
  if (!input.jobCount) f.push("no_job");
  if (input.pastDay) f.push("past_day");
  if (input.missingPhotos) f.push("no_photos");
  return f;
}

export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
