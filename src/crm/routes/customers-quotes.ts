import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec, asSnakeBuilder } from "../http.js";
import { canViewPricing, withPricingGate } from "../../lib/pricing/visibility.js";
import { recordActivity } from "../../lib/activity/record.js";
import { normalizeQuoteStatus } from "../../lib/quotes/transitions.js";
import { syncLeadForQuoteStatus } from "../../lib/pipeline/move.js";
import { prisma } from "../../lib/prisma.js";
import {
  computeNextQuoteNumber,
  defaultValidUntil,
  formatQuoteNumber,
  parseDateInput,
  parseQuoteSettings,
} from "../../lib/settings/quotes.js";
import { documentAddressLine, documentLicenseLine } from "../../lib/settings/organization.js";
import { buildQuotePdf, pdfLinesFromDbItems, pdfPaymentItemsFromSchedule } from "../../lib/quotes/pdf.js";
import { storage } from "../../lib/storage/index.js";

export const customersQuotesRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asOptionalUuid(value: unknown): string | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return UUID_RE.test(s) ? s : null;
}

function lineItemUnitPrice(it: {
  unit_price?: unknown;
  rate?: unknown;
  sell_price?: unknown;
}): number {
  const n = Number(it.unit_price ?? it.rate ?? it.sell_price);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function lineItemDescription(it: {
  name?: unknown;
  description?: unknown;
}): string {
  const name = it.name != null ? String(it.name).trim() : "";
  const desc = it.description != null ? String(it.description).trim() : "";
  if (name && desc) return `${name}\n${desc}`;
  return name || desc || "Item";
}

function lineItemAmount(
  it: { amount?: unknown; quantity?: unknown; unit_price?: unknown; rate?: unknown; sell_price?: unknown },
  qty: number,
  unitPrice: number,
): number {
  const explicit = Number(it.amount);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Math.round(qty * unitPrice * 100) / 100;
}

async function buildQuotePdfForCrm(organizationId: string, quoteId: string) {
  const quote = await withTenantTransaction(organizationId, async (tx) =>
    tx.quote.findFirst({
      where: { id: quoteId },
      include: {
        customer: { select: { name: true, email: true, phone: true } },
        builder: {
          select: {
            company: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        property: {
          select: { line1: true, line2: true, city: true, state: true, postalCode: true, label: true },
        },
        salesperson: { select: { name: true, email: true } },
        paymentSchedule: { include: { items: { orderBy: { sortOrder: "asc" } } } },
        lineItems: { orderBy: { sortOrder: "asc" } },
        rooms: { orderBy: { sortOrder: "asc" } },
        optionGroups: { orderBy: { sortOrder: "asc" } },
      },
    }),
  );
  if (!quote) return null;

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const orgAny = org as Record<string, unknown>;
  const qs = parseQuoteSettings(orgAny.quoteSettings);
  const builderName = quote.builder
    ? quote.builder.company ||
      [quote.builder.firstName, quote.builder.lastName].filter(Boolean).join(" ").trim()
    : null;
  const isBuilder = Boolean(quote.builderId);
  const customerName = isBuilder
    ? builderName || quote.customer?.name || null
    : quote.customer?.name || builderName || null;
  const customerEmail =
    (isBuilder ? quote.builder?.email : null) || quote.customer?.email || null;
  const customerPhone =
    (isBuilder ? quote.builder?.phone : null) || quote.customer?.phone || null;
  const street = quote.property
    ? [quote.property.line1, quote.property.line2].filter(Boolean).join(", ")
    : null;
  const cityLine = quote.property
    ? [quote.property.city, quote.property.state, quote.property.postalCode].filter(Boolean).join(", ")
    : null;
  const total = Number(quote.total);
  const scheduleItems = pdfPaymentItemsFromSchedule(total, quote.paymentSchedule?.items);
  const depositAmount = scheduleItems[0]?.amount ?? null;
  const buffer = await buildQuotePdf({
    organizationName: org.name,
    organizationContact: [org.contactPhone, org.contactEmail].filter(Boolean).join(" · "),
    organizationAddress: documentAddressLine({
      addressPrivate: orgAny.addressPrivate !== false,
      addressLine1: (orgAny.addressLine1 as string | null) ?? null,
      addressLine2: (orgAny.addressLine2 as string | null) ?? null,
      city: (orgAny.city as string | null) ?? null,
      state: (orgAny.state as string | null) ?? null,
      postalCode: (orgAny.postalCode as string | null) ?? null,
    }),
    organizationLicense: documentLicenseLine({
      showLicenseOnDocuments: Boolean(orgAny.showLicenseOnDocuments),
      licenseNumber: (orgAny.licenseNumber as string | null) ?? null,
      licenseState: (orgAny.licenseState as string | null) ?? null,
    }),
    title: quote.title,
    number: quote.quoteNumber || quote.number,
    status: quote.status,
    issueDate: quote.createdAt,
    customerName,
    customerEmail,
    customerPhone,
    quoteParty: isBuilder ? "builder" : "customer",
    projectName: quote.property?.label || quote.title,
    projectAddress: street,
    projectCityLine: cityLine,
    validUntil: quote.validUntil,
    terms: quote.terms,
    clientMessage: quote.clientMessage,
    notes: quote.notes,
    floorAreaSqft: Number(quote.areaSqft) || null,
    rooms: (quote.rooms || []).map((r) => ({ name: r.name, areaSqft: Number(r.areaSqft) })),
    optionGroups: (quote.optionGroups || []).map((g) => ({ id: g.id, name: g.name })),
    selectedOptionGroupId: quote.selectedOptionGroupId,
    lines: pdfLinesFromDbItems(quote.lineItems || []),
    clientView: quote.clientView as never,
    subtotal: Number(quote.subtotal),
    taxTotal: Number(quote.taxTotal),
    discountType: quote.discountType,
    discountValue: Number(quote.discountValue),
    total,
    depositAmount,
    paymentSchedule: scheduleItems,
    preparedBy: quote.salesperson
      ? { name: quote.salesperson.name, email: quote.salesperson.email, title: null }
      : {
          name: qs.owner_signature.name,
          title: qs.owner_signature.title,
          email: org.contactEmail,
        },
    signatureUrl: quote.signatureUrl,
    signedByName: quote.signedByName,
    signedAt: quote.signedAt,
    ownerSignature: {
      name: qs.owner_signature.name,
      title: qs.owner_signature.title,
      imageUrl: qs.owner_signature.image_url,
    },
  });

  return { buffer, quote, number: quote.quoteNumber || String(quote.number) };
}

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
  pricingMode?: string;
  customPricingRates?: unknown;
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
    customer_type: normalizeCustomerType(c.customerType),
    pricing_mode: c.pricingMode === "custom" ? "custom" : "table",
    custom_pricing_rates: normalizeCustomPricingRates(c.customPricingRates),
    company: c.company,
    notes: c.notes,
    lead_id: c.leadId,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function normalizeCustomerType(raw: unknown): string {
  const v = String(raw || "particular").toLowerCase();
  if (v === "builder" || v === "contractor" || v === "loja" || v === "particular") return v;
  if (v === "commercial") return "loja";
  if (v === "residential" || v === "customer" || v === "property_manager" || v === "investor") return "particular";
  return "particular";
}

function normalizePricingMode(raw: unknown): "table" | "custom" {
  return String(raw || "table").toLowerCase() === "custom" ? "custom" : "table";
}

function normalizeCustomPricingRates(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(k || "").trim();
    const n = Number(v);
    if (!id || !Number.isFinite(n) || n < 0) continue;
    out[id] = Math.round(n * 100) / 100;
  }
  return out;
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
  discountType: string | null;
  discountValue: unknown;
  notes: string | null;
  terms: string | null;
  serviceType: string | null;
  customerId: string | null;
  leadId: string | null;
  builderId: string | null;
  publicToken: string | null;
  invoicePdfPath: string | null;
  validUntil: Date | null;
  viewedAt: Date | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  customer?: { name: string } | null;
  lineItems?: Array<{
    id: string;
    name: string | null;
    description: string;
    quantity: unknown;
    unit: string;
    unitCost: unknown;
    unitPrice: unknown;
    amount: unknown;
    itemType: string;
    sortOrder: number;
    meta: unknown;
  }>;
}) {
  const payload =
    q.payload && typeof q.payload === "object" && !Array.isArray(q.payload)
      ? (q.payload as Record<string, unknown>)
      : {};
  const unitToSf = (u: string) => {
    const x = String(u || "sqft").toLowerCase();
    if (x === "sqft" || x === "sq_ft" || x === "sq ft") return "sq_ft";
    if (x === "lf" || x === "linear" || x === "lin_ft") return "lin_ft";
    if (x === "hour" || x === "hr" || x === "hours") return "hour";
    if (x === "fixed" || x === "each" || x === "ea") return "fixed";
    return x || "sq_ft";
  };
  return {
    id: q.id,
    number: q.number,
    quote_number: q.quoteNumber || String(q.number),
    title: q.title,
    status: normalizeQuoteStatus(q.status),
    status_raw: q.status,
    flooring_type: q.flooringType,
    area_sqft: dec(q.areaSqft),
    waste_percent: dec(q.wastePercent),
    material_cost: dec(q.materialCost),
    labor_cost: dec(q.laborCost),
    material_markup: dec(q.materialMarkup),
    labor_markup: dec(q.laborMarkup),
    subtotal: dec(q.subtotal),
    total: dec(q.total),
    total_amount: dec(q.total),
    tax_total: dec(q.taxTotal),
    discount_type: q.discountType === "percent" ? "percentage" : q.discountType || "percentage",
    discount_value: dec(q.discountValue),
    notes: q.notes,
    terms: q.terms,
    terms_conditions: q.terms,
    service_type: q.serviceType,
    customer_id: q.customerId,
    customer_name: q.customer?.name ?? null,
    lead_id: q.leadId,
    builder_id: q.builderId,
    public_token: q.publicToken,
    has_invoice_pdf: Boolean(q.invoicePdfPath),
    invoice_pdf_url: q.invoicePdfPath ? `/api/quotes/${q.id}/invoice-pdf` : null,
    job_name: payload.job_name != null ? String(payload.job_name) : q.title,
    job_address: payload.job_address != null ? String(payload.job_address) : null,
    quote_party: payload.quote_party != null ? String(payload.quote_party) : null,
    expiration_date: q.validUntil,
    viewed_at: q.viewedAt,
    email_sent_at: payload.email_sent_at || payload.sent_at || null,
    pdf_viewed_at: payload.pdf_viewed_at || null,
    payload: q.payload,
    created_at: q.createdAt,
    updated_at: q.updatedAt,
    items: (q.lineItems || []).map((li) => {
      const meta =
        li.meta && typeof li.meta === "object" && !Array.isArray(li.meta)
          ? (li.meta as Record<string, unknown>)
          : {};
      const unitPrice = dec(li.unitPrice);
      const name =
        (li.name && String(li.name).trim()) ||
        (meta.floor_type != null ? String(meta.floor_type) : "") ||
        String(li.description || "").split("/")[0].trim() ||
        "Item";
      return {
        id: li.id,
        name,
        description: li.description,
        quantity: dec(li.quantity),
        unit: li.unit,
        unit_type: unitToSf(li.unit),
        unit_price: unitPrice,
        rate: unitPrice,
        amount: dec(li.amount),
        item_type: li.itemType,
        sort_order: li.sortOrder,
        cost_price: dec(li.unitCost),
        sell_price: unitPrice,
        markup_percentage: meta.markup_percentage != null ? Number(meta.markup_percentage) : null,
        catalog_customer_notes: meta.catalog_customer_notes != null ? String(meta.catalog_customer_notes) : null,
        service_type: meta.service_type != null ? String(meta.service_type) : null,
        service_catalog_id: meta.service_catalog_id != null ? String(meta.service_catalog_id) : null,
        product_id: meta.product_id != null ? String(meta.product_id) : null,
        notes: meta.notes != null ? String(meta.notes) : null,
      };
    }),
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
          pricing_mode: z.string().optional(),
          custom_pricing_rates: z
            .record(z.string(), z.union([z.number(), z.string()]))
            .optional()
            .nullable(),
          company: z.string().optional().nullable(),
          notes: z.string().optional().nullable(),
          lead_id: z.string().uuid().optional().nullable(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid customer payload" });
        return;
      }
      const pricingMode = normalizePricingMode(parsed.data.pricing_mode);
      const customRates =
        pricingMode === "custom"
          ? normalizeCustomPricingRates(parsed.data.custom_pricing_rates)
          : {};
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const created = await tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            email: parsed.data.email || null,
            phone: parsed.data.phone || null,
            address: parsed.data.address || null,
            customerType: normalizeCustomerType(parsed.data.customer_type),
            pricingMode,
            customPricingRates: customRates,
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
            customerType: normalizeCustomerType(req.body?.customer_type || "particular"),
            pricingMode: normalizePricingMode(req.body?.pricing_mode),
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
            customerType: body.customer_type !== undefined ? normalizeCustomerType(body.customer_type) : undefined,
            pricingMode: body.pricing_mode !== undefined ? normalizePricingMode(body.pricing_mode) : undefined,
            customPricingRates:
              body.custom_pricing_rates !== undefined || body.pricing_mode !== undefined
                ? normalizePricingMode(body.pricing_mode ?? existing.pricingMode) === "custom"
                  ? normalizeCustomPricingRates(
                      body.custom_pricing_rates !== undefined
                        ? body.custom_pricing_rates
                        : existing.customPricingRates,
                    )
                  : {}
                : undefined,
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

async function nextQuoteNumber(tx: TenantPrisma, organizationId: string, configuredNext?: number | null) {
  const last = await tx.quote.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return computeNextQuoteNumber(last?.number, configuredNext);
}

/** Company defaults applied to quotes created in the CRM (Configurações › Orçamentos). */
async function loadQuoteOrgDefaults(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      quoteNumberPrefix: true,
      quoteNextNumber: true,
      quoteValidityDays: true,
      defaultQuoteTerms: true,
      quoteTaxRate: true,
      quoteSettings: true,
    },
  });
  return { ...org, clientView: parseQuoteSettings(org.quoteSettings).client_view };
}

/** The builder sends `terms_conditions`; older callers send `terms`. */
function termsFromBody(body: Record<string, unknown>): string | null | undefined {
  const raw = body.terms_conditions !== undefined ? body.terms_conditions : body.terms;
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw);
  return s.trim() ? s : null;
}

customersQuotesRouter.post(
  "/api/quotes/full",
  requireCrmAuth,
  requireCrmPermission("quotes.create"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const defaults = await loadQuoteOrgDefaults(req.organizationId!);
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const number = await nextQuoteNumber(tx, req.organizationId!, defaults.quoteNextNumber);
        const items = Array.isArray(body.items) ? body.items : Array.isArray(body.line_items) ? body.line_items : [];
        const bodyTerms = termsFromBody(body);
        const bodyValidUntil = parseDateInput(body.expiration_date);
        const subtotal = items.reduce(
          (s: number, it: { amount?: number; quantity?: number; unit_price?: number; rate?: number; sell_price?: number }) => {
            const qty = Number(it.quantity) || 0;
            const unitPrice = lineItemUnitPrice(it);
            return s + lineItemAmount(it, qty, unitPrice);
          },
          0,
        );
        const tax = Number(body.tax_total || body.tax || 0);
        const total = Number(body.total != null ? body.total : subtotal + tax);
        const customerId = asOptionalUuid(body.customer_id);
        const leadId = asOptionalUuid(body.lead_id);
        const builderId = asOptionalUuid(body.builder_id);
        const quote = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            quoteNumber: body.quote_number || formatQuoteNumber(defaults.quoteNumberPrefix, number),
            title: String(body.title || body.job_name || body.service_type || `Quote ${number}`),
            validUntil: bodyValidUntil ?? defaultValidUntil(defaults.quoteValidityDays),
            clientView: defaults.clientView as Prisma.InputJsonValue,
            taxRate: defaults.quoteTaxRate,
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
            terms: bodyTerms !== undefined ? bodyTerms : defaults.defaultQuoteTerms || null,
            serviceType: body.service_type || null,
            customerId,
            leadId,
            builderId,
            publicToken: randomBytes(16).toString("hex"),
            payload: body,
            lineItems: {
              create: items.map(
                (
                  it: {
                    name?: string;
                    description?: string;
                    quantity?: number;
                    unit?: string;
                    unit_type?: string;
                    unit_price?: number;
                    rate?: number;
                    sell_price?: number;
                    amount?: number;
                    item_type?: string;
                  },
                  idx: number,
                ) => {
                  const qty = Number(it.quantity) || 0;
                  const unitPrice = lineItemUnitPrice(it);
                  const amount = lineItemAmount(it, qty, unitPrice);
                  return {
                    organizationId: req.organizationId!,
                    description: lineItemDescription(it),
                    quantity: new Prisma.Decimal(qty),
                    unit: String(it.unit || it.unit_type || "sq_ft"),
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
        await syncLeadForQuoteStatus(tx, {
          organizationId: req.organizationId!,
          quoteId: quote.id,
          previousStatus: null,
          nextStatus: quote.status,
          actorId: req.user?.id,
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
            (s: number, it: { amount?: number; quantity?: number; unit_price?: number; rate?: number; sell_price?: number }) => {
              const qty = Number(it.quantity) || 0;
              const unitPrice = lineItemUnitPrice(it);
              return s + lineItemAmount(it, qty, unitPrice);
            },
            0,
          );
          tax = Number(body.tax_total != null ? body.tax_total : tax);
          total = Number(body.total != null ? body.total : subtotal + tax);
          await tx.quoteLineItem.deleteMany({ where: { quoteId: id } });
          await tx.quoteLineItem.createMany({
            data: items.map(
              (
                it: {
                  name?: string;
                  description?: string;
                  quantity?: number;
                  unit?: string;
                  unit_type?: string;
                  unit_price?: number;
                  rate?: number;
                  sell_price?: number;
                  amount?: number;
                  item_type?: string;
                },
                idx: number,
              ) => {
                const qty = Number(it.quantity) || 0;
                const unitPrice = lineItemUnitPrice(it);
                const amount = lineItemAmount(it, qty, unitPrice);
                return {
                  organizationId: req.organizationId!,
                  quoteId: id,
                  description: lineItemDescription(it),
                  quantity: new Prisma.Decimal(qty),
                  unit: String(it.unit || it.unit_type || "sq_ft"),
                  unitPrice: new Prisma.Decimal(unitPrice),
                  amount: new Prisma.Decimal(amount),
                  itemType: String(it.item_type || "service"),
                  sortOrder: idx,
                };
              },
            ),
          });
        }
        const updated = await tx.quote.update({
          where: { id },
          data: {
            title: body.title !== undefined ? String(body.title) : body.job_name !== undefined ? String(body.job_name || existing.title) : undefined,
            status: body.status !== undefined ? String(body.status) : undefined,
            flooringType: body.flooring_type !== undefined ? String(body.flooring_type) : undefined,
            notes: body.notes !== undefined ? body.notes : undefined,
            terms: termsFromBody(body),
            validUntil: parseDateInput(body.expiration_date),
            serviceType: body.service_type !== undefined ? body.service_type : undefined,
            customerId: body.customer_id !== undefined ? asOptionalUuid(body.customer_id) : undefined,
            leadId: body.lead_id !== undefined ? asOptionalUuid(body.lead_id) : undefined,
            builderId: body.builder_id !== undefined ? asOptionalUuid(body.builder_id) : undefined,
            subtotal: new Prisma.Decimal(subtotal),
            taxTotal: new Prisma.Decimal(tax),
            total: new Prisma.Decimal(total),
            payload: body,
          },
          include: { customer: { select: { name: true } }, lineItems: { orderBy: { sortOrder: "asc" } } },
        });
        // Sent → lead to "Quote Sent"; approved/converted → "Won" (was never synced from the CRM).
        await syncLeadForQuoteStatus(tx, {
          organizationId: req.organizationId!,
          quoteId: id,
          previousStatus: existing.status,
          nextStatus: updated.status,
          actorId: req.user?.id,
        });
        return updated;
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
        const defaults = await loadQuoteOrgDefaults(req.organizationId!);
        const number = await nextQuoteNumber(tx, req.organizationId!, defaults.quoteNextNumber);
        return tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            quoteNumber: formatQuoteNumber(defaults.quoteNumberPrefix, number),
            validUntil: defaultValidUntil(defaults.quoteValidityDays),
            clientView: src.clientView ?? (defaults.clientView as Prisma.InputJsonValue),
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

customersQuotesRouter.post(
  "/api/quotes/:id/generate-pdf",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!asOptionalUuid(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const built = await buildQuotePdfForCrm(req.organizationId!, id);
      if (!built) {
        res.status(404).json({ success: false, error: "Orçamento não encontrado" });
        return;
      }
      try {
        const stored = await storage.upload({
          key: `orgs/${req.organizationId}/quotes/${id}/orcamento-${Date.now()}.pdf`,
          body: built.buffer,
          contentType: "application/pdf",
        });
        await withTenantTransaction(req.organizationId!, async (tx) =>
          tx.quote.update({
            where: { id },
            data: { invoicePdfPath: stored.url || stored.key },
          }),
        );
      } catch (storeErr) {
        console.warn("[quotes] generate-pdf store failed (PDF still available via stream):", storeErr);
      }
      res.json({
        success: true,
        invoice_pdf_url: `/api/quotes/${id}/invoice-pdf`,
      });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get(
  "/api/quotes/:id/invoice-pdf",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!asOptionalUuid(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const built = await buildQuotePdfForCrm(req.organizationId!, id);
      if (!built) {
        res.status(404).json({ success: false, error: "Orçamento não encontrado" });
        return;
      }
      const safeName = String(built.number).replace(/[^\w.-]+/g, "-");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="orcamento-${safeName}.pdf"`);
      res.send(built.buffer);
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
        const { nextInvoiceNumber } = await import("../../lib/payments/engine.js");
        const quote = await tx.quote.findFirst({ where: { id: quoteId } });
        if (!quote) return null;
        const invoiceNumber =
          body.invoice_number || (await nextInvoiceNumber(tx, req.organizationId!));
        return tx.quoteInvoice.create({
          data: {
            organizationId: req.organizationId!,
            quoteId,
            customerId: quote.customerId,
            invoiceNumber,
            invoiceType: String(body.invoice_type || body.type || "other"),
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

async function listInvoicesForCrm(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const skip = (page - 1) * limit;
    const statusRaw = String(req.query.status || "").trim().toLowerCase();
    const q = String(req.query.q || req.query.search || "").trim();

    const where: Prisma.QuoteInvoiceWhereInput = {};
    if (statusRaw && statusRaw !== "all") {
      if (statusRaw === "sent") {
        where.OR = [{ status: "sent" }, { status: "paid" }, { issuedAt: { not: null } }];
      } else if (statusRaw === "overdue") {
        where.status = { notIn: ["paid", "void"] };
        where.dueDate = { lt: new Date() };
      } else {
        where.status = statusRaw;
      }
    } else {
      where.status = { not: "void" };
    }

    if (q) {
      where.AND = [
        {
          OR: [
            { invoiceNumber: { contains: q, mode: "insensitive" } },
            { quote: { quoteNumber: { contains: q, mode: "insensitive" } } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customer: { email: { contains: q, mode: "insensitive" } } },
            { quote: { title: { contains: q, mode: "insensitive" } } },
          ],
        },
      ];
    }

    const [total, rows, amountAgg] = await withTenantTransaction(req.organizationId!, async (tx) => {
      return [
        await tx.quoteInvoice.count({ where }),
        await tx.quoteInvoice.findMany({
          where,
          orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
          skip,
          take: limit,
          include: {
            quote: { select: { title: true, quoteNumber: true, number: true } },
            customer: { select: { name: true, email: true } },
            receipts: true,
          },
        }),
        await tx.quoteInvoice.aggregate({ where, _sum: { amount: true } }),
      ] as const;
    });

    const data = rows.map((inv) => {
      const amount = dec(inv.amount);
      const paidAmount = inv.receipts.reduce((s, r) => s + dec(r.amount), 0);
      return {
        id: inv.id,
        quote_id: inv.quoteId,
        quote_title: inv.quote.title,
        quote_number: inv.quote.quoteNumber || String(inv.quote.number),
        invoice_number: inv.invoiceNumber,
        invoice_type: inv.invoiceType,
        status: inv.status,
        amount,
        paid_amount: paidAmount,
        paid_total: paidAmount,
        remaining_amount: Math.max(0, amount - paidAmount),
        due_date: inv.dueDate,
        paid_at: inv.paidAt,
        email_sent_at: inv.issuedAt,
        created_at: inv.createdAt,
        updated_at: inv.updatedAt,
        customer_name: inv.customer?.name || null,
        customer_email: inv.customer?.email || null,
        has_pdf: !!inv.pdfPath,
      };
    });

    res.json({
      success: true,
      data: withPricingGate(req.user, data),
      total,
      total_amount: dec(amountAgg._sum.amount),
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
}

customersQuotesRouter.get("/api/invoices", requireCrmAuth, listInvoicesForCrm);
/** SF-compatible alias used by invoices list UI */
customersQuotesRouter.get("/api/quote-invoices", requireCrmAuth, listInvoicesForCrm);

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
  "/api/quote-invoices/:id/receipts",
  requireCrmAuth,
  requireCrmPermission("invoices.record_payment"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body || {};
      const receipt = await withTenantTransaction(req.organizationId!, async (tx) => {
        const { recordInvoicePayment } = await import("../../lib/payments/engine.js");
        return recordInvoicePayment(tx, {
          organizationId: req.organizationId!,
          invoiceId: String(req.params.id),
          amount: Number(body.amount),
          method: body.method || body.payment_method || null,
          referenceNumber: body.reference_number || null,
          notes: body.notes || null,
          paidAt: body.paid_at || body.payment_date ? new Date(body.paid_at || body.payment_date) : new Date(),
          actorId: req.user?.id ?? null,
          externalPaymentId: body.external_payment_id || null,
          processor: body.processor || null,
        });
      });
      res.status(201).json({
        success: true,
        data: withPricingGate(req.user, {
          id: receipt.id,
          amount: dec(receipt.amount),
          paid_at: receipt.paidAt,
          method: receipt.method,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

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
