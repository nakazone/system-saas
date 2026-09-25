import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { hashPassword } from "../../lib/auth/password.js";
import { prisma } from "../../lib/prisma.js";
import { buildBrandPalette } from "../../lib/branding/palette.js";
import { requireCrmAuth, requireCrmPermission, dec } from "../http.js";

export const cadastroPayrollUsersRouter = Router();

function mapUser(u: {
  id: string;
  name: string;
  email: string;
  status: string;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  role?: { key: string; name: string } | null;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role?.key ?? "staff",
    role_name: u.role?.name ?? null,
    is_active: u.status === "active" ? 1 : 0,
    active: u.status === "active" ? 1 : 0,
    must_change_password: u.mustChangePassword,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
  };
}

function mapEmployee(e: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  payType: string;
  hourlyRate: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  userId?: string | null;
}) {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    phone: e.phone,
    role_title: e.roleTitle,
    payment_type: e.payType,
    pay_type: e.payType,
    hourly_rate: dec(e.hourlyRate),
    status: e.status,
    user_id: e.userId ?? null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

function mapHourBank(row: {
  id: string;
  employeeId: string;
  workDate: Date;
  hours: unknown;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    employee_id: row.employeeId,
    work_date: row.workDate,
    hours: dec(row.hours),
    notes: row.notes,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ---- Cadastro / ERP materials ------------------------------------------------

cadastroPayrollUsersRouter.get(
  "/api/erp/suppliers",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.supplier.findMany({ orderBy: { name: "asc" } }),
      );
      res.json({
        success: true,
        data: rows.map((s) => ({
          id: s.id,
          name: s.name,
          contact_name: s.contactName,
          phone: s.phone,
          email: s.email,
          address: s.address,
          notes: s.notes,
          active: s.active ? 1 : 0,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.post(
  "/api/erp/suppliers",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.supplier.create({
          data: {
            organizationId: req.organizationId!,
            name: String(b.name || "Supplier"),
            contactName: b.contact_name || null,
            phone: b.phone || null,
            email: b.email || null,
            address: b.address || null,
            notes: b.notes || null,
          },
        }),
      );
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.put(
  "/api/erp/suppliers/:id",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.supplier.findFirst({ where: { id } });
        if (!existing) return null;
        return tx.supplier.update({
          where: { id },
          data: {
            name: b.name !== undefined ? String(b.name) : undefined,
            contactName: b.contact_name !== undefined ? b.contact_name : undefined,
            phone: b.phone !== undefined ? b.phone : undefined,
            email: b.email !== undefined ? b.email : undefined,
            address: b.address !== undefined ? b.address : undefined,
            notes: b.notes !== undefined ? b.notes : undefined,
            active: b.active !== undefined ? Boolean(b.active) : undefined,
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Supplier not found" });
        return;
      }
      res.json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.delete(
  "/api/erp/suppliers/:id",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.supplier.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.supplier.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Supplier not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
  "/api/erp/products",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.product.findMany({
          orderBy: { name: "asc" },
          include: { supplier: { select: { name: true } } },
        }),
      );
      res.json({
        success: true,
        data: rows.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          unit_type: p.unitType,
          cost_price: dec(p.costPrice),
          sku: p.sku,
          description: p.description,
          stock_qty: p.stockQty,
          supplier_id: p.supplierId,
          supplier_name: p.supplier?.name ?? null,
          active: p.active ? 1 : 0,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.post(
  "/api/erp/products",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.product.create({
          data: {
            organizationId: req.organizationId!,
            name: String(b.name || "Product"),
            category: String(b.category || "Hardwood"),
            unitType: String(b.unit_type || "sq_ft"),
            costPrice: new Prisma.Decimal(Number(b.cost_price) || 0),
            sku: b.sku || null,
            description: b.description || null,
            stockQty: b.stock_qty != null ? Number(b.stock_qty) : null,
            supplierId: b.supplier_id || null,
          },
        }),
      );
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.put(
  "/api/erp/products/:id",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.product.findFirst({ where: { id } });
        if (!existing) return null;
        return tx.product.update({
          where: { id },
          data: {
            name: b.name !== undefined ? String(b.name) : undefined,
            category: b.category !== undefined ? String(b.category) : undefined,
            unitType: b.unit_type !== undefined ? String(b.unit_type) : undefined,
            costPrice: b.cost_price !== undefined ? new Prisma.Decimal(Number(b.cost_price) || 0) : undefined,
            sku: b.sku !== undefined ? b.sku : undefined,
            description: b.description !== undefined ? b.description : undefined,
            stockQty: b.stock_qty !== undefined ? (b.stock_qty == null ? null : Number(b.stock_qty)) : undefined,
            supplierId: b.supplier_id !== undefined ? b.supplier_id || null : undefined,
            active: b.active !== undefined ? Boolean(b.active) : undefined,
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Product not found" });
        return;
      }
      res.json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.delete(
  "/api/erp/products/:id",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.product.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.product.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Product not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
  "/api/erp/category-margins",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.categoryMargin.findMany({ orderBy: { category: "asc" } }),
      );
      res.json({
        success: true,
        data: rows.map((r) => ({
          id: r.id,
          category: r.category,
          margin_percentage: dec(r.marginPercentage),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.put(
  "/api/erp/category-margins",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const category = String(req.body?.category || "").trim();
      const margin = Number(req.body?.margin_percentage);
      if (!category || !Number.isFinite(margin)) {
        res.status(400).json({ success: false, error: "category and margin_percentage required" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.categoryMargin.findFirst({ where: { category } });
        if (existing) {
          return tx.categoryMargin.update({
            where: { id: existing.id },
            data: { marginPercentage: new Prisma.Decimal(margin) },
          });
        }
        return tx.categoryMargin.create({
          data: {
            organizationId: req.organizationId!,
            category,
            marginPercentage: new Prisma.Decimal(margin),
          },
        });
      });
      res.json({
        success: true,
        data: { id: row.id, category: row.category, margin_percentage: dec(row.marginPercentage) },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---- Construction payroll ----------------------------------------------------

cadastroPayrollUsersRouter.get(
  "/api/construction-payroll/employees",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollEmployee.findMany({ orderBy: { name: "asc" } }),
      );
      res.json({ success: true, data: rows.map(mapEmployee) });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
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

cadastroPayrollUsersRouter.post(
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
        return tx.payrollEmployee.create({
          data: {
            organizationId: req.organizationId!,
            name: String(b.name || "Employee"),
            email,
            phone: b.phone || null,
            roleTitle: b.role_title || b.roleTitle || null,
            payType: String(b.payment_type || b.pay_type || "hourly"),
            hourlyRate: new Prisma.Decimal(Number(b.hourly_rate) || 0),
            status: String(b.status || "active"),
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

cadastroPayrollUsersRouter.put(
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
        return tx.payrollEmployee.update({
          where: { id },
          data: {
            name: b.name !== undefined ? String(b.name) : undefined,
            email: b.email !== undefined ? b.email : undefined,
            phone: b.phone !== undefined ? b.phone : undefined,
            roleTitle: b.role_title !== undefined ? b.role_title : undefined,
            payType: b.payment_type !== undefined ? String(b.payment_type) : undefined,
            hourlyRate: b.hourly_rate !== undefined ? new Prisma.Decimal(Number(b.hourly_rate) || 0) : undefined,
            status: b.status !== undefined ? String(b.status) : undefined,
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

type PayrollTx = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

/** If email matches a CRM user and that user is not already linked, return userId. */
async function findLinkableUserId(
  tx: PayrollTx,
  organizationId: string,
  email: string | null | undefined,
  exceptEmployeeId?: string,
): Promise<string | null> {
  const em = email ? String(email).trim().toLowerCase() : "";
  if (!em) return null;
  const user = await tx.user.findFirst({
    where: { organizationId, email: { equals: em, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) return null;
  const taken = await tx.payrollEmployee.findFirst({
    where: {
      userId: user.id,
      ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}),
    },
    select: { id: true },
  });
  return taken ? null : user.id;
}

/** Resolve PayrollEmployee for the logged-in user (by userId, or claim by matching email). */
async function resolveOwnEmployee(
  tx: PayrollTx,
  userId: string,
  email: string | undefined | null,
) {
  let emp = await tx.payrollEmployee.findFirst({ where: { userId } });
  if (emp) return emp;
  const em = email ? String(email).trim().toLowerCase() : "";
  if (!em) return null;
  emp = await tx.payrollEmployee.findFirst({
    where: { email: { equals: em, mode: "insensitive" }, userId: null },
  });
  if (!emp) return null;
  return tx.payrollEmployee.update({
    where: { id: emp.id },
    data: { userId },
  });
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

cadastroPayrollUsersRouter.get(
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
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
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
        res.json({ success: true, linked: false, data: [], employee: null });
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

cadastroPayrollUsersRouter.post(
  "/api/construction-payroll/me/hour-bank",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canAccessPayrollSelf(req)) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["payroll.self"] });
        return;
      }
      const b = req.body || {};
      const hours = Number(b.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
        res.status(400).json({ success: false, error: "Informe horas válidas (entre 0 e 24)" });
        return;
      }
      if (!b.work_date && !b.workDate) {
        res.status(400).json({ success: false, error: "work_date is required" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const emp = await resolveOwnEmployee(tx, req.user!.id, req.user!.email);
        if (!emp) return null;
        if (emp.status !== "active") throw new Error("EMP_INACTIVE");
        return tx.payrollHourBankEntry.create({
          data: {
            organizationId: req.organizationId!,
            employeeId: emp.id,
            workDate: new Date(b.work_date || b.workDate),
            hours: new Prisma.Decimal(hours),
            notes: b.notes ? String(b.notes).slice(0, 500) : null,
            status: "pending",
          },
        });
      });
      if (!row) {
        res.status(404).json({
          success: false,
          error: "A sua conta ainda não está associada a um funcionário. Peça ao gestor da folha para vincular o email.",
        });
        return;
      }
      res.status(201).json({ success: true, data: mapHourBank(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "EMP_INACTIVE") {
        res.status(400).json({ success: false, error: "Funcionário inativo" });
        return;
      }
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.put(
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
        if (!existing) return false;
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
            workDate: b.work_date || b.workDate ? new Date(b.work_date || b.workDate) : undefined,
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

cadastroPayrollUsersRouter.delete(
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

cadastroPayrollUsersRouter.get(
  "/api/construction-payroll/periods",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollPeriod.findMany({ orderBy: { startDate: "desc" } }),
      );
      res.json({
        success: true,
        data: rows.map((p) => ({
          id: p.id,
          label: p.label,
          start_date: p.startDate,
          end_date: p.endDate,
          status: p.status,
          created_at: p.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.post(
  "/api/construction-payroll/periods",
  requireCrmAuth,
  requireCrmPermission("payroll.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      if (!b.start_date || !b.end_date) {
        res.status(400).json({ success: false, error: "start_date and end_date required" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollPeriod.create({
          data: {
            organizationId: req.organizationId!,
            label: String(b.label || "Payroll period"),
            startDate: new Date(b.start_date),
            endDate: new Date(b.end_date),
            status: String(b.status || "open"),
          },
        }),
      );
      res.status(201).json({
        success: true,
        data: {
          id: row.id,
          label: row.label,
          start_date: row.startDate,
          end_date: row.endDate,
          status: row.status,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
  "/api/construction-payroll/periods/:periodId/timesheets",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const periodId = String(req.params.periodId);
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.payrollTimesheet.findMany({
          where: { periodId },
          orderBy: { workDate: "asc" },
          include: {
            employee: { select: { name: true, hourlyRate: true, payType: true } },
            project: { select: { name: true } },
          },
        }),
      );
      res.json({
        success: true,
        data: rows.map((t) => ({
          id: t.id,
          period_id: t.periodId,
          employee_id: t.employeeId,
          employee_name: t.employee.name,
          project_id: t.projectId,
          project_name: t.project?.name ?? null,
          work_date: t.workDate,
          hours: dec(t.hours),
          notes: t.notes,
          hourly_rate: dec(t.employee.hourlyRate),
          payment_type: t.employee.payType,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.post(
  "/api/construction-payroll/periods/:periodId/timesheets",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const periodId = String(req.params.periodId);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const period = await tx.payrollPeriod.findFirst({ where: { id: periodId } });
        if (!period) return null;
        return tx.payrollTimesheet.create({
          data: {
            organizationId: req.organizationId!,
            periodId,
            employeeId: String(b.employee_id),
            projectId: b.project_id || null,
            workDate: new Date(b.work_date || Date.now()),
            hours: new Prisma.Decimal(Number(b.hours) || 0),
            notes: b.notes || null,
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Period not found" });
        return;
      }
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.put(
  "/api/construction-payroll/timesheets/:id",
  requireCrmAuth,
  requireCrmPermission("payroll.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.payrollTimesheet.findFirst({ where: { id } });
        if (!existing) return null;
        return tx.payrollTimesheet.update({
          where: { id },
          data: {
            hours: b.hours !== undefined ? new Prisma.Decimal(Number(b.hours) || 0) : undefined,
            notes: b.notes !== undefined ? b.notes : undefined,
            projectId: b.project_id !== undefined ? b.project_id || null : undefined,
            workDate: b.work_date !== undefined ? new Date(b.work_date) : undefined,
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Timesheet not found" });
        return;
      }
      res.json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.delete(
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

/** Legacy simple payroll list used by financial-engine.js */
cadastroPayrollUsersRouter.get("/api/payroll", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.payrollTimesheet.findMany({
        take: limit,
        orderBy: { workDate: "desc" },
        include: { employee: true, period: true },
      }),
    );
    res.json({
      success: true,
      data: rows.map((t) => ({
        id: t.id,
        employee_name: t.employee.name,
        period_label: t.period.label,
        work_date: t.workDate,
        hours: dec(t.hours),
        amount: Math.round(dec(t.hours) * dec(t.employee.hourlyRate) * 100) / 100,
        status: t.period.status,
        approved: t.period.status === "closed" ? 1 : 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ---- Users -------------------------------------------------------------------

cadastroPayrollUsersRouter.get(
  "/api/users",
  requireCrmAuth,
  requireCrmPermission("users.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const skip = (page - 1) * limit;
      const [total, rows] = await withTenantTransaction(req.organizationId!, async (tx) => {
        const where: Prisma.UserWhereInput = {};
        if (req.query.active === "true") where.status = "active";
        if (req.query.active === "false") where.status = { not: "active" };
        return [
          await tx.user.count({ where }),
          await tx.user.findMany({
            where,
            orderBy: { createdAt: "asc" },
            skip,
            take: limit,
            include: { role: true },
          }),
        ] as const;
      });
      res.json({ success: true, data: rows.map(mapUser), total, page, limit });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
  "/api/users/:id",
  requireCrmAuth,
  requireCrmPermission("users.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.user.findFirst({ where: { id: String(req.params.id) }, include: { role: true } }),
      );
      if (!row) {
        res.status(404).json({ success: false, error: "User not found" });
        return;
      }
      res.json({ success: true, data: mapUser(row) });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
  "/api/users/:id/permissions",
  requireCrmAuth,
  requireCrmPermission("users.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: String(req.params.id) },
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
            permissions: { include: { permission: true } },
          },
        });
        if (!user) return null;
        const keys = new Set(user.role?.permissions.map((rp) => rp.permission.key) ?? []);
        for (const up of user.permissions) {
          if (up.granted) keys.add(up.permission.key);
          else keys.delete(up.permission.key);
        }
        const all = await tx.permission.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
        const permissions = all
          .filter((p) => keys.has(p.key))
          .map((p) => ({
            permission_id: p.id,
            permission_key: p.key,
            permission_name: p.description || p.key,
            permission_group: p.group,
          }));
        return {
          permission_ids: permissions.map((p) => p.permission_id),
          permissions,
        };
      });
      if (!data) {
        res.status(404).json({ success: false, error: "User not found" });
        return;
      }
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.post(
  "/api/users",
  requireCrmAuth,
  requireCrmPermission("users.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({
          name: z.string().min(1),
          email: z.string().email(),
          password: z.string().min(8),
          role: z.string().optional(),
          role_id: z.string().uuid().optional(),
          is_active: z.union([z.boolean(), z.number()]).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid user payload" });
        return;
      }
      const passwordHash = await hashPassword(parsed.data.password);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.user.findFirst({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (existing) throw new Error("EMAIL_EXISTS");
        let roleId = parsed.data.role_id || null;
        if (!roleId) {
          const roleKey = parsed.data.role || "sales_rep";
          const role = await tx.role.findFirst({ where: { key: roleKey } });
          roleId = role?.id ?? null;
        }
        return tx.user.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            email: parsed.data.email.toLowerCase(),
            passwordHash,
            roleId,
            status: parsed.data.is_active === false || parsed.data.is_active === 0 ? "disabled" : "active",
            mustChangePassword: true,
          },
          include: { role: true },
        });
      });
      const permissionIds = Array.isArray((req.body || {}).permission_ids)
        ? (req.body.permission_ids as unknown[]).map((x) => String(x)).filter(Boolean)
        : [];
      if (permissionIds.length && row) {
        await withTenantTransaction(req.organizationId!, async (tx) => {
          const perms = await tx.permission.findMany({ where: { id: { in: permissionIds } } });
          for (const p of perms) {
            await tx.userPermission.create({
              data: { userId: row.id, permissionId: p.id, granted: true },
            });
          }
        });
      }
      res.status(201).json({ success: true, data: mapUser(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "EMAIL_EXISTS") {
        res.status(409).json({ success: false, error: "Email already exists" });
        return;
      }
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.put(
  "/api/users/:id",
  requireCrmAuth,
  requireCrmPermission("users.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.user.findFirst({ where: { id } });
        if (!existing) return null;
        let roleId: string | null | undefined = undefined;
        if (b.role_id !== undefined) roleId = b.role_id || null;
        else if (b.role !== undefined) {
          const role = await tx.role.findFirst({ where: { key: String(b.role) } });
          roleId = role?.id ?? existing.roleId;
        }
        let status: string | undefined;
        if (b.is_active !== undefined) {
          status = b.is_active === false || b.is_active === 0 || b.is_active === "0" ? "disabled" : "active";
        }
        const data: Prisma.UserUpdateInput = {
          name: b.name !== undefined ? String(b.name) : undefined,
          email: b.email !== undefined ? String(b.email).toLowerCase() : undefined,
          status,
        };
        if (roleId !== undefined) {
          data.role = roleId ? { connect: { id: roleId } } : { disconnect: true };
        }
        if (b.password) {
          data.passwordHash = await hashPassword(String(b.password));
          data.mustChangePassword = false;
        }
        return tx.user.update({ where: { id }, data, include: { role: true } });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "User not found" });
        return;
      }
      res.json({ success: true, message: "User updated", data: mapUser(row) });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.delete(
  "/api/users/:id",
  requireCrmAuth,
  requireCrmPermission("users.delete"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (id === req.user?.id) {
        res.status(400).json({ success: false, error: "Cannot deactivate yourself" });
        return;
      }
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.user.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.user.update({ where: { id }, data: { status: "disabled" } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "User not found" });
        return;
      }
      res.json({ success: true, message: "Utilizador desativado." });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.put(
  "/api/users/:id/permissions",
  requireCrmAuth,
  requireCrmPermission("users.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const rawIds = (req.body || {}).permission_ids;
      if (!Array.isArray(rawIds)) {
        res.status(400).json({ success: false, error: "permission_ids deve ser um array." });
        return;
      }
      const permissionIds = rawIds.map((x: unknown) => String(x)).filter(Boolean);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const user = await tx.user.findFirst({ where: { id } });
        if (!user) return false;
        await tx.userPermission.deleteMany({ where: { userId: id } });
        if (permissionIds.length) {
          const perms = await tx.permission.findMany({ where: { id: { in: permissionIds } } });
          for (const p of perms) {
            await tx.userPermission.create({
              data: { userId: id, permissionId: p.id, granted: true },
            });
          }
        }
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "User not found" });
        return;
      }
      res.json({ success: true, data: { permission_ids: permissionIds } });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
  "/api/permissions",
  requireCrmAuth,
  requireCrmPermission("users.view"),
  async (_req: AuthedRequest, res, next) => {
    try {
      const rows = await prisma.permission.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
      const data = rows.map((p) => ({
        id: p.id,
        permission_key: p.key,
        permission_name: p.description || p.key,
        permission_group: p.group,
        description: p.description,
      }));
      const by_group: Record<string, typeof data> = {};
      for (const row of data) {
        const g = row.permission_group || "other";
        if (!by_group[g]) by_group[g] = [];
        by_group[g].push(row);
      }
      res.json({ success: true, data, by_group });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.get(
  "/api/roles",
  requireCrmAuth,
  requireCrmPermission("users.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.role.findMany({
          orderBy: [{ isSystem: "desc" }, { name: "asc" }],
          include: {
            permissions: { include: { permission: true } },
            _count: { select: { users: true } },
          },
        }),
      );
      res.json({
        success: true,
        data: rows.map((r) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          description: r.description,
          is_system: r.isSystem,
          user_count: r._count.users,
          permission_keys: r.permissions.map((rp) => rp.permission.key),
          permission_ids: r.permissions.map((rp) => rp.permissionId),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

cadastroPayrollUsersRouter.post(
  "/api/roles",
  requireCrmAuth,
  requireCrmPermission("roles.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        key: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case")
          .optional(),
        name: z.string().min(2).max(80),
        description: z.string().max(255).optional().nullable(),
        permission_ids: z.array(z.string()).optional(),
        permission_keys: z.array(z.string()).optional(),
      });
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Dados do cargo inválidos", details: parsed.error.flatten() });
        return;
      }
      const slugify = (name: string) =>
        name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40) || "cargo";
      let key = parsed.data.key || slugify(parsed.data.name);
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        res.status(400).json({ success: false, error: "Chave do cargo inválida (use a-z, 0-9, _)" });
        return;
      }

      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.role.findFirst({ where: { key } });
        if (existing) throw new Error("KEY_EXISTS");
        const role = await tx.role.create({
          data: {
            organizationId: req.organizationId!,
            key,
            name: parsed.data.name,
            description: parsed.data.description || null,
            isSystem: false,
          },
        });
        let permIds = parsed.data.permission_ids || [];
        if ((!permIds.length) && parsed.data.permission_keys?.length) {
          const found = await tx.permission.findMany({
            where: { key: { in: parsed.data.permission_keys } },
          });
          permIds = found.map((p) => p.id);
        }
        if (permIds.length) {
          const perms = await tx.permission.findMany({ where: { id: { in: permIds } } });
          for (const p of perms) {
            await tx.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
          }
        }
        return role;
      });
      res.status(201).json({
        success: true,
        data: {
          id: row.id,
          key: row.key,
          name: row.name,
          description: row.description,
          is_system: row.isSystem,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "KEY_EXISTS") {
        res.status(409).json({ success: false, error: "Já existe um cargo com esta chave" });
        return;
      }
      next(error);
    }
  },
);

/** UI config stub so SF chrome boots */
cadastroPayrollUsersRouter.get("/api/config/ui", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
      select: { name: true, logoUrl: true, primaryColor: true, accentColor: true },
    });
    const brand = org
      ? buildBrandPalette({
          name: org.name,
          logoUrl: org.logoUrl,
          primaryColor: org.primaryColor,
          accentColor: org.accentColor,
        })
      : null;

    const mapsKey =
      process.env.GOOGLE_MAPS_JS_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_JS_KEY ||
      process.env.Google_Maps_JS_Key ||
      process.env.GOOGLE_MAPS_KEY ||
      null;
    const key = mapsKey && String(mapsKey).trim() ? String(mapsKey).trim() : null;
    let googleMapsUsable = false;
    if (key) {
      try {
        const url =
          "https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Austin&key=" +
          encodeURIComponent(key);
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 4000);
        const r = await fetch(url, { signal: ac.signal });
        clearTimeout(t);
        const j = (await r.json().catch(() => ({}))) as { status?: string };
        googleMapsUsable = j.status === "OK" || j.status === "ZERO_RESULTS";
      } catch {
        googleMapsUsable = false;
      }
    }

    res.json({
      success: true,
      data: {
        brand_name: brand?.name || "Workspace",
        branding: brand,
        googleMapsJsKey: googleMapsUsable ? key : null,
        googleMapsConfigured: Boolean(key),
        googleMapsUsable,
        modules: {
          dashboard: true,
          leads: true,
          quotes: true,
          invoice: true,
          cadastro: true,
          builders: true,
          pricing: true,
          payroll: true,
          users: true,
          ajustes: true,
          marketing: false,
          schedule: false,
          projects: false,
          builder_forecast: false,
          builder_portal: false,
          gallery: false,
          messages: false,
          financial: false,
          activities: false,
        },
        disabled_pages: [
          "marketing",
          "schedule",
          "projects",
          "activities",
          "financeiro",
        ],
      },
    });
  } catch (error) {
    next(error);
  }
});
