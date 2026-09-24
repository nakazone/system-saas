-- Work orders + meetings (Schedule / Jobs modules)

CREATE TABLE IF NOT EXISTS "WorkOrder" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "number" INTEGER,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sourceType" TEXT NOT NULL DEFAULT 'other',
  "sourceName" TEXT,
  "customerId" UUID,
  "builderId" UUID,
  "address" TEXT,
  "notes" TEXT,
  "assignedUserId" UUID,
  "crewId" UUID,
  "scheduledStart" TIMESTAMP(3),
  "scheduledEnd" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Meeting" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "scheduledEnd" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "notes" TEXT,
  "customerId" UUID,
  "assignedUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrder_organizationId_number_key" ON "WorkOrder"("organizationId", "number");
CREATE INDEX IF NOT EXISTS "WorkOrder_organizationId_idx" ON "WorkOrder"("organizationId");
CREATE INDEX IF NOT EXISTS "WorkOrder_organizationId_status_idx" ON "WorkOrder"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "WorkOrder_organizationId_scheduledStart_idx" ON "WorkOrder"("organizationId", "scheduledStart");
CREATE INDEX IF NOT EXISTS "WorkOrder_customerId_idx" ON "WorkOrder"("customerId");
CREATE INDEX IF NOT EXISTS "WorkOrder_builderId_idx" ON "WorkOrder"("builderId");
CREATE INDEX IF NOT EXISTS "WorkOrder_assignedUserId_idx" ON "WorkOrder"("assignedUserId");
CREATE INDEX IF NOT EXISTS "WorkOrder_crewId_idx" ON "WorkOrder"("crewId");

CREATE INDEX IF NOT EXISTS "Meeting_organizationId_idx" ON "Meeting"("organizationId");
CREATE INDEX IF NOT EXISTS "Meeting_organizationId_scheduledStart_idx" ON "Meeting"("organizationId", "scheduledStart");
CREATE INDEX IF NOT EXISTS "Meeting_organizationId_status_idx" ON "Meeting"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Meeting_customerId_idx" ON "Meeting"("customerId");
CREATE INDEX IF NOT EXISTS "Meeting_assignedUserId_idx" ON "Meeting"("assignedUserId");

DO $$ BEGIN
  ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_builderId_fkey"
    FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['WorkOrder', 'Meeting']
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
