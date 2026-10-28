-- ObraBuilder v2: builder contact details, member title, measurement location, agreed prices per company.
ALTER TABLE "BuilderAccount"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "billingEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "addressLine1" TEXT,
  ADD COLUMN IF NOT EXISTS "addressLine2" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "postalCode" TEXT,
  ADD COLUMN IF NOT EXISTS "licenseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "BuilderMember" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "BuilderMeasurement"
  ADD COLUMN IF NOT EXISTS "geoLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "geoLng" DOUBLE PRECISION;

CREATE TABLE "BuilderPriceItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "builderAccountId" UUID NOT NULL,
    "builderLinkId" UUID NOT NULL,
    "pricingItemId" UUID,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "price" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuilderPriceItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuilderPriceItem_builderAccountId_builderLinkId_idx" ON "BuilderPriceItem"("builderAccountId", "builderLinkId");
ALTER TABLE "BuilderPriceItem" ADD CONSTRAINT "BuilderPriceItem_builderAccountId_fkey"
  FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "BuilderPriceItem" TO app_user;
