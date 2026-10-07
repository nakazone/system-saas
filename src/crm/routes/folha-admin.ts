/**
 * Folha — painel do admin (desktop + mobile).
 *
 * GET  /api/folha/semana?week=YYYY-MM-DD&sector=   folha da semana por funcionário (Instalação / Lixa)
 * GET  /api/folha/pendencias                        dias aguardando conferência (+ fecha dias esquecidos)
 * GET  /api/folha/dias/:id                          detalhe do dia (GPS, jobs, fotos, nota)
 * POST /api/folha/dias/:id/aprovar                  aprova (com ajuste opcional de dias/extra)
 * POST /api/folha/dias/aprovar-lote                 aprova vários
 * POST /api/folha/dias/:id/devolver                 devolve ao funcionário com motivo
 * POST /api/folha/dias/:id/reverter                 admin: remove diária lançada à mão (libera a data)
 * PUT  /api/folha/dias/:id                          corrige horários / dias / extra / sqft
 * POST /api/folha/dias                              lança um dia pelo funcionário (sem app)
 * POST /api/folha/dias/lote                         lança vários dias de uma vez (mesmo horário)
 * PUT  /api/folha/semana/:periodId/ajustes/:empId   reembolso / desconto
 * POST /api/folha/pagamentos                        paga um ou vários funcionários → Financeiro
 * POST /api/folha/pagamentos/:id/estornar           estorna (anula no Financeiro)
 * POST /api/folha/conferencia                       envia relatório (e-mail + PDF) ao funcionário antes do pagamento
 * GET  /api/folha/conferencia.pdf?week=&employee_id=  PDF da conferência (visual ticket ObraMate)
 * GET  /api/folha/formas-pagamento                  formas de pagamento ativas (Configurações › Folha)
 * GET/POST/PUT /api/folha/funcionarios              cadastro com horário padrão
 * GET  /api/folha/relatorio?from&to&employee_id&sector[&format=csv&kind=]  totais por funcionário, pagamentos, custo por job
 * GET  /api/folha/pagamentos?from&to                 histórico de pagamentos
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction as rawTenantTx } from "../../lib/tenant/prisma-tenant.js";
import { orgScoped } from "../../lib/tenant/org-scoped.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import type { PayrollTx } from "../lib/payroll-employee-link.js";
import { safeTimeZone } from "../../lib/time/zoned.js";
import { formatUsPhone } from "../../lib/phone.js";
import { overtimeFromDaily, parseYmd, ymdToBrShort } from "../lib/payroll-calc.js";
import { DAY_FLAG_LABELS, dayAmount, isHHMM, minutesLabel, wallTimeOn, workDateFor, ymd } from "../../lib/payroll/day.js";
import { closeDay, dayBounds, periodFor, postDayToPayroll, removeDayFromPayroll } from "../../lib/payroll/day-service.js";
import { adjacentPeriodRefs, describePayCycle, parsePayCycle, periodBoundsFor } from "../../lib/settings/payroll-cycle.js";
import {
  approveShiftExpenses,
  attachExpensesToShift,
  flagShiftForExpenses,
  mapExpense,
  syncExpenseIntoAdjustment,
} from "../../lib/payroll/shift-expenses.js";
import { storage } from "../../lib/storage/index.js";
import { randomUUID } from "node:crypto";
import { notifyUsersPush } from "../../lib/push/notify.js";
import { sendCustomerEmail } from "../../lib/email/index.js";
import {
  buildConferenceEmailHtml,
  buildConferencePdf,
  buildConferenceText,
  conferenceEmailSubject,
  type ConferenceReportInput,
} from "../../lib/payroll/conference-report.js";
import {
  DEFAULT_PAYROLL_PAYMENT_METHODS,
  PAYROLL_PAYMENT_METHOD_KIND,
  payrollMethodLabel,
} from "../../lib/settings/payroll-payment-methods.js";

export const folhaAdminRouter = Router();

/** Tenant transaction whose reads are also filtered by organizationId (money module: no reliance on RLS alone). */
const withTenantTransaction = <T>(organizationId: string, fn: (tx: PayrollTx) => Promise<T>) =>
  rawTenantTx(organizationId, (tx) => fn(orgScoped(tx as PayrollTx, organizationId)));

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => Math.round(n * 100) / 100;
const httpErr = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, code });

function fail(res: import("express").Response, error: unknown, next: import("express").NextFunction) {
  const err = error as { status?: number; message?: string; code?: string };
  if (err?.status) {
    res.status(err.status).json({ success: false, error: err.message || "Erro", code: err.code });
    return;
  }
  next(error);
}

async function orgTz(orgId: string) {
  const o = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  return safeTimeZone(o?.timezone);
}
function timeLabel(d: Date | null | undefined, tz: string) {
  if (!d) return null;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dateLabel = (d: Date) => `${WD[d.getUTCDay()]} ${d.getUTCDate()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const SECTOR_LABEL: Record<string, string> = { installation: "Instalação", sand_finish: "Lixa" };
export const sectorKey = (s: string | null | undefined) => (s === "sand_finish" ? "sand_finish" : "installation");
const STATUS_LABEL: Record<string, string> = {
  in_progress: "Em andamento",
  pending: "Conferir",
  approved: "Aprovado",
  returned: "Devolvido",
};
/** @deprecated Prefer catalog keys from Configurações › Folha; kept for imports/tests. */
export const PAY_METHODS = DEFAULT_PAYROLL_PAYMENT_METHODS.map((m) => m.key);
const payMethodField = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, "forma inválida"),
  ])
  .optional()
  .nullable()
  .transform((v) => (v == null || v === "" ? null : v));
const methodLabel = (key: string | null | undefined) => payrollMethodLabel(key);

const shiftInclude = {
  user: { select: { id: true, name: true } },
  employee: true,
  jobs: { orderBy: { sortOrder: "asc" as const }, include: { workOrder: { select: { id: true, number: true, title: true, address: true } } } },
  expenses: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.CampoShiftInclude;
type ShiftRow = Prisma.CampoShiftGetPayload<{ include: typeof shiftInclude }>;

function mapShift(s: ShiftRow, tz: string) {
  const flags = Array.isArray(s.flags) ? (s.flags as string[]) : [];
  return {
    id: s.id,
    kind: "day" as const,
    date: ymd(s.workDate),
    date_label: dateLabel(s.workDate),
    employee_id: s.employeeId,
    employee_name: s.employee?.name || s.user?.name || "—",
    sector: sectorKey(s.sector || s.employee?.sector),
    status: s.reviewStatus,
    status_label: STATUS_LABEL[s.reviewStatus] || s.reviewStatus,
    source: s.source,
    clock_in_label: timeLabel(s.clockInAt, tz),
    clock_out_label: timeLabel(s.clockOutAt, tz),
    expected_end_label: timeLabel(s.expectedEndAt, tz),
    worked_minutes: s.workedMinutes,
    worked_label: minutesLabel(s.workedMinutes),
    overtime_minutes: s.overtimeMinutes,
    overtime_label: s.overtimeMinutes ? minutesLabel(s.overtimeMinutes) : null,
    days_worked: num(s.daysWorked),
    sqft: num(s.sqft),
    amount: num(s.amount),
    note: s.note,
    review_note: s.reviewNote,
    flags: flags.map((k) => ({ key: k, label: DAY_FLAG_LABELS[k] || k })),
    gps_in: s.clockInLat != null ? { lat: num(s.clockInLat), lng: num(s.clockInLng), accuracy: s.clockInAccuracyM != null ? num(s.clockInAccuracyM) : null, distance_m: s.clockInDistanceM } : null,
    gps_out: s.clockOutLat != null ? { lat: num(s.clockOutLat), lng: num(s.clockOutLng), accuracy: s.clockOutAccuracyM != null ? num(s.clockOutAccuracyM) : null, distance_m: s.clockOutDistanceM } : null,
    jobs: s.jobs.map((j) => ({ id: j.workOrderId, number: j.workOrder.number, title: j.workOrder.title, address: j.workOrder.address, sqft: num(j.sqft), photos: j.photoCount })),
    expenses: (s.expenses || []).map(mapExpense),
    in_payroll: Boolean(s.timesheetId),
  };
}

/** Every day older than today that was never finished goes to review (all employees). */
async function autoCloseOrg(tx: PayrollTx, tz: string, now = new Date()) {
  const stale = await tx.campoShift.findMany({
    where: { status: "open", reviewStatus: "in_progress", workDate: { lt: workDateFor(now, tz) }, userId: { not: null } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (!stale.length) return;
  const { autoCloseStaleDays } = await import("../../lib/payroll/day-service.js");
  for (const s of stale) if (s.userId) await autoCloseStaleDays(tx, s.userId, tz, now);
}

async function isPaid(tx: PayrollTx, employeeId: string | null, workDate: Date) {
  if (!employeeId) return false;
  const p = await tx.payrollPayment.findFirst({
    where: { employeeId, status: "paid", period: { startDate: { lte: workDate }, endDate: { gte: workDate } } },
    select: { id: true },
  });
  return Boolean(p);
}

async function assertNotPaid(tx: PayrollTx, employeeId: string | null, workDate: Date) {
  if (await isPaid(tx, employeeId, workDate)) throw httpErr(409, "Esse funcionário já foi pago nessa semana. Estorne o pagamento para alterar.", "PAID");
}

// ------------------------------------------------------------------ semana
async function weekData(tx: PayrollTx, organizationId: string, refYmd: string, tz: string) {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { featureFlags: true },
  });
  const cycle = parsePayCycle(org?.featureFlags);
  const bounds = periodBoundsFor(refYmd, cycle);
  const startYmd = bounds.start;
  const endYmd = bounds.end;
  const start = parseYmd(startYmd)!;
  const end = parseYmd(endYmd)!;
  await autoCloseOrg(tx, tz);
  const period =
    (await tx.payrollPeriod.findFirst({
      where: { startDate: { lte: start }, endDate: { gte: end } },
      orderBy: { startDate: "desc" },
    })) ?? (await tx.payrollPeriod.findFirst({ where: { startDate: start, endDate: end } }));
  const [employees, shifts, lines, adjustments, payments] = await Promise.all([
    tx.payrollEmployee.findMany({ orderBy: { name: "asc" }, include: { user: { select: { id: true, email: true } } } }),
    tx.campoShift.findMany({ where: { workDate: { gte: start, lte: end }, employeeId: { not: null } }, include: shiftInclude, orderBy: { workDate: "asc" } }),
    // By work date (not only periodId) so totals stay correct if the period row is missing/mismatched.
    tx.payrollTimesheet.findMany({ where: { workDate: { gte: start, lte: end } }, orderBy: { workDate: "asc" } }),
    period ? tx.payrollPeriodAdjustment.findMany({ where: { periodId: period.id } }) : Promise.resolve([]),
    period ? tx.payrollPayment.findMany({ where: { periodId: period.id, status: "paid" } }) : Promise.resolve([]),
  ]);
  const rows = employees
    .map((e) => {
      const myShifts = shifts.filter((s) => s.employeeId === e.id);
      const myLines = lines.filter((l) => l.employeeId === e.id);
      const adj = adjustments.find((a) => a.employeeId === e.id);
      const pay = payments.find((p) => p.employeeId === e.id);
      // Semana lists only people with activity in this period (not the full active roster).
      if (!myShifts.length && !myLines.length && !adj && !pay) return null;
      const days = [
        ...myShifts.map((s) => mapShift(s, tz)),
        // Lines typed by the office (no Dia de trabalho behind them)
        ...myLines
          .filter((l) => !l.shiftId)
          .map((l) => ({
            id: l.id,
            kind: "line" as const,
            date: ymd(l.workDate),
            date_label: dateLabel(l.workDate),
            status: "approved",
            status_label: "Lançado pelo escritório",
            source: "office",
            days_worked: num(l.daysWorked),
            overtime_minutes: Math.round(num(l.overtimeHours) * 60),
            worked_minutes: 0,
            sqft: num(l.sqft),
            amount: num(l.calculatedAmount),
            note: l.notes,
            flags: [] as { key: string; label: string }[],
            jobs: [] as unknown[],
          })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      // Sum approved work once: prefer timesheet line when present, else shift amount.
      const lineByShift = new Map(myLines.filter((l) => l.shiftId).map((l) => [l.shiftId as string, l]));
      let gross = 0;
      let daysTotal = 0;
      let overtimeMinutes = 0;
      let sqftTotal = 0;
      for (const s of myShifts.filter((x) => x.reviewStatus === "approved")) {
        const line = lineByShift.get(s.id);
        if (line) {
          gross += num(line.calculatedAmount);
          daysTotal += num(line.daysWorked) > 0 ? num(line.daysWorked) : num(line.sqft) > 0 ? 1 : 0;
          overtimeMinutes += Math.round(num(line.overtimeHours) * 60);
          sqftTotal += num(line.sqft);
        } else {
          gross += num(s.amount);
          daysTotal += num(s.daysWorked) > 0 ? num(s.daysWorked) : num(s.sqft) > 0 ? 1 : 0;
          overtimeMinutes += s.overtimeMinutes || 0;
          sqftTotal += num(s.sqft);
        }
      }
      for (const l of myLines.filter((x) => !x.shiftId)) {
        gross += num(l.calculatedAmount);
        daysTotal += num(l.daysWorked) > 0 ? num(l.daysWorked) : num(l.sqft) > 0 ? 1 : 0;
        overtimeMinutes += Math.round(num(l.overtimeHours) * 60);
        sqftTotal += num(l.sqft);
      }
      const reimbursement = num(adj?.reimbursement);
      const discount = num(adj?.discount);
      const waiting = myShifts.filter((s) => s.reviewStatus === "pending" || s.reviewStatus === "returned");
      const counted = myShifts.filter((s) => s.reviewStatus === "approved");
      return {
        id: e.id,
        name: e.name,
        sector: sectorKey(e.sector),
        sector_set: Boolean(e.sector),
        pay_type: e.payType === "production" ? "production" : "daily",
        daily_rate: num(e.dailyRate),
        production_rate: num(e.productionRate),
        overtime_rate: num(e.overtimeRate),
        status: e.status,
        linked: Boolean(e.userId),
        payment_method: e.paymentMethod,
        email: e.email || e.user?.email || null,
        phone: formatUsPhone(e.phone),
        days,
        totals: {
          days: daysTotal,
          worked_minutes: counted.reduce((s, d) => s + d.workedMinutes, 0),
          overtime_minutes: overtimeMinutes,
          sqft: sqftTotal,
          gross: money(gross),
          reimbursement,
          discount,
          net: money(gross + reimbursement - discount),
          pending_days: waiting.length,
          pending_amount: money(waiting.reduce((s, d) => s + num(d.amount), 0)),
          open_days: myShifts.filter((s) => s.reviewStatus === "in_progress").length,
        },
        adjustment: { reimbursement, discount, notes: adj?.notes || "" },
        payment: pay
          ? { id: pay.id, amount: num(pay.amount), paid_on: ymd(pay.paidOn), method: pay.method, method_label: pay.method ? methodLabel(pay.method) : null, reference: pay.reference }
          : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  const sum = (list: typeof rows) => ({
    employees: list.filter((r) => r.days.length || r.totals.net).length,
    gross: money(list.reduce((s, r) => s + r.totals.gross, 0)),
    net: money(list.reduce((s, r) => s + r.totals.net, 0)),
    paid: money(list.reduce((s, r) => s + (r.payment?.amount || 0), 0)),
    to_pay: money(list.filter((r) => !r.payment).reduce((s, r) => s + Math.max(0, r.totals.net), 0)),
    pending_days: list.reduce((s, r) => s + r.totals.pending_days, 0),
    overtime_minutes: list.reduce((s, r) => s + r.totals.overtime_minutes, 0),
    sqft: list.reduce((s, r) => s + r.totals.sqft, 0),
  });
  const today = ymd(workDateFor(new Date(), tz));
  const isCurrent = today >= startYmd && today <= endYmd;
  const neighbors = adjacentPeriodRefs(bounds, cycle);
  return {
    week: {
      start: startYmd,
      end: endYmd,
      label: `${ymdToBrShort(startYmd).slice(0, 5)} – ${ymdToBrShort(endYmd).slice(0, 5)}`,
      full_label: bounds.label,
      today,
      pay_on: bounds.pay_on,
      pay_on_label: ymdToBrShort(bounds.pay_on),
      prev: neighbors.prev,
      next: neighbors.next,
      frequency: bounds.frequency,
    },
    period: period ? { id: period.id, label: period.label, status: period.status } : null,
    totals: {
      all: sum(rows),
      installation: sum(rows.filter((r) => r.sector === "installation")),
      sand_finish: sum(rows.filter((r) => r.sector === "sand_finish")),
    },
    employees: rows,
    cycle_summary: describePayCycle(cycle),
    is_current: isCurrent,
  };
}

folhaAdminRouter.get("/api/folha/semana", requireCrmAuth, requireCrmPermission("payroll.view"), async (req: AuthedRequest, res, next) => {
  try {
    const tz = await orgTz(req.organizationId!);
    const ref = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || "")) ? String(req.query.week) : ymd(workDateFor(new Date(), tz));
    const data = await withTenantTransaction(req.organizationId!, (tx) => weekData(tx, req.organizationId!, ref, tz));
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.get("/api/folha/pendencias", requireCrmAuth, requireCrmPermission("payroll.view"), async (req: AuthedRequest, res, next) => {
  try {
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      await autoCloseOrg(tx, tz);
      const rows = await tx.campoShift.findMany({
        where: { reviewStatus: { in: ["pending", "returned"] }, employeeId: { not: null } },
        include: shiftInclude,
        orderBy: [{ workDate: "desc" }],
        take: 200,
      });
      const open = await tx.campoShift.findMany({
        where: { reviewStatus: "in_progress", employeeId: { not: null } },
        include: shiftInclude,
        orderBy: [{ clockInAt: "asc" }],
        take: 100,
      });
      return {
        pending: rows.filter((r) => r.reviewStatus === "pending").map((r) => mapShift(r, tz)),
        returned: rows.filter((r) => r.reviewStatus === "returned").map((r) => mapShift(r, tz)),
        working_now: open.map((r) => mapShift(r, tz)),
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.get("/api/folha/dias/:id", requireCrmAuth, requireCrmPermission("payroll.view"), async (req: AuthedRequest, res, next) => {
  try {
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const s = await tx.campoShift.findFirst({ where: { id: String(req.params.id) }, include: shiftInclude });
      if (!s) throw httpErr(404, "Dia não encontrado");
      const { start, end } = dayBounds(s.workDate, tz);
      const photos = !s.userId ? [] : await tx.jobMedia.findMany({
        where: {
          authorId: s.userId,
          workOrderId: { in: s.jobs.map((j) => j.workOrderId) },
          deletedAt: null,
          type: "photo",
          OR: [{ takenAtDevice: { gte: start, lt: end } }, { takenAtDevice: null, createdAt: { gte: start, lt: end } }],
        },
        orderBy: { createdAt: "asc" },
        take: 60,
        select: { id: true, workOrderId: true, url: true, thumbUrl: true, stage: true, createdAt: true, takenAtDevice: true, lat: true, lng: true },
      });
      const reviewer = s.reviewedById ? await tx.user.findFirst({ where: { id: s.reviewedById }, select: { name: true } }) : null;
      return {
        ...mapShift(s, tz),
        reviewed_by: reviewer?.name || null,
        reviewed_at: s.reviewedAt?.toISOString() ?? null,
        submitted_label: s.submittedAt ? `${dateLabel(workDateFor(s.submittedAt, tz))} ${timeLabel(s.submittedAt, tz)}` : null,
        paid: await isPaid(tx, s.employeeId, s.workDate),
        photos: photos.map((p) => ({
          id: p.id,
          job_id: p.workOrderId,
          url: p.url,
          thumb_url: p.thumbUrl || p.url,
          stage: p.stage,
          time_label: timeLabel(p.takenAtDevice || p.createdAt, tz),
          gps: p.lat != null ? { lat: num(p.lat), lng: num(p.lng) } : null,
        })),
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

const approveBody = z.object({
  days_worked: z.number().min(0).max(2).optional(),
  overtime_minutes: z.number().int().min(0).max(16 * 60).optional(),
  note: z.string().max(500).optional().nullable(),
});

/** Recompute pay after the office changed days/overtime/sqft. */
async function recompute(tx: PayrollTx, shiftId: string, patch: { daysWorked?: number; overtimeMinutes?: number }) {
  const s = await tx.campoShift.findFirstOrThrow({ where: { id: shiftId }, include: { employee: true } });
  if (!s.employee) throw httpErr(409, "Dia sem funcionário");
  const daysWorked = patch.daysWorked ?? num(s.daysWorked);
  const overtimeMinutes = patch.overtimeMinutes ?? s.overtimeMinutes;
  const amount = dayAmount(s.employee, { daysWorked, overtimeMinutes, sqft: num(s.sqft) });
  await tx.campoShift.update({
    where: { id: shiftId },
    data: { daysWorked: new Prisma.Decimal(daysWorked), overtimeMinutes, amount: new Prisma.Decimal(amount) },
  });
}

async function approveDay(tx: PayrollTx, shiftId: string, reviewerId: string, patch: z.infer<typeof approveBody> = {}) {
  const s = await tx.campoShift.findFirst({ where: { id: shiftId } });
  if (!s) throw httpErr(404, "Dia não encontrado");
  if (s.reviewStatus === "in_progress") throw httpErr(409, "O dia ainda está em andamento.");
  await assertNotPaid(tx, s.employeeId, s.workDate);
  if (patch.days_worked !== undefined || patch.overtime_minutes !== undefined) {
    await recompute(tx, shiftId, { daysWorked: patch.days_worked, overtimeMinutes: patch.overtime_minutes });
  }
  await approveShiftExpenses(tx, shiftId, reviewerId);
  const ok = await postDayToPayroll(tx, shiftId);
  if (!ok) throw httpErr(409, "A semana desse dia está fechada. Reabra a semana para aprovar.", "PERIOD_CLOSED");
  await tx.campoShift.update({
    where: { id: shiftId },
    data: { reviewStatus: "approved", reviewedById: reviewerId, reviewedAt: new Date(), ...(patch.note ? { reviewNote: patch.note } : {}) },
  });
}

folhaAdminRouter.post("/api/folha/dias/aprovar-lote", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const ids = z.array(z.string().uuid()).min(1).max(200).safeParse(req.body?.ids);
    if (!ids.success) {
      res.status(400).json({ success: false, error: "Escolha os dias" });
      return;
    }
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids.data) {
      try {
        await withTenantTransaction(req.organizationId!, (tx) => approveDay(tx, id, req.user!.id));
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    res.json({ success: true, data: { approved: results.filter((r) => r.ok).length, results } });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.post("/api/folha/dias/:id/aprovar", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = approveBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Dados inválidos" });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      await approveDay(tx, String(req.params.id), req.user!.id, b.data);
      return mapShift(await tx.campoShift.findFirstOrThrow({ where: { id: String(req.params.id) }, include: shiftInclude }), tz);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.post("/api/folha/dias/:id/devolver", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (reason.length < 3) {
      res.status(400).json({ success: false, error: "Escreva o motivo para o funcionário." });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const out = await withTenantTransaction(req.organizationId!, async (tx) => {
      const s = await tx.campoShift.findFirst({ where: { id: String(req.params.id) } });
      if (!s) throw httpErr(404, "Dia não encontrado");
      if (s.reviewStatus === "in_progress") throw httpErr(409, "O dia ainda está em andamento.");
      await assertNotPaid(tx, s.employeeId, s.workDate);
      if (!(await removeDayFromPayroll(tx, s.id))) throw httpErr(409, "A semana desse dia está fechada.", "PERIOD_CLOSED");
      await tx.campoShift.update({
        where: { id: s.id },
        data: { reviewStatus: "returned", reviewNote: reason, reviewedById: req.user!.id, reviewedAt: new Date() },
      });
      return { userId: s.userId, date: s.workDate, day: mapShift(await tx.campoShift.findFirstOrThrow({ where: { id: s.id }, include: shiftInclude }), tz) };
    });
    if (out.userId) void notifyUsersPush(req.organizationId!, [out.userId], {
      title: `Dia ${dateLabel(out.date)} voltou para ajuste`,
      body: reason,
      url: "/campo/hoje.html",
      tag: `dia-${out.day.id}`,
    }).catch(() => {});
    res.json({ success: true, data: out.day });
  } catch (error) {
    fail(res, error, next);
  }
});

/**
 * Admin-only: undo an office-launched daily (remove from payroll + delete the shift).
 * Frees the date so a new launch can be created.
 */
folhaAdminRouter.post("/api/folha/dias/:id/reverter", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user?.roleKey !== "admin") {
      res.status(403).json({ success: false, error: "Só o admin pode reverter uma diária lançada." });
      return;
    }
    await withTenantTransaction(req.organizationId!, async (tx) => {
      const s = await tx.campoShift.findFirst({ where: { id: String(req.params.id) } });
      if (!s) throw httpErr(404, "Dia não encontrado");
      if (s.source !== "manual") {
        throw httpErr(409, "Só dá para reverter diárias lançadas pelo escritório. Use Devolver para dias do celular.");
      }
      if (s.reviewStatus === "in_progress") throw httpErr(409, "O dia ainda está em andamento.");
      await assertNotPaid(tx, s.employeeId, s.workDate);
      if (!(await removeDayFromPayroll(tx, s.id))) {
        throw httpErr(409, "A semana desse dia está fechada. Reabra a semana para reverter.", "PERIOD_CLOSED");
      }
      // Roll back approved expenses that were applied to period adjustments.
      const applied = await tx.campoShiftExpense.findMany({
        where: { shiftId: s.id, status: "approved", appliedAt: { not: null } },
        select: { id: true },
      });
      for (const row of applied) {
        await syncExpenseIntoAdjustment(tx, row.id, "rejected", req.user!.id, "Diária revertida pelo admin");
      }
      await tx.campoShift.delete({ where: { id: s.id } });
    });
    res.json({ success: true, data: { id: String(req.params.id), reverted: true } });
  } catch (error) {
    fail(res, error, next);
  }
});

const editBody = z.object({
  clock_in: z.string().optional(),
  clock_out: z.string().optional(),
  days_worked: z.number().min(0).max(2).optional(),
  overtime_minutes: z.number().int().min(0).max(16 * 60).optional(),
  jobs: z.array(z.object({ work_order_id: z.string().uuid(), sqft: z.number().min(0).max(100000).optional().nullable() })).max(10).optional(),
  note: z.string().max(500).optional().nullable(),
});

folhaAdminRouter.put("/api/folha/dias/:id", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = editBody.safeParse(req.body || {});
    if (!b.success || (b.data.clock_in && !isHHMM(b.data.clock_in)) || (b.data.clock_out && !isHHMM(b.data.clock_out))) {
      res.status(400).json({ success: false, error: "Dados inválidos" });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const s = await tx.campoShift.findFirst({ where: { id: String(req.params.id) }, include: { jobs: true } });
      if (!s) throw httpErr(404, "Dia não encontrado");
      await assertNotPaid(tx, s.employeeId, s.workDate);
      const wasApproved = s.reviewStatus === "approved";
      const clockIn = b.data.clock_in ? wallTimeOn(s.workDate, b.data.clock_in, tz) : s.clockInAt;
      const clockOut = b.data.clock_out ? wallTimeOn(s.workDate, b.data.clock_out, tz) : s.clockOutAt ?? new Date();
      if (clockOut.getTime() <= clockIn.getTime()) throw httpErr(400, "A saída precisa ser depois da entrada.");
      if (!(await removeDayFromPayroll(tx, s.id))) throw httpErr(409, "A semana desse dia está fechada.", "PERIOD_CLOSED");
      const keepFlags = Array.isArray(s.flags) ? (s.flags as string[]) : [];
      await tx.campoShift.update({ where: { id: s.id }, data: { clockInAt: clockIn, status: "open", reviewStatus: "in_progress" } });
      await closeDay(
        tx,
        s.id,
        {
          clockOut,
          gps: s.clockOutLat != null ? { lat: num(s.clockOutLat), lng: num(s.clockOutLng), accuracy: s.clockOutAccuracyM != null ? num(s.clockOutAccuracyM) : null } : null,
          deviceAt: s.clockOutDeviceAt,
          note: b.data.note !== undefined ? b.data.note : s.note,
          jobs: b.data.jobs ? b.data.jobs.map((j) => ({ workOrderId: j.work_order_id, sqft: num(j.sqft) })) : s.jobs.map((j) => ({ workOrderId: j.workOrderId, sqft: num(j.sqft) })),
          source: s.source as "clock" | "manual" | "auto_closed",
        },
        { tz, userId: s.userId },
      );
      if (b.data.days_worked !== undefined || b.data.overtime_minutes !== undefined) {
        await recompute(tx, s.id, { daysWorked: b.data.days_worked, overtimeMinutes: b.data.overtime_minutes });
      }
      // The office edited it: keep the original reasons visible and approve it (it was looked at).
      await tx.campoShift.update({ where: { id: s.id }, data: { flags: keepFlags.length ? keepFlags : undefined } });
      const nowStatus = (await tx.campoShift.findFirstOrThrow({ where: { id: s.id }, select: { reviewStatus: true } })).reviewStatus;
      if (wasApproved || nowStatus === "approved" || req.body?.approve === true) await approveDay(tx, s.id, req.user!.id);
      return mapShift(await tx.campoShift.findFirstOrThrow({ where: { id: s.id }, include: shiftInclude }), tz);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

const officeDayBody = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Optional — defaults to the employee's schedule (or 07:00–17:00). */
  start: z.string().optional().nullable(),
  end: z.string().optional().nullable(),
  days_worked: z.number().min(0).max(2).optional(),
  /** When set, overrides schedule-based overtime after close (office quick-add HE). */
  overtime_minutes: z.number().int().min(0).max(16 * 60).optional(),
  jobs: z.array(z.object({ work_order_id: z.string().uuid(), sqft: z.number().min(0).max(100000).optional().nullable() })).max(10).default([]),
  note: z.string().max(500).optional().nullable(),
});

const officeDayLoteBody = z.object({
  employee_id: z.string().uuid(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),
  start: z.string().optional().nullable(),
  end: z.string().optional().nullable(),
  days_worked: z.number().min(0).max(2).optional(),
  overtime_minutes: z.number().int().min(0).max(16 * 60).optional(),
  jobs: z.array(z.object({ work_order_id: z.string().uuid(), sqft: z.number().min(0).max(100000).optional().nullable() })).max(10).default([]),
  note: z.string().max(500).optional().nullable(),
});

type OfficeDayInput = z.infer<typeof officeDayBody>;

function resolveOfficeClocks(emp: { scheduleStartTime?: string | null; scheduleEndTime?: string | null }, input: { start?: string | null; end?: string | null }) {
  const start = input.start && isHHMM(input.start) ? input.start : emp.scheduleStartTime && isHHMM(emp.scheduleStartTime) ? emp.scheduleStartTime : "07:00";
  const end = input.end && isHHMM(input.end) ? input.end : emp.scheduleEndTime && isHHMM(emp.scheduleEndTime) ? emp.scheduleEndTime : "17:00";
  return { start, end };
}

async function createApprovedOfficeDay(
  tx: PayrollTx,
  orgId: string,
  reviewerId: string,
  tz: string,
  input: OfficeDayInput,
) {
  const emp = await tx.payrollEmployee.findFirst({ where: { id: input.employee_id } });
  if (!emp) throw httpErr(404, "Funcionário não encontrado");
  const { start: startHH, end: endHH } = resolveOfficeClocks(emp, input);
  const ownerId = emp.userId || null;
  const workDate = parseYmd(input.date)!;
  await assertNotPaid(tx, emp.id, workDate);
  const dup = await tx.campoShift.findFirst({ where: { employeeId: emp.id, workDate } });
  if (dup) throw httpErr(409, "Já existe um dia lançado para esse funcionário nessa data.", "DAY_EXISTS");
  if (ownerId) {
    const mine = await tx.campoShift.findFirst({ where: { userId: ownerId, workDate } });
    if (mine) throw httpErr(409, "Já existe um dia desse funcionário nessa data.", "DAY_EXISTS");
  }
  const clockIn = wallTimeOn(workDate, startHH, tz);
  const clockOut = wallTimeOn(workDate, endHH, tz);
  if (clockOut.getTime() <= clockIn.getTime()) throw httpErr(400, "A saída precisa ser depois da entrada.");
  const daysWorked = input.days_worked ?? 1;
  const s = await tx.campoShift.create({
    data: {
      organizationId: orgId,
      userId: ownerId,
      employeeId: emp.id,
      workDate,
      clockInAt: clockIn,
      status: "open",
      source: "manual",
      reviewStatus: "in_progress",
      sector: emp.sector,
      daysWorked: new Prisma.Decimal(daysWorked),
    },
  });
  await closeDay(
    tx,
    s.id,
    {
      clockOut,
      gps: null,
      deviceAt: null,
      note: input.note ?? "Lançado pelo escritório",
      jobs: input.jobs.map((j) => ({ workOrderId: j.work_order_id, sqft: num(j.sqft) })),
      source: "manual",
    },
    { tz, userId: ownerId },
  );
  if (input.overtime_minutes !== undefined) {
    await recompute(tx, s.id, { daysWorked, overtimeMinutes: input.overtime_minutes });
  }
  await approveDay(tx, s.id, reviewerId);
  return mapShift(await tx.campoShift.findFirstOrThrow({ where: { id: s.id }, include: shiftInclude }), tz);
}

/** Office logs a day for an employee (no phone / forgot): approved right away. */
folhaAdminRouter.post("/api/folha/dias", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = officeDayBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Informe funcionário e data." });
      return;
    }
    const today = ymd(new Date());
    if (b.data.date > today) {
      res.status(400).json({ success: false, error: "Não dá para lançar data futura." });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) =>
      createApprovedOfficeDay(tx, req.organizationId!, req.user!.id, tz, b.data),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

/** Bulk-create approved office days (same hours / jobs for each date). */
folhaAdminRouter.post("/api/folha/dias/lote", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = officeDayLoteBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Informe funcionário e datas." });
      return;
    }
    const today = ymd(new Date());
    const dates = [...new Set(b.data.dates)].sort();
    if (dates.some((d) => d > today)) {
      res.status(400).json({ success: false, error: "Não dá para lançar data futura." });
      return;
    }
    const tz = await orgTz(req.organizationId!);
    const results: { date: string; ok: boolean; id?: string; error?: string; code?: string }[] = [];
    for (const date of dates) {
      try {
        const data = await withTenantTransaction(req.organizationId!, async (tx) =>
          createApprovedOfficeDay(tx, req.organizationId!, req.user!.id, tz, {
            employee_id: b.data.employee_id,
            date,
            start: b.data.start,
            end: b.data.end,
            days_worked: b.data.days_worked,
            overtime_minutes: b.data.overtime_minutes,
            jobs: b.data.jobs,
            note: b.data.note,
          }),
        );
        results.push({ date, ok: true, id: data.id });
      } catch (e) {
        const err = e as Error & { status?: number; code?: string };
        results.push({ date, ok: false, error: err.message || "Erro", code: err.code });
      }
    }
    const created = results.filter((r) => r.ok).length;
    res.status(created ? 201 : 400).json({
      success: created > 0,
      data: { created, total: results.length, results },
      error: created ? undefined : results.find((r) => !r.ok)?.error || "Nenhum dia lançado.",
    });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.put(
  "/api/folha/semana/:periodId/ajustes/:employeeId",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = z
        .object({ reimbursement: z.number().min(0).max(100000), discount: z.number().min(0).max(100000), notes: z.string().max(500).optional().nullable() })
        .safeParse(req.body || {});
      if (!b.success) {
        res.status(400).json({ success: false, error: "Valores inválidos" });
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const period = await tx.payrollPeriod.findFirst({ where: { id: String(req.params.periodId) } });
        if (!period) throw httpErr(404, "Semana não encontrada");
        const paid = await tx.payrollPayment.findFirst({ where: { periodId: period.id, employeeId: String(req.params.employeeId), status: "paid" } });
        if (paid) throw httpErr(409, "Já pago nessa semana. Estorne para alterar.", "PAID");
        await tx.payrollPeriodAdjustment.upsert({
          where: { periodId_employeeId: { periodId: period.id, employeeId: String(req.params.employeeId) } },
          create: { organizationId: req.organizationId!, periodId: period.id, employeeId: String(req.params.employeeId), reimbursement: b.data.reimbursement, discount: b.data.discount, notes: b.data.notes || null },
          update: { reimbursement: b.data.reimbursement, discount: b.data.discount, notes: b.data.notes || null },
        });
      });
      res.json({ success: true });
    } catch (error) {
      fail(res, error, next);
    }
  },
);

const officeExpenseBody = z.object({
  kind: z.enum(["reimbursement", "discount"]),
  amount: z.number().positive().max(100000),
  description: z.string().max(300).optional().nullable(),
  receipt_data_url: z.string().max(20_000_000).optional().nullable(),
  approve: z.boolean().optional(),
});

/** Office registers a reimbursement or discount on a work day (optional receipt). */
folhaAdminRouter.post("/api/folha/dias/:id/despesas", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = officeExpenseBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Informe tipo e valor." });
      return;
    }
    let receiptUrl: string | null = null;
    let receiptKey: string | null = null;
    if (b.data.receipt_data_url) {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(b.data.receipt_data_url);
      if (!m) {
        res.status(400).json({ success: false, error: "Recibo inválido." });
        return;
      }
      const contentType = m[1]!;
      const body = Buffer.from(m[2]!, "base64");
      if (body.length > 12 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Arquivo grande demais (máx. 12MB)." });
        return;
      }
      const ext = contentType.includes("png") ? "png" : contentType.includes("pdf") ? "pdf" : "jpg";
      const key = `orgs/${req.organizationId}/folha-recibos/office/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
      const stored = await storage.upload({ key, body, contentType: contentType || "image/jpeg" });
      receiptUrl = stored.url;
      receiptKey = stored.key;
    }
    const tz = await orgTz(req.organizationId!);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const s = await tx.campoShift.findFirst({ where: { id: String(req.params.id) }, include: shiftInclude });
      if (!s?.employeeId) throw httpErr(404, "Dia não encontrado");
      await assertNotPaid(tx, s.employeeId, s.workDate);
      const [row] = await attachExpensesToShift(tx, {
        organizationId: req.organizationId!,
        shiftId: s.id,
        employeeId: s.employeeId,
        createdById: req.user!.id,
        source: "office",
        status: "pending",
        items: [
          {
            kind: b.data.kind,
            amount: b.data.amount,
            description: b.data.description,
            receipt_url: receiptUrl,
            receipt_key: receiptKey,
          },
        ],
      });
      if (!row) throw httpErr(400, "Valor inválido");
      if (b.data.approve !== false) {
        await syncExpenseIntoAdjustment(tx, row.id, "approved", req.user!.id);
      } else {
        await flagShiftForExpenses(tx, s.id);
      }
      return mapShift(await tx.campoShift.findFirstOrThrow({ where: { id: s.id }, include: shiftInclude }), tz);
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.post("/api/folha/despesas/:id/aprovar", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const e = await tx.campoShiftExpense.findFirst({ where: { id: String(req.params.id) }, include: { shift: true } });
      if (!e) throw httpErr(404, "Lançamento não encontrado");
      await assertNotPaid(tx, e.employeeId, e.shift.workDate);
      const updated = await syncExpenseIntoAdjustment(tx, e.id, "approved", req.user!.id, req.body?.note);
      return mapExpense(updated);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.post("/api/folha/despesas/:id/recusar", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const e = await tx.campoShiftExpense.findFirst({ where: { id: String(req.params.id) }, include: { shift: true } });
      if (!e) throw httpErr(404, "Lançamento não encontrado");
      await assertNotPaid(tx, e.employeeId, e.shift.workDate);
      const updated = await syncExpenseIntoAdjustment(tx, e.id, "rejected", req.user!.id, req.body?.reason || req.body?.note);
      return mapExpense(updated);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

// ------------------------------------------------------------------ conferência (antes do pagamento)
const confBody = z.object({
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employee_id: z.string().uuid(),
  to: z.string().max(200).optional().nullable(),
});

type WeekEmployeeRow = Awaited<ReturnType<typeof weekData>>["employees"][number];

function conferenceDayDetail(d: WeekEmployeeRow["days"][number]) {
  const bits: string[] = [];
  if (d.kind === "line") bits.push("lançado pelo escritório");
  else if ("clock_in_label" in d && (d.clock_in_label || d.clock_out_label)) {
    bits.push(`${d.clock_in_label || "—"}–${d.clock_out_label || "—"}`);
  }
  if (d.overtime_minutes) {
    bits.push(`+${Math.floor(d.overtime_minutes / 60)}h${String(d.overtime_minutes % 60).padStart(2, "0")}m extra`);
  }
  if (d.sqft) bits.push(`${d.sqft} sq ft`);
  else if (d.days_worked) bits.push(`${d.days_worked} dia${d.days_worked === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

function conferenceInputFromWeek(
  org: {
    name: string;
    logoUrl?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    primaryColor?: string | null;
    accentColor?: string | null;
  },
  week: { label: string; full_label?: string },
  row: WeekEmployeeRow,
): ConferenceReportInput {
  const days = row.days
    .filter((d) => d.kind === "line" || d.status === "approved")
    .map((d) => ({
      dateLabel: d.date_label,
      detail: conferenceDayDetail(d),
      amount: d.amount,
    }));
  const waiting =
    row.totals.pending_days || row.totals.open_days
      ? `Atenção: ainda há ${[
          row.totals.pending_days ? `${row.totals.pending_days} dia(s) em conferência` : "",
          row.totals.open_days ? `${row.totals.open_days} em andamento` : "",
        ]
          .filter(Boolean)
          .join(" e ")} — esses valores não entram no total.`
      : null;
  return {
    org: {
      name: org.name || "ObraMate",
      logoUrl: org.logoUrl,
      contactPhone: org.contactPhone,
      contactEmail: org.contactEmail,
      primaryColor: org.primaryColor,
      accentColor: org.accentColor,
    },
    employeeName: row.name,
    sectorLabel: SECTOR_LABEL[row.sector] || row.sector,
    payTypeLabel: row.pay_type === "production" ? "Produção" : "Diária",
    periodLabel: week.full_label || week.label,
    days,
    gross: row.totals.gross,
    reimbursement: row.totals.reimbursement,
    discount: row.totals.discount,
    net: row.totals.net,
    waitingNote: waiting,
  };
}

async function loadConferenceOrg(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      logoUrl: true,
      contactEmail: true,
      contactPhone: true,
      primaryColor: true,
      accentColor: true,
    },
  });
}

async function resolveConference(
  organizationId: string,
  weekRef: string,
  employeeId: string,
): Promise<{ input: ConferenceReportInput; row: WeekEmployeeRow; email: string | null }> {
  const tz = await orgTz(organizationId);
  const org = await loadConferenceOrg(organizationId);
  return withTenantTransaction(organizationId, async (tx) => {
    const data = await weekData(tx, organizationId, weekRef, tz);
    const row = data.employees.find((e) => e.id === employeeId);
    if (!row) throw httpErr(404, "Funcionário sem lançamentos nesta semana.");
    const emp = await tx.payrollEmployee.findFirst({
      where: { id: row.id },
      include: { user: { select: { email: true } } },
    });
    const email = (emp?.email || emp?.user?.email || row.email || "").trim().toLowerCase() || null;
    const input = conferenceInputFromWeek(
      {
        name: org?.name || "ObraMate",
        logoUrl: org?.logoUrl,
        contactEmail: org?.contactEmail,
        contactPhone: org?.contactPhone,
        primaryColor: org?.primaryColor,
        accentColor: org?.accentColor,
      },
      data.week,
      row,
    );
    return { input, row, email };
  });
}

function safePdfName(name: string) {
  return String(name || "folha")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "folha";
}

/** PDF da conferência (download / impressão). */
folhaAdminRouter.get("/api/folha/conferencia.pdf", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const week = String(req.query.week || "");
    const employeeId = String(req.query.employee_id || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !employeeId) {
      res.status(400).json({ success: false, error: "Informe a semana e o funcionário." });
      return;
    }
    const { input } = await resolveConference(req.organizationId!, week, employeeId);
    const pdf = await buildConferencePdf(input);
    const filename = `folha-conferencia-${safePdfName(input.employeeName)}-${week}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(pdf);
  } catch (error) {
    fail(res, error, next);
  }
});

/** Envia o relatório da semana ao funcionário (e-mail + PDF) para conferência antes do pagamento. */
folhaAdminRouter.post("/api/folha/conferencia", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = confBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Informe a semana e o funcionário." });
      return;
    }
    const org = await loadConferenceOrg(req.organizationId!);
    const { input, email } = await resolveConference(req.organizationId!, b.data.week, b.data.employee_id);
    const to = (b.data.to || email || "").trim().toLowerCase();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw httpErr(400, "Cadastre o e-mail do funcionário ou informe um destinatário.", "NO_EMAIL");
    }
    const pdf = await buildConferencePdf(input);
    const filename = `folha-conferencia-${safePdfName(input.employeeName)}.pdf`;
    const sent = await sendCustomerEmail({
      to,
      subject: conferenceEmailSubject(input),
      text: buildConferenceText(input),
      html: buildConferenceEmailHtml(input),
      replyTo: org?.contactEmail || undefined,
      attachments: [{ filename, content: pdf }],
    });
    if (!sent.ok) {
      res.status(502).json({ success: false, error: sent.error || "Falha ao enviar e-mail." });
      return;
    }
    res.json({
      success: true,
      data: {
        to,
        name: input.employeeName,
        net: input.net,
        week_label: input.periodLabel,
        transport: sent.transport,
        pdf: true,
      },
    });
  } catch (error) {
    fail(res, error, next);
  }
});

// ------------------------------------------------------------------ pagamentos
const payBody = z.object({
  period_id: z.string().uuid(),
  employee_ids: z.array(z.string().uuid()).min(1).max(200),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: payMethodField,
  reference: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  /** Pay even when some days are still waiting for review. */
  force: z.boolean().optional(),
});

folhaAdminRouter.post("/api/folha/pagamentos", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = payBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Escolha a semana, quem pagar e a data." });
      return;
    }
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const period = await tx.payrollPeriod.findFirst({ where: { id: b.data.period_id } });
      if (!period) throw httpErr(404, "Semana não encontrada");
      const paidOn = parseYmd(b.data.paid_on)!;
      const created: { employee_id: string; name: string; amount: number; user_id: string | null; method: string | null }[] = [];
      const skipped: { employee_id: string; name: string; reason: string }[] = [];
      for (const empId of b.data.employee_ids) {
        const emp = await tx.payrollEmployee.findFirst({ where: { id: empId } });
        if (!emp) continue;
        const already = await tx.payrollPayment.findFirst({ where: { periodId: period.id, employeeId: emp.id, status: "paid" } });
        if (already) {
          skipped.push({ employee_id: emp.id, name: emp.name, reason: "Já pago" });
          continue;
        }
        const waiting = await tx.campoShift.count({
          where: { employeeId: emp.id, workDate: { gte: period.startDate, lte: period.endDate }, reviewStatus: { in: ["pending", "returned", "in_progress"] } },
        });
        if (waiting && !b.data.force) {
          skipped.push({ employee_id: emp.id, name: emp.name, reason: `${waiting} dia(s) ainda em conferência` });
          continue;
        }
        const [lines, adj] = await Promise.all([
          tx.payrollTimesheet.aggregate({ where: { periodId: period.id, employeeId: emp.id }, _sum: { calculatedAmount: true } }),
          tx.payrollPeriodAdjustment.findFirst({ where: { periodId: period.id, employeeId: emp.id } }),
        ]);
        const amount = money(num(lines._sum.calculatedAmount) + num(adj?.reimbursement) - num(adj?.discount));
        if (amount <= 0) {
          skipped.push({ employee_id: emp.id, name: emp.name, reason: "Nada a pagar" });
          continue;
        }
        const sector = sectorKey(emp.sector);
        const method = b.data.method || emp.paymentMethod || null;
        const ab = await tx.financePayrollAbatement.create({
          data: {
            organizationId: req.organizationId!,
            periodId: period.id,
            employeeId: emp.id,
            sector,
            label: `${emp.name} · ${SECTOR_LABEL[sector]} · ${period.label.replace(/^Semana /, "Semana ")}`.slice(0, 190),
            amount: new Prisma.Decimal(amount),
            paidOn,
            method,
            notes: [b.data.reference ? `Ref ${b.data.reference}` : "", b.data.notes || ""].filter(Boolean).join(" · ") || null,
            status: "paid",
          },
        });
        await tx.payrollPayment.create({
          data: {
            organizationId: req.organizationId!,
            periodId: period.id,
            employeeId: emp.id,
            amount: new Prisma.Decimal(amount),
            paidOn,
            method,
            reference: b.data.reference || null,
            notes: b.data.notes || null,
            sector,
            financeAbatementId: ab.id,
            createdById: req.user!.id,
          },
        });
        created.push({ employee_id: emp.id, name: emp.name, amount, user_id: emp.userId, method });
      }
      // Everyone with something to receive is paid → the week is closed.
      const owed = await tx.payrollTimesheet.groupBy({ by: ["employeeId"], where: { periodId: period.id }, _sum: { calculatedAmount: true } });
      const paidIds = new Set((await tx.payrollPayment.findMany({ where: { periodId: period.id, status: "paid" }, select: { employeeId: true } })).map((p) => p.employeeId));
      const allPaid = owed.filter((o) => num(o._sum.calculatedAmount) > 0).every((o) => paidIds.has(o.employeeId));
      if (allPaid && created.length && period.status === "open") await tx.payrollPeriod.update({ where: { id: period.id }, data: { status: "closed" } });
      return { paid: created, skipped, total: money(created.reduce((s, c) => s + c.amount, 0)), period_closed: allPaid && created.length > 0, week: period.label };
    });
    // Tell each employee with the app that the week was paid.
    for (const c of data.paid) {
      if (!c.user_id) continue;
      void notifyUsersPush(req.organizationId!, [c.user_id], {
        title: `Pagamento: ${c.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
        body: `${data.week}${c.method ? ` · ${methodLabel(c.method)}` : ""}`,
        url: "/campo/horas.html",
        tag: `pagamento-${c.employee_id}`,
      }).catch(() => {});
    }
    res.status(data.paid.length ? 201 : 200).json({ success: true, data: { ...data, paid: data.paid.map(({ user_id: _u, method: _m, ...p }) => p) } });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.post("/api/folha/pagamentos/:id/estornar", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    await withTenantTransaction(req.organizationId!, async (tx) => {
      const p = await tx.payrollPayment.findFirst({ where: { id: String(req.params.id), status: "paid" } });
      if (!p) throw httpErr(404, "Pagamento não encontrado");
      await tx.payrollPayment.update({ where: { id: p.id }, data: { status: "void", voidedAt: new Date() } });
      if (p.financeAbatementId) await tx.financePayrollAbatement.update({ where: { id: p.financeAbatementId }, data: { status: "void" } });
      await tx.payrollPeriod.update({ where: { id: p.periodId }, data: { status: "open" } });
    });
    res.json({ success: true });
  } catch (error) {
    fail(res, error, next);
  }
});

// ------------------------------------------------------------------ funcionários
function mapEmployee(e: Prisma.PayrollEmployeeGetPayload<{ include: { user: { select: { id: true; name: true; email: true } } } }>) {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    phone: formatUsPhone(e.phone),
    role_title: e.roleTitle,
    sector: e.sector,
    pay_type: e.payType === "production" ? "production" : "daily",
    daily_rate: num(e.dailyRate),
    overtime_rate: num(e.overtimeRate) || overtimeFromDaily(e.dailyRate),
    production_rate: num(e.productionRate),
    payment_method: e.paymentMethod,
    status: e.status,
    user: e.user ? { id: e.user.id, name: e.user.name, email: e.user.email } : null,
    schedule: {
      start_mode: e.scheduleStartMode,
      start_time: e.scheduleStartTime,
      end_time: e.scheduleEndTime,
      lunch_minutes: e.lunchMinutes,
      count_early_start: e.countEarlyStart,
    },
    require_photos: e.requirePhotos,
    require_gps: e.requireGps,
  };
}

const employeeBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().max(40).optional().nullable(),
  role_title: z.string().max(80).optional().nullable(),
  sector: z.enum(["installation", "sand_finish"]).optional().nullable(),
  pay_type: z.enum(["daily", "production"]).optional(),
  daily_rate: z.number().min(0).max(100000).optional(),
  overtime_rate: z.number().min(0).max(10000).optional().nullable(),
  production_rate: z.number().min(0).max(1000).optional(),
  payment_method: payMethodField,
  user_id: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
  schedule: z
    .object({
      start_mode: z.enum(["job", "fixed"]).optional(),
      start_time: z.string().optional(),
      end_time: z.string().optional(),
      lunch_minutes: z.number().int().min(0).max(180).optional(),
      count_early_start: z.boolean().optional(),
    })
    .optional(),
  require_photos: z.boolean().optional(),
  require_gps: z.boolean().optional(),
});

function employeeData(d: z.infer<typeof employeeBody>) {
  const sch = d.schedule || {};
  if ((sch.start_time && !isHHMM(sch.start_time)) || (sch.end_time && !isHHMM(sch.end_time))) throw httpErr(400, "Horário inválido (use HH:MM).");
  return {
    name: d.name,
    ...(d.email !== undefined ? { email: d.email || null } : {}),
    ...(d.phone !== undefined ? { phone: formatUsPhone(d.phone || null) } : {}),
    ...(d.role_title !== undefined ? { roleTitle: d.role_title || null } : {}),
    ...(d.sector !== undefined ? { sector: d.sector || null } : {}),
    ...(d.pay_type !== undefined ? { payType: d.pay_type } : {}),
    ...(d.daily_rate !== undefined ? { dailyRate: d.daily_rate } : {}),
    ...(d.overtime_rate !== undefined ? { overtimeRate: d.overtime_rate ?? (d.daily_rate !== undefined ? overtimeFromDaily(d.daily_rate) : 0) } : d.daily_rate !== undefined ? { overtimeRate: overtimeFromDaily(d.daily_rate) } : {}),
    ...(d.production_rate !== undefined ? { productionRate: d.production_rate } : {}),
    ...(d.payment_method !== undefined ? { paymentMethod: d.payment_method || null } : {}),
    ...(d.status !== undefined ? { status: d.status } : {}),
    ...(sch.start_mode ? { scheduleStartMode: sch.start_mode } : {}),
    ...(sch.start_time ? { scheduleStartTime: sch.start_time } : {}),
    ...(sch.end_time ? { scheduleEndTime: sch.end_time } : {}),
    ...(sch.lunch_minutes !== undefined ? { lunchMinutes: sch.lunch_minutes } : {}),
    ...(sch.count_early_start !== undefined ? { countEarlyStart: sch.count_early_start } : {}),
    ...(d.require_photos !== undefined ? { requirePhotos: d.require_photos } : {}),
    ...(d.require_gps !== undefined ? { requireGps: d.require_gps } : {}),
  };
}

async function linkUser(tx: PayrollTx, userId: string | null | undefined, exceptEmployeeId?: string) {
  if (userId === undefined) return {};
  if (!userId) return { userId: null };
  const u = await tx.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (!u) throw httpErr(400, "Usuário não encontrado");
  const taken = await tx.payrollEmployee.findFirst({ where: { userId, ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}) }, select: { name: true } });
  if (taken) throw httpErr(409, `Esse login já está ligado a ${taken.name}.`);
  return { userId };
}

async function ensurePayrollPaymentMethods(tx: PayrollTx, organizationId: string) {
  const count = await tx.orgCatalogItem.count({ where: { kind: PAYROLL_PAYMENT_METHOD_KIND } });
  if (count > 0) return;
  for (const s of DEFAULT_PAYROLL_PAYMENT_METHODS) {
    await tx.orgCatalogItem.create({
      data: {
        organizationId,
        kind: PAYROLL_PAYMENT_METHOD_KIND,
        key: s.key,
        label: s.label,
        description: s.description,
        sortOrder: s.sortOrder,
        active: true,
        isSystem: true,
      },
    });
  }
}

async function activePayrollMethods(tx: PayrollTx, organizationId: string) {
  await ensurePayrollPaymentMethods(tx, organizationId);
  return tx.orgCatalogItem.findMany({
    where: { kind: PAYROLL_PAYMENT_METHOD_KIND, active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
}

const empInclude = { user: { select: { id: true, name: true, email: true } } } as const;

folhaAdminRouter.get("/api/folha/formas-pagamento", requireCrmAuth, requireCrmPermission("payroll.view"), async (req: AuthedRequest, res, next) => {
  try {
    const rows = await withTenantTransaction(req.organizationId!, async (tx) => activePayrollMethods(tx, req.organizationId!));
    res.json({
      success: true,
      data: rows.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        sort_order: r.sortOrder,
      })),
    });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.get("/api/folha/funcionarios", requireCrmAuth, requireCrmPermission("payroll.view"), async (req: AuthedRequest, res, next) => {
  try {
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const [emps, users] = await Promise.all([
        tx.payrollEmployee.findMany({ include: empInclude, orderBy: [{ status: "asc" }, { name: "asc" }] }),
        tx.user.findMany({ where: { status: { not: "disabled" } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
      ]);
      const linked = new Set(emps.map((e) => e.userId).filter(Boolean));
      return { employees: emps.map(mapEmployee), users: users.map((u) => ({ ...u, linked: linked.has(u.id) })) };
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.post("/api/folha/funcionarios", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = employeeBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Confira os dados do funcionário." });
      return;
    }
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const link = await linkUser(tx, b.data.user_id);
      const row = await tx.payrollEmployee.create({
        data: { organizationId: req.organizationId!, ...employeeData(b.data), ...(link as { userId?: string | null }) } as Prisma.PayrollEmployeeUncheckedCreateInput,
        include: empInclude,
      });
      return mapEmployee(row);
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

folhaAdminRouter.put("/api/folha/funcionarios/:id", requireCrmAuth, requireCrmPermission("payroll.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const b = employeeBody.partial().extend({ name: z.string().trim().min(2).max(120).optional() }).safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Confira os dados do funcionário." });
      return;
    }
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const id = String(req.params.id);
      const cur = await tx.payrollEmployee.findFirst({ where: { id } });
      if (!cur) throw httpErr(404, "Funcionário não encontrado");
      const link = await linkUser(tx, b.data.user_id, id);
      const patch = employeeData({ name: cur.name, ...b.data } as z.infer<typeof employeeBody>);
      const row = await tx.payrollEmployee.update({ where: { id }, data: { ...patch, ...(link as { userId?: string | null }) }, include: empInclude });
      return mapEmployee(row);
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, next);
  }
});

// ------------------------------------------------------------------ relatórios
const csvCell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const toCsv = (rows: (string | number | null)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

type ReportFilter = { from: Date; to: Date; employeeId: string | null; sector: "installation" | "sand_finish" | null };

function parseReportFilter(q: Record<string, unknown>, tz: string): ReportFilter {
  const today = workDateFor(new Date(), tz);
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || "")) ? parseYmd(String(q.from))! : yearStart;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || "")) ? parseYmd(String(q.to))! : today;
  const employeeId = /^[0-9a-f-]{36}$/i.test(String(q.employee_id || "")) ? String(q.employee_id) : null;
  const sector = q.sector === "installation" || q.sector === "sand_finish" ? q.sector : null;
  if (to.getTime() < from.getTime()) throw httpErr(400, "O fim do período precisa ser depois do início.");
  return { from, to, employeeId, sector };
}

/**
 * Earned (approved payroll lines by work date) vs paid (payments by pay date) per employee,
 * plus labor cost per job (day amount split across the day's jobs — by sqft when production).
 */
export async function reportData(tx: PayrollTx, f: ReportFilter) {
  const empWhere = f.employeeId ? { employeeId: f.employeeId } : {};
  const [employees, lines, payments, periods, shifts] = await Promise.all([
    tx.payrollEmployee.findMany({ orderBy: { name: "asc" } }),
    tx.payrollTimesheet.findMany({ where: { ...empWhere, workDate: { gte: f.from, lte: f.to } } }),
    tx.payrollPayment.findMany({ where: { ...empWhere, status: "paid", paidOn: { gte: f.from, lte: f.to } }, include: { period: { select: { label: true, startDate: true, endDate: true } } }, orderBy: { paidOn: "desc" } }),
    tx.payrollPeriod.findMany({ where: { startDate: { lte: f.to }, endDate: { gte: f.from } }, include: { adjustments: true } }),
    tx.campoShift.findMany({
      where: { reviewStatus: "approved", workDate: { gte: f.from, lte: f.to }, employeeId: f.employeeId ?? { not: null } },
      select: { employeeId: true, sector: true, amount: true, sqft: true, jobs: { select: { workOrderId: true, sqft: true, workOrder: { select: { number: true, title: true } } } } },
    }),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e]));
  const sectorOf = (empId: string, snap?: string | null) => sectorKey(snap || empById.get(empId)?.sector);
  const inSector = (empId: string, snap?: string | null) => !f.sector || sectorOf(empId, snap) === f.sector;

  type Row = { id: string; name: string; sector: string; pay_type: string; days: number; overtime_hours: number; sqft: number; earned: number; reimbursement: number; discount: number; net: number; paid: number; payments: number; email: string | null; phone: string | null };
  const rows = new Map<string, Row>();
  const row = (empId: string) => {
    let r = rows.get(empId);
    if (!r) {
      const e = empById.get(empId);
      r = { id: empId, name: e?.name || "—", sector: sectorKey(e?.sector), pay_type: e?.payType === "production" ? "production" : "daily", days: 0, overtime_hours: 0, sqft: 0, earned: 0, reimbursement: 0, discount: 0, net: 0, paid: 0, payments: 0, email: e?.email || null, phone: e?.phone || null };
      rows.set(empId, r);
    }
    return r;
  };
  for (const l of lines) {
    if (!inSector(l.employeeId, l.sector)) continue;
    const r = row(l.employeeId);
    r.days += num(l.daysWorked) > 0 ? num(l.daysWorked) : num(l.sqft) > 0 ? 1 : 0;
    r.overtime_hours += num(l.overtimeHours);
    r.sqft += num(l.sqft);
    r.earned += num(l.calculatedAmount);
  }
  for (const p of periods) {
    for (const a of p.adjustments) {
      if (f.employeeId && a.employeeId !== f.employeeId) continue;
      if (!inSector(a.employeeId)) continue;
      const r = row(a.employeeId);
      r.reimbursement += num(a.reimbursement);
      r.discount += num(a.discount);
    }
  }
  for (const p of payments) {
    if (!inSector(p.employeeId, p.sector)) continue;
    const r = row(p.employeeId);
    r.paid += num(p.amount);
    r.payments += 1;
  }
  const list = [...rows.values()]
    .map((r) => ({ ...r, days: money(r.days), overtime_hours: money(r.overtime_hours), sqft: money(r.sqft), earned: money(r.earned), reimbursement: money(r.reimbursement), discount: money(r.discount), paid: money(r.paid), net: money(r.earned + r.reimbursement - r.discount) }))
    .filter((r) => r.earned || r.paid || r.reimbursement || r.discount || r.days)
    .sort((a, b) => b.paid - a.paid || b.net - a.net || a.name.localeCompare(b.name));

  const jobs = new Map<string, { id: string; number: number | null; title: string; days: number; sqft: number; cost: number; people: Set<string> }>();
  for (const s of shifts) {
    if (!s.employeeId || !inSector(s.employeeId, s.sector) || !s.jobs.length) continue;
    const amount = num(s.amount);
    const totalSqft = s.jobs.reduce((t, j) => t + num(j.sqft), 0);
    for (const j of s.jobs) {
      const share = totalSqft > 0 ? num(j.sqft) / totalSqft : 1 / s.jobs.length;
      let r = jobs.get(j.workOrderId);
      if (!r) {
        r = { id: j.workOrderId, number: j.workOrder.number, title: j.workOrder.title, days: 0, sqft: 0, cost: 0, people: new Set() };
        jobs.set(j.workOrderId, r);
      }
      r.days += 1 / s.jobs.length;
      r.sqft += num(j.sqft);
      r.cost += amount * share;
      r.people.add(s.employeeId);
    }
  }
  const jobList = [...jobs.values()]
    .map(({ people, ...j }) => ({ ...j, days: money(j.days), sqft: money(j.sqft), cost: money(j.cost), people: people.size }))
    .sort((a, b) => b.cost - a.cost);

  const total = (k: "earned" | "paid" | "net" | "reimbursement" | "discount" | "days" | "overtime_hours" | "sqft") => money(list.reduce((t, r) => t + r[k], 0));
  return {
    filter: { from: ymd(f.from), to: ymd(f.to), employee_id: f.employeeId, sector: f.sector },
    totals: { employees: list.length, earned: total("earned"), reimbursement: total("reimbursement"), discount: total("discount"), net: total("net"), paid: total("paid"), days: total("days"), overtime_hours: total("overtime_hours"), sqft: total("sqft") },
    employees: list,
    payments: payments
      .filter((p) => inSector(p.employeeId, p.sector))
      .map((p) => ({ id: p.id, employee_id: p.employeeId, name: empById.get(p.employeeId)?.name || "—", sector: sectorOf(p.employeeId, p.sector), amount: num(p.amount), paid_on: ymd(p.paidOn), method: p.method, method_label: p.method ? methodLabel(p.method) : null, reference: p.reference, week: p.period.label, week_start: ymd(p.period.startDate) })),
    jobs: jobList,
  };
}

folhaAdminRouter.get("/api/folha/relatorio", requireCrmAuth, requireCrmPermission("payroll.view"), async (req: AuthedRequest, res, next) => {
  try {
    const tz = await orgTz(req.organizationId!);
    const f = parseReportFilter(req.query as Record<string, unknown>, tz);
    const data = await withTenantTransaction(req.organizationId!, (tx) => reportData(tx, f));
    if (req.query.format !== "csv") {
      res.json({ success: true, data });
      return;
    }
    const kind = String(req.query.kind || "employees");
    const sec = (k: string) => SECTOR_LABEL[k] || k;
    let rows: (string | number | null)[][];
    if (kind === "payments") {
      rows = [["Data do pagamento", "Funcionário", "Setor", "Semana", "Valor", "Forma", "Referência"], ...data.payments.map((p) => [p.paid_on, p.name, sec(p.sector), p.week, p.amount.toFixed(2), p.method_label, p.reference])];
    } else if (kind === "jobs") {
      rows = [["Job", "Título", "Dias-pessoa", "Pessoas", "Sq ft", "Custo de mão de obra"], ...data.jobs.map((j) => [j.number != null ? `#${j.number}` : "", j.title, j.days, j.people, j.sqft, j.cost.toFixed(2)])];
    } else {
      rows = [
        ["Funcionário", "Setor", "Tipo", "E-mail", "Telefone", "Dias", "Horas extras", "Sq ft", "Ganho", "Reembolsos", "Descontos", "Líquido", "Pago no período", "Pagamentos"],
        ...data.employees.map((r) => [r.name, sec(r.sector), r.pay_type === "production" ? "Produção" : "Diária", r.email, r.phone, r.days, r.overtime_hours, r.sqft, r.earned.toFixed(2), r.reimbursement.toFixed(2), r.discount.toFixed(2), r.net.toFixed(2), r.paid.toFixed(2), r.payments]),
        ["Total", "", "", "", "", data.totals.days, data.totals.overtime_hours, data.totals.sqft, data.totals.earned.toFixed(2), data.totals.reimbursement.toFixed(2), data.totals.discount.toFixed(2), data.totals.net.toFixed(2), data.totals.paid.toFixed(2), ""],
      ];
    }
    const name = `folha-${kind}-${data.filter.from}-a-${data.filter.to}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send("\uFEFF" + toCsv(rows));
  } catch (error) {
    fail(res, error, next);
  }
});

export { weekData, approveDay, periodFor };
