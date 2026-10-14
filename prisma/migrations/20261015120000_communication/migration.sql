-- Fase 2 · Comunicação: in-app notices, editable platform e-mails, send log, blocked addresses.
CREATE TABLE IF NOT EXISTS "PlatformAnnouncement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'info',
  "audience" TEXT NOT NULL DEFAULT 'all',
  "plans" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "organizationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "linkUrl" TEXT,
  "linkLabel" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdById" UUID,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PlatformAnnouncement_startsAt_idx" ON "PlatformAnnouncement"("startsAt");

CREATE TABLE IF NOT EXISTS "PlatformAnnouncementReceipt" (
  "announcementId" UUID NOT NULL REFERENCES "PlatformAnnouncement"("id") ON DELETE CASCADE,
  "userId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dismissedAt" TIMESTAMP(3),
  PRIMARY KEY ("announcementId", "userId")
);
CREATE INDEX IF NOT EXISTS "PlatformAnnouncementReceipt_organizationId_idx" ON "PlatformAnnouncementReceipt"("organizationId");

CREATE TABLE IF NOT EXISTS "PlatformEmailTemplate" (
  "key" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "buttonLabel" TEXT,
  "updatedById" UUID,
  "updatedByName" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("key", "locale")
);

CREATE TABLE IF NOT EXISTS "PlatformEmailLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "category" TEXT NOT NULL,
  "templateKey" TEXT,
  "toEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "organizationId" UUID,
  "provider" TEXT NOT NULL,
  "providerId" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "lastEventAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "events" JSONB
);
CREATE INDEX IF NOT EXISTS "PlatformEmailLog_createdAt_idx" ON "PlatformEmailLog"("createdAt");
CREATE INDEX IF NOT EXISTS "PlatformEmailLog_toEmail_idx" ON "PlatformEmailLog"("toEmail");
CREATE INDEX IF NOT EXISTS "PlatformEmailLog_providerId_idx" ON "PlatformEmailLog"("providerId");
CREATE INDEX IF NOT EXISTS "PlatformEmailLog_organizationId_createdAt_idx" ON "PlatformEmailLog"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "EmailSuppression" (
  "email" TEXT NOT NULL PRIMARY KEY,
  "reason" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByName" TEXT
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformAnnouncement", "PlatformAnnouncementReceipt", "PlatformEmailTemplate", "PlatformEmailLog", "EmailSuppression" TO app_user;
  END IF;
END $$;
