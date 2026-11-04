-- ObraCam job phases (Delivery, Scan, Installation, Sand & Finish, Walk Through).
-- Holds only a manual correction; otherwise the phase is derived from the photo date and the job dates on read.
ALTER TABLE "JobMedia" ADD COLUMN "phase" TEXT;
