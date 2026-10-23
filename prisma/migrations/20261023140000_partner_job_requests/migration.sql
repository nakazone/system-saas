CREATE TABLE "PartnerJobRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "partnerUserId" UUID NOT NULL,
    "workOrderId" UUID,
    "customerId" UUID,
    "builderId" UUID,
    "title" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "serviceType" TEXT,
    "preferredDate" TIMESTAMP(3),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "files" JSONB NOT NULL DEFAULT '[]',
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerJobRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerJobRequest_organizationId_status_createdAt_idx"
  ON "PartnerJobRequest"("organizationId", "status", "createdAt");
CREATE INDEX "PartnerJobRequest_partnerUserId_createdAt_idx"
  ON "PartnerJobRequest"("partnerUserId", "createdAt");
CREATE INDEX "PartnerJobRequest_workOrderId_idx"
  ON "PartnerJobRequest"("workOrderId");

ALTER TABLE "PartnerJobRequest"
  ADD CONSTRAINT "PartnerJobRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerJobRequest"
  ADD CONSTRAINT "PartnerJobRequest_partnerUserId_fkey"
  FOREIGN KEY ("partnerUserId") REFERENCES "PartnerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerJobRequest"
  ADD CONSTRAINT "PartnerJobRequest_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartnerJobRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartnerJobRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PartnerJobRequest"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "PartnerJobRequest" TO app_user;
