-- Four unit rates on pricing catalog: Particular, Builder, Contractor, Loja.
ALTER TABLE "PricingItem" ADD COLUMN IF NOT EXISTS "priceParticular" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PricingItem" ADD COLUMN IF NOT EXISTS "priceBuilder" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PricingItem" ADD COLUMN IF NOT EXISTS "priceContractor" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PricingItem" ADD COLUMN IF NOT EXISTS "priceLoja" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill from legacy min/max/partner columns.
UPDATE "PricingItem"
SET
  "priceLoja" = COALESCE(NULLIF("priceMin", 0), NULLIF("price", 0), 0),
  "priceParticular" = COALESCE(NULLIF("priceMax", 0), NULLIF("priceMin", 0), NULLIF("price", 0), 0),
  "priceBuilder" = COALESCE("partnerPrice", NULLIF("priceMin", 0), NULLIF("price", 0), 0),
  "priceContractor" = COALESCE("partnerPrice", NULLIF("priceMin", 0), NULLIF("price", 0), 0)
WHERE
  "priceParticular" = 0
  AND "priceBuilder" = 0
  AND "priceContractor" = 0
  AND "priceLoja" = 0;
