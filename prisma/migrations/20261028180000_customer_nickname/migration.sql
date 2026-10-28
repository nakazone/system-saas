-- Short name shown on the calendar for builder customers.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "nickname" TEXT;
