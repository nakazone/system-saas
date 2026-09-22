-- IDs de eventos no Google Calendar (CRM → Google). Rode uma vez na MySQL.
-- project_schedules: eventos all-day
-- visits: eventos com hora

ALTER TABLE project_schedules
  ADD COLUMN google_calendar_event_id VARCHAR(255) NULL DEFAULT NULL
  COMMENT 'Google Calendar event id';

ALTER TABLE visits
  ADD COLUMN google_calendar_event_id VARCHAR(255) NULL DEFAULT NULL
  COMMENT 'Google Calendar event id';
