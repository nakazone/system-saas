-- Homeowner contact on builder jobs + extra delivery stops (JSON).
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "homeownerName" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "homeownerPhone" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "deliveries" JSONB;
