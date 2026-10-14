-- Fase 2 · Saúde do sistema: job status, service checks, grouped application errors.
CREATE TABLE IF NOT EXISTS "JobStatus" (
  "name" TEXT NOT NULL PRIMARY KEY,
  "label" TEXT NOT NULL,
  "intervalSec" INTEGER NOT NULL,
  "lastStartedAt" TIMESTAMP(3),
  "lastFinishedAt" TIMESTAMP(3),
  "lastOk" BOOLEAN,
  "lastError" TEXT,
  "lastDurationMs" INTEGER,
  "lastProcessed" INTEGER,
  "runs" INTEGER NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ServiceCheck" (
  "id" BIGSERIAL PRIMARY KEY,
  "service" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "latencyMs" INTEGER,
  "detail" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ServiceCheck_service_checkedAt_idx" ON "ServiceCheck"("service", "checkedAt");

CREATE TABLE IF NOT EXISTS "ErrorGroup" (
  "fingerprint" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stackTop" TEXT,
  "path" TEXT,
  "method" TEXT,
  "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "count" INTEGER NOT NULL DEFAULT 1,
  "lastOrgId" UUID,
  "lastUserId" UUID,
  "samples" JSONB,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolvedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "ErrorGroup_lastSeen_idx" ON "ErrorGroup"("lastSeen");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "JobStatus", "ServiceCheck", "ErrorGroup" TO app_user;
    GRANT USAGE, SELECT ON SEQUENCE "ServiceCheck_id_seq" TO app_user;
  END IF;
END $$;
