-- Finance module: company costs/receipts + payroll abatements

CREATE TABLE IF NOT EXISTS "FinanceCost" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "amount" DECIMAL(12,2) NOT NULL,
  "incurredOn" DATE NOT NULL,
  "vendorName" TEXT,
  "projectId" UUID,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "receiptUrl" TEXT,
  "receiptKey" TEXT,
  "ocrStatus" TEXT NOT NULL DEFAULT 'none',
  "ocrVendor" TEXT,
  "ocrAmount" DECIMAL(12,2),
  "ocrDate" DATE,
  "ocrRaw" JSONB,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinanceCost_organizationId_idx" ON "FinanceCost"("organizationId");
CREATE INDEX IF NOT EXISTS "FinanceCost_organizationId_incurredOn_idx" ON "FinanceCost"("organizationId", "incurredOn");
CREATE INDEX IF NOT EXISTS "FinanceCost_organizationId_status_idx" ON "FinanceCost"("organizationId", "status");

CREATE TABLE IF NOT EXISTS "FinancePayrollAbatement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "periodId" UUID,
  "label" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paidOn" DATE NOT NULL,
  "method" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'paid',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePayrollAbatement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinancePayrollAbatement_organizationId_idx" ON "FinancePayrollAbatement"("organizationId");
CREATE INDEX IF NOT EXISTS "FinancePayrollAbatement_periodId_idx" ON "FinancePayrollAbatement"("periodId");
CREATE INDEX IF NOT EXISTS "FinancePayrollAbatement_organizationId_paidOn_idx" ON "FinancePayrollAbatement"("organizationId", "paidOn");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Organization') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'FinanceCost_organizationId_fkey'
    ) THEN
      ALTER TABLE "FinanceCost"
        ADD CONSTRAINT "FinanceCost_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PayrollPeriod') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'FinancePayrollAbatement_periodId_fkey'
    ) THEN
      ALTER TABLE "FinancePayrollAbatement"
        ADD CONSTRAINT "FinancePayrollAbatement_periodId_fkey"
        FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Organization') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'FinancePayrollAbatement_organizationId_fkey'
    ) THEN
      ALTER TABLE "FinancePayrollAbatement"
        ADD CONSTRAINT "FinancePayrollAbatement_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

ALTER TABLE "FinanceCost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCost" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinancePayrollAbatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancePayrollAbatement" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['FinanceCost', 'FinancePayrollAbatement']
  LOOP
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
