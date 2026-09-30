-- Configurações › Orçamentos: numbering, client-view defaults and the
-- company owner signature (used by the quote builder).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "quoteNumberPrefix" TEXT NOT NULL DEFAULT 'Q-';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "quoteNextNumber" INTEGER;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "quoteSettings" JSONB;
