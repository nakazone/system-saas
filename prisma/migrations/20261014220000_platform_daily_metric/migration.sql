-- Fase 2 · Métricas: daily snapshot of MRR, company states and active users.
CREATE TABLE IF NOT EXISTS "PlatformDailyMetric" (
  "day" TEXT NOT NULL PRIMARY KEY,
  "mrrCents" INTEGER NOT NULL,
  "paying" INTEGER NOT NULL,
  "trial" INTEGER NOT NULL,
  "pastDue" INTEGER NOT NULL,
  "readOnly" INTEGER NOT NULL,
  "suspended" INTEGER NOT NULL,
  "canceled" INTEGER NOT NULL,
  "dau" INTEGER NOT NULL DEFAULT 0,
  "wau" INTEGER NOT NULL DEFAULT 0,
  "mau" INTEGER NOT NULL DEFAULT 0,
  "orgMrr" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformDailyMetric" TO app_user;
  END IF;
END $$;
