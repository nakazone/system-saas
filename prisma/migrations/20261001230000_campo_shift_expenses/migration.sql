-- Reembolsos / descontos por dia de trabalho (recibos do funcionário + lançamento do escritório).
CREATE TABLE IF NOT EXISTS "CampoShiftExpense" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "description" TEXT,
  "receiptUrl" TEXT,
  "receiptKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "source" TEXT NOT NULL DEFAULT 'employee',
  "appliedAt" TIMESTAMP(3),
  "createdById" UUID,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CampoShiftExpense_organizationId_idx" ON "CampoShiftExpense"("organizationId");
CREATE INDEX IF NOT EXISTS "CampoShiftExpense_shiftId_idx" ON "CampoShiftExpense"("shiftId");
CREATE INDEX IF NOT EXISTS "CampoShiftExpense_employeeId_status_idx" ON "CampoShiftExpense"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "CampoShiftExpense_organizationId_status_idx" ON "CampoShiftExpense"("organizationId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShiftExpense_organizationId_fkey') THEN
    ALTER TABLE "CampoShiftExpense" ADD CONSTRAINT "CampoShiftExpense_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShiftExpense_shiftId_fkey') THEN
    ALTER TABLE "CampoShiftExpense" ADD CONSTRAINT "CampoShiftExpense_shiftId_fkey"
      FOREIGN KEY ("shiftId") REFERENCES "CampoShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShiftExpense_employeeId_fkey') THEN
    ALTER TABLE "CampoShiftExpense" ADD CONSTRAINT "CampoShiftExpense_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE "CampoShiftExpense" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "CampoShiftExpense" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "CampoShiftExpense";
  CREATE POLICY tenant_isolation ON "CampoShiftExpense"
    USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
    WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));
END $$;
