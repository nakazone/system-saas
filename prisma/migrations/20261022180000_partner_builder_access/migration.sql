ALTER TABLE "PartnerUser"
  ADD COLUMN "builderId" UUID,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "PartnerUser"
  ADD CONSTRAINT "PartnerUser_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PartnerUser_organizationId_builderId_idx"
  ON "PartnerUser"("organizationId", "builderId");
