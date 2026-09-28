-- Job field reports (photo-based AI / manual reports)

CREATE TABLE IF NOT EXISTS "JobReport" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "authorId" UUID,
  "templateKey" TEXT NOT NULL DEFAULT 'site_visit',
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "summary" TEXT,
  "observationsJson" JSONB,
  "issuesJson" JSONB,
  "recommendationsJson" JSONB,
  "nextStepsJson" JSONB,
  "photoIds" JSONB NOT NULL,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'ai',
  "modelUsed" TEXT,
  "tokensIn" INTEGER,
  "tokensOut" INTEGER,
  "costUsd" DECIMAL(10, 6),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobReport_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobReport_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobReport_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "JobReport_organizationId_idx" ON "JobReport"("organizationId");
CREATE INDEX IF NOT EXISTS "JobReport_workOrderId_idx" ON "JobReport"("workOrderId");
CREATE INDEX IF NOT EXISTS "JobReport_organizationId_workOrderId_status_idx"
  ON "JobReport"("organizationId", "workOrderId", "status");
CREATE INDEX IF NOT EXISTS "JobReport_authorId_idx" ON "JobReport"("authorId");

DO $$
DECLARE
  tbl text := 'JobReport';
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
