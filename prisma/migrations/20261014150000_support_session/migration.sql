-- "Entrar como suporte" sessions (platform table: outside tenant RLS, read by /master and the support guard).
CREATE TABLE IF NOT EXISTS "SupportSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "adminId" UUID NOT NULL,
  "adminName" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "userName" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'read',
  "ticketId" UUID,
  "tokenHash" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "endedBy" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "views" INTEGER NOT NULL DEFAULT 0,
  "blocked" INTEGER NOT NULL DEFAULT 0,
  "lastPath" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportSession_tokenHash_key" ON "SupportSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "SupportSession_organizationId_createdAt_idx" ON "SupportSession"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportSession_adminId_createdAt_idx" ON "SupportSession"("adminId", "createdAt");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SupportSession" TO app_user;
  END IF;
END $$;
