-- Dumpster / Storage opcionais no cadastro de Builder e Loja.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "dumpsterStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "dumpsterNotes" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "storageStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "storageNotes" TEXT;
