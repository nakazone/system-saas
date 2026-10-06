-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "deliveryPickupAddress" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "deliveryNotes" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "deliveryAttachmentUrl" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "deliveryAttachmentKey" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "deliveryAttachmentName" TEXT;
