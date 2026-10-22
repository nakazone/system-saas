-- In-app notification inbox (bell) for staff. Push still uses PushSubscription.

CREATE TABLE "StaffNotification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffNotification_organizationId_userId_dedupeKey_key"
  ON "StaffNotification"("organizationId", "userId", "dedupeKey");
CREATE INDEX "StaffNotification_organizationId_userId_createdAt_idx"
  ON "StaffNotification"("organizationId", "userId", "createdAt");
CREATE INDEX "StaffNotification_organizationId_userId_readAt_idx"
  ON "StaffNotification"("organizationId", "userId", "readAt");

ALTER TABLE "StaffNotification"
  ADD CONSTRAINT "StaffNotification_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffNotification"
  ADD CONSTRAINT "StaffNotification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffNotification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StaffNotification";
CREATE POLICY tenant_isolation ON "StaffNotification"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
