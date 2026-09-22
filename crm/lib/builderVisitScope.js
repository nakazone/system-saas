import {
  buildProjectBuilderMatch,
  getBuilderCustomerId,
  getProjectBuilderLinkMeta,
  projectNotDeletedClause,
} from './builderProjectAccess.js';

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

export async function buildBuilderVisitScope(pool, builderId) {
  const cid = await getBuilderCustomerId(pool, builderId);
  const meta = await getProjectBuilderLinkMeta(pool);
  const match = buildProjectBuilderMatch('p', builderId, cid, meta);
  const hasProjectId = await columnExists(pool, 'visits', 'project_id');
  const hasCustomerId = await columnExists(pool, 'visits', 'customer_id');
  const hasReferring = await columnExists(pool, 'leads', 'referring_builder_id');

  const parts = [];
  const params = [];

  if (hasProjectId && match.sql !== '0=1') {
    parts.push(
      `v.project_id IN (SELECT p.id FROM projects p WHERE ${match.sql}${projectNotDeletedClause('p', meta)})`
    );
    params.push(...match.params);
  }
  if (hasCustomerId && cid != null) {
    parts.push('v.customer_id = ?');
    params.push(cid);
  }
  if (hasReferring) {
    parts.push(`v.lead_id IN (SELECT id FROM leads WHERE referring_builder_id = ?)`);
    params.push(builderId);
  }

  return { where: parts.length ? `(${parts.join(' OR ')})` : '0=1', params };
}

export async function fetchNextBuilderVisit(pool, builderId) {
  const scope = await buildBuilderVisitScope(pool, builderId);
  const now = new Date();
  try {
    const [visits] = await pool.query(
      `SELECT v.id, v.scheduled_at, v.address, v.status, v.project_id, p.name AS project_name
       FROM visits v
       LEFT JOIN projects p ON p.id = v.project_id
       WHERE ${scope.where} AND v.scheduled_at >= NOW()
         AND v.status IN ('scheduled', 'confirmed')
       ORDER BY v.scheduled_at ASC LIMIT 1`,
      scope.params
    );
    if (visits.length) {
      return { kind: 'visit', ...visits[0], start_date: visits[0].scheduled_at };
    }
  } catch (e) {
    if (!/Unknown column/i.test(String(e.message))) throw e;
  }

  const [reqs] = await pool.query(
    `SELECT r.id, r.scheduled_at, r.address, r.status, r.project_id, p.name AS project_name
     FROM builder_visit_requests r
     LEFT JOIN projects p ON p.id = r.project_id
     WHERE r.builder_id = ? AND r.status = 'pending' AND r.scheduled_at >= NOW()
     ORDER BY r.scheduled_at ASC LIMIT 1`,
    [builderId]
  );
  if (reqs.length) {
    return { kind: 'request', ...reqs[0], start_date: reqs[0].scheduled_at };
  }

  return null;
}
