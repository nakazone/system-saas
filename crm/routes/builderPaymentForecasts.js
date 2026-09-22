/**
 * Previsão de pagamentos de builders (por projeto + data).
 */
import { Router } from 'express';
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
const authed = [requireAuth];

async function tableMissing(pool) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'builder_payment_forecasts'`
  );
  return !r[0]?.c;
}

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0].c) > 0;
}

function ymd(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Builders: clientes marcados como builder ou referenciados em projetos builder */
router.get('/builders', ...authed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const hasCt = await columnExists(pool, 'customers', 'customer_type');
    const hasBuilderId = await columnExists(pool, 'projects', 'builder_id');
    const hasClientType = await columnExists(pool, 'projects', 'client_type');

    const ids = new Set();
    const byId = new Map();

    if (hasCt) {
      const [rows] = await pool.query(
        `SELECT id, name FROM customers WHERE customer_type = 'builder' ORDER BY name ASC`
      );
      for (const row of rows) {
        ids.add(row.id);
        byId.set(row.id, row);
      }
    }

    if (hasBuilderId) {
      const ct = hasClientType ? "p.client_type = 'builder' AND " : '';
      const [rows] = await pool.query(
        `SELECT DISTINCT c.id, c.name
         FROM projects p
         INNER JOIN customers c ON c.id = p.builder_id
         WHERE ${ct}p.builder_id IS NOT NULL
         ORDER BY c.name ASC`
      );
      for (const row of rows) {
        if (!byId.has(row.id)) byId.set(row.id, row);
        ids.add(row.id);
      }
    }

    const list = [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return res.json({ success: true, data: list });
  } catch (e) {
    console.error('GET /builder-payment-forecasts/builders', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** Projetos do builder (client_type builder + builder_id) */
router.get('/projects', ...authed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const builderId = parseInt(req.query.builder_id, 10);
    if (!builderId) return res.status(400).json({ success: false, error: 'builder_id obrigatório' });

    const hasDeleted = await columnExists(pool, 'projects', 'deleted_at');
    const delClause = hasDeleted ? 'deleted_at IS NULL AND ' : '';
    const hasBuilderId = await columnExists(pool, 'projects', 'builder_id');
    const hasClientType = await columnExists(pool, 'projects', 'client_type');

    if (!hasBuilderId) {
      return res.json({ success: true, data: [] });
    }

    const typeClause = hasClientType ? "client_type = 'builder' AND " : '';
    const [rows] = await pool.query(
      `SELECT id, name, project_number, status, contract_value
       FROM projects
       WHERE ${delClause}${typeClause}builder_id = ?
       ORDER BY name ASC`,
      [builderId]
    );
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error('GET /builder-payment-forecasts/projects', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

async function assertProjectBelongsToBuilder(pool, projectId, builderId) {
  const hasBuilderId = await columnExists(pool, 'projects', 'builder_id');
  const hasClientType = await columnExists(pool, 'projects', 'client_type');
  if (!hasBuilderId) {
    const e = new Error('Schema de projetos sem builder_id');
    e.statusCode = 503;
    throw e;
  }
  let sql = 'SELECT id FROM projects WHERE id = ? AND builder_id = ?';
  const params = [projectId, builderId];
  if (hasClientType) {
    sql += " AND client_type = 'builder'";
  }
  const [rows] = await pool.query(sql, params);
  if (!rows.length) {
    const e = new Error('Projeto não encontrado ou não pertence a este builder');
    e.statusCode = 400;
    throw e;
  }
}

router.get('/', ...authed, requirePermission('projects.view'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    if (await tableMissing(pool)) {
      return res.json({ success: true, data: [], meta: { tableMissing: true } });
    }

    const builderId = req.query.builder_id ? parseInt(req.query.builder_id, 10) : null;
    const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
    const from = ymd(req.query.from);
    const to = ymd(req.query.to);

    let sql = `
      SELECT f.*, c.name AS builder_name, p.name AS project_name, p.project_number
      FROM builder_payment_forecasts f
      LEFT JOIN customers c ON c.id = f.builder_id
      LEFT JOIN projects p ON p.id = f.project_id
      WHERE 1=1`;
    const params = [];
    if (builderId) {
      sql += ' AND f.builder_id = ?';
      params.push(builderId);
    }
    if (projectId) {
      sql += ' AND f.project_id = ?';
      params.push(projectId);
    }
    if (from) {
      sql += ' AND f.expected_payment_date >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND f.expected_payment_date <= ?';
      params.push(to);
    }
    sql += ' ORDER BY f.expected_payment_date ASC, f.id ASC';

    const [rows] = await pool.query(sql, params);
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error('GET /builder-payment-forecasts', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/', ...authed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    if (await tableMissing(pool)) {
      return res.status(503).json({
        success: false,
        error: 'Tabela não instalada. Reinicie o servidor ou execute: npm run migrate:builder-payment-forecasts',
        code: 'BPF_SCHEMA_MISSING',
      });
    }

    const b = req.body || {};
    const builder_id = parseInt(b.builder_id, 10);
    const project_id = parseInt(b.project_id, 10);
    const expected_payment_date = ymd(b.expected_payment_date);
    const amount =
      b.amount != null && String(b.amount).trim() !== '' ? Math.round(Number(b.amount) * 100) / 100 : null;
    const notes = b.notes != null ? String(b.notes).slice(0, 500) : null;
    const uid = req.session?.userId || null;

    if (!builder_id || !project_id || !expected_payment_date) {
      return res.status(400).json({ success: false, error: 'builder_id, project_id e expected_payment_date são obrigatórios' });
    }

    await assertProjectBelongsToBuilder(pool, project_id, builder_id);

    const [ins] = await pool.execute(
      `INSERT INTO builder_payment_forecasts
       (builder_id, project_id, expected_payment_date, amount, notes, created_by)
       VALUES (?,?,?,?,?,?)`,
      [builder_id, project_id, expected_payment_date, amount, notes, uid]
    );
    const [rows] = await pool.query(
      `SELECT f.*, c.name AS builder_name, p.name AS project_name, p.project_number
       FROM builder_payment_forecasts f
       LEFT JOIN customers c ON c.id = f.builder_id
       LEFT JOIN projects p ON p.id = f.project_id
       WHERE f.id = ?`,
      [ins.insertId]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    const code = e.statusCode || 500;
    if (code >= 500) console.error('POST /builder-payment-forecasts', e);
    return res.status(code).json({ success: false, error: e.message });
  }
});

router.put('/:id', ...authed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });

    const b = req.body || {};
    const builder_id = parseInt(b.builder_id, 10);
    const project_id = parseInt(b.project_id, 10);
    const expected_payment_date = ymd(b.expected_payment_date);
    const amount =
      b.amount != null && String(b.amount).trim() !== '' ? Math.round(Number(b.amount) * 100) / 100 : null;
    const notes = b.notes != null ? String(b.notes).slice(0, 500) : null;

    if (!builder_id || !project_id || !expected_payment_date) {
      return res.status(400).json({ success: false, error: 'builder_id, project_id e expected_payment_date são obrigatórios' });
    }

    await assertProjectBelongsToBuilder(pool, project_id, builder_id);

    const [ex] = await pool.query('SELECT id FROM builder_payment_forecasts WHERE id = ?', [id]);
    if (!ex.length) return res.status(404).json({ success: false, error: 'Não encontrado' });

    await pool.execute(
      `UPDATE builder_payment_forecasts SET
        builder_id = ?, project_id = ?, expected_payment_date = ?, amount = ?, notes = ?
       WHERE id = ?`,
      [builder_id, project_id, expected_payment_date, amount, notes, id]
    );

    const [rows] = await pool.query(
      `SELECT f.*, c.name AS builder_name, p.name AS project_name, p.project_number
       FROM builder_payment_forecasts f
       LEFT JOIN customers c ON c.id = f.builder_id
       LEFT JOIN projects p ON p.id = f.project_id
       WHERE f.id = ?`,
      [id]
    );
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    const code = e.statusCode || 500;
    if (code >= 500) console.error('PUT /builder-payment-forecasts', e);
    return res.status(code).json({ success: false, error: e.message });
  }
});

router.delete('/:id', ...authed, requirePermission('projects.edit'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });
    const [r] = await pool.execute('DELETE FROM builder_payment_forecasts WHERE id = ?', [id]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, error: 'Não encontrado' });
    return res.json({ success: true });
  } catch (e) {
    console.error('DELETE /builder-payment-forecasts', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
