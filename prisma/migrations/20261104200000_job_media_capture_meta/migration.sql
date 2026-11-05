-- Photo capture metadata for ObraCam: who took it, and where the time and GPS came from.
ALTER TABLE "JobMedia"
  ADD COLUMN "takenById" UUID,
  ADD COLUMN "takenAtSource" TEXT,
  ADD COLUMN "locationSource" TEXT,
  ADD COLUMN "cameraModel" TEXT;

ALTER TABLE "JobMedia"
  ADD CONSTRAINT "JobMedia_takenById_fkey"
  FOREIGN KEY ("takenById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "JobMedia_takenById_idx" ON "JobMedia"("takenById");
