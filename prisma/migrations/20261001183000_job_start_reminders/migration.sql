-- Job start reminders: dedupe timestamps for push + office auto-start.
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "startReminderSentAt" TIMESTAMP(3);
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "startNudgeSentAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WorkOrder_organizationId_status_scheduledStart_idx"
  ON "WorkOrder" ("organizationId", "status", "scheduledStart");
