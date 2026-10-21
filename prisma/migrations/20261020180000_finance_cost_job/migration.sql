-- Finance costs can belong to a job (material bought for job #1042), for job margin.
ALTER TABLE "FinanceCost" ADD COLUMN IF NOT EXISTS "workOrderId" UUID;
DO $$ BEGIN
  ALTER TABLE "FinanceCost" ADD CONSTRAINT "FinanceCost_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "FinanceCost_workOrderId_idx" ON "FinanceCost"("workOrderId");
