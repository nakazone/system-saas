ALTER TABLE "Builder"
  ADD COLUMN IF NOT EXISTS "customerId" UUID;

CREATE INDEX IF NOT EXISTS "Builder_organizationId_customerId_idx"
  ON "Builder"("organizationId", "customerId");

DO $$ BEGIN
  ALTER TABLE "Builder"
    ADD CONSTRAINT "Builder_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
