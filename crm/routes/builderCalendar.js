/**
 * Builder portal — calendar (confirmed visits + visit requests).
 */
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { assertBuilderOwnsProject } from '../lib/builderProjectAccess.js';
import { buildBuilderVisitScope } from '../lib/builderVisitScope.js';
import { notifyBuilder } from './builderNotifications.js';
import { adminNotifyEmail, sendBuilderNotification } from '../lib/builderNotify.js';
import { logBuilderActivity } from '../lib/builderActivityLog.js';

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toIcsDate(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;
}

function normalizeScheduledAt(v) {
  if (v === undefined || v === null) return null;
  let s = typeof v === 'string' ? v.trim() : String(v);
  if (!s) return null;
  if (s.includes('T')) {
    s = s.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
  }
  return s;
}

function buildAddressFromParts({ address, address_line1, address_line2, city, zipcode }) {
  if (address && String(address).trim()) return String(address).trim();
  const parts = [address_line1, address_line2, city, zipcode]
    .filter(Boolean)
    .map(String)
    .map((x) => x.trim());
  return parts.join(', ') || '';
}

export async function getBuilderCalendar(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;

    const scope = await buildBuilderVisitScope(pool, bid);
    let visitWhere = scope.where;
    const visitParams = [...scope.params];

    if (dateFrom) {
      visitWhere += ' AND DATE(v.scheduled_at) >= ?';
      visitParams.push(dateFrom);
    }
    if (dateTo) {
      visitWhere += ' AND DATE(v.scheduled_at) <= ?';
      visitParams.push(dateTo);
    }

    const hasProjectId = await columnExists(pool, 'visits', 'project_id');
    let visits = [];
    try {
      const [rows] = await pool.query(
        `SELECT v.id, v.lead_id, v.scheduled_at, v.address, v.status, v.notes,
                ${hasProjectId ? 'v.project_id,' : 'NULL AS project_id,'}
                l.name AS lead_name, p.name AS project_name
         FROM visits v
         LEFT JOIN leads l ON l.id = v.lead_id
         LEFT JOIN projects p ON p.id = v.project_id
         WHERE ${visitWhere}
         ORDER BY v.scheduled_at ASC
         LIMIT 200`,
        visitParams
      );
      visits = rows.map((v) => ({
        id: v.id,
        kind: 'visit',
        scheduled_at: v.scheduled_at,
        status: v.status,
        address: v.address,
        notes: v.notes,
        project_id: v.project_id,
        project_name: v.project_name,
        lead_name: v.lead_name,
        title: v.project_name || v.lead_name || 'Site visit',
      }));
    } catch (e) {
      if (!/Unknown column/i.test(String(e.message))) throw e;
    }

    let reqWhere = 'r.builder_id = ?';
    const reqParams = [bid];
    if (dateFrom) {
      reqWhere += ' AND DATE(r.scheduled_at) >= ?';
      reqParams.push(dateFrom);
    }
    if (dateTo) {
      reqWhere += ' AND DATE(r.scheduled_at) <= ?';
      reqParams.push(dateTo);
    }

    const [requests] = await pool.query(
      `SELECT r.*, p.name AS project_name
       FROM builder_visit_requests r
       LEFT JOIN projects p ON p.id = r.project_id
       WHERE ${reqWhere}
       ORDER BY r.scheduled_at ASC`,
      reqParams
    );

    const events = [
      ...visits,
      ...requests.map((r) => ({
        id: r.id,
        kind: 'request',
        scheduled_at: r.scheduled_at,
        status: r.status,
        address: r.address,
        notes: r.notes,
        project_id: r.project_id,
        project_name: r.project_name,
        visit_id: r.visit_id,
        title: r.project_name ? `Request: ${r.project_name}` : 'Visit request',
      })),
    ].sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));

    res.json({ success: true, data: events });
  } catch (e) {
    console.error('getBuilderCalendar:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderVisitRequest(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    const body = req.body || {};
    const scheduled_at = normalizeScheduledAt(body.scheduled_at);
    if (!scheduled_at) {
      return res.status(400).json({ success: false, error: 'Scheduled date/time is required' });
    }

    const address = buildAddressFromParts(body);
    if (!address.trim()) {
      return res.status(400).json({ success: false, error: 'Address is required' });
    }

    let projectId = body.project_id != null ? parseInt(body.project_id, 10) : null;
    if (projectId && !Number.isNaN(projectId)) {
      const owned = await assertBuilderOwnsProject(pool, bid, projectId);
      if (!owned) {
        return res.status(403).json({ success: false, error: 'Project not linked to your account' });
      }
    } else {
      projectId = null;
    }

    const line2 = body.address_line2 ? String(body.address_line2).trim().slice(0, 255) : null;
    const city = body.city ? String(body.city).trim().slice(0, 100) : null;
    const zip = body.zipcode ? String(body.zipcode).trim().slice(0, 20) : null;
    const visitType = body.visit_type ? String(body.visit_type).trim().slice(0, 80) : '';
    let notes = body.notes ? String(body.notes).trim() : null;
    if (visitType) {
      notes = notes ? `[${visitType}] ${notes}` : `[${visitType}]`;
    }
    const leadId = body.lead_id != null ? parseInt(body.lead_id, 10) : null;

    const [ins] = await pool.execute(
      `INSERT INTO builder_visit_requests
       (builder_id, project_id, lead_id, scheduled_at, address, address_line2, city, zipcode, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        bid,
        projectId,
        leadId && !Number.isNaN(leadId) ? leadId : null,
        scheduled_at,
        address.trim().slice(0, 500),
        line2,
        city,
        zip,
        notes,
      ]
    );

    const when = String(scheduled_at).slice(0, 10);
    logBuilderActivity(pool, {
      builderId: bid,
      projectId: Number.isFinite(projectId) ? projectId : null,
      type: 'visit',
      text: `Visit request submitted for ${when}`,
      href: 'builder-calendar.html',
    }).catch(() => {});

    await notifyBuilder(pool, bid, {
      type: 'visit',
      title: 'Visit request submitted',
      body: 'Senior Floors will confirm your requested date.',
      linkUrl: '/builder-calendar.html',
    });

    const adminTo = adminNotifyEmail();
    if (adminTo) {
      const [b] = await pool.query(
        'SELECT first_name, last_name, company, email FROM builders WHERE id = ?',
        [bid]
      );
      const builder = b[0] || {};
      await sendBuilderNotification({
        to: adminTo,
        subject: 'Builder visit request',
        html: `<p><strong>${builder.company || builder.email}</strong> requested a visit on <strong>${scheduled_at}</strong>.</p>
               <p>Address: ${address}</p>${notes ? `<p>Notes: ${notes}</p>` : ''}`,
      });
    }

    const [rows] = await pool.query('SELECT * FROM builder_visit_requests WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('postBuilderVisitRequest:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function cancelBuilderVisitRequest(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      'SELECT * FROM builder_visit_requests WHERE id = ? AND builder_id = ?',
      [id, bid]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Request not found' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending requests can be cancelled' });
    }
    await pool.execute(
      `UPDATE builder_visit_requests SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
      [id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('cancelBuilderVisitRequest:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function exportBuilderCalendarIcs(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    const scope = await buildBuilderVisitScope(pool, bid);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Senior Floors//Builder Portal//EN',
      'CALSCALE:GREGORIAN',
    ];

    try {
      const [visits] = await pool.query(
        `SELECT v.scheduled_at, v.address, v.status, p.name AS project_name
         FROM visits v LEFT JOIN projects p ON p.id = v.project_id
         WHERE ${scope.where} ORDER BY v.scheduled_at ASC LIMIT 200`,
        scope.params
      );
      visits.forEach((v, i) => {
        const start = toIcsDate(v.scheduled_at);
        const end = toIcsDate(new Date(new Date(v.scheduled_at).getTime() + 3600000));
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:sf-visit-${v.id || i}@seniorfloors`);
        lines.push(`DTSTART:${start}`);
        lines.push(`DTEND:${end}`);
        lines.push(`SUMMARY:${icsEscape(v.project_name || 'Site visit')}`);
        lines.push(`LOCATION:${icsEscape(v.address)}`);
        lines.push(`DESCRIPTION:${icsEscape(v.status)}`);
        lines.push('END:VEVENT');
      });
    } catch (_) {
      /* ignore */
    }

    const [reqs] = await pool.query(
      `SELECT r.scheduled_at, r.address, r.status, p.name AS project_name
       FROM builder_visit_requests r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.builder_id = ? AND r.status IN ('pending','approved') ORDER BY r.scheduled_at ASC`,
      [bid]
    );
    reqs.forEach((r, i) => {
      const start = toIcsDate(r.scheduled_at);
      const end = toIcsDate(new Date(new Date(r.scheduled_at).getTime() + 3600000));
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:sf-req-${r.id || i}@seniorfloors`);
      lines.push(`DTSTART:${start}`);
      lines.push(`DTEND:${end}`);
      lines.push(`SUMMARY:${icsEscape(`Request: ${r.project_name || 'Visit'}`)}`);
      lines.push(`LOCATION:${icsEscape(r.address)}`);
      lines.push(`DESCRIPTION:${icsEscape(r.status)}`);
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="senior-floors-schedule.ics"');
    res.send(lines.join('\r\n'));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderCalendarRoutes(app) {
  app.get('/api/builder-calendar', requireBuilderAuth, getBuilderCalendar);
  app.get('/api/builder-calendar/export.ics', requireBuilderAuth, exportBuilderCalendarIcs);
  app.post('/api/builder-calendar/requests', requireBuilderAuth, postBuilderVisitRequest);
  app.delete('/api/builder-calendar/requests/:id', requireBuilderAuth, cancelBuilderVisitRequest);
}
