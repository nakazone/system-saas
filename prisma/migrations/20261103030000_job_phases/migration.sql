-- Trade Packs: one row per phase of a job, for trades whose jobs have more phases than the
-- Hardwood columns (installationDoneAt / sandDoneAt). Nothing writes here yet for Hardwood.
CREATE TABLE "JobPhase" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "trade" TEXT NOT NULL,
    "phaseKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneById" UUID,
    "doneByName" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobPhase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobPhase_workOrderId_phaseKey_key" ON "JobPhase"("workOrderId", "phaseKey");
CREATE INDEX "JobPhase_organizationId_workOrderId_idx" ON "JobPhase"("organizationId", "workOrderId");
CREATE INDEX "JobPhase_organizationId_scheduledStart_idx" ON "JobPhase"("organizationId", "scheduledStart");

ALTER TABLE "JobPhase" ADD CONSTRAINT "JobPhase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPhase" ADD CONSTRAINT "JobPhase_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPhase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobPhase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobPhase"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "JobPhase" TO app_user;
