CREATE TABLE "VirtualAgent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "avatarKey" TEXT NOT NULL DEFAULT 'avatar-1',
    "description" TEXT NOT NULL,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualAgent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VirtualAgent_organizationId_key_key" ON "VirtualAgent"("organizationId", "key");
CREATE INDEX "VirtualAgent_organizationId_department_enabled_idx" ON "VirtualAgent"("organizationId", "department", "enabled");

ALTER TABLE "VirtualAgent"
ADD CONSTRAINT "VirtualAgent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
