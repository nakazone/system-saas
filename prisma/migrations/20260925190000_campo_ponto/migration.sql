-- Campo ponto: live shifts + activity segments for field workers

CREATE TABLE IF NOT EXISTS "CampoShift" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "workDate" DATE NOT NULL,
  "clockInAt" TIMESTAMP(3) NOT NULL,
  "clockOutAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampoShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CampoShift_organizationId_userId_workDate_key"
  ON "CampoShift"("organizationId", "userId", "workDate");
CREATE INDEX IF NOT EXISTS "CampoShift_organizationId_idx" ON "CampoShift"("organizationId");
CREATE INDEX IF NOT EXISTS "CampoShift_userId_status_idx" ON "CampoShift"("userId", "status");
CREATE INDEX IF NOT EXISTS "CampoShift_organizationId_status_idx" ON "CampoShift"("organizationId", "status");

CREATE TABLE IF NOT EXISTS "CampoSegment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "activityKind" TEXT NOT NULL,
  "workOrderId" UUID,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampoSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CampoSegment_organizationId_idx" ON "CampoSegment"("organizationId");
CREATE INDEX IF NOT EXISTS "CampoSegment_shiftId_idx" ON "CampoSegment"("shiftId");
CREATE INDEX IF NOT EXISTS "CampoSegment_workOrderId_idx" ON "CampoSegment"("workOrderId");
CREATE INDEX IF NOT EXISTS "CampoSegment_shiftId_endedAt_idx" ON "CampoSegment"("shiftId", "endedAt");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Organization') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShift_organizationId_fkey') THEN
      ALTER TABLE "CampoShift"
        ADD CONSTRAINT "CampoShift_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoSegment_organizationId_fkey') THEN
      ALTER TABLE "CampoSegment"
        ADD CONSTRAINT "CampoSegment_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoShift_userId_fkey') THEN
      ALTER TABLE "CampoShift"
        ADD CONSTRAINT "CampoShift_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'CampoShift') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoSegment_shiftId_fkey') THEN
      ALTER TABLE "CampoSegment"
        ADD CONSTRAINT "CampoSegment_shiftId_fkey"
        FOREIGN KEY ("shiftId") REFERENCES "CampoShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'WorkOrder') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampoSegment_workOrderId_fkey') THEN
      ALTER TABLE "CampoSegment"
        ADD CONSTRAINT "CampoSegment_workOrderId_fkey"
        FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;
