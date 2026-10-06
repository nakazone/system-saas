/**
 * Migrate Senior Floors production MySQL → ObraMate Postgres tenant.
 *
 * Scope: Cadastros (customers, builders, suppliers, products, margins,
 * quote catalog, pricing), Leads, Quotes (+ line items), Invoices.
 *
 * Usage:
 *   SF_MYSQL_URL='mysql://...' npx tsx scripts/migrate-senior-floors-tenant.ts
 *   SF_MYSQL_URL='...' npx tsx scripts/migrate-senior-floors-tenant.ts --force
 *
 * Env:
 *   SF_MYSQL_URL   — required (Railway public MySQL URL)
 *   DATABASE_URL   — SaaS Postgres (from .env)
 *   SF_ADMIN_PASSWORD — optional temp password for migrated users (default below)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { Prisma } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { prisma } from "../src/lib/prisma.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { hashPassword } from "../src/lib/auth/password.js";

const SLUG = "senior-floors";
const ORG_NAME = "Senior Floors";
const ADMIN_EMAIL = "leads@senior-floors.com";
const ADMIN_NAME = "Douglas Nakazone";
const DEFAULT_PASSWORD = process.env.SF_ADMIN_PASSWORD || "SeniorMigrate2026!";
const FORCE = process.argv.includes("--force");
const DUMP_PATH = path.join(process.cwd(), "data", "senior-floors-export.json");

type IdMap = Map<number, string>;

const STAGE_SLUG_MAP: Record<string, string> = {
  lead_received: "new",
  new_lead: "new",
  qualified: "contacted",
  contacted: "contacted",
  contact_made: "contacted",
  meeting_scheduled: "assessment_scheduled",
  proposal_sent: "quote_sent",
  quote_sent: "quote_sent",
  negotiation: "follow_up_1",
  follow_up_1: "follow_up_1",
  follow_up_2: "follow_up_1",
  stand_by: "stand_by",
  closed_won: "won",
  won: "won",
  closed_lost: "lost",
  lost: "lost",
};

const QUOTE_STATUS_MAP: Record<string, string> = {
  draft: "draft",
  sent: "sent",
  viewed: "sent",
  approved: "approved",
  accepted: "approved",
  rejected: "archived",
  declined: "archived",
  expired: "expired",
};

const INVOICE_STATUS_MAP: Record<string, string> = {
  issued: "sent",
  sent: "sent",
  paid: "paid",
  void: "void",
};

const ROLE_MAP: Record<string, string> = {
  admin: "admin",
  support: "office",
  sales: "sales",
  manager: "general_manager",
};

function dec(v: unknown, fallback = 0): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(fallback);
  return new Prisma.Decimal(String(v));
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function mapCustomerType(t: unknown): string {
  const v = String(t || "residential").toLowerCase();
  if (v === "builder") return "builder";
  if (v === "commercial" || v === "property_manager" || v === "investor") return "commercial";
  return "residential";
}

function quoteNumberInt(quoteNumber: unknown, fallbackId: number): number {
  const s = String(quoteNumber || "");
  const m = s.match(/(\d+)\s*$/);
  if (m) return Number(m[1]);
  return fallbackId;
}

function mapUnit(u: unknown): string {
  const v = String(u || "sq_ft").toLowerCase();
  if (v === "sqft" || v === "sq_ft" || v === "sq.ft") return "sqft";
  if (v === "linear_ft" || v === "lf") return "lf";
  if (v === "fixed" || v === "each" || v === "piece") return "each";
  if (v === "box") return "box";
  if (v === "inches") return "in";
  return v || "sqft";
}

async function exportFromMysql(url: string) {
  console.log("Connecting to Senior Floors MySQL…");
  const conn = await mysql.createConnection(url);
  const tables = [
    "users",
    "pipeline_stages",
    "leads",
    "lead_qualification",
    "interactions",
    "customers",
    "builders",
    "suppliers",
    "products",
    "category_margin_defaults",
    "quote_service_catalog",
    "pricing_services",
    "quotes",
    "quote_items",
    "quote_invoices",
  ] as const;

  const dump: Record<string, unknown[]> = {};
  for (const table of tables) {
    try {
      // Exclude large blobs from quotes/invoices
      if (table === "quotes") {
        const [rows] = await conn.query(
          `SELECT id, lead_id, customer_id, project_id, builder_id, quote_party, version,
                  quote_number, total_amount, labor_amount, materials_amount, subtotal,
                  discount_value, tax_total, margin_percent, discount_type, status,
                  issue_date, expiration_date, sent_at, viewed_at, approved_at, declined_at,
                  decline_reason, notes, internal_notes, terms_conditions, currency,
                  public_token, pdf_path, client_signed_name, client_snapshot_json,
                  assigned_to, created_by, service_type, job_name, job_address,
                  created_at, updated_at
           FROM quotes`,
        );
        dump[table] = rows as unknown[];
      } else if (table === "quote_invoices") {
        const [rows] = await conn.query(
          `SELECT id, quote_id, project_id, customer_id, invoice_number, invoice_type,
                  amount, quote_total, due_date, status, payment_instructions, notes,
                  email_sent_at, paid_at, created_by, created_at, updated_at
           FROM quote_invoices`,
        );
        dump[table] = rows as unknown[];
      } else {
        const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
        dump[table] = rows as unknown[];
      }
      console.log(`  ${table}: ${dump[table].length}`);
    } catch (e) {
      console.warn(`  ${table}: skipped (${e instanceof Error ? e.message : e})`);
      dump[table] = [];
    }
  }
  await conn.end();

  fs.mkdirSync(path.dirname(DUMP_PATH), { recursive: true });
  fs.writeFileSync(DUMP_PATH, JSON.stringify(dump));
  console.log(`Wrote ${DUMP_PATH}`);
  return dump;
}

async function wipeTenantData(organizationId: string) {
  console.log("Wiping existing tenant business data (--force)…");
  await withTenantTransaction(organizationId, async (tx) => {
    await tx.invoiceReceipt.deleteMany({});
    await tx.invoiceLineItem.deleteMany({});
    await tx.quoteInvoice.deleteMany({});
    await tx.quoteLineItem.deleteMany({});
    await tx.quoteRoom.deleteMany({});
    await tx.quoteOptionGroup.deleteMany({});
    await tx.quote.deleteMany({});
    await tx.customer.deleteMany({});
    await tx.lead.deleteMany({});
    await tx.builder.deleteMany({});
    await tx.product.deleteMany({});
    await tx.supplier.deleteMany({});
    await tx.categoryMargin.deleteMany({});
    await tx.quoteCatalogItem.deleteMany({});
    await tx.pricingItem.deleteMany({});
    // Keep bootstrap pipeline stages / roles / admin user
  });
}

async function ensureOrg() {
  const existing = await prisma.organization.findUnique({ where: { slug: SLUG } });
  if (existing) {
    if (!FORCE) {
      const leadCount = await prisma.lead.count({ where: { organizationId: existing.id } });
      if (leadCount > 0) {
        throw new Error(
          `Organization "${SLUG}" already has ${leadCount} leads. Re-run with --force to wipe and re-import.`,
        );
      }
    } else {
      await wipeTenantData(existing.id);
    }
    console.log(`Using existing org ${existing.id} (${SLUG})`);
    return existing;
  }

  console.log("Creating organization…");
  const created = await createOrganizationWithAdmin({
    organizationName: ORG_NAME,
    slug: SLUG,
    adminName: ADMIN_NAME,
    adminEmail: ADMIN_EMAIL,
    password: DEFAULT_PASSWORD,
    contactEmail: "contact@senior-floors.com",
  });
  console.log(`Created org ${created.organization.id}, admin ${created.admin.email}`);
  return created.organization;
}

async function migrateUsers(
  orgId: string,
  rows: Array<Record<string, unknown>>,
): Promise<IdMap> {
  const map: IdMap = new Map();
  const roles = await prisma.role.findMany({ where: { organizationId: orgId } });
  const roleByKey = new Map(roles.map((r) => [r.key, r.id]));
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  await withTenantTransaction(orgId, async (tx) => {
    for (const u of rows) {
      const email = String(u.email || "").toLowerCase();
      if (!email) continue;
      const roleKey = ROLE_MAP[String(u.role || "office")] || "office";
      const roleId = roleByKey.get(roleKey) || roleByKey.get("office")!;

      let user = await tx.user.findFirst({
        where: { email },
      });
      if (!user) {
        user = await tx.user.create({
          data: {
            email,
            name: String(u.name || email),
            passwordHash,
            roleId,
            status: u.active === 0 || u.active === false ? "disabled" : "active",
            mustChangePassword: true,
          },
        });
      }
      map.set(Number(u.id), user.id);
    }
  });
  console.log(`Users mapped: ${map.size}`);
  return map;
}

async function stageMaps(orgId: string, mysqlStages: Array<Record<string, unknown>>) {
  const saasStages = await prisma.pipelineStage.findMany({ where: { organizationId: orgId } });
  const bySlug = new Map(saasStages.map((s) => [s.slug || "", s.id]));
  const mysqlIdToSaas: IdMap = new Map();

  for (const st of mysqlStages) {
    const slug = String(st.slug || "");
    const target = STAGE_SLUG_MAP[slug] || STAGE_SLUG_MAP[String(st.name || "").toLowerCase()] || "new";
    const saasId = bySlug.get(target) || bySlug.get("new")!;
    mysqlIdToSaas.set(Number(st.id), saasId);
  }
  return { mysqlIdToSaas, bySlug };
}

async function main() {
  const mysqlUrl = process.env.SF_MYSQL_URL;
  if (!mysqlUrl) {
    console.error("Set SF_MYSQL_URL to the Senior Floors MySQL connection string.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (SaaS Postgres).");
    process.exit(1);
  }

  const dump = await exportFromMysql(mysqlUrl);
  const org = await ensureOrg();
  const orgId = org.id;

  const userMap = await migrateUsers(orgId, (dump.users || []) as Array<Record<string, unknown>>);
  const { mysqlIdToSaas: stageMap, bySlug: stageBySlug } = await stageMaps(
    orgId,
    (dump.pipeline_stages || []) as Array<Record<string, unknown>>,
  );

  const supplierMap: IdMap = new Map();
  const productMap: IdMap = new Map();
  const catalogMap: IdMap = new Map();
  const builderMap: IdMap = new Map();
  const leadMap: IdMap = new Map();
  const customerMap: IdMap = new Map();
  const quoteMap: IdMap = new Map();

  // --- Cadastros: suppliers / products / margins / catalog / pricing / builders ---
  await withTenantTransaction(orgId, async (tx) => {
    for (const s of (dump.suppliers || []) as Array<Record<string, unknown>>) {
      const row = await tx.supplier.create({
        data: {
          name: String(s.name || "Supplier"),
          contactName: str(s.contact_name),
          phone: str(s.phone),
          email: str(s.email),
          address: str(s.address),
          notes: str(s.notes),
          active: s.active !== 0 && s.active !== false,
        },
      });
      supplierMap.set(Number(s.id), row.id);
    }

    for (const p of (dump.products || []) as Array<Record<string, unknown>>) {
      const supplierId = p.supplier_id ? supplierMap.get(Number(p.supplier_id)) : undefined;
      const row = await tx.product.create({
        data: {
          supplierId: supplierId ?? null,
          name: String(p.name || "Product"),
          category: String(p.category || "Hardwood"),
          unitType: String(p.unit_type || "sq_ft"),
          costPrice: dec(p.cost_price),
          sku: str(p.sku),
          description: str(p.description),
          stockQty: p.stock_qty != null ? Number(p.stock_qty) : null,
          active: p.active !== 0 && p.active !== false,
        },
      });
      productMap.set(Number(p.id), row.id);
    }

    for (const m of (dump.category_margin_defaults || []) as Array<Record<string, unknown>>) {
      const category = String(m.category || "").trim();
      if (!category) continue;
      await tx.categoryMargin.upsert({
        where: {
          organizationId_category: { organizationId: orgId, category },
        },
        create: {
          category,
          marginPercentage: dec(m.margin_percentage, 30),
        },
        update: {
          marginPercentage: dec(m.margin_percentage, 30),
        },
      });
    }

    let catalogOrder = 0;
    for (const c of (dump.quote_service_catalog || []) as Array<Record<string, unknown>>) {
      const rate = c.rate_customer ?? c.default_rate ?? 0;
      const row = await tx.quoteCatalogItem.create({
        data: {
          name: String(c.name || "Service"),
          serviceType: str(c.category),
          unitType: String(c.unit_type || "sq_ft"),
          unitPrice: dec(rate),
          description: str(c.default_description) || str(c.notes_customer),
          active: c.active !== 0 && c.active !== false,
          sortOrder: catalogOrder++,
        },
      });
      catalogMap.set(Number(c.id), row.id);
    }

    for (const p of (dump.pricing_services || []) as Array<Record<string, unknown>>) {
      await tx.pricingItem.create({
        data: {
          name: String(p.name || "Service"),
          category: String(p.category || "installation"),
          unit: String(p.unit || "sq_ft"),
          price: dec(p.price_min),
          priceMin: dec(p.price_min),
          priceMax: dec(p.price_max),
          partnerPrice: p.partner_price != null ? dec(p.partner_price) : null,
          notes: str(p.notes),
          isVisible: p.is_visible !== 0 && p.is_visible !== false,
          isLocked: Boolean(p.is_locked),
          active: true,
          sortOrder: Number(p.sort_order || 0),
        },
      });
    }

    for (const b of (dump.builders || []) as Array<Record<string, unknown>>) {
      const row = await tx.builder.create({
        data: {
          firstName: String(b.first_name || "Builder").trim() || "Builder",
          lastName: String(b.last_name || "").trim(),
          email: str(b.email),
          phone: str(b.phone),
          company: str(b.company),
          type: String(b.type || "builder"),
          status: String(b.status || "active"),
          address: str(b.address),
          notes: str(b.notes),
        },
      });
      builderMap.set(Number(b.id), row.id);
    }
  });
  console.log(
    `Cadastros: suppliers=${supplierMap.size} products=${productMap.size} catalog=${catalogMap.size} builders=${builderMap.size}`,
  );

  // --- Leads ---
  const qualifications = new Map<number, Record<string, unknown>>();
  for (const q of (dump.lead_qualification || []) as Array<Record<string, unknown>>) {
    qualifications.set(Number(q.lead_id), q);
  }
  const interactionsByLead = new Map<number, Array<Record<string, unknown>>>();
  for (const i of (dump.interactions || []) as Array<Record<string, unknown>>) {
    const lid = Number(i.lead_id);
    if (!interactionsByLead.has(lid)) interactionsByLead.set(lid, []);
    interactionsByLead.get(lid)!.push(i);
  }

  const leads = (dump.leads || []) as Array<Record<string, unknown>>;
  const LEAD_BATCH = 50;
  for (let i = 0; i < leads.length; i += LEAD_BATCH) {
    const batch = leads.slice(i, i + LEAD_BATCH);
    await withTenantTransaction(orgId, async (tx) => {
      for (const lead of batch) {
        const mysqlId = Number(lead.id);
        const stageFromId = lead.pipeline_stage_id
          ? stageMap.get(Number(lead.pipeline_stage_id))
          : undefined;
        const statusSlug = String(lead.status || "new");
        const mappedSlug = STAGE_SLUG_MAP[statusSlug] || "new";
        const pipelineStageId = stageFromId || stageBySlug.get(mappedSlug) || stageBySlug.get("new")!;

        const qual = qualifications.get(mysqlId);
        const interactions = interactionsByLead.get(mysqlId) || [];
        const metadata: Record<string, unknown> = {
          legacyId: mysqlId,
          address: str(lead.address),
          zipcode: str(lead.zipcode),
          priority: str(lead.priority),
          estimated_value: lead.estimated_value != null ? Number(lead.estimated_value) : null,
          form_type: str(lead.form_type),
          message: str(lead.message),
          referring_builder_id: lead.referring_builder_id
            ? builderMap.get(Number(lead.referring_builder_id)) || null
            : null,
          pipeline_stage_entered_at: lead.pipeline_stage_entered_at || null,
        };
        if (qual) {
          metadata.qualification = {
            property_type: qual.property_type,
            service_type: qual.service_type,
            estimated_area: qual.estimated_area,
            estimated_budget: qual.estimated_budget,
            urgency: qual.urgency,
            decision_maker: qual.decision_maker,
            payment_type: qual.payment_type,
            score: qual.score,
            decision_timeline: qual.decision_timeline,
            qualification_notes: qual.qualification_notes,
          };
        }
        if (interactions.length) {
          metadata.interactions = interactions.map((x) => ({
            type: x.type,
            notes: x.notes,
            created_at: x.created_at,
            legacy_user_id: x.user_id,
          }));
        }

        const ownerId = lead.owner_id ? userMap.get(Number(lead.owner_id)) : undefined;
        const isLost = mappedSlug === "lost";
        const row = await tx.lead.create({
          data: {
            name: String(lead.name || "Lead"),
            email: str(lead.email),
            phone: str(lead.phone),
            source: str(lead.source),
            status: mappedSlug,
            notes: str(lead.notes) || str(lead.message),
            metadata: metadata as Prisma.InputJsonValue,
            pipelineStageId,
            ownerId: ownerId ?? null,
            lostAt: isLost ? (lead.updated_at ? new Date(String(lead.updated_at)) : new Date()) : null,
            createdAt: lead.created_at ? new Date(String(lead.created_at)) : undefined,
            updatedAt: lead.updated_at ? new Date(String(lead.updated_at)) : undefined,
          },
        });
        leadMap.set(mysqlId, row.id);
      }
    });
    console.log(`Leads ${Math.min(i + LEAD_BATCH, leads.length)}/${leads.length}`);
  }

  // --- Customers ---
  const customers = (dump.customers || []) as Array<Record<string, unknown>>;
  for (let i = 0; i < customers.length; i += LEAD_BATCH) {
    const batch = customers.slice(i, i + LEAD_BATCH);
    await withTenantTransaction(orgId, async (tx) => {
      for (const c of batch) {
        const leadId = c.lead_id ? leadMap.get(Number(c.lead_id)) : undefined;
        const addressParts = [str(c.address), str(c.city), str(c.state), str(c.zipcode)]
          .filter(Boolean)
          .join(", ");
        const notesBits = [str(c.notes), c.responsible_name ? `Responsible: ${c.responsible_name}` : null]
          .filter(Boolean)
          .join("\n");
        const row = await tx.customer.create({
          data: {
            leadId: leadId ?? null,
            name: String(c.name || "Customer"),
            email: str(c.email),
            phone: str(c.phone),
            address: addressParts || str(c.address),
            customerType: mapCustomerType(c.customer_type),
            company: str(c.responsible_name),
            notes: notesBits || null,
            createdAt: c.created_at ? new Date(String(c.created_at)) : undefined,
            updatedAt: c.updated_at ? new Date(String(c.updated_at)) : undefined,
          },
        });
        customerMap.set(Number(c.id), row.id);

        if (str(c.address) || str(c.city)) {
          await tx.property.create({
            data: {
              customerId: row.id,
              label: "Primary",
              line1: str(c.address) || "Address TBD",
              city: str(c.city) || "Unknown",
              state: str(c.state) || "XX",
              postalCode: str(c.zipcode) || "00000",
              country: "US",
            },
          });
        }
      }
    });
    console.log(`Customers ${Math.min(i + LEAD_BATCH, customers.length)}/${customers.length}`);
  }

  // --- Quotes + items ---
  const itemsByQuote = new Map<number, Array<Record<string, unknown>>>();
  for (const item of (dump.quote_items || []) as Array<Record<string, unknown>>) {
    const qid = Number(item.quote_id);
    if (!itemsByQuote.has(qid)) itemsByQuote.set(qid, []);
    itemsByQuote.get(qid)!.push(item);
  }

  const quotes = (dump.quotes || []) as Array<Record<string, unknown>>;
  const usedNumbers = new Set<number>();
  let maxQuoteNumber = 0;
  const QUOTE_BATCH = 20;

  for (let i = 0; i < quotes.length; i += QUOTE_BATCH) {
    const batch = quotes.slice(i, i + QUOTE_BATCH);
    await withTenantTransaction(orgId, async (tx) => {
      for (const q of batch) {
        const mysqlId = Number(q.id);
        let number = quoteNumberInt(q.quote_number, mysqlId);
        while (usedNumbers.has(number)) number += 1;
        usedNumbers.add(number);
        if (number > maxQuoteNumber) maxQuoteNumber = number;

        const status = QUOTE_STATUS_MAP[String(q.status || "draft")] || "draft";
        const discountTypeRaw = str(q.discount_type);
        const discountType =
          discountTypeRaw === "percentage" ? "percent" : discountTypeRaw === "fixed" ? "fixed" : null;

        const payload: Record<string, unknown> = {
          legacyId: mysqlId,
          quote_party: q.quote_party,
          version: q.version,
          job_name: q.job_name,
          job_address: q.job_address,
          margin_percent: q.margin_percent,
          currency: q.currency,
          internal_notes: q.internal_notes,
          client_snapshot_json: q.client_snapshot_json
            ? (() => {
                try {
                  return JSON.parse(String(q.client_snapshot_json));
                } catch {
                  return String(q.client_snapshot_json);
                }
              })()
            : null,
          pdf_path: q.pdf_path,
          issue_date: q.issue_date,
          sent_at: q.sent_at,
          approved_at: q.approved_at,
        };

        const row = await tx.quote.create({
          data: {
            customerId: q.customer_id ? customerMap.get(Number(q.customer_id)) ?? null : null,
            leadId: q.lead_id ? leadMap.get(Number(q.lead_id)) ?? null : null,
            builderId: q.builder_id ? builderMap.get(Number(q.builder_id)) ?? null : null,
            salespersonId: q.assigned_to
              ? userMap.get(Number(q.assigned_to)) ?? null
              : q.created_by
                ? userMap.get(Number(q.created_by)) ?? null
                : null,
            number,
            quoteNumber: str(q.quote_number),
            title: str(q.job_name) || str(q.quote_number) || `Quote ${number}`,
            status,
            flooringType: "hardwood",
            areaSqft: dec(0),
            materialCost: dec(q.materials_amount),
            laborCost: dec(q.labor_amount),
            subtotal: dec(q.subtotal ?? q.total_amount),
            discountType,
            discountValue: dec(q.discount_value),
            taxTotal: dec(q.tax_total),
            total: dec(q.total_amount),
            notes: str(q.notes) || str(q.internal_notes),
            terms: str(q.terms_conditions),
            validUntil: q.expiration_date ? new Date(String(q.expiration_date)) : null,
            viewedAt: q.viewed_at ? new Date(String(q.viewed_at)) : null,
            serviceType: str(q.service_type),
            publicToken: str(q.public_token),
            signedByName: str(q.client_signed_name),
            signedAt: q.approved_at ? new Date(String(q.approved_at)) : null,
            payload: payload as Prisma.InputJsonValue,
            invoicePdfPath: str(q.pdf_path),
            createdAt: q.created_at ? new Date(String(q.created_at)) : undefined,
            updatedAt: q.updated_at ? new Date(String(q.updated_at)) : undefined,
          },
        });
        quoteMap.set(mysqlId, row.id);

        const items = itemsByQuote.get(mysqlId) || [];
        let sort = 0;
        for (const item of items) {
          const qty = dec(item.quantity ?? item.area_sqft ?? 1, 1);
          const unitPrice = dec(item.unit_price ?? item.sell_price ?? 0);
          const amount = dec(item.total_price ?? Number(qty) * Number(unitPrice));
          await tx.quoteLineItem.create({
            data: {
              quoteId: row.id,
              name: str(item.name) || str(item.floor_type) || "Line item",
              description:
                str(item.description) ||
                str(item.notes) ||
                str(item.name) ||
                str(item.floor_type) ||
                "Item",
              quantity: qty,
              unit: mapUnit(item.unit_type),
              unitCost: dec(item.cost_price),
              unitPrice,
              amount,
              itemType: String(item.item_type || item.type || "service") === "product" ? "product" : "service",
              productId: item.product_id ? productMap.get(Number(item.product_id)) ?? null : null,
              catalogId: item.service_catalog_id
                ? catalogMap.get(Number(item.service_catalog_id)) ?? null
                : null,
              sortOrder: Number(item.sort_order ?? sort++),
              meta: {
                legacyId: item.id,
                floor_type: item.floor_type,
                type: item.type,
                markup_percentage: item.markup_percentage,
                catalog_customer_notes: item.catalog_customer_notes,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
    });
    console.log(`Quotes ${Math.min(i + QUOTE_BATCH, quotes.length)}/${quotes.length}`);
  }

  // --- Invoices ---
  const invoices = (dump.quote_invoices || []) as Array<Record<string, unknown>>;
  await withTenantTransaction(orgId, async (tx) => {
    for (const inv of invoices) {
      const quoteId = quoteMap.get(Number(inv.quote_id));
      if (!quoteId) {
        console.warn(`  skip invoice ${inv.id}: quote ${inv.quote_id} missing`);
        continue;
      }
      await tx.quoteInvoice.create({
        data: {
          quoteId,
          customerId: inv.customer_id ? customerMap.get(Number(inv.customer_id)) ?? null : null,
          invoiceNumber: str(inv.invoice_number),
          invoiceType: String(inv.invoice_type || "other"),
          status: INVOICE_STATUS_MAP[String(inv.status || "issued")] || "sent",
          amount: dec(inv.amount),
          dueDate: inv.due_date ? new Date(String(inv.due_date)) : null,
          issuedAt: inv.created_at ? new Date(String(inv.created_at)) : null,
          paidAt: inv.paid_at ? new Date(String(inv.paid_at)) : null,
          notes: str(inv.notes),
          paymentInstructions: str(inv.payment_instructions),
          payload: {
            legacyId: inv.id,
            quote_total: inv.quote_total,
            email_sent_at: inv.email_sent_at,
          } as Prisma.InputJsonValue,
          createdAt: inv.created_at ? new Date(String(inv.created_at)) : undefined,
          updatedAt: inv.updated_at ? new Date(String(inv.updated_at)) : undefined,
        },
      });
    }
  });
  console.log(`Invoices: ${invoices.length}`);

  // Document sequences
  await withTenantTransaction(orgId, async (tx) => {
    const nextQuote = maxQuoteNumber + 1;
    await tx.documentSequence.upsert({
      where: { organizationId_kind: { organizationId: orgId, kind: "quote" } },
      create: { kind: "quote", nextValue: nextQuote },
      update: { nextValue: nextQuote },
    });
    await tx.documentSequence.upsert({
      where: { organizationId_kind: { organizationId: orgId, kind: "invoice" } },
      create: { kind: "invoice", nextValue: invoices.length + 1 },
      update: { nextValue: invoices.length + 1 },
    });
  });

  const counts = await withTenantTransaction(orgId, async (tx) => ({
    leads: await tx.lead.count({}),
    customers: await tx.customer.count({}),
    builders: await tx.builder.count({}),
    quotes: await tx.quote.count({}),
    lineItems: await tx.quoteLineItem.count({}),
    invoices: await tx.quoteInvoice.count({}),
    catalog: await tx.quoteCatalogItem.count({}),
    pricing: await tx.pricingItem.count({}),
    suppliers: await tx.supplier.count({}),
    products: await tx.product.count({}),
    users: await tx.user.count({}),
  }));

  console.log("\n=== Migration complete ===");
  console.log(`Organization: ${ORG_NAME} (slug: ${SLUG})`);
  console.log(`Login: ${ADMIN_EMAIL} / ${DEFAULT_PASSWORD} (mustChangePassword for new users)`);
  console.log("Counts:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
