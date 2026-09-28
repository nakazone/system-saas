-- Internal chat (DM / group / job channel)
-- Reverse: see down.sql in this folder

CREATE TABLE IF NOT EXISTS "ChatConversation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "workOrderId" UUID,
  "name" TEXT,
  "dmKey" TEXT,
  "createdById" UUID,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversation_workOrderId_key"
  ON "ChatConversation"("workOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversation_organizationId_dmKey_key"
  ON "ChatConversation"("organizationId", "dmKey");
CREATE INDEX IF NOT EXISTS "ChatConversation_organizationId_idx"
  ON "ChatConversation"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatConversation_organizationId_type_idx"
  ON "ChatConversation"("organizationId", "type");
CREATE INDEX IF NOT EXISTS "ChatConversation_organizationId_archivedAt_idx"
  ON "ChatConversation"("organizationId", "archivedAt");
CREATE INDEX IF NOT EXISTS "ChatConversation_workOrderId_idx"
  ON "ChatConversation"("workOrderId");
CREATE INDEX IF NOT EXISTS "ChatConversation_createdById_idx"
  ON "ChatConversation"("createdById");

CREATE TABLE IF NOT EXISTS "ChatConversationMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "lastReadAt" TIMESTAMP(3),
  "lastReadMessageId" UUID,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "ChatConversationMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversationMember_conversationId_userId_key"
  ON "ChatConversationMember"("conversationId", "userId");
CREATE INDEX IF NOT EXISTS "ChatConversationMember_organizationId_idx"
  ON "ChatConversationMember"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatConversationMember_userId_idx"
  ON "ChatConversationMember"("userId");
CREATE INDEX IF NOT EXISTS "ChatConversationMember_conversationId_lastReadAt_idx"
  ON "ChatConversationMember"("conversationId", "lastReadAt");
CREATE INDEX IF NOT EXISTS "ChatConversationMember_organizationId_userId_leftAt_idx"
  ON "ChatConversationMember"("organizationId", "userId", "leftAt");

CREATE TABLE IF NOT EXISTS "ChatConversationContext" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatConversationContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversationContext_conversationId_userId_key"
  ON "ChatConversationContext"("conversationId", "userId");
CREATE INDEX IF NOT EXISTS "ChatConversationContext_organizationId_idx"
  ON "ChatConversationContext"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatConversationContext_userId_idx"
  ON "ChatConversationContext"("userId");
CREATE INDEX IF NOT EXISTS "ChatConversationContext_workOrderId_idx"
  ON "ChatConversationContext"("workOrderId");

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "authorId" UUID,
  "body" TEXT NOT NULL,
  "parentMessageId" UUID,
  "type" TEXT NOT NULL DEFAULT 'text',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedAt" TIMESTAMP(3),
  "hiddenAt" TIMESTAMP(3),
  "hiddenById" UUID,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatMessage_organizationId_idx"
  ON "ChatMessage"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_createdAt_idx"
  ON "ChatMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_authorId_idx"
  ON "ChatMessage"("authorId");
CREATE INDEX IF NOT EXISTS "ChatMessage_parentMessageId_idx"
  ON "ChatMessage"("parentMessageId");
CREATE INDEX IF NOT EXISTS "ChatMessage_organizationId_hiddenAt_idx"
  ON "ChatMessage"("organizationId", "hiddenAt");

-- Full-text search on message body (mixed PT/EN → simple config)
CREATE INDEX IF NOT EXISTS "ChatMessage_body_fts_idx"
  ON "ChatMessage" USING GIN (to_tsvector('simple', coalesce("body", '')));

CREATE TABLE IF NOT EXISTS "ChatMessageEdit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "previousBody" TEXT NOT NULL,
  "editedById" UUID,
  "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessageEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatMessageEdit_organizationId_idx"
  ON "ChatMessageEdit"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatMessageEdit_messageId_editedAt_idx"
  ON "ChatMessageEdit"("messageId", "editedAt");
CREATE INDEX IF NOT EXISTS "ChatMessageEdit_editedById_idx"
  ON "ChatMessageEdit"("editedById");

CREATE TABLE IF NOT EXISTS "ChatMessageJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "linkedById" UUID,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'inline',
  CONSTRAINT "ChatMessageJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessageJob_messageId_workOrderId_key"
  ON "ChatMessageJob"("messageId", "workOrderId");
CREATE INDEX IF NOT EXISTS "ChatMessageJob_organizationId_idx"
  ON "ChatMessageJob"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatMessageJob_workOrderId_idx"
  ON "ChatMessageJob"("workOrderId");
CREATE INDEX IF NOT EXISTS "ChatMessageJob_linkedById_idx"
  ON "ChatMessageJob"("linkedById");
CREATE INDEX IF NOT EXISTS "ChatMessageJob_workOrderId_linkedAt_idx"
  ON "ChatMessageJob"("workOrderId", "linkedAt");

CREATE TABLE IF NOT EXISTS "ChatMessageMention" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "mentionType" TEXT NOT NULL DEFAULT 'user',
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessageMention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessageMention_messageId_userId_key"
  ON "ChatMessageMention"("messageId", "userId");
CREATE INDEX IF NOT EXISTS "ChatMessageMention_organizationId_idx"
  ON "ChatMessageMention"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatMessageMention_userId_readAt_idx"
  ON "ChatMessageMention"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "ChatMessageMention_messageId_idx"
  ON "ChatMessageMention"("messageId");

CREATE TABLE IF NOT EXISTS "ChatAttachment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "thumbnailKey" TEXT,
  "capturedAt" TIMESTAMP(3),
  "lat" DECIMAL(10, 7),
  "lng" DECIMAL(10, 7),
  "transcription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatAttachment_organizationId_idx"
  ON "ChatAttachment"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatAttachment_messageId_idx"
  ON "ChatAttachment"("messageId");
CREATE INDEX IF NOT EXISTS "ChatAttachment_organizationId_mimeType_idx"
  ON "ChatAttachment"("organizationId", "mimeType");

CREATE TABLE IF NOT EXISTS "ChatAuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "actorId" UUID,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" UUID NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatAuditLog_organizationId_idx"
  ON "ChatAuditLog"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatAuditLog_organizationId_createdAt_idx"
  ON "ChatAuditLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatAuditLog_actorId_idx"
  ON "ChatAuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "ChatAuditLog_targetType_targetId_idx"
  ON "ChatAuditLog"("targetType", "targetId");

-- Phase 2 stub (no UI)
CREATE TABLE IF NOT EXISTS "ChatMessageFlag" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "assigneeId" UUID,
  "dueDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessageFlag_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatMessageFlag_organizationId_idx"
  ON "ChatMessageFlag"("organizationId");
CREATE INDEX IF NOT EXISTS "ChatMessageFlag_messageId_idx"
  ON "ChatMessageFlag"("messageId");
CREATE INDEX IF NOT EXISTS "ChatMessageFlag_assigneeId_idx"
  ON "ChatMessageFlag"("assigneeId");
CREATE INDEX IF NOT EXISTS "ChatMessageFlag_organizationId_type_status_idx"
  ON "ChatMessageFlag"("organizationId", "type", "status");

-- Foreign keys (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversation_organizationId_fkey') THEN
    ALTER TABLE "ChatConversation"
      ADD CONSTRAINT "ChatConversation_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversation_workOrderId_fkey') THEN
    ALTER TABLE "ChatConversation"
      ADD CONSTRAINT "ChatConversation_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversation_createdById_fkey') THEN
    ALTER TABLE "ChatConversation"
      ADD CONSTRAINT "ChatConversation_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversationMember_organizationId_fkey') THEN
    ALTER TABLE "ChatConversationMember"
      ADD CONSTRAINT "ChatConversationMember_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversationMember_conversationId_fkey') THEN
    ALTER TABLE "ChatConversationMember"
      ADD CONSTRAINT "ChatConversationMember_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversationMember_userId_fkey') THEN
    ALTER TABLE "ChatConversationMember"
      ADD CONSTRAINT "ChatConversationMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversationContext_organizationId_fkey') THEN
    ALTER TABLE "ChatConversationContext"
      ADD CONSTRAINT "ChatConversationContext_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversationContext_conversationId_fkey') THEN
    ALTER TABLE "ChatConversationContext"
      ADD CONSTRAINT "ChatConversationContext_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversationContext_userId_fkey') THEN
    ALTER TABLE "ChatConversationContext"
      ADD CONSTRAINT "ChatConversationContext_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConversationContext_workOrderId_fkey') THEN
    ALTER TABLE "ChatConversationContext"
      ADD CONSTRAINT "ChatConversationContext_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_organizationId_fkey') THEN
    ALTER TABLE "ChatMessage"
      ADD CONSTRAINT "ChatMessage_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_conversationId_fkey') THEN
    ALTER TABLE "ChatMessage"
      ADD CONSTRAINT "ChatMessage_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_authorId_fkey') THEN
    ALTER TABLE "ChatMessage"
      ADD CONSTRAINT "ChatMessage_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_parentMessageId_fkey') THEN
    ALTER TABLE "ChatMessage"
      ADD CONSTRAINT "ChatMessage_parentMessageId_fkey"
      FOREIGN KEY ("parentMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_hiddenById_fkey') THEN
    ALTER TABLE "ChatMessage"
      ADD CONSTRAINT "ChatMessage_hiddenById_fkey"
      FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageEdit_organizationId_fkey') THEN
    ALTER TABLE "ChatMessageEdit"
      ADD CONSTRAINT "ChatMessageEdit_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageEdit_messageId_fkey') THEN
    ALTER TABLE "ChatMessageEdit"
      ADD CONSTRAINT "ChatMessageEdit_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageEdit_editedById_fkey') THEN
    ALTER TABLE "ChatMessageEdit"
      ADD CONSTRAINT "ChatMessageEdit_editedById_fkey"
      FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageJob_organizationId_fkey') THEN
    ALTER TABLE "ChatMessageJob"
      ADD CONSTRAINT "ChatMessageJob_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageJob_messageId_fkey') THEN
    ALTER TABLE "ChatMessageJob"
      ADD CONSTRAINT "ChatMessageJob_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageJob_workOrderId_fkey') THEN
    ALTER TABLE "ChatMessageJob"
      ADD CONSTRAINT "ChatMessageJob_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageJob_linkedById_fkey') THEN
    ALTER TABLE "ChatMessageJob"
      ADD CONSTRAINT "ChatMessageJob_linkedById_fkey"
      FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageMention_organizationId_fkey') THEN
    ALTER TABLE "ChatMessageMention"
      ADD CONSTRAINT "ChatMessageMention_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageMention_messageId_fkey') THEN
    ALTER TABLE "ChatMessageMention"
      ADD CONSTRAINT "ChatMessageMention_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageMention_userId_fkey') THEN
    ALTER TABLE "ChatMessageMention"
      ADD CONSTRAINT "ChatMessageMention_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatAttachment_organizationId_fkey') THEN
    ALTER TABLE "ChatAttachment"
      ADD CONSTRAINT "ChatAttachment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatAttachment_messageId_fkey') THEN
    ALTER TABLE "ChatAttachment"
      ADD CONSTRAINT "ChatAttachment_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatAuditLog_organizationId_fkey') THEN
    ALTER TABLE "ChatAuditLog"
      ADD CONSTRAINT "ChatAuditLog_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatAuditLog_actorId_fkey') THEN
    ALTER TABLE "ChatAuditLog"
      ADD CONSTRAINT "ChatAuditLog_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageFlag_organizationId_fkey') THEN
    ALTER TABLE "ChatMessageFlag"
      ADD CONSTRAINT "ChatMessageFlag_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageFlag_messageId_fkey') THEN
    ALTER TABLE "ChatMessageFlag"
      ADD CONSTRAINT "ChatMessageFlag_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessageFlag_assigneeId_fkey') THEN
    ALTER TABLE "ChatMessageFlag"
      ADD CONSTRAINT "ChatMessageFlag_assigneeId_fkey"
      FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Tenant RLS
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ChatConversation',
    'ChatConversationMember',
    'ChatConversationContext',
    'ChatMessage',
    'ChatMessageEdit',
    'ChatMessageJob',
    'ChatMessageMention',
    'ChatAttachment',
    'ChatAuditLog',
    'ChatMessageFlag'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("organizationId" = current_setting(''app.current_tenant_id'', true)::uuid)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Backfill: job channels for active work orders (draft | scheduled | in_progress)
INSERT INTO "ChatConversation" (
  "id", "organizationId", "type", "workOrderId", "name", "archivedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  wo."organizationId",
  'job',
  wo."id",
  CASE
    WHEN wo."number" IS NOT NULL THEN 'Job #' || wo."number"::text || ' — ' || wo."title"
    ELSE wo."title"
  END,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "WorkOrder" wo
WHERE wo."status" IN ('draft', 'scheduled', 'in_progress')
  AND NOT EXISTS (
    SELECT 1 FROM "ChatConversation" c
    WHERE c."organizationId" = wo."organizationId"
      AND c."workOrderId" = wo."id"
  );

-- Members: assignee + WorkOrderMember (active users only)
INSERT INTO "ChatConversationMember" (
  "id", "organizationId", "conversationId", "userId", "role", "muted", "joinedAt"
)
SELECT
  gen_random_uuid(),
  c."organizationId",
  c."id",
  u."id",
  'member',
  false,
  CURRENT_TIMESTAMP
FROM "ChatConversation" c
JOIN "WorkOrder" wo ON wo."id" = c."workOrderId"
JOIN LATERAL (
  SELECT wo."assignedUserId" AS "userId"
  WHERE wo."assignedUserId" IS NOT NULL
  UNION
  SELECT wom."userId"
  FROM "WorkOrderMember" wom
  WHERE wom."workOrderId" = wo."id"
) team ON true
JOIN "User" u ON u."id" = team."userId"
  AND u."organizationId" = c."organizationId"
  AND u."status" = 'active'
WHERE c."type" = 'job'
  AND NOT EXISTS (
    SELECT 1 FROM "ChatConversationMember" m
    WHERE m."conversationId" = c."id" AND m."userId" = u."id"
  );

-- System notice on each backfilled channel
INSERT INTO "ChatMessage" (
  "id", "organizationId", "conversationId", "authorId", "body", "type", "createdAt"
)
SELECT
  gen_random_uuid(),
  c."organizationId",
  c."id",
  NULL,
  'Canal da obra criado automaticamente.',
  'system',
  CURRENT_TIMESTAMP
FROM "ChatConversation" c
WHERE c."type" = 'job'
  AND NOT EXISTS (
    SELECT 1 FROM "ChatMessage" m
    WHERE m."conversationId" = c."id" AND m."type" = 'system'
  );
