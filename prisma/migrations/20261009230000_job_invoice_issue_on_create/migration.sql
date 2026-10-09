-- Job invoices created before "Faturar" issued them as sent were stuck in draft
-- while Jobs already counted them as faturado. Promote those drafts so Invoices matches.
UPDATE "QuoteInvoice"
SET
  "status" = 'sent',
  "issuedAt" = COALESCE("issuedAt", "createdAt")
WHERE "workOrderId" IS NOT NULL
  AND "quoteId" IS NULL
  AND "status" = 'draft';
