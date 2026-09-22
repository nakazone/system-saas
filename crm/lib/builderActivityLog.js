/**
 * Builder portal activity log — real events for dashboard feed.
 */
import {
  buildProjectBuilderMatch,
  getBuilderCustomerId,
  getProjectBuilderLinkMeta,
  projectNotDeletedClause,
} from './builderProjectAccess.js';

export const TIMELINE_STEPS = [
  { key: 'scheduled', label: 'Scheduled', minPct: 0 },
  { key: 'material', label: 'Material confirmed', minPct: 10 },
  { key: 'start', label: 'Work started', minPct: 25 },
  { key: 'installation', label: 'Installation', minPct: 45 },
  { key: 'finishing', label: 'Finishing', minPct: 70 },
  { key: 'inspection', label: 'Final inspection', minPct: 90 },
  { key: 'completed', label: 'Completed', minPct: 100 },
];

async function tableExists(pool, name) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(r[0]?.c) > 0;
}

export async function isBuilderActivityLogReady(pool) {
  return tableExists(pool, 'builder_activity_log');
}

export function stepLabelFromPct(pct) {
  const n = Number(pct) || 0;
  let label = TIMELINE_STEPS[0].label;
  for (let i = TIMELINE_STEPS.length - 1; i >= 0; i--) {
    if (n >= TIMELINE_STEPS[i].minPct) {
      label = TIMELINE_STEPS[i].label;
      break;
    }
  }
  return label;
}

/** Steps whose minPct threshold was crossed going from oldPct to newPct. */
export function stepsCrossed(oldPct, newPct) {
  const o = Number(oldPct) || 0;
  const n = Number(newPct) || 0;
  if (n <= o) return [];
  const crossed = [];
  for (let i = 1; i < TIMELINE_STEPS.length; i++) {
    const threshold = TIMELINE_STEPS[i].minPct;
    if (o < threshold && n >= threshold) crossed.push(TIMELINE_STEPS[i]);
  }
  return crossed;
}

export async function getBuilderIdsForProject(pool, projectId) {
  const pid = parseInt(String(projectId), 10);
  if (!Number.isFinite(pid) || pid <= 0) return [];

  const [rows] = await pool.query('SELECT * FROM projects WHERE id = ? LIMIT 1', [pid]);
  if (!rows.length) return [];

  const p = rows[0];
  const meta = await getProjectBuilderLinkMeta(pool);
  const ids = new Set();

  if (meta.hasPartnerBuilderId && p.partner_builder_id) {
    ids.add(Number(p.partner_builder_id));
  }
  if (meta.hasBuilderId && p.builder_id) {
    const [bs] = await pool.query(
      'SELECT id FROM builders WHERE customer_id = ? AND portal_access = 1',
      [p.builder_id]
    );
    bs.forEach((b) => ids.add(Number(b.id)));
  }
  if (meta.hasBuilderProjects) {
    const [bp] = await pool.query(
      'SELECT builder_id FROM builder_projects WHERE project_id = ?',
      [pid]
    );
    bp.forEach((r) => ids.add(Number(r.builder_id)));
  }

  return [...ids].filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ builderId: number, projectId?: number|null, type: string, text: string, href?: string }} entry
 */
export async function logBuilderActivity(pool, entry) {
  if (!(await isBuilderActivityLogReady(pool))) return;
  const bid = parseInt(String(entry.builderId), 10);
  if (!Number.isFinite(bid) || bid <= 0) return;
  const pid =
    entry.projectId != null && entry.projectId !== ''
      ? parseInt(String(entry.projectId), 10)
      : null;
  await pool.execute(
    `INSERT INTO builder_activity_log (builder_id, project_id, activity_type, text, href)
     VALUES (?, ?, ?, ?, ?)`,
    [
      bid,
      Number.isFinite(pid) && pid > 0 ? pid : null,
      String(entry.type || 'update').slice(0, 40),
      String(entry.text || '').slice(0, 500),
      entry.href ? String(entry.href).slice(0, 255) : null,
    ]
  );
}

export async function logBuilderActivityForProject(pool, projectId, entry) {
  const builderIds = await getBuilderIdsForProject(pool, projectId);
  for (const builderId of builderIds) {
    await logBuilderActivity(pool, { ...entry, builderId, projectId });
  }
}

const ESTIMATE_STATUS_LABELS = {
  pending: 'Estimate submitted',
  reviewing: 'Estimate under review',
  quoted: 'Quote ready',
  approved: 'Estimate approved',
  declined: 'Estimate declined',
  cancelled: 'Estimate cancelled',
  won: 'Estimate accepted',
};

export async function logEstimateEvent(pool, builderId, refNumber, status, note) {
  const st = String(status || '').toLowerCase();
  const lbl = ESTIMATE_STATUS_LABELS[st] || `Estimate update (${status})`;
  const extra = note ? `: ${String(note).slice(0, 60)}` : '';
  await logBuilderActivity(pool, {
    builderId,
    type: 'estimate',
    text: `${lbl} — ${refNumber || 'request'}${extra}`,
    href: 'builder-estimate-history.html',
  });
}

export async function recordProjectCrmUpdate(pool, projectId, prevRow, body) {
  const [rows] = await pool.query('SELECT id, name, status, completion_percentage FROM projects WHERE id = ?', [
    projectId,
  ]);
  if (!rows.length) return;
  const cur = rows[0];
  const pname = cur.name || `Project #${projectId}`;
  const oldPct = prevRow?.completion_percentage ?? prevRow?.progress_percentage ?? 0;
  const newPct =
    body.completion_percentage !== undefined ? body.completion_percentage : cur.completion_percentage;
  const oldStatus = String(prevRow?.status || '').toLowerCase();
  const newStatus = body.status !== undefined ? String(body.status).toLowerCase() : String(cur.status || '').toLowerCase();

  for (const step of stepsCrossed(oldPct, newPct)) {
    await logBuilderActivityForProject(pool, projectId, {
      type: 'project_step',
      text: `Stage "${step.label}" started on ${pname}`,
    });
  }

  if (newStatus === 'completed' && oldStatus !== 'completed') {
    await logBuilderActivityForProject(pool, projectId, {
      type: 'project_completed',
      text: `Project completed: ${pname}`,
    });
  } else if (body.status !== undefined && newStatus !== oldStatus && newStatus && oldStatus) {
    await logBuilderActivityForProject(pool, projectId, {
      type: 'project_status',
      text: `Project status changed to "${newStatus}" on ${pname}`,
    });
  }

  try {
    const { notifyBuilderProjectCrmUpdate } = await import('./builderPortalNotify.js');
    await notifyBuilderProjectCrmUpdate(pool, projectId, prevRow, body);
  } catch (e) {
    console.warn('[recordProjectCrmUpdate] portal notify:', e.message);
  }
}

/** One-time seed from recent CRM data when log is empty (existing partners). */
export async function backfillBuilderActivityIfEmpty(pool, builderId) {
  if (!(await isBuilderActivityLogReady(pool))) return;
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM builder_activity_log WHERE builder_id = ?',
    [builderId]
  );
  if (Number(n) > 0) return;

  const cid = await getBuilderCustomerId(pool, builderId);
  const meta = await getProjectBuilderLinkMeta(pool);
  const match = buildProjectBuilderMatch('p', builderId, cid, meta);
  const projectScope = `${match.sql}${projectNotDeletedClause('p', meta)}`;

  const [messages] = await pool.query(
    `SELECT m.message, m.created_at, m.project_id, m.sender_type, p.name AS project_name
     FROM builder_messages m
     LEFT JOIN projects p ON m.project_id = p.id
     WHERE m.builder_id = ? AND m.is_internal_note = 0
     ORDER BY m.created_at DESC LIMIT 8`,
    [builderId]
  );
  for (const m of messages) {
    const snippet = String(m.message || '').slice(0, 90);
    const onProj = m.project_name ? ` on ${m.project_name}` : '';
    const text =
      m.sender_type === 'admin'
        ? `Message from Senior Floors${onProj}: ${snippet}`
        : `You sent a message${onProj}: ${snippet}`;
    await logBuilderActivity(pool, {
      builderId,
      projectId: m.project_id,
      type: m.sender_type === 'admin' ? 'message_sf' : 'message_builder',
      text,
    });
  }

  try {
    const [photos] = await pool.query(
      `SELECT ph.created_at, ph.project_id, p.name AS project_name, ph.phase
       FROM project_photos ph
       INNER JOIN projects p ON p.id = ph.project_id
       WHERE ${projectScope}
       ORDER BY ph.created_at DESC LIMIT 6`,
      match.params
    );
    for (const ph of photos) {
      await logBuilderActivity(pool, {
        builderId,
        projectId: ph.project_id,
        type: 'photo',
        text: `Photo added to ${ph.project_name || 'project'} (${ph.phase || 'site'})`,
      });
    }
  } catch (_) {
    /* ignore */
  }

  try {
    const [projects] = await pool.query(
      `SELECT p.id, p.name, p.status, p.completion_percentage, p.updated_at
       FROM projects p
       WHERE ${projectScope} AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)
       ORDER BY p.updated_at DESC LIMIT 6`,
      match.params
    );
    for (const p of projects) {
      const st = String(p.status || '').toLowerCase();
      const pname = p.name || 'Project';
      if (st === 'completed') {
        await logBuilderActivity(pool, {
          builderId,
          projectId: p.id,
          type: 'project_completed',
          text: `Project completed: ${pname}`,
        });
      } else if (!['cancelled', 'closed'].includes(st)) {
        const step = stepLabelFromPct(p.completion_percentage);
        await logBuilderActivity(pool, {
          builderId,
          projectId: p.id,
          type: 'project_step',
          text: `Stage "${step}" on ${pname}`,
        });
      }
    }
  } catch (_) {
    /* ignore */
  }
}

export async function fetchBuilderActivityFeed(pool, builderId, { since = null, limit = 10 } = {}) {
  if (!(await isBuilderActivityLogReady(pool))) return [];

  const bid = parseInt(String(builderId), 10);
  const lim = Math.min(20, Math.max(1, parseInt(String(limit), 10) || 10));
  let sql = `SELECT l.activity_type AS type, l.text, l.project_id, l.href, l.created_at, p.name AS project_name
    FROM builder_activity_log l
    LEFT JOIN projects p ON p.id = l.project_id
    WHERE l.builder_id = ?`;
  const params = [bid];
  if (since) {
    sql += ' AND l.created_at > ?';
    params.push(since);
  }
  sql += ' ORDER BY l.created_at DESC LIMIT ?';
  params.push(lim);

  const [rows] = await pool.query(sql, params);
  return rows.map((r) => ({
    type: r.type,
    text: r.text,
    project_id: r.project_id,
    project_name: r.project_name,
    created_at: r.created_at,
    href: r.href,
  }));
}
