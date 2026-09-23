-- Phase 2 M2: Quotes v2 — rooms, options, public tokens, org quote settings

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "defaultQuoteTerms" TEXT,
  ADD COLUMN IF NOT EXISTS "quoteTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paymentInstructions" TEXT;

ALTER TABLE "Quote"
  ADD COLUMN IF NOT EXISTS "propertyId" UUID,
  ADD COLUMN IF NOT EXISTS "salespersonId" UUID,
  ADD COLUMN IF NOT EXISTS "discountType" TEXT,
  ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "clientMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "clientView" JSONB,
  ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "selectedOptionGroupId" UUID,
  ADD COLUMN IF NOT EXISTS "archiveReason" TEXT,
  ADD COLUMN IF NOT EXISTS "signatureUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "signedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedIp" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedUserAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "changeRequestNote" TEXT,
  ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);

-- Status vocabulary migration
UPDATE "Quote" SET status = 'approved' WHERE status = 'accepted';
UPDATE "Quote" SET status = 'archived' WHERE status = 'rejected';
UPDATE "Quote" SET status = 'approved' WHERE status = 'invoiced';

ALTER TABLE "QuoteLineItem"
  ADD COLUMN IF NOT EXISTS "roomId" UUID,
  ADD COLUMN IF NOT EXISTS "optionGroupId" UUID,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isOptional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isSelected" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "QuoteRoom" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "quoteId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "areaSqft" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "QuoteRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuoteOptionGroup" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "quoteId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "flooringType" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "QuoteOptionGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuoteAddOn" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'each',
  "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteAddOn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PublicAccessToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "viewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Quote_organizationId_salespersonId_idx" ON "Quote"("organizationId", "salespersonId");
CREATE INDEX IF NOT EXISTS "QuoteRoom_organizationId_idx" ON "QuoteRoom"("organizationId");
CREATE INDEX IF NOT EXISTS "QuoteRoom_quoteId_idx" ON "QuoteRoom"("quoteId");
CREATE INDEX IF NOT EXISTS "QuoteOptionGroup_organizationId_idx" ON "QuoteOptionGroup"("organizationId");
CREATE INDEX IF NOT EXISTS "QuoteOptionGroup_quoteId_idx" ON "QuoteOptionGroup"("quoteId");
CREATE INDEX IF NOT EXISTS "QuoteLineItem_roomId_idx" ON "QuoteLineItem"("roomId");
CREATE INDEX IF NOT EXISTS "QuoteLineItem_optionGroupId_idx" ON "QuoteLineItem"("optionGroupId");
CREATE INDEX IF NOT EXISTS "QuoteAddOn_organizationId_idx" ON "QuoteAddOn"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "PublicAccessToken_tokenHash_key" ON "PublicAccessToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PublicAccessToken_organizationId_idx" ON "PublicAccessToken"("organizationId");
CREATE INDEX IF NOT EXISTS "PublicAccessToken_organizationId_entityType_entityId_idx"
  ON "PublicAccessToken"("organizationId", "entityType", "entityId");

DO $$ BEGIN
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_salespersonId_fkey"
    FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteRoom" ADD CONSTRAINT "QuoteRoom_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteRoom" ADD CONSTRAINT "QuoteRoom_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteOptionGroup" ADD CONSTRAINT "QuoteOptionGroup_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteOptionGroup" ADD CONSTRAINT "QuoteOptionGroup_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "QuoteRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_optionGroupId_fkey"
    FOREIGN KEY ("optionGroupId") REFERENCES "QuoteOptionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuoteAddOn" ADD CONSTRAINT "QuoteAddOn_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PublicAccessToken" ADD CONSTRAINT "PublicAccessToken_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed default add-ons for existing orgs
INSERT INTO "QuoteAddOn" ("id", "organizationId", "name", "description", "unit", "unitCost", "unitPrice", "sortOrder")
SELECT gen_random_uuid(), o.id, a.name, a.description, a.unit, a.unit_cost, a.unit_price, a.sort_order
FROM "Organization" o
CROSS JOIN (VALUES
  ('Existing floor removal', 'Remove existing flooring', 'sqft', 0.50, 1.75, 1),
  ('New baseboards', 'Supply and install new baseboards', 'lf', 2.00, 6.50, 2),
  ('Stair tread finish', 'Finish per stair tread', 'each', 15.00, 45.00, 3),
  ('Move furniture', 'Move furniture within the work area', 'each', 50.00, 150.00, 4),
  ('Subfloor leveling', 'Level subfloor as needed', 'sqft', 1.00, 3.25, 5)
) AS a(name, description, unit, unit_cost, unit_price, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "QuoteAddOn" qa WHERE qa."organizationId" = o.id AND qa.name = a.name
);

-- Migrate plaintext Quote.publicToken → hashed PublicAccessToken (sha256 hex of token)
INSERT INTO "PublicAccessToken" (
  "id", "organizationId", "entityType", "entityId", "tokenHash", "expiresAt", "createdAt"
)
SELECT
  gen_random_uuid(),
  q."organizationId",
  'quote',
  q.id,
  encode(digest(q."publicToken", 'sha256'), 'hex'),
  COALESCE(q."createdAt" + INTERVAL '90 days', NOW() + INTERVAL '90 days'),
  NOW()
FROM "Quote" q
WHERE q."publicToken" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PublicAccessToken" t
    WHERE t."entityType" = 'quote' AND t."entityId" = q.id AND t."revokedAt" IS NULL
  );

-- Lookup by hashed token (and legacy plaintext Quote.publicToken dual-read)
CREATE OR REPLACE FUNCTION get_public_access_by_token(token text)
RETURNS TABLE(organization_id uuid, entity_type text, entity_id uuid, token_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t."organizationId", t."entityType", t."entityId", t.id
  FROM "PublicAccessToken" t
  WHERE t."tokenHash" = encode(digest(token, 'sha256'), 'hex')
    AND t."revokedAt" IS NULL
    AND t."expiresAt" > NOW()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_quote_org_by_public_token(token text)
RETURNS TABLE(quote_id uuid, organization_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.entity_id, p.organization_id
  FROM get_public_access_by_token(token) p
  WHERE p.entity_type = 'quote'
  UNION ALL
  SELECT q.id, q."organizationId"
  FROM "Quote" q
  WHERE q."publicToken" = token
    AND NOT EXISTS (
      SELECT 1 FROM get_public_access_by_token(token) x WHERE x.entity_type = 'quote'
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_public_access_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_access_by_token(text) TO app_user;
REVOKE ALL ON FUNCTION get_quote_org_by_public_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_quote_org_by_public_token(text) TO app_user;

-- RLS
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['QuoteRoom', 'QuoteOptionGroup', 'QuoteAddOn', 'PublicAccessToken']
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
