import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { storage } from "../storage/index.js";
import { env } from "../../config/env.js";
import { newToken, hashToken } from "../security/db-rate-limit.js";
import { ZipWriter } from "./zip.js";
import { EXPORT_SKIP, SECRET_COLUMN, inTenant, orgTables, quoteIdent } from "./tables.js";

/**
 * Exportar uma empresa inteira (Master › Dados e privacidade).
 * ZIP with one CSV per table (every row of the company, secrets left out), all files under
 * orgs/<id>/ (photos, PDFs, receipts, logos) and a README. Built in the background; the file
 * stays 7 days, then the hourly cleanup deletes it.
 */

export const EXPORT_DAYS = 7;
export const EXPORTS_CLEANUP_JOB = "data-exports-cleanup";
const BATCH = 5000;

/** Friendly names in the README for the tables people look for first. */
const TABLE_NOTE: Record<string, string> = {
  Lead: "Leads (sales pipeline)",
  Customer: "Customers",
  Property: "Customer addresses / job sites",
  Quote: "Quotes",
  QuoteLineItem: "Quote line items",
  QuoteInvoice: "Invoices",
  InvoiceLineItem: "Invoice line items",
  InvoiceReceipt: "Payments received on invoices",
  WorkOrder: "Jobs (work orders)",
  WorkOrderLineItem: "Job services",
  JobMedia: "Job photos (files in /files/orgs/.../jobs)",
  Meeting: "Calendar appointments",
  Visit: "Visits",
  PayrollEmployee: "Employees (payroll)",
  PayrollPayment: "Payroll payments",
  CampoShiftJob: "Work days (payroll)",
  FinanceCost: "Expenses",
  User: "Team members (logins; passwords are never exported)",
  ChatMessage: "Team chat messages",
  PricingItem: "Price table",
  ActivityEvent: "Activity history",
  CommunicationLog: "Messages sent to clients",
  PlatformPayment: "Your ObraMate subscription payments",
  LegalAcceptance: "Terms / Privacy / DPA acceptances",
  SupportTicket: "Support tickets",
};

function csvCell(v: unknown): string {
  if (v == null) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "bigint") s = v.toString();
  else if (Prisma.Decimal.isDecimal(v)) s = (v as Prisma.Decimal).toString();
  else if (Buffer.isBuffer(v)) s = `(binary, ${v.length} bytes)`;
  else if (typeof v === "object") s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  else s = String(v);
  // Spreadsheet formula injection: text that starts like a formula gets a leading apostrophe.
  if (typeof v === "string" && /^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function* tableCsv(organizationId: string, table: string, columns: string[], hasId: boolean, counter: { rows: number }): AsyncGenerator<string> {
  const cols = columns.filter((c) => !SECRET_COLUMN.test(c));
  yield cols.map(csvCell).join(",") + "\r\n";
  const select = cols.map(quoteIdent).join(", ");
  let lastId: string | null = null;
  let offset = 0;
  for (;;) {
    const rows: Record<string, unknown>[] = await inTenant(organizationId, (tx) =>
      hasId
        ? tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT ${select}, "id"::text AS "__k" FROM ${quoteIdent(table)} WHERE "organizationId" = $1::uuid ${lastId ? `AND "id"::text > $2` : ""} ORDER BY "id"::text LIMIT ${BATCH}`,
            ...(lastId ? [organizationId, lastId] : [organizationId]),
          )
        : tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT ${select} FROM ${quoteIdent(table)} WHERE "organizationId" = $1::uuid LIMIT ${BATCH} OFFSET ${offset}`, organizationId),
    );
    if (!rows.length) break;
    let chunk = "";
    for (const r of rows) chunk += cols.map((c) => csvCell(r[c])).join(",") + "\r\n";
    counter.rows += rows.length;
    yield chunk;
    if (rows.length < BATCH) break;
    if (hasId) lastId = String(rows[rows.length - 1].__k);
    else offset += BATCH;
  }
}

export async function requestExport(input: {
  organizationId: string;
  requestedById: string | null;
  requestedByName: string;
  reason?: string | null;
  privacyRequestId?: string | null;
  background?: boolean;
}) {
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, name: true, slug: true } });
  if (!org) throw new Error("Empresa não encontrada.");
  const busy = await prisma.dataExport.findFirst({ where: { organizationId: org.id, status: { in: ["queued", "running"] } } });
  if (busy) return { export: busy, alreadyRunning: true };
  const row = await prisma.dataExport.create({
    data: {
      organizationId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      reason: input.reason || null,
      privacyRequestId: input.privacyRequestId || null,
      requestedById: input.requestedById,
      requestedByName: input.requestedByName,
    },
  });
  if (input.background === false) await runExport(row.id);
  else setImmediate(() => void runExport(row.id).catch((e) => console.error("[export] failed", e)));
  return { export: row, alreadyRunning: false };
}

export async function runExport(id: string): Promise<void> {
  const claimed = await prisma.dataExport.updateMany({ where: { id, status: "queued" }, data: { status: "running", startedAt: new Date() } });
  if (!claimed.count) return;
  const exp = await prisma.dataExport.findUniqueOrThrow({ where: { id } });
  const tmp = path.join(os.tmpdir(), `obramate-export-${id}.zip`);
  const zip = new ZipWriter(tmp);
  const summary: { table: string; rows: number }[] = [];
  let rows = 0;
  let files = 0;
  let missing = 0;
  try {
    const org = await prisma.organization.findUnique({ where: { id: exp.organizationId } });
    if (!org) throw new Error("A empresa não existe mais.");
    // The company itself.
    const orgCols = Object.keys(org).filter((c) => !SECRET_COLUMN.test(c));
    await zip.addBuffer("data/Organization.csv", Buffer.from(orgCols.map(csvCell).join(",") + "\r\n" + orgCols.map((c) => csvCell((org as Record<string, unknown>)[c])).join(",") + "\r\n"), { compress: true });

    for (const t of await orgTables()) {
      if (EXPORT_SKIP.has(t.name)) continue;
      const counter = { rows: 0 };
      await zip.addStream(`data/${t.name}.csv`, tableCsv(org.id, t.name, t.columns, t.hasId, counter), { compress: true });
      summary.push({ table: t.name, rows: counter.rows });
      rows += counter.rows;
    }

    const objects = await storage.list(`orgs/${org.id}/`);
    for (const o of objects) {
      const stream = await storage.getStream(o.key).catch(() => null);
      if (!stream) {
        missing++;
        continue;
      }
      const rel = o.key.slice(`orgs/${org.id}/`.length);
      const isText = /\.(csv|txt|json|html?|svg)$/i.test(rel);
      await zip.addStream(`files/${rel}`, stream, { compress: isText });
      files++;
    }

    const exportedAt = new Date();
    const readme = [
      `${env.PRODUCT_NAME} — data export`,
      "",
      `Company: ${org.name} (${org.slug})`,
      `Exported: ${exportedAt.toISOString()} by ${exp.requestedByName}`,
      `Tables: ${summary.length} · Rows: ${rows} · Files: ${files}${missing ? ` (${missing} listed but missing in storage)` : ""}`,
      "",
      "What is inside",
      "- data/  one CSV per table (UTF-8, comma separated, first line = column names). Dates are UTC (ISO 8601).",
      "         Columns ending in Id link rows between tables (for example Quote.customerId → Customer.id).",
      "         Passwords, login tokens and secret links are never exported.",
      "- files/ every file the company uploaded: job photos, documents, receipts, logos, signatures.",
      "- manifest.json  the same list in machine-readable form.",
      "",
      "Main tables",
      ...summary.filter((s) => TABLE_NOTE[s.table]).map((s) => `- ${s.table}.csv — ${TABLE_NOTE[s.table]} (${s.rows} rows)`),
      "",
      "Other tables",
      ...summary.filter((s) => !TABLE_NOTE[s.table]).map((s) => `- ${s.table}.csv (${s.rows} rows)`),
      "",
      `Questions: ${process.env.LEGAL_CONTACT_EMAIL || "support@obramate.com"}`,
      "",
    ].join("\r\n");
    await zip.addBuffer("README.txt", Buffer.from(readme, "utf8"), { compress: true });
    await zip.addBuffer(
      "manifest.json",
      Buffer.from(JSON.stringify({ company: { id: org.id, name: org.name, slug: org.slug }, exportedAt, tables: summary, files, missingFiles: missing }, null, 2)),
      { compress: true },
    );
    const size = await zip.close();
    const key = `exports/${org.id}/${id}.zip`;
    await storage.uploadFile({ key, filePath: tmp, contentType: "application/zip" });
    await prisma.dataExport.update({
      where: { id },
      data: {
        status: "ready",
        fileKey: key,
        sizeBytes: BigInt(size),
        tables: summary.length,
        rows,
        files,
        filesMissing: missing,
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPORT_DAYS * 86400e3),
      },
    });
  } catch (error) {
    zip.abort();
    const message = error instanceof Error ? error.message : String(error);
    await prisma.dataExport.update({ where: { id }, data: { status: "failed", error: message.slice(0, 500), finishedAt: new Date() } }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export function exportFileName(e: { orgSlug: string; createdAt: Date }): string {
  return `obramate-${e.orgSlug}-${e.createdAt.toISOString().slice(0, 10)}.zip`;
}

/** Link the company can open without logging in (until the export expires). Replaces the previous one. */
export async function createDownloadLink(id: string): Promise<string> {
  const { token, hash } = newToken(32);
  await prisma.dataExport.update({ where: { id }, data: { linkTokenHash: hash, linkCreatedAt: new Date() } });
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/exportacao/${token}`;
}

export async function revokeDownloadLink(id: string): Promise<void> {
  await prisma.dataExport.update({ where: { id }, data: { linkTokenHash: null, linkCreatedAt: null } });
}

export async function findByToken(token: string) {
  if (!token || token.length > 200) return null;
  return prisma.dataExport.findUnique({ where: { linkTokenHash: hashToken(token) } });
}

export function isDownloadable(e: { status: string; expiresAt: Date | null; fileKey: string | null }, now = new Date()): boolean {
  return e.status === "ready" && !!e.fileKey && !!e.expiresAt && e.expiresAt > now;
}

export async function markDownloaded(id: string): Promise<void> {
  await prisma.dataExport.update({ where: { id }, data: { downloads: { increment: 1 }, lastDownloadAt: new Date() } });
}

/** Hourly: delete files past 7 days; mark exports stuck by a restart as failed. */
export async function cleanupExports(now = new Date()): Promise<{ processed: number }> {
  let processed = 0;
  const expired = await prisma.dataExport.findMany({ where: { status: "ready", expiresAt: { lt: now } } });
  for (const e of expired) {
    if (e.fileKey) await storage.delete(e.fileKey).catch(() => undefined);
    await prisma.dataExport.update({ where: { id: e.id }, data: { status: "expired", fileKey: null, linkTokenHash: null } });
    processed++;
  }
  const stuck = await prisma.dataExport.updateMany({
    where: { status: { in: ["queued", "running"] }, createdAt: { lt: new Date(now.getTime() - 2 * 3600e3) } },
    data: { status: "failed", error: "Interrompida (o servidor reiniciou). Gere de novo.", finishedAt: now },
  });
  return { processed: processed + stuck.count };
}
