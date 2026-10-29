ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "partnerPortalSettings" JSONB;
