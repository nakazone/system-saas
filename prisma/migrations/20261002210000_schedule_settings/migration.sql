-- Schedule calendars (colors + custom agendas) and optional meeting calendar id.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "scheduleSettings" JSONB;
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "calendarId" UUID;
CREATE INDEX IF NOT EXISTS "Meeting_organizationId_calendarId_idx" ON "Meeting"("organizationId", "calendarId");
