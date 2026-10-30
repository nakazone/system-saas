-- Builder ↔ company messages inside a job, and ObraCam photos shared with the builder per job
ALTER TABLE "WorkOrder" ADD COLUMN "sharePhotosWithPartners" BOOLEAN NOT NULL DEFAULT false;

-- jobs that came from a builder's request already share their photos
UPDATE "WorkOrder" w SET "sharePhotosWithPartners" = true
WHERE EXISTS (SELECT 1 FROM "PartnerJobRequest" r WHERE r."workOrderId" = w."id" AND r."status" = 'accepted');

CREATE TABLE "JobPartnerMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "authorUserId" UUID,
    "partnerUserId" UUID,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "files" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobPartnerMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobPartnerMessage_organizationId_workOrderId_createdAt_idx"
  ON "JobPartnerMessage"("organizationId", "workOrderId", "createdAt");
ALTER TABLE "JobPartnerMessage"
  ADD CONSTRAINT "JobPartnerMessage_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPartnerMessage"
  ADD CONSTRAINT "JobPartnerMessage_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPartnerMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobPartnerMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobPartnerMessage"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "JobPartnerMessage" TO app_user;
