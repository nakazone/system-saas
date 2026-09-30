-- Jobs (ordens de serviço) can be invoiced directly at table prices, without a quote.
ALTER TABLE "QuoteInvoice" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "QuoteInvoice" ADD COLUMN IF NOT EXISTS "workOrderId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteInvoice_workOrderId_fkey') THEN
    ALTER TABLE "QuoteInvoice"
      ADD CONSTRAINT "QuoteInvoice_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "QuoteInvoice_workOrderId_idx" ON "QuoteInvoice"("workOrderId");
