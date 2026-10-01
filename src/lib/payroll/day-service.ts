/**
 * Dia de trabalho — DB side. Every function runs inside a tenant transaction.
 *
 * Flow: start (time + GPS + first job) → add/switch jobs → finish (jobs, sqft, photos of
 * today per job, note, time + GPS) → computed hours/overtime/pay → auto-approved into the
 * week's payroll when nothing looks off, otherwise waits for the office.
 */
import { Prisma } from "@prisma/client";
import type { PayrollTx } from "../../crm/lib/payroll-employee-link.js";
import { myJobAccessWhere } from "../../crm/lib/campo-shared.js";
import { calcTimesheetHoursTotal, mondayYmdFromCalendarYmd, parseYmd, sundayYmdAfterMonday, ymdToBrShort } from "../../crm/lib/payroll-calc.js";
import { safeTimeZone, startOfZonedDay } from "../time/zoned.js";
import {
  computeDayMinutes,
  dayAmount,
  expectedTimes,
  nearestDistance,
  reviewFlags,
  workDateFor,
  ymd,
  type DaySchedule,
} from "./day.js";

export type Gps = { lat: number; lng: number; accuracy: number | null } | null;

type Employee = NonNullable<Awaited<ReturnType<PayrollTx["payrollEmployee"]["findFirst"]>>>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function scheduleOf(emp: Employee): DaySchedule {
  return {
    scheduleStartMode: emp.scheduleStartMode || "job",
    scheduleStartTime: emp.scheduleStartTime || "07:00",
    scheduleEndTime: emp.scheduleEndTime || "17:00",
    lunchMinutes: emp.lunchMinutes || 0,
    countEarlyStart: Boolean(emp.countEarlyStart),
  };
}

export function dayBounds(workDate: Date, tz: string): { start: Date; end: Date } {
  const zone = safeTimeZone(tz);
  // workDate is the calendar date at UTC midnight; noon UTC is safely inside it for US zones.
  const probe = new Date(workDate.getTime() + 12 * 3600_000);
  return { start: startOfZonedDay(probe, zone), end: startOfZonedDay(probe, zone, 1) };
}

/** Jobs on the employee's agenda that day (assigned / member / crew), first one first. */
export async function jobsForDay(tx: PayrollTx, userId: string, workDate: Date, tz: string) {
  const { start, end } = dayBounds(workDate, tz);
  const rows = await tx.workOrder.findMany({
    where: {
      status: { notIn: ["canceled", "completed"] },
      ...myJobAccessWhere(userId),
      scheduledStart: { lt: end },
      OR: [{ scheduledEnd: { gte: start } }, { scheduledEnd: null, scheduledStart: { gte: start } }],
    },
    orderBy: [{ scheduledStart: "asc" }],
    select: jobSelect,
    take: 20,
  });
  // Jobs that start today come first (by time); multi-day jobs already running go after.
  const startsToday = (w: { scheduledStart: Date | null }) => Boolean(w.scheduledStart && w.scheduledStart >= start);
  return [...rows.filter(startsToday), ...rows.filter((w) => !startsToday(w))];
}

export const jobSelect = {
  id: true,
  number: true,
  title: true,
  address: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  geoLat: true,
  geoLng: true,
  customer: { select: { name: true } },
  builder: { select: { company: true, firstName: true, lastName: true } },
} satisfies Prisma.WorkOrderSelect;

/** Known locations of jobs: geocoded address, else GPS of photos taken there. */
export async function jobPlaces(tx: PayrollTx, workOrderIds: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  if (!workOrderIds.length) return out;
  const wos = await tx.workOrder.findMany({ where: { id: { in: workOrderIds } }, select: { id: true, geoLat: true, geoLng: true } });
  for (const w of wos) if (w.geoLat != null && w.geoLng != null) out.set(w.id, { lat: num(w.geoLat), lng: num(w.geoLng) });
  const missing = workOrderIds.filter((id) => !out.has(id));
  if (missing.length) {
    const photos = await tx.jobMedia.findMany({
      where: { workOrderId: { in: missing }, deletedAt: null, lat: { not: null }, lng: { not: null } },
      select: { workOrderId: true, lat: true, lng: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const by = new Map<string, { lat: number; lng: number }[]>();
    for (const p of photos) {
      const arr = by.get(p.workOrderId) || [];
      arr.push({ lat: num(p.lat), lng: num(p.lng) });
      by.set(p.workOrderId, arr);
    }
    for (const [id, arr] of by) {
      const lats = arr.map((a) => a.lat).sort((a, b) => a - b);
      const lngs = arr.map((a) => a.lng).sort((a, b) => a - b);
      out.set(id, { lat: lats[Math.floor(lats.length / 2)]!, lng: lngs[Math.floor(lngs.length / 2)]! });
    }
  }
  return out;
}

/**
 * Photos the employee took that day on each job: taken time from the device when the app
 * sent it (offline uploads arrive later), else the upload time.
 */
export async function photoCounts(
  tx: PayrollTx,
  userId: string | null,
  workOrderIds: string[],
  workDate: Date,
  tz: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // No login (day logged by the office) → no photos of their own to count.
  if (!workOrderIds.length || !userId) return out;
  const { start, end } = dayBounds(workDate, tz);
  const rows = await tx.jobMedia.groupBy({
    by: ["workOrderId"],
    where: {
      workOrderId: { in: workOrderIds },
      authorId: userId,
      deletedAt: null,
      type: "photo",
      OR: [
        { takenAtDevice: { gte: start, lt: end } },
        { takenAtDevice: null, createdAt: { gte: start, lt: end } },
      ],
    },
    _count: { _all: true },
  });
  for (const r of rows) out.set(r.workOrderId, r._count._all);
  return out;
}

/** Weekly period (Mon–Sun) covering the date; created when missing. */
export async function periodFor(tx: PayrollTx, organizationId: string, workDate: Date) {
  const covering = await tx.payrollPeriod.findFirst({
    where: { startDate: { lte: workDate }, endDate: { gte: workDate } },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
  });
  if (covering) return covering;
  const mon = mondayYmdFromCalendarYmd(ymd(workDate))!;
  const sun = sundayYmdAfterMonday(mon)!;
  return tx.payrollPeriod.create({
    data: {
      organizationId,
      label: `Semana ${ymdToBrShort(mon)} – ${ymdToBrShort(sun)}`,
      startDate: parseYmd(mon)!,
      endDate: parseYmd(sun)!,
      status: "open",
    },
  });
}

/** Approved day → one payroll line (idempotent by shiftId). Returns false when the week is closed. */
export async function postDayToPayroll(tx: PayrollTx, shiftId: string): Promise<boolean> {
  const shift = await tx.campoShift.findFirst({
    where: { id: shiftId },
    include: { employee: true, jobs: { include: { workOrder: { select: { number: true, title: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!shift?.employee) return false;
  const period = await periodFor(tx, shift.organizationId, shift.workDate);
  if (period.status !== "open") return false;
  const emp = shift.employee;
  const otHours = Math.round((shift.overtimeMinutes / 60) * 100) / 100;
  const days = num(shift.daysWorked);
  const sqft = num(shift.sqft);
  const jobsLabel = shift.jobs.map((j) => `#${j.workOrder.number ?? "?"} ${j.workOrder.title}`).join(" · ");
  const data = {
    organizationId: shift.organizationId,
    periodId: period.id,
    employeeId: emp.id,
    workDate: shift.workDate,
    daysWorked: emp.payType === "production" ? 0 : days,
    regularHours: 0,
    overtimeHours: emp.payType === "production" ? 0 : otHours,
    sqft,
    hours: calcTimesheetHoursTotal({ daysWorked: emp.payType === "production" ? 0 : days, overtimeHours: otHours }),
    calculatedAmount: shift.amount,
    sector: shift.sector || emp.sector || null,
    shiftId: shift.id,
    notes: `Dia de trabalho${jobsLabel ? ` · ${jobsLabel}` : ""}`.slice(0, 500),
  };
  const existing = await tx.payrollTimesheet.findFirst({ where: { shiftId: shift.id } });
  const line = existing
    ? await tx.payrollTimesheet.update({ where: { id: existing.id }, data })
    : await tx.payrollTimesheet.create({ data });
  await tx.campoShift.update({ where: { id: shift.id }, data: { timesheetId: line.id } });
  return true;
}

/** Day leaves payroll (returned / edited back to review). Refuses when the week is closed. */
export async function removeDayFromPayroll(tx: PayrollTx, shiftId: string): Promise<boolean> {
  const line = await tx.payrollTimesheet.findFirst({ where: { shiftId }, include: { period: true } });
  if (!line) return true;
  if (line.period.status !== "open") return false;
  await tx.payrollTimesheet.delete({ where: { id: line.id } });
  await tx.campoShift.update({ where: { id: shiftId }, data: { timesheetId: null } });
  return true;
}

export type FinishInput = {
  clockOut: Date;
  gps: Gps;
  deviceAt: Date | null;
  note: string | null;
  jobs: { workOrderId: string; sqft: number }[];
  source?: "clock" | "manual" | "auto_closed";
  now?: Date;
};

/**
 * Close the day: compute minutes, overtime, pay and review flags, then auto-approve
 * into payroll or leave it for the office. Photos are enforced by the caller (blocking),
 * except for auto-closed days which carry a flag instead.
 */
export async function closeDay(
  tx: PayrollTx,
  shiftId: string,
  input: FinishInput,
  ctx: { tz: string; userId: string | null },
) {
  const now = input.now ?? new Date();
  const shift = await tx.campoShift.findFirstOrThrow({ where: { id: shiftId }, include: { employee: true } });
  const emp = shift.employee;
  if (!emp) throw Object.assign(new Error("Funcionário não ligado à folha"), { status: 409 });
  const tz = ctx.tz;

  // Jobs of the day (keep order of arrival)
  const existingJobs = await tx.campoShiftJob.findMany({ where: { shiftId }, orderBy: { sortOrder: "asc" } });
  const wanted = input.jobs.length ? input.jobs : existingJobs.map((j) => ({ workOrderId: j.workOrderId, sqft: num(j.sqft) }));
  const keep = new Set(wanted.map((j) => j.workOrderId));
  await tx.campoShiftJob.deleteMany({ where: { shiftId, workOrderId: { notIn: [...keep] } } });
  const photos = await photoCounts(tx, ctx.userId, [...keep], shift.workDate, tz);
  let order = 0;
  for (const j of wanted) {
    const prev = existingJobs.find((e) => e.workOrderId === j.workOrderId);
    const data = { sqft: Math.max(0, j.sqft || 0), photoCount: photos.get(j.workOrderId) || 0, sortOrder: order++ };
    if (prev) await tx.campoShiftJob.update({ where: { id: prev.id }, data });
    else
      await tx.campoShiftJob.create({
        data: { organizationId: shift.organizationId, shiftId, workOrderId: j.workOrderId, arrivedAt: null, ...data },
      });
  }

  const jobRows = await tx.workOrder.findMany({ where: { id: { in: [...keep] } }, select: { id: true, scheduledStart: true } });
  const firstScheduled = jobRows
    .map((j) => j.scheduledStart)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const exp = expectedTimes(shift.workDate, scheduleOf(emp), tz, firstScheduled);
  const clockOut = input.clockOut.getTime() > shift.clockInAt.getTime() ? input.clockOut : new Date(shift.clockInAt.getTime() + 60_000);
  const mins = computeDayMinutes({
    clockIn: shift.clockInAt,
    clockOut,
    lunchMinutes: emp.lunchMinutes || 0,
    expectedStart: exp.start,
    expectedEnd: exp.end,
    countEarlyStart: Boolean(emp.countEarlyStart),
  });
  const sqft = wanted.reduce((s, j) => s + Math.max(0, j.sqft || 0), 0);
  const daysWorked = num(shift.daysWorked) || 1;
  const amount = dayAmount(emp, { daysWorked, overtimeMinutes: mins.overtimeMinutes, sqft });

  const places = await jobPlaces(tx, [...keep]);
  const firstJobId = existingJobs[0]?.workOrderId ?? wanted[0]?.workOrderId;
  const startPoint = shift.clockInLat != null ? { lat: num(shift.clockInLat), lng: num(shift.clockInLng) } : null;
  const startPlace = firstJobId && places.get(firstJobId) ? [places.get(firstJobId)!] : [...places.values()];
  const startDistanceM = shift.clockInDistanceM ?? nearestDistance(startPoint, startPlace);
  const endPoint = input.gps ? { lat: input.gps.lat, lng: input.gps.lng } : null;
  const endDistanceM = nearestDistance(endPoint, [...places.values()]);
  const source = input.source || (shift.source === "manual" ? "manual" : "clock");
  const missingPhotos = emp.requirePhotos && [...keep].some((id) => !(photos.get(id) || 0));
  const flags = reviewFlags({
    source,
    requireGps: emp.requireGps,
    hasStartGps: startPoint != null,
    hasEndGps: endPoint != null,
    startDistanceM,
    endDistanceM,
    overtimeMinutes: mins.overtimeMinutes,
    workedMinutes: mins.workedMinutes,
    jobCount: keep.size,
    pastDay: ymd(workDateFor(now, tz)) !== ymd(shift.workDate) && source === "manual",
    missingPhotos,
    payType: emp.payType,
  });

  await tx.campoShift.update({
    where: { id: shiftId },
    data: {
      clockOutAt: clockOut,
      status: "closed",
      source,
      note: input.note?.trim() || null,
      clockOutLat: input.gps ? new Prisma.Decimal(input.gps.lat) : null,
      clockOutLng: input.gps ? new Prisma.Decimal(input.gps.lng) : null,
      clockOutAccuracyM: input.gps?.accuracy != null ? new Prisma.Decimal(input.gps.accuracy) : null,
      clockOutDistanceM: endDistanceM,
      clockInDistanceM: startDistanceM,
      clockOutDeviceAt: input.deviceAt,
      expectedStartAt: exp.start,
      expectedEndAt: exp.end,
      workedMinutes: mins.workedMinutes,
      lunchMinutes: mins.workedMinutes > 0 ? Math.min(emp.lunchMinutes || 0, mins.workedMinutes) : 0,
      overtimeMinutes: emp.payType === "production" ? 0 : mins.overtimeMinutes,
      sqft: new Prisma.Decimal(sqft),
      amount: new Prisma.Decimal(amount),
      sector: emp.sector || null,
      flags,
      submittedAt: now,
      reviewStatus: "pending",
      reviewNote: null,
    },
  });
  // Close any open time segment (job hours on the job page).
  await tx.campoSegment.updateMany({ where: { shiftId, endedAt: null }, data: { endedAt: clockOut } });

  if (!flags.length) {
    const posted = await postDayToPayroll(tx, shiftId);
    await tx.campoShift.update({
      where: { id: shiftId },
      data: posted
        ? { reviewStatus: "approved", reviewedAt: now }
        : { reviewStatus: "pending", flags: ["period_closed"] },
    });
  }
  return tx.campoShift.findFirstOrThrow({ where: { id: shiftId } });
}

/** Days left open from a previous date are closed at the expected end and sent to review. */
export async function autoCloseStaleDays(tx: PayrollTx, userId: string, tz: string, now = new Date()) {
  const today = workDateFor(now, tz);
  const stale = await tx.campoShift.findMany({
    where: { userId, status: "open", workDate: { lt: today }, reviewStatus: "in_progress" },
    include: { employee: true },
  });
  for (const s of stale) {
    if (!s.employee) {
      await tx.campoShift.update({ where: { id: s.id }, data: { status: "closed", clockOutAt: s.clockInAt } });
      continue;
    }
    const end = expectedTimes(s.workDate, scheduleOf(s.employee), tz, null).end;
    await closeDay(
      tx,
      s.id,
      { clockOut: end.getTime() > s.clockInAt.getTime() ? end : new Date(s.clockInAt.getTime() + 3600_000), gps: null, deviceAt: null, note: null, jobs: [], source: "auto_closed", now },
      { tz, userId },
    );
  }
  return stale.length;
}
