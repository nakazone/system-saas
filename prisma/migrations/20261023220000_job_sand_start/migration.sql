-- Second project start when a job covers Installation and Sand & Finish.
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "sandScheduledStart" TIMESTAMP(3);
