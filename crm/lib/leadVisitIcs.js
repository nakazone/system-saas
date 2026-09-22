/**
 * Gera ficheiro iCalendar (.ics) para visita de lead.
 */
import {
  buildLeadVisitDescription,
  buildLeadVisitLocation,
  buildLeadVisitSummary,
  snapToNextHalfHour,
} from './leadVisitCalendarFormat.js';

export { snapToNextHalfHour, buildLeadVisitDescription, buildLeadVisitLocation, buildLeadVisitSummary } from './leadVisitCalendarFormat.js';

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatIcsLocalDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * @param {object} lead
 * @param {{ start?: Date, durationMinutes?: number }} [options]
 */
export function buildLeadVisitIcs(lead, options = {}) {
  const start = options.start instanceof Date ? options.start : snapToNextHalfHour();
  const durationMinutes =
    typeof options.durationMinutes === 'number' && options.durationMinutes > 0
      ? options.durationMinutes
      : 60;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const summary = buildLeadVisitSummary(lead);
  const uid =
    'lead-visit-' + (lead?.id ? String(lead.id) : '0') + '-' + Date.now() + '@seniorfloors-crm';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Senior Floors CRM//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + formatIcsLocalDateTime(new Date()),
    'DTSTART:' + formatIcsLocalDateTime(start),
    'DTEND:' + formatIcsLocalDateTime(end),
    'SUMMARY;CHARSET=UTF-8:' + escapeIcsText(summary),
    'LOCATION;CHARSET=UTF-8:' + escapeIcsText(buildLeadVisitLocation(lead)),
    'DESCRIPTION;CHARSET=UTF-8:' + escapeIcsText(buildLeadVisitDescription(lead)),
    'STATUS:TENTATIVE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
