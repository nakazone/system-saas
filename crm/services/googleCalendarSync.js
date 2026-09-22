/**
 * CRM → Google Calendar: project_schedules (all-day) e visits (timed).
 */
import { getCalendarApi, getCalendarId, getCalendarTimeZone, isGoogleCalendarConfigured, exclusiveEndDateAfterInclusiveEnd } from '../lib/googleCalendar.js';
import { isBadFieldError } from '../lib/mysqlSchemaErrors.js';

const CRM_BASE = (process.env.PUBLIC_CRM_URL || '').replace(/\/$/, '');

function visitDurationMinutes() {
  const n = parseInt(process.env.GOOGLE_CALENDAR_VISIT_DURATION_MINUTES, 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/** dateTime RFC3339 local sem offset + timeZone na API */
function mysqlScheduledToStartDateTime(scheduledAt) {
  if (!scheduledAt) return null;
  const s = String(scheduledAt).trim().replace('T', ' ');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const sec = m[3] != null ? m[3] : '00';
  return `${m[1]}T${m[2]}:${sec}`;
}

function addMinutesWallClock(dateTimeStr, addMinutes) {
  const m = dateTimeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return dateTimeStr;
  const [, ys, mos, ds, hs, mis, secs] = m;
  let minsFromMidnight = parseInt(hs, 10) * 60 + parseInt(mis, 10) + addMinutes;
  let carryDays = Math.floor(minsFromMidnight / (24 * 60));
  minsFromMidnight %= 24 * 60;
  if (minsFromMidnight < 0) {
    carryDays -= 1;
    minsFromMidnight += 24 * 60;
  }
  const nh = Math.floor(minsFromMidnight / 60);
  const nmi = minsFromMidnight % 60;
  const y = parseInt(ys, 10);
  const mo = parseInt(mos, 10);
  const d = parseInt(ds, 10);
  const ud = new Date(Date.UTC(y, mo - 1, d + carryDays, nh, nmi, parseInt(secs, 10)));
  const pad = (n) => String(n).padStart(2, '0');
  return `${ud.getUTCFullYear()}-${pad(ud.getUTCMonth() + 1)}-${pad(ud.getUTCDate())}T${pad(ud.getUTCHours())}:${pad(ud.getUTCMinutes())}:${pad(ud.getUTCSeconds())}`;
}

async function saveGoogleEventId(pool, table, rowId, eventId) {
  try {
    await pool.execute(`UPDATE ${table} SET google_calendar_event_id = ? WHERE id = ?`, [eventId, rowId]);
  } catch (e) {
    if (isBadFieldError(e)) {
      console.warn(
        '[google-calendar] Coluna google_calendar_event_id em falta. Rode: database/add-google-calendar-event-ids.sql'
      );
      return;
    }
    throw e;
  }
}

async function clearGoogleEventId(pool, table, rowId) {
  try {
    await pool.execute(`UPDATE ${table} SET google_calendar_event_id = NULL WHERE id = ?`, [rowId]);
  } catch (e) {
    if (isBadFieldError(e)) return;
    throw e;
  }
}

async function deleteEventIfAny(calendar, eventId) {
  if (!eventId) return;
  try {
    await calendar.events.delete({ calendarId: getCalendarId(), eventId });
  } catch (e) {
    const code = e.code || e.response?.status;
    if (code === 404 || e.response?.status === 404) return;
    throw e;
  }
}

export async function syncProjectScheduleById(pool, scheduleId) {
  if (!isGoogleCalendarConfigured() || !pool) return;

  const [rows] = await pool.query(
    `SELECT ps.*, c.name as crew_name, p.project_number, pr.name as project_name
     FROM project_schedules ps
     JOIN crews c ON ps.crew_id = c.id
     JOIN projects p ON ps.project_id = p.id
     LEFT JOIN leads pr ON p.lead_id = pr.id
     WHERE ps.id = ?`,
    [scheduleId]
  );
  if (!rows.length) return;

  const ps = rows[0];
  const calendar = getCalendarApi();
  const calId = getCalendarId();
  const extId = ps.google_calendar_event_id || null;

  if (ps.status === 'cancelled') {
    await deleteEventIfAny(calendar, extId);
    await clearGoogleEventId(pool, 'project_schedules', scheduleId);
    return;
  }

  const startD = String(ps.start_date).slice(0, 10);
  const endD = String(ps.end_date).slice(0, 10);
  const title = `[${ps.crew_name || 'Crew'}] #${ps.project_number || ps.project_id} ${ps.project_name || 'Project'}`.trim();
  const lines = [
    'Senior Floors — Smart Schedule (projeto)',
    `Crew: ${ps.crew_name || '—'}`,
    `Projeto: #${ps.project_number || ps.project_id} ${ps.project_name || ''}`,
    `Datas: ${startD} → ${endD}`,
    `Estado: ${ps.status || 'scheduled'}`,
    `Prioridade: ${ps.priority || 'normal'}`,
  ];
  if (CRM_BASE) lines.push(`CRM: ${CRM_BASE}/dashboard.html`);

  const body = {
    summary: title.slice(0, 1024),
    description: lines.join('\n'),
    extendedProperties: {
      private: {
        sf_kind: 'project_schedule',
        sf_id: String(scheduleId),
      },
    },
    start: { date: startD },
    end: { date: exclusiveEndDateAfterInclusiveEnd(endD) },
  };

  try {
    if (extId) {
      await calendar.events.update({
        calendarId: calId,
        eventId: extId,
        requestBody: body,
      });
    } else {
      const { data } = await calendar.events.insert({
        calendarId: calId,
        requestBody: body,
      });
      if (data.id) await saveGoogleEventId(pool, 'project_schedules', scheduleId, data.id);
    }
  } catch (e) {
    console.error('[google-calendar] sync project_schedule', scheduleId, e.message || e);
  }
}

export async function syncVisitById(pool, visitId) {
  if (!isGoogleCalendarConfigured() || !pool) return;

  const [rows] = await pool.query(
    `SELECT v.*, l.name as lead_name
     FROM visits v
     LEFT JOIN leads l ON v.lead_id = l.id
     WHERE v.id = ?`,
    [visitId]
  );
  if (!rows.length) return;

  const v = rows[0];
  const calendar = getCalendarApi();
  const calId = getCalendarId();
  const tz = getCalendarTimeZone();
  const extId = v.google_calendar_event_id || null;

  if (v.status === 'cancelled') {
    await deleteEventIfAny(calendar, extId);
    await clearGoogleEventId(pool, 'visits', visitId);
    return;
  }

  const startDt = mysqlScheduledToStartDateTime(v.scheduled_at);
  if (!startDt) {
    console.warn('[google-calendar] visit', visitId, 'sem scheduled_at válido');
    return;
  }

  const dur = visitDurationMinutes();
  const endDt = addMinutesWallClock(startDt, dur);

  const title = `Visita: ${v.lead_name || 'Lead'}`.slice(0, 1024);
  const addr = [v.address, v.city, v.zipcode].filter(Boolean).join(', ');
  const lines = [
    'Senior Floors — visita de lead',
    `Lead: ${v.lead_name || '—'}`,
    `Estado: ${v.status || 'scheduled'}`,
    v.notes ? `Notas: ${String(v.notes).slice(0, 500)}` : null,
  ].filter(Boolean);
  if (CRM_BASE) lines.push(`CRM: ${CRM_BASE}/lead-detail.html?id=${v.lead_id}`);

  const body = {
    summary: title,
    description: lines.join('\n'),
    location: addr || undefined,
    extendedProperties: {
      private: {
        sf_kind: 'visit',
        sf_id: String(visitId),
      },
    },
    start: { dateTime: startDt, timeZone: tz },
    end: { dateTime: endDt, timeZone: tz },
  };

  try {
    if (extId) {
      await calendar.events.update({
        calendarId: calId,
        eventId: extId,
        requestBody: body,
      });
    } else {
      const { data } = await calendar.events.insert({
        calendarId: calId,
        requestBody: body,
      });
      if (data.id) await saveGoogleEventId(pool, 'visits', visitId, data.id);
    }
  } catch (e) {
    console.error('[google-calendar] sync visit', visitId, e.message || e);
  }
}
