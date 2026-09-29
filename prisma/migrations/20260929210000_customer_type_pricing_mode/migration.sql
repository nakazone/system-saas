-- Align customer types with Tabela de Valores + pricing mode (table vs custom).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "pricingMode" TEXT NOT NULL DEFAULT 'table';

UPDATE "Customer"
SET "customerType" = CASE lower("customerType")
  WHEN 'residential' THEN 'particular'
  WHEN 'customer' THEN 'particular'
  WHEN 'commercial' THEN 'loja'
  WHEN 'property_manager' THEN 'particular'
  WHEN 'investor' THEN 'particular'
  WHEN 'builder' THEN 'builder'
  WHEN 'contractor' THEN 'contractor'
  WHEN 'loja' THEN 'loja'
  WHEN 'particular' THEN 'particular'
  ELSE 'particular'
END
WHERE lower("customerType") NOT IN ('particular', 'builder', 'contractor', 'loja');

ALTER TABLE "Customer" ALTER COLUMN "customerType" SET DEFAULT 'particular';
