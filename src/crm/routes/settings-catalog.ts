/**
 * Configurações — cargos are on /api/roles; this router manages
 * service categories and units (OrgCatalogItem).
 *
 *   GET    /api/settings/catalog/:kind          settings.manage | quotes.view
 *   POST   /api/settings/catalog/:kind          settings.manage
 *   PUT    /api/settings/catalog/:kind/:id      settings.manage
 *   DELETE /api/settings/catalog/:kind/:id      settings.manage
 *
 * kind = service_category | unit | customer_type | payroll_payment_method
 */
import { Router } from "express";
import { z } from "zod";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import {
  DEFAULT_PAYROLL_PAYMENT_METHODS,
  PAYROLL_PAYMENT_METHOD_KIND,
} from "../../lib/settings/payroll-payment-methods.js";

export const settingsCatalogRouter = Router();

const KINDS = new Set(["service_category", "unit", "customer_type", PAYROLL_PAYMENT_METHOD_KIND]);

const DEFAULTS: Record<string, Array<{ key: string; label: string; description?: string; sortOrder: number }>> = {
  service_category: [
    { key: "supply", label: "Supply", description: "Materiais e fornecimento", sortOrder: 10 },
    { key: "installation", label: "Installation", description: "Instalação", sortOrder: 20 },
    { key: "sand_finish", label: "Sand & Finishing", description: "Lixamento e acabamento", sortOrder: 30 },
    { key: "general", label: "General", description: "Geral / outros", sortOrder: 40 },
  ],
  unit: [
    { key: "sq_ft", label: "sq ft", description: "Pé quadrado", sortOrder: 10 },
    { key: "linear_ft", label: "linear ft", description: "Pé linear", sortOrder: 20 },
    { key: "inches", label: "inches", description: "Polegadas", sortOrder: 30 },
    { key: "fixed", label: "fixed", description: "Valor fixo / lump sum", sortOrder: 40 },
    { key: "box", label: "box", description: "Caixa", sortOrder: 50 },
    { key: "piece", label: "piece", description: "Peça / unidade", sortOrder: 60 },
  ],
  customer_type: [
    { key: "particular", label: "Particular", description: "Cliente final / residencial", sortOrder: 10 },
    { key: "builder", label: "Builder", description: "Builders e contractors (cadastro unificado)", sortOrder: 20 },
    { key: "loja", label: "Loja", description: "Loja / retail partner", sortOrder: 30 },
  ],
  [PAYROLL_PAYMENT_METHOD_KIND]: DEFAULT_PAYROLL_PAYMENT_METHODS.map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description,
    sortOrder: m.sortOrder,
  })),
};

function slugify(raw: string): string {
  return (
    String(raw || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "item"
  );
}

function parseKind(raw: string | string[] | undefined): string | null {
  const k = String(Array.isArray(raw) ? raw[0] || "" : raw || "")
    .trim()
    .toLowerCase();
  return KINDS.has(k) ? k : null;
}

function paramStr(raw: string | string[] | undefined): string {
  return String(Array.isArray(raw) ? raw[0] || "" : raw || "");
}

function serialize(row: {
  id: string;
  kind: string;
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
}) {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    label: row.label,
    description: row.description,
    sort_order: row.sortOrder,
    active: row.active,
    is_system: row.isSystem,
  };
}

async function ensureDefaults(tx: any, organizationId: string, kind: string) {
  const count = await tx.orgCatalogItem.count({ where: { kind } });
  if (count > 0) return;
  const seeds = DEFAULTS[kind] || [];
  for (const s of seeds) {
    await tx.orgCatalogItem.create({
      data: {
        organizationId,
        kind,
        key: s.key,
        label: s.label,
        description: s.description || null,
        sortOrder: s.sortOrder,
        active: true,
        isSystem: true,
      },
    });
  }
}

const itemSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case")
    .optional(),
  label: z.string().min(1).max(80),
  description: z.string().max(255).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

settingsCatalogRouter.get(
  "/api/settings/catalog/:kind",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        res.status(400).json({ success: false, error: "Tipo inválido" });
        return;
      }
      const isAdmin = req.user?.roleKey === "admin";
      const perms = req.user?.permissions || [];
      const allowed =
        isAdmin ||
        perms.includes("settings.manage") ||
        perms.includes("quotes.view") ||
        perms.includes("quotes.edit") ||
        perms.includes("customers.view") ||
        perms.includes("payroll.view") ||
        perms.includes("payroll.manage");
      if (!allowed) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }

      const rows = await withTenantTransaction(req.organizationId!, async (tx) => {
        await ensureDefaults(tx, req.organizationId!, kind);
        return tx.orgCatalogItem.findMany({
          where: { kind },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      });
      res.json({ success: true, data: rows.map(serialize) });
    } catch (error) {
      next(error);
    }
  },
);

settingsCatalogRouter.post(
  "/api/settings/catalog/:kind",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        res.status(400).json({ success: false, error: "Tipo inválido" });
        return;
      }
      const parsed = itemSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Dados inválidos", details: parsed.error.flatten() });
        return;
      }
      let key = parsed.data.key || slugify(parsed.data.label);
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        res.status(400).json({ success: false, error: "Chave inválida (use a-z, 0-9, _)" });
        return;
      }
      // Contractor was consolidated into Builder — do not recreate as a separate type.
      if (kind === "customer_type" && key === "contractor") {
        res.status(400).json({
          success: false,
          error: "Use o tipo Builder (Contractor foi unificado no cadastro).",
        });
        return;
      }

      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        await ensureDefaults(tx, req.organizationId!, kind);
        const existing = await tx.orgCatalogItem.findFirst({ where: { kind, key } });
        if (existing) throw new Error("KEY_EXISTS");
        const maxSort = await tx.orgCatalogItem.aggregate({
          where: { kind },
          _max: { sortOrder: true },
        });
        return tx.orgCatalogItem.create({
          data: {
            organizationId: req.organizationId!,
            kind,
            key,
            label: parsed.data.label.trim(),
            description: parsed.data.description || null,
            sortOrder: parsed.data.sort_order ?? (maxSort._max.sortOrder || 0) + 10,
            active: parsed.data.active !== false,
            isSystem: false,
          },
        });
      });
      res.status(201).json({ success: true, data: serialize(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "KEY_EXISTS") {
        res.status(409).json({ success: false, error: "Já existe um item com esta chave" });
        return;
      }
      next(error);
    }
  },
);

settingsCatalogRouter.put(
  "/api/settings/catalog/:kind/:id",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        res.status(400).json({ success: false, error: "Tipo inválido" });
        return;
      }
      const parsed = itemSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Dados inválidos", details: parsed.error.flatten() });
        return;
      }

      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const current = await tx.orgCatalogItem.findFirst({ where: { id: paramStr(req.params.id), kind } });
        if (!current) throw new Error("NOT_FOUND");

        let key = current.key;
        if (parsed.data.key && parsed.data.key !== current.key) {
          if (current.isSystem) throw new Error("SYSTEM_KEY");
          key = parsed.data.key;
          const clash = await tx.orgCatalogItem.findFirst({
            where: { kind, key, NOT: { id: current.id } },
          });
          if (clash) throw new Error("KEY_EXISTS");
        }

        return tx.orgCatalogItem.update({
          where: { id: current.id },
          data: {
            key,
            label: parsed.data.label.trim(),
            description: parsed.data.description === undefined ? current.description : parsed.data.description || null,
            sortOrder: parsed.data.sort_order ?? current.sortOrder,
            active: parsed.data.active === undefined ? current.active : parsed.data.active,
          },
        });
      });
      res.json({ success: true, data: serialize(row) });
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_FOUND") {
        res.status(404).json({ success: false, error: "Item não encontrado" });
        return;
      }
      if (error instanceof Error && error.message === "KEY_EXISTS") {
        res.status(409).json({ success: false, error: "Já existe um item com esta chave" });
        return;
      }
      if (error instanceof Error && error.message === "SYSTEM_KEY") {
        res.status(400).json({ success: false, error: "Não é possível alterar a chave de um item padrão" });
        return;
      }
      next(error);
    }
  },
);

settingsCatalogRouter.delete(
  "/api/settings/catalog/:kind/:id",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        res.status(400).json({ success: false, error: "Tipo inválido" });
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const current = await tx.orgCatalogItem.findFirst({ where: { id: paramStr(req.params.id), kind } });
        if (!current) throw new Error("NOT_FOUND");
        if (current.isSystem) {
          // Soft-deactivate system defaults instead of hard delete
          await tx.orgCatalogItem.update({
            where: { id: current.id },
            data: { active: false },
          });
          return;
        }
        await tx.orgCatalogItem.delete({ where: { id: current.id } });
      });
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_FOUND") {
        res.status(404).json({ success: false, error: "Item não encontrado" });
        return;
      }
      next(error);
    }
  },
);
