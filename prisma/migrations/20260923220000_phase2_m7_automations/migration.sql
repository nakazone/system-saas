-- Phase 2 M7: communication automations

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "automationSettings" JSONB;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "marketingConsent" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "transactionalOptOut" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "triggerKey" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "customerId" UUID,
  "toAddress" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "payload" JSONB,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunicationLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "direction" TEXT NOT NULL DEFAULT 'outbound',
  "triggerKey" TEXT,
  "entityType" TEXT,
  "entityId" UUID,
  "customerId" UUID,
  "toAddress" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "skipReason" TEXT,
  "scheduledMessageId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduledMessage_organizationId_idx" ON "ScheduledMessage"("organizationId");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_organizationId_status_scheduledFor_idx"
  ON "ScheduledMessage"("organizationId", "status", "scheduledFor");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_entityType_entityId_idx" ON "ScheduledMessage"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_customerId_idx" ON "ScheduledMessage"("customerId");

CREATE INDEX IF NOT EXISTS "CommunicationLog_organizationId_idx" ON "CommunicationLog"("organizationId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_organizationId_createdAt_idx" ON "CommunicationLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationLog_customerId_idx" ON "CommunicationLog"("customerId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_scheduledMessageId_idx" ON "CommunicationLog"("scheduledMessageId");

DO $$ BEGIN
  ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_scheduledMessageId_fkey"
    FOREIGN KEY ("scheduledMessageId") REFERENCES "ScheduledMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ScheduledMessage', 'CommunicationLog']
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
