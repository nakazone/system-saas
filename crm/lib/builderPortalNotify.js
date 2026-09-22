/**
 * Builder portal in-app notifications — project events, document expiry, etc.
 */
import { getBuilderIdsForProject, stepsCrossed } from './builderActivityLog.js';

async function importNotifyBuilder() {
  const mod = await import('../routes/builderNotifications.js');
  return mod.notifyBuilder;
}

function projectLink(projectId) {
  const id = parseInt(String(projectId), 10);
  return Number.isFinite(id) && id > 0 ? `/builder-project.html?id=${id}` : '/builder-projects.html';
}

/**
 * In-app notifications when CRM updates a builder-linked project.
 */
export async function notifyBuilderProjectCrmUpdate(pool, projectId, prevRow, body) {
  if (!pool || !projectId) return;
  const notifyBuilder = await importNotifyBuilder();
  const [rows] = await pool.query(
    'SELECT id, name, status, completion_percentage, start_date FROM projects WHERE id = ?',
    [projectId]
  );
  if (!rows.length) return;
  const cur = rows[0];
  const pname = cur.name || `Project #${projectId}`;
  const link = projectLink(projectId);
  const builderIds = await getBuilderIdsForProject(pool, projectId);
  if (!builderIds.length) return;

  const oldPct = prevRow?.completion_percentage ?? prevRow?.progress_percentage ?? 0;
  const newPct =
    body.completion_percentage !== undefined ? body.completion_percentage : cur.completion_percentage;
  const oldStatus = String(prevRow?.status || '').toLowerCase();
  const newStatus =
    body.status !== undefined ? String(body.status).toLowerCase() : String(cur.status || '').toLowerCase();
  const oldStart = prevRow?.start_date ? String(prevRow.start_date).slice(0, 10) : '';
  const newStart =
    body.start_date !== undefined
      ? String(body.start_date || '').slice(0, 10)
      : cur.start_date
        ? String(cur.start_date).slice(0, 10)
        : '';

  for (const builderId of builderIds) {
    for (const step of stepsCrossed(oldPct, newPct)) {
      await notifyBuilder(pool, builderId, {
        type: 'project',
        title: 'Project updated',
        body: `"${step.label}" started on ${pname}`,
        linkUrl: link,
      }).catch(() => {});
    }

    if (newStatus === 'completed' && oldStatus !== 'completed') {
      await notifyBuilder(pool, builderId, {
        type: 'completed',
        title: 'Project completed',
        body: `${pname} is marked completed.`,
        linkUrl: link,
      }).catch(() => {});
    }

    if (newStart && newStart !== oldStart) {
      await notifyBuilder(pool, builderId, {
        type: 'visit',
        title: 'Visit scheduled',
        body: `Work start date set for ${pname}: ${newStart}`,
        linkUrl: link,
      }).catch(() => {});
    }
  }
}

/**
 * Create document expiry alerts (30 / 15 / 7 days) — deduped per doc + threshold.
 */
export async function ensureDocumentExpiryNotifications(pool, builderId) {
  if (!pool || !builderId) return;
  const notifyBuilder = await importNotifyBuilder();
  const [docs] = await pool.query(
    `SELECT id, name, expires_at,
      DATEDIFF(expires_at, CURDATE()) AS days_left
     FROM builder_documents
     WHERE builder_id = ? AND expires_at IS NOT NULL
       AND status IN ('valid', 'pending_review')
       AND DATEDIFF(expires_at, CURDATE()) IN (30, 15, 7)`,
    [builderId]
  );

  for (const d of docs) {
    const days = Number(d.days_left);
    const marker = `doc:${d.id}:d${days}`;
    const [[dup]] = await pool.query(
      `SELECT id FROM builder_notifications
       WHERE builder_id = ? AND type = 'document_expiry' AND body LIKE ?
       AND created_at > DATE_SUB(NOW(), INTERVAL 10 DAY)
       LIMIT 1`,
      [builderId, `%${marker}%`]
    );
    if (dup?.id) continue;
    await notifyBuilder(pool, builderId, {
      type: 'document_expiry',
      title: 'Document expiring soon',
      body: `${d.name} expires in ${days} days (${String(d.expires_at).slice(0, 10)}) [${marker}]`,
      linkUrl: '/builder-profile.html#documents',
    }).catch(() => {});
  }
}
