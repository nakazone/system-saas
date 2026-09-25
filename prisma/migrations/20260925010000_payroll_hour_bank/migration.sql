-- Payroll self-service hour bank + link employee → CRM user

ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "userId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollEmployee_userId_key" ON "PayrollEmployee"("userId");

CREATE INDEX IF NOT EXISTS "PayrollEmployee_userId_idx" ON "PayrollEmployee"("userId");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'PayrollEmployee_userId_fkey'
    ) THEN
      ALTER TABLE "PayrollEmployee"
        ADD CONSTRAINT "PayrollEmployee_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PayrollHourBankEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "workDate" DATE NOT NULL,
  "hours" DECIMAL(8,2) NOT NULL,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollHourBankEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PayrollHourBankEntry_organizationId_idx" ON "PayrollHourBankEntry"("organizationId");
CREATE INDEX IF NOT EXISTS "PayrollHourBankEntry_employeeId_idx" ON "PayrollHourBankEntry"("employeeId");
CREATE INDEX IF NOT EXISTS "PayrollHourBankEntry_organizationId_workDate_idx" ON "PayrollHourBankEntry"("organizationId", "workDate");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Organization') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'PayrollHourBankEntry_organizationId_fkey'
    ) THEN
      ALTER TABLE "PayrollHourBankEntry"
        ADD CONSTRAINT "PayrollHourBankEntry_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PayrollEmployee') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'PayrollHourBankEntry_employeeId_fkey'
    ) THEN
      ALTER TABLE "PayrollHourBankEntry"
        ADD CONSTRAINT "PayrollHourBankEntry_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

-- RLS (tenant isolation)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org_id') THEN
    ALTER TABLE "PayrollHourBankEntry" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "PayrollHourBankEntry" FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_payroll_hour_bank ON "PayrollHourBankEntry";
    CREATE POLICY tenant_isolation_payroll_hour_bank ON "PayrollHourBankEntry"
      USING ("organizationId" = current_org_id())
      WITH CHECK ("organizationId" = current_org_id());
  END IF;
END $$;
