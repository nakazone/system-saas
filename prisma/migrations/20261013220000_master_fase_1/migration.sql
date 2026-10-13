-- Master, fase 1: plan catalog, Stripe, read-only accounts, billing reminders, job runs, ticket conversations.

-- Organization
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "readOnlySince" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "dunningPausedUntil" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId") WHERE "stripeCustomerId" IS NOT NULL;

-- Payments: Stripe fields
ALTER TABLE "PlatformPayment" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "PlatformPayment" ADD COLUMN IF NOT EXISTS "stripeInvoiceId" TEXT;
ALTER TABLE "PlatformPayment" ADD COLUMN IF NOT EXISTS "stripeChargeId" TEXT;
ALTER TABLE "PlatformPayment" ADD COLUMN IF NOT EXISTS "invoiceUrl" TEXT;
ALTER TABLE "PlatformPayment" ADD COLUMN IF NOT EXISTS "invoicePdfUrl" TEXT;
ALTER TABLE "PlatformPayment" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformPayment_stripeInvoiceId_key" ON "PlatformPayment"("stripeInvoiceId");

-- Plan catalog (seeded with the prices that were fixed in the code)
CREATE TABLE IF NOT EXISTS "Plan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "monthlyCents" INTEGER NOT NULL,
  "annualCents" INTEGER NOT NULL,
  "includedUsers" INTEGER,
  "trialDays" INTEGER NOT NULL DEFAULT 30,
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "stripeProductId" TEXT,
  "stripeMonthlyPriceId" TEXT,
  "stripeAnnualPriceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Plan_key_key" ON "Plan"("key");
INSERT INTO "Plan" ("key", "name", "description", "monthlyCents", "annualCents", "includedUsers", "trialDays", "visible", "active", "sortOrder")
VALUES
  ('starter', 'Starter', 'Para empresas de até 5 pessoas', 12900, 129000, 5, 30, true, true, 1),
  ('professional', 'Professional', 'Para equipes de até 15 pessoas', 29900, 299000, 15, 30, false, true, 2),
  ('business', 'Business', 'Usuários ilimitados', 59900, 599000, NULL, 30, false, true, 3)
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "StripeEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "organizationId" UUID,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "error" TEXT,
  "payload" JSONB
);
CREATE INDEX IF NOT EXISTS "StripeEvent_receivedAt_idx" ON "StripeEvent"("receivedAt");

CREATE TABLE IF NOT EXISTS "DunningStep" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "dueKey" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DunningStep_organizationId_dueKey_step_key" ON "DunningStep"("organizationId", "dueKey", "step");
CREATE INDEX IF NOT EXISTS "DunningStep_sentAt_idx" ON "DunningStep"("sentAt");

CREATE TABLE IF NOT EXISTS "JobRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "ok" BOOLEAN,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "detail" JSONB,
  "error" TEXT,
  "trigger" TEXT NOT NULL DEFAULT 'schedule'
);
CREATE INDEX IF NOT EXISTS "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- Support tickets become conversations
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "assigneeId" UUID;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3);
UPDATE "SupportTicket" SET "lastMessageAt" = "createdAt" WHERE "lastMessageAt" IS NULL;

CREATE TABLE IF NOT EXISTS "SupportTicketMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "ticketId" UUID NOT NULL REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "authorType" TEXT NOT NULL,
  "authorId" UUID,
  "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicketMessage_organizationId_idx" ON "SupportTicketMessage"("organizationId");
-- An admin note written in the old panel becomes the first platform reply.
INSERT INTO "SupportTicketMessage" ("ticketId", "organizationId", "authorType", "authorName", "body", "createdAt")
SELECT t."id", t."organizationId", 'platform', 'Equipe ObraMate', t."adminNote", COALESCE(t."closedAt", t."updatedAt")
FROM "SupportTicket" t
WHERE t."adminNote" IS NOT NULL AND btrim(t."adminNote") <> ''
  AND NOT EXISTS (SELECT 1 FROM "SupportTicketMessage" m WHERE m."ticketId" = t."id");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Plan", "StripeEvent", "DunningStep", "JobRun", "SupportTicketMessage" TO app_user;
  END IF;
END $$;
