-- Builder measurements: stairs (treads, risers, nosings) and vents measured on site.
CREATE TABLE "BuilderMeasurement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "builderAccountId" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "community" TEXT,
    "lot" TEXT,
    "notes" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByMemberId" UUID NOT NULL,
    "updatedByMemberId" UUID,
    "completedByMemberId" UUID,
    "completedAt" TIMESTAMP(3),
    "log" JSONB NOT NULL DEFAULT '[]',
    "usedAt" TIMESTAMP(3),
    "organizationId" UUID,
    "workOrderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuilderMeasurement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuilderMeasurement_builderAccountId_addressKey_idx" ON "BuilderMeasurement"("builderAccountId", "addressKey");
CREATE INDEX "BuilderMeasurement_builderAccountId_status_idx" ON "BuilderMeasurement"("builderAccountId", "status");
ALTER TABLE "BuilderMeasurement" ADD CONSTRAINT "BuilderMeasurement_builderAccountId_fkey"
  FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "BuilderMeasurement" TO app_user;
