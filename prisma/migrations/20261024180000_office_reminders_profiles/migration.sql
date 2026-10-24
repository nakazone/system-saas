-- Fuller employee profiles (photo, voice, way of talking, follow-up style, hours) and reminders.

ALTER TABLE "VirtualAgent"
  ADD COLUMN "photoUrl" TEXT,
  ADD COLUMN "voiceId" TEXT,
  ADD COLUMN "personality" TEXT,
  ADD COLUMN "followUpStyle" TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN "workStartHour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "workEndHour" INTEGER NOT NULL DEFAULT 18;

CREATE TABLE "OfficeReminder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "agentKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "nudgeCount" INTEGER NOT NULL DEFAULT 0,
    "lastNudgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeReminder_organizationId_userId_status_dueAt_idx"
  ON "OfficeReminder"("organizationId", "userId", "status", "dueAt");
CREATE INDEX "OfficeReminder_status_dueAt_idx" ON "OfficeReminder"("status", "dueAt");

ALTER TABLE "OfficeReminder"
  ADD CONSTRAINT "OfficeReminder_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfficeReminder"
  ADD CONSTRAINT "OfficeReminder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficeReminder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OfficeReminder";
CREATE POLICY tenant_isolation ON "OfficeReminder"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
