-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "deliveryScheduledStart" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkOrder_organizationId_deliveryScheduledStart_idx" ON "WorkOrder"("organizationId", "deliveryScheduledStart");
