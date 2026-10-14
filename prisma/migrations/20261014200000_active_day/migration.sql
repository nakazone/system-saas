-- Fase 2 · Ficha 360°: days each user used the CRM (usage frequency, health score, active users).
CREATE TABLE IF NOT EXISTS "ActiveDay" (
  "userId" UUID NOT NULL,
  "day" TEXT NOT NULL,
  "organizationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "day")
);
CREATE INDEX IF NOT EXISTS "ActiveDay_organizationId_day_idx" ON "ActiveDay"("organizationId", "day");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ActiveDay" TO app_user;
  END IF;
END $$;
