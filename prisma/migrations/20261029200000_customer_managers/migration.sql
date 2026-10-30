-- Builder companies can list several managers. A job stores which one it belongs to.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "managers" JSONB;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "managerId" UUID;
