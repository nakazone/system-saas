-- Phase 2 M5: projects ops, visits, crews, schedule

-- Evolve Project
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "number" INTEGER,
  ADD COLUMN IF NOT EXISTS "quoteId" UUID,
  ADD COLUMN IF NOT EXISTS "customerId" UUID,
  ADD COLUMN IF NOT EXISTS "propertyId" UUID;

UPDATE "Project" SET status = 'planning' WHERE status = 'active' AND "quoteId" IS NULL;

-- PaymentSchedule: allow project copy (quoteId optional)
ALTER TABLE "PaymentSchedule" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "PaymentSchedule" ADD COLUMN IF NOT EXISTS "projectId" UUID;

CREATE TABLE IF NOT EXISTS "ProjectEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "visitId" UUID,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "actorId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Crew" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CrewMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "crewId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  CONSTRAINT "CrewMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Visit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "crewId" UUID,
  "assignedUserId" UUID,
  "title" TEXT,
  "phase" TEXT NOT NULL DEFAULT 'installation',
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "scheduledEnd" TIMESTAMP(3) NOT NULL,
  "instructions" TEXT,
  "checklistResponseId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Project_quoteId_key" ON "Project"("quoteId");
CREATE UNIQUE INDEX IF NOT EXISTS "Project_organizationId_number_key" ON "Project"("organizationId", "number");
CREATE INDEX IF NOT EXISTS "Project_organizationId_status_idx" ON "Project"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Project_customerId_idx" ON "Project"("customerId");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentSchedule_projectId_key" ON "PaymentSchedule"("projectId");
CREATE INDEX IF NOT EXISTS "PaymentSchedule_projectId_idx" ON "PaymentSchedule"("projectId");

CREATE INDEX IF NOT EXISTS "ProjectEvent_organizationId_idx" ON "ProjectEvent"("organizationId");
CREATE INDEX IF NOT EXISTS "ProjectEvent_projectId_createdAt_idx" ON "ProjectEvent"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectEvent_visitId_idx" ON "ProjectEvent"("visitId");

CREATE INDEX IF NOT EXISTS "Crew_organizationId_idx" ON "Crew"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "CrewMember_crewId_userId_key" ON "CrewMember"("crewId", "userId");
CREATE INDEX IF NOT EXISTS "CrewMember_organizationId_idx" ON "CrewMember"("organizationId");
CREATE INDEX IF NOT EXISTS "CrewMember_userId_idx" ON "CrewMember"("userId");

CREATE INDEX IF NOT EXISTS "Visit_organizationId_idx" ON "Visit"("organizationId");
CREATE INDEX IF NOT EXISTS "Visit_organizationId_scheduledStart_idx" ON "Visit"("organizationId", "scheduledStart");
CREATE INDEX IF NOT EXISTS "Visit_projectId_idx" ON "Visit"("projectId");
CREATE INDEX IF NOT EXISTS "Visit_crewId_idx" ON "Visit"("crewId");
CREATE INDEX IF NOT EXISTS "Visit_assignedUserId_idx" ON "Visit"("assignedUserId");
CREATE INDEX IF NOT EXISTS "Visit_organizationId_status_idx" ON "Visit"("organizationId", "status");

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Crew" ADD CONSTRAINT "Crew_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_checklistResponseId_fkey"
    FOREIGN KEY ("checklistResponseId") REFERENCES "ChecklistResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_visitId_fkey"
    FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ProjectEvent', 'Visit', 'Crew', 'CrewMember']
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
