-- Phase 5: inspections, measurements, portfolio, quote sign integrity

ALTER TABLE "JobMedia" ADD COLUMN IF NOT EXISTS "inPortfolio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobMedia" ADD COLUMN IF NOT EXISTS "ocrJson" JSONB;

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "signedDocumentSha256" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "approvedLat" DECIMAL(10, 7);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "approvedLng" DECIMAL(10, 7);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "approvedGpsAccuracyM" DECIMAL(10, 2);

CREATE TABLE IF NOT EXISTS "JobInspection" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "authorId" UUID,
  "status" TEXT NOT NULL DEFAULT 'open',
  "audioStorageKey" TEXT,
  "audioUrl" TEXT,
  "audioSha256" TEXT,
  "durationMs" INTEGER,
  "startedAtDevice" TIMESTAMP(3),
  "endedAtDevice" TIMESTAMP(3),
  "transcript" TEXT,
  "summary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobInspection_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobInspection_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobInspection_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "JobInspection_organizationId_idx" ON "JobInspection"("organizationId");
CREATE INDEX IF NOT EXISTS "JobInspection_workOrderId_idx" ON "JobInspection"("workOrderId");
CREATE INDEX IF NOT EXISTS "JobInspection_organizationId_workOrderId_status_idx"
  ON "JobInspection"("organizationId", "workOrderId", "status");
CREATE INDEX IF NOT EXISTS "JobInspection_authorId_idx" ON "JobInspection"("authorId");

CREATE TABLE IF NOT EXISTS "JobInspectionMark" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "inspectionId" UUID NOT NULL,
  "mediaId" UUID,
  "offsetMs" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobInspectionMark_inspectionId_fkey"
    FOREIGN KEY ("inspectionId") REFERENCES "JobInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "JobInspectionMark_organizationId_idx" ON "JobInspectionMark"("organizationId");
CREATE INDEX IF NOT EXISTS "JobInspectionMark_inspectionId_idx" ON "JobInspectionMark"("inspectionId");
CREATE INDEX IF NOT EXISTS "JobInspectionMark_mediaId_idx" ON "JobInspectionMark"("mediaId");

CREATE TABLE IF NOT EXISTS "JobMeasurement" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "authorId" UUID,
  "label" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'area_sqft',
  "value" DECIMAL(12, 3) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'sqft',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobMeasurement_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobMeasurement_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobMeasurement_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "JobMeasurement_organizationId_idx" ON "JobMeasurement"("organizationId");
CREATE INDEX IF NOT EXISTS "JobMeasurement_workOrderId_idx" ON "JobMeasurement"("workOrderId");
CREATE INDEX IF NOT EXISTS "JobMeasurement_authorId_idx" ON "JobMeasurement"("authorId");

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['JobInspection', 'JobInspectionMark', 'JobMeasurement']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid)',
        t
      );
    END IF;
  END LOOP;
END $$;
