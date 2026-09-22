/**
 * Email + in-app notification when checklist items are assigned to a builder.
 */
import { sendBuilderNotification } from './builderNotify.js';
import { builderWantsEmail } from './builderNotifyPrefs.js';
async function tableExists(pool, name) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(r[0]?.c) > 0;
}

async function resolveBuilderIdForProject(pool, projectId) {
  if (await tableExists(pool, 'builder_projects')) {
    const [bp] = await pool.query(
      'SELECT builder_id FROM builder_projects WHERE project_id = ? ORDER BY id ASC LIMIT 1',
      [projectId]
    );
    if (bp[0]?.builder_id) return bp[0].builder_id;
  }
  if (await columnExists(pool, 'projects', 'partner_builder_id')) {
    const [p] = await pool.query(
      'SELECT partner_builder_id FROM projects WHERE id = ? LIMIT 1',
      [projectId]
    );
    if (p[0]?.partner_builder_id) return p[0].partner_builder_id;
  }
  return null;
}

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

/**
 * Notify builder when CRM enables visible items assigned to them.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 * @param {{ id: number, item: string, assigned_to?: string, visible_to_builder?: number }[]} items
 * @param {{ wasVisible?: boolean, wasBuilder?: boolean }} prevById
 */
export async function notifyBuilderChecklistAssigned(pool, projectId, items, prevById = {}) {
  const builderId = await resolveBuilderIdForProject(pool, projectId);
  if (!builderId) return;

  const newlyAssigned = (items || []).filter((it) => {
    const prev = prevById[it.id] || {};
    const nowVisible = it.visible_to_builder === 1 || it.visible_to_builder === true;
    const nowBuilder = String(it.assigned_to || '').toLowerCase() === 'builder';
    const wasVisible = prev.wasVisible === true;
    const wasBuilder = prev.wasBuilder === true;
    return nowVisible && nowBuilder && (!wasVisible || !wasBuilder);
  });
  if (!newlyAssigned.length) return;

  const [builders] = await pool.query(
    'SELECT id, email, first_name, notification_prefs FROM builders WHERE id = ? LIMIT 1',
    [builderId]
  );
  const builder = builders[0];
  if (!builder) return;

  const [projects] = await pool.query('SELECT name, project_number FROM projects WHERE id = ? LIMIT 1', [
    projectId,
  ]);
  const proj = projects[0];
  const projLabel = proj?.name || proj?.project_number || `Project #${projectId}`;
  const pub = (process.env.PUBLIC_CRM_URL || '').replace(/\/$/, '');
  const link = `${pub}/builder-project.html?id=${projectId}`;
  const itemList = newlyAssigned.map((i) => `— ${i.item}`).join('<br/>');

  const { notifyBuilder } = await import('../routes/builderNotifications.js');
  await notifyBuilder(pool, builderId, {
    type: 'checklist',
    title: `New checklist on ${projLabel}`,
    body: `${newlyAssigned.length} item(s) need your action.`,
    linkUrl: `/builder-project.html?id=${projectId}`,
  }).catch(() => {});

  if (builder.email && builderWantsEmail(builder.notification_prefs, 'checklist')) {
    await sendBuilderNotification({
      to: builder.email,
      subject: `New checklist items — ${projLabel}`,
      html: `<p>Hi ${builder.first_name || 'there'},</p>
        <p>Senior Floors assigned <strong>${newlyAssigned.length}</strong> checklist item(s) to you on <strong>${projLabel}</strong>:</p>
        <p>${itemList}</p>
        <p><a href="${link}">Open project checklist</a></p>`,
    }).catch(() => {});
  }
}

/** Load previous checklist row state before CRM update. */
export async function loadChecklistItemState(pool, itemId) {
  const hasVisible = await columnExists(pool, 'project_checklist', 'visible_to_builder');
  const hasAssigned = await columnExists(pool, 'project_checklist', 'assigned_to');
  const cols = ['id', 'item', 'project_id'];
  if (hasVisible) cols.push('visible_to_builder');
  if (hasAssigned) cols.push('assigned_to');
  const [rows] = await pool.query(
    `SELECT ${cols.join(', ')} FROM project_checklist WHERE id = ? LIMIT 1`,
    [itemId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    item: r.item,
    project_id: r.project_id,
    wasVisible: hasVisible ? r.visible_to_builder === 1 : true,
    wasBuilder: hasAssigned ? String(r.assigned_to || '').toLowerCase() === 'builder' : false,
  };
}
