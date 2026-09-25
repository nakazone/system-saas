-- Job service line items (sqft × unit price from pricing catalog)

CREATE TABLE IF NOT EXISTS "WorkOrderLineItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "pricingItemId" UUID,
  "serviceName" TEXT NOT NULL,
  "quantitySqft" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderLineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkOrderLineItem_organizationId_idx" ON "WorkOrderLineItem"("organizationId");
CREATE INDEX IF NOT EXISTS "WorkOrderLineItem_workOrderId_idx" ON "WorkOrderLineItem"("workOrderId");
CREATE INDEX IF NOT EXISTS "WorkOrderLineItem_pricingItemId_idx" ON "WorkOrderLineItem"("pricingItemId");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Organization') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderLineItem_organizationId_fkey') THEN
      ALTER TABLE "WorkOrderLineItem"
        ADD CONSTRAINT "WorkOrderLineItem_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'WorkOrder') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderLineItem_workOrderId_fkey') THEN
      ALTER TABLE "WorkOrderLineItem"
        ADD CONSTRAINT "WorkOrderLineItem_workOrderId_fkey"
        FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PricingItem') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkOrderLineItem_pricingItemId_fkey') THEN
      ALTER TABLE "WorkOrderLineItem"
        ADD CONSTRAINT "WorkOrderLineItem_pricingItemId_fkey"
        FOREIGN KEY ("pricingItemId") REFERENCES "PricingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org_id')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_setting') THEN
    ALTER TABLE "WorkOrderLineItem" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "WorkOrderLineItem" FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON "WorkOrderLineItem";
    BEGIN
      CREATE POLICY tenant_isolation ON "WorkOrderLineItem"
        USING ("organizationId" = current_org_id())
        WITH CHECK ("organizationId" = current_org_id());
    EXCEPTION WHEN undefined_function THEN
      CREATE POLICY tenant_isolation ON "WorkOrderLineItem"
        USING ("organizationId" = current_setting('app.current_tenant_id', true)::uuid)
        WITH CHECK ("organizationId" = current_setting('app.current_tenant_id', true)::uuid);
    END;
  END IF;
END $$;
