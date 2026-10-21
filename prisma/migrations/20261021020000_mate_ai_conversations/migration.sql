-- Mate AI command bar conversations (history in the bar and on the Mate AI page).
CREATE TABLE "MateAiConversation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT,
    "items" JSONB NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MateAiConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MateAiConversation_organizationId_userId_updatedAt_idx"
  ON "MateAiConversation"("organizationId", "userId", "updatedAt");

ALTER TABLE "MateAiConversation"
  ADD CONSTRAINT "MateAiConversation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MateAiConversation"
  ADD CONSTRAINT "MateAiConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MateAiConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MateAiConversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MateAiConversation"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MateAiConversation" TO app_user;
  END IF;
END $$;
