-- Construction-style payroll fields + period adjustments + hour-bank review

ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "sector" TEXT;
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "dailyRate" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "overtimeRate" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "allowWorkDateOutsidePeriod" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "daysWorked" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "regularHours" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "dailyRateOverride" DECIMAL(12,2);
ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "calculatedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "PayrollHourBankEntry" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "PayrollHourBankEntry" ADD COLUMN IF NOT EXISTS "reviewedById" UUID;
ALTER TABLE "PayrollHourBankEntry" ADD COLUMN IF NOT EXISTS "timesheetId" UUID;

CREATE INDEX IF NOT EXISTS "PayrollHourBankEntry_organizationId_status_idx"
  ON "PayrollHourBankEntry"("organizationId", "status");

CREATE TABLE IF NOT EXISTS "PayrollPeriodAdjustment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "periodId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "reimbursement" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollPeriodAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPeriodAdjustment_periodId_employeeId_key"
  ON "PayrollPeriodAdjustment"("periodId", "employeeId");
CREATE INDEX IF NOT EXISTS "PayrollPeriodAdjustment_organizationId_idx"
  ON "PayrollPeriodAdjustment"("organizationId");
CREATE INDEX IF NOT EXISTS "PayrollPeriodAdjustment_periodId_idx"
  ON "PayrollPeriodAdjustment"("periodId");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PayrollPeriod') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPeriodAdjustment_periodId_fkey') THEN
      ALTER TABLE "PayrollPeriodAdjustment"
        ADD CONSTRAINT "PayrollPeriodAdjustment_periodId_fkey"
        FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PayrollEmployee') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPeriodAdjustment_employeeId_fkey') THEN
      ALTER TABLE "PayrollPeriodAdjustment"
        ADD CONSTRAINT "PayrollPeriodAdjustment_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org_id') THEN
    ALTER TABLE "PayrollPeriodAdjustment" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "PayrollPeriodAdjustment" FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_payroll_period_adj ON "PayrollPeriodAdjustment";
    CREATE POLICY tenant_isolation_payroll_period_adj ON "PayrollPeriodAdjustment"
      USING ("organizationId" = current_org_id())
      WITH CHECK ("organizationId" = current_org_id());
  END IF;
END $$;
