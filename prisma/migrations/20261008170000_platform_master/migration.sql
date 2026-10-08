-- Master user of the platform: roles, 2FA, platform billing, audit, notes, contact log.

-- PlatformAdmin
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "totpSecretEnc" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "recoveryCodeHashes" JSONB;
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "activationTokenHash" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "activationExpiresAt" TIMESTAMP(3);
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "invitedById" UUID;
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "lastLoginIp" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformAdmin_activationTokenHash_key" ON "PlatformAdmin"("activationTokenHash");
-- Exactly one Master on the platform.
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformAdmin_one_master" ON "PlatformAdmin"("role") WHERE "role" = 'MASTER';

-- Organization: platform billing
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "billingCycle" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "planPriceCents" INTEGER;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "billingContactName" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "billingContactEmail" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "billingContactPhone" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

-- Audit log (append-only)
CREATE TABLE IF NOT EXISTS "PlatformAuditLog" (
  "id" BIGSERIAL PRIMARY KEY,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" UUID,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "targetLabel" TEXT,
  "meta" JSONB,
  "ip" TEXT,
  "userAgent" TEXT,
  "stepUp" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_at_idx" ON "PlatformAuditLog"("at");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_targetType_targetId_idx" ON "PlatformAuditLog"("targetType", "targetId");

CREATE OR REPLACE FUNCTION platform_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PlatformAuditLog is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS platform_audit_log_no_change ON "PlatformAuditLog";
CREATE TRIGGER platform_audit_log_no_change
  BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
  FOR EACH ROW EXECUTE FUNCTION platform_audit_log_immutable();

-- Payments recorded by the platform team
CREATE TABLE IF NOT EXISTS "PlatformPayment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "amountCents" INTEGER NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'card',
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'paid',
  "note" TEXT,
  "recordedById" UUID,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PlatformPayment_organizationId_paidAt_idx" ON "PlatformPayment"("organizationId", "paidAt");
CREATE INDEX IF NOT EXISTS "PlatformPayment_paidAt_idx" ON "PlatformPayment"("paidAt");

CREATE TABLE IF NOT EXISTS "PlatformNote" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "authorId" UUID,
  "authorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PlatformNote_organizationId_createdAt_idx" ON "PlatformNote"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "PlatformContactLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "contactRole" TEXT NOT NULL DEFAULT 'owner',
  "contactName" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "authorId" UUID,
  "authorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PlatformContactLog_organizationId_createdAt_idx" ON "PlatformContactLog"("organizationId", "createdAt");

-- Platform tables are not tenant-scoped (no RLS). Keep the app role able to use them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformPayment", "PlatformNote", "PlatformContactLog" TO app_user;
    GRANT SELECT, INSERT ON "PlatformAuditLog" TO app_user;
    GRANT USAGE, SELECT ON SEQUENCE "PlatformAuditLog_id_seq" TO app_user;
  END IF;
END $$;
