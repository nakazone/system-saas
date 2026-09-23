import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec, asSnakeBuilder } from "../http.js";
import { canViewPricing, withPricingGate } from "../../lib/pricing/visibility.js";
import { recordActivity } from "../../lib/activity/record.js";

export const customersQuotesRouter = Router();

function mapProperty(p: {
  id: string;
  customerId: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    customer_id: p.customerId,
    label: p.label,
    line1: p.line1,
    line2: p.line2,
    city: p.city,
    state: p.state,
    postal_code: p.postalCode,
    country: p.country,
    notes: p.notes,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function mapCustomer(c: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  customerType: string;
  company: string | null;
  notes: string | null;
  leadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    customer_type: c.customerType,
    company: c.company,
    notes: c.notes,
    lead_id: c.leadId,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function mapQuote(q: {
  id: string;
  number: number;
  quoteNumber: string | null;
  title: string;
  status: string;
  flooringType: string;
  areaSqft: unknown;
  wastePercent: unknown;
  materialCost: unknown;
  laborCost: unknown;
  materialMarkup: unknown;
  laborMarkup: unknown;
  subtotal: unknown;
  total: unknown;
  taxTotal: unknown;
  notes: string | null;
  terms: string | null;
  serviceType: string | null;
  customerId: string | null;
  leadId: string | null;
  builderId: string | null;
  publicToken: string | null;
  invoicePdfPath: string | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  customer?: { name: string } | null;
  lineItems?: Array<{
    id: string;
    description: string;
    quantity: unknown;
    unit: string;
    unitPrice: unknown;
    amount: unknown;
    itemType: string;
    sortOrder: number;
  }>;
}) {
  return {
    id: q.id,
    number: q.number,
    quote_number: q.quoteNumber || String(q.number),
    title: q.title,
    status: q.status,
    flooring_type: q.flooringType,
    area_sqft: dec(q.areaSqft),
    waste_percent: dec(q.wastePercent),
    material_cost: dec(q.materialCost),
    labor_cost: dec(q.laborCost),
    material_markup: dec(q.materialMarkup),
    labor_markup: dec(q.laborMarkup),
    subtotal: dec(q.subtotal),
    total: dec(q.total),
    tax_total: dec(q.taxTotal),
    notes: q.notes,
    terms: q.terms,
    service_type: q.serviceType,
    customer_id: q.customerId,
    customer_name: q.customer?.name ?? null,
    lead_id: q.leadId,
    builder_id: q.builderId,
    public_token: q.publicToken,
    has_invoice_pdf: Boolean(q.invoicePdfPath),
    invoice_pdf_url: q.invoicePdfPath ? `/api/quotes/${q.id}/invoice-pdf` : null,
    payload: q.payload,
    created_at: q.createdAt,
    updated_at: q.updatedAt,
    items: (q.lineItems || []).map((li) => ({
      id: li.id,
      description: li.description,
      quantity: dec(li.quantity),
      unit: li.unit,
      unit_price: dec(li.unitPrice),
      amount: dec(li.amount),
      item_type: li.itemType,
      sort_order: li.sortOrder,
    })),
  };
}

function mapQuoteForUser(
  q: Parameters<typeof mapQuote>[0],
  user: AuthedRequest["user"],
) {
  return withPricingGate(user, mapQuote(q));
}

customersQuotesRouter.get("/api/customers", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const customerType = req.query.customer_type || req.query.type || null;
    const search = String(req.query.q || req.query.search || "").trim();

    const [total, rows] = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where: Prisma.CustomerWhereInput = {};
      if (customerType) where.customerType = String(customerType);
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
        ];
      }
      return [
        await tx.customer.count({ where }),
        await tx.customer.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      ] as const;
    });
    res.json({ success: true, data: rows.map(mapCustomer), total, page, limit });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.get("/api/customers/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const row = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.customer.findFirst({
        where: { id: String(req.params.id) },
        include: { properties: { orderBy: { createdAt: "asc" } } },
      }),
    );
    if (!row) {
      res.status(404).json({ success: false, error: "Customer not found" });
      return;
    }
    res.json({
      success: true,
      data: {
        ...mapCustomer(row),
        properties: row.properties.map(mapProperty),
      },
    });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.get(
  "/api/customers/:id/properties",
  requireCrmAuth,
  requireCrmPermission("customers.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.property.findMany({
          where: { customerId: String(req.params.id) },
          orderBy: { createdAt: "asc" },
        }),
      );
      res.json({ success: true, data: rows.map(mapProperty) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.post(
  "/api/customers/:id/properties",
  requireCrmAuth,
  requireCrmPermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const line1 = String(body.line1 || body.address || "").trim();
      if (!line1) {
        res.status(400).json({ success: false, error: "line1 is required" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: String(req.params.id) } });
        if (!customer) return null;
        const property = await tx.property.create({
          data: {
            organizationId: req.organizationId!,
            customerId: customer.id,
            label: body.label ? String(body.label) : null,
            line1,
            line2: body.line2 ? String(body.line2) : null,
            city: String(body.city || ""),
            state: String(body.state || ""),
            postalCode: String(body.postal_code || body.postalCode || ""),
            country: String(body.country || "US"),
            notes: body.notes ? String(body.notes) : null,
          },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "property",
          entityId: property.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
        });
        return property;
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Customer not found" });
        return;
      }
      res.status(201).json({ success: true, data: mapProperty(row) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.put(
  "/api/properties/:id",
  requireCrmAuth,
  requireCrmPermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.property.findFirst({ where: { id: String(req.params.id) } });
        if (!existing) return null;
        const updated = await tx.property.update({
          where: { id: existing.id },
          data: {
            label: body.label !== undefined ? String(body.label || "") || null : undefined,
            line1: body.line1 !== undefined ? String(body.line1) : undefined,
            line2: body.line2 !== undefined ? String(body.line2 || "") || null : undefined,
            city: body.city !== undefined ? String(body.city || "") : undefined,
            state: body.state !== undefined ? String(body.state || "") : undefined,
            postalCode:
              body.postal_code !== undefined || body.postalCode !== undefined
                ? String(body.postal_code || body.postalCode || "")
                : undefined,
            country: body.country !== undefined ? String(body.country || "US") : undefined,
            notes: body.notes !== undefined ? String(body.notes || "") || null : undefined,
          },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "property",
          entityId: updated.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "updated",
        });
        return updated;
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Property not found" });
        return;
      }
      res.json({ success: true, data: mapProperty(row) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get(
  "/api/activity",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const entityType = String(req.query.entity_type || "");
      const entityId = String(req.query.entity_id || "");
      if (!entityType || !entityId) {
        res.status(400).json({ success: false, error: "entity_type and entity_id required" });
        return;
      }
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.activityEvent.findMany({
          where: { entityType, entityId },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      );
      res.json({
        success: true,
        data: rows.map((ev) => ({
          id: ev.id,
          entity_type: ev.entityType,
          entity_id: ev.entityId,
          actor_type: ev.actorType,
          actor_id: ev.actorId,
          action: ev.action,
          changes: ev.changes,
          created_at: ev.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get("/api/customers/:id/insight", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const insight = await withTenantTransaction(req.organizationId!, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: String(req.params.id) } });
      if (!customer) return null;
      const quotes = await tx.quote.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const total = canViewPricing(req.user)
        ? quotes.reduce((s, q) => s + dec(q.total), 0)
        : null;
      return {
        customer: mapCustomer(customer),
        quotes_count: quotes.length,
        quotes_total: total,
        recent_quotes: quotes.map((q) => mapQuoteForUser(q, req.user)),
      };
    });
    if (!insight) {
      res.status(404).json({ success: false, error: "Customer not found" });
      return;
    }
    res.json({ success: true, data: insight });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.get("/api/customers/by-lead/:leadId", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const row = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.customer.findFirst({ where: { leadId: String(req.params.leadId) } }),
    );
    res.json({ success: true, data: row ? mapCustomer(row) : null });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.post(
  "/api/customers",
  requireCrmAuth,
  requireCrmPermission("customers.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({
          name: z.string().min(1),
          email: z.string().optional().nullable(),
          phone: z.string().optional().nullable(),
          address: z.string().optional().nullable(),
          customer_type: z.string().optional(),
          company: z.string().optional().nullable(),
          notes: z.string().optional().nullable(),
          lead_id: z.string().uuid().optional().nullable(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid customer payload" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const created = await tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            address: parsed.data.address || null,
            customerType: parsed.data.customer_type || "residential",
            company: parsed.data.company || null,
            notes: parsed.data.notes || null,
            leadId: parsed.data.lead_id || null,
          },
        });
        if (parsed.data.address) {
          await tx.property.create({
            data: {
              organizationId: req.organizationId!,
              customerId: created.id,
              label: "Primary",
              line1: parsed.data.address,
              city: "",
              state: "",
              postalCode: "",
              country: "US",
            },
          });
        }
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "customer",
          entityId: created.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
        });
        return created;
      });
      res.status(201).json({ success: true, data: mapCustomer(row) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.post(
  "/api/customers/from-lead",
  requireCrmAuth,
  requireCrmPermission("customers.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const leadId = String(req.body?.lead_id || "");
      if (!leadId) {
        res.status(400).json({ success: false, error: "lead_id required" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.customer.findFirst({ where: { leadId } });
        if (existing) return existing;
        const lead = await tx.lead.findFirst({ where: { id: leadId } });
        if (!lead) return null;
        return tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            leadId: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            notes: lead.notes,
            customerType: String(req.body?.customer_type || "residential"),
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Lead not found" });
        return;
      }
      res.status(201).json({ success: true, data: mapCustomer(row) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.put(
  "/api/customers/:id",
  requireCrmAuth,
  requireCrmPermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const body = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.customer.findFirst({ where: { id } });
        if (!existing) return null;
        return tx.customer.update({
          where: { id },
          data: {
            name: body.name !== undefined ? String(body.name) : undefined,
            email: body.email !== undefined ? String(body.email || "") || null : undefined,
            phone: body.phone !== undefined ? String(body.phone || "") || null : undefined,
            address: body.address !== undefined ? String(body.address || "") || null : undefined,
            customerType: body.customer_type !== undefined ? String(body.customer_type) : undefined,
            company: body.company !== undefined ? String(body.company || "") || null : undefined,
            notes: body.notes !== undefined ? String(body.notes || "") || null : undefined,
          },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Customer not found" });
        return;
      }
      res.json({ success: true, data: mapCustomer(row), message: "Client updated" });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get("/api/quotes", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const status = req.query.status ? String(req.query.status) : null;
    const leadId = req.query.lead_id ? String(req.query.lead_id) : null;
    const customerId = req.query.customer_id ? String(req.query.customer_id) : null;
    const search = String(req.query.q || req.query.search || "").trim();

    const [total, rows] = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where: Prisma.QuoteWhereInput = {};
      if (status) where.status = status;
      if (leadId) where.leadId = leadId;
      if (customerId) where.customerId = customerId;
      if (search) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { quoteNumber: { contains: search, mode: "insensitive" } },
        ];
      }
      return [
        await tx.quote.count({ where }),
        await tx.quote.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: { customer: { select: { name: true } }, lineItems: { orderBy: { sortOrder: "asc" } } },
        }),
      ] as const;
    });
    res.json({ success: true, data: rows.map((q) => mapQuoteForUser(q, req.user)), total, page, limit });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.get(
  "/api/quotes/lookup/builders",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.builder.findMany({
          where: { status: "active" },
          orderBy: { firstName: "asc" },
          take: 200,
        }),
      );
      res.json({ success: true, data: rows.map(asSnakeBuilder) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get("/api/quotes/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const row = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.quote.findFirst({
        where: { id: String(req.params.id) },
        include: { customer: { select: { name: true } }, lineItems: { orderBy: { sortOrder: "asc" } } },
      }),
    );
    if (!row) {
      res.status(404).json({ success: false, error: "Quote not found" });
      return;
    }
    res.json({ success: true, data: mapQuoteForUser(row, req.user) });
  } catch (error) {
    next(error);
  }
});

async function nextQuoteNumber(tx: TenantPrisma, organizationId: string) {
  const last = await tx.quote.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (last?.number ?? 1000) + 1;
}

customersQuotesRouter.post(
  "/api/quotes/full",
  requireCrmAuth,
  requireCrmPermission("quotes.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const number = await nextQuoteNumber(tx, req.organizationId!);
        const items = Array.isArray(body.items) ? body.items : Array.isArray(body.line_items) ? body.line_items : [];
        const subtotal = items.reduce(
          (s: number, it: { amount?: number; quantity?: number; unit_price?: number }) =>
            s + (Number(it.amount) || Number(it.quantity || 0) * Number(it.unit_price || 0)),
          0,
        );
        const tax = Number(body.tax_total || body.tax || 0);
        const total = Number(body.total != null ? body.total : subtotal + tax);
        const quote = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            quoteNumber: body.quote_number || `Q-${number}`,
            title: String(body.title || body.service_type || `Quote ${number}`),
            status: String(body.status || "draft"),
            flooringType: String(body.flooring_type || "hardwood"),
            areaSqft: new Prisma.Decimal(Number(body.area_sqft) || 0),
            wastePercent: new Prisma.Decimal(Number(body.waste_percent) || 0),
            materialCost: new Prisma.Decimal(Number(body.material_cost) || 0),
            laborCost: new Prisma.Decimal(Number(body.labor_cost) || 0),
            materialMarkup: new Prisma.Decimal(Number(body.material_markup) || 0),
            laborMarkup: new Prisma.Decimal(Number(body.labor_markup) || 0),
            subtotal: new Prisma.Decimal(subtotal),
            taxTotal: new Prisma.Decimal(tax),
            total: new Prisma.Decimal(total),
            notes: body.notes || null,
            terms: body.terms || null,
            serviceType: body.service_type || null,
            customerId: body.customer_id || null,
            leadId: body.lead_id || null,
            builderId: body.builder_id || null,
            publicToken: randomBytes(16).toString("hex"),
            payload: body,
            lineItems: {
              create: items.map(
                (
                  it: {
                    description?: string;
                    quantity?: number;
                    unit?: string;
                    unit_price?: number;
                    amount?: number;
                    item_type?: string;
                  },
                  idx: number,
                ) => {
                  const qty = Number(it.quantity) || 0;
                  const unitPrice = Number(it.unit_price) || 0;
                  const amount = Number(it.amount) || qty * unitPrice;
                  return {
                    organizationId: req.organizationId!,
                    description: String(it.description || "Item"),
                    quantity: new Prisma.Decimal(qty),
                    unit: String(it.unit || "sqft"),
                    unitPrice: new Prisma.Decimal(unitPrice),
                    amount: new Prisma.Decimal(amount),
                    itemType: String(it.item_type || "service"),
                    sortOrder: idx,
                  };
                },
              ),
            },
          },
          include: { customer: { select: { name: true } }, lineItems: true },
        });
        return quote;
      });
      res.status(201).json({ success: true, data: mapQuoteForUser(row, req.user) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.put(
  "/api/quotes/:id/full",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const body = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.quote.findFirst({ where: { id } });
        if (!existing) return null;
        const items = Array.isArray(body.items) ? body.items : Array.isArray(body.line_items) ? body.line_items : null;
        let subtotal = dec(existing.subtotal);
        let total = dec(existing.total);
        let tax = dec(existing.taxTotal);
        if (items) {
          subtotal = items.reduce(
            (s: number, it: { amount?: number; quantity?: number; unit_price?: number }) =>
              s + (Number(it.amount) || Number(it.quantity || 0) * Number(it.unit_price || 0)),
            0,
          );
          tax = Number(body.tax_total != null ? body.tax_total : tax);
          total = Number(body.total != null ? body.total : subtotal + tax);
          await tx.quoteLineItem.deleteMany({ where: { quoteId: id } });
          await tx.quoteLineItem.createMany({
            data: items.map(
              (
                it: {
                  description?: string;
                  quantity?: number;
                  unit?: string;
                  unit_price?: number;
                  amount?: number;
                  item_type?: string;
                },
                idx: number,
              ) => {
                const qty = Number(it.quantity) || 0;
                const unitPrice = Number(it.unit_price) || 0;
                const amount = Number(it.amount) || qty * unitPrice;
                return {
                  organizationId: req.organizationId!,
                  quoteId: id,
                  description: String(it.description || "Item"),
                  quantity: new Prisma.Decimal(qty),
                  unit: String(it.unit || "sqft"),
                  unitPrice: new Prisma.Decimal(unitPrice),
                  amount: new Prisma.Decimal(amount),
                  itemType: String(it.item_type || "service"),
                  sortOrder: idx,
                };
              },
            ),
          });
        }
        return tx.quote.update({
          where: { id },
          data: {
            title: body.title !== undefined ? String(body.title) : undefined,
            status: body.status !== undefined ? String(body.status) : undefined,
            flooringType: body.flooring_type !== undefined ? String(body.flooring_type) : undefined,
            notes: body.notes !== undefined ? body.notes : undefined,
            terms: body.terms !== undefined ? body.terms : undefined,
            serviceType: body.service_type !== undefined ? body.service_type : undefined,
            customerId: body.customer_id !== undefined ? body.customer_id || null : undefined,
            leadId: body.lead_id !== undefined ? body.lead_id || null : undefined,
            builderId: body.builder_id !== undefined ? body.builder_id || null : undefined,
            subtotal: new Prisma.Decimal(subtotal),
            taxTotal: new Prisma.Decimal(tax),
            total: new Prisma.Decimal(total),
            payload: body,
          },
          include: { customer: { select: { name: true } }, lineItems: { orderBy: { sortOrder: "asc" } } },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Quote not found" });
        return;
      }
      res.json({ success: true, data: mapQuoteForUser(row, req.user) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.post(
  "/api/quotes/:id/duplicate",
  requireCrmAuth,
  requireCrmPermission("quotes.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const src = await tx.quote.findFirst({
          where: { id },
          include: { lineItems: true },
        });
        if (!src) return null;
        const number = await nextQuoteNumber(tx, req.organizationId!);
        return tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            quoteNumber: `Q-${number}`,
            title: `${src.title} (copy)`,
            status: "draft",
            flooringType: src.flooringType,
            areaSqft: src.areaSqft,
            wastePercent: src.wastePercent,
            materialCost: src.materialCost,
            laborCost: src.laborCost,
            materialMarkup: src.materialMarkup,
            laborMarkup: src.laborMarkup,
            subtotal: src.subtotal,
            taxTotal: src.taxTotal,
            total: src.total,
            notes: src.notes,
            terms: src.terms,
            serviceType: src.serviceType,
            customerId: src.customerId,
            leadId: src.leadId,
            builderId: src.builderId,
            publicToken: randomBytes(16).toString("hex"),
            payload: src.payload ?? undefined,
            lineItems: {
              create: src.lineItems.map((li) => ({
                organizationId: req.organizationId!,
                description: li.description,
                quantity: li.quantity,
                unit: li.unit,
                unitPrice: li.unitPrice,
                amount: li.amount,
                itemType: li.itemType,
                sortOrder: li.sortOrder,
                productId: li.productId,
                catalogId: li.catalogId,
                meta: li.meta ?? undefined,
              })),
            },
          },
          include: { customer: { select: { name: true } }, lineItems: true },
        });
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Quote not found" });
        return;
      }
      res.status(201).json({ success: true, data: mapQuoteForUser(row, req.user) });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.delete(
  "/api/quotes/:id",
  requireCrmAuth,
  requireCrmPermission("quotes.delete"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const ok = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.quote.findFirst({ where: { id } });
        if (!existing) return false;
        await tx.quote.delete({ where: { id } });
        return true;
      });
      if (!ok) {
        res.status(404).json({ success: false, error: "Quote not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get("/api/quotes/:id/invoices", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const quoteId = String(req.params.id);
    const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.quoteInvoice.findMany({
        where: { quoteId },
        orderBy: { createdAt: "desc" },
        include: { receipts: true },
      }),
    );
    res.json({
      success: true,
      data: withPricingGate(
        req.user,
        rows.map((inv) => ({
          id: inv.id,
          quote_id: inv.quoteId,
          invoice_number: inv.invoiceNumber,
          status: inv.status,
          amount: dec(inv.amount),
          due_date: inv.dueDate,
          notes: inv.notes,
          created_at: inv.createdAt,
          receipts: inv.receipts.map((r) => ({
            id: r.id,
            amount: dec(r.amount),
            paid_at: r.paidAt,
            method: r.method,
          })),
        })),
      ),
    });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.post(
  "/api/quotes/:id/invoices",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const quoteId = String(req.params.id);
      const body = req.body || {};
      const inv = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({ where: { id: quoteId } });
        if (!quote) return null;
        const count = await tx.quoteInvoice.count({ where: { quoteId } });
        return tx.quoteInvoice.create({
          data: {
            organizationId: req.organizationId!,
            quoteId,
            invoiceNumber: body.invoice_number || `INV-${quote.number}-${count + 1}`,
            status: String(body.status || "draft"),
            amount: new Prisma.Decimal(Number(body.amount != null ? body.amount : quote.total) || 0),
            dueDate: body.due_date ? new Date(body.due_date) : null,
            notes: body.notes || null,
            payload: body,
          },
        });
      });
      if (!inv) {
        res.status(404).json({ success: false, error: "Quote not found" });
        return;
      }
      res.status(201).json({
        success: true,
        data: withPricingGate(req.user, {
          id: inv.id,
          quote_id: inv.quoteId,
          invoice_number: inv.invoiceNumber,
          status: inv.status,
          amount: dec(inv.amount),
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get("/api/invoices", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const status = req.query.status ? String(req.query.status) : null;

    const [total, rows] = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where: Prisma.QuoteInvoiceWhereInput = status ? { status } : {};
      return [
        await tx.quoteInvoice.count({ where }),
        await tx.quoteInvoice.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: { quote: { select: { title: true, quoteNumber: true, number: true } }, receipts: true },
        }),
      ] as const;
    });

    res.json({
      success: true,
      data: withPricingGate(
        req.user,
        rows.map((inv) => ({
          id: inv.id,
          quote_id: inv.quoteId,
          quote_title: inv.quote.title,
          quote_number: inv.quote.quoteNumber || String(inv.quote.number),
          invoice_number: inv.invoiceNumber,
          status: inv.status,
          amount: dec(inv.amount),
          due_date: inv.dueDate,
          paid_total: inv.receipts.reduce((s, r) => s + dec(r.amount), 0),
          created_at: inv.createdAt,
        })),
      ),
      total,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.get("/api/quote-catalog", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.quoteCatalogItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    );
    res.json({
      success: true,
      data: withPricingGate(
        req.user,
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          service_type: r.serviceType,
          unit_type: r.unitType,
          unit_price: dec(r.unitPrice),
          description: r.description,
        })),
      ),
    });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.post(
  "/api/quote-catalog",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const b = req.body || {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) =>
        tx.quoteCatalogItem.create({
          data: {
            organizationId: req.organizationId!,
            name: String(b.name || "Catalog item"),
            serviceType: b.service_type || null,
            unitType: String(b.unit_type || "sq_ft"),
            unitPrice: new Prisma.Decimal(Number(b.unit_price) || 0),
            description: b.description || null,
          },
        }),
      );
      res.status(201).json({ success: true, data: row });
    } catch (error) {
      next(error);
    }
  },
);
