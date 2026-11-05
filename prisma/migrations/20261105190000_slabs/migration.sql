-- Countertops: slabs and remnants in the yard, reserved for a job and then used.
-- Tenant-scoped with RLS like JobRework.
CREATE TABLE "Slab" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'slab',
    "material" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "brand" TEXT,
    "finish" TEXT,
    "thicknessCm" INTEGER NOT NULL DEFAULT 3,
    "lengthIn" DECIMAL(7,2) NOT NULL,
    "widthIn" DECIMAL(7,2) NOT NULL,
    "serial" TEXT,
    "supplier" TEXT,
    "location" TEXT,
    "cost" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'available',
    "workOrderId" UUID,
    "reservedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "parentId" UUID,
    "photoUrl" TEXT,
    "photoKey" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Slab_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Slab_organizationId_status_idx" ON "Slab"("organizationId", "status");
CREATE INDEX "Slab_organizationId_workOrderId_idx" ON "Slab"("organizationId", "workOrderId");

ALTER TABLE "Slab" ADD CONSTRAINT "Slab_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Slab" ADD CONSTRAINT "Slab_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Slab" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Slab" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Slab"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Slab" TO app_user;
