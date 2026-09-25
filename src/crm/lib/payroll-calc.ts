/**
 * Construction payroll line calculation — daily (+ OT) / production / legacy hourly|mixed.
 */

export type PayrollEmpRates = {
  payment_type?: string | null;
  payType?: string | null;
  daily_rate?: unknown;
  dailyRate?: unknown;
  hourly_rate?: unknown;
  hourlyRate?: unknown;
  overtime_rate?: unknown;
  overtimeRate?: unknown;
  production_rate?: unknown;
  productionRate?: unknown;
};

export type PayrollLineQty = {
  days_worked?: unknown;
  daysWorked?: unknown;
  regular_hours?: unknown;
  regularHours?: unknown;
  overtime_hours?: unknown;
  overtimeHours?: unknown;
  daily_rate_override?: unknown;
  dailyRateOverride?: unknown;
  sqft?: unknown;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Extra hour = 10% of daily rate when overtime rate is unset. */
export function effectiveOvertimeRate(emp: PayrollEmpRates): number {
  const ort = num(emp.overtime_rate ?? emp.overtimeRate);
  if (ort > 0) return ort;
  const daily = num(emp.daily_rate ?? emp.dailyRate);
  return Math.round(daily * 0.1 * 100) / 100;
}

/** Default OT rate from daily (10%). */
export function overtimeFromDaily(dailyRate: unknown): number {
  return Math.round(num(dailyRate) * 0.1 * 100) / 100;
}

export function calcTimesheetLineAmount(emp: PayrollEmpRates, line: PayrollLineQty): number {
  const pt = String(emp.payment_type || emp.payType || "daily").toLowerCase();
  const ovr = line.daily_rate_override ?? line.dailyRateOverride;
  const hasOvr = ovr !== undefined && ovr !== null && String(ovr).trim() !== "";
  const empDaily = num(emp.daily_rate ?? emp.dailyRate);
  const drNum = hasOvr ? num(ovr) : empDaily;
  const dr = drNum >= 0 ? drNum : empDaily;
  const hr = num(emp.hourly_rate ?? emp.hourlyRate);
  const ort = effectiveOvertimeRate(emp);
  const days = num(line.days_worked ?? line.daysWorked);
  const regH = num(line.regular_hours ?? line.regularHours);
  const otH = num(line.overtime_hours ?? line.overtimeHours);
  const sqft = num(line.sqft);
  const prodRate = num(emp.production_rate ?? emp.productionRate);

  if (pt === "production") {
    return Math.round(sqft * prodRate * 100) / 100;
  }

  let base = 0;
  if (pt === "hourly") {
    const hours = regH > 0 ? regH : days;
    base = hours * hr;
  } else if (pt === "mixed") {
    base = days * dr + regH * hr;
  } else {
    // daily (default): full days + overtime at 10% of daily (or explicit OT rate)
    base = days * dr;
  }

  return Math.round((base + otH * ort) * 100) / 100;
}

/** hours column = regular + overtime + days*8 (for MTD rollups) */
export function calcTimesheetHoursTotal(line: PayrollLineQty): number {
  const days = num(line.days_worked ?? line.daysWorked);
  const regH = num(line.regular_hours ?? line.regularHours);
  const otH = num(line.overtime_hours ?? line.overtimeHours);
  return Math.round((days * 8 + regH + otH) * 100) / 100;
}

export function ymdFromDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function parseYmd(s: string): Date | null {
  const m = String(s || "")
    .trim()
    .slice(0, 10)
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function mondayYmdFromCalendarYmd(ymd: string): string | null {
  const d = parseYmd(ymd);
  if (!d) return null;
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return ymdFromDate(d);
}

export function sundayYmdAfterMonday(monYmd: string): string | null {
  const d = parseYmd(monYmd);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + 6);
  return ymdFromDate(d);
}

export function ymdToBrShort(ymd: string): string {
  const m = String(ymd || "")
    .slice(0, 10)
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
