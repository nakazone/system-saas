/**
 * Liga um projeto CRM ao parceiro builder (portal).
 * projects.builder_id = builders.customer_id (customers.id)
 * projects.partner_builder_id = builders.id (quando a coluna existir)
 */
import { getProjectsTableColumnSet } from '../modules/projects/projectHelpers.js';

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

function builderDisplayName(b) {
  return [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || b.company || b.email || `Builder #${b.id}`;
}

async function ensureBuilderCustomerId(pool, builderRow) {
  if (builderRow.customer_id) return Number(builderRow.customer_id);
  const name = builderDisplayName(builderRow);
  const [ins] = await pool.execute(
    `INSERT INTO customers (name, email, phone, responsible_name, customer_type, status, notes)
     VALUES (?, ?, ?, ?, 'builder', 'active', ?)`,
    [
      (builderRow.company || name).slice(0, 255),
      builderRow.email || null,
      builderRow.phone || null,
      name.slice(0, 255),
      `Builder portal partner #${builderRow.id}`,
    ]
  );
  const customerId = ins.insertId;
  await pool.execute('UPDATE builders SET customer_id = ? WHERE id = ?', [customerId, builderRow.id]);
  return customerId;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 * @param {number|null|undefined} buildersTableId builders.id; null = remover ligacao
 */
export async function linkProjectToBuilderPartner(pool, projectId, buildersTableId) {
  const pid = parseInt(String(projectId), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('Invalid project id');
  }

  const pcols = await getProjectsTableColumnSet(pool);

  if (buildersTableId == null || buildersTableId === '' || buildersTableId === 0) {
    const sets = [];
    if (pcols.has('builder_id')) sets.push('builder_id = NULL');
    if (pcols.has('partner_builder_id')) sets.push('partner_builder_id = NULL');
    if (pcols.has('builder_name')) sets.push('builder_name = NULL');
    if (sets.length) {
      await pool.execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, [pid]);
    }
    if (await tableExists(pool, 'builder_projects')) {
      await pool.execute('DELETE FROM builder_projects WHERE project_id = ?', [pid]);
    }
    return null;
  }

  const bid = parseInt(String(buildersTableId), 10);
  if (!Number.isFinite(bid) || bid <= 0) {
    throw new Error('Invalid builder id');
  }

  const [rows] = await pool.query(
    'SELECT id, customer_id, first_name, last_name, company, email, phone FROM builders WHERE id = ?',
    [bid]
  );
  if (!rows.length) {
    const err = new Error('Builder not found');
    err.status = 404;
    throw err;
  }

  const builderRow = rows[0];
  const customerId = await ensureBuilderCustomerId(pool, builderRow);
  const displayName = builderDisplayName(builderRow);

  const updates = [];
  const vals = [];
  if (pcols.has('builder_id')) {
    updates.push('builder_id = ?');
    vals.push(customerId);
  }
  if (pcols.has('partner_builder_id')) {
    updates.push('partner_builder_id = ?');
    vals.push(bid);
  }
  if (pcols.has('builder_name')) {
    updates.push('builder_name = ?');
    vals.push(displayName.slice(0, 255));
  }
  if (pcols.has('client_type')) {
    updates.push("client_type = 'builder'");
  }
  if (updates.length) {
    vals.push(pid);
    await pool.execute(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, vals);
  }

  if (await tableExists(pool, 'builder_projects')) {
    await pool.execute(
      `INSERT INTO builder_projects (builder_id, project_id, role) VALUES (?, ?, 'primary')
       ON DUPLICATE KEY UPDATE builder_id = VALUES(builder_id)`,
      [bid, pid]
    );
  }

  return {
    builder_table_id: bid,
    builder_customer_id: customerId,
    display_name: displayName,
    company: builderRow.company || null,
    email: builderRow.email || null,
  };
}

/** Resolve builder partner info for a project row. */
export async function resolveBuilderPartnerForProject(pool, projectRow) {
  if (!projectRow) return null;
  const pcols = await getProjectsTableColumnSet(pool);

  if (pcols.has('partner_builder_id') && projectRow.partner_builder_id) {
    const [rows] = await pool.query(
      'SELECT id, customer_id, first_name, last_name, company, email FROM builders WHERE id = ?',
      [projectRow.partner_builder_id]
    );
    if (rows.length) {
      const b = rows[0];
      return {
        builder_table_id: b.id,
        builder_customer_id: b.customer_id,
        display_name: builderDisplayName(b),
        company: b.company,
        email: b.email,
      };
    }
  }

  if (pcols.has('builder_id') && projectRow.builder_id) {
    const [rows] = await pool.query(
      'SELECT id, customer_id, first_name, last_name, company, email FROM builders WHERE customer_id = ? LIMIT 1',
      [projectRow.builder_id]
    );
    if (rows.length) {
      const b = rows[0];
      return {
        builder_table_id: b.id,
        builder_customer_id: b.customer_id,
        display_name: builderDisplayName(b),
        company: b.company,
        email: b.email,
      };
    }
  }

  return null;
}
