#!/usr/bin/env node
/**
 * Resolve DATABASE_URL the same way as src/config/env.ts, then run
 * `prisma migrate deploy`. Prisma CLI only reads DATABASE_URL — it does not
 * use the app's fallbacks (DATABASE_PRIVATE_URL, POSTGRES_URL, PGHOST, …),
 * which is why Railway can boot the app against an empty database.
 */
import { spawnSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env", quiet: true });

function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveDatabaseUrl() {
  const fromEnv =
    nonEmpty(process.env.DATABASE_URL) ??
    nonEmpty(process.env.DATABASE_PRIVATE_URL) ??
    nonEmpty(process.env.DATABASE_PUBLIC_URL) ??
    nonEmpty(process.env.POSTGRES_URL) ??
    nonEmpty(process.env.POSTGRES_PRIVATE_URL);

  if (fromEnv) return fromEnv;

  const host = nonEmpty(process.env.PGHOST);
  const user = nonEmpty(process.env.PGUSER);
  const password = nonEmpty(process.env.PGPASSWORD);
  const database = nonEmpty(process.env.PGDATABASE) ?? nonEmpty(process.env.POSTGRES_DB);
  const port = nonEmpty(process.env.PGPORT) ?? "5432";

  if (host && user && password && database) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  }

  return undefined;
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error("DATABASE_URL is missing or empty — cannot run migrations.");
  console.error(
    "On Railway: delete any blank DATABASE_URL and add a Variable Reference from Postgres.",
  );
  process.exit(1);
}

process.env.DATABASE_URL = databaseUrl;

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
