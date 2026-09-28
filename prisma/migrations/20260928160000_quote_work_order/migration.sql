-- Link quotes to work orders (job → proposal)

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "workOrderId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Quote_workOrderId_fkey'
  ) THEN
    ALTER TABLE "Quote"
      ADD CONSTRAINT "Quote_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Quote_workOrderId_idx" ON "Quote"("workOrderId");
