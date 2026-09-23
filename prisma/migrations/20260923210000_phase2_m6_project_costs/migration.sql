-- Phase 2 M6: project costs (budget freeze, materials, expenses, labor)

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "budgetFrozenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "budgetedMaterial" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "budgetedLabor" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "budgetedOther" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ProjectBudgetLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "quoteLineItemId" UUID,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
  "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectBudgetLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LaborRate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "userId" UUID,
  "roleKey" TEXT,
  "label" TEXT,
  "hourlyRate" DECIMAL(12,2) NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LaborRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LaborEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "userId" UUID,
  "visitId" UUID,
  "workDate" DATE NOT NULL,
  "hours" DECIMAL(8,2) NOT NULL,
  "rateSnapshot" DECIMAL(12,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LaborEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MaterialOrder" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "sku" TEXT,
  "vendor" TEXT,
  "quantityOrdered" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "quantityReceived" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "quantityUsed" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ordered',
  "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Expense" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "projectId" UUID,
  "materialOrderId" UUID,
  "quoteLineItemId" UUID,
  "category" TEXT NOT NULL DEFAULT 'other',
  "description" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "incurredOn" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectBudgetLine_organizationId_idx" ON "ProjectBudgetLine"("organizationId");
CREATE INDEX IF NOT EXISTS "ProjectBudgetLine_projectId_idx" ON "ProjectBudgetLine"("projectId");
CREATE INDEX IF NOT EXISTS "LaborRate_organizationId_idx" ON "LaborRate"("organizationId");
CREATE INDEX IF NOT EXISTS "LaborRate_organizationId_userId_idx" ON "LaborRate"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "LaborRate_organizationId_roleKey_idx" ON "LaborRate"("organizationId", "roleKey");
CREATE INDEX IF NOT EXISTS "LaborEntry_organizationId_idx" ON "LaborEntry"("organizationId");
CREATE INDEX IF NOT EXISTS "LaborEntry_projectId_idx" ON "LaborEntry"("projectId");
CREATE INDEX IF NOT EXISTS "LaborEntry_userId_idx" ON "LaborEntry"("userId");
CREATE INDEX IF NOT EXISTS "LaborEntry_visitId_idx" ON "LaborEntry"("visitId");
CREATE INDEX IF NOT EXISTS "MaterialOrder_organizationId_idx" ON "MaterialOrder"("organizationId");
CREATE INDEX IF NOT EXISTS "MaterialOrder_projectId_idx" ON "MaterialOrder"("projectId");
CREATE INDEX IF NOT EXISTS "MaterialOrder_organizationId_status_idx" ON "MaterialOrder"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Expense_organizationId_idx" ON "Expense"("organizationId");
CREATE INDEX IF NOT EXISTS "Expense_projectId_idx" ON "Expense"("projectId");
CREATE INDEX IF NOT EXISTS "Expense_materialOrderId_idx" ON "Expense"("materialOrderId");
CREATE INDEX IF NOT EXISTS "Expense_quoteLineItemId_idx" ON "Expense"("quoteLineItemId");

DO $$ BEGIN
  ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_quoteLineItemId_fkey"
    FOREIGN KEY ("quoteLineItemId") REFERENCES "QuoteLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LaborRate" ADD CONSTRAINT "LaborRate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LaborRate" ADD CONSTRAINT "LaborRate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LaborEntry" ADD CONSTRAINT "LaborEntry_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LaborEntry" ADD CONSTRAINT "LaborEntry_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LaborEntry" ADD CONSTRAINT "LaborEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LaborEntry" ADD CONSTRAINT "LaborEntry_visitId_fkey"
    FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MaterialOrder" ADD CONSTRAINT "MaterialOrder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MaterialOrder" ADD CONSTRAINT "MaterialOrder_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_materialOrderId_fkey"
    FOREIGN KEY ("materialOrderId") REFERENCES "MaterialOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_quoteLineItemId_fkey"
    FOREIGN KEY ("quoteLineItemId") REFERENCES "QuoteLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ProjectBudgetLine', 'LaborRate', 'LaborEntry', 'MaterialOrder', 'Expense']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("organizationId"::text = current_setting(''app.current_tenant_id'', true))
         WITH CHECK ("organizationId"::text = current_setting(''app.current_tenant_id'', true))',
      tbl
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
