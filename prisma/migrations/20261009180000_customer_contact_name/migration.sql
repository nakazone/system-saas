-- Pessoa de contato (responsável) para clientes Builder / Loja.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "contactName" TEXT;
