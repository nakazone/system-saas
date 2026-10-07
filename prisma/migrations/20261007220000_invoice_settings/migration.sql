-- AlterTable
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "invoiceSettings" JSONB;
