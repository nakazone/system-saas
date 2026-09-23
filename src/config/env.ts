import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load .env in local/dev only — Railway injects vars into process.env directly.
loadDotenv({ path: ".env", quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  PRODUCT_NAME: z.string().min(1).default("ObraMate"),
  APP_ROOT_DOMAIN: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("flooring-saas"),
  S3_PUBLIC_URL: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("noreply@localhost"),
  /** Inbox for tenant support tickets (falls back to first platform admin email). */
  SUPPORT_INBOX_EMAIL: z.string().email().optional(),
  /** Web Push VAPID (optional — generated & stored in DB if missing). */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@obramate.app"),
});

export type Env = z.infer<typeof envSchema>;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Railway Postgres may expose DATABASE_URL, DATABASE_PRIVATE_URL, or DATABASE_PUBLIC_URL.
 * An empty DATABASE_URL (common when a blank variable overrides the plugin) must be ignored.
 */
function resolveDatabaseUrl(): string | undefined {
  const fromEnv = nonEmpty(process.env.DATABASE_URL)
    ?? nonEmpty(process.env.DATABASE_PRIVATE_URL)
    ?? nonEmpty(process.env.DATABASE_PUBLIC_URL)
    ?? nonEmpty(process.env.POSTGRES_URL)
    ?? nonEmpty(process.env.POSTGRES_PRIVATE_URL);

  if (fromEnv) {
    return fromEnv;
  }

  const host = nonEmpty(process.env.PGHOST);
  const user = nonEmpty(process.env.PGUSER);
  const password = nonEmpty(process.env.PGPASSWORD);
  const database = nonEmpty(process.env.PGDATABASE) ?? nonEmpty(process.env.POSTGRES_DB);
  const port = nonEmpty(process.env.PGPORT) ?? "5432";

  if (host && user && password && database) {
    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}`;
  }

  return undefined;
}

function loadEnv(): Env {
  const databaseUrl = resolveDatabaseUrl();
  const parsed = envSchema.safeParse({
    ...process.env,
    DATABASE_URL: databaseUrl,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    console.error("Invalid environment variables:", fieldErrors);

    if (fieldErrors.DATABASE_URL) {
      console.error(`
DATABASE_URL is missing or empty.

On Railway:
1. Add a PostgreSQL service to the same project.
2. Open your web service → Variables.
3. Delete any blank DATABASE_URL variable.
4. Add a Variable Reference from Postgres → DATABASE_URL
   (or DATABASE_PRIVATE_URL for private networking).
`);
    } else {
      console.error(
        "Required variables: APP_ROOT_DOMAIN, APP_BASE_URL, SESSION_SECRET, DATABASE_URL, JWT_SECRET",
      );
    }

    throw new Error("Invalid environment configuration");
  }

  return parsed.data;
}

export const env = loadEnv();
