/**
 * Backfill quotes (and linked customers) from legacy MySQL that are missing
 * in the ObraMate tenant — e.g. created after the Sep 29 export.
 *
 * Usage:
 *   SF_MYSQL_URL='mysql://…' DATABASE_URL='postgresql://…' \
 *     npx tsx scripts/backfill-missing-sf-quotes.ts
 *   … --dry-run
 *   … --name "Debbie Ferback"
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";

const SLUG = "senior-floors";
const DRY = process.argv.includes("--dry-run");
const nameArgIdx = process.argv.indexOf("--name");
const NAME_FILTER = nameArgIdx >= 0 ? String(process.argv[nameArgIdx + 1] || "").trim() : "";

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
  if (v === "builder" || v === "contractor") return "builder";
  if (v === "commercial" || v === "property_manager" || v === "investor" || v === "loja") return "loja";
  return "particular";
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

function quoteNumberInt(quoteNumber: unknown, fallbackId: number): number {
  const s = String(quoteNumber || "");
  const m = s.match(/(\d+)\s*$/);
  if (m) return Number(m[1]);
  return fallbackId;
}

async function main() {
  const mysqlUrl = process.env.SF_MYSQL_URL;
  if (!mysqlUrl) throw new Error("SF_MYSQL_URL is required");

  const org = await prisma.organization.findFirst({ where: { slug: SLUG } });
  if (!org) throw new Error(`Organization ${SLUG} not found`);
  console.log(`Org ${org.slug} (${org.id}) dryRun=${DRY} nameFilter=${NAME_FILTER || "(all missing)"}`);

  const conn = await mysql.createConnection(mysqlUrl);

  // Existing legacy quote ids already in ObraMate
  const existing = await prisma.quote.findMany({
    where: { organizationId: org.id },
    select: { id: true, quoteNumber: true, number: true, payload: true },
  });
  const legacyIds = new Set<number>();
  const quoteNumbers = new Set<string>();
  let maxNumber = 0;
  for (const q of existing) {
    const lid = (q.payload as { legacyId?: number } | null)?.legacyId;
    if (typeof lid === "number") legacyIds.add(lid);
    if (q.quoteNumber) quoteNumbers.add(q.quoteNumber);
    if (q.number > maxNumber) maxNumber = q.number;
  }
  console.log(`Existing quotes=${existing.length} withLegacyId=${legacyIds.size} maxNumber=${maxNumber}`);

  // Lead map: legacyId -> saas id
  const leads = await prisma.lead.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, email: true, metadata: true },
  });
  const leadByLegacy = new Map<number, string>();
  for (const l of leads) {
    const lid = (l.metadata as { legacyId?: number } | null)?.legacyId;
    if (typeof lid === "number") leadByLegacy.set(lid, l.id);
  }

  // Customer map by legacy — we store legacyId in notes/metadata? Check notes or re-match by email
  const customers = await prisma.customer.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, email: true, leadId: true, notes: true },
  });
  const customerByEmail = new Map<string, string>();
  const customerByLead = new Map<string, string>();
  for (const c of customers) {
    if (c.email) customerByEmail.set(c.email.toLowerCase(), c.id);
    if (c.leadId) customerByLead.set(c.leadId, c.id);
  }

  let quoteSql = `SELECT * FROM quotes`;
  const quoteParams: unknown[] = [];
  if (NAME_FILTER) {
    quoteSql = `
      SELECT q.* FROM quotes q
      LEFT JOIN leads l ON l.id = q.lead_id
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE l.name LIKE ? OR c.name LIKE ? OR q.job_name LIKE ?
         OR IFNULL(q.client_snapshot_json,'') LIKE ?
         OR IFNULL(q.notes,'') LIKE ?`;
    const like = `%${NAME_FILTER}%`;
    quoteParams.push(like, like, like, like, like);
  }
  const [mysqlQuotes] = await conn.query(quoteSql, quoteParams);
  const allQuotes = mysqlQuotes as Array<Record<string, unknown>>;

  const missing = allQuotes.filter((q) => {
    const id = Number(q.id);
    const qn = str(q.quote_number);
    if (legacyIds.has(id)) return false;
    if (qn && quoteNumbers.has(qn)) return false;
    return true;
  });
  console.log(`MySQL quotes matched=${allQuotes.length} missing=${missing.length}`);
  for (const q of missing) {
    console.log(
      `  - #${q.id} ${q.quote_number} status=${q.status} total=${q.total_amount} lead=${q.lead_id} customer=${q.customer_id}`,
    );
  }
  if (!missing.length) {
    await conn.end();
    return;
  }

  const missingIds = missing.map((q) => Number(q.id));
  const [items] = await conn.query(`SELECT * FROM quote_items WHERE quote_id IN (?) ORDER BY quote_id, COALESCE(sort_order, id)`, [
    missingIds,
  ]);
  const itemsByQuote = new Map<number, Array<Record<string, unknown>>>();
  for (const item of items as Array<Record<string, unknown>>) {
    const qid = Number(item.quote_id);
    if (!itemsByQuote.has(qid)) itemsByQuote.set(qid, []);
    itemsByQuote.get(qid)!.push(item);
  }

  // Customers referenced by missing quotes
  const custIds = [...new Set(missing.map((q) => Number(q.customer_id)).filter((n) => Number.isFinite(n) && n > 0))];
  const mysqlCustomers = new Map<number, Record<string, unknown>>();
  if (custIds.length) {
    const [rows] = await conn.query(`SELECT * FROM customers WHERE id IN (?)`, [custIds]);
    for (const c of rows as Array<Record<string, unknown>>) mysqlCustomers.set(Number(c.id), c);
  }

  // Users for salesperson
  const users = await prisma.user.findMany({
    where: { organizationId: org.id },
    select: { id: true, email: true },
  });
  const [mysqlUsers] = await conn.query(`SELECT id, email FROM users`);
  const userByLegacy = new Map<number, string>();
  const emailToUser = new Map(users.map((u) => [String(u.email || "").toLowerCase(), u.id]));
  for (const u of mysqlUsers as Array<{ id: number; email: string }>) {
    const sid = emailToUser.get(String(u.email || "").toLowerCase());
    if (sid) userByLegacy.set(Number(u.id), sid);
  }

  if (DRY) {
    console.log("Dry run — no writes.");
    await conn.end();
    return;
  }

  const customerMap = new Map<number, string>(); // mysql customer id -> saas id

  await withTenantTransaction(org.id, async (tx) => {
    // Ensure customers
    for (const [mysqlId, c] of mysqlCustomers) {
      const email = str(c.email)?.toLowerCase() || null;
      const leadSaas = c.lead_id ? leadByLegacy.get(Number(c.lead_id)) : undefined;
      let existingId =
        (email && customerByEmail.get(email)) || (leadSaas && customerByLead.get(leadSaas)) || null;
      if (existingId) {
        customerMap.set(mysqlId, existingId);
        continue;
      }
      const addressParts = [str(c.address), str(c.city), str(c.state), str(c.zipcode)].filter(Boolean).join(", ");
      const row = await tx.customer.create({
        data: {
          leadId: leadSaas ?? null,
          name: String(c.name || "Customer"),
          email: str(c.email),
          phone: str(c.phone),
          address: addressParts || str(c.address),
          customerType: mapCustomerType(c.customer_type),
          company: str(c.responsible_name),
          notes: [str(c.notes), `legacyCustomerId:${mysqlId}`].filter(Boolean).join("\n") || null,
          createdAt: c.created_at ? new Date(String(c.created_at)) : undefined,
          updatedAt: c.updated_at ? new Date(String(c.updated_at)) : undefined,
        },
      });
      customerMap.set(mysqlId, row.id);
      if (email) customerByEmail.set(email, row.id);
      if (leadSaas) customerByLead.set(leadSaas, row.id);
      console.log(`  + customer ${row.name} (${row.id}) from legacy #${mysqlId}`);

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

    const usedNumbers = new Set(existing.map((q) => q.number));
    let nextMax = maxNumber;

    for (const q of missing) {
      const mysqlId = Number(q.id);
      let number = quoteNumberInt(q.quote_number, mysqlId);
      while (usedNumbers.has(number)) number += 1;
      usedNumbers.add(number);
      if (number > nextMax) nextMax = number;

      const status = QUOTE_STATUS_MAP[String(q.status || "draft")] || "draft";
      const discountTypeRaw = str(q.discount_type);
      const discountType =
        discountTypeRaw === "percentage" ? "percent" : discountTypeRaw === "fixed" ? "fixed" : null;

      const leadId = q.lead_id ? leadByLegacy.get(Number(q.lead_id)) ?? null : null;
      const customerId = q.customer_id ? customerMap.get(Number(q.customer_id)) ?? null : null;

      const payload: Record<string, unknown> = {
        legacyId: mysqlId,
        quote_party: q.quote_party,
        version: q.version,
        job_name: q.job_name,
        job_address: q.job_address,
        margin_percent: q.margin_percent,
        currency: q.currency,
        internal_notes: q.internal_notes,
        pdf_path: q.pdf_path,
        issue_date: q.issue_date,
        sent_at: q.sent_at,
        approved_at: q.approved_at,
        backfilledAt: new Date().toISOString(),
      };

      const row = await tx.quote.create({
        data: {
          customerId,
          leadId,
          salespersonId: q.assigned_to
            ? userByLegacy.get(Number(q.assigned_to)) ?? null
            : q.created_by
              ? userByLegacy.get(Number(q.created_by)) ?? null
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

      const qItems = itemsByQuote.get(mysqlId) || [];
      let sort = 0;
      for (const item of qItems) {
        const qty = dec(item.quantity ?? item.area_sqft ?? 1, 1);
        const unitPrice = dec(item.unit_price ?? item.sell_price ?? 0);
        const amount = dec(item.total_price ?? item.total ?? Number(qty) * Number(unitPrice));
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
            unit: mapUnit(item.unit_type || item.unit),
            unitCost: dec(item.cost_price),
            unitPrice,
            amount,
            itemType: String(item.item_type || item.type || "service") === "product" ? "product" : "service",
            sortOrder: Number(item.sort_order ?? sort++),
            meta: {
              legacyId: item.id,
              floor_type: item.floor_type,
              type: item.type,
              service_type: item.service_type,
            } as Prisma.InputJsonValue,
          },
        });
      }
      console.log(
        `  + quote ${row.quoteNumber} (#${row.number}) status=${row.status} total=${row.total} items=${qItems.length} legacy=#${mysqlId}`,
      );
    }

    // Bump lead status for Debbie-like won leads when we imported approved quotes
    for (const q of missing) {
      if (!q.lead_id) continue;
      const leadSaas = leadByLegacy.get(Number(q.lead_id));
      if (!leadSaas) continue;
      const mysqlStatus = String(q.status || "");
      if (mysqlStatus === "approved" || mysqlStatus === "accepted") {
        const stage = await tx.pipelineStage.findFirst({
          where: { organizationId: org.id, slug: "won" },
        });
        await tx.lead.update({
          where: { id: leadSaas },
          data: {
            status: "won",
            ...(stage ? { pipelineStageId: stage.id } : {}),
          },
        });
        console.log(`  ~ lead ${leadSaas} → won (from approved quote ${q.quote_number})`);
      }
    }
  });

  await conn.end();
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
