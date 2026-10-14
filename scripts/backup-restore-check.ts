/**
 * Backup restore test: proves the production database can be copied and restored.
 *
 *   1. pg_dump the source database (custom format) to a local file — this file is also a backup copy.
 *   2. pg_restore it into an EMPTY scratch database (never the source).
 *   3. Compare every table's row count, the applied migrations and the schema objects.
 *   4. Record the result as a JobRun ("backup-restore-check") in the source database,
 *      so the Master shows when the last test ran and whether it passed.
 *
 * Needs pg_dump/pg_restore installed locally (same major version as the server or newer).
 *
 *   BACKUP_SOURCE_URL=<production public URL> RESTORE_TARGET_URL=<empty scratch DB URL> npm run backup:check
 *
 * On Railway: create a temporary Postgres service (or restore a Railway backup into one),
 * copy its public URL as RESTORE_TARGET_URL, then delete the service after the test.
 * Options: --keep-dump (keep the .dump file; default deletes it), --out <dir>.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const run = promisify(execFile);

export const BACKUP_CHECK_JOB = "backup-restore-check";

export type TableCount = { table: string; source: number; restored: number };
export type BackupCheckResult = {
  ok: boolean;
  tables: number;
  rows: number;
  mismatches: TableCount[];
  migrations: { source: number; restored: number };
  dumpBytes: number;
  dumpSeconds: number;
  restoreSeconds: number;
  sourceHost: string;
  targetHost: string;
  pgDumpVersion: string;
  problems: string[];
  /** pg_restore messages that did not affect the comparison (e.g. extension ownership). */
  warnings: string[];
};

function describe(url: string): { host: string; db: string } {
  const u = new URL(url);
  const host = u.searchParams.get("host") || u.hostname;
  return { host: `${host}:${u.port || "5432"}`, db: decodeURIComponent(u.pathname.replace(/^\//, "")) };
}

/** pg_dump/pg_restore don't understand Prisma-only params (e.g. ?schema=public, connection_limit). */
function libpqUrl(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) {
    if (!["host", "sslmode", "sslrootcert", "sslcert", "sslkey", "application_name", "connect_timeout"].includes(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const u = new URL(url);
  const socketHost = u.searchParams.get("host");
  const client = new pg.Client({
    connectionString: libpqUrl(url),
    ...(socketHost ? { host: socketHost } : {}),
    ssl: u.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function userTables(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ name: string }>(
    `SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS name
       FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1`,
  );
  return r.rows.map((x) => x.name);
}

async function counts(c: pg.Client, tables: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // Repeatable read: one consistent snapshot for every count.
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    for (const t of tables) {
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`);
      out.set(t, Number(r.rows[0].n));
    }
  } finally {
    await c.query("COMMIT");
  }
  return out;
}

async function objectCount(c: pg.Client): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_class cl JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND cl.relkind IN ('r','i','S','v','m')`,
  );
  return Number(r.rows[0].n);
}

async function migrationCount(c: pg.Client): Promise<number> {
  const exists = await c.query(`SELECT to_regclass('public._prisma_migrations') AS t`);
  if (!exists.rows[0].t) return 0;
  const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  return Number(r.rows[0].n);
}

/** Runs the whole check. Throws only on setup errors; a failed comparison returns ok=false. */
export async function backupRestoreCheck(opts: { sourceUrl: string; targetUrl: string; outDir?: string; keepDump?: boolean; log?: (m: string) => void }): Promise<BackupCheckResult> {
  const log = opts.log ?? (() => {});
  const src = describe(opts.sourceUrl);
  const dst = describe(opts.targetUrl);
  if (src.host === dst.host && src.db === dst.db) throw new Error("RESTORE_TARGET_URL points at the source database. Use a separate, empty database.");

  const targetTables = await withClient(opts.targetUrl, userTables);
  if (targetTables.length) throw new Error(`The target database is not empty (${targetTables.length} tables). Use a new, empty database so nothing is overwritten.`);

  const { stdout: ver } = await run("pg_dump", ["--version"]);
  const dir = opts.outDir ?? (await mkdtemp(path.join(tmpdir(), "obramate-backup-")));
  const file = path.join(dir, `obramate-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.dump`);

  // Counts first, then the dump; rows written in between show up as a mismatch only on busy tables.
  log("Counting rows in the source…");
  const before = await withClient(opts.sourceUrl, async (c) => {
    const tables = await userTables(c);
    return { tables, counts: await counts(c, tables), objects: await objectCount(c), migrations: await migrationCount(c) };
  });

  log("Dumping the source (pg_dump)…");
  let t0 = Date.now();
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", file, libpqUrl(opts.sourceUrl)], { maxBuffer: 64 * 1024 * 1024 });
  const dumpSeconds = (Date.now() - t0) / 1000;
  const dumpBytes = (await stat(file)).size;

  log("Restoring into the scratch database (pg_restore)…");
  t0 = Date.now();
  const problems: string[] = [];
  const warnings: string[] = [];
  try {
    await run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", libpqUrl(opts.targetUrl), file], { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // pg_restore exits non-zero for harmless errors too; the table comparison below decides.
    const lines = String((error as { stderr?: string }).stderr || error).split("\n").filter((l) => /error/i.test(l));
    warnings.push(...lines.slice(0, 10).map((l) => l.trim().slice(0, 300)));
  }
  const restoreSeconds = (Date.now() - t0) / 1000;

  log("Comparing tables…");
  const after = await withClient(opts.targetUrl, async (c) => {
    const tables = await userTables(c);
    return { tables, counts: await counts(c, tables), objects: await objectCount(c), migrations: await migrationCount(c) };
  });

  const mismatches: TableCount[] = [];
  let rows = 0;
  for (const t of before.tables) {
    const a = before.counts.get(t) ?? 0;
    const b = after.counts.get(t);
    rows += a;
    if (b === undefined) problems.push(`Table missing after restore: ${t}`);
    else if (a !== b) mismatches.push({ table: t, source: a, restored: b });
  }
  // The source may change between count and dump; only flag mismatches that the restore can't explain.
  if (after.objects < before.objects) problems.push(`Restored ${after.objects} of ${before.objects} tables/indexes/sequences.`);
  if (after.migrations !== before.migrations) problems.push(`Migrations: ${before.migrations} in source, ${after.migrations} restored.`);
  if (mismatches.length) problems.push(`${mismatches.length} table(s) with different row counts (rows written during the dump also show here).`);

  if (!opts.keepDump && !opts.outDir) await rm(dir, { recursive: true, force: true });
  else log(`Dump kept at ${file}`);

  return {
    ok: problems.length === 0,
    tables: before.tables.length,
    rows,
    mismatches: mismatches.slice(0, 20),
    migrations: { source: before.migrations, restored: after.migrations },
    dumpBytes,
    dumpSeconds,
    restoreSeconds,
    sourceHost: src.host,
    targetHost: dst.host,
    pgDumpVersion: ver.trim(),
    problems,
    warnings,
  };
}

/** Saves the result where the Master reads it (JobRun in the source DB). */
export async function recordBackupCheck(sourceUrl: string, result: BackupCheckResult, startedAt: Date): Promise<void> {
  await withClient(sourceUrl, (c) =>
    c.query(
      `INSERT INTO "JobRun" ("id","name","trigger","startedAt","finishedAt","ok","processed","detail","error")
       VALUES (gen_random_uuid(), $1, 'manual', $2, now(), $3, $4, $5::jsonb, $6)`,
      [BACKUP_CHECK_JOB, startedAt, result.ok, result.tables, JSON.stringify(result), result.ok ? null : result.problems.join(" | ").slice(0, 1000)],
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const sourceUrl = process.env.BACKUP_SOURCE_URL || process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const targetUrl = process.env.RESTORE_TARGET_URL;
  if (!sourceUrl || !targetUrl) {
    console.error("Set BACKUP_SOURCE_URL (production, public URL) and RESTORE_TARGET_URL (an empty scratch database).");
    process.exit(2);
  }
  const outIdx = args.indexOf("--out");
  const startedAt = new Date();
  const result = await backupRestoreCheck({
    sourceUrl,
    targetUrl,
    outDir: outIdx >= 0 ? args[outIdx + 1] : undefined,
    keepDump: args.includes("--keep-dump"),
    log: (m) => console.log(m),
  });
  await recordBackupCheck(sourceUrl, result, startedAt);
  console.log("");
  console.log(result.ok ? "RESTORE TEST PASSED" : "RESTORE TEST FAILED");
  console.log(`${result.tables} tables · ${result.rows.toLocaleString("en-US")} rows · migrations ${result.migrations.restored}/${result.migrations.source}`);
  console.log(`dump ${(result.dumpBytes / 1048576).toFixed(1)} MB in ${result.dumpSeconds.toFixed(1)} s · restore ${result.restoreSeconds.toFixed(1)} s`);
  for (const p of result.problems) console.log(`- ${p}`);
  for (const m of result.mismatches) console.log(`  ${m.table}: ${m.source} → ${m.restored}`);
  if (result.warnings.length) console.log(`pg_restore warnings (did not change the result):\n  ${result.warnings.join("\n  ")}`);
  console.log("Result saved; it shows in Master › Equipe e segurança.");
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
