ALTER TABLE "PartnerUser"
  ADD COLUMN "customerId" UUID;

CREATE INDEX "PartnerUser_organizationId_customerId_idx"
  ON "PartnerUser"("organizationId", "customerId");

ALTER TABLE "PartnerUser"
  ADD CONSTRAINT "PartnerUser_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
