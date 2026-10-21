CREATE TABLE "MateVoiceConversation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "createdById" UUID,
    "leadId" UUID,
    "customerId" UUID,
    "title" TEXT NOT NULL DEFAULT 'Conversa por voz',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "MateVoiceConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MateVoiceMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MateVoiceMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MateVoiceConversation_organizationId_createdById_createdAt_idx"
  ON "MateVoiceConversation"("organizationId", "createdById", "createdAt");
CREATE INDEX "MateVoiceConversation_organizationId_createdAt_idx"
  ON "MateVoiceConversation"("organizationId", "createdAt");
CREATE INDEX "MateVoiceConversation_leadId_idx" ON "MateVoiceConversation"("leadId");
CREATE INDEX "MateVoiceConversation_customerId_idx" ON "MateVoiceConversation"("customerId");
CREATE INDEX "MateVoiceMessage_organizationId_conversationId_createdAt_idx"
  ON "MateVoiceMessage"("organizationId", "conversationId", "createdAt");

ALTER TABLE "MateVoiceConversation"
  ADD CONSTRAINT "MateVoiceConversation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MateVoiceConversation"
  ADD CONSTRAINT "MateVoiceConversation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MateVoiceConversation"
  ADD CONSTRAINT "MateVoiceConversation_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MateVoiceConversation"
  ADD CONSTRAINT "MateVoiceConversation_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MateVoiceMessage"
  ADD CONSTRAINT "MateVoiceMessage_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MateVoiceMessage"
  ADD CONSTRAINT "MateVoiceMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "MateVoiceConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MateVoiceConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MateVoiceConversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MateVoiceConversation"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

ALTER TABLE "MateVoiceMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MateVoiceMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MateVoiceMessage"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MateVoiceConversation", "MateVoiceMessage" TO app_user;
  END IF;
END $$;
