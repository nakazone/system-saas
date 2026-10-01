-- Org-managed catalog lists (service categories, units)
CREATE TABLE IF NOT EXISTS "OrgCatalogItem" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgCatalogItem_organizationId_kind_key_key" UNIQUE ("organizationId", "kind", "key")
);

CREATE INDEX IF NOT EXISTS "OrgCatalogItem_organizationId_kind_idx"
  ON "OrgCatalogItem"("organizationId", "kind");
