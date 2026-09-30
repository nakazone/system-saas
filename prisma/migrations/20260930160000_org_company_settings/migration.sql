-- Configurações › Dados da empresa: company identity, address, license/insurance,
-- business hours and regional defaults.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'US';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "addressPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "licenseNumber" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "licenseState" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "licenseExpiresOn" DATE;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "showLicenseOnDocuments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "insuranceCarrier" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "insurancePolicy" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "insuranceExpiresOn" DATE;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "insuranceCertificateUrl" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "businessHours" JSONB;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "defaultLocale" TEXT NOT NULL DEFAULT 'pt-BR';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "areaUnit" TEXT NOT NULL DEFAULT 'sq_ft';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "weekStart" TEXT NOT NULL DEFAULT 'monday';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "googleReviewUrl" TEXT;

-- The review link used to live only in featureFlags JSON (no UI). Promote it.
UPDATE "Organization"
SET "googleReviewUrl" = NULLIF(TRIM(COALESCE("featureFlags"->>'google_review_url', "featureFlags"->>'googleReviewUrl')), '')
WHERE "googleReviewUrl" IS NULL
  AND "featureFlags" IS NOT NULL
  AND COALESCE("featureFlags"->>'google_review_url', "featureFlags"->>'googleReviewUrl') IS NOT NULL;
