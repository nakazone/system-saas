-- Phase 2 M4: payment schedules, evolved invoices/payments, document sequences

-- Evolve QuoteInvoice
ALTER TABLE "QuoteInvoice"
  ADD COLUMN IF NOT EXISTS "customerId" UUID,
  ADD COLUMN IF NOT EXISTS "invoiceType" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS "issuedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentInstructions" TEXT,
  ADD COLUMN IF NOT EXISTS "scheduleItemId" UUID,
  ADD COLUMN IF NOT EXISTS "externalPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "processor" TEXT;

-- Evolve InvoiceReceipt (+ org FK for RLS consistency)
ALTER TABLE "InvoiceReceipt"
  ADD COLUMN IF NOT EXISTS "referenceNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "externalPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "processor" TEXT;

DO $$ BEGIN
  ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InvoiceLineItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DocumentSequence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrgPaymentTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "items" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgPaymentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentSchedule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "quoteId" UUID NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "sourceTemplateId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentScheduleItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "percent" DECIMAL(5,2),
  "fixedAmount" DECIMAL(12,2),
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "phaseKey" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentScheduleItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteInvoice_organizationId_invoiceNumber_key"
  ON "QuoteInvoice"("organizationId", "invoiceNumber");
CREATE INDEX IF NOT EXISTS "QuoteInvoice_customerId_idx" ON "QuoteInvoice"("customerId");
CREATE INDEX IF NOT EXISTS "QuoteInvoice_scheduleItemId_idx" ON "QuoteInvoice"("scheduleItemId");

CREATE INDEX IF NOT EXISTS "InvoiceLineItem_organizationId_idx" ON "InvoiceLineItem"("organizationId");
CREATE INDEX IF NOT EXISTS "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentSequence_organizationId_kind_key"
  ON "DocumentSequence"("organizationId", "kind");
CREATE INDEX IF NOT EXISTS "DocumentSequence_organizationId_idx" ON "DocumentSequence"("organizationId");

CREATE INDEX IF NOT EXISTS "OrgPaymentTemplate_organizationId_idx" ON "OrgPaymentTemplate"("organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentSchedule_quoteId_key" ON "PaymentSchedule"("quoteId");
CREATE INDEX IF NOT EXISTS "PaymentSchedule_organizationId_idx" ON "PaymentSchedule"("organizationId");

CREATE INDEX IF NOT EXISTS "PaymentScheduleItem_organizationId_idx" ON "PaymentScheduleItem"("organizationId");
CREATE INDEX IF NOT EXISTS "PaymentScheduleItem_scheduleId_idx" ON "PaymentScheduleItem"("scheduleId");

DO $$ BEGIN
  ALTER TABLE "QuoteInvoice" ADD CONSTRAINT "QuoteInvoice_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "QuoteInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrgPaymentTemplate" ADD CONSTRAINT "OrgPaymentTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentScheduleItem" ADD CONSTRAINT "PaymentScheduleItem_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentScheduleItem" ADD CONSTRAINT "PaymentScheduleItem_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "PaymentSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteInvoice" ADD CONSTRAINT "QuoteInvoice_scheduleItemId_fkey"
    FOREIGN KEY ("scheduleItemId") REFERENCES "PaymentScheduleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'InvoiceLineItem',
    'DocumentSequence',
    'OrgPaymentTemplate',
    'PaymentSchedule',
    'PaymentScheduleItem'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("organizationId"::text = current_setting(''app.current_tenant_id'', true))
         WITH CHECK ("organizationId"::text = current_setting(''app.current_tenant_id'', true))',
      tbl
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
