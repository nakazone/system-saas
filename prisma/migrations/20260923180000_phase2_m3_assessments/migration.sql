-- Phase 2 M3: checklist engine + site assessments

CREATE TABLE IF NOT EXISTS "ChecklistTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "appliesTo" TEXT NOT NULL,
  "visitPhase" TEXT,
  "fields" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChecklistResponse" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "templateId" UUID,
  "templateSnapshot" JSONB NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "answers" JSONB NOT NULL DEFAULT '{}',
  "completedAt" TIMESTAMP(3),
  "completedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SiteAssessment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "leadId" UUID,
  "customerId" UUID,
  "propertyId" UUID,
  "scheduledStart" TIMESTAMP(3),
  "scheduledEnd" TIMESTAMP(3),
  "assignedUserId" UUID,
  "status" TEXT NOT NULL DEFAULT 'unscheduled',
  "instructions" TEXT,
  "checklistResponseId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteAssessment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChecklistTemplate_organizationId_idx" ON "ChecklistTemplate"("organizationId");
CREATE INDEX IF NOT EXISTS "ChecklistTemplate_organizationId_appliesTo_idx" ON "ChecklistTemplate"("organizationId", "appliesTo");
CREATE INDEX IF NOT EXISTS "ChecklistResponse_organizationId_idx" ON "ChecklistResponse"("organizationId");
CREATE INDEX IF NOT EXISTS "ChecklistResponse_organizationId_entityType_entityId_idx"
  ON "ChecklistResponse"("organizationId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "ChecklistResponse_templateId_idx" ON "ChecklistResponse"("templateId");
CREATE INDEX IF NOT EXISTS "SiteAssessment_organizationId_idx" ON "SiteAssessment"("organizationId");
CREATE INDEX IF NOT EXISTS "SiteAssessment_organizationId_status_idx" ON "SiteAssessment"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "SiteAssessment_organizationId_assignedUserId_idx" ON "SiteAssessment"("organizationId", "assignedUserId");
CREATE INDEX IF NOT EXISTS "SiteAssessment_leadId_idx" ON "SiteAssessment"("leadId");
CREATE INDEX IF NOT EXISTS "SiteAssessment_customerId_idx" ON "SiteAssessment"("customerId");

DO $$ BEGIN
  ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistResponse" ADD CONSTRAINT "ChecklistResponse_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistResponse" ADD CONSTRAINT "ChecklistResponse_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ChecklistResponse" ADD CONSTRAINT "ChecklistResponse_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SiteAssessment" ADD CONSTRAINT "SiteAssessment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SiteAssessment" ADD CONSTRAINT "SiteAssessment_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SiteAssessment" ADD CONSTRAINT "SiteAssessment_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SiteAssessment" ADD CONSTRAINT "SiteAssessment_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SiteAssessment" ADD CONSTRAINT "SiteAssessment_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SiteAssessment" ADD CONSTRAINT "SiteAssessment_checklistResponseId_fkey"
    FOREIGN KEY ("checklistResponseId") REFERENCES "ChecklistResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ChecklistTemplate', 'ChecklistResponse', 'SiteAssessment']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("organizationId"::text = current_setting(''app.current_tenant_id'', true))
         WITH CHECK ("organizationId"::text = current_setting(''app.current_tenant_id'', true))',
      tbl
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
