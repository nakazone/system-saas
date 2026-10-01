-- Folha: "Dia de trabalho" (CampoShift) with GPS, jobs, note and review status;
-- employee default schedule; per-employee payments that post to Finance.

-- Employee default schedule / day rules
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "scheduleStartMode" TEXT NOT NULL DEFAULT 'job';
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "scheduleStartTime" TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "scheduleEndTime" TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "lunchMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "countEarlyStart" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "requirePhotos" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "requireGps" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;

-- Dia de trabalho
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "employeeId" UUID;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'clock';
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'in_progress';
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "flags" JSONB;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "reviewedById" UUID;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockInLat" DECIMAL(10,7);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockInLng" DECIMAL(10,7);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockInAccuracyM" DECIMAL(10,2);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockInDistanceM" INTEGER;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockInDeviceAt" TIMESTAMP(3);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockOutLat" DECIMAL(10,7);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockOutLng" DECIMAL(10,7);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockOutAccuracyM" DECIMAL(10,2);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockOutDistanceM" INTEGER;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "clockOutDeviceAt" TIMESTAMP(3);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "expectedStartAt" TIMESTAMP(3);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "expectedEndAt" TIMESTAMP(3);
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "workedMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "lunchMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "overtimeMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "daysWorked" DECIMAL(4,2) NOT NULL DEFAULT 1;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "sqft" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "sector" TEXT;
ALTER TABLE "CampoShift" ADD COLUMN IF NOT EXISTS "timesheetId" UUID;
CREATE INDEX IF NOT EXISTS "CampoShift_organizationId_reviewStatus_idx" ON "CampoShift"("organizationId", "reviewStatus");
CREATE INDEX IF NOT EXISTS "CampoShift_employeeId_workDate_idx" ON "CampoShift"("employeeId", "workDate");

-- Jobs of the day
CREATE TABLE IF NOT EXISTS "CampoShiftJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "arrivedAt" TIMESTAMP(3),
  "sqft" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "photoCount" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampoShiftJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CampoShiftJob_shiftId_workOrderId_key" ON "CampoShiftJob"("shiftId", "workOrderId");
CREATE INDEX IF NOT EXISTS "CampoShiftJob_organizationId_idx" ON "CampoShiftJob"("organizationId");
CREATE INDEX IF NOT EXISTS "CampoShiftJob_workOrderId_idx" ON "CampoShiftJob"("workOrderId");

-- Timesheet line knows the day it came from, the sqft and the sector
ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "shiftId" UUID;
ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "sqft" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollTimesheet" ADD COLUMN IF NOT EXISTS "sector" TEXT;
CREATE INDEX IF NOT EXISTS "PayrollTimesheet_shiftId_idx" ON "PayrollTimesheet"("shiftId");

-- Job location cache (distance check for the day's GPS)
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "geoLat" DECIMAL(10,7);
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "geoLng" DECIMAL(10,7);
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "geoCheckedAt" TIMESTAMP(3);

-- Per-employee payment
CREATE TABLE IF NOT EXISTS "PayrollPayment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "periodId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paidOn" DATE NOT NULL,
  "method" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "sector" TEXT,
  "status" TEXT NOT NULL DEFAULT 'paid',
  "financeAbatementId" UUID,
  "createdById" UUID,
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PayrollPayment_organizationId_idx" ON "PayrollPayment"("organizationId");
CREATE INDEX IF NOT EXISTS "PayrollPayment_periodId_idx" ON "PayrollPayment"("periodId");
CREATE INDEX IF NOT EXISTS "PayrollPayment_employeeId_paidOn_idx" ON "PayrollPayment"("employeeId", "paidOn");

ALTER TABLE "FinancePayrollAbatement" ADD COLUMN IF NOT EXISTS "employeeId" UUID;
ALTER TABLE "FinancePayrollAbatement" ADD COLUMN IF NOT EXISTS "sector" TEXT;
CREATE INDEX IF NOT EXISTS "FinancePayrollAbatement_employeeId_idx" ON "FinancePayrollAbatement"("employeeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShift_employeeId_fkey') THEN
    ALTER TABLE "CampoShift" ADD CONSTRAINT "CampoShift_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShiftJob_organizationId_fkey') THEN
    ALTER TABLE "CampoShiftJob" ADD CONSTRAINT "CampoShiftJob_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShiftJob_shiftId_fkey') THEN
    ALTER TABLE "CampoShiftJob" ADD CONSTRAINT "CampoShiftJob_shiftId_fkey"
      FOREIGN KEY ("shiftId") REFERENCES "CampoShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShiftJob_workOrderId_fkey') THEN
    ALTER TABLE "CampoShiftJob" ADD CONSTRAINT "CampoShiftJob_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPayment_organizationId_fkey') THEN
    ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPayment_periodId_fkey') THEN
    ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_periodId_fkey"
      FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPayment_employeeId_fkey') THEN
    ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Tenant isolation for the new tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['CampoShiftJob', 'PayrollPayment']
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
