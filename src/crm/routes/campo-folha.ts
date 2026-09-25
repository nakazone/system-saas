/**
 * Campo folha — diária inteira + horas extras (30 em 30 min) para o funcionário logado.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth } from "../http.js";
import {
  calcTimesheetHoursTotal,
  calcTimesheetLineAmount,
  parseYmd,
  ymdFromDate,
  ymdToBrShort,
} from "../lib/payroll-calc.js";
import { canUseCampo, type Tx } from "../lib/campo-shared.js";
import { resolveOwnEmployee } from "../lib/payroll-employee-link.js";

export const campoFolhaRouter = Router();

function workDateUtc(d = new Date()) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function moneyUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0,
  );
}

function formatOtLabel(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0 && m <= 0) return "0 min";
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function roundHalf(n: number) {
  return Math.round(n * 2) / 2;
}

async function resolveEmployee(tx: Tx, userId: string, email?: string | null) {
  return resolveOwnEmployee(tx, userId, email);
}

async function resolveOpenPeriod(tx: Tx, workYmd: string) {
  const periods = await tx.payrollPeriod.findMany({
    where: { status: "open" },
    orderBy: { startDate: "desc" },
    take: 20,
  });
  const covering = periods.find((p) => {
    const s = ymdFromDate(p.startDate);
    const e = ymdFromDate(p.endDate);
    return workYmd >= s && workYmd <= e;
  });
  return covering || periods[0] || null;
}

async function findTodayLine(
  tx: Tx,
  employeeId: string,
  periodId: string,
  workDate: Date,
) {
  return tx.payrollTimesheet.findFirst({
    where: { employeeId, periodId, workDate },
    orderBy: { createdAt: "asc" },
  });
}

function lineAmount(
  emp: {
    payType: string;
    dailyRate: unknown;
    hourlyRate: unknown;
    overtimeRate: unknown;
  },
  days: number,
  reg: number,
  ot: number,
  ovr: number | null,
) {
  return calcTimesheetLineAmount(
    {
      payment_type: emp.payType,
      dailyRate: emp.dailyRate,
      hourlyRate: emp.hourlyRate,
      overtimeRate: emp.overtimeRate,
    },
    {
      days_worked: days,
      regular_hours: reg,
      overtime_hours: ot,
      daily_rate_override: ovr,
    },
  );
}

export async function buildFolhaPayload(
  tx: Tx,
  userId: string,
  now = new Date(),
  email?: string | null,
) {
  const emp = await resolveEmployee(tx, userId, email);
  if (!emp || emp.status !== "active") {
    return {
      linked: false,
      employee: null,
      period: null,
      today: null,
      can_edit: false,
      message: emp
        ? "O seu registo na folha está inativo. Peça ao escritório para reativar."
        : "Sua conta ainda não está vinculada à folha. Em Folha → Equipe, o email do funcionário tem de ser o mesmo do login.",
      payments: [] as Awaited<ReturnType<typeof buildPayments>>,
    };
  }

  const workYmd = ymdFromDate(workDateUtc(now));
  const workDate = parseYmd(workYmd)!;
  const period = await resolveOpenPeriod(tx, workYmd);
  const line = period ? await findTodayLine(tx, emp.id, period.id, workDate) : null;

  const days = line ? Number(line.daysWorked) || 0 : 0;
  const ot = line ? Number(line.overtimeHours) || 0 : 0;
  const reg = line ? Number(line.regularHours) || 0 : 0;
  const amount = line ? Number(line.calculatedAmount) || 0 : 0;

  const canEdit = Boolean(period && period.status === "open");

  const payments = await buildPayments(tx, emp.id);

  return {
    linked: true,
    employee: {
      id: emp.id,
      name: emp.name,
      daily_rate: Number(emp.dailyRate) || 0,
      daily_rate_label: moneyUsd(Number(emp.dailyRate) || 0),
      overtime_rate: Number(emp.overtimeRate) || 0,
      overtime_rate_label: moneyUsd(Number(emp.overtimeRate) || 0),
      pay_type: emp.payType,
    },
    period: period
      ? {
          id: period.id,
          label: period.label,
          start_date: ymdFromDate(period.startDate),
          end_date: ymdFromDate(period.endDate),
          status: period.status,
          range_label: `${ymdToBrShort(ymdFromDate(period.startDate))} – ${ymdToBrShort(ymdFromDate(period.endDate))}`,
        }
      : null,
    today: {
      work_date: workYmd,
      timesheet_id: line?.id || null,
      has_diaria: days >= 1,
      days_worked: days,
      overtime_hours: ot,
      overtime_label: formatOtLabel(ot),
      regular_hours: reg,
      amount,
      amount_label: moneyUsd(amount),
    },
    can_edit: canEdit,
    message: period
      ? null
      : "Não há período de folha aberto. Peça ao escritório para criar a semana.",
    payments,
  };
}

function mapPayment(row: {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
  amount: number;
  pay_status: "open" | "due" | "paid";
}) {
  const statusLabel =
    row.pay_status === "paid"
      ? "Pago"
      : row.pay_status === "due"
        ? "A receber"
        : "Em andamento";
  return {
    ...row,
    amount_label: moneyUsd(row.amount),
    status_label: statusLabel,
    range_label: `${ymdToBrShort(row.start_date)} – ${ymdToBrShort(row.end_date)}`,
    hint:
      row.pay_status === "open"
        ? `Fecha ${ymdToBrShort(row.end_date)}`
        : row.pay_status === "due"
          ? "Aguardando pagamento"
          : "Já abatido",
  };
}

async function buildPayments(tx: Tx, employeeId: string) {
  const periods = await tx.payrollPeriod.findMany({
    orderBy: { endDate: "desc" },
    take: 8,
    include: {
      timesheets: {
        where: { employeeId },
        select: { calculatedAmount: true },
      },
      adjustments: {
        where: { employeeId },
        select: { reimbursement: true, discount: true },
      },
      financeAbatements: {
        where: { status: { not: "void" } },
        select: { id: true, status: true, amount: true },
      },
    },
  });

  const rows = periods
    .map((p) => {
      const sheet = p.timesheets.reduce((s, t) => s + (Number(t.calculatedAmount) || 0), 0);
      const adj = p.adjustments.reduce(
        (s, a) => s + (Number(a.reimbursement) || 0) - (Number(a.discount) || 0),
        0,
      );
      const amount = Math.round((sheet + adj) * 100) / 100;
      const paid = (p.financeAbatements || []).some((a) => a.status === "paid");
      let pay_status: "open" | "due" | "paid" = "open";
      if (paid) pay_status = "paid";
      else if (p.status === "closed") pay_status = "due";
      return {
        id: p.id,
        label: p.label,
        start_date: ymdFromDate(p.startDate),
        end_date: ymdFromDate(p.endDate),
        status: p.status,
        amount,
        pay_status,
      };
    })
    .filter((r) => r.amount > 0 || r.pay_status === "open" || r.status === "open");

  // Prefer upcoming: open first, then due, skip old paid beyond 2
  const open = rows.filter((r) => r.pay_status === "open");
  const due = rows.filter((r) => r.pay_status === "due");
  const paid = rows.filter((r) => r.pay_status === "paid").slice(0, 1);
  return [...open, ...due, ...paid].slice(0, 4).map(mapPayment);
}

async function writeLine(
  tx: Tx,
  organizationId: string,
  emp: NonNullable<Awaited<ReturnType<typeof resolveEmployee>>>,
  period: { id: string; status: string; startDate: Date; endDate: Date },
  workDate: Date,
  workYmd: string,
  patch: { days?: number; ot?: number },
) {
  if (period.status !== "open") {
    throw Object.assign(new Error("Período fechado — não é possível lançar"), { status: 400 });
  }
  const startY = ymdFromDate(period.startDate);
  const endY = ymdFromDate(period.endDate);
  if ((workYmd < startY || workYmd > endY) && !emp.allowWorkDateOutsidePeriod) {
    throw Object.assign(new Error("Data fora do período aberto"), { status: 400 });
  }

  const existing = await findTodayLine(tx, emp.id, period.id, workDate);
  const days =
    patch.days !== undefined
      ? patch.days
      : existing
        ? Number(existing.daysWorked) || 0
        : 0;
  const ot =
    patch.ot !== undefined
      ? Math.max(0, roundHalf(patch.ot))
      : existing
        ? Number(existing.overtimeHours) || 0
        : 0;
  const reg = existing ? Number(existing.regularHours) || 0 : 0;
  const ovr =
    existing?.dailyRateOverride != null ? Number(existing.dailyRateOverride) : null;
  const amount = lineAmount(emp, days, reg, ot, ovr);
  const hoursTotal = calcTimesheetHoursTotal({
    days_worked: days,
    regular_hours: reg,
    overtime_hours: ot,
  });

  const data = {
    daysWorked: new Prisma.Decimal(days),
    regularHours: new Prisma.Decimal(reg),
    overtimeHours: new Prisma.Decimal(ot),
    hours: new Prisma.Decimal(hoursTotal),
    calculatedAmount: new Prisma.Decimal(amount),
    notes: existing?.notes || "Campo · lançamento do funcionário",
  };

  if (existing) {
    await tx.payrollTimesheet.update({ where: { id: existing.id }, data });
  } else {
    await tx.payrollTimesheet.create({
      data: {
        organizationId,
        periodId: period.id,
        employeeId: emp.id,
        workDate,
        projectId: null,
        dailyRateOverride: null,
        ...data,
      },
    });
  }
}

const diariaBody = z.object({
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const extraBody = z.object({
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** +0.5 or -0.5 (30 min steps) */
  delta_hours: z.number().refine((n: number) => Math.abs(n) === 0.5, {
    message: "Extras só em passos de 30 minutos",
  }),
});

campoFolhaRouter.post(
  "/api/campo/folha/diaria",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = diariaBody.parse(req.body || {});
      const now = new Date();
      const workYmd = body.work_date || ymdFromDate(workDateUtc(now));
      const workDate = parseYmd(workYmd);
      if (!workDate) {
        res.status(400).json({ success: false, error: "Data inválida" });
        return;
      }

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const emp = await resolveEmployee(tx, req.user!.id, req.user!.email);
        if (!emp || emp.status !== "active") {
          throw Object.assign(
            new Error(
              emp
                ? "Registo na folha inativo"
                : "Conta não vinculada à folha — o email do funcionário tem de coincidir com o login",
            ),
            { status: 400 },
          );
        }
        const period = await resolveOpenPeriod(tx, workYmd);
        if (!period) {
          throw Object.assign(new Error("Não há período de folha aberto"), { status: 400 });
        }
        const existing = await findTodayLine(tx, emp.id, period.id, workDate);
        if (existing && Number(existing.daysWorked) >= 1) {
          throw Object.assign(new Error("Diária de hoje já lançada"), { status: 409 });
        }
        await writeLine(tx, req.organizationId!, emp, period, workDate, workYmd, { days: 1 });
        return buildFolhaPayload(tx, req.user!.id, now, req.user!.email);
      });

      res.json({ success: true, data });
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status && err.status >= 400 && err.status < 500) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }
      if (error instanceof z.ZodError) {
        const ze = error as z.ZodError;
        res.status(400).json({ success: false, error: ze.issues[0]?.message || "Dados inválidos" });
        return;
      }
      next(error);
    }
  },
);

campoFolhaRouter.post(
  "/api/campo/folha/extra",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canUseCampo(req)) {
        res.status(403).json({ success: false, error: "Permission denied" });
        return;
      }
      const body = extraBody.parse(req.body || {});
      const now = new Date();
      const workYmd = body.work_date || ymdFromDate(workDateUtc(now));
      const workDate = parseYmd(workYmd);
      if (!workDate) {
        res.status(400).json({ success: false, error: "Data inválida" });
        return;
      }

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const emp = await resolveEmployee(tx, req.user!.id, req.user!.email);
        if (!emp || emp.status !== "active") {
          throw Object.assign(
            new Error(
              emp
                ? "Registo na folha inativo"
                : "Conta não vinculada à folha — o email do funcionário tem de coincidir com o login",
            ),
            { status: 400 },
          );
        }
        const period = await resolveOpenPeriod(tx, workYmd);
        if (!period) {
          throw Object.assign(new Error("Não há período de folha aberto"), { status: 400 });
        }
        const existing = await findTodayLine(tx, emp.id, period.id, workDate);
        const currentOt = existing ? Number(existing.overtimeHours) || 0 : 0;
        const nextOt = Math.max(0, roundHalf(currentOt + body.delta_hours));
        if (nextOt > 12) {
          throw Object.assign(new Error("Máximo de 12h extras por dia"), { status: 400 });
        }
        await writeLine(tx, req.organizationId!, emp, period, workDate, workYmd, { ot: nextOt });
        return buildFolhaPayload(tx, req.user!.id, now, req.user!.email);
      });

      res.json({ success: true, data });
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status && err.status >= 400 && err.status < 500) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }
      if (error instanceof z.ZodError) {
        const ze = error as z.ZodError;
        res.status(400).json({
          success: false,
          error: ze.issues[0]?.message || "Dados inválidos",
        });
        return;
      }
      next(error);
    }
  },
);
