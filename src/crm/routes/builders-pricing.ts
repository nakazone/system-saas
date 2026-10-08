import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec, asSnakeBuilder } from "../http.js";
import { formatPersonName } from "../../lib/name.js";

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
          tx.builder.findMany({ where, orderBy: { createdAt: "desc" }, skip: offset, take: limit }),
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
        data: result.rows.map((r) => ({ ...asSnakeBuilder(r), project_count: 0, regions: [] })),
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
        tx.builder.findFirst({ where: { id: String(req.params.id) } }),
      );
      if (!row) {
        res.status(404).json({ success: false, error: "Builder not found" });
        return;
      }
      res.json({ success: true, data: { ...asSnakeBuilder(row), regions: [] } });
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
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.builder.create({
          data: {
            organizationId: req.organizationId!,
            firstName: formatPersonName(String(b.first_name || b.firstName || b.name || "Builder")),
            lastName: formatPersonName(String(b.last_name || b.lastName || "")),
            email: b.email || null,
            phone: b.phone || null,
            company: b.company || null,
            type: String(b.type || "builder"),
            status: String(b.status || "active"),
            address: b.address || null,
            notes: b.notes || null,
          },
        }),
      );
      res.status(201).json({ success: true, data: asSnakeBuilder(row) });
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
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.builder.findFirst({ where: { id } });
        if (!existing) return null;
        return tx.builder.update({
          where: { id },
          data: {
            firstName: b.first_name !== undefined ? formatPersonName(String(b.first_name)) : undefined,
            lastName: b.last_name !== undefined ? formatPersonName(String(b.last_name)) : undefined,
            email: b.email !== undefined ? b.email || null : undefined,
            phone: b.phone !== undefined ? b.phone || null : undefined,
            company: b.company !== undefined ? b.company || null : undefined,
            type: b.type !== undefined ? String(b.type) : undefined,
            status: b.status !== undefined ? String(b.status) : undefined,
            address: b.address !== undefined ? b.address || null : undefined,
            notes: b.notes !== undefined ? b.notes || null : undefined,
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Builder not found" });
        return;
      }
      res.json({ success: true, data: asSnakeBuilder(row) });
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
