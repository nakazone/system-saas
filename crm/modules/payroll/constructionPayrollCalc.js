/**
 * Payroll line calculation — daily / hourly / mixed construction workers.
 */

/**
 * @param {{ payment_type: string, daily_rate?: unknown, hourly_rate?: unknown, overtime_rate?: unknown }} emp
 * @param {{ days_worked?: unknown, regular_hours?: unknown, overtime_hours?: unknown, daily_rate_override?: unknown }} line
 * @returns {number}
 */
export function calcTimesheetLineAmount(emp, line) {
  const pt = String(emp.payment_type || 'daily').toLowerCase();
  const ovr = line.daily_rate_override;
  const hasOvr = ovr !== undefined && ovr !== null && String(ovr).trim() !== '';
  const drNum = hasOvr ? Number(ovr) : Number(emp.daily_rate) || 0;
  const dr = Number.isFinite(drNum) && drNum >= 0 ? drNum : Number(emp.daily_rate) || 0;
  const hr = Number(emp.hourly_rate) || 0;
  const ort = Number(emp.overtime_rate) || 0;
  const days = Number(line.days_worked) || 0;
  const regH = Number(line.regular_hours) || 0;
  const otH = Number(line.overtime_hours) || 0;

  let base = 0;
  if (pt === 'hourly') {
    const hours = regH > 0 ? regH : days;
    base = hours * hr;
  } else if (pt === 'mixed') {
    base = days * dr + regH * hr;
  } else {
    base = days * dr;
  }

  const total = base + otH * ort;
  return Math.round(total * 100) / 100;
}
