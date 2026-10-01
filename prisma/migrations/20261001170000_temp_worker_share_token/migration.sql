-- Keep the current ticket link per temporary worker so re-sharing does not revoke it.
ALTER TABLE "WorkOrderTempWorker" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
ALTER TABLE "WorkOrderTempWorker" ADD COLUMN IF NOT EXISTS "shareTokenExpiresAt" TIMESTAMP(3);
