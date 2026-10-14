-- Fase 2 · Dados e privacidade: company exports, privacy requests, deletion receipts.
CREATE TABLE IF NOT EXISTS "DataExport" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "orgName" TEXT NOT NULL,
  "orgSlug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "reason" TEXT,
  "privacyRequestId" UUID,
  "requestedById" UUID,
  "requestedByName" TEXT NOT NULL,
  "fileKey" TEXT,
  "sizeBytes" BIGINT,
  "tables" INTEGER NOT NULL DEFAULT 0,
  "rows" INTEGER NOT NULL DEFAULT 0,
  "files" INTEGER NOT NULL DEFAULT 0,
  "filesMissing" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "linkTokenHash" TEXT,
  "linkCreatedAt" TIMESTAMP(3),
  "downloads" INTEGER NOT NULL DEFAULT 0,
  "lastDownloadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DataExport_linkTokenHash_key" ON "DataExport"("linkTokenHash");
CREATE INDEX IF NOT EXISTS "DataExport_organizationId_createdAt_idx" ON "DataExport"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "DataExport_status_idx" ON "DataExport"("status");

CREATE TABLE IF NOT EXISTS "PrivacyRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" UUID,
  "orgName" TEXT,
  "kind" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL DEFAULT 'person',
  "requesterName" TEXT NOT NULL,
  "requesterEmail" TEXT NOT NULL,
  "subjectEmail" TEXT,
  "subjectPhone" TEXT,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "response" TEXT,
  "closedAt" TIMESTAMP(3),
  "createdByName" TEXT NOT NULL,
  "handledByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PrivacyRequest_status_dueAt_idx" ON "PrivacyRequest"("status", "dueAt");
CREATE INDEX IF NOT EXISTS "PrivacyRequest_organizationId_idx" ON "PrivacyRequest"("organizationId");

CREATE TABLE IF NOT EXISTS "DataDeletion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "organizationId" UUID NOT NULL,
  "orgName" TEXT NOT NULL,
  "orgSlug" TEXT NOT NULL,
  "subjectMasked" TEXT,
  "subjectHash" TEXT,
  "counts" JSONB NOT NULL,
  "filesDeleted" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "privacyRequestId" UUID,
  "exportId" UUID,
  "exportSkippedWhy" TEXT,
  "performedById" UUID,
  "performedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "DataDeletion_organizationId_idx" ON "DataDeletion"("organizationId");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "DataExport", "PrivacyRequest", "DataDeletion" TO app_user;
  END IF;
END $$;
