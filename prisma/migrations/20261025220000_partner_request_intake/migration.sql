-- Builder portal: AI reading of work orders and "update an existing job" requests.
ALTER TABLE "PartnerJobRequest" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "PartnerJobRequest" ADD COLUMN "targetWorkOrderId" UUID;
ALTER TABLE "PartnerJobRequest" ADD COLUMN "intake" JSONB;

CREATE INDEX "PartnerJobRequest_organizationId_externalRef_idx"
  ON "PartnerJobRequest"("organizationId", "externalRef");
