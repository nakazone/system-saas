-- Job team members + temporary workers (shareable job-info link)

CREATE TABLE IF NOT EXISTS "WorkOrderMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderMember_workOrderId_userId_key"
  ON "WorkOrderMember"("workOrderId", "userId");
CREATE INDEX IF NOT EXISTS "WorkOrderMember_organizationId_idx" ON "WorkOrderMember"("organizationId");
CREATE INDEX IF NOT EXISTS "WorkOrderMember_userId_idx" ON "WorkOrderMember"("userId");

CREATE TABLE IF NOT EXISTS "WorkOrderTempWorker" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderTempWorker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkOrderTempWorker_organizationId_idx" ON "WorkOrderTempWorker"("organizationId");
CREATE INDEX IF NOT EXISTS "WorkOrderTempWorker_workOrderId_idx" ON "WorkOrderTempWorker"("workOrderId");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Organization') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderMember_organizationId_fkey') THEN
      ALTER TABLE "WorkOrderMember"
        ADD CONSTRAINT "WorkOrderMember_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderTempWorker_organizationId_fkey') THEN
      ALTER TABLE "WorkOrderTempWorker"
        ADD CONSTRAINT "WorkOrderTempWorker_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'WorkOrder') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderMember_workOrderId_fkey') THEN
      ALTER TABLE "WorkOrderMember"
        ADD CONSTRAINT "WorkOrderMember_workOrderId_fkey"
        FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderTempWorker_workOrderId_fkey') THEN
      ALTER TABLE "WorkOrderTempWorker"
        ADD CONSTRAINT "WorkOrderTempWorker_workOrderId_fkey"
        FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderMember_userId_fkey') THEN
      ALTER TABLE "WorkOrderMember"
        ADD CONSTRAINT "WorkOrderMember_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org_id')
     OR EXISTS (
       SELECT 1 FROM pg_proc WHERE proname = 'current_setting'
     ) THEN
    FOREACH tbl IN ARRAY ARRAY['WorkOrderMember', 'WorkOrderTempWorker']
    LOOP
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
      BEGIN
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_org_id()) WITH CHECK ("organizationId" = current_org_id())',
          tbl
        );
      EXCEPTION WHEN undefined_function THEN
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid)',
          tbl
        );
      END;
    END LOOP;
  END IF;
END $$;
