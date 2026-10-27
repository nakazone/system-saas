import { Router } from "express";
import { Prisma } from "@prisma/client";
import { discountFieldsFromBody, readQuoteDiscount } from "../../lib/quotes/discount.js";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../../lib/auth/password.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, requireCrmPermission, dec, asSnakeBuilder } from "../http.js";
import { canViewPricing, withPricingGate } from "../../lib/pricing/visibility.js";
import { recordActivity } from "../../lib/activity/record.js";
import { normalizeQuoteStatus } from "../../lib/quotes/transitions.js";
import { moveLeadForQuoteEvent, syncLeadForQuoteStatus } from "../../lib/pipeline/move.js";
import { prisma } from "../../lib/prisma.js";
import {
  computeNextQuoteNumber,
  defaultValidUntil,
  formatQuoteNumber,
  parseDateInput,
  parseQuoteSettings,
  resolveOwnerSignatureForQuote,
} from "../../lib/settings/quotes.js";
import { documentAddressLine, documentLicenseLine } from "../../lib/settings/organization.js";
import { buildQuotePdf, imageContentType, loadLogoBuffer, pdfLinesFromDbItems, pdfPaymentItemsFromSchedule } from "../../lib/quotes/pdf.js";
import { storage } from "../../lib/storage/index.js";
import { issuePublicAccessToken } from "../../lib/quotes/public-token.js";
import { createDiscountedQuoteCopy } from "../../lib/quotes/discounted-copy.js";
import { sendCustomerEmail } from "../../lib/email/index.js";
import {
  buildQuoteAccessEmailHtml,
  buildQuoteAccessEmailText,
  defaultQuoteAccessSubject,
} from "../../lib/email/quote-access.js";
import { publicBaseUrl } from "../../lib/http/public-url.js";
import { formatUsPhone } from "../../lib/phone.js";
import { formatPersonName } from "../../lib/name.js";

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

/**
 * Stored description is "Name\nDescription" (PDF / templates read the first line as the name).
 * The editor wants only the description: drop leading lines equal to the name — older saves
 * prepended the name again on every save ("Name\nName\nName\n…").
 */
export function editorDescription(name: string, stored: string | null | undefined): string {
  const n = String(name || "").trim().toLowerCase();
  const lines = String(stored || "").split("\n");
  while (lines.length && n && lines[0]!.trim().toLowerCase() === n) lines.shift();
  return lines.join("\n").trim();
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

type QuoteLineBody = {
  name?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unit_type?: unknown;
  unit_price?: unknown;
  rate?: unknown;
  sell_price?: unknown;
  amount?: unknown;
  item_type?: unknown;
  service_type?: unknown;
  notes?: unknown;
  catalog_customer_notes?: unknown;
  service_catalog_id?: unknown;
  product_id?: unknown;
  pricing_item_id?: unknown;
  cost_price?: unknown;
  markup_percentage?: unknown;
};

function lineItemName(it: QuoteLineBody): string | null {
  const name = it.name != null ? String(it.name).trim() : "";
  return name || null;
}

/** Persist category + notes so PDF/public/mapQuote can read service_type. */
function lineItemMetaJson(it: QuoteLineBody): Prisma.InputJsonValue | undefined {
  const meta: Record<string, unknown> = {};
  if (it.service_type != null && String(it.service_type).trim()) {
    meta.service_type = String(it.service_type).trim();
  }
  if (it.notes != null && String(it.notes).trim()) {
    meta.notes = String(it.notes).trim();
  }
  if (it.catalog_customer_notes != null && String(it.catalog_customer_notes).trim()) {
    meta.catalog_customer_notes = String(it.catalog_customer_notes).trim();
  }
  if (it.service_catalog_id != null && String(it.service_catalog_id).trim()) {
    meta.service_catalog_id = String(it.service_catalog_id).trim();
  }
  if (it.product_id != null && String(it.product_id).trim()) {
    meta.product_id = String(it.product_id).trim();
  }
  if (it.pricing_item_id != null && /^[0-9a-f-]{36}$/i.test(String(it.pricing_item_id))) {
    meta.pricing_item_id = String(it.pricing_item_id);
  }
  if (it.cost_price != null && Number.isFinite(Number(it.cost_price))) {
    meta.cost_price = Number(it.cost_price);
  }
  if (it.markup_percentage != null && Number.isFinite(Number(it.markup_percentage))) {
    meta.markup_percentage = Number(it.markup_percentage);
  }
  return Object.keys(meta).length ? (meta as Prisma.InputJsonValue) : undefined;
}

function lineItemCreateRow(it: QuoteLineBody, idx: number, organizationId: string, quoteId?: string) {
  const qty = Number(it.quantity) || 0;
  const unitPrice = lineItemUnitPrice(it);
  const amount = lineItemAmount(it, qty, unitPrice);
  const meta = lineItemMetaJson(it);
  return {
    organizationId,
    ...(quoteId ? { quoteId } : {}),
    name: lineItemName(it),
    description: lineItemDescription(it),
    quantity: new Prisma.Decimal(qty),
    unit: String(it.unit || it.unit_type || "sq_ft"),
    unitPrice: new Prisma.Decimal(unitPrice),
    amount: new Prisma.Decimal(amount),
    itemType: String(it.item_type || "service"),
    sortOrder: idx,
    ...(meta !== undefined ? { meta } : {}),
  };
}

function payloadLineItems(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const p = payload as Record<string, unknown>;
  const items = Array.isArray(p.items) ? p.items : Array.isArray(p.line_items) ? p.line_items : [];
  return items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}

function serviceTypeFromMetaOrPayload(
  meta: Record<string, unknown>,
  payloadItem: Record<string, unknown> | undefined,
): string | null {
  if (meta.service_type != null && String(meta.service_type).trim()) {
    return String(meta.service_type).trim();
  }
  if (payloadItem?.service_type != null && String(payloadItem.service_type).trim()) {
    return String(payloadItem.service_type).trim();
  }
  return null;
}

function clearedClientSignature() {
  return {
    signatureUrl: null,
    signedByName: null,
    signedAt: null,
    approvedIp: null,
    approvedUserAgent: null,
    signedDocumentSha256: null,
    approvedLat: null,
    approvedLng: null,
    approvedGpsAccuracyM: null,
  };
}

function quoteHadClientApproval(quote: { status: string; signatureUrl?: string | null; signedByName?: string | null }) {
  return normalizeQuoteStatus(quote.status) === "approved" || Boolean(quote.signatureUrl || quote.signedByName);
}

function lineFingerprint(
  items: Array<{ name?: string | null; description?: string | null; quantity?: unknown; unitPrice?: unknown; unit_price?: unknown; rate?: unknown; sell_price?: unknown }>,
  fromDb: boolean,
) {
  return items
    .map((it) => {
      const name = String(it.name || it.description || "").trim();
      const qty = Math.round((Number(it.quantity) || 0) * 100);
      const price = fromDb
        ? Math.round(dec(it.unitPrice as never) * 100)
        : Math.round(lineItemUnitPrice(it) * 100);
      return `${name}|${qty}|${price}`;
    })
    .join("\n");
}

async function quotePdfInputForCrm(organizationId: string, quoteId: string) {
  const quote = await withTenantTransaction(organizationId, async (tx) => {
    const row = await tx.quote.findFirst({
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
        salesperson: { select: { name: true, email: true, signatureUrl: true } },
        paymentSchedule: { include: { items: { orderBy: { sortOrder: "asc" } } } },
        lineItems: { orderBy: { sortOrder: "asc" } },
        rooms: { orderBy: { sortOrder: "asc" } },
        optionGroups: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!row || row.salesperson) return row;
    const ev = await tx.activityEvent.findFirst({
      where: { entityType: "quote", entityId: quoteId, actorType: "user", actorId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { actorId: true },
    });
    if (!ev?.actorId) return row;
    const user = await tx.user.findFirst({
      where: { id: ev.actorId },
      select: { name: true, email: true, signatureUrl: true },
    });
    if (!user) return row;
    return { ...row, salesperson: user };
  });
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
  const input: Parameters<typeof buildQuotePdf>[0] = {
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
    organizationLogoUrl: (orgAny.logoUrl as string | null) ?? null,
    brandPrimary: (orgAny.primaryColor as string | null) ?? null,
    brandAccent: (orgAny.accentColor as string | null) ?? null,
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
    lines: (() => {
      const payloadItems = payloadLineItems(quote.payload);
      return pdfLinesFromDbItems(quote.lineItems || []).map((line, idx) => {
        if (line.serviceType) return line;
        const st = payloadItems[idx]?.service_type;
        if (st == null || !String(st).trim()) return line;
        return { ...line, serviceType: String(st).trim() };
      });
    })(),
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
    ownerSignature: resolveOwnerSignatureForQuote(qs.owner_signature, quote.salesperson),
    inclusions: qs.inclusions,
  };

  return { input, quote, schedule: quote.paymentSchedule?.items || [] };
}

async function buildQuotePdfForCrm(organizationId: string, quoteId: string) {
  const built = await quotePdfInputForCrm(organizationId, quoteId);
  if (!built) return null;
  const buffer = await buildQuotePdf(built.input);
  return { buffer, quote: built.quote, number: built.quote.quoteNumber || String(built.quote.number) };
}

/** Header data for the PDF-look paper (quote builder popup and list preview). */
async function quotePaperOrgForCrm(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const orgAny = org as Record<string, unknown>;
  const qs = parseQuoteSettings(orgAny.quoteSettings);
  return {
    organizationName: org.name,
    organizationContact: [org.contactPhone, org.contactEmail].filter(Boolean).join(" · "),
    organizationLicense: documentLicenseLine({
      showLicenseOnDocuments: Boolean(orgAny.showLicenseOnDocuments),
      licenseNumber: (orgAny.licenseNumber as string | null) ?? null,
      licenseState: (orgAny.licenseState as string | null) ?? null,
    }),
    organizationLogoUrl: (orgAny.logoUrl as string | null) ?? null,
    brandPrimary: (orgAny.primaryColor as string | null) ?? null,
    brandAccent: (orgAny.accentColor as string | null) ?? null,
    preparedBy: { name: qs.owner_signature.name, title: qs.owner_signature.title, email: org.contactEmail },
    inclusions: qs.inclusions,
  };
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

function normalizeYnStatus(raw: unknown): string | null {
  const v = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (v === "yes" || v === "sim") return "yes";
  if (v === "no" || v === "nao" || v === "não") return "no";
  if (v === "unknown" || v === "" || v === "null") return "unknown";
  return null;
}

/** Rewrite an auto calendar title when the client ID changes. Leaves custom titles alone. */
function retitleForClientCode(title: string, oldLabel: string, newLabel: string): string | null {
  const t = String(title || "").trim();
  if (!oldLabel || !t || oldLabel === newLabel) return null;
  if (t === oldLabel) return newLabel;
  for (const sep of [" — ", " – "]) {
    if (t.startsWith(oldLabel + sep)) return newLabel + t.slice(oldLabel.length);
  }
  return null;
}

/** Display label: "Name - ID" when clientCode is set; never mutates Customer.name. */
export function customerDisplayName(name: string | null | undefined, clientCode?: string | null): string {
  const n = String(name || "").trim();
  const code = String(clientCode || "").trim();
  if (!code) return n;
  if (!n) return code;
  return `${n} - ${code}`;
}

function mapCustomer(c: {
  id: string;
  name: string;
  clientCode?: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  customerType: string;
  pricingMode?: string;
  customPricingRates?: unknown;
  company: string | null;
  notes: string | null;
  contactName?: string | null;
  dumpsterStatus?: string | null;
  dumpsterNotes?: string | null;
  storageStatus?: string | null;
  storageNotes?: string | null;
  leadId: string | null;
  referredByCustomerId?: string | null;
  referralCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const clientCode = c.clientCode != null ? String(c.clientCode).trim() || null : null;
  return {
    id: c.id,
    name: c.name,
    client_code: clientCode,
    display_name: customerDisplayName(c.name, clientCode),
    email: c.email,
    phone: formatUsPhone(c.phone),
    address: c.address,
    customer_type: normalizeCustomerType(c.customerType),
    pricing_mode: c.pricingMode === "custom" ? "custom" : "table",
    custom_pricing_rates: normalizeCustomPricingRates(c.customPricingRates),
    company: c.company,
    notes: c.notes,
    responsible_name: c.contactName ?? null,
    dumpster_status: normalizeYnStatus(c.dumpsterStatus) || "unknown",
    dumpster_notes: c.dumpsterNotes ?? null,
    storage_status: normalizeYnStatus(c.storageStatus) || "unknown",
    storage_notes: c.storageNotes ?? null,
    lead_id: c.leadId,
    referred_by_customer_id: c.referredByCustomerId ?? null,
    referral_code: c.referralCode ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

async function resolveReferredById(
  tx: { customer: { findFirst: Function } },
  organizationId: string,
  raw: unknown,
  selfId?: string | null,
): Promise<string | null | undefined> {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const id = String(raw);
  if (selfId && id === selfId) throw new Error("Cliente não pode indicar a si mesmo.");
  const referrer = await tx.customer.findFirst({
    where: { id, organizationId },
    select: { id: true, customerType: true },
  });
  if (!referrer) throw new Error("Indicador não encontrado.");
  if (String(referrer.customerType || "").toLowerCase() !== "particular") {
    throw new Error("Só Particular pode indicar (programa de cashback).");
  }
  return referrer.id;
}

function normalizeCustomerType(raw: unknown): string {
  const v = String(raw || "particular")
    .toLowerCase()
    .trim();
  // Builder absorbs Contractor + Loja (one cadastro / pricing column).
  if (v === "contractor" || v === "loja" || v === "commercial") return "builder";
  if (v === "residential" || v === "customer" || v === "property_manager" || v === "investor") return "particular";
  if (v === "builder" || v === "particular") return v;
  // Org-defined types from Configurações › Tipos de cliente.
  if (/^[a-z][a-z0-9_]{0,39}$/.test(v)) return v;
  return "particular";
}

/** Person clients get title-case; company/builder names keep the typed casing (trimmed). */
function formatCustomerName(name: string, customerType: unknown): string {
  const t = normalizeCustomerType(customerType);
  if (t === "builder") return String(name || "").trim().replace(/\s+/g, " ");
  return formatPersonName(name);
}

function digitsOnlyPhone(raw: unknown): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : "";
}

function customerDupKey(c: { name: string; company: string | null; email: string | null; phone: string | null }) {
  const name = String(c.company || c.name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const email = String(c.email || "")
    .toLowerCase()
    .trim();
  const phone = digitsOnlyPhone(c.phone);
  return { name, email, phone };
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
  changeRequestNote?: string | null;
  terms: string | null;
  serviceType: string | null;
  customerId: string | null;
  leadId: string | null;
  builderId: string | null;
  workOrderId: string | null;
  publicToken: string | null;
  invoicePdfPath: string | null;
  validUntil: Date | null;
  viewedAt: Date | null;
  signedAt?: Date | null;
  signedByName?: string | null;
  signatureUrl?: string | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  customer?: { name: string; company?: string | null; clientCode?: string | null } | null;
  workOrder?: { number: number | null; status?: string | null } | null;
  builder?: {
    company?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  property?: {
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    label?: string | null;
  } | null;
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
  const payloadItems = payloadLineItems(q.payload);
  const builderCompany = q.builder?.company != null ? String(q.builder.company).trim() : "";
  const builderPerson = [q.builder?.firstName, q.builder?.lastName]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean)
    .join(" ");
  const builderName = builderCompany || builderPerson || null;
  const propertyLabel =
    (q.property?.label && String(q.property.label).trim()) ||
    [q.property?.line1, q.property?.city, q.property?.state].filter(Boolean).join(", ") ||
    null;
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
    discount_type: (() => {
      const d = readQuoteDiscount(q);
      return d.type === "fixed" ? "fixed" : "percentage";
    })(),
    discount_value: readQuoteDiscount(q).value,
    notes: q.notes,
    change_request_note: q.changeRequestNote ?? null,
    terms: q.terms,
    terms_conditions: q.terms,
    service_type: q.serviceType,
    customer_id: q.customerId,
    customer_name: customerDisplayName(q.customer?.name, q.customer?.clientCode) || q.customer?.name || null,
    client_code: q.customer?.clientCode != null ? String(q.customer.clientCode).trim() || null : null,
    job_number: q.workOrder?.number ?? null,
    work_order_status: q.workOrder?.status ?? null,
    customer_company: q.customer?.company ?? null,
    lead_id: q.leadId,
    builder_id: q.builderId,
    builder_name: builderName,
    builder_company: builderCompany || null,
    property_label: propertyLabel,
    work_order_id: q.workOrderId ?? null,
    signed_at: q.signedAt ?? null,
    signed_by_name: q.signedByName ?? null,
    client_signed_name: q.signedByName ?? null,
    has_client_signature: Boolean(q.signatureUrl || q.signedByName),
    client_signature_url: q.signatureUrl ?? null,
    public_token: q.publicToken,
    has_invoice_pdf: Boolean(q.invoicePdfPath),
    invoice_pdf_url: q.invoicePdfPath ? `/api/quotes/${q.id}/invoice-pdf` : null,
    job_name: payload.job_name != null ? String(payload.job_name) : q.title,
    job_address:
      (payload.job_address != null ? String(payload.job_address) : null) || propertyLabel,
    quote_party: payload.quote_party != null ? String(payload.quote_party) : null,
    expiration_date: q.validUntil,
    viewed_at: q.viewedAt,
    email_sent_at: payload.email_sent_at || payload.sent_at || null,
    pdf_viewed_at: payload.pdf_viewed_at || null,
    payload: q.payload,
    created_at: q.createdAt,
    updated_at: q.updatedAt,
    items: (q.lineItems || []).map((li, idx) => {
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
        description: editorDescription(name, li.description),
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
        service_type: serviceTypeFromMetaOrPayload(meta, payloadItems[idx]),
        service_catalog_id: meta.service_catalog_id != null ? String(meta.service_catalog_id) : null,
        pricing_item_id: meta.pricing_item_id != null ? String(meta.pricing_item_id) : null,
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
    const customerTypeRaw = req.query.customer_type || req.query.type || null;
    const search = String(req.query.q || req.query.search || "").trim();

    const [total, rows] = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where: Prisma.CustomerWhereInput = {};
      if (customerTypeRaw) {
        const t = normalizeCustomerType(customerTypeRaw);
        // Builder filter includes legacy contractor rows until migration runs everywhere.
        where.customerType = t === "builder" ? { in: ["builder", "contractor", "loja"] } : t;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { clientCode: { contains: search, mode: "insensitive" } },
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

customersQuotesRouter.get("/api/customers/duplicates", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.customer.findMany({ orderBy: { createdAt: "asc" } }),
    );
    const byName = new Map<string, typeof rows>();
    const byEmail = new Map<string, typeof rows>();
    const byPhone = new Map<string, typeof rows>();
    for (const c of rows) {
      const k = customerDupKey(c);
      if (k.name.length >= 3) {
        const list = byName.get(k.name) || [];
        list.push(c);
        byName.set(k.name, list);
      }
      if (k.email) {
        const list = byEmail.get(k.email) || [];
        list.push(c);
        byEmail.set(k.email, list);
      }
      if (k.phone) {
        const list = byPhone.get(k.phone) || [];
        list.push(c);
        byPhone.set(k.phone, list);
      }
    }
    const seen = new Set<string>();
    const groups: Array<{ reason: string; key: string; customers: ReturnType<typeof mapCustomer>[] }> = [];
    const pushGroup = (reason: string, key: string, list: typeof rows) => {
      if (list.length < 2) return;
      const ids = list
        .map((c) => c.id)
        .sort()
        .join(",");
      if (seen.has(ids)) return;
      seen.add(ids);
      groups.push({ reason, key, customers: list.map(mapCustomer) });
    };
    for (const [key, list] of byEmail) pushGroup("email", key, list);
    for (const [key, list] of byPhone) pushGroup("phone", key, list);
    for (const [key, list] of byName) pushGroup("name", key, list);
    res.json({ success: true, data: groups, total: groups.length });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.post(
  "/api/customers/merge",
  requireCrmAuth,
  requireCrmPermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const keepId = String(req.body?.keep_id || "");
      const mergeId = String(req.body?.merge_id || "");
      if (!keepId || !mergeId || keepId === mergeId) {
        res.status(400).json({ success: false, error: "Informe keep_id e merge_id diferentes." });
        return;
      }
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const keep = await tx.customer.findFirst({ where: { id: keepId } });
        const merge = await tx.customer.findFirst({ where: { id: mergeId } });
        if (!keep || !merge) return { ok: false as const, error: "Cliente não encontrado" };

        await tx.quote.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });
        await tx.workOrder.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });
        await tx.quoteInvoice.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });
        await tx.project.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });
        await tx.meeting.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });
        await tx.siteAssessment.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });
        await tx.scheduledMessage.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });
        await tx.property.updateMany({ where: { customerId: mergeId }, data: { customerId: keepId } });

        await tx.customer.update({
          where: { id: keepId },
          data: {
            email: keep.email || merge.email,
            phone: keep.phone || merge.phone,
            address: keep.address || merge.address,
            company: keep.company || merge.company,
            contactName: keep.contactName || merge.contactName,
            notes: keep.notes || merge.notes,
            customerType: normalizeCustomerType(keep.customerType || merge.customerType),
          },
        });
        await tx.customer.delete({ where: { id: mergeId } });
        const updated = await tx.customer.findFirst({ where: { id: keepId } });
        return { ok: true as const, customer: updated };
      });
      if (!result.ok) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true, data: result.customer ? mapCustomer(result.customer) : null });
    } catch (error) {
      next(error);
    }
  },
);

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

customersQuotesRouter.put(
  "/api/customers/:id/partner-access",
  requireCrmAuth,
  requireCrmPermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({ enabled: z.boolean(), reset_password: z.boolean().optional() })
        .safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Informe se o acesso ao portal deve ficar ativo." });
        return;
      }
      const customerId = String(req.params.id);
      const enabled = parsed.data.enabled;
      const resetPassword = enabled && parsed.data.reset_password === true;
      const tempPassword = enabled ? randomBytes(12).toString("base64url") : null;
      const passwordHash = tempPassword ? await hashPassword(tempPassword) : null;
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: customerId } });
        if (!customer) return { kind: "missing" as const };
        if (!["builder", "contractor"].includes(customer.customerType.toLowerCase())) {
          return { kind: "wrong_type" as const };
        }
        const linked = await tx.partnerUser.findMany({
          where: { customerId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (!enabled) {
          await tx.partnerUser.updateMany({ where: { customerId }, data: { status: "suspended" } });
          return { kind: "updated" as const, enabled: false, password: null };
        }
        const email = customer.email?.trim().toLowerCase();
        if (!email) return { kind: "email_required" as const };
        if (linked.length) {
          if (resetPassword && passwordHash) {
            await tx.partnerUser.updateMany({ where: { customerId }, data: { status: "active" } });
            await tx.partnerUser.update({
              where: { id: linked[0].id },
              data: { email, passwordHash, mustChangePassword: true },
            });
          } else {
            await tx.partnerUser.updateMany({ where: { customerId }, data: { status: "active" } });
          }
          return { kind: "updated" as const, enabled: true, password: resetPassword ? tempPassword : null };
        }
        const duplicate = await tx.partnerUser.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true },
        });
        if (duplicate) return { kind: "email_conflict" as const };
        if (!tempPassword || !passwordHash) return { kind: "email_required" as const };
        await tx.partnerUser.create({
          data: {
            organizationId: req.organizationId!,
            customerId,
            email,
            passwordHash,
            name: customer.contactName?.trim() || customer.name,
            companyName: customer.company || customer.name,
            status: "active",
            mustChangePassword: true,
          },
        });
        return { kind: "updated" as const, enabled: true, password: tempPassword };
      });
      if (result.kind === "missing") {
        res.status(404).json({ success: false, error: "Cliente não encontrado." });
        return;
      }
      if (result.kind === "wrong_type") {
        res.status(409).json({ success: false, error: "O portal está disponível para clientes do tipo Builder/Contractor." });
        return;
      }
      if (result.kind === "email_required") {
        res.status(400).json({ success: false, error: "Adicione um e-mail ao cadastro do cliente antes de liberar o portal." });
        return;
      }
      if (result.kind === "email_conflict") {
        res.status(409).json({ success: false, error: "Este e-mail já está vinculado a outra conta de parceiro." });
        return;
      }
      res.json({ success: true, data: { enabled: result.enabled, ...(result.password ? { temp_password: result.password } : {}) } });
    } catch (error) {
      next(error);
    }
  },
);

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
          client_code: z.string().max(80).optional().nullable(),
          responsible_name: z.string().optional().nullable(),
          dumpster_status: z.string().optional().nullable(),
          dumpster_notes: z.string().optional().nullable(),
          storage_status: z.string().optional().nullable(),
          storage_notes: z.string().optional().nullable(),
          lead_id: z.string().uuid().optional().nullable(),
          referred_by_customer_id: z.string().uuid().optional().nullable(),
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
      let referredByCustomerId: string | null = null;
      try {
        const resolved = await withTenantTransaction(req.organizationId!, (tx) =>
          resolveReferredById(tx, req.organizationId!, parsed.data.referred_by_customer_id, null),
        );
        if (resolved !== undefined) referredByCustomerId = resolved;
      } catch (e) {
        res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Indicador inválido" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const customerType = normalizeCustomerType(parsed.data.customer_type);
        const isOrgType = customerType === "builder";
        const dumpsterStatus = isOrgType ? normalizeYnStatus(parsed.data.dumpster_status) || "unknown" : null;
        const storageStatus = isOrgType ? normalizeYnStatus(parsed.data.storage_status) || "unknown" : null;
        const created = await tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            name: formatCustomerName(parsed.data.name, customerType),
            clientCode: String(parsed.data.client_code || "").trim() || null,
            email: parsed.data.email || null,
            phone: formatUsPhone(parsed.data.phone ?? null),
            address: parsed.data.address || null,
            customerType,
            pricingMode,
            customPricingRates: customRates,
            company: parsed.data.company || null,
            notes: parsed.data.notes || null,
            contactName: String(parsed.data.responsible_name || "").trim() || null,
            dumpsterStatus,
            dumpsterNotes:
              dumpsterStatus === "yes" ? String(parsed.data.dumpster_notes || "").trim() || null : null,
            storageStatus,
            storageNotes: storageStatus === "yes" ? String(parsed.data.storage_notes || "").trim() || null : null,
            leadId: parsed.data.lead_id || null,
            referredByCustomerId,
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
        const meta =
          lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata)
            ? (lead.metadata as Record<string, unknown>)
            : {};
        let referredByCustomerId: string | null = null;
        const refRaw = meta.referred_by_customer_id;
        if (typeof refRaw === "string" && refRaw) {
          const referrer = await tx.customer.findFirst({
            where: { id: refRaw, customerType: "particular" },
            select: { id: true },
          });
          if (referrer) referredByCustomerId = referrer.id;
        }
        return tx.customer.create({
          data: {
            organizationId: req.organizationId!,
            leadId: lead.id,
            name: formatCustomerName(lead.name, req.body?.customer_type || "particular"),
            email: lead.email,
            phone: lead.phone,
            notes: lead.notes,
            customerType: normalizeCustomerType(req.body?.customer_type || "particular"),
            pricingMode: normalizePricingMode(req.body?.pricing_mode),
            referredByCustomerId,
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
      let referredByCustomerId: string | null | undefined = undefined;
      if (body.referred_by_customer_id !== undefined) {
        try {
          referredByCustomerId = await withTenantTransaction(req.organizationId!, (tx) =>
            resolveReferredById(tx, req.organizationId!, body.referred_by_customer_id, id),
          );
        } catch (e) {
          res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Indicador inválido" });
          return;
        }
      }
      const outcome = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.customer.findFirst({ where: { id } });
        if (!existing) return { kind: "missing" as const };
        const nextType =
          body.customer_type !== undefined ? normalizeCustomerType(body.customer_type) : existing.customerType;
        const partnerUsers = await tx.partnerUser.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        const nextEmail = body.email !== undefined ? String(body.email || "").trim().toLowerCase() || null : existing.email;
        if (partnerUsers.length && nextEmail) {
          const duplicate = await tx.partnerUser.findFirst({
            where: {
              email: { equals: nextEmail, mode: "insensitive" },
              id: { notIn: partnerUsers.map((user) => user.id) },
            },
            select: { id: true },
          });
          if (duplicate) return { kind: "partner_email_conflict" as const };
        }
        const isOrgType = nextType === "builder";
        const dumpsterTouched =
          body.dumpster_status !== undefined || body.dumpster_notes !== undefined || body.customer_type !== undefined;
        const storageTouched =
          body.storage_status !== undefined || body.storage_notes !== undefined || body.customer_type !== undefined;
        const nextDumpster = !isOrgType
          ? null
          : body.dumpster_status !== undefined
            ? normalizeYnStatus(body.dumpster_status) || "unknown"
            : normalizeYnStatus(existing.dumpsterStatus) || "unknown";
        const nextStorage = !isOrgType
          ? null
          : body.storage_status !== undefined
            ? normalizeYnStatus(body.storage_status) || "unknown"
            : normalizeYnStatus(existing.storageStatus) || "unknown";
        const row = await tx.customer.update({
          where: { id },
          data: {
            name: body.name !== undefined ? formatCustomerName(String(body.name), nextType) : undefined,
            clientCode:
              body.client_code !== undefined ? String(body.client_code || "").trim().slice(0, 80) || null : undefined,
            email: body.email !== undefined ? String(body.email || "") || null : undefined,
            phone: body.phone !== undefined ? formatUsPhone(String(body.phone || "") || null) : undefined,
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
            contactName:
              body.responsible_name !== undefined ? String(body.responsible_name || "").trim() || null : undefined,
            dumpsterStatus: dumpsterTouched ? nextDumpster : undefined,
            dumpsterNotes: dumpsterTouched
              ? nextDumpster === "yes"
                ? String(body.dumpster_notes !== undefined ? body.dumpster_notes : existing.dumpsterNotes || "").trim() ||
                  null
                : null
              : undefined,
            storageStatus: storageTouched ? nextStorage : undefined,
            storageNotes: storageTouched
              ? nextStorage === "yes"
                ? String(body.storage_notes !== undefined ? body.storage_notes : existing.storageNotes || "").trim() ||
                  null
                : null
              : undefined,
            referredByCustomerId,
          },
        });
        if (partnerUsers.length) {
          if (!isOrgType) {
            await tx.partnerUser.updateMany({ where: { customerId: id }, data: { status: "suspended" } });
          } else if (nextEmail) {
            await tx.partnerUser.updateMany({
              where: { customerId: id },
              data: {
                email: nextEmail,
                name: row.contactName?.trim() || row.name,
                companyName: row.company || row.name,
              },
            });
          } else {
            await tx.partnerUser.updateMany({ where: { customerId: id }, data: { status: "suspended" } });
          }
        }
        if (body.client_code !== undefined) {
          const oldLabel = customerDisplayName(existing.name, existing.clientCode);
          const newLabel = customerDisplayName(row.name, row.clientCode);
          if (oldLabel && oldLabel !== newLabel) {
            const jobs = await tx.workOrder.findMany({
              where: { customerId: id },
              select: { id: true, title: true },
            });
            for (const job of jobs) {
              const next = retitleForClientCode(job.title, oldLabel, newLabel);
              if (next && next !== job.title) {
                await tx.workOrder.update({ where: { id: job.id }, data: { title: next } });
              }
            }
          }
        }
        return { kind: "updated" as const, row };
      });
      if (outcome.kind === "missing") {
        res.status(404).json({ success: false, error: "Customer not found" });
        return;
      }
      if (outcome.kind === "partner_email_conflict") {
        res.status(409).json({ success: false, error: "Este e-mail já está vinculado a outra conta de parceiro." });
        return;
      }
      res.json({ success: true, data: mapCustomer(outcome.row), message: "Client updated" });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.delete(
  "/api/customers/:id",
  requireCrmAuth,
  requireCrmPermission("customers.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const force = String(req.query.force || "") === "1" || req.body?.force === true;
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.customer.findFirst({ where: { id } });
        if (!existing) return { ok: false as const, status: 404, error: "Cliente não encontrado" };

        const [quotes, jobs, invoices] = await Promise.all([
          tx.quote.count({ where: { customerId: id } }),
          tx.workOrder.count({ where: { customerId: id } }),
          tx.quoteInvoice.count({ where: { customerId: id } }),
        ]);
        const linked = quotes + jobs + invoices;
        if (linked > 0 && !force) {
          return {
            ok: false as const,
            status: 409,
            error: `Este cliente tem ${quotes} orçamento(s), ${jobs} job(s) e ${invoices} fatura(s). Confirme a exclusão forçada.`,
            counts: { quotes, jobs, invoices },
          };
        }

        await tx.quote.updateMany({ where: { customerId: id }, data: { customerId: null } });
        await tx.workOrder.updateMany({ where: { customerId: id }, data: { customerId: null } });
        await tx.quoteInvoice.updateMany({ where: { customerId: id }, data: { customerId: null } });
        await tx.project.updateMany({ where: { customerId: id }, data: { customerId: null } });
        await tx.meeting.updateMany({ where: { customerId: id }, data: { customerId: null } });
        await tx.siteAssessment.updateMany({ where: { customerId: id }, data: { customerId: null } });
        await tx.scheduledMessage.updateMany({ where: { customerId: id }, data: { customerId: null } });
        await tx.customer.delete({ where: { id } });
        return { ok: true as const };
      });
      if (!result.ok) {
        res.status(result.status).json({
          success: false,
          error: result.error,
          counts: "counts" in result ? result.counts : undefined,
        });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

function quoteListInclude() {
  return {
    customer: { select: { name: true, company: true, clientCode: true } },
    workOrder: { select: { number: true, status: true } },
    builder: { select: { company: true, firstName: true, lastName: true } },
    property: { select: { line1: true, city: true, state: true, label: true } },
    lineItems: { orderBy: { sortOrder: "asc" as const } },
  };
}

/** Broad quote list search: number, title, client/builder names, address, job fields. */
function quoteSearchWhere(search: string): Prisma.QuoteWhereInput[] {
  const q = search.trim();
  if (!q) return [];
  const contains = { contains: q, mode: "insensitive" as const };
  const or: Prisma.QuoteWhereInput[] = [
    { title: contains },
    { quoteNumber: contains },
    { notes: contains },
    { customer: { is: { OR: [{ name: contains }, { company: contains }, { email: contains }, { phone: contains }, { address: contains }] } } },
    {
      builder: {
        is: {
          OR: [{ company: contains }, { firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }, { address: contains }],
        },
      },
    },
    {
      property: {
        is: {
          OR: [{ label: contains }, { line1: contains }, { line2: contains }, { city: contains }, { state: contains }, { postalCode: contains }],
        },
      },
    },
    { payload: { path: ["job_name"], string_contains: q } },
    { payload: { path: ["job_address"], string_contains: q } },
  ];
  const digits = q.replace(/\D/g, "");
  if (digits) {
    const asNum = Number(digits);
    if (Number.isFinite(asNum) && asNum > 0 && String(asNum) === digits) {
      or.push({ number: asNum });
    }
    or.push({ quoteNumber: { contains: digits, mode: "insensitive" } });
  }
  return or;
}

/** Grupos da lista (Rascunho, Enviado, Visto, Aprovado, Expirado) — "visto" não é status, é viewedAt. */
function quoteGroupWhere(group: string): Prisma.QuoteWhereInput {
  const now = new Date();
  const open = { status: { in: ["sent", "viewed", "changes_requested"] } };
  switch (group) {
    case "draft":
      return { status: "draft" };
    case "sent":
      return { status: { in: ["sent", "changes_requested"] }, viewedAt: null, OR: [{ validUntil: null }, { validUntil: { gte: now } }] };
    case "viewed":
      return {
        AND: [
          { OR: [{ status: "viewed" }, { status: { in: ["sent", "changes_requested"] }, viewedAt: { not: null } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      };
    case "approved":
      return { status: { in: ["approved", "accepted", "converted", "invoiced"] } };
    case "expired":
      return { OR: [{ status: "expired" }, { ...open, validUntil: { lt: now } }] };
    case "archived":
      return { status: { in: ["archived", "rejected"] } };
    case "open":
      return { status: { not: "archived" } };
    default:
      return {};
  }
}

/** Números da lista de quotes: grupos com quantidade e valor, em aberto, aprovação, ticket médio, vencendo. */
customersQuotesRouter.get("/api/quotes/summary", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.quote.findMany({
        where: { status: { notIn: ["archived", "rejected"] } },
        select: { status: true, total: true, viewedAt: true, validUntil: true, createdAt: true },
        take: 10000,
      }),
    );
    const now = Date.now();
    const in7 = now + 7 * 86400000;
    const since = now - 90 * 86400000;
    const groups: Record<string, { count: number; value: number }> = {
      all: { count: 0, value: 0 },
      draft: { count: 0, value: 0 },
      sent: { count: 0, value: 0 },
      viewed: { count: 0, value: 0 },
      approved: { count: 0, value: 0 },
      expired: { count: 0, value: 0 },
    };
    let expiring7 = 0;
    let sent90 = 0;
    let won90 = 0;
    let won90Value = 0;
    for (const q of rows) {
      const st = normalizeQuoteStatus(q.status);
      const total = dec(q.total);
      const valid = q.validUntil ? q.validUntil.getTime() : null;
      const isOpen = st === "sent" || st === "changes_requested" || (st as string) === "viewed";
      let g = "draft";
      if (st === "approved" || st === "converted") g = "approved";
      else if (st === "expired" || (isOpen && valid != null && valid < now)) g = "expired";
      else if (isOpen) g = q.viewedAt || (st as string) === "viewed" ? "viewed" : "sent";
      groups[g].count += 1;
      groups[g].value += total;
      groups.all.count += 1;
      groups.all.value += total;
      if (isOpen && valid != null && valid >= now && valid <= in7) expiring7 += 1;
      if (q.createdAt.getTime() >= since && st !== "draft") {
        sent90 += 1;
        if (g === "approved") {
          won90 += 1;
          won90Value += total;
        }
      }
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    for (const k of Object.keys(groups)) groups[k].value = round(groups[k].value);
    res.json({
      success: true,
      data: {
        groups,
        open_value: round(groups.sent.value + groups.viewed.value),
        open_count: groups.sent.count + groups.viewed.count,
        approval_rate_90: sent90 ? Math.round((won90 / sent90) * 1000) / 10 : null,
        avg_ticket_90: won90 ? round(won90Value / won90) : null,
        expiring_7: expiring7,
      },
    });
  } catch (error) {
    next(error);
  }
});

customersQuotesRouter.get("/api/quotes", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const status = req.query.status ? String(req.query.status) : null;
    const group = req.query.group ? String(req.query.group) : null;
    const leadId = req.query.lead_id ? String(req.query.lead_id) : null;
    const customerId = req.query.customer_id ? String(req.query.customer_id) : null;
    const search = String(req.query.q || req.query.search || "").trim();

    const [total, rows, leadNames] = await withTenantTransaction(req.organizationId!, async (tx) => {
      const where: Prisma.QuoteWhereInput = {};
      if (status) where.status = status;
      if (group) Object.assign(where, quoteGroupWhere(group));
      if (leadId) where.leadId = leadId;
      if (customerId) where.customerId = customerId;
      if (search) {
        const contains = { contains: search, mode: "insensitive" as const };
        const leadHits = await tx.lead.findMany({
          where: { OR: [{ name: contains }, { email: contains }, { phone: contains }] },
          select: { id: true },
          take: 40,
        });
        const or = quoteSearchWhere(search);
        if (leadHits.length) or.push({ leadId: { in: leadHits.map((l) => l.id) } });
        where.OR = or;
      }
      const count = await tx.quote.count({ where });
      const list = await tx.quote.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: quoteListInclude(),
      });
      // Quote não tem relação com Lead no schema: busca os nomes para a lista mostrar o cliente.
      const ids = [...new Set(list.map((q) => q.leadId).filter((x): x is string => Boolean(x)))];
      const leads = ids.length
        ? await tx.lead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true, email: true } })
        : [];
      return [count, list, new Map(leads.map((l) => [l.id, l]))] as const;
    });
    res.json({
      success: true,
      data: rows.map((q) => {
        const lead = q.leadId ? leadNames.get(q.leadId) : null;
        return { ...mapQuoteForUser(q, req.user), lead_name: lead?.name ?? null, lead_phone: lead?.phone ?? null, lead_email: lead?.email ?? null };
      }),
      total,
      page,
      limit,
    });
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
    let row = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.quote.findFirst({
        where: { id: String(req.params.id) },
        include: quoteListInclude(),
      }),
    );
    if (!row) {
      res.status(404).json({ success: false, error: "Quote not found" });
      return;
    }
    // Heal outside the read txn: approved quotes missing a job get one on open.
    // A quote that already has a job is aligned with the current client and total,
    // so a later edit does not leave the first version behind.
    const approved = normalizeQuoteStatus(row.status) === "approved";
    const quoteId = row.id;
    const linkedJobId = row.workOrderId;
    if (linkedJobId || (approved && !linkedJobId)) {
      try {
        await withTenantTransaction(req.organizationId!, async (tx) => {
          if (linkedJobId) {
            const { syncLinkedJobFromQuote } = await import("../../lib/work-orders/from-quote.js");
            return syncLinkedJobFromQuote(tx, {
              organizationId: req.organizationId!,
              quoteId,
            });
          }
          const { ensureWorkOrderOnApprove } = await import("../../lib/work-orders/from-quote.js");
          return ensureWorkOrderOnApprove(tx, {
            organizationId: req.organizationId!,
            quoteId,
            actorId: req.user?.id ?? null,
          });
        });
        const fresh = await withTenantTransaction(req.organizationId!, async (tx) =>
          tx.quote.findFirst({
            where: { id: quoteId },
            include: quoteListInclude(),
          }),
        );
        if (fresh) row = fresh;
      } catch (err) {
        console.error("[quotes] job heal failed", {
          quoteId,
          err: err instanceof Error ? err.message : err,
        });
      }
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
        const discount = discountFieldsFromBody(body);
        const discountAmount = readQuoteDiscount({
          subtotal,
          discountType: discount.discountType,
          discountValue: discount.discountValue,
        }).amount;
        const total =
          discountAmount > 0
            ? Math.round((subtotal - discountAmount + tax) * 100) / 100
            : Number(body.total != null ? body.total : subtotal + tax);
        const customerId = asOptionalUuid(body.customer_id);
        const leadId = asOptionalUuid(body.lead_id);
        const builderId = asOptionalUuid(body.builder_id);
        const quote = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            number,
            quoteNumber: body.quote_number || formatQuoteNumber(defaults.quoteNumberPrefix, number),
            // job_name is a reference note only — never use it as the quote/client title.
            title: String(body.title || body.service_type || `Quote ${number}`),
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
            discountType: discount.discountType,
            discountValue: new Prisma.Decimal(discount.discountValue),
            notes: body.notes || null,
            terms: bodyTerms !== undefined ? bodyTerms : defaults.defaultQuoteTerms || null,
            serviceType: body.service_type || null,
            customerId,
            leadId,
            builderId,
            salespersonId: req.user?.id || null,
            publicToken: randomBytes(16).toString("hex"),
            payload: body,
            lineItems: {
              create: items.map((it: QuoteLineBody, idx: number) =>
                lineItemCreateRow(it, idx, req.organizationId!),
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

        let createdInvoiceIds: string[] = [];
        let createdJobId: string | null = null;
        if (normalizeQuoteStatus(quote.status) === "approved") {
          const { ensureInvoicesOnApprove } = await import("../../lib/payments/engine.js");
          createdInvoiceIds = await ensureInvoicesOnApprove(tx, {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            actorId: req.user?.id ?? null,
          });
          const { ensureWorkOrderOnApprove } = await import("../../lib/work-orders/from-quote.js");
          const job = await ensureWorkOrderOnApprove(tx, {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            actorId: req.user?.id ?? null,
          });
          if (job?.created) createdJobId = job.id;
        }

        return { quote, createdInvoiceIds, createdJobId };
      });
      res.status(201).json({
        success: true,
        data: mapQuoteForUser(row.quote, req.user),
        created_invoice_ids: row.createdInvoiceIds || [],
        created_job_id: row.createdJobId || null,
      });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.patch(
  "/api/quotes/:id/line-items/:lineId",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const quoteId = String(req.params.id || "");
      const lineId = String(req.params.lineId || "");
      if (!asOptionalUuid(quoteId) || !asOptionalUuid(lineId)) {
        res.status(400).json({ success: false, error: "Quote ou serviço inválido." });
        return;
      }
      const parsed = z.object({
        unit_price: z.number().finite().min(0).max(1_000_000),
        quantity: z.number().finite().gt(0).max(1_000_000),
        expected_unit_price: z.number().finite().min(0).max(1_000_000),
        expected_quantity: z.number().finite().gt(0).max(1_000_000),
      }).safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Revise o novo preço e a quantidade." });
        return;
      }

      const outcome = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id: quoteId, organizationId: req.organizationId! },
          include: { lineItems: { orderBy: { sortOrder: "asc" } } },
        });
        if (!quote) return { status: 404 as const, error: "Quote não encontrado." };
        if (normalizeQuoteStatus(quote.status) !== "draft") {
          return { status: 409 as const, error: "Este Quote não está mais em rascunho. Atualize a tela e revise o status antes de editar." };
        }
        const line = quote.lineItems.find((item) => item.id === lineId);
        if (!line) return { status: 404 as const, error: "A linha do Quote não foi encontrada." };
        const oldPrice = dec(line.unitPrice);
        const oldQuantity = dec(line.quantity);
        if (Math.round(oldPrice * 100) !== Math.round(parsed.data.expected_unit_price * 100) || Math.round(oldQuantity * 100) !== Math.round(parsed.data.expected_quantity * 100)) {
          return { status: 409 as const, error: "Essa linha mudou desde a prévia. Peça novamente a alteração para revisar os valores atuais." };
        }

        const nextPrice = Math.round(parsed.data.unit_price * 100) / 100;
        const nextQuantity = Math.round(parsed.data.quantity * 100) / 100;
        const nextAmount = Math.round(nextPrice * nextQuantity * 100) / 100;
        await tx.quoteLineItem.update({
          where: { id: line.id },
          data: {
            unitPrice: new Prisma.Decimal(nextPrice),
            quantity: new Prisma.Decimal(nextQuantity),
            amount: new Prisma.Decimal(nextAmount),
          },
        });

        const subtotal = Math.round(quote.lineItems.reduce((sum, item) => sum + (item.id === line.id ? nextAmount : dec(item.amount)), 0) * 100) / 100;
        const discount = readQuoteDiscount({ ...quote, subtotal });
        const tax = dec(quote.taxTotal);
        const total = Math.max(0, Math.round((subtotal - discount.amount + tax) * 100) / 100);
        const payload = quote.payload && typeof quote.payload === "object" && !Array.isArray(quote.payload)
          ? { ...(quote.payload as Record<string, unknown>) }
          : {};
        const payloadItems = Array.isArray(payload.items) ? [...payload.items] : null;
        const payloadIndex = quote.lineItems.findIndex((item) => item.id === line.id);
        if (payloadItems && payloadIndex >= 0 && payloadItems[payloadIndex] && typeof payloadItems[payloadIndex] === "object") {
          payloadItems[payloadIndex] = {
            ...(payloadItems[payloadIndex] as Record<string, unknown>),
            quantity: nextQuantity,
            unit_price: nextPrice,
            rate: nextPrice,
            sell_price: nextPrice,
            amount: nextAmount,
          };
          payload.items = payloadItems;
        }
        await tx.quote.update({
          where: { id: quote.id },
          data: { subtotal: new Prisma.Decimal(subtotal), total: new Prisma.Decimal(total), payload: payload as Prisma.InputJsonValue },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "mate_ai.quote_line_updated",
          changes: {
            line: { from: line.name || line.description, to: line.name || line.description },
            unit_price: { from: oldPrice, to: nextPrice },
            quantity: { from: oldQuantity, to: nextQuantity },
            total: { from: dec(quote.total), to: total },
          },
        });
        const label = (line.name && line.name.trim()) || String(line.description || "Serviço").split("\n")[0] || "Serviço";
        return { status: 200 as const, data: { quote_number: quote.quoteNumber || String(quote.number), line_name: label, unit_price: nextPrice, quantity: nextQuantity, subtotal, total } };
      });
      if (outcome.status !== 200) {
        res.status(outcome.status).json({ success: false, error: outcome.error });
        return;
      }
      res.json({ success: true, data: outcome.data });
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
        const existing = await tx.quote.findFirst({
          where: { id },
          include: { lineItems: { orderBy: { sortOrder: "asc" } } },
        });
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
          const discountAmount = readQuoteDiscount({
            subtotal,
            ...discountFieldsFromBody(body),
          }).amount;
          total =
            discountAmount > 0
              ? Math.round((subtotal - discountAmount + tax) * 100) / 100
              : Number(body.total != null ? body.total : subtotal + tax);
          await tx.quoteLineItem.deleteMany({ where: { quoteId: id } });
          await tx.quoteLineItem.createMany({
            data: items.map((it: QuoteLineBody, idx: number) =>
              lineItemCreateRow(it, idx, req.organizationId!, id),
            ),
          });
        }
        const prevStatus = existing.status;
        const nextTitle = body.title !== undefined ? String(body.title) : existing.title;
        const nextNotes = body.notes !== undefined ? body.notes || null : existing.notes;
        const nextTermsRaw = termsFromBody(body);
        const nextTerms = nextTermsRaw !== undefined ? nextTermsRaw : existing.terms;
        const nextValid = parseDateInput(body.expiration_date);
        const validChanged =
          nextValid !== undefined &&
          (nextValid ? nextValid.toISOString().slice(0, 10) : "") !==
            (existing.validUntil ? existing.validUntil.toISOString().slice(0, 10) : "");
        const linesChanged = items
          ? lineFingerprint(existing.lineItems, true) !== lineFingerprint(items, false)
          : false;
        const contentChanged =
          nextTitle !== existing.title ||
          (nextNotes || null) !== (existing.notes || null) ||
          (nextTerms || null) !== (existing.terms || null) ||
          validChanged ||
          Math.round(total * 100) !== Math.round(dec(existing.total) * 100) ||
          linesChanged;
        const invalidate = contentChanged && quoteHadClientApproval(existing);
        let updated = await tx.quote.update({
          where: { id },
          data: {
            // Keep title as the party/client label. job_name lives only in payload as a note.
            title: body.title !== undefined ? String(body.title) : undefined,
            status: invalidate ? "sent" : body.status !== undefined ? String(body.status) : undefined,
            salespersonId: existing.salespersonId || req.user?.id || undefined,
            ...(invalidate ? clearedClientSignature() : {}),
            flooringType: body.flooring_type !== undefined ? String(body.flooring_type) : undefined,
            notes: body.notes !== undefined ? body.notes : undefined,
            terms: termsFromBody(body),
            validUntil: parseDateInput(body.expiration_date),
            serviceType: body.service_type !== undefined ? body.service_type : undefined,
            customerId: body.customer_id !== undefined ? asOptionalUuid(body.customer_id) : undefined,
            leadId: body.lead_id !== undefined ? asOptionalUuid(body.lead_id) ?? existing.leadId : undefined,
            builderId: body.builder_id !== undefined ? asOptionalUuid(body.builder_id) : undefined,
            subtotal: new Prisma.Decimal(subtotal),
            taxTotal: new Prisma.Decimal(tax),
            total: new Prisma.Decimal(total),
            ...(body.discount_type !== undefined || body.discount_value !== undefined
              ? {
                  discountType: discountFieldsFromBody(body).discountType,
                  discountValue: new Prisma.Decimal(discountFieldsFromBody(body).discountValue),
                }
              : {}),
            payload: body,
          },
          include: { customer: { select: { name: true } }, lineItems: { orderBy: { sortOrder: "asc" } } },
        });
        // Sent → lead to "Quote Sent"; approved/converted → "Won" (was never synced from the CRM).
        await syncLeadForQuoteStatus(tx, {
          organizationId: req.organizationId!,
          quoteId: id,
          previousStatus: prevStatus,
          nextStatus: updated.status,
          actorId: req.user?.id,
        });

        let createdInvoiceIds: string[] = [];
        let createdJobId: string | null = null;
        // Idempotent: create on transition to approved, and backfill if already approved with no invoices/job.
        if (normalizeQuoteStatus(updated.status) === "approved") {
          const { ensureInvoicesOnApprove } = await import("../../lib/payments/engine.js");
          createdInvoiceIds = await ensureInvoicesOnApprove(tx, {
            organizationId: req.organizationId!,
            quoteId: id,
            actorId: req.user?.id ?? null,
          });
          const { ensureWorkOrderOnApprove } = await import("../../lib/work-orders/from-quote.js");
          const job = await ensureWorkOrderOnApprove(tx, {
            organizationId: req.organizationId!,
            quoteId: id,
            actorId: req.user?.id ?? null,
          });
          if (job?.created) createdJobId = job.id;
          if (job?.id && !updated.workOrderId) {
            updated = { ...updated, workOrderId: job.id };
          }
        } else if (updated.workOrderId) {
          const { syncLinkedJobFromQuote } = await import("../../lib/work-orders/from-quote.js");
          await syncLinkedJobFromQuote(tx, {
            organizationId: req.organizationId!,
            quoteId: id,
          });
        }

        const linked = updated.workOrderId
          ? await tx.workOrder.findFirst({
              where: { id: updated.workOrderId },
              select: { number: true, status: true },
            })
          : null;

        return {
          updated: { ...updated, workOrder: linked },
          createdInvoiceIds,
          createdJobId,
          approvalReset: invalidate,
        };
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Quote not found" });
        return;
      }
      res.json({
        success: true,
        data: mapQuoteForUser(row.updated, req.user),
        created_invoice_ids: row.createdInvoiceIds || [],
        created_job_id: row.createdJobId || null,
        approval_reset: row.approvalReset,
      });
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
                name: li.name ?? undefined,
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

function normalizeEmailList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw != null && raw !== "" ? [raw] : [];
  const out: string[] = [];
  for (const item of list) {
    const e = String(item || "")
      .trim()
      .toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

function buildQuoteEmailPayload(opts: {
  quote: {
    title: string;
    number: number;
    quoteNumber: string | null;
    clientMessage: string | null;
    validUntil: Date | null;
    customer?: { name: string } | null;
    builder?: { company: string | null; firstName: string; lastName: string } | null;
    organization: {
      name: string;
      contactPhone: string | null;
      accentColor: string | null;
      primaryColor: string | null;
    };
  };
  publicUrl: string;
  to: string;
  cc: string[];
  subjectOverride?: string;
}) {
  const org = opts.quote.organization;
  const clientName =
    opts.quote.customer?.name ||
    opts.quote.builder?.company ||
    [opts.quote.builder?.firstName, opts.quote.builder?.lastName].filter(Boolean).join(" ") ||
    "Cliente";
  const quoteNumber =
    opts.quote.quoteNumber || formatQuoteNumber("Q-", opts.quote.number);
  const locale = "en";
  const emailInput = {
    companyName: org.name,
    clientName,
    quoteNumber,
    publicUrl: opts.publicUrl,
    phone: org.contactPhone,
    validUntil: opts.quote.validUntil,
    accentColor: org.accentColor,
    primaryColor: org.primaryColor,
    clientMessage: opts.quote.clientMessage,
    locale,
  };
  const subject =
    String(opts.subjectOverride || "").trim() ||
    defaultQuoteAccessSubject({ companyName: org.name, quoteNumber, locale });
  return {
    to: opts.to,
    cc: opts.cc,
    subject,
    text: buildQuoteAccessEmailText(emailInput),
    html: buildQuoteAccessEmailHtml(emailInput),
    client_name: clientName,
    quote_number: quoteNumber,
  };
}

customersQuotesRouter.post(
  "/api/quotes/:id/email-preview",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!asOptionalUuid(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;

      const prepared = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id },
          include: {
            customer: { select: { id: true, name: true, email: true } },
            builder: { select: { email: true, company: true, firstName: true, lastName: true } },
            organization: {
              select: {
                name: true,
                contactEmail: true,
                contactPhone: true,
                accentColor: true,
                primaryColor: true,
              },
            },
          },
        });
        if (!quote) return null;

        const toOverride = String(body.to || "").trim().toLowerCase();
        const primary =
          toOverride ||
          quote.customer?.email?.trim().toLowerCase() ||
          quote.builder?.email?.trim().toLowerCase() ||
          "";
        if (!primary) {
          return { error: "Este cliente não tem e-mail no cadastro." as const };
        }

        // Preview issues a real token so the CTA link matches production; status is unchanged.
        const issued = await issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
        });
        return { quote, primary, issued };
      });

      if (!prepared) {
        res.status(404).json({ success: false, error: "Orçamento não encontrado" });
        return;
      }
      if ("error" in prepared && prepared.error) {
        res.status(400).json({ success: false, error: prepared.error });
        return;
      }

      const data = prepared as {
        quote: Parameters<typeof buildQuoteEmailPayload>[0]["quote"];
        primary: string;
        issued: { rawToken: string };
      };
      const publicUrl = `${publicBaseUrl(req)}/public/quotes/${data.issued.rawToken}`;
      const cc = normalizeEmailList(body.cc ?? body.extra_emails ?? body.extraEmails);
      const payload = buildQuoteEmailPayload({
        quote: data.quote,
        publicUrl,
        to: data.primary,
        cc,
        subjectOverride: String(body.subject || ""),
      });

      res.json({
        success: true,
        preview: true,
        ...payload,
        public_url: publicUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Clone quote with a discount and issue a public link — source quote is not modified.
 * Used when sending SMS/email with a discount so the original remains viewable.
 */
customersQuotesRouter.post(
  "/api/quotes/:id/share-discounted-copy",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!asOptionalUuid(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;
      const rawType = String(body.discount_type || body.discountType || "percent").toLowerCase();
      const discountType = rawType === "fixed" ? "fixed" : "percent";
      const discountValue = Number(body.discount_value ?? body.discountValue ?? 0);
      if (!(discountValue > 0)) {
        res.status(400).json({ success: false, error: "Informe um desconto maior que zero." });
        return;
      }
      const markSent =
        body.mark_sent === true ||
        body.mark_sent === 1 ||
        body.mark_sent === "1" ||
        body.mark_sent === undefined;

      const defaults = await loadQuoteOrgDefaults(req.organizationId!);
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const src = await tx.quote.findFirst({ where: { id }, select: { id: true } });
        if (!src) return null;
        return createDiscountedQuoteCopy(tx, {
          organizationId: req.organizationId!,
          sourceQuoteId: id,
          discountType,
          discountValue,
          actorUserId: req.user?.id ?? null,
          titleSuffix:
            discountType === "percent"
              ? ` (−${Math.min(100, discountValue)}%)`
              : " (desconto)",
          quoteNumberPrefix: defaults.quoteNumberPrefix,
          quoteNextNumber: defaults.quoteNextNumber,
          quoteValidityDays: defaults.quoteValidityDays,
          markSent: !!markSent,
        });
      });

      if (!result) {
        res.status(404).json({ success: false, error: "Orçamento não encontrado" });
        return;
      }

      const publicUrl = `${publicBaseUrl(req)}/public/quotes/${result.publicRawToken}`;
      res.status(201).json({
        success: true,
        data: {
          quote_id: result.quoteId,
          quote_number: result.quoteNumber,
          source_quote_id: result.sourceQuoteId,
          discount_type: result.discountType,
          discount_value: result.discountValue,
          total: result.total,
          public_url: publicUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.post(
  "/api/quotes/:id/publish-client",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!asOptionalUuid(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;
      const markSent =
        body.mark_sent === true ||
        body.mark_sent === 1 ||
        body.mark_sent === "1" ||
        String(req.query.mark_sent || "") === "1";
      const leadIdHint = asOptionalUuid(body.lead_id ?? body.leadId);

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({ where: { id } });
        if (!quote) return null;

        const issued = await issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
        });

        let leadMoved = false;
        let leadMoveReason: string | null = null;
        let leadId: string | null = null;

        if (markSent) {
          const sentAt = new Date().toISOString();
          const prevPayload =
            quote.payload && typeof quote.payload === "object" && !Array.isArray(quote.payload)
              ? { ...(quote.payload as Record<string, unknown>) }
              : {};
          const dropApproval = quoteHadClientApproval(quote);
          await tx.quote.update({
            where: { id: quote.id },
            data: {
              status: "sent",
              publicToken: null,
              salespersonId: quote.salespersonId || req.user?.id || undefined,
              ...(dropApproval ? clearedClientSignature() : {}),
              ...(leadIdHint && !quote.leadId ? { leadId: leadIdHint } : {}),
              payload: {
                ...prevPayload,
                sent_at: prevPayload.sent_at || sentAt,
              } as Prisma.InputJsonValue,
            },
          });

          try {
            const move = await moveLeadForQuoteEvent(tx, {
              organizationId: req.organizationId!,
              quoteId: quote.id,
              slug: "quote_sent",
              actorType: "user",
              actorId: req.user?.id,
              leadIdHint,
            });
            leadMoved = move.moved;
            leadId = move.leadId;
            leadMoveReason = move.moved ? null : move.reason || null;
          } catch {
            leadMoveReason = "move_failed";
          }

          await recordActivity(tx, {
            organizationId: req.organizationId!,
            actorType: "user",
            actorId: req.user?.id ?? null,
            entityType: "quote",
            entityId: quote.id,
            action: "quote.marked_sent",
          });
        } else {
          await tx.quote.update({
            where: { id: quote.id },
            data: { publicToken: null },
          });
        }

        return { issued, leadMoved, leadMoveReason, leadId, approvalReset: markSent && quoteHadClientApproval(quote) };
      });

      if (!result) {
        res.status(404).json({ success: false, error: "Orçamento não encontrado" });
        return;
      }

      const publicUrl = `${publicBaseUrl(req)}/public/quotes/${result.issued.rawToken}`;

      res.json({
        success: true,
        public_url: publicUrl,
        lead_moved: result.leadMoved,
        lead_id: result.leadId,
        lead_move_reason: result.leadMoveReason,
        approval_reset: result.approvalReset,
      });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.post(
  "/api/quotes/:id/send-email",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!asOptionalUuid(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }

      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;

      const prepared = await withTenantTransaction(req.organizationId!, async (tx) => {
        const quote = await tx.quote.findFirst({
          where: { id },
          include: {
            customer: { select: { id: true, name: true, email: true } },
            builder: { select: { email: true, company: true, firstName: true, lastName: true } },
            organization: {
              select: {
                name: true,
                contactEmail: true,
                contactPhone: true,
                accentColor: true,
                primaryColor: true,
              },
            },
          },
        });
        if (!quote) return null;

        const toOverride = String(body.to || "").trim().toLowerCase();
        const primary =
          toOverride ||
          quote.customer?.email?.trim().toLowerCase() ||
          quote.builder?.email?.trim().toLowerCase() ||
          "";
        if (!primary) {
          return { error: "Este cliente não tem e-mail no cadastro." as const };
        }

        const issued = await issuePublicAccessToken(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
        });

        const prevPayload =
          quote.payload && typeof quote.payload === "object" && !Array.isArray(quote.payload)
            ? { ...(quote.payload as Record<string, unknown>) }
            : {};
        const emailSentAt = new Date().toISOString();
        const leadIdHint = asOptionalUuid(body.lead_id);

        const dropApproval = quoteHadClientApproval(quote);
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            status: "sent",
            publicToken: null,
            salespersonId: quote.salespersonId || req.user?.id || undefined,
            ...(dropApproval ? clearedClientSignature() : {}),
            ...(leadIdHint && !quote.leadId ? { leadId: leadIdHint } : {}),
            payload: {
              ...prevPayload,
              email_sent_at: emailSentAt,
              sent_at: emailSentAt,
              ...(dropApproval ? { approval_reset_at: emailSentAt } : {}),
            } as Prisma.InputJsonValue,
          },
        });

        let leadMoved = false;
        let leadMoveReason: string | null = null;
        try {
          // Always attempt Quote Sent on send (onlyForward skips Follow Up / Won / etc.).
          const move = await moveLeadForQuoteEvent(tx, {
            organizationId: req.organizationId!,
            quoteId: quote.id,
            slug: "quote_sent",
            actorType: "user",
            actorId: req.user?.id,
            leadIdHint,
          });
          leadMoved = move.moved;
          leadMoveReason = move.moved ? null : move.reason || null;
        } catch {
          leadMoveReason = "move_failed";
        }

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          actorType: "user",
          actorId: req.user?.id ?? null,
          entityType: "quote",
          entityId: quote.id,
          action: "quote.email_sent",
        });

        return {
          quote,
          primary,
          issued,
          emailSentAt,
          leadMoved,
          leadMoveReason,
          approvalReset: dropApproval,
        };
      });

      if (!prepared) {
        res.status(404).json({ success: false, error: "Orçamento não encontrado" });
        return;
      }
      if ("error" in prepared && prepared.error) {
        res.status(400).json({ success: false, error: prepared.error });
        return;
      }

      const data = prepared as {
        quote: {
          title: string;
          number: number;
          quoteNumber: string | null;
          clientMessage: string | null;
          validUntil: Date | null;
          customer?: { name: string } | null;
          builder?: { company: string | null; firstName: string; lastName: string } | null;
          organization: {
            name: string;
            contactPhone: string | null;
            accentColor: string | null;
            primaryColor: string | null;
          };
        };
        primary: string;
        issued: { rawToken: string };
        emailSentAt: string;
        leadMoved: boolean;
        leadMoveReason: string | null;
        approvalReset: boolean;
      };

      const publicUrl = `${publicBaseUrl(req)}/public/quotes/${data.issued.rawToken}`;
      const cc = normalizeEmailList(body.cc ?? body.extra_emails ?? body.extraEmails);
      const payload = buildQuoteEmailPayload({
        quote: data.quote,
        publicUrl,
        to: data.primary,
        cc,
        subjectOverride: String(body.subject || ""),
      });

      const sent = await sendCustomerEmail({
        to: payload.to,
        cc: payload.cc,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      if (!sent.ok) {
        res.status(503).json({ success: false, error: sent.error });
        return;
      }

      res.json({
        success: true,
        message_id: sent.id || null,
        transport: sent.transport,
        email_sent_at: data.emailSentAt,
        lead_moved: data.leadMoved,
        lead_move_reason: data.leadMoveReason,
        public_url: publicUrl,
        approval_reset: data.approvalReset,
      });
    } catch (error) {
      next(error);
    }
  },
);

customersQuotesRouter.get(
  "/api/quotes/:id/signature-file",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      if (!asOptionalUuid(id)) {
        res.status(400).end();
        return;
      }
      const built = await quotePdfInputForCrm(req.organizationId!, id);
      if (!built) {
        res.status(404).end();
        return;
      }
      const role = String(req.query.role || "");
      const owner = built.input.ownerSignature;
      const url =
        role === "client"
          ? built.input.signatureUrl
          : owner?.imageUrl || owner?.image_url || null;
      const buf = await loadLogoBuffer(url);
      if (!buf) {
        res.status(404).end();
        return;
      }
      res.setHeader("Cache-Control", "private, max-age=300");
      res.type(imageContentType(buf));
      res.send(buf);
    } catch (error) {
      next(error);
    }
  },
);

/** JSON with everything the PDF shows, for the PDF-look paper in the CRM (preview + services popup). */
customersQuotesRouter.get(
  "/api/quotes/:id/paper",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const org = await quotePaperOrgForCrm(req.organizationId!);
      if (id === "new") {
        res.json({ success: true, data: { ...org, lines: [], schedule: [] } });
        return;
      }
      if (!asOptionalUuid(id)) {
        res.status(400).json({ success: false, error: "ID inválido" });
        return;
      }
      const built = await quotePdfInputForCrm(req.organizationId!, id);
      if (!built) {
        res.status(404).json({ success: false, error: "Orçamento não encontrado" });
        return;
      }
      const schedule = built.schedule.map((it) => ({
        label: it.label,
        percent: it.percent == null ? null : Number(it.percent),
        fixedAmount: it.fixedAmount == null ? null : Number(it.fixedAmount),
      }));
      const owner = built.input.ownerSignature;
      const ownerUrl = owner?.imageUrl || owner?.image_url || null;
      const clientUrl = built.input.signatureUrl || null;
      const ownerHref = ownerUrl ? `/api/quotes/${encodeURIComponent(id)}/signature-file?role=owner` : null;
      const clientHref = clientUrl ? `/api/quotes/${encodeURIComponent(id)}/signature-file?role=client` : null;
      res.json({
        success: true,
        data: {
          ...built.input,
          signatureUrl: clientHref,
          signedByName: built.input.signedByName,
          signedAt: built.input.signedAt,
          ownerSignature: owner
            ? { ...owner, imageUrl: ownerHref, image_url: ownerHref, has_image: Boolean(ownerHref) }
            : owner,
          schedule,
        },
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

const QUOTE_STATUS_SET = new Set([
  "draft",
  "sent",
  "viewed",
  "approved",
  "accepted",
  "rejected",
  "archived",
  "changes_requested",
]);

/** Change only the status, from the quote list. Does not cancel a linked job. */
customersQuotesRouter.post(
  "/api/quotes/:id/status",
  requireCrmAuth,
  requireCrmPermission("quotes.edit"),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const status = String(req.body?.status || "")
        .trim()
        .toLowerCase();
      if (!QUOTE_STATUS_SET.has(status)) {
        res.status(400).json({ success: false, error: "Status inválido" });
        return;
      }
      const row = await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.quote.findFirst({ where: { id } });
        if (!existing) return null;
        const updated = await tx.quote.update({
          where: { id },
          data: { status },
        });
        await syncLeadForQuoteStatus(tx, {
          organizationId: req.organizationId!,
          quoteId: id,
          previousStatus: existing.status,
          nextStatus: updated.status,
          actorId: req.user?.id,
        });
        let createdJobId: string | null = null;
        if (normalizeQuoteStatus(updated.status) === "approved") {
          const { ensureWorkOrderOnApprove } = await import("../../lib/work-orders/from-quote.js");
          const job = await ensureWorkOrderOnApprove(tx, {
            organizationId: req.organizationId!,
            quoteId: id,
            actorId: req.user?.id ?? null,
          });
          if (job?.created) createdJobId = job.id;
        } else if (updated.workOrderId) {
          const { syncLinkedJobFromQuote } = await import("../../lib/work-orders/from-quote.js");
          await syncLinkedJobFromQuote(tx, {
            organizationId: req.organizationId!,
            quoteId: id,
          });
        }
        const fresh = await tx.quote.findFirst({
          where: { id },
          include: quoteListInclude(),
        });
        return fresh ? { quote: fresh, createdJobId } : null;
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Quote not found" });
        return;
      }
      res.json({
        success: true,
        data: mapQuoteForUser(row.quote, req.user),
        created_job_id: row.createdJobId,
      });
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

// Invoice endpoints live in ./invoices.ts (Faturas module).


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
