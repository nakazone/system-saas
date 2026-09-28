-- Job media (field photo proof) + org feature flags

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "featureFlags" JSONB;

CREATE TABLE IF NOT EXISTS "JobMedia" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "authorId" UUID,
  "type" TEXT NOT NULL DEFAULT 'photo',
  "storageKey" TEXT NOT NULL,
  "thumbKey" TEXT,
  "url" TEXT NOT NULL,
  "thumbUrl" TEXT,
  "sha256" TEXT NOT NULL,
  "takenAtDevice" TIMESTAMP(3),
  "receivedAtServer" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lat" DECIMAL(10, 7),
  "lng" DECIMAL(10, 7),
  "gpsAccuracyM" DECIMAL(10, 2),
  "address" TEXT,
  "caption" TEXT,
  "stage" TEXT,
  "annotationsJson" JSONB,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "clientUploadId" TEXT,
  "deviceLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "JobMedia_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobMedia_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobMedia_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "JobMedia_organizationId_idx" ON "JobMedia"("organizationId");
CREATE INDEX IF NOT EXISTS "JobMedia_workOrderId_idx" ON "JobMedia"("workOrderId");
CREATE INDEX IF NOT EXISTS "JobMedia_organizationId_workOrderId_deletedAt_idx"
  ON "JobMedia"("organizationId", "workOrderId", "deletedAt");
CREATE INDEX IF NOT EXISTS "JobMedia_organizationId_clientUploadId_idx"
  ON "JobMedia"("organizationId", "clientUploadId");
CREATE INDEX IF NOT EXISTS "JobMedia_sha256_idx" ON "JobMedia"("sha256");
CREATE INDEX IF NOT EXISTS "JobMedia_authorId_idx" ON "JobMedia"("authorId");

DO $$
DECLARE
  tbl text := 'JobMedia';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid)',
      tbl
    );
  END IF;
END $$;
