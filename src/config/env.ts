import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load .env in local/dev only — Railway injects vars into process.env directly.
loadDotenv({ path: ".env", quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
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
});

export type Env = z.infer<typeof envSchema>;

const REQUIRED_IN_PRODUCTION = [
  "APP_ROOT_DOMAIN",
  "APP_BASE_URL",
  "SESSION_SECRET",
  "DATABASE_URL",
  "JWT_SECRET",
] as const;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    console.error("Invalid environment variables:", fieldErrors);
    console.error(
      "Set these variables in your host (Railway → Variables):",
      REQUIRED_IN_PRODUCTION.join(", "),
    );
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const env = loadEnv();
