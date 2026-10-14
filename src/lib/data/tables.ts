import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

/**
 * Every table that holds a company's rows has an "organizationId" column (checked at runtime
 * from information_schema, so new modules are covered without touching this file).
 */

export type OrgTable = { name: string; columns: string[]; hasId: boolean };

let cache: { at: number; tables: OrgTable[] } | null = null;

export async function orgTables(): Promise<OrgTable[]> {
  if (cache && Date.now() - cache.at < 10 * 60e3) return cache.tables;
  const rows = await prisma.$queryRaw<{ table_name: string; columns: string[] }[]>`
    SELECT c.table_name::text AS table_name, array_agg(c.column_name::text ORDER BY c.ordinal_position) AS columns
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = current_schema()
      AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'organizationId')
    GROUP BY c.table_name::text
    ORDER BY 1`;
  const tables = rows.map((r) => ({ name: r.table_name, columns: r.columns, hasId: r.columns.includes("id") }));
  cache = { at: Date.now(), tables };
  return tables;
}

/** Records about the company kept on purpose after deletion (proof and the copy handed over). */
export const KEEP_ON_DELETE = new Set(["DataExport", "DataDeletion", "PrivacyRequest"]);

/** Platform-internal or security tables left out of the company's copy. */
export const EXPORT_SKIP = new Set([
  "PlatformNote",
  "PlatformContactLog",
  "SupportSession",
  "DunningStep",
  "StripeEvent",
  "PasswordResetToken",
  "ActiveDay",
  "UsageCounter",
  "PlatformDailyMetric",
  "PlatformAnnouncementReceipt",
  "PlatformEmailLog",
  "SignupRequest",
  "SignupInvite",
  "OrgFeatureOverride",
  "DataExport",
  "DataDeletion",
  "PrivacyRequest",
]);

/** Secrets never leave the system (password hashes, link tokens, keys). */
export const SECRET_COLUMN = /(password|secret|totp|recovery|token|apikey|api_key|hash$)/i;

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const quoteIdent = q;

/** Runs `fn` in a transaction scoped to the company (RLS sees its rows when the app runs as app_user). */
export async function inTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>, timeoutMs = 120_000): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${organizationId}, true)`;
      return fn(tx);
    },
    { timeout: timeoutMs, maxWait: 20_000 },
  );
}

/** Rows per table for one company (tables with zero rows left out). */
export async function countRows(organizationId: string, opts: { skip?: Set<string> } = {}): Promise<Record<string, number>> {
  const tables = (await orgTables()).filter((t) => !opts.skip?.has(t.name));
  return inTenant(organizationId, async (tx) => {
    const out: Record<string, number> = {};
    for (const t of tables) {
      const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM ${q(t.name)} WHERE "organizationId" = $1::uuid`, organizationId);
      const n = Number(r[0]?.n ?? 0);
      if (n) out[t.name] = n;
    }
    return out;
  });
}
