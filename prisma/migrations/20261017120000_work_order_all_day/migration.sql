-- Jobs: all-day start (no specific clock time) for the agenda.
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "allDay" BOOLEAN NOT NULL DEFAULT false;
