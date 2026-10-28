-- Track Installation and Sand & Finish as two finishes on the same job.
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "installationDoneAt" TIMESTAMP(3);
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "sandDoneAt" TIMESTAMP(3);
