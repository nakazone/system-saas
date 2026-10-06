/**
 * Folha — ciclo de fechamento / dia de pagamento (Organization.featureFlags.payroll).
 *
 * Periods are concrete date ranges on PayrollPeriod; this config only decides
 * how to compute start/end (and the suggested pay day) for a given work date.
 */
import { z } from "zod";
import { parseYmd, ymdFromDate, ymdToBrShort } from "../../crm/lib/payroll-calc.js";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PayCycleFrequency = "weekly" | "biweekly" | "semi_monthly" | "monthly";

export type PayTiming = "same_week" | "next_weekday" | "on_period_end" | "days_after" | "day_of_month";

export type PayCycleSettings = {
  frequency: PayCycleFrequency;
  /** First counted weekday (weekly / biweekly). 0 = Sunday … 6 = Saturday. */
  period_start_weekday: Weekday;
  /** Inclusive length in days (Sun–Fri = 6, Mon–Sun = 7). */
  period_length_days: number;
  pay_timing: PayTiming;
  /** Used by same_week / next_weekday. */
  pay_weekday: Weekday;
  /** Used by days_after. */
  pay_offset_days: number;
  /** 1–31; 31 clamps to last day of month. Used by day_of_month / monthly pay. */
  pay_day_of_month: number;
  /** Known start of a biweekly period (YYYY-MM-DD). */
  biweekly_anchor_ymd: string | null;
};

export type PeriodBounds = {
  start: string;
  end: string;
  label: string;
  pay_on: string;
  frequency: PayCycleFrequency;
};

export const WEEKDAY_LABELS_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export const WEEKDAY_SHORT_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** Current product default: Monday–Sunday week. */
export const DEFAULT_PAY_CYCLE: PayCycleSettings = {
  frequency: "weekly",
  period_start_weekday: 1,
  period_length_days: 7,
  pay_timing: "on_period_end",
  pay_weekday: 5,
  pay_offset_days: 0,
  pay_day_of_month: 15,
  biweekly_anchor_ymd: null,
};

const weekdaySchema = z.number().int().min(0).max(6);

export const payCyclePatchSchema = z.object({
  frequency: z.enum(["weekly", "biweekly", "semi_monthly", "monthly"]).optional(),
  period_start_weekday: weekdaySchema.optional(),
  period_length_days: z.number().int().min(1).max(14).optional(),
  pay_timing: z.enum(["same_week", "next_weekday", "on_period_end", "days_after", "day_of_month"]).optional(),
  pay_weekday: weekdaySchema.optional(),
  pay_offset_days: z.number().int().min(0).max(60).optional(),
  pay_day_of_month: z.number().int().min(1).max(31).optional(),
  biweekly_anchor_ymd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export type PayCyclePatch = z.infer<typeof payCyclePatchSchema>;

function asWeekday(n: unknown, fallback: Weekday): Weekday {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0 || v > 6) return fallback;
  return v as Weekday;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

export function parsePayCycle(featureFlags: unknown): PayCycleSettings {
  const base = { ...DEFAULT_PAY_CYCLE };
  if (!featureFlags || typeof featureFlags !== "object" || Array.isArray(featureFlags)) return base;
  const payroll = (featureFlags as Record<string, unknown>).payroll;
  if (!payroll || typeof payroll !== "object" || Array.isArray(payroll)) return base;
  const cycle = (payroll as Record<string, unknown>).cycle;
  if (!cycle || typeof cycle !== "object" || Array.isArray(cycle)) return base;
  const c = cycle as Record<string, unknown>;
  const freq = String(c.frequency || base.frequency);
  const frequency = (["weekly", "biweekly", "semi_monthly", "monthly"].includes(freq)
    ? freq
    : base.frequency) as PayCycleFrequency;
  const timing = String(c.pay_timing || base.pay_timing);
  const pay_timing = (
    ["same_week", "next_weekday", "on_period_end", "days_after", "day_of_month"].includes(timing)
      ? timing
      : base.pay_timing
  ) as PayTiming;
  const anchor = c.biweekly_anchor_ymd == null ? null : String(c.biweekly_anchor_ymd).slice(0, 10);
  return {
    frequency,
    period_start_weekday: asWeekday(c.period_start_weekday, base.period_start_weekday),
    period_length_days: clampInt(c.period_length_days, 1, 14, base.period_length_days),
    pay_timing,
    pay_weekday: asWeekday(c.pay_weekday, base.pay_weekday),
    pay_offset_days: clampInt(c.pay_offset_days, 0, 60, base.pay_offset_days),
    pay_day_of_month: clampInt(c.pay_day_of_month, 1, 31, base.pay_day_of_month),
    biweekly_anchor_ymd: /^\d{4}-\d{2}-\d{2}$/.test(anchor || "") ? anchor : null,
  };
}

export function applyPayCyclePatch(
  featureFlags: unknown,
  patch: PayCyclePatch,
): Record<string, unknown> {
  const root =
    featureFlags && typeof featureFlags === "object" && !Array.isArray(featureFlags)
      ? { ...(featureFlags as Record<string, unknown>) }
      : {};
  const payroll =
    root.payroll && typeof root.payroll === "object" && !Array.isArray(root.payroll)
      ? { ...(root.payroll as Record<string, unknown>) }
      : {};
  let next = parsePayCycle(root);
  next = {
    ...next,
    ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
    ...(patch.period_start_weekday !== undefined
      ? { period_start_weekday: patch.period_start_weekday as Weekday }
      : {}),
    ...(patch.period_length_days !== undefined ? { period_length_days: patch.period_length_days } : {}),
    ...(patch.pay_timing !== undefined ? { pay_timing: patch.pay_timing } : {}),
    ...(patch.pay_weekday !== undefined ? { pay_weekday: patch.pay_weekday as Weekday } : {}),
    ...(patch.pay_offset_days !== undefined ? { pay_offset_days: patch.pay_offset_days } : {}),
    ...(patch.pay_day_of_month !== undefined ? { pay_day_of_month: patch.pay_day_of_month } : {}),
    ...(patch.biweekly_anchor_ymd !== undefined ? { biweekly_anchor_ymd: patch.biweekly_anchor_ymd } : {}),
  };
  payroll.cycle = next;
  delete payroll.preset;
  root.payroll = payroll;
  return root;
}

export function addUtcDays(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  d.setUTCDate(d.getUTCDate() + days);
  return ymdFromDate(d);
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function ymdOnMonthDay(year: number, month0: number, day: number): string {
  const last = lastDayOfMonth(year, month0);
  const d = Math.min(Math.max(1, day), last);
  return ymdFromDate(new Date(Date.UTC(year, month0, d)));
}

/** Days from start weekday to end weekday inclusive (wrapping allowed). */
export function lengthFromWeekdays(startWd: Weekday, endWd: Weekday): number {
  return ((endWd - startWd + 7) % 7) + 1;
}

export function endWeekdayFromLength(startWd: Weekday, lengthDays: number): Weekday {
  return ((startWd + Math.max(1, lengthDays) - 1) % 7) as Weekday;
}

function weeklyBoundsContaining(refYmd: string, startWd: Weekday, lengthDays: number): { start: string; end: string } {
  const len = Math.min(14, Math.max(1, lengthDays));
  const ref = parseYmd(refYmd)!;
  for (let back = 0; back < len; back++) {
    const start = new Date(ref);
    start.setUTCDate(ref.getUTCDate() - back);
    if (start.getUTCDay() !== startWd) continue;
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + len - 1);
    if (ref.getTime() >= start.getTime() && ref.getTime() <= end.getTime()) {
      return { start: ymdFromDate(start), end: ymdFromDate(end) };
    }
  }
  // Gap day (e.g. Saturday when the period is Sun–Fri): attach to the previous period.
  const start = new Date(ref);
  const diff = (start.getUTCDay() - startWd + 7) % 7;
  start.setUTCDate(start.getUTCDate() - diff);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + len - 1);
  return { start: ymdFromDate(start), end: ymdFromDate(end) };
}

function biweeklyBoundsContaining(refYmd: string, cycle: PayCycleSettings): { start: string; end: string } {
  const len = 14;
  const startWd = cycle.period_start_weekday;
  const anchor = cycle.biweekly_anchor_ymd && parseYmd(cycle.biweekly_anchor_ymd)
    ? weeklyBoundsContaining(cycle.biweekly_anchor_ymd, startWd, len).start
    : weeklyBoundsContaining(refYmd, startWd, len).start;
  const anchorDate = parseYmd(anchor)!;
  const ref = parseYmd(refYmd)!;
  const diffDays = Math.floor((ref.getTime() - anchorDate.getTime()) / 86400000);
  const periodIndex = Math.floor(diffDays / len);
  const start = new Date(anchorDate);
  start.setUTCDate(anchorDate.getUTCDate() + periodIndex * len);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + len - 1);
  return { start: ymdFromDate(start), end: ymdFromDate(end) };
}

function semiMonthlyBounds(refYmd: string): { start: string; end: string } {
  const d = parseYmd(refYmd)!;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (day <= 15) {
    return { start: ymdOnMonthDay(y, m, 1), end: ymdOnMonthDay(y, m, 15) };
  }
  const last = lastDayOfMonth(y, m);
  return { start: ymdOnMonthDay(y, m, 16), end: ymdOnMonthDay(y, m, last) };
}

function monthlyBounds(refYmd: string): { start: string; end: string } {
  const d = parseYmd(refYmd)!;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { start: ymdOnMonthDay(y, m, 1), end: ymdOnMonthDay(y, m, lastDayOfMonth(y, m)) };
}

function sundayOnOrBefore(ymd: string): string {
  const d = parseYmd(ymd)!;
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return ymdFromDate(d);
}

function firstWeekdayOnOrAfter(ymd: string, weekday: Weekday): string {
  const d = parseYmd(ymd)!;
  const diff = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return ymdFromDate(d);
}

function firstWeekdayAfter(ymd: string, weekday: Weekday): string {
  const next = addUtcDays(ymd, 1);
  return firstWeekdayOnOrAfter(next, weekday);
}

export function computePayOn(periodStart: string, periodEnd: string, cycle: PayCycleSettings): string {
  switch (cycle.pay_timing) {
    case "on_period_end":
      return periodEnd;
    case "days_after":
      return addUtcDays(periodEnd, cycle.pay_offset_days);
    case "same_week": {
      const sun = sundayOnOrBefore(periodStart);
      return addUtcDays(sun, cycle.pay_weekday);
    }
    case "next_weekday":
      return firstWeekdayAfter(periodEnd, cycle.pay_weekday);
    case "day_of_month": {
      const end = parseYmd(periodEnd)!;
      let y = end.getUTCFullYear();
      let m = end.getUTCMonth();
      // Pay day on or after period end; if already passed in that month, next month.
      let pay = ymdOnMonthDay(y, m, cycle.pay_day_of_month);
      if (pay < periodEnd) {
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
        pay = ymdOnMonthDay(y, m, cycle.pay_day_of_month);
      }
      return pay;
    }
    default:
      return periodEnd;
  }
}

function labelFor(bounds: { start: string; end: string }, frequency: PayCycleFrequency): string {
  const a = ymdToBrShort(bounds.start);
  const b = ymdToBrShort(bounds.end);
  if (frequency === "semi_monthly") return `Quinzena ${a} – ${b}`;
  if (frequency === "monthly") return `Mês ${a} – ${b}`;
  if (frequency === "biweekly") return `Período ${a} – ${b}`;
  return `Semana ${a} – ${b}`;
}

export function periodBoundsFor(refYmd: string, cycle: PayCycleSettings = DEFAULT_PAY_CYCLE): PeriodBounds {
  const ref = String(refYmd || "").slice(0, 10);
  if (!parseYmd(ref)) {
    const fallback = periodBoundsFor(ymdFromDate(new Date()), cycle);
    return fallback;
  }
  let bounds: { start: string; end: string };
  switch (cycle.frequency) {
    case "biweekly":
      bounds = biweeklyBoundsContaining(ref, cycle);
      break;
    case "semi_monthly":
      bounds = semiMonthlyBounds(ref);
      break;
    case "monthly":
      bounds = monthlyBounds(ref);
      break;
    case "weekly":
    default:
      bounds = weeklyBoundsContaining(ref, cycle.period_start_weekday, cycle.period_length_days);
      break;
  }
  const pay_on = computePayOn(bounds.start, bounds.end, cycle);
  return {
    start: bounds.start,
    end: bounds.end,
    label: labelFor(bounds, cycle.frequency),
    pay_on,
    frequency: cycle.frequency,
  };
}

/** Short human summary for settings UI. */
export function describePayCycle(cycle: PayCycleSettings): string {
  if (cycle.frequency === "semi_monthly") {
    return cycle.pay_timing === "on_period_end"
      ? "Quinzenas 1–15 e 16–fim · paga no último dia de cada quinzena"
      : `Quinzenas · paga no dia ${cycle.pay_day_of_month}`;
  }
  if (cycle.frequency === "monthly") {
    if (cycle.pay_timing === "on_period_end") return "Mês 1–fim · paga no último dia";
    return `Mês 1–fim · paga no dia ${cycle.pay_day_of_month}`;
  }
  const start = WEEKDAY_SHORT_PT[cycle.period_start_weekday];
  const end = WEEKDAY_SHORT_PT[endWeekdayFromLength(cycle.period_start_weekday, cycle.period_length_days)];
  const span = `${start}–${end}`;
  if (cycle.pay_timing === "same_week") {
    return `${span} · paga na ${WEEKDAY_LABELS_PT[cycle.pay_weekday].toLowerCase()} da mesma semana`;
  }
  if (cycle.pay_timing === "next_weekday") {
    return `${span} · paga na ${WEEKDAY_LABELS_PT[cycle.pay_weekday].toLowerCase()} seguinte`;
  }
  if (cycle.pay_timing === "days_after") {
    return `${span} · paga ${cycle.pay_offset_days} dia(s) após o fim`;
  }
  return `${span} · paga no último dia do período`;
}

/** Next N periods from a reference date (for calendar preview). */
export function previewPeriods(refYmd: string, cycle: PayCycleSettings, count = 4): PeriodBounds[] {
  const out: PeriodBounds[] = [];
  let cursor = String(refYmd).slice(0, 10);
  for (let i = 0; i < count; i++) {
    const b = periodBoundsFor(cursor, cycle);
    out.push(b);
    if (cycle.frequency === "weekly") {
      cursor = addUtcDays(b.start, 7);
    } else if (cycle.frequency === "biweekly") {
      cursor = addUtcDays(b.start, 14);
    } else {
      cursor = addUtcDays(b.end, 1);
    }
  }
  return out;
}

/** Neighbor refs for Folha period navigation (skips gap days between short weeks). */
export function adjacentPeriodRefs(
  bounds: { start: string; end: string },
  cycle: PayCycleSettings,
): { prev: string; next: string } {
  if (cycle.frequency === "weekly") {
    return { prev: addUtcDays(bounds.start, -7), next: addUtcDays(bounds.start, 7) };
  }
  if (cycle.frequency === "biweekly") {
    return { prev: addUtcDays(bounds.start, -14), next: addUtcDays(bounds.start, 14) };
  }
  return { prev: addUtcDays(bounds.start, -1), next: addUtcDays(bounds.end, 1) };
}
