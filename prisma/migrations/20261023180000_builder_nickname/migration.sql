-- Short calendar label for a builder (e.g. CFC).
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "nickname" TEXT;
