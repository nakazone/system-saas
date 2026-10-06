-- Field Quote (módulo extra): medição + orçamento no local, feito no celular.
CREATE TABLE IF NOT EXISTS "FieldQuote" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "leadId" UUID,
  "meetingId" UUID,
  "quoteId" UUID,
  "createdById" UUID,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "clientName" TEXT NOT NULL,
  "clientPhone" TEXT,
  "clientEmail" TEXT,
  "address" TEXT,
  "customerType" TEXT NOT NULL DEFAULT 'particular',
  "data" JSONB,
  "totalSqft" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "FieldQuote_organizationId_idx" ON "FieldQuote"("organizationId");
CREATE INDEX IF NOT EXISTS "FieldQuote_organizationId_updatedAt_idx" ON "FieldQuote"("organizationId", "updatedAt");
CREATE INDEX IF NOT EXISTS "FieldQuote_leadId_idx" ON "FieldQuote"("leadId");
CREATE INDEX IF NOT EXISTS "FieldQuote_quoteId_idx" ON "FieldQuote"("quoteId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldQuote_organizationId_fkey') THEN
    ALTER TABLE "FieldQuote" ADD CONSTRAINT "FieldQuote_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldQuote_leadId_fkey') THEN
    ALTER TABLE "FieldQuote" ADD CONSTRAINT "FieldQuote_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldQuote_quoteId_fkey') THEN
    ALTER TABLE "FieldQuote" ADD CONSTRAINT "FieldQuote_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldQuote_meetingId_fkey') THEN
    ALTER TABLE "FieldQuote" ADD CONSTRAINT "FieldQuote_meetingId_fkey"
      FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldQuote_createdById_fkey') THEN
    ALTER TABLE "FieldQuote" ADD CONSTRAINT "FieldQuote_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE "FieldQuote" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "FieldQuote" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "FieldQuote";
  CREATE POLICY tenant_isolation ON "FieldQuote"
    USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
    WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));
END $$;
