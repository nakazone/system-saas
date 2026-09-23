-- Phase 2 M8: kanban system milestones, loss reasons, action home support

ALTER TABLE "PipelineStage"
  ADD COLUMN IF NOT EXISTS "isSystemMilestone" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "lossReasonId" UUID,
  ADD COLUMN IF NOT EXISTS "lostAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "LossReason" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LossReason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LossReason_organizationId_slug_key"
  ON "LossReason"("organizationId", "slug");
CREATE INDEX IF NOT EXISTS "LossReason_organizationId_idx" ON "LossReason"("organizationId");
CREATE INDEX IF NOT EXISTS "Lead_lossReasonId_idx" ON "Lead"("lossReasonId");
CREATE INDEX IF NOT EXISTS "Lead_ownerId_idx" ON "Lead"("ownerId");

DO $$ BEGIN
  ALTER TABLE "LossReason" ADD CONSTRAINT "LossReason_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lossReasonId_fkey"
    FOREIGN KEY ("lossReasonId") REFERENCES "LossReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Align legacy SF slugs to Phase 2 system milestone slugs (keep custom stages)
UPDATE "PipelineStage"
SET "slug" = 'new', "name" = CASE WHEN "name" IN ('New Lead', 'New') THEN 'New' ELSE "name" END
WHERE "slug" = 'new_lead';

UPDATE "PipelineStage"
SET "slug" = 'assessment_scheduled',
    "name" = CASE WHEN "name" IN ('Meeting Scheduled', 'Assessment scheduled') THEN 'Assessment scheduled' ELSE "name" END
WHERE "slug" = 'meeting_scheduled';

UPDATE "PipelineStage"
SET "isSystemMilestone" = true
WHERE "slug" IN ('new', 'assessment_scheduled', 'quote_sent', 'won', 'lost');

-- Seed default loss reasons for every org (idempotent)
INSERT INTO "LossReason" ("id", "organizationId", "name", "slug", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", r.name, r.slug, r.sort_order, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('Price', 'price', 1),
  ('Timeline', 'timeline', 2),
  ('Chose competitor', 'chose_competitor', 3),
  ('No response', 'no_response', 4),
  ('Project postponed', 'project_postponed', 5),
  ('Other', 'other', 6)
) AS r(name, slug, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "LossReason" lr
  WHERE lr."organizationId" = o."id" AND lr."slug" = r.slug
);

-- RLS for LossReason
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['LossReason']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid)',
      tbl
    );
  END LOOP;
END $$;
