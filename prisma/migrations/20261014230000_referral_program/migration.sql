-- Referral program: Particular cashback when referred customer's invoice is paid.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "referralSettings" JSONB;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referredByCustomerId" UUID;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_referredByCustomerId_fkey'
  ) THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_referredByCustomerId_fkey"
      FOREIGN KEY ("referredByCustomerId") REFERENCES "Customer"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_organizationId_referralCode_key"
  ON "Customer"("organizationId", "referralCode");

CREATE INDEX IF NOT EXISTS "Customer_organizationId_referredByCustomerId_idx"
  ON "Customer"("organizationId", "referredByCustomerId");

CREATE TABLE IF NOT EXISTS "ReferralReward" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "referrerCustomerId" UUID NOT NULL,
  "referredCustomerId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "quoteId" UUID,
  "workOrderId" UUID,
  "projectAmount" DECIMAL(12,2) NOT NULL,
  "percent" DECIMAL(5,2) NOT NULL,
  "rewardAmount" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'credited',
  "creditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralReward_organizationId_invoiceId_key"
  ON "ReferralReward"("organizationId", "invoiceId");
CREATE INDEX IF NOT EXISTS "ReferralReward_organizationId_idx"
  ON "ReferralReward"("organizationId");
CREATE INDEX IF NOT EXISTS "ReferralReward_organizationId_referrerCustomerId_idx"
  ON "ReferralReward"("organizationId", "referrerCustomerId");
CREATE INDEX IF NOT EXISTS "ReferralReward_organizationId_referredCustomerId_idx"
  ON "ReferralReward"("organizationId", "referredCustomerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralReward_organizationId_fkey') THEN
    ALTER TABLE "ReferralReward"
      ADD CONSTRAINT "ReferralReward_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralReward_referrerCustomerId_fkey') THEN
    ALTER TABLE "ReferralReward"
      ADD CONSTRAINT "ReferralReward_referrerCustomerId_fkey"
      FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralReward_referredCustomerId_fkey') THEN
    ALTER TABLE "ReferralReward"
      ADD CONSTRAINT "ReferralReward_referredCustomerId_fkey"
      FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ReferralLedgerEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "referralRewardId" UUID,
  "invoiceId" UUID,
  "invoiceReceiptId" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralLedgerEntry_referralRewardId_key"
  ON "ReferralLedgerEntry"("referralRewardId");
CREATE INDEX IF NOT EXISTS "ReferralLedgerEntry_organizationId_idx"
  ON "ReferralLedgerEntry"("organizationId");
CREATE INDEX IF NOT EXISTS "ReferralLedgerEntry_organizationId_customerId_createdAt_idx"
  ON "ReferralLedgerEntry"("organizationId", "customerId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralLedgerEntry_organizationId_fkey') THEN
    ALTER TABLE "ReferralLedgerEntry"
      ADD CONSTRAINT "ReferralLedgerEntry_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralLedgerEntry_customerId_fkey') THEN
    ALTER TABLE "ReferralLedgerEntry"
      ADD CONSTRAINT "ReferralLedgerEntry_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReferralLedgerEntry_referralRewardId_fkey') THEN
    ALTER TABLE "ReferralLedgerEntry"
      ADD CONSTRAINT "ReferralLedgerEntry_referralRewardId_fkey"
      FOREIGN KEY ("referralRewardId") REFERENCES "ReferralReward"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE "ReferralReward" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "ReferralReward" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "ReferralReward";
  CREATE POLICY tenant_isolation ON "ReferralReward"
    USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
    WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

  ALTER TABLE "ReferralLedgerEntry" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "ReferralLedgerEntry" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "ReferralLedgerEntry";
  CREATE POLICY tenant_isolation ON "ReferralLedgerEntry"
    USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
    WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));
END $$;
