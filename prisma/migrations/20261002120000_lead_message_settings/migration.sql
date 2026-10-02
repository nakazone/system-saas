-- Configurações › Mensagens padrão por fase do pipeline (e-mail / SMS).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "leadMessageSettings" JSONB;
