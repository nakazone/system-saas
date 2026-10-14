-- Fase 2 · Cobrança: cupons, disputas, cartões, cancelamento pela empresa e motivos.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cancelReasonKey" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cardBrand" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cardLast4" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cardExpMonth" INTEGER;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cardExpYear" INTEGER;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cardSyncedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Coupon" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "percentOff" INTEGER,
  "amountOffCents" INTEGER,
  "duration" TEXT NOT NULL,
  "durationMonths" INTEGER,
  "maxRedemptions" INTEGER,
  "expiresAt" TIMESTAMP(3),
  "plans" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "stripeCouponId" TEXT,
  "stripePromotionCodeId" TEXT,
  "timesRedeemed" INTEGER NOT NULL DEFAULT 0,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_code_key" ON "Coupon"("code");

CREATE TABLE IF NOT EXISTS "PlatformDispute" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" UUID,
  "orgName" TEXT,
  "paymentId" UUID,
  "chargeId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "evidenceDueBy" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "PlatformDispute_status_idx" ON "PlatformDispute"("status");
CREATE INDEX IF NOT EXISTS "PlatformDispute_organizationId_idx" ON "PlatformDispute"("organizationId");

CREATE TABLE IF NOT EXISTS "CancellationEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "orgName" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "reasonKey" TEXT NOT NULL,
  "comment" TEXT,
  "mrrCents" INTEGER NOT NULL DEFAULT 0,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveAt" TIMESTAMP(3),
  "offerShown" BOOLEAN NOT NULL DEFAULT false,
  "offerAccepted" BOOLEAN NOT NULL DEFAULT false,
  "undoneAt" TIMESTAMP(3),
  "byName" TEXT
);
CREATE INDEX IF NOT EXISTS "CancellationEvent_requestedAt_idx" ON "CancellationEvent"("requestedAt");
CREATE INDEX IF NOT EXISTS "CancellationEvent_organizationId_idx" ON "CancellationEvent"("organizationId");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Coupon", "PlatformDispute", "CancellationEvent" TO app_user;
  END IF;
END $$;
