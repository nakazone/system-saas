-- Per-customer overrides for PricingItem name/description (Tabela de Valores do cliente).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customPricingNotes" JSONB;
