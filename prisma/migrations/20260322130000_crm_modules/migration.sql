-- CRM module expansion: pipeline slugs, quotes/invoices, builders, pricing, ERP, payroll

-- PipelineStage
ALTER TABLE "PipelineStage" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "PipelineStage" ADD COLUMN IF NOT EXISTS "isClosed" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_organizationId_slug_key" ON "PipelineStage"("organizationId", "slug");

-- Backfill stage metadata for existing tenants
UPDATE "PipelineStage"
SET slug = lower(regexp_replace(trim(name), '\s+', '_', 'g'))
WHERE slug IS NULL OR slug = '';

UPDATE "PipelineStage"
SET "isClosed" = true
WHERE lower(name) IN ('won', 'lost', 'closed won', 'closed lost', 'closed_won', 'closed_lost');

-- Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customerType" TEXT NOT NULL DEFAULT 'residential';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "company" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Quote
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "leadId" UUID;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "builderId" UUID;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "quoteNumber" TEXT;
ALTER TABLE "Quote" ALTER COLUMN "flooringType" SET DEFAULT 'hardwood';
ALTER TABLE "Quote" ALTER COLUMN "areaSqft" SET DEFAULT 0;
ALTER TABLE "Quote" ALTER COLUMN "wastePercent" SET DEFAULT 0;
ALTER TABLE "Quote" ALTER COLUMN "materialCost" SET DEFAULT 0;
ALTER TABLE "Quote" ALTER COLUMN "laborCost" SET DEFAULT 0;
ALTER TABLE "Quote" ALTER COLUMN "materialMarkup" SET DEFAULT 0;
ALTER TABLE "Quote" ALTER COLUMN "laborMarkup" SET DEFAULT 0;
ALTER TABLE "Quote" ALTER COLUMN "subtotal" SET DEFAULT 0;
ALTER TABLE "Quote" ALTER COLUMN "total" SET DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "terms" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "serviceType" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "payload" JSONB;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "invoicePdfPath" TEXT;
CREATE INDEX IF NOT EXISTS "Quote_organizationId_status_idx" ON "Quote"("organizationId", "status");

-- QuoteLineItem
ALTER TABLE "QuoteLineItem" ADD COLUMN IF NOT EXISTS "itemType" TEXT NOT NULL DEFAULT 'service';
ALTER TABLE "QuoteLineItem" ADD COLUMN IF NOT EXISTS "productId" UUID;
ALTER TABLE "QuoteLineItem" ADD COLUMN IF NOT EXISTS "catalogId" UUID;
ALTER TABLE "QuoteLineItem" ADD COLUMN IF NOT EXISTS "meta" JSONB;

-- Builder
CREATE TABLE IF NOT EXISTS "Builder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "type" TEXT NOT NULL DEFAULT 'builder',
    "status" TEXT NOT NULL DEFAULT 'active',
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Builder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Builder_organizationId_idx" ON "Builder"("organizationId");
CREATE INDEX IF NOT EXISTS "Builder_organizationId_status_idx" ON "Builder"("organizationId", "status");

-- PricingItem
CREATE TABLE IF NOT EXISTS "PricingItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'installation',
    "unit" TEXT NOT NULL DEFAULT 'sq_ft',
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "priceMin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "priceMax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "partnerPrice" DECIMAL(12,2),
    "description" TEXT,
    "notes" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PricingItem_organizationId_idx" ON "PricingItem"("organizationId");

-- Supplier
CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Supplier_organizationId_idx" ON "Supplier"("organizationId");

-- Product
CREATE TABLE IF NOT EXISTS "Product" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierId" UUID,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Hardwood',
    "unitType" TEXT NOT NULL DEFAULT 'sq_ft',
    "costPrice" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "sku" TEXT,
    "description" TEXT,
    "stockQty" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Product_organizationId_idx" ON "Product"("organizationId");
CREATE INDEX IF NOT EXISTS "Product_organizationId_category_idx" ON "Product"("organizationId", "category");

-- CategoryMargin
CREATE TABLE IF NOT EXISTS "CategoryMargin" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "marginPercentage" DECIMAL(8,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CategoryMargin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CategoryMargin_organizationId_category_key" ON "CategoryMargin"("organizationId", "category");
CREATE INDEX IF NOT EXISTS "CategoryMargin_organizationId_idx" ON "CategoryMargin"("organizationId");

-- QuoteCatalogItem
CREATE TABLE IF NOT EXISTS "QuoteCatalogItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" TEXT,
    "unitType" TEXT NOT NULL DEFAULT 'sq_ft',
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteCatalogItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QuoteCatalogItem_organizationId_idx" ON "QuoteCatalogItem"("organizationId");

-- QuoteInvoice
CREATE TABLE IF NOT EXISTS "QuoteInvoice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "invoiceNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "pdfPath" TEXT,
    "notes" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteInvoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QuoteInvoice_organizationId_idx" ON "QuoteInvoice"("organizationId");
CREATE INDEX IF NOT EXISTS "QuoteInvoice_quoteId_idx" ON "QuoteInvoice"("quoteId");
CREATE INDEX IF NOT EXISTS "QuoteInvoice_organizationId_status_idx" ON "QuoteInvoice"("organizationId", "status");

-- InvoiceReceipt
CREATE TABLE IF NOT EXISTS "InvoiceReceipt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvoiceReceipt_organizationId_idx" ON "InvoiceReceipt"("organizationId");
CREATE INDEX IF NOT EXISTS "InvoiceReceipt_invoiceId_idx" ON "InvoiceReceipt"("invoiceId");

-- Project
CREATE TABLE IF NOT EXISTS "Project" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "builderId" UUID,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "address" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Project_organizationId_idx" ON "Project"("organizationId");

-- PayrollEmployee
CREATE TABLE IF NOT EXISTS "PayrollEmployee" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "roleTitle" TEXT,
    "payType" TEXT NOT NULL DEFAULT 'hourly',
    "hourlyRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollEmployee_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PayrollEmployee_organizationId_idx" ON "PayrollEmployee"("organizationId");

-- PayrollPeriod
CREATE TABLE IF NOT EXISTS "PayrollPeriod" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PayrollPeriod_organizationId_idx" ON "PayrollPeriod"("organizationId");

-- PayrollTimesheet
CREATE TABLE IF NOT EXISTS "PayrollTimesheet" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "projectId" UUID,
    "workDate" DATE NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollTimesheet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PayrollTimesheet_organizationId_idx" ON "PayrollTimesheet"("organizationId");
CREATE INDEX IF NOT EXISTS "PayrollTimesheet_periodId_idx" ON "PayrollTimesheet"("periodId");
CREATE INDEX IF NOT EXISTS "PayrollTimesheet_employeeId_idx" ON "PayrollTimesheet"("employeeId");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteInvoice" ADD CONSTRAINT "QuoteInvoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "QuoteInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PayrollTimesheet" ADD CONSTRAINT "PayrollTimesheet_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PayrollTimesheet" ADD CONSTRAINT "PayrollTimesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PayrollTimesheet" ADD CONSTRAINT "PayrollTimesheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Builder" ADD CONSTRAINT "Builder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PricingItem" ADD CONSTRAINT "PricingItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CategoryMargin" ADD CONSTRAINT "CategoryMargin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteCatalogItem" ADD CONSTRAINT "QuoteCatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteInvoice" ADD CONSTRAINT "QuoteInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PayrollEmployee" ADD CONSTRAINT "PayrollEmployee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PayrollTimesheet" ADD CONSTRAINT "PayrollTimesheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS for new tenant tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'Builder',
    'PricingItem',
    'Supplier',
    'Product',
    'CategoryMargin',
    'QuoteCatalogItem',
    'QuoteInvoice',
    'InvoiceReceipt',
    'Project',
    'PayrollEmployee',
    'PayrollPeriod',
    'PayrollTimesheet'
  ]
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
