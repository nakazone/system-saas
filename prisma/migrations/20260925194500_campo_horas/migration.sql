-- Campo Minhas horas: week submission + manual entries

CREATE TABLE IF NOT EXISTS "CampoWeekSubmission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "weekStart" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "submittedAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampoWeekSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CampoWeekSubmission_organizationId_userId_weekStart_key"
  ON "CampoWeekSubmission"("organizationId", "userId", "weekStart");
CREATE INDEX IF NOT EXISTS "CampoWeekSubmission_organizationId_idx" ON "CampoWeekSubmission"("organizationId");
CREATE INDEX IF NOT EXISTS "CampoWeekSubmission_userId_status_idx" ON "CampoWeekSubmission"("userId", "status");

CREATE TABLE IF NOT EXISTS "CampoManualEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "workDate" DATE NOT NULL,
  "entryType" TEXT NOT NULL,
  "activityKind" TEXT,
  "workOrderId" UUID,
  "hours" DECIMAL(8,2),
  "sqft" DECIMAL(12,2),
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "hourBankEntryId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampoManualEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CampoManualEntry_organizationId_idx" ON "CampoManualEntry"("organizationId");
CREATE INDEX IF NOT EXISTS "CampoManualEntry_userId_workDate_idx" ON "CampoManualEntry"("userId", "workDate");
CREATE INDEX IF NOT EXISTS "CampoManualEntry_workOrderId_idx" ON "CampoManualEntry"("workOrderId");
CREATE INDEX IF NOT EXISTS "CampoManualEntry_organizationId_status_idx" ON "CampoManualEntry"("organizationId", "status");
