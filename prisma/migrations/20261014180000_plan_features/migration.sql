-- Fase 2 · Recursos e limites por plano (platform tables, outside tenant RLS).
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "features" JSONB;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "limits" JSONB;

CREATE TABLE IF NOT EXISTS "PlatformFeature" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "state" TEXT NOT NULL DEFAULT 'on',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByName" TEXT
);

CREATE TABLE IF NOT EXISTS "OrgFeatureOverride" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "endsAt" TIMESTAMP(3),
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgFeatureOverride_organizationId_featureKey_key" ON "OrgFeatureOverride"("organizationId", "featureKey");

CREATE TABLE IF NOT EXISTS "UsageCounter" (
  "organizationId" UUID NOT NULL,
  "metric" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("organizationId", "metric", "period")
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformFeature", "OrgFeatureOverride", "UsageCounter" TO app_user;
  END IF;
END $$;
