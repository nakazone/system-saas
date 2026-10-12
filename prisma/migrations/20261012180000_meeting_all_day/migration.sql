-- Agenda: all-day appointments (compromissos / visitas).
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "allDay" BOOLEAN NOT NULL DEFAULT false;
