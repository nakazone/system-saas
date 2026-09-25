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
