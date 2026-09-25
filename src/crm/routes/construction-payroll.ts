/**
 * Construction payroll APIs (SaaS / Prisma) — matches payroll-module.html contract.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";
import {
  calcTimesheetHoursTotal,
  calcTimesheetLineAmount,
  mondayYmdFromCalendarYmd,
  overtimeFromDaily,
  parseYmd,
  sundayYmdAfterMonday,
  ymdFromDate,
  ymdToBrShort,
} from "../lib/payroll-calc.js";
import { findLinkableUserId, resolveOwnEmployee } from "../lib/payroll-employee-link.js";

export const constructionPayrollRouter = Router();

type PayrollTx = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

function mapEmployee(e: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  payType: string;
  sector: string | null;
  dailyRate: unknown;
  hourlyRate: unknown;
  overtimeRate: unknown;
  productionRate?: unknown;
  allowWorkDateOutsidePeriod: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  userId?: string | null;
}) {
  const daily = dec(e.dailyRate);
  const otStored = dec(e.overtimeRate);
  const otEffective = otStored > 0 ? otStored : overtimeFromDaily(daily);
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    phone: e.phone,
    role_title: e.roleTitle,
    payment_type: e.payType,
    pay_type: e.payType,
    sector: e.sector,
    daily_rate: daily,
    hourly_rate: dec(e.hourlyRate),
    overtime_rate: otEffective,
    production_rate: dec(e.productionRate),
    allow_work_date_outside_period: e.allowWorkDateOutsidePeriod ? 1 : 0,
    status: e.status,
    is_active: e.status === "active" ? 1 : 0,
    user_id: e.userId ?? null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

function mapPeriod(p: {
  id: string;
  label: string;
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt?: Date;
}) {
  return {
    id: p.id,
    name: p.label,
    label: p.label,
    start_date: ymdFromDate(p.startDate),
    end_date: ymdFromDate(p.endDate),
    status: p.status,
    created_at: p.createdAt,
  };
}

function mapHourBank(row: {
  id: string;
  employeeId: string;
  workDate: Date;
  hours: unknown;
  daysWorked?: unknown;
  overtimeHours?: unknown;
  sqft?: unknown;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt?: Date | null;
  timesheetId?: string | null;
  employee?: { name: string; email: string | null; payType?: string; dailyRate?: unknown; productionRate?: unknown } | null;
}) {
  const days = dec(row.daysWorked);
  const ot = dec(row.overtimeHours);
  const sqft = row.sqft != null ? dec(row.sqft) : null;
  let summary = "";
  if (sqft != null && sqft > 0) summary = `${sqft} sqft`;
  else {
    const parts: string[] = [];
    if (days > 0) parts.push(days === 1 ? "1 diária" : `${days} diárias`);
    if (ot > 0) parts.push(`${ot}h extras`);
    summary = parts.join(" + ") || `${dec(row.hours)}h`;
  }
  return {
    id: row.id,
    employee_id: row.employeeId,
    employee_name: row.employee?.name ?? null,
    employee_email: row.employee?.email ?? null,
    work_date: ymdFromDate(row.workDate),
    hours: dec(row.hours),
    days_worked: days,
    overtime_hours: ot,
    sqft,
    summary,
    notes: row.notes,
    status: row.status,
    timesheet_id: row.timesheetId ?? null,
    reviewed_at: row.reviewedAt ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapTimesheet(t: {
  id: string;
  periodId: string;
  employeeId: string;
  projectId: string | null;
  workDate: Date;
  hours: unknown;
  daysWorked: unknown;
  regularHours: unknown;
  overtimeHours: unknown;
  dailyRateOverride: unknown;
  calculatedAmount: unknown;
  notes: string | null;
  employee?: {
    name: string;
    payType: string;
    sector: string | null;
    hourlyRate: unknown;
    dailyRate: unknown;
    overtimeRate: unknown;
  };
  project?: { name: string; number?: number | null } | null;
}) {
  const projLabel =
    t.project?.number != null ? `#${t.project.number}` : t.project?.name ?? null;
  return {
    id: t.id,
    period_id: t.periodId,
    employee_id: t.employeeId,
    employee_name: t.employee?.name ?? null,
    employee_payment_type: t.employee?.payType ?? null,
    employee_sector: t.employee?.sector ?? null,
    project_id: t.projectId,
    project_name: t.project?.name ?? null,
    project_number: projLabel,
    work_date: ymdFromDate(t.workDate),
    hours: dec(t.hours),
    days_worked: dec(t.daysWorked),
    regular_hours: dec(t.regularHours),
    overtime_hours: dec(t.overtimeHours),
    daily_rate_override: t.dailyRateOverride != null ? dec(t.dailyRateOverride) : null,
    calculated_amount: dec(t.calculatedAmount),
    notes: t.notes,
    hourly_rate: t.employee ? dec(t.employee.hourlyRate) : 0,
    daily_rate: t.employee ? dec(t.employee.dailyRate) : 0,
    overtime_rate: t.employee ? dec(t.employee.overtimeRate) : 0,
    payment_type: t.employee?.payType ?? null,
  };
}

function canAccessPayrollSelf(req: AuthedRequest): boolean {
  if (req.user?.roleKey === "admin") return true;
  const perms = req.user?.permissions || [];
  return (
    perms.includes("payroll.self") ||
    perms.includes("payroll.view") ||
    perms.includes("payroll.manage")
  );
}

function boolish(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function normalizeSector(v: unknown): string | null {
  const s = String(v || "").trim().toLowerCase();
  if (s === "sand_finish" || s === "installation") return s;
  return s || null;
}

function normalizePayType(v: unknown): string {
  const s = String(v || "daily").toLowerCase();
  if (s === "production" || s === "sqft" || s === "producao" || s === "produção") return "production";
  if (s === "hourly" || s === "mixed" || s === "salary") return s === "salary" ? "hourly" : s;
  return "daily";
}

// ---- Employees ---------------------------------------------------------------

constructionPayrollRouter.get(
  "/api/construction-payroll/employees",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const active = String(req.query.active || "");
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollEmployee.findMany({
          where:
            active === "all" || active === "0" || active === "false"
              ? undefined
              : { status: "active" },
          orderBy: { name: "asc" },
        }),
      );
      res.json({ success: true, data: rows.map(mapEmployee) });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.get(
  "/api/construction-payroll/employees/:id",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollEmployee.findFirst({ where: { id: String(req.params.id) } }),
      );
      if (!row) {
        res.status(404).json({ success: false, error: "Employee not found" });
        return;
      }
      res.json({ success: true, data: mapEmployee(row) });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/employees",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      const email = b.email || null;
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        let userId = b.user_id || b.userId || null;
        if (!userId) {
          userId = await findLinkableUserId(tx, req.organizationId!, email);
        }
        const payType = normalizePayType(b.payment_type || b.pay_type);
        const dailyRate = Number(b.daily_rate) || 0;
        let overtimeRate = Number(b.overtime_rate);
        if (!Number.isFinite(overtimeRate) || overtimeRate <= 0) {
          overtimeRate = payType === "daily" ? overtimeFromDaily(dailyRate) : 0;
        }
        return tx.payrollEmployee.create({
          data: {
            organizationId: req.organizationId!,
            name: String(b.name || "Employee"),
            email,
            phone: b.phone || null,
            roleTitle: b.role_title || b.roleTitle || null,
            payType,
            sector: normalizeSector(b.sector),
            dailyRate: new Prisma.Decimal(dailyRate),
            hourlyRate: new Prisma.Decimal(Number(b.hourly_rate) || 0),
            overtimeRate: new Prisma.Decimal(overtimeRate),
            productionRate: new Prisma.Decimal(Number(b.production_rate) || 0),
            allowWorkDateOutsidePeriod: boolish(b.allow_work_date_outside_period),
            status: String(b.status || (b.is_active === 0 || b.is_active === false ? "inactive" : "active")),
            userId,
          },
        });
      });
      res.status(201).json({ success: true, data: mapEmployee(row) });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.put(
  "/api/construction-payroll/employees/:id",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollEmployee.findFirst({ where: { id } });
        if (!existing) return null;
        const nextEmail = b.email !== undefined ? b.email : existing.email;
        let userId: string | null | undefined =
          b.user_id !== undefined || b.userId !== undefined
            ? b.user_id || b.userId || null
            : undefined;
        if (userId === undefined && !existing.userId) {
          userId = await findLinkableUserId(tx, req.organizationId!, nextEmail, id);
        }
        let status: string | undefined;
        if (b.status !== undefined) status = String(b.status);
        else if (b.is_active !== undefined) status = boolish(b.is_active) ? "active" : "inactive";

        const nextPayType =
          b.payment_type !== undefined || b.pay_type !== undefined
            ? normalizePayType(b.payment_type || b.pay_type)
            : existing.payType;
        const nextDaily =
          b.daily_rate !== undefined ? Number(b.daily_rate) || 0 : Number(existing.dailyRate) || 0;
        let nextOt: number | undefined;
        if (b.overtime_rate !== undefined) {
          nextOt = Number(b.overtime_rate) || 0;
        } else if (
          (b.daily_rate !== undefined || b.payment_type !== undefined || b.pay_type !== undefined) &&
          nextPayType === "daily"
        ) {
          // Keep OT at 10% of daily when daily/type changes and OT not explicitly sent
          nextOt = overtimeFromDaily(nextDaily);
        }

        return tx.payrollEmployee.update({
          where: { id },
          data: {
            name: b.name !== undefined ? String(b.name) : undefined,
            email: b.email !== undefined ? b.email : undefined,
            phone: b.phone !== undefined ? b.phone : undefined,
            roleTitle: b.role_title !== undefined ? b.role_title : undefined,
            payType:
              b.payment_type !== undefined || b.pay_type !== undefined ? nextPayType : undefined,
            sector: b.sector !== undefined ? normalizeSector(b.sector) : undefined,
            dailyRate: b.daily_rate !== undefined ? new Prisma.Decimal(nextDaily) : undefined,
            hourlyRate: b.hourly_rate !== undefined ? new Prisma.Decimal(Number(b.hourly_rate) || 0) : undefined,
            overtimeRate: nextOt !== undefined ? new Prisma.Decimal(nextOt) : undefined,
            productionRate:
              b.production_rate !== undefined
                ? new Prisma.Decimal(Number(b.production_rate) || 0)
                : undefined,
            allowWorkDateOutsidePeriod:
              b.allow_work_date_outside_period !== undefined
                ? boolish(b.allow_work_date_outside_period)
                : undefined,
            status,
            userId,
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Employee not found" });
        return;
      }
      res.json({ success: true, data: mapEmployee(row) });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.delete(
  "/api/construction-payroll/employees/:id",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollEmployee.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.payrollEmployee.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Employee not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

/** Projects list used by payroll (and legacy SF UIs) for timesheet project column */
constructionPayrollRouter.get(
  "/api/projects",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.project.findMany({
          where: { deletedAt: null },
          orderBy: [{ number: "desc" }, { updatedAt: "desc" }],
          take: limit,
          select: {
            id: true,
            number: true,
            name: true,
            status: true,
            address: true,
          },
        }),
      );
      res.json({
        success: true,
        data: rows.map((p) => ({
          id: p.id,
          number: p.number,
          name: p.name,
          status: p.status,
          address: p.address,
          project_number: p.number != null ? `#${p.number}` : p.name,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---- Self hour bank ----------------------------------------------------------

constructionPayrollRouter.get(
  "/api/construction-payroll/me",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canAccessPayrollSelf(req)) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["payroll.self"] });
        return;
      }
      const emp = await withTenantTransaction(req.organizationId!, async (tx) =>
        resolveOwnEmployee(tx, req.user!.id, req.user!.email),
      );
      res.json({
        success: true,
        data: emp ? mapEmployee(emp) : null,
        linked: Boolean(emp),
        login_email: req.user!.email || null,
        hint: emp
          ? null
          : "Na Folha → 1 · Equipe, edite o funcionário e coloque o mesmo email do login CRM. Isso associa a conta automaticamente.",
      });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.get(
  "/api/construction-payroll/me/hour-bank",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canAccessPayrollSelf(req)) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["payroll.self"] });
        return;
      }
      const rows = await withTenantTransaction(req.organizationId!, async (tx) => {
        const emp = await resolveOwnEmployee(tx, req.user!.id, req.user!.email);
        if (!emp) return null;
        const entries = await tx.payrollHourBankEntry.findMany({
          where: { employeeId: emp.id },
          orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
          take: Math.min(200, Math.max(1, Number(req.query.limit) || 100)),
        });
        return { emp, entries };
      });
      if (!rows) {
        res.json({
          success: true,
          linked: false,
          data: [],
          employee: null,
          login_email: req.user!.email || null,
          hint: "Na Folha → 1 · Equipe, edite o funcionário e coloque o mesmo email do login CRM.",
        });
        return;
      }
      res.json({
        success: true,
        linked: true,
        employee: mapEmployee(rows.emp),
        data: rows.entries.map(mapHourBank),
      });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/me/hour-bank",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canAccessPayrollSelf(req)) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["payroll.self"] });
        return;
      }
      const b = req.body || {};
      if (!b.work_date && !b.workDate) {
        res.status(400).json({ success: false, error: "work_date is required" });
        return;
      }
      const workDate = parseYmd(String(b.work_date || b.workDate));
      if (!workDate) {
        res.status(400).json({ success: false, error: "work_date inválida" });
        return;
      }

      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const emp = await resolveOwnEmployee(tx, req.user!.id, req.user!.email);
        if (!emp) return null;
        if (emp.status !== "active") throw new Error("EMP_INACTIVE");

        const payType = String(emp.payType || "daily").toLowerCase();
        let daysWorked = 0;
        let overtimeHours = 0;
        let sqft: number | null = null;
        let hoursRollup = 0;

        if (payType === "production") {
          sqft = Number(b.sqft);
          if (!Number.isFinite(sqft) || sqft <= 0) {
            throw new Error("BAD_SQFT");
          }
          hoursRollup = 0;
        } else {
          const hasDiaria =
            b.days_worked === true ||
            b.days_worked === 1 ||
            b.days_worked === "1" ||
            b.has_diaria === true;
          daysWorked = hasDiaria ? 1 : Number(b.days_worked) || 0;
          if (daysWorked !== 0 && daysWorked !== 1) {
            throw new Error("BAD_DAYS");
          }
          overtimeHours = Number(b.overtime_hours ?? b.overtimeHours ?? 0) || 0;
          overtimeHours = Math.round(overtimeHours * 2) / 2;
          if (overtimeHours < 0 || overtimeHours > 12) throw new Error("BAD_OT");
          if (daysWorked <= 0 && overtimeHours <= 0) throw new Error("EMPTY_ENTRY");
          hoursRollup = calcTimesheetHoursTotal({
            days_worked: daysWorked,
            overtime_hours: overtimeHours,
          });
        }

        return tx.payrollHourBankEntry.create({
          data: {
            organizationId: req.organizationId!,
            employeeId: emp.id,
            workDate,
            hours: new Prisma.Decimal(hoursRollup),
            daysWorked: new Prisma.Decimal(daysWorked),
            overtimeHours: new Prisma.Decimal(overtimeHours),
            sqft: sqft != null ? new Prisma.Decimal(sqft) : null,
            notes: b.notes ? String(b.notes).slice(0, 500) : null,
            status: "pending",
          },
        });
      });
      if (!row) {
        res.status(404).json({
          success: false,
          error:
            "A sua conta ainda não está associada a um funcionário. Peça ao gestor da folha para vincular o email.",
        });
        return;
      }
      res.status(201).json({ success: true, data: mapHourBank(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "EMP_INACTIVE") {
        res.status(400).json({ success: false, error: "Funcionário inativo" });
        return;
      }
      if (error instanceof Error && error.message === "BAD_SQFT") {
        res.status(400).json({ success: false, error: "Informe a produção em sqft" });
        return;
      }
      if (error instanceof Error && error.message === "BAD_DAYS") {
        res.status(400).json({ success: false, error: "Diária deve ser 0 ou 1" });
        return;
      }
      if (error instanceof Error && error.message === "BAD_OT") {
        res.status(400).json({
          success: false,
          error: "Horas extras inválidas (máx. 12h, passos de 30 min)",
        });
        return;
      }
      if (error instanceof Error && error.message === "EMPTY_ENTRY") {
        res.status(400).json({
          success: false,
          error: "Marque 1 diária e/ou adicione horas extras",
        });
        return;
      }
      next(error);
    }
  },
);

constructionPayrollRouter.put(
  "/api/construction-payroll/me/hour-bank/:id",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canAccessPayrollSelf(req)) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["payroll.self"] });
        return;
      }
      const id = String(req.params.id);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const emp = await resolveOwnEmployee(tx, req.user!.id, req.user!.email);
        if (!emp) return null;
        const existing = await tx.payrollHourBankEntry.findFirst({
          where: { id, employeeId: emp.id },
        });
        if (!existing) return false as const;
        if (existing.status !== "pending") throw new Error("NOT_PENDING");
        const hours = b.hours !== undefined ? Number(b.hours) : undefined;
        if (hours !== undefined && (!Number.isFinite(hours) || hours <= 0 || hours > 24)) {
          throw new Error("BAD_HOURS");
        }
        return tx.payrollHourBankEntry.update({
          where: { id },
          data: {
            hours: hours !== undefined ? new Prisma.Decimal(hours) : undefined,
            notes: b.notes !== undefined ? (b.notes ? String(b.notes).slice(0, 500) : null) : undefined,
            workDate: b.work_date || b.workDate ? parseYmd(String(b.work_date || b.workDate)) || undefined : undefined,
          },
        });
      });
      if (row === null) {
        res.status(404).json({ success: false, error: "Funcionário não associado" });
        return;
      }
      if (row === false) {
        res.status(404).json({ success: false, error: "Lançamento não encontrado" });
        return;
      }
      res.json({ success: true, data: mapHourBank(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_PENDING") {
        res.status(400).json({ success: false, error: "Só pode editar lançamentos pendentes" });
        return;
      }
      if (error instanceof Error && error.message === "BAD_HOURS") {
        res.status(400).json({ success: false, error: "Informe horas válidas (entre 0 e 24)" });
        return;
      }
      next(error);
    }
  },
);

constructionPayrollRouter.delete(
  "/api/construction-payroll/me/hour-bank/:id",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canAccessPayrollSelf(req)) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["payroll.self"] });
        return;
      }
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const emp = await resolveOwnEmployee(tx, req.user!.id, req.user!.email);
        if (!emp) return null;
        const existing = await tx.payrollHourBankEntry.findFirst({
          where: { id, employeeId: emp.id },
        });
        if (!existing) return false;
        if (existing.status !== "pending") throw new Error("NOT_PENDING");
        await tx.payrollHourBankEntry.delete({ where: { id } });
        return true;
      });
      if (ok === null) {
        res.status(404).json({ success: false, error: "Funcionário não associado" });
        return;
      }
      if (!ok) {
        res.status(404).json({ success: false, error: "Lançamento não encontrado" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_PENDING") {
        res.status(400).json({ success: false, error: "Só pode apagar lançamentos pendentes" });
        return;
      }
      next(error);
    }
  },
);

// ---- Admin hour bank approve -------------------------------------------------

constructionPayrollRouter.get(
  "/api/construction-payroll/hour-bank",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const status = String(req.query.status || "pending").toLowerCase();
      const whereStatus =
        status === "all" ? undefined : status === "pending" || status === "approved" || status === "rejected" ? status : "pending";
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollHourBankEntry.findMany({
          where: whereStatus ? { status: whereStatus } : undefined,
          orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
          take: Math.min(300, Math.max(1, Number(req.query.limit) || 100)),
          include: { employee: { select: { name: true, email: true } } },
        }),
      );
      res.json({ success: true, data: rows.map(mapHourBank) });
    } catch (error) {
      next(error);
    }
  },
);

async function approveHourBankEntry(
  tx: PayrollTx,
  organizationId: string,
  entryId: string,
  reviewerId: string,
  periodIdHint?: string | null,
) {
  const entry = await tx.payrollHourBankEntry.findFirst({
    where: { id: entryId },
    include: { employee: true },
  });
  if (!entry) return { error: "NOT_FOUND" as const };
  if (entry.status !== "pending") return { error: "NOT_PENDING" as const };

  const workYmd = ymdFromDate(entry.workDate);
  let period =
    periodIdHint
      ? await tx.payrollPeriod.findFirst({ where: { id: periodIdHint, status: "open" } })
      : null;
  if (!period) {
    period = await tx.payrollPeriod.findFirst({
      where: {
        status: "open",
        startDate: { lte: entry.workDate },
        endDate: { gte: entry.workDate },
      },
      orderBy: { startDate: "desc" },
    });
  }
  if (!period) {
    period = await tx.payrollPeriod.findFirst({
      where: { status: "open" },
      orderBy: { startDate: "desc" },
    });
  }
  if (!period) return { error: "NO_OPEN_PERIOD" as const };

  const emp = entry.employee;
  const days = dec(entry.daysWorked);
  const ot = dec(entry.overtimeHours);
  const sqft = entry.sqft != null ? dec(entry.sqft) : 0;

  // Legacy entries: only `hours` filled → treat as regular hours
  const legacyHours = days <= 0 && ot <= 0 && sqft <= 0 ? dec(entry.hours) : 0;

  const lineQty = {
    days_worked: days,
    regular_hours: legacyHours,
    overtime_hours: ot,
    sqft,
  };
  const amount = calcTimesheetLineAmount(
    {
      payment_type: emp.payType,
      dailyRate: emp.dailyRate,
      hourlyRate: emp.hourlyRate,
      overtimeRate: emp.overtimeRate,
      productionRate: emp.productionRate,
    },
    lineQty,
  );
  const hoursTotal = calcTimesheetHoursTotal(lineQty);
  const noteParts = [
    entry.notes ? String(entry.notes) : null,
    sqft > 0 ? `Produção ${sqft} sqft` : null,
    `Banco de horas #${entry.id.slice(0, 8)}`,
  ].filter(Boolean);

  const ts = await tx.payrollTimesheet.create({
    data: {
      organizationId,
      periodId: period.id,
      employeeId: entry.employeeId,
      workDate: entry.workDate,
      hours: new Prisma.Decimal(hoursTotal),
      daysWorked: new Prisma.Decimal(days),
      regularHours: new Prisma.Decimal(legacyHours),
      overtimeHours: new Prisma.Decimal(ot),
      calculatedAmount: new Prisma.Decimal(amount),
      notes: noteParts.join(" · ").slice(0, 500),
    },
  });

  const updated = await tx.payrollHourBankEntry.update({
    where: { id: entry.id },
    data: {
      status: "approved",
      reviewedAt: new Date(),
      reviewedById: reviewerId,
      timesheetId: ts.id,
    },
    include: { employee: { select: { name: true, email: true } } },
  });

  return { entry: updated, timesheet: ts, period, workYmd };
}

constructionPayrollRouter.post(
  "/api/construction-payroll/hour-bank/:id/approve",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const periodId = req.body?.period_id || req.body?.periodId || null;
      const result = await withTenantTransaction(req.organizationId!, async (tx) =>
        approveHourBankEntry(tx, req.organizationId!, id, req.user!.id, periodId),
      );
      if ("error" in result) {
        if (result.error === "NOT_FOUND") {
          res.status(404).json({ success: false, error: "Lançamento não encontrado" });
          return;
        }
        if (result.error === "NOT_PENDING") {
          res.status(400).json({ success: false, error: "Só pode aprovar lançamentos pendentes" });
          return;
        }
        res.status(400).json({
          success: false,
          error: "Não há período aberto para lançar as horas. Crie ou abra um período em «Horas».",
          code: "NO_OPEN_PERIOD",
        });
        return;
      }
      res.json({
        success: true,
        data: mapHourBank(result.entry),
        timesheet_id: result.timesheet.id,
        period_id: result.period.id,
      });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/hour-bank/:id/reject",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const notes = req.body?.notes != null ? String(req.body.notes).slice(0, 500) : undefined;
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollHourBankEntry.findFirst({ where: { id } });
        if (!existing) return null;
        if (existing.status !== "pending") throw new Error("NOT_PENDING");
        return tx.payrollHourBankEntry.update({
          where: { id },
          data: {
            status: "rejected",
            reviewedAt: new Date(),
            reviewedById: req.user!.id,
            notes: notes !== undefined ? notes || existing.notes : undefined,
          },
          include: { employee: { select: { name: true, email: true } } },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Lançamento não encontrado" });
        return;
      }
      res.json({ success: true, data: mapHourBank(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_PENDING") {
        res.status(400).json({ success: false, error: "Só pode recusar lançamentos pendentes" });
        return;
      }
      next(error);
    }
  },
);

// ---- Dashboard ---------------------------------------------------------------

constructionPayrollRouter.get(
  "/api/construction-payroll/dashboard/summary",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const active_employees = await tx.payrollEmployee.count({ where: { status: "active" } });
        const open_periods = await tx.payrollPeriod.count({ where: { status: "open" } });
        const startOfMonth = new Date();
        startOfMonth.setUTCDate(1);
        startOfMonth.setUTCHours(0, 0, 0, 0);
        const mtd = await tx.payrollTimesheet.aggregate({
          where: { workDate: { gte: startOfMonth } },
          _sum: { calculatedAmount: true },
        });
        const lastClosed = await tx.payrollPeriod.findFirst({
          where: { status: "closed" },
          orderBy: { endDate: "desc" },
          include: { timesheets: { select: { calculatedAmount: true } } },
        });
        let last_closed_period = null as null | {
          id: string;
          name: string;
          end_date: string;
          total: number;
        };
        if (lastClosed) {
          const total = lastClosed.timesheets.reduce((s, t) => s + dec(t.calculatedAmount), 0);
          last_closed_period = {
            id: lastClosed.id,
            name: lastClosed.label,
            end_date: ymdFromDate(lastClosed.endDate),
            total: Math.round(total * 100) / 100,
          };
        }
        return {
          active_employees,
          open_periods,
          month_to_date_payroll_total: dec(mtd._sum.calculatedAmount),
          last_closed_period,
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

// ---- Periods -----------------------------------------------------------------

constructionPayrollRouter.get(
  "/api/construction-payroll/periods",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollPeriod.findMany({ orderBy: { startDate: "desc" } }),
      );
      res.json({ success: true, data: rows.map(mapPeriod) });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/periods",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      let startYmd = b.start_date ? String(b.start_date).slice(0, 10) : "";
      let endYmd = b.end_date ? String(b.end_date).slice(0, 10) : "";
      let label = String(b.label || b.name || "").trim();

      const weekMonday = String(b.week_monday || "").trim().slice(0, 10);
      if (weekMonday) {
        const mon = mondayYmdFromCalendarYmd(weekMonday);
        if (!mon) {
          res.status(400).json({ success: false, error: "week_monday inválido" });
          return;
        }
        if (mon !== weekMonday) {
          res.status(400).json({
            success: false,
            error: "week_monday deve ser uma segunda-feira (início da semana Seg–Dom)",
          });
          return;
        }
        const sun = sundayYmdAfterMonday(mon);
        if (!sun) {
          res.status(400).json({ success: false, error: "Não foi possível calcular o domingo da semana" });
          return;
        }
        startYmd = mon;
        endYmd = sun;
        if (!label) label = `Semana ${ymdToBrShort(mon)} – ${ymdToBrShort(sun)}`;
      }

      if (!startYmd || !endYmd) {
        res.status(400).json({
          success: false,
          error: "Informe week_monday (semana Seg–Dom) ou start_date e end_date",
        });
        return;
      }
      if (!label) label = "Período";

      const startDate = parseYmd(startYmd)!;
      const endDate = parseYmd(endYmd)!;

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const dup = await tx.payrollPeriod.findFirst({
          where: { startDate, endDate },
        });
        if (dup) return { dup };
        const row = await tx.payrollPeriod.create({
          data: {
            organizationId: req.organizationId!,
            label,
            startDate,
            endDate,
            status: "open",
          },
        });
        return { row };
      });

      if ("dup" in result && result.dup) {
        res.status(409).json({
          success: false,
          code: "PERIOD_RANGE_EXISTS",
          error: "Já existe um período com este intervalo de datas",
          data: mapPeriod(result.dup),
        });
        return;
      }
      res.status(201).json({ success: true, data: mapPeriod(result.row!) });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.delete(
  "/api/construction-payroll/periods/:periodId",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.periodId);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollPeriod.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.payrollPeriod.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Período não encontrado" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/periods/:periodId/close",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.periodId);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollPeriod.findFirst({ where: { id } });
        if (!existing) return null;
        if (existing.status === "closed") throw new Error("ALREADY_CLOSED");
        return tx.payrollPeriod.update({ where: { id }, data: { status: "closed" } });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Período não encontrado" });
        return;
      }
      res.json({ success: true, data: mapPeriod(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "ALREADY_CLOSED") {
        res.status(409).json({ success: false, error: "Período já fechado" });
        return;
      }
      next(error);
    }
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/periods/:periodId/reopen",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.periodId);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollPeriod.findFirst({ where: { id } });
        if (!existing) return null;
        return tx.payrollPeriod.update({ where: { id }, data: { status: "open" } });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Período não encontrado" });
        return;
      }
      res.json({ success: true, data: mapPeriod(row) });
    } catch (error) {
      next(error);
    }
  },
);

async function computePeriodPreview(tx: PayrollTx, periodId: string) {
  const period = await tx.payrollPeriod.findFirst({ where: { id: periodId } });
  if (!period) return null;
  const timesheets = await tx.payrollTimesheet.findMany({
    where: { periodId },
    include: {
      employee: true,
    },
  });
  const adjustments = await tx.payrollPeriodAdjustment.findMany({ where: { periodId } });
  const adjByEmp = new Map(adjustments.map((a) => [a.employeeId, a]));

  type Acc = {
    employee_id: string;
    name: string;
    sector: string | null;
    payment_type: string;
    days_worked_sum: number;
    regular_hours_sum: number;
    overtime_hours_sum: number;
    amount_base: number;
    amount_overtime: number;
    subtotal: number;
    double_diaria_dates: string[];
    daily_by_date: Map<string, number>;
  };
  const byEmp = new Map<string, Acc>();

  for (const t of timesheets) {
    const eid = t.employeeId;
    let acc = byEmp.get(eid);
    if (!acc) {
      acc = {
        employee_id: eid,
        name: t.employee.name,
        sector: t.employee.sector,
        payment_type: t.employee.payType,
        days_worked_sum: 0,
        regular_hours_sum: 0,
        overtime_hours_sum: 0,
        amount_base: 0,
        amount_overtime: 0,
        subtotal: 0,
        double_diaria_dates: [],
        daily_by_date: new Map(),
      };
      byEmp.set(eid, acc);
    }
    const days = dec(t.daysWorked);
    const reg = dec(t.regularHours);
    const ot = dec(t.overtimeHours);
    acc.days_worked_sum += days;
    acc.regular_hours_sum += reg;
    acc.overtime_hours_sum += ot;
    const lineAmt = dec(t.calculatedAmount);
    const ort = dec(t.employee.overtimeRate);
    const otAmt = Math.round(ot * ort * 100) / 100;
    acc.amount_overtime += otAmt;
    acc.amount_base += Math.round((lineAmt - otAmt) * 100) / 100;
    acc.subtotal += lineAmt;
    const ymd = ymdFromDate(t.workDate);
    if (days > 0) {
      acc.daily_by_date.set(ymd, (acc.daily_by_date.get(ymd) || 0) + days);
    }
  }

  const by_employee = [...byEmp.values()].map((acc) => {
    const double_diaria_dates: string[] = [];
    acc.daily_by_date.forEach((sum, ymd) => {
      if (Math.round(sum * 100) >= 200) double_diaria_dates.push(ymd);
    });
    const adj = adjByEmp.get(acc.employee_id);
    const reimbursement = adj ? dec(adj.reimbursement) : 0;
    const discount = adj ? dec(adj.discount) : 0;
    const employee_total = Math.round((acc.subtotal + reimbursement - discount) * 100) / 100;
    return {
      employee_id: acc.employee_id,
      name: acc.name,
      sector: acc.sector,
      payment_type: acc.payment_type,
      days_worked_sum: Math.round(acc.days_worked_sum * 100) / 100,
      regular_hours_sum: Math.round(acc.regular_hours_sum * 100) / 100,
      overtime_hours_sum: Math.round(acc.overtime_hours_sum * 100) / 100,
      amount_base: Math.round(acc.amount_base * 100) / 100,
      amount_sheet_base: Math.round(acc.amount_base * 100) / 100,
      amount_overtime: Math.round(acc.amount_overtime * 100) / 100,
      subtotal: Math.round(acc.subtotal * 100) / 100,
      reimbursement,
      discount,
      employee_total,
      double_diaria_dates,
      adjustment_notes: adj?.notes ?? null,
    };
  });

  by_employee.sort((a, b) => a.name.localeCompare(b.name));
  const grand_sheet = by_employee.reduce((s, r) => s + r.subtotal, 0);
  const grand_reim = by_employee.reduce((s, r) => s + r.reimbursement, 0);
  const grand_disc = by_employee.reduce((s, r) => s + r.discount, 0);
  const grand_total = Math.round((grand_sheet + grand_reim - grand_disc) * 100) / 100;

  return {
    period: mapPeriod(period),
    by_employee,
    grand_sheet: Math.round(grand_sheet * 100) / 100,
    grand_reimbursement: Math.round(grand_reim * 100) / 100,
    grand_discount: Math.round(grand_disc * 100) / 100,
    grand_total,
  };
}

constructionPayrollRouter.get(
  "/api/construction-payroll/periods/:periodId/preview",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) =>
        computePeriodPreview(tx, String(req.params.periodId)),
      );
      if (!data) {
        res.status(404).json({ success: false, error: "Período não encontrado" });
        return;
      }
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.put(
  "/api/construction-payroll/periods/:periodId/adjustments",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const periodId = String(req.params.periodId);
      const list = req.body?.adjustments;
      if (!Array.isArray(list)) {
        res.status(400).json({ success: false, error: "Body.adjustments deve ser um array" });
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const period = await tx.payrollPeriod.findFirst({ where: { id: periodId } });
        if (!period) throw new Error("NOT_FOUND");
        if (period.status === "closed") throw new Error("CLOSED");
        await tx.payrollPeriodAdjustment.deleteMany({ where: { periodId } });
        for (const r of list) {
          if (!r || typeof r !== "object") continue;
          const eid = String((r as { employee_id?: string }).employee_id || "");
          if (!eid) continue;
          const emp = await tx.payrollEmployee.findFirst({ where: { id: eid } });
          if (!emp) continue;
          const amt = Math.round((Number((r as { reimbursement?: number }).reimbursement) || 0) * 100) / 100;
          const disc = Math.round((Number((r as { discount?: number }).discount) || 0) * 100) / 100;
          const notes =
            (r as { notes?: string }).notes != null
              ? String((r as { notes?: string }).notes).slice(0, 500)
              : null;
          if (amt === 0 && disc === 0 && (!notes || notes === "")) continue;
          await tx.payrollPeriodAdjustment.create({
            data: {
              organizationId: req.organizationId!,
              periodId,
              employeeId: eid,
              reimbursement: new Prisma.Decimal(amt),
              discount: new Prisma.Decimal(disc),
              notes,
            },
          });
        }
      });
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_FOUND") {
        res.status(404).json({ success: false, error: "Período não encontrado" });
        return;
      }
      if (error instanceof Error && error.message === "CLOSED") {
        res.status(409).json({ success: false, error: "Período fechado" });
        return;
      }
      next(error);
    }
  },
);

// ---- Timesheets --------------------------------------------------------------

constructionPayrollRouter.get(
  "/api/construction-payroll/periods/:periodId/timesheets",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const periodId = String(req.params.periodId);
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const period = await tx.payrollPeriod.findFirst({ where: { id: periodId } });
        if (!period) return null;
        const rows = await tx.payrollTimesheet.findMany({
          where: { periodId },
          orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
          include: {
            employee: true,
            project: { select: { name: true, number: true } },
          },
        });
        return { period, rows };
      });
      if (!result) {
        res.status(404).json({ success: false, error: "Período não encontrado" });
        return;
      }
      res.json({
        success: true,
        data: result.rows.map(mapTimesheet),
        period: mapPeriod(result.period),
      });
    } catch (error) {
      next(error);
    }
  },
);

async function upsertTimesheetLine(
  tx: PayrollTx,
  organizationId: string,
  period: { id: string; startDate: Date; endDate: Date; status: string },
  line: Record<string, unknown>,
) {
  const employeeId = String(line.employee_id || "");
  if (!employeeId) {
    const e = new Error("ID de funcionário inválido");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }
  const emp = await tx.payrollEmployee.findFirst({ where: { id: employeeId } });
  if (!emp) {
    const e = new Error("Funcionário inválido");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }
  const lineId = line.id != null && String(line.id).trim() !== "" ? String(line.id).trim() : null;
  if (!lineId && emp.status !== "active") {
    const e = new Error("Funcionário inativo — não é possível criar linhas novas para este funcionário");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }
  const workYmd = String(line.work_date || "").slice(0, 10);
  const workDate = parseYmd(workYmd);
  if (!workDate) {
    const e = new Error("Data de trabalho em falta ou inválida");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }
  const startY = ymdFromDate(period.startDate);
  const endY = ymdFromDate(period.endDate);
  if ((workYmd < startY || workYmd > endY) && !emp.allowWorkDateOutsidePeriod) {
    const e = new Error("Data fora do período");
    (e as Error & { statusCode?: number }).statusCode = 400;
    throw e;
  }

  const days = Number(line.days_worked) || 0;
  const reg = Number(line.regular_hours) || 0;
  const ot = Number(line.overtime_hours) || 0;
  const ovr =
    line.daily_rate_override !== undefined && line.daily_rate_override !== null && String(line.daily_rate_override) !== ""
      ? Number(line.daily_rate_override)
      : null;
  const amount = calcTimesheetLineAmount(
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
  const hoursTotal = calcTimesheetHoursTotal({
    days_worked: days,
    regular_hours: reg,
    overtime_hours: ot,
  });
  const projectId =
    line.project_id != null && String(line.project_id).trim() !== "" ? String(line.project_id) : null;
  const notes = line.notes != null ? String(line.notes).slice(0, 500) || null : null;

  const data = {
    employeeId,
    projectId,
    workDate,
    hours: new Prisma.Decimal(hoursTotal),
    daysWorked: new Prisma.Decimal(days),
    regularHours: new Prisma.Decimal(reg),
    overtimeHours: new Prisma.Decimal(ot),
    dailyRateOverride: ovr != null && Number.isFinite(ovr) ? new Prisma.Decimal(ovr) : null,
    calculatedAmount: new Prisma.Decimal(amount),
    notes,
  };

  if (lineId) {
    const existing = await tx.payrollTimesheet.findFirst({ where: { id: lineId, periodId: period.id } });
    if (!existing) {
      const e = new Error("Linha não encontrada");
      (e as Error & { statusCode?: number }).statusCode = 404;
      throw e;
    }
    return tx.payrollTimesheet.update({
      where: { id: lineId },
      data,
      include: { employee: true, project: { select: { name: true, number: true } } },
    });
  }

  return tx.payrollTimesheet.create({
    data: {
      organizationId,
      periodId: period.id,
      ...data,
    },
    include: { employee: true, project: { select: { name: true, number: true } } },
  });
}

constructionPayrollRouter.post(
  "/api/construction-payroll/periods/:periodId/timesheets/bulk",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const periodId = String(req.params.periodId);
      const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      const canManage =
        req.user?.roleKey === "admin" || (req.user?.permissions || []).includes("payroll.manage");

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const period = await tx.payrollPeriod.findFirst({ where: { id: periodId } });
        if (!period) return { error: "NOT_FOUND" as const };
        if (period.status === "closed" && !canManage) {
          return { error: "CLOSED" as const };
        }
        const out = [];
        for (const line of lines) {
          if (!line || typeof line !== "object") continue;
          const hasEmp = line.employee_id != null && String(line.employee_id).trim() !== "";
          const hasDate = line.work_date != null && String(line.work_date).trim() !== "";
          const hasId = line.id != null && String(line.id).trim() !== "";
          if (!hasId && (!hasEmp || !hasDate)) continue;
          const row = await upsertTimesheetLine(tx, req.organizationId!, period, line);
          out.push(row);
        }
        if (lines.length > 0 && out.length === 0) {
          return { error: "BULK_NO_ROWS" as const };
        }
        return { out };
      });

      if ("error" in result) {
        if (result.error === "NOT_FOUND") {
          res.status(404).json({ success: false, error: "Período não encontrado" });
          return;
        }
        if (result.error === "CLOSED") {
          res.status(403).json({
            success: false,
            error: "Período fechado — só payroll.manage pode alterar",
            required: "payroll.manage",
          });
          return;
        }
        res.status(400).json({
          success: false,
          code: "BULK_NO_ROWS_SAVED",
          error:
            "Nenhuma linha foi salva. Confira funcionário e data em cada linha nova, valores (dias/horas ou nota) e se a data está dentro do período.",
        });
        return;
      }
      res.json({ success: true, data: result.out.map(mapTimesheet) });
    } catch (error) {
      const sc = (error as Error & { statusCode?: number }).statusCode;
      if (sc) {
        res.status(sc).json({ success: false, error: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/periods/:periodId/timesheets",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const periodId = String(req.params.periodId);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const period = await tx.payrollPeriod.findFirst({ where: { id: periodId } });
        if (!period) return null;
        return upsertTimesheetLine(tx, req.organizationId!, period, req.body || {});
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Period not found" });
        return;
      }
      res.status(201).json({ success: true, data: mapTimesheet(row) });
    } catch (error) {
      const sc = (error as Error & { statusCode?: number }).statusCode;
      if (sc) {
        res.status(sc).json({ success: false, error: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

constructionPayrollRouter.put(
  "/api/construction-payroll/timesheets/:id",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollTimesheet.findFirst({ where: { id } });
        if (!existing) return null;
        const period = await tx.payrollPeriod.findFirst({ where: { id: existing.periodId } });
        if (!period) return null;
        return upsertTimesheetLine(tx, req.organizationId!, period, {
          ...req.body,
          id,
          employee_id: req.body?.employee_id ?? existing.employeeId,
          work_date: req.body?.work_date ?? ymdFromDate(existing.workDate),
          days_worked: req.body?.days_worked ?? dec(existing.daysWorked),
          regular_hours: req.body?.regular_hours ?? dec(existing.regularHours),
          overtime_hours: req.body?.overtime_hours ?? dec(existing.overtimeHours),
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Timesheet not found" });
        return;
      }
      res.json({ success: true, data: mapTimesheet(row) });
    } catch (error) {
      const sc = (error as Error & { statusCode?: number }).statusCode;
      if (sc) {
        res.status(sc).json({ success: false, error: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

constructionPayrollRouter.delete(
  "/api/construction-payroll/timesheets/:id",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollTimesheet.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.payrollTimesheet.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Timesheet not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

// ---- Reports (simplified) ----------------------------------------------------

constructionPayrollRouter.get(
  "/api/construction-payroll/reports/employee-earnings",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const from = parseYmd(String(req.query.from || ""));
      const to = parseYmd(String(req.query.to || ""));
      if (!from || !to) {
        res.status(400).json({ success: false, error: "from e to obrigatórios (AAAA-MM-DD)" });
        return;
      }
      const rows = await withTenantTransaction(req.organizationId!, async (tx) => {
        const sheets = await tx.payrollTimesheet.findMany({
          where: { workDate: { gte: from, lte: to } },
          include: { employee: true },
        });
        const map = new Map<
          string,
          {
            employee_id: string;
            name: string;
            sector: string | null;
            total_days: number;
            total_regular_hours: number;
            total_overtime_hours: number;
            total_amount: number;
          }
        >();
        for (const t of sheets) {
          let a = map.get(t.employeeId);
          if (!a) {
            a = {
              employee_id: t.employeeId,
              name: t.employee.name,
              sector: t.employee.sector,
              total_days: 0,
              total_regular_hours: 0,
              total_overtime_hours: 0,
              total_amount: 0,
            };
            map.set(t.employeeId, a);
          }
          a.total_days += dec(t.daysWorked);
          a.total_regular_hours += dec(t.regularHours);
          a.total_overtime_hours += dec(t.overtimeHours);
          a.total_amount += dec(t.calculatedAmount);
        }
        return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
      });
      res.json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.get(
  "/api/construction-payroll/reports/project-labor",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const from = parseYmd(String(req.query.from || ""));
      const to = parseYmd(String(req.query.to || ""));
      if (!from || !to) {
        res.status(400).json({ success: false, error: "from e to obrigatórios" });
        return;
      }
      const rows = await withTenantTransaction(req.organizationId!, async (tx) => {
        const sheets = await tx.payrollTimesheet.findMany({
          where: { workDate: { gte: from, lte: to }, projectId: { not: null } },
          include: { project: { select: { name: true, number: true } } },
        });
        const map = new Map<string, { project_id: string; project_name: string; total_amount: number }>();
        for (const t of sheets) {
          const pid = t.projectId!;
          let a = map.get(pid);
          if (!a) {
            a = { project_id: pid, project_name: t.project?.name || pid, total_amount: 0 };
            map.set(pid, a);
          }
          a.total_amount += dec(t.calculatedAmount);
        }
        return [...map.values()];
      });
      res.json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  },
);

constructionPayrollRouter.get(
  "/api/construction-payroll/reports/total-expenses",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const from = parseYmd(String(req.query.from || ""));
      const to = parseYmd(String(req.query.to || ""));
      if (!from || !to) {
        res.status(400).json({ success: false, error: "from e to obrigatórios" });
        return;
      }
      const total = await withTenantTransaction(req.organizationId!, async (tx) => {
        const agg = await tx.payrollTimesheet.aggregate({
          where: { workDate: { gte: from, lte: to } },
          _sum: { calculatedAmount: true },
        });
        return dec(agg._sum.calculatedAmount);
      });
      res.json({ success: true, data: { total, from: ymdFromDate(from), to: ymdFromDate(to) } });
    } catch (error) {
      next(error);
    }
  },
);

/** Soft stubs for slip ZIP/email — preview data is enough for share-as-image in the UI */
constructionPayrollRouter.post(
  "/api/construction-payroll/periods/:periodId/slips/email",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (_req, res) => {
    res.status(501).json({
      success: false,
      error: "Envio de recibos por e-mail ainda não está disponível nesta versão SaaS. Use Compartilhar (imagem).",
    });
  },
);

constructionPayrollRouter.get(
  "/api/construction-payroll/periods/:periodId/individual-reports.pdf",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (_req, res) => {
    res.status(501).json({
      success: false,
      error: "PDF de relatórios individuais ainda não está disponível nesta versão. Use a pré-visualização e Compartilhar.",
    });
  },
);

constructionPayrollRouter.post(
  "/api/construction-payroll/periods/:periodId/individual-reports.pdf",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (_req, res) => {
    res.status(501).json({
      success: false,
      error: "PDF de relatórios individuais ainda não está disponível nesta versão. Use a pré-visualização e Compartilhar.",
    });
  },
);
