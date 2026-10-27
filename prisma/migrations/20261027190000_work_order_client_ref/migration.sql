-- Client ID that belongs to this job (and its quote), not to the customer record.
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "clientRef" TEXT;
