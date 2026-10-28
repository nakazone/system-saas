import { Router } from "express";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { mirrorNickname } from "../../lib/builders/nickname-sync.js";
import { requireCrmAuth, requireCrmPermission, dec, asSnakeBuilder } from "../http.js";
import { hashPassword } from "../../lib/auth/password.js";
import { formatPersonName } from "../../lib/name.js";
import {
  DEFAULT_PRICING_SERVICES,
  seedDefaultPricingServices,
} from "../../lib/pricing/default-services.js";

export const buildersPricingRouter = Router();

const VOLUME_DISCOUNTS = [
  { min_sqft: 0, max_sqft: 999, discount_pct: 0 },
  { min_sqft: 1000, max_sqft: 2499, discount_pct: 8 },
  { min_sqft: 2500, max_sqft: 4999, discount_pct: 12 },
  { min_sqft: 5000, max_sqft: null, discount_pct: 15 },
];

const CATEGORY_LABELS: Record<string, string> = {
  supply: "Supply",
  installation: "Installation",
  sand_finish: "Sand & Finish",
  custom: "Custom",
};

function mapPricing(row: {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: unknown;
  priceMin: unknown;
  priceMax: unknown;
  partnerPrice: unknown;
  priceParticular?: unknown;
  priceBuilder?: unknown;
  priceContractor?: unknown;
  priceLoja?: unknown;
  notes: string | null;
  description: string | null;
  isVisible: boolean;
  isLocked: boolean;
  sortOrder: number;
  active: boolean;
}) {
  const priceParticular = dec(row.priceParticular) || dec(row.priceMax) || dec(row.priceMin) || dec(row.price);
  const priceBuilder =
    dec(row.priceBuilder) ||
    (row.partnerPrice != null ? dec(row.partnerPrice) : 0) ||
    dec(row.priceMin) ||
    0;
  const priceContractor = dec(row.priceContractor) || priceBuilder;
  const priceLoja = dec(row.priceLoja) || dec(row.priceMin) || dec(row.price) || 0;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    category_label: CATEGORY_LABELS[row.category] || row.category,
    unit: row.unit,
    price: dec(row.price),
    price_min: dec(row.priceMin),
    price_max: dec(row.priceMax),
    partner_price: row.partnerPrice != null ? dec(row.partnerPrice) : null,
    price_particular: priceParticular,
    price_builder: priceBuilder,
    price_contractor: priceContractor,
    price_loja: priceLoja,
    notes: row.notes || row.description,
    description: row.description || row.notes || null,
    is_visible: row.isVisible ? 1 : 0,
    is_locked: row.isLocked ? 1 : 0,
    sort_order: row.sortOrder,
    active: row.active ? 1 : 0,
  };
}

function parseOptionalMoney(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function syncLegacyFromTyped(rates: {
  particular: number;
  builder: number;
  contractor: number;
  loja: number;
}) {
  return {
    priceMin: new Prisma.Decimal(rates.loja),
    priceMax: new Prisma.Decimal(rates.particular),
    partnerPrice: new Prisma.Decimal(rates.builder),
    price: new Prisma.Decimal(rates.loja || rates.particular || rates.builder || 0),
  };
}

buildersPricingRouter.get(
  "/api/builders",
  requireCrmAuth,
  requireCrmPermission("builders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      const type = req.query.type ? String(req.query.type) : null;
      const search = String(req.query.search || "").trim();
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const where: Prisma.BuilderWhereInput = {};
        if (status) where.status = status;
        if (type) where.type = type;
        if (search) {
          where.OR = [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { company: { contains: search, mode: "insensitive" } },
          ];
        }
        const [total, rows, active, pending, openProjects] = await Promise.all([
          tx.builder.count({ where }),
          tx.builder.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
            include: {
              partnerUsers: {
                select: { id: true, email: true, name: true, status: true, lastLoginAt: true },
                orderBy: { createdAt: "asc" },
              },
              _count: { select: { projects: true, workOrders: true } },
            },
          }),
          tx.builder.count({ where: { status: "active" } }),
          tx.builder.count({ where: { status: "pending" } }),
          tx.project.count({
            where: { status: { notIn: ["completed", "cancelled", "closed"] }, deletedAt: null },
          }),
        ]);
        return { total, rows, active, pending, openProjects };
      });

      res.json({
        success: true,
        data: result.rows.map((r) => ({
          ...asSnakeBuilder(r),
          project_count: r._count.projects + r._count.workOrders,
          regions: [],
          partner_users: r.partnerUsers.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            status: u.status,
            last_login: u.lastLoginAt,
          })),
          portal_access: r.status !== "inactive" && r.partnerUsers.some((u) => u.status === "active"),
          last_login: r.partnerUsers.reduce<Date | null>((latest, u) =>
            u.lastLoginAt && (!latest || u.lastLoginAt > latest) ? u.lastLoginAt : latest, null),
        })),
        total: result.total,
        stats: {
          active: result.active,
          pending: result.pending,
          open_projects: result.openProjects,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.get(
  "/api/builders/select",
  requireCrmAuth,
  requireCrmPermission("builders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.builder.findMany({
          where: { status: "active" },
          orderBy: { firstName: "asc" },
          take: 200,
        }),
      );
      res.json({
        success: true,
        data: rows.map((b) => ({
          id: b.id,
          name: asSnakeBuilder(b).full_name,
          company: b.company,
          email: b.email,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.get(
  "/api/builders/:id",
  requireCrmAuth,
  requireCrmPermission("builders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.builder.findFirst({
          where: { id: String(req.params.id) },
          include: { partnerUsers: { select: { id: true, email: true, name: true, status: true, lastLoginAt: true } } },
        }),
      );
      if (!row) {
        res.status(404).json({ success: false, error: "Builder not found" });
        return;
      }
      res.json({
        success: true,
        data: {
          ...asSnakeBuilder(row),
          regions: [],
          portal_access: row.status !== "inactive" && row.partnerUsers.some((u) => u.status === "active"),
          partner_users: row.partnerUsers.map((u) => ({ id: u.id, email: u.email, name: u.name, status: u.status, last_login: u.lastLoginAt })),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.post(
  "/api/builders",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      const portalAccess = b.portal_access === true || b.portal_access === 1 || b.portal_access === "1";
      const email = String(b.email || "").trim().toLowerCase();
      if (portalAccess && !email) {
        res.status(400).json({ success: false, error: "Informe o e-mail para criar o acesso ao portal." });
        return;
      }
      if (portalAccess && String(b.status || "active") === "inactive") {
        res.status(400).json({ success: false, error: "Ative o cadastro do parceiro antes de liberar o portal." });
        return;
      }
      const tempPassword = portalAccess ? randomBytes(12).toString("base64url") : null;
      const passwordHash = tempPassword ? await hashPassword(tempPassword) : null;
      const outcome = await withTenantTransaction(req.organizationId!, async (tx) => {
        if (portalAccess) {
          const duplicate = await tx.partnerUser.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
            select: { id: true },
          });
          if (duplicate) return { conflict: true as const };
        }
        const row = await tx.builder.create({
          data: {
            organizationId: req.organizationId!,
            firstName: formatPersonName(String(b.first_name || b.firstName || b.name || "Builder")),
            lastName: formatPersonName(String(b.last_name || b.lastName || "")),
            email: email || null,
            phone: b.phone || null,
            company: b.company || null,
            nickname: String(b.nickname || "").trim().slice(0, 40) || null,
            type: String(b.type || "builder"),
            status: String(b.status || "active"),
            address: b.address || null,
            notes: b.notes || null,
          },
        });
        if (row.nickname) {
          await mirrorNickname(
            tx,
            req.organizationId!,
            row.nickname,
            {
              company: row.company,
              name: [row.firstName, row.lastName].filter(Boolean).join(" ").trim(),
              email: row.email,
            },
            { builderId: row.id },
          );
        }
        if (portalAccess && tempPassword && passwordHash) {
          await tx.partnerUser.create({
            data: {
              organizationId: req.organizationId!,
              builderId: row.id,
              email,
              passwordHash,
              name: [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || row.company || email,
              companyName: row.company,
              status: "active",
              mustChangePassword: true,
            },
          });
        }
        return { conflict: false as const, row };
      });
      if (outcome.conflict) {
        res.status(409).json({ success: false, error: "Já existe uma conta de parceiro com esse e-mail." });
        return;
      }
      res.status(201).json({
        success: true,
        data: { ...asSnakeBuilder(outcome.row), portal_access: portalAccess, ...(tempPassword ? { temp_password: tempPassword } : {}) },
      });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.put(
  "/api/builders/:id/portal-access",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const enabled = req.body?.enabled === true;
      const resetPassword = req.body?.reset_password === true;
      const tempPassword = enabled && resetPassword ? randomBytes(12).toString("base64url") : null;
      const passwordHash = tempPassword ? await hashPassword(tempPassword) : null;
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const builder = await tx.builder.findFirst({ where: { id } });
        if (!builder) return { missing: true as const, conflict: false as const, enabled: false, password: null };
        if (!enabled) {
          await tx.partnerUser.updateMany({ where: { builderId: id }, data: { status: "suspended" } });
          return { missing: false as const, conflict: false as const, enabled: false, password: null };
        }
        if (builder.status === "inactive") {
          return { missing: false as const, conflict: "builder_inactive" as const, enabled: false, password: null };
        }
        const existing = await tx.partnerUser.findFirst({ where: { builderId: id }, orderBy: { createdAt: "asc" } });
        if (existing) {
          await tx.partnerUser.updateMany({
            where: { builderId: id },
            data: { status: "active" },
          });
          if (tempPassword && passwordHash) {
            await tx.partnerUser.update({
              where: { id: existing.id },
              data: { passwordHash, mustChangePassword: true },
            });
          }
          return { missing: false as const, conflict: false as const, enabled: true, password: tempPassword };
        }
        const email = builder.email?.trim().toLowerCase();
        if (!email) return { missing: false as const, conflict: "email" as const, enabled: false, password: null };
        const duplicate = await tx.partnerUser.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true },
        });
        if (duplicate) return { missing: false as const, conflict: "account" as const, enabled: false, password: null };
        const newPassword = tempPassword || randomBytes(12).toString("base64url");
        const newHash = passwordHash || await hashPassword(newPassword);
        await tx.partnerUser.create({
          data: {
            organizationId: req.organizationId!,
            builderId: id,
            email,
            passwordHash: newHash,
            name: [builder.firstName, builder.lastName].filter(Boolean).join(" ").trim() || builder.company || email,
            companyName: builder.company,
            status: "active",
            mustChangePassword: true,
          },
        });
        return { missing: false as const, conflict: false as const, enabled: true, password: newPassword };
      });
      if (result.missing) {
        res.status(404).json({ success: false, error: "Builder não encontrado." });
        return;
      }
      if (result.conflict) {
        res.status(409).json({
          success: false,
          error: result.conflict === "email"
            ? "Adicione um e-mail ao cadastro antes de liberar o portal."
            : result.conflict === "builder_inactive"
              ? "Ative o cadastro do parceiro antes de liberar o portal."
            : "Já existe uma conta de parceiro com esse e-mail.",
        });
        return;
      }
      res.json({
        success: true,
        data: {
          enabled: result.enabled,
          ...(result.password ? { temp_password: result.password } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.put(
  "/api/builders/:id",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const b = req.body || {};
      const outcome = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.builder.findFirst({ where: { id } });
        if (!existing) return { kind: "missing" as const };
        const linkedUsers = await tx.partnerUser.findMany({
          where: { builderId: id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        const nextEmail = b.email !== undefined ? String(b.email || "").trim().toLowerCase() || null : undefined;
        const nextStatus = b.status !== undefined ? String(b.status) : existing.status;
        if (linkedUsers.length && b.email !== undefined && !nextEmail && nextStatus !== "inactive") {
          return { kind: "email_required" as const };
        }
        if (linkedUsers.length && nextEmail && nextEmail !== existing.email?.toLowerCase()) {
          const duplicate = await tx.partnerUser.findFirst({
            where: { email: { equals: nextEmail, mode: "insensitive" }, id: { notIn: linkedUsers.map((u) => u.id) } },
            select: { id: true },
          });
          if (duplicate) return { kind: "email_conflict" as const };
        }
        const row = await tx.builder.update({
          where: { id },
          data: {
            firstName: b.first_name !== undefined ? formatPersonName(String(b.first_name)) : undefined,
            lastName: b.last_name !== undefined ? formatPersonName(String(b.last_name)) : undefined,
            email: nextEmail,
            phone: b.phone !== undefined ? b.phone || null : undefined,
            company: b.company !== undefined ? b.company || null : undefined,
            nickname: b.nickname !== undefined ? String(b.nickname || "").trim().slice(0, 40) || null : undefined,
            type: b.type !== undefined ? String(b.type) : undefined,
            status: b.status !== undefined ? nextStatus : undefined,
            address: b.address !== undefined ? b.address || null : undefined,
            notes: b.notes !== undefined ? b.notes || null : undefined,
          },
        });
        if (row.nickname) {
          await mirrorNickname(
            tx,
            req.organizationId!,
            row.nickname,
            {
              company: row.company,
              name: [row.firstName, row.lastName].filter(Boolean).join(" ").trim(),
              email: row.email,
            },
            { builderId: row.id },
          );
        }
        if (linkedUsers.length) {
          const partnerEmail = nextEmail ?? existing.email;
          const partnerName = [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || row.company || partnerEmail || "Parceiro";
          await tx.partnerUser.update({
            where: { id: linkedUsers[0]!.id },
            data: { ...(partnerEmail ? { email: partnerEmail.toLowerCase() } : {}), name: partnerName, companyName: row.company },
          });
        }
        if (nextStatus === "inactive") {
          await tx.partnerUser.updateMany({ where: { builderId: id }, data: { status: "suspended" } });
        }
        return { kind: "updated" as const, row };
      });
      if (outcome.kind === "missing") {
        res.status(404).json({ success: false, error: "Builder not found" });
        return;
      }
      if (outcome.kind === "email_required") {
        res.status(400).json({ success: false, error: "Desative o acesso ao portal antes de remover o e-mail do parceiro." });
        return;
      }
      if (outcome.kind === "email_conflict") {
        res.status(409).json({ success: false, error: "Esse e-mail já está ligado a outra conta de parceiro." });
        return;
      }
      res.json({ success: true, data: asSnakeBuilder(outcome.row) });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.delete(
  "/api/builders/:id",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.builder.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.partnerUser.updateMany({ where: { builderId: id }, data: { status: "suspended" } });
        await tx.builder.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Builder not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.get(
  "/api/pricing",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }
      const canRead =
        user.roleKey === "admin" ||
        user.permissions.includes("builders.view") ||
        user.permissions.includes("quotes.view");
      if (!canRead) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["builders.view"] });
        return;
      }
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.pricingItem.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      );
      res.json({ success: true, data: rows.map(mapPricing) });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.get("/api/pricing/volume-discounts", (_req, res) => {
  res.json({ success: true, data: VOLUME_DISCOUNTS });
});

/** Default service catalog (names/descriptions only — rates stay 0). */
buildersPricingRouter.get(
  "/api/pricing/default-catalog",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }
      const canRead =
        user.roleKey === "admin" ||
        user.permissions.includes("builders.view") ||
        user.permissions.includes("quotes.view");
      if (!canRead) {
        res.status(403).json({ success: false, error: "Permission denied", missing: ["builders.view"] });
        return;
      }
      res.json({
        success: true,
        data: DEFAULT_PRICING_SERVICES.map((s) => ({
          name: s.name,
          category: s.category,
          unit: s.unit,
          description: s.description,
          sort_order: s.sortOrder,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Load default services into this org's Tabela de Valores.
 * Does not overwrite existing rows or set prices — only inserts missing name+category.
 */
buildersPricingRouter.post(
  "/api/pricing/seed-defaults",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const emptyOnly = Boolean(req.body?.empty_only);
      const created = await withTenantTransaction(req.organizationId!, async (tx) =>
        seedDefaultPricingServices(tx as never, req.organizationId!, { emptyOnly }),
      );
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.pricingItem.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      );
      res.json({
        success: true,
        created,
        data: rows.map(mapPricing),
        message:
          created > 0
            ? `${created} serviço${created === 1 ? "" : "s"} adicionado${created === 1 ? "" : "s"} (preços em branco para você preencher).`
            : "Nenhum serviço novo — a tabela já tinha esses itens.",
      });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.post(
  "/api/pricing",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      const legacyMin = Number(b.price_min != null ? b.price_min : b.price) || 0;
      const legacyMax = Number(b.price_max != null ? b.price_max : legacyMin) || 0;
      const legacyPartner = b.partner_price != null ? Number(b.partner_price) : null;
      const rates = {
        particular: parseOptionalMoney(b.price_particular) ?? (legacyMax || legacyMin),
        builder: parseOptionalMoney(b.price_builder) ?? (legacyPartner ?? legacyMin),
        contractor: parseOptionalMoney(b.price_contractor) ?? (legacyPartner ?? legacyMin),
        loja: parseOptionalMoney(b.price_loja) ?? legacyMin,
      };
      const legacy = syncLegacyFromTyped(rates);
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.pricingItem.create({
          data: {
            organizationId: req.organizationId!,
            name: String(b.name || "New service"),
            category: String(b.category || "installation"),
            unit: String(b.unit || "sq_ft"),
            ...legacy,
            priceParticular: new Prisma.Decimal(rates.particular),
            priceBuilder: new Prisma.Decimal(rates.builder),
            priceContractor: new Prisma.Decimal(rates.contractor),
            priceLoja: new Prisma.Decimal(rates.loja),
            notes: b.notes || null,
            description: b.description || null,
            isVisible: b.is_visible === undefined ? true : Boolean(b.is_visible),
            isLocked: Boolean(b.is_locked),
            sortOrder: Number(b.sort_order) || 0,
          },
        }),
      );
      res.status(201).json({ success: true, data: mapPricing(row) });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.put(
  "/api/pricing/:id",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.pricingItem.findFirst({ where: { id } });
        if (!existing) return null;

        const hasTyped =
          b.price_particular !== undefined ||
          b.price_builder !== undefined ||
          b.price_contractor !== undefined ||
          b.price_loja !== undefined;

        const data: Prisma.PricingItemUpdateInput = {
          name: b.name !== undefined ? String(b.name) : undefined,
          category: b.category !== undefined ? String(b.category) : undefined,
          unit: b.unit !== undefined ? String(b.unit) : undefined,
          notes: b.notes !== undefined ? b.notes : undefined,
          isVisible: b.is_visible !== undefined ? Boolean(b.is_visible) : undefined,
          isLocked: b.is_locked !== undefined ? Boolean(b.is_locked) : undefined,
          sortOrder: b.sort_order !== undefined ? Number(b.sort_order) || 0 : undefined,
          active: b.active !== undefined ? Boolean(b.active) : undefined,
        };

        if (hasTyped) {
          const rates = {
            particular:
              parseOptionalMoney(b.price_particular) ??
              (dec(existing.priceParticular) || dec(existing.priceMax) || 0),
            builder:
              parseOptionalMoney(b.price_builder) ??
              (dec(existing.priceBuilder) ||
                (existing.partnerPrice != null ? dec(existing.partnerPrice) : 0) ||
                0),
            contractor:
              parseOptionalMoney(b.price_contractor) ??
              (dec(existing.priceContractor) || dec(existing.priceBuilder) || 0),
            loja:
              parseOptionalMoney(b.price_loja) ??
              (dec(existing.priceLoja) || dec(existing.priceMin) || 0),
          };
          Object.assign(data, syncLegacyFromTyped(rates), {
            priceParticular: new Prisma.Decimal(rates.particular),
            priceBuilder: new Prisma.Decimal(rates.builder),
            priceContractor: new Prisma.Decimal(rates.contractor),
            priceLoja: new Prisma.Decimal(rates.loja),
          });
        } else {
          if (b.price_min !== undefined) data.priceMin = new Prisma.Decimal(Number(b.price_min) || 0);
          if (b.price_max !== undefined) data.priceMax = new Prisma.Decimal(Number(b.price_max) || 0);
          if (b.partner_price !== undefined) {
            data.partnerPrice =
              b.partner_price == null ? null : new Prisma.Decimal(Number(b.partner_price) || 0);
          }
          if (b.price !== undefined) data.price = new Prisma.Decimal(Number(b.price) || 0);
        }

        return tx.pricingItem.update({ where: { id }, data });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Pricing item not found" });
        return;
      }
      res.json({ success: true, data: mapPricing(row) });
    } catch (error) {
      next(error);
    }
  },
);

buildersPricingRouter.delete(
  "/api/pricing/:id",
  requireCrmAuth,
  requireCrmPermission("builders.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.pricingItem.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.pricingItem.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Pricing item not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);
