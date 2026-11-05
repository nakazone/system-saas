-- Trade Packs: pieces made again on a job (Countertops remakes), with the reason, who answers for
-- it and the cost. Tenant-scoped with RLS like JobPhase.
CREATE TABLE "JobRework" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "trade" TEXT NOT NULL,
    "phaseKey" TEXT,
    "piece" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "cost" DECIMAL(12,2),
    "notes" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobRework_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobRework_organizationId_workOrderId_idx" ON "JobRework"("organizationId", "workOrderId");
CREATE INDEX "JobRework_organizationId_createdAt_idx" ON "JobRework"("organizationId", "createdAt");

ALTER TABLE "JobRework" ADD CONSTRAINT "JobRework_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRework" ADD CONSTRAINT "JobRework_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobRework" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobRework" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobRework"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "JobRework" TO app_user;
