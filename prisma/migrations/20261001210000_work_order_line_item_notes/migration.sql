-- Optional per-line note on job services
ALTER TABLE "WorkOrderLineItem" ADD COLUMN IF NOT EXISTS "notes" TEXT;
