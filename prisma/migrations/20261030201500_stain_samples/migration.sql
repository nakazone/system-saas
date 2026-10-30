-- Samples de stain: rounds of samples on the floor, the photos, and the client's signed approval
ALTER TABLE "WorkOrder" ADD COLUMN "approvedStainSampleId" UUID;

CREATE TABLE "StainSampleRound" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 1,
    "woodSpecies" TEXT,
    "room" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "boardMediaId" UUID,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "sendToBuilder" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdByName" TEXT,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "builderNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StainSampleRound_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StainSampleRound_organizationId_workOrderId_idx" ON "StainSampleRound"("organizationId", "workOrderId");
CREATE UNIQUE INDEX "StainSampleRound_organizationId_workOrderId_number_key" ON "StainSampleRound"("organizationId", "workOrderId", "number");
ALTER TABLE "StainSampleRound" ADD CONSTRAINT "StainSampleRound_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StainSampleRound" ADD CONSTRAINT "StainSampleRound_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StainSample" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'duraseal',
    "brand" TEXT,
    "colorName" TEXT NOT NULL,
    "blend" JSONB,
    "mediaIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StainSample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StainSample_organizationId_roundId_idx" ON "StainSample"("organizationId", "roundId");
ALTER TABLE "StainSample" ADD CONSTRAINT "StainSample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StainSample" ADD CONSTRAINT "StainSample_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "StainSampleRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StainApproval" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "sampleId" UUID,
    "decision" TEXT NOT NULL,
    "signerName" TEXT,
    "signatureKey" TEXT,
    "termsText" TEXT,
    "comment" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "pdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StainApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StainApproval_organizationId_workOrderId_idx" ON "StainApproval"("organizationId", "workOrderId");
CREATE INDEX "StainApproval_roundId_idx" ON "StainApproval"("roundId");
ALTER TABLE "StainApproval" ADD CONSTRAINT "StainApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StainApproval" ADD CONSTRAINT "StainApproval_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "StainSampleRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StainApproval" ADD CONSTRAINT "StainApproval_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An approval is a signed record: no edits, no deletes (job deletion still cascades).
CREATE OR REPLACE FUNCTION stain_approval_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'StainApproval rows are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stain_approval_no_update BEFORE UPDATE ON "StainApproval"
  FOR EACH ROW WHEN (OLD."pdfKey" IS NOT NULL OR NEW."pdfKey" IS NULL) EXECUTE FUNCTION stain_approval_immutable();

ALTER TABLE "StainSampleRound" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StainSampleRound" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StainSampleRound"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE "StainSample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StainSample" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StainSample"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE "StainApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StainApproval" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StainApproval"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "StainSampleRound" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "StainSample" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "StainApproval" TO app_user;
