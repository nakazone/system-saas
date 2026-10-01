/**
 * Campo · Meu dia — the employee's work day (mobile first).
 *
 * GET  /api/campo/dia                 today's state, jobs, week, payments
 * POST /api/campo/dia/start           begin the day (time + GPS + first job)
 * POST /api/campo/dia/jobs            add / switch to another job
 * DELETE /api/campo/dia/jobs/:woId    remove a job added by mistake
 * POST /api/campo/dia/finish          finish (jobs + sqft + note + GPS + recibos) — photos of today required
 * POST /api/campo/dia/recibos         upload receipt image (data_url) before / during finish
 * POST /api/campo/dia/manual          forgot to clock: date + times (or fix a returned day)
 * GET  /api/campo/dia/jobs/search     find a job that is not on the agenda
 * GET  /api/campo/dia/semana          the week's days (Horas tab)
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth } from "../http.js";
import { canUseCampo, clientLabel } from "../lib/campo-shared.js";
import { resolveOwnEmployee, type PayrollTx } from "../lib/payroll-employee-link.js";
import { safeTimeZone } from "../../lib/time/zoned.js";
import { mondayYmdFromCalendarYmd, parseYmd, sundayYmdAfterMonday } from "../lib/payroll-calc.js";
import {
  DAY_FLAG_LABELS,
  computeDayMinutes,
  dayAmount,
  expectedTimes,
  isHHMM,
  minutesLabel,
  nearestDistance,
  wallTimeOn,
  workDateFor,
  ymd,
} from "../../lib/payroll/day.js";
import {
  autoCloseStaleDays,
  closeDay,
  dayBounds,
  jobPlaces,
  jobSelect,
  jobsForDay,
  photoCounts,
  removeDayFromPayroll,
  scheduleOf,
  type Gps,
} from "../../lib/payroll/day-service.js";
import { ensureJobGeo } from "../../lib/payroll/geocode.js";
import {
  attachExpensesToShift,
  flagShiftForExpenses,
  mapExpense,
} from "../../lib/payroll/shift-expenses.js";
import { storage } from "../../lib/storage/index.js";
import { randomUUID } from "node:crypto";

export const campoDiaRouter = Router();

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const STATUS_LABEL: Record<string, string> = {
  in_progress: "Em andamento",
  pending: "Aguardando aprovação",
  approved: "Aprovado",
  returned: "Devolvido para ajuste",
};

const PAY_METHOD_LABEL: Record<string, string> = {
  cash: "Dinheiro",
  zelle: "Zelle",
  check: "Cheque",
  ach: "ACH",
  transfer: "Transferência",
  other: "Outro",
};

async function orgTz(orgId: string): Promise<string> {
  const o = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  return safeTimeZone(o?.timezone);
}

function timeLabel(d: Date | null | undefined, tz: string): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function dateLabel(workDate: Date): string {
  return `${WEEKDAYS[workDate.getUTCDay()]}, ${workDate.getUTCDate()}/${String(workDate.getUTCMonth() + 1).padStart(2, "0")}`;
}

function gpsFrom(body: Record<string, unknown>): Gps {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  const acc = Number(body.accuracy);
  return { lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? Math.min(acc, 99999) : null };
}

function deviceAt(body: Record<string, unknown>): Date | null {
  if (!body.device_at) return null;
  const d = new Date(String(body.device_at));
  return Number.isNaN(d.getTime()) ? null : d;
}

type JobRow = Prisma.WorkOrderGetPayload<{ select: typeof jobSelect }>;

function mapJob(wo: JobRow, tz: string, photos: number, dayStart?: Date) {
  const continuing = Boolean(dayStart && wo.scheduledStart && wo.scheduledStart < dayStart);
  return {
    id: wo.id,
    number: wo.number,
    title: wo.title,
    client: clientLabel(wo),
    address: wo.address,
    maps_url: wo.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(wo.address)}` : null,
    scheduled_start: wo.scheduledStart?.toISOString() ?? null,
    /** Multi-day job that started on an earlier day: no start time today. */
    start_label: continuing ? null : timeLabel(wo.scheduledStart, tz),
    continuing,
    photos_today: photos,
  };
}

const dayInclude = {
  employee: true,
  jobs: { orderBy: { sortOrder: "asc" as const }, include: { workOrder: { select: jobSelect } } },
  expenses: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.CampoShiftInclude;
type DayRow = Prisma.CampoShiftGetPayload<{ include: typeof dayInclude }>;

/** Day for the employee, with a live estimate while it is still running. */
async function mapDay(tx: PayrollTx, d: DayRow, tz: string, now = new Date()) {
  const ids = d.jobs.map((j) => j.workOrderId);
  const photos = await photoCounts(tx, d.userId, ids, d.workDate, tz);
  const emp = d.employee;
  let worked = d.workedMinutes;
  let overtime = d.overtimeMinutes;
  let amount = num(d.amount);
  let expectedEnd = d.expectedEndAt;
  if (d.reviewStatus === "in_progress" && emp) {
    const first = d.jobs.map((j) => j.workOrder.scheduledStart).filter((x): x is Date => Boolean(x)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const exp = expectedTimes(d.workDate, scheduleOf(emp), tz, first);
    expectedEnd = exp.end;
    const m = computeDayMinutes({
      clockIn: d.clockInAt,
      clockOut: now,
      lunchMinutes: emp.lunchMinutes,
      expectedStart: exp.start,
      expectedEnd: exp.end,
      countEarlyStart: emp.countEarlyStart,
    });
    worked = m.workedMinutes;
    overtime = emp.payType === "production" ? 0 : m.overtimeMinutes;
    amount = dayAmount(emp, { daysWorked: num(d.daysWorked) || 1, overtimeMinutes: overtime, sqft: d.jobs.reduce((s, j) => s + num(j.sqft), 0) });
  }
  const flags = Array.isArray(d.flags) ? (d.flags as string[]) : [];
  return {
    id: d.id,
    date: ymd(d.workDate),
    date_label: dateLabel(d.workDate),
    status: d.reviewStatus,
    status_label: STATUS_LABEL[d.reviewStatus] || d.reviewStatus,
    source: d.source,
    clock_in: d.clockInAt.toISOString(),
    clock_in_label: timeLabel(d.clockInAt, tz),
    clock_out: d.clockOutAt?.toISOString() ?? null,
    clock_out_label: timeLabel(d.clockOutAt, tz),
    expected_end_label: timeLabel(expectedEnd, tz),
    worked_minutes: worked,
    worked_label: minutesLabel(worked),
    lunch_minutes: d.lunchMinutes || emp?.lunchMinutes || 0,
    overtime_minutes: overtime,
    overtime_label: overtime ? minutesLabel(overtime) : null,
    days_worked: num(d.daysWorked),
    sqft: d.jobs.reduce((s, j) => s + num(j.sqft), 0) || num(d.sqft),
    amount: Math.round(amount * 100) / 100,
    note: d.note,
    review_note: d.reviewNote,
    flags: flags.map((k) => ({ key: k, label: DAY_FLAG_LABELS[k] || k })),
    gps_in: d.clockInLat != null ? { lat: num(d.clockInLat), lng: num(d.clockInLng), accuracy: d.clockInAccuracyM != null ? num(d.clockInAccuracyM) : null, distance_m: d.clockInDistanceM } : null,
    gps_out: d.clockOutLat != null ? { lat: num(d.clockOutLat), lng: num(d.clockOutLng), accuracy: d.clockOutAccuracyM != null ? num(d.clockOutAccuracyM) : null, distance_m: d.clockOutDistanceM } : null,
    jobs: d.jobs.map((j) => ({
      ...mapJob(j.workOrder, tz, photos.get(j.workOrderId) || 0),
      sqft: num(j.sqft),
      arrived_label: timeLabel(j.arrivedAt, tz),
    })),
    expenses: (d.expenses || []).map(mapExpense),
  };
}

function mapEmployee(emp: NonNullable<DayRow["employee"]>) {
  return {
    id: emp.id,
    name: emp.name,
    pay_type: emp.payType === "production" ? "production" : "daily",
    sector: emp.sector,
    daily_rate: num(emp.dailyRate),
    production_rate: num(emp.productionRate),
    schedule: {
      start_mode: emp.scheduleStartMode,
      start_time: emp.scheduleStartTime,
      end_time: emp.scheduleEndTime,
      lunch_minutes: emp.lunchMinutes,
    },
    require_photos: emp.requirePhotos,
    require_gps: emp.requireGps,
  };
}

/** Payment status per week for this employee (newest first). */
async function payments(tx: PayrollTx, employeeId: string) {
  const periods = await tx.payrollPeriod.findMany({
    where: { timesheets: { some: { employeeId } } },
    orderBy: { startDate: "desc" },
    take: 8,
    include: {
      timesheets: { where: { employeeId }, select: { calculatedAmount: true } },
      adjustments: { where: { employeeId } },
      payments: { where: { employeeId, status: "paid" }, orderBy: { paidOn: "desc" } },
    },
  });
  return periods.map((p) => {
    const lines = p.timesheets.reduce((s, t) => s + num(t.calculatedAmount), 0);
    const adj = p.adjustments.reduce((s, a) => s + num(a.reimbursement) - num(a.discount), 0);
    const pay = p.payments[0];
    const status = pay ? "paid" : p.status === "closed" ? "due" : "open";
    return {
      period_id: p.id,
      label: p.label,
      start: ymd(p.startDate),
      end: ymd(p.endDate),
      amount: Math.round((lines + adj) * 100) / 100,
      status,
      status_label: status === "paid" ? "Pago" : status === "due" ? "A pagar" : "Em aberto",
      paid_on: pay ? ymd(pay.paidOn) : null,
      paid_amount: pay ? num(pay.amount) : null,
      method_label: pay?.method ? PAY_METHOD_LABEL[pay.method] || pay.method : null,
    };
  });
}

function guard(req: AuthedRequest, res: import("express").Response): boolean {
  if (!canUseCampo(req)) {
    res.status(403).json({ success: false, error: "Sem permissão" });
    return false;
  }
  return true;
}

function fail(res: import("express").Response, error: unknown, next: import("express").NextFunction) {
  const err = error as { status?: number; message?: string; code?: string; extra?: unknown };
  if (err?.status) {
    res.status(err.status).json({ success: false, error: err.message || "Erro", code: err.code, ...(err.extra ? { data: err.extra } : {}) });
    return;
  }
  next(error);
}

const httpErr = (status: number, message: string, code?: string, extra?: unknown) => Object.assign(new Error(message), { status, code, extra });

async function ownEmployee(tx: PayrollTx, req: AuthedRequest) {
  const emp = await resolveOwnEmployee(tx, req.user!.id, req.user!.email);
  if (!emp || emp.status !== "active") return null;
  return emp;
}

async function loadState(tx: PayrollTx, req: AuthedRequest, tz: string, now = new Date()) {
  const userId = req.user!.id;
  const emp = await ownEmployee(tx, req);
  await autoCloseStaleDays(tx, userId, tz, now);
  const today = workDateFor(now, tz);
  const [todayShift, returned, agenda] = await Promise.all([
    tx.campoShift.findFirst({ where: { userId, workDate: today }, include: dayInclude }),
    tx.campoShift.findMany({
      where: { userId, reviewStatus: "returned" },
      include: dayInclude,
      orderBy: { workDate: "desc" },
      take: 5,
    }),
    jobsForDay(tx, userId, today, tz),
  ]);
  const photos = await photoCounts(tx, userId, agenda.map((j) => j.id), today, tz);
  return {
    today: ymd(today),
    today_label: dateLabel(today),
    timezone: tz,
    linked: Boolean(emp),
    employee: emp ? mapEmployee(emp) : null,
    day: todayShift ? await mapDay(tx, todayShift, tz, now) : null,
    returned: await Promise.all(returned.filter((r) => r.id !== todayShift?.id).map((r) => mapDay(tx, r, tz, now))),
    jobs_today: agenda.map((j) => mapJob(j, tz, photos.get(j.id) || 0, dayBounds(today, tz).start)),
    payments: emp ? await payments(tx, emp.id) : [],
  };
}

campoDiaRouter.get("/api/campo/dia", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, (tx) => loadState(tx, req, tz));
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

const startBody = z.object({
  work_order_id: z.string().uuid().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  accuracy: z.number().optional().nullable(),
  device_at: z.string().optional().nullable(),
});

async function accessibleJob(tx: PayrollTx, id: string) {
  const wo = await tx.workOrder.findFirst({ where: { id, status: { not: "canceled" } }, select: { id: true } });
  if (!wo) throw httpErr(404, "Job não encontrado");
  return wo;
}

campoDiaRouter.post("/api/campo/dia/start", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const b = startBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Dados inválidos" });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const userId = req.user!.id;
    const gps = gpsFrom(req.body || {});
    const now = new Date();
    // Pick the job first (outside the write) so we can geocode it before measuring distance.
    const pre = await withTenantTransaction(req.organizationId!, async (tx) => {
      const emp = await ownEmployee(tx, req);
      if (!emp) throw httpErr(409, "Seu usuário não está ligado à folha. Fale com o escritório.", "NOT_LINKED");
      if (b.data.work_order_id) return (await accessibleJob(tx, b.data.work_order_id)).id;
      const agenda = await jobsForDay(tx, userId, workDateFor(now, tz), tz);
      return agenda[0]?.id ?? null;
    });
    if (pre) await ensureJobGeo(req.organizationId!, pre);

    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const emp = (await ownEmployee(tx, req))!;
      await autoCloseStaleDays(tx, userId, tz, now);
      const today = workDateFor(now, tz);
      const exists = await tx.campoShift.findFirst({ where: { userId, workDate: today } });
      if (exists) {
        throw httpErr(409, exists.reviewStatus === "in_progress" ? "Seu dia já começou." : "O dia de hoje já foi finalizado.", "DAY_EXISTS");
      }
      const places = pre ? await jobPlaces(tx, [pre]) : new Map();
      const dist = gps && pre ? nearestDistance(gps, places.get(pre) ? [places.get(pre)] : []) : null;
      const shift = await tx.campoShift.create({
        data: {
          organizationId: req.organizationId!,
          userId,
          employeeId: emp.id,
          workDate: today,
          clockInAt: now,
          status: "open",
          source: "clock",
          reviewStatus: "in_progress",
          sector: emp.sector,
          clockInLat: gps ? new Prisma.Decimal(gps.lat) : null,
          clockInLng: gps ? new Prisma.Decimal(gps.lng) : null,
          clockInAccuracyM: gps?.accuracy != null ? new Prisma.Decimal(gps.accuracy) : null,
          clockInDistanceM: dist,
          clockInDeviceAt: deviceAt(req.body || {}),
        },
      });
      if (pre) {
        await tx.campoShiftJob.create({
          data: { organizationId: req.organizationId!, shiftId: shift.id, workOrderId: pre, arrivedAt: now, sortOrder: 0 },
        });
        await tx.campoSegment.create({
          data: { organizationId: req.organizationId!, shiftId: shift.id, activityKind: "on_site", workOrderId: pre, startedAt: now },
        });
      }
      return loadState(tx, req, tz, now);
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

async function openDay(tx: PayrollTx, userId: string, tz: string, now = new Date()) {
  const shift = await tx.campoShift.findFirst({
    where: { userId, workDate: workDateFor(now, tz), reviewStatus: "in_progress" },
  });
  if (!shift) throw httpErr(409, "Comece o dia primeiro.", "NO_OPEN_DAY");
  return shift;
}

campoDiaRouter.post("/api/campo/dia/jobs", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const id = String(req.body?.work_order_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).json({ success: false, error: "Escolha o job" });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    await ensureJobGeo(req.organizationId!, id);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const now = new Date();
      const shift = await openDay(tx, req.user!.id, tz, now);
      await accessibleJob(tx, id);
      const count = await tx.campoShiftJob.count({ where: { shiftId: shift.id } });
      const existing = await tx.campoShiftJob.findFirst({ where: { shiftId: shift.id, workOrderId: id } });
      if (!existing) {
        if (count >= 10) throw httpErr(400, "Máximo de 10 jobs no dia.");
        await tx.campoShiftJob.create({
          data: { organizationId: req.organizationId!, shiftId: shift.id, workOrderId: id, arrivedAt: now, sortOrder: count },
        });
      }
      // Time on the job page follows where the employee says they are.
      await tx.campoSegment.updateMany({ where: { shiftId: shift.id, endedAt: null }, data: { endedAt: now } });
      await tx.campoSegment.create({
        data: { organizationId: req.organizationId!, shiftId: shift.id, activityKind: "on_site", workOrderId: id, startedAt: now },
      });
      return loadState(tx, req, tz, now);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

campoDiaRouter.delete("/api/campo/dia/jobs/:woId", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const shift = await openDay(tx, req.user!.id, tz);
      await tx.campoShiftJob.deleteMany({ where: { shiftId: shift.id, workOrderId: String(req.params.woId) } });
      return loadState(tx, req, tz);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

const jobsField = z
  .array(z.object({ work_order_id: z.string().uuid(), sqft: z.number().min(0).max(100000).optional().nullable() }))
  .max(10);

const expenseItem = z.object({
  amount: z.number().positive().max(100000),
  description: z.string().max(300).optional().nullable(),
  receipt_url: z.string().max(2000).optional().nullable(),
  receipt_key: z.string().max(500).optional().nullable(),
});

const finishBody = z.object({
  jobs: jobsField.optional(),
  note: z.string().max(1000).optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  accuracy: z.number().optional().nullable(),
  device_at: z.string().optional().nullable(),
  /** Reembolsos com recibo enviados na finalização. */
  expenses: z.array(expenseItem).max(8).optional(),
});

/** Blocking rules shared by finish and manual: a job, photos of the day per job, sqft for production. */
async function assertFinishable(
  tx: PayrollTx,
  emp: NonNullable<Awaited<ReturnType<typeof ownEmployee>>>,
  userId: string,
  workDate: Date,
  tz: string,
  jobs: { workOrderId: string; sqft: number }[],
) {
  if (!jobs.length) throw httpErr(422, "Informe em qual job você trabalhou.", "JOB_REQUIRED");
  for (const j of jobs) await accessibleJob(tx, j.workOrderId);
  if (emp.payType === "production" && !jobs.some((j) => j.sqft > 0)) {
    throw httpErr(422, "Informe quantos sq ft você fez hoje.", "SQFT_REQUIRED");
  }
  if (emp.requirePhotos) {
    const counts = await photoCounts(tx, userId, jobs.map((j) => j.workOrderId), workDate, tz);
    const missing = jobs.filter((j) => !(counts.get(j.workOrderId) || 0)).map((j) => j.workOrderId);
    if (missing.length) {
      throw httpErr(422, "Tire pelo menos 1 foto de hoje em cada job antes de finalizar.", "PHOTOS_REQUIRED", { missing });
    }
  }
}

campoDiaRouter.post("/api/campo/dia/recibos", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const dataUrl = String((req.body || {}).data_url || (req.body || {}).dataUrl || "");
    if (!dataUrl.startsWith("data:")) {
      res.status(400).json({ success: false, error: "Envie a foto do recibo (data_url)." });
      return;
    }
    const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) {
      res.status(400).json({ success: false, error: "Recibo inválido." });
      return;
    }
    const contentType = m[1]!;
    if (!contentType.startsWith("image/") && contentType !== "application/pdf") {
      res.status(400).json({ success: false, error: "Use foto (imagem) ou PDF do recibo." });
      return;
    }
    const body = Buffer.from(m[2]!, "base64");
    if (body.length > 12 * 1024 * 1024) {
      res.status(400).json({ success: false, error: "Arquivo grande demais (máx. 12MB)." });
      return;
    }
    const emp = await withTenantTransaction(req.organizationId!, (tx) => ownEmployee(tx, req));
    if (!emp) {
      res.status(409).json({ success: false, error: "Seu usuário não está ligado à folha.", code: "NOT_LINKED" });
      return;
    }
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("pdf")
          ? "pdf"
          : "jpg";
    const key = `orgs/${req.organizationId}/folha-recibos/${emp.id}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const stored = await storage.upload({ key, body, contentType });
    res.status(201).json({ success: true, data: { url: stored.url, key: stored.key } });
  } catch (error) {
    fail(res, error, next);
  }
});

campoDiaRouter.post("/api/campo/dia/finish", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const b = finishBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Dados inválidos" });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const gps = gpsFrom(req.body || {});
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const now = new Date();
      const emp = await ownEmployee(tx, req);
      if (!emp) throw httpErr(409, "Seu usuário não está ligado à folha.", "NOT_LINKED");
      const shift = await openDay(tx, req.user!.id, tz, now);
      let jobs = (b.data.jobs || []).map((j) => ({ workOrderId: j.work_order_id, sqft: num(j.sqft) }));
      if (!jobs.length) {
        const cur = await tx.campoShiftJob.findMany({ where: { shiftId: shift.id }, orderBy: { sortOrder: "asc" } });
        jobs = cur.map((j) => ({ workOrderId: j.workOrderId, sqft: num(j.sqft) }));
      }
      await assertFinishable(tx, emp, req.user!.id, shift.workDate, tz, jobs);
      await closeDay(tx, shift.id, { clockOut: now, gps, deviceAt: deviceAt(req.body || {}), note: b.data.note ?? null, jobs, now }, { tz, userId: req.user!.id });
      const expenseItems = (b.data.expenses || [])
        .filter((e) => e.amount > 0)
        .map((e) => ({
          kind: "reimbursement" as const,
          amount: e.amount,
          description: e.description,
          receipt_url: e.receipt_url,
          receipt_key: e.receipt_key,
        }));
      if (expenseItems.length) {
        await attachExpensesToShift(tx, {
          organizationId: req.organizationId!,
          shiftId: shift.id,
          employeeId: emp.id,
          createdById: req.user!.id,
          source: "employee",
          status: "pending",
          items: expenseItems,
        });
        await flagShiftForExpenses(tx, shift.id);
      }
      return loadState(tx, req, tz, now);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

const manualBody = z.object({
  /** Fix a day the office returned (otherwise a new day on `date`). */
  day_id: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  start: z.string(),
  end: z.string(),
  jobs: jobsField,
  note: z.string().max(1000).optional().nullable(),
});

const MANUAL_MAX_DAYS_BACK = 7;

campoDiaRouter.post("/api/campo/dia/manual", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const b = manualBody.safeParse(req.body || {});
    if (!b.success || !isHHMM(b.data.start) || !isHHMM(b.data.end)) {
      res.status(400).json({ success: false, error: "Informe data, entrada e saída (HH:MM)." });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const now = new Date();
      const userId = req.user!.id;
      const emp = await ownEmployee(tx, req);
      if (!emp) throw httpErr(409, "Seu usuário não está ligado à folha.", "NOT_LINKED");
      const today = workDateFor(now, tz);
      let shift = b.data.day_id
        ? await tx.campoShift.findFirst({ where: { id: b.data.day_id, userId } })
        : null;
      if (b.data.day_id && (!shift || shift.reviewStatus !== "returned")) throw httpErr(409, "Este dia não está aberto para ajuste.");
      const workDate = shift ? shift.workDate : parseYmd(b.data.date || "");
      if (!workDate) throw httpErr(400, "Data inválida");
      const back = Math.round((today.getTime() - workDate.getTime()) / 86400000);
      if (back < 0) throw httpErr(400, "Não dá para lançar um dia que ainda não aconteceu.");
      if (!shift && back > MANUAL_MAX_DAYS_BACK) throw httpErr(400, `Só dá para lançar até ${MANUAL_MAX_DAYS_BACK} dias atrás. Fale com o escritório.`);
      const clockIn = wallTimeOn(workDate, b.data.start, tz);
      const clockOut = wallTimeOn(workDate, b.data.end, tz);
      if (clockOut.getTime() <= clockIn.getTime()) throw httpErr(400, "A saída precisa ser depois da entrada.");
      if (clockOut.getTime() > now.getTime() + 5 * 60_000) throw httpErr(400, "A saída não pode ser no futuro.");
      const jobs = b.data.jobs.map((j) => ({ workOrderId: j.work_order_id, sqft: num(j.sqft) }));
      await assertFinishable(tx, emp, userId, workDate, tz, jobs);

      if (!shift) {
        const exists = await tx.campoShift.findFirst({ where: { userId, workDate } });
        if (exists) throw httpErr(409, exists.reviewStatus === "in_progress" ? "Esse dia está em andamento — finalize pelo botão do dia." : "Esse dia já foi lançado.", "DAY_EXISTS");
        shift = await tx.campoShift.create({
          data: {
            organizationId: req.organizationId!,
            userId,
            employeeId: emp.id,
            workDate,
            clockInAt: clockIn,
            status: "open",
            source: "manual",
            reviewStatus: "in_progress",
            sector: emp.sector,
          },
        });
      } else {
        if (!(await removeDayFromPayroll(tx, shift.id))) throw httpErr(409, "A semana desse dia já foi fechada.");
        // A returned day keeps its clock times unless the employee changed them.
        const changed = shift.clockInAt.getTime() !== clockIn.getTime() || shift.clockOutAt?.getTime() !== clockOut.getTime();
        await tx.campoShift.update({
          where: { id: shift.id },
          data: { clockInAt: clockIn, status: "open", reviewStatus: "in_progress", ...(changed ? { source: "manual" } : {}) },
        });
      }
      await closeDay(
        tx,
        shift.id,
        { clockOut, gps: null, deviceAt: null, note: b.data.note ?? null, jobs, source: (await tx.campoShift.findFirstOrThrow({ where: { id: shift.id } })).source as "clock" | "manual", now },
        { tz, userId },
      );
      return loadState(tx, req, tz, now);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

campoDiaRouter.get("/api/campo/dia/jobs/search", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const q = String(req.query.q || "").trim().slice(0, 80);
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const since = new Date(Date.now() - 45 * 86400000);
      const n = Number(q.replace(/^#/, ""));
      const rows = await tx.workOrder.findMany({
        where: {
          status: { notIn: ["canceled", "draft"] },
          OR: [{ status: "in_progress" }, { scheduledStart: { gte: since } }, { updatedAt: { gte: since } }],
          ...(q
            ? {
                AND: [
                  {
                    OR: [
                      { title: { contains: q, mode: "insensitive" as const } },
                      { address: { contains: q, mode: "insensitive" as const } },
                      { customer: { name: { contains: q, mode: "insensitive" as const } } },
                      { builder: { company: { contains: q, mode: "insensitive" as const } } },
                      ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ scheduledStart: "desc" }],
        take: 15,
        select: jobSelect,
      });
      return rows.map((j) => mapJob(j, tz, 0));
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

campoDiaRouter.get("/api/campo/dia/semana", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!guard(req, res)) return;
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const now = new Date();
      await autoCloseStaleDays(tx, req.user!.id, tz, now);
      const ref = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || "")) ? String(req.query.week) : ymd(workDateFor(now, tz));
      const mon = mondayYmdFromCalendarYmd(ref)!;
      const sun = sundayYmdAfterMonday(mon)!;
      // Also the days the office logged for this employee (no owner user on those).
      const me = await tx.payrollEmployee.findFirst({ where: { userId: req.user!.id }, select: { id: true } });
      const days = await tx.campoShift.findMany({
        where: {
          OR: [{ userId: req.user!.id }, ...(me ? [{ employeeId: me.id }] : [])],
          workDate: { gte: parseYmd(mon)!, lte: parseYmd(sun)! },
        },
        include: dayInclude,
        orderBy: { workDate: "asc" },
      });
      const mapped = await Promise.all(days.map((d) => mapDay(tx, d, tz, now)));
      const counted = mapped.filter((d) => d.status === "approved" || d.status === "pending");
      return {
        week_start: mon,
        week_end: sun,
        days: mapped,
        totals: {
          days: counted.length,
          worked_minutes: counted.reduce((s, d) => s + d.worked_minutes, 0),
          overtime_minutes: counted.reduce((s, d) => s + d.overtime_minutes, 0),
          sqft: counted.reduce((s, d) => s + d.sqft, 0),
          amount: Math.round(counted.reduce((s, d) => s + d.amount, 0) * 100) / 100,
          approved_amount: Math.round(mapped.filter((d) => d.status === "approved").reduce((s, d) => s + d.amount, 0) * 100) / 100,
        },
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});
