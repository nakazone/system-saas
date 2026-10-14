-- Fase 2 · Segurança: histórico de login, alerta de aparelho novo, trava "não fui eu".
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "securityLockedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "LoginEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "adminId" UUID,
  "userId" UUID,
  "organizationId" UUID,
  "email" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "method" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "device" TEXT,
  "country" TEXT,
  "deviceId" TEXT,
  "newDevice" BOOLEAN NOT NULL DEFAULT false,
  "alertTokenHash" TEXT,
  "alertUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "LoginEvent_alertTokenHash_key" ON "LoginEvent"("alertTokenHash");
CREATE INDEX IF NOT EXISTS "LoginEvent_adminId_createdAt_idx" ON "LoginEvent"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LoginEvent" TO app_user;
  END IF;
END $$;
