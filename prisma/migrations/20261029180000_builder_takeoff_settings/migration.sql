-- Floor plan takeoff: waste % per floor type (ObraBuilder › Settings › Takeoff).
ALTER TABLE "BuilderAccount"
  ADD COLUMN IF NOT EXISTS "takeoffSettings" JSONB NOT NULL DEFAULT '{}';
