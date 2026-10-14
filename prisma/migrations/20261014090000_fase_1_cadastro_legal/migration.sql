-- Fase 1 (resto): signup with e-mail verification, invites, legal acceptance, password reset, persistent rate limit.

CREATE TABLE IF NOT EXISTS "SignupRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "adminName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "contactPhone" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'America/Denver',
  "inviteId" UUID,
  "ip" TEXT,
  "userAgent" TEXT,
  "legalVersions" JSONB NOT NULL,
  "sendCount" INTEGER NOT NULL DEFAULT 1,
  "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "organizationId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SignupRequest_tokenHash_key" ON "SignupRequest"("tokenHash");
CREATE INDEX IF NOT EXISTS "SignupRequest_email_createdAt_idx" ON "SignupRequest"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "SignupRequest_ip_createdAt_idx" ON "SignupRequest"("ip", "createdAt");
CREATE INDEX IF NOT EXISTS "SignupRequest_createdAt_idx" ON "SignupRequest"("createdAt");

CREATE TABLE IF NOT EXISTS "SignupInvite" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "code" TEXT NOT NULL,
  "email" TEXT,
  "companyName" TEXT,
  "plan" TEXT NOT NULL DEFAULT 'starter',
  "trialDays" INTEGER NOT NULL DEFAULT 30,
  "note" TEXT,
  "createdById" UUID,
  "expiresAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "organizationId" UUID,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SignupInvite_code_key" ON "SignupInvite"("code");
CREATE INDEX IF NOT EXISTS "SignupInvite_createdAt_idx" ON "SignupInvite"("createdAt");

CREATE TABLE IF NOT EXISTS "LegalAcceptance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" UUID,
  "userName" TEXT,
  "userEmail" TEXT,
  "document" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'signup',
  "ip" TEXT,
  "userAgent" TEXT,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "LegalAcceptance_organizationId_document_acceptedAt_idx" ON "LegalAcceptance"("organizationId", "document", "acceptedAt");

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "RateEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "RateEvent_key_createdAt_idx" ON "RateEvent"("key", "createdAt");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SignupRequest", "SignupInvite", "LegalAcceptance", "PasswordResetToken", "RateEvent" TO app_user;
    GRANT USAGE, SELECT ON SEQUENCE "RateEvent_id_seq" TO app_user;
  END IF;
END $$;
