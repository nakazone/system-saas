-- Optional client reference code. Displayed as "Name - code" without changing Customer.name.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "clientCode" TEXT;
