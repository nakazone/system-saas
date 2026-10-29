-- ObraBuilder: notifications for the builder (bell + push) and the watcher's last seen state.
ALTER TABLE "BuilderMember" ADD COLUMN IF NOT EXISTS "notificationsSeenAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "BuilderNotification" (
  "id" UUID NOT NULL,
  "builderAccountId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "url" TEXT,
  "companyName" TEXT,
  "organizationId" UUID,
  "workOrderId" UUID,
  "requestId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuilderNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuilderNotification_builderAccountId_fkey" FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BuilderNotification_builderAccountId_createdAt_idx" ON "BuilderNotification"("builderAccountId", "createdAt");

CREATE TABLE IF NOT EXISTS "BuilderJobWatch" (
  "id" UUID NOT NULL,
  "builderAccountId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "status" TEXT,
  "scheduledStart" TIMESTAMP(3),
  "photos" INTEGER NOT NULL DEFAULT 0,
  "reports" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuilderJobWatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuilderJobWatch_builderAccountId_fkey" FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BuilderJobWatch_builderAccountId_key_key" ON "BuilderJobWatch"("builderAccountId", "key");

CREATE TABLE IF NOT EXISTS "BuilderPushSubscription" (
  "id" UUID NOT NULL,
  "builderAccountId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuilderPushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuilderPushSubscription_builderAccountId_fkey" FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BuilderPushSubscription_endpoint_key" ON "BuilderPushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "BuilderPushSubscription_builderAccountId_idx" ON "BuilderPushSubscription"("builderAccountId");
