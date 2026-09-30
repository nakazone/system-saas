-- Invoice module: view tracking, void date, receipt numbers and receipt delivery.
ALTER TABLE "QuoteInvoice" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);
ALTER TABLE "QuoteInvoice" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "QuoteInvoice" ADD COLUMN IF NOT EXISTS "sentTo" TEXT;
ALTER TABLE "QuoteInvoice" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
ALTER TABLE "QuoteInvoice" ADD COLUMN IF NOT EXISTS "publicTokenExpiresAt" TIMESTAMP(3);

ALTER TABLE "InvoiceReceipt" ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT;
ALTER TABLE "InvoiceReceipt" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "InvoiceReceipt" ADD COLUMN IF NOT EXISTS "sentTo" TEXT;
ALTER TABLE "InvoiceReceipt" ADD COLUMN IF NOT EXISTS "createdById" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceReceipt_organizationId_receiptNumber_key"
  ON "InvoiceReceipt"("organizationId", "receiptNumber");

-- Number receipts recorded before this migration (per organization, oldest first).
WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "paidAt", "createdAt") AS n
  FROM "InvoiceReceipt"
  WHERE "receiptNumber" IS NULL
)
UPDATE "InvoiceReceipt" r
SET "receiptNumber" = 'RCT-' || LPAD(numbered.n::text, 4, '0')
FROM numbered
WHERE r."id" = numbered."id";

INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
SELECT gen_random_uuid(), "organizationId", 'receipt', COUNT(*) + 1
FROM "InvoiceReceipt"
GROUP BY "organizationId"
ON CONFLICT ("organizationId", "kind")
DO UPDATE SET "nextValue" = GREATEST("DocumentSequence"."nextValue", EXCLUDED."nextValue");

-- Invoices that already had a public link opened are unknown; leave viewedAt empty.
UPDATE "QuoteInvoice" SET "voidedAt" = "updatedAt" WHERE "status" = 'void' AND "voidedAt" IS NULL;
