/**
 * Builder Partner Portal — admin CRUD + builder-scoped reads.
 */
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  buildProjectBuilderCorrelatedMatch,
  buildProjectBuilderMatch,
  buildProjectOrderSql,
  buildProjectSelectSql,
  getBuilderCustomerId,
  getProjectBuilderLinkMeta,
  projectNotDeletedClause,
} from '../lib/builderProjectAccess.js';
import { randomTempPassword } from '../lib/builderJwt.js';
import {
  builderPortalAuthSummary,
  setBuilderPortalPassword,
} from '../lib/builderPortalPassword.js';

function parseJsonField(val, fallback = []) {
  if (val == null) return fallback;
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function builderDisplayName(b) {
  return [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || b.company || b.email;
}

async function syncCustomerForBuilder(pool, body, builderId, existingCustomerId) {
  const company = String(body.company || '').trim() || builderDisplayName(body);
  const responsible = builderDisplayName(body);
  let customerId = existingCustomerId;

  if (customerId) {
    await pool.execute(
      `UPDATE customers SET name = ?, email = ?, phone = ?, responsible_name = ?, customer_type = 'builder', status = 'active'
       WHERE id = ?`,
      [company, body.email || null, body.phone || null, responsible, customerId]
    );
  } else {
    const [ins] = await pool.execute(
      `INSERT INTO customers (name, email, phone, responsible_name, customer_type, status, notes)
       VALUES (?, ?, ?, ?, 'builder', 'active', ?)`,
      [
        company,
        body.email || null,
        body.phone || null,
        responsible,
        `Builder portal partner #${builderId}`,
      ]
    );
    customerId = ins.insertId;
    await pool.execute('UPDATE builders SET customer_id = ? WHERE id = ?', [customerId, builderId]);
  }
  return customerId;
}

export async function listBuilders(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const status = req.query.status || null;
    const type = req.query.type || null;
    const search = req.query.search || null;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    let where = '1=1';
    const params = [];
    if (status) {
      where += ' AND b.status = ?';
      params.push(status);
    }
    if (type) {
      where += ' AND b.type = ?';
      params.push(type);
    }
    if (search) {
      const t = `%${search}%`;
      where += ' AND (b.first_name LIKE ? OR b.last_name LIKE ? OR b.email LIKE ? OR b.company LIKE ?)';
      params.push(t, t, t, t);
    }

    const linkMeta = await getProjectBuilderLinkMeta(pool);
    const projectMatch = buildProjectBuilderCorrelatedMatch('p', 'b', linkMeta);
    const projectDel = projectNotDeletedClause('p', linkMeta);

    const [rows] = await pool.query(
      `SELECT b.*,
        (SELECT COUNT(*) FROM projects p WHERE ${projectMatch}${projectDel}) AS project_count
       FROM builders b
       WHERE ${where}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM builders b WHERE ${where}`,
      params
    );

    const [[stats]] = await pool.query(`
      SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
      FROM builders`);

    const [[projStats]] = await pool.query(`
      SELECT COUNT(*) AS open_projects
      FROM projects p
      INNER JOIN builders b ON ${projectMatch}
      WHERE p.status NOT IN ('completed','cancelled','closed')
        ${projectDel.replace(/^ AND /, 'AND ')}`);

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        regions: parseJsonField(r.regions),
        full_name: builderDisplayName(r),
      })),
      total,
      stats: {
        active: Number(stats?.active_count) || 0,
        pending: Number(stats?.pending_count) || 0,
        open_projects: Number(projStats?.open_projects) || 0,
      },
    });
  } catch (e) {
    console.error('listBuilders:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT * FROM builders WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Builder not found' });
    const b = rows[0];
    b.regions = parseJsonField(b.regions);
    const portalAuth = builderPortalAuthSummary(b);
    delete b.portal_password_hash;
    delete b.portal_admin_password;

    const linkMeta = await getProjectBuilderLinkMeta(pool);
    const match = buildProjectBuilderMatch('p', id, b.customer_id, linkMeta);
    const selectSql = await buildProjectSelectSql(
      pool,
      [
        'id',
        'name',
        'address',
        'status',
        'contract_value',
        'start_date',
        'end_date_estimated',
        'completion_percentage',
        'project_number',
      ],
      'p'
    );
    const orderSql = await buildProjectOrderSql(pool, 'updated_at', 'p');
    const [projects] = await pool.query(
      `SELECT ${selectSql}
       FROM projects p
       WHERE ${match.sql}${projectNotDeletedClause('p', linkMeta)}
       ORDER BY ${orderSql} DESC`,
      match.params
    );

    const [docs] = await pool.query(
      'SELECT * FROM builder_documents WHERE builder_id = ? ORDER BY created_at DESC',
      [id]
    );

    const [messages] = await pool.query(
      `SELECT * FROM builder_messages WHERE builder_id = ? AND is_internal_note = 0
       ORDER BY created_at DESC LIMIT 50`,
      [id]
    );

    const [accessLog] = await pool.query(
      'SELECT * FROM builder_access_log WHERE builder_id = ? ORDER BY created_at DESC LIMIT 20',
      [id]
    );

    const [overrides] = await pool.query(
      `SELECT o.*, s.name AS service_name FROM builder_pricing_overrides o
       LEFT JOIN pricing_services s ON s.id = o.service_id WHERE o.builder_id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: {
        builder: b,
        portal_auth: portalAuth,
        projects,
        documents: docs,
        messages,
        access_log: accessLog,
        pricing_overrides: overrides,
      },
    });
  } catch (e) {
    console.error('getBuilder:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function createBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const body = req.body || {};
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!email || !body.first_name || !body.last_name) {
      return res.status(400).json({ success: false, error: 'First name, last name and email required' });
    }

    const [dup] = await pool.query('SELECT id FROM builders WHERE LOWER(email) = ?', [email]);
    if (dup.length) return res.status(409).json({ success: false, error: 'Email already registered' });

    const regions = body.regions ? JSON.stringify(body.regions) : null;
    const portalAccess = body.portal_access ? 1 : 0;
    let tempPassword = null;
    if (portalAccess) {
      tempPassword = body.temp_password || body.portal_password || randomTempPassword();
    }

    const [ins] = await pool.execute(
      `INSERT INTO builders (
        first_name, last_name, email, phone, company, website, type, status,
        regions, avg_ticket, annual_projects, source, referred_by, internal_note,
        portal_access, portal_password_hash, discount_pct
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.first_name,
        body.last_name,
        email,
        body.phone || null,
        body.company || null,
        body.website || null,
        body.type || 'contractor',
        body.status || 'pending',
        regions,
        body.avg_ticket || null,
        body.annual_projects != null ? Number(body.annual_projects) : null,
        body.source || null,
        body.referred_by || null,
        body.internal_note || null,
        portalAccess,
        null,
        body.discount_pct != null ? Number(body.discount_pct) : null,
      ]
    );

    const builderId = ins.insertId;
    const customerId = await syncCustomerForBuilder(pool, { ...body, email }, builderId, null);

    if (portalAccess && tempPassword) {
      await setBuilderPortalPassword(pool, builderId, tempPassword);
    }

    res.status(201).json({
      success: true,
      data: { id: builderId, customer_id: customerId, temp_password: tempPassword },
    });
  } catch (e) {
    console.error('createBuilder:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function updateBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const [existing] = await pool.query('SELECT * FROM builders WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Builder not found' });
    const cur = existing[0];

    const regions = body.regions !== undefined ? JSON.stringify(body.regions) : cur.regions;

    await pool.execute(
      `UPDATE builders SET
        first_name = ?, last_name = ?, email = ?, phone = ?, company = ?, website = ?,
        type = ?, status = ?, regions = ?, avg_ticket = ?, annual_projects = ?,
        source = ?, referred_by = ?, internal_note = ?, discount_pct = ?,
        portal_access = COALESCE(?, portal_access), portal_blocked = COALESCE(?, portal_blocked)
       WHERE id = ?`,
      [
        body.first_name ?? cur.first_name,
        body.last_name ?? cur.last_name,
        (body.email || cur.email).toLowerCase(),
        body.phone !== undefined ? body.phone : cur.phone,
        body.company !== undefined ? body.company : cur.company,
        body.website !== undefined ? body.website : cur.website,
        body.type ?? cur.type,
        body.status ?? cur.status,
        regions,
        body.avg_ticket !== undefined ? body.avg_ticket : cur.avg_ticket,
        body.annual_projects !== undefined ? body.annual_projects : cur.annual_projects,
        body.source !== undefined ? body.source : cur.source,
        body.referred_by !== undefined ? body.referred_by : cur.referred_by,
        body.internal_note !== undefined ? body.internal_note : cur.internal_note,
        body.discount_pct !== undefined ? body.discount_pct : cur.discount_pct,
        body.portal_access !== undefined ? (body.portal_access ? 1 : 0) : null,
        body.portal_blocked !== undefined ? (body.portal_blocked ? 1 : 0) : null,
        id,
      ]
    );

    if (body.portal_password) {
      await setBuilderPortalPassword(pool, id, String(body.portal_password));
    }

    await syncCustomerForBuilder(
      pool,
      { ...cur, ...body, email: (body.email || cur.email).toLowerCase() },
      id,
      cur.customer_id
    );

    res.json({ success: true, message: 'Builder updated' });
  } catch (e) {
    console.error('updateBuilder:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

    const [existing] = await pool.query('SELECT id, customer_id FROM builders WHERE id = ? LIMIT 1', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Builder not found' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const runConn = async (sql, params) => {
        try {
          await conn.execute(sql, params);
        } catch (e) {
          if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        }
      };

      await runConn('UPDATE quotes SET builder_id = NULL WHERE builder_id = ?', [id]);
      await runConn('UPDATE leads SET referring_builder_id = NULL WHERE referring_builder_id = ?', [id]);
      await runConn('UPDATE projects SET partner_builder_id = NULL WHERE partner_builder_id = ?', [id]);
      await runConn('UPDATE project_photos SET uploaded_by_builder_id = NULL WHERE uploaded_by_builder_id = ?', [id]);

      await runConn(
        `DELETE FROM estimate_request_files WHERE request_id IN (SELECT id FROM estimate_requests WHERE builder_id = ?)`,
        [id]
      );
      await runConn(
        `DELETE FROM estimate_request_events WHERE request_id IN (SELECT id FROM estimate_requests WHERE builder_id = ?)`,
        [id]
      );
      await runConn('DELETE FROM estimate_requests WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_messages WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_documents WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_notifications WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_activity_log WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_access_log WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_password_resets WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_calculations WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_pricing_overrides WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_projects WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_visit_requests WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builder_project_evaluations WHERE builder_id = ?', [id]);
      await runConn('DELETE FROM builders WHERE id = ?', [id]);

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.json({ success: true, message: 'Cadastro excluído' });
  } catch (e) {
    console.error('deleteBuilder:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

/** Builder portal: projects for logged-in partner (see routes/builderPortalProjects.js) */

export async function postAdminResetPassword(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const custom = body.password != null ? String(body.password).trim() : '';
    const plain = custom || randomTempPassword();
    const saved = await setBuilderPortalPassword(pool, id, plain);
    res.json({
      success: true,
      data: {
        temp_password: saved,
        admin_password: saved,
      },
    });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ success: false, error: e.message });
  }
}

/** Lista simples para selects no CRM (projetos). */
export async function listBuildersForSelect(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query(
      `SELECT id, customer_id, first_name, last_name, company, email, status
       FROM builders
       WHERE status IN ('active', 'pending')
       ORDER BY company ASC, first_name ASC, last_name ASC
       LIMIT 500`
    );
    res.json({
      success: true,
      data: rows.map((b) => ({
        id: b.id,
        customer_id: b.customer_id,
        label: [b.company, [b.first_name, b.last_name].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || b.email,
        status: b.status,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderRoutes(app) {
  app.get('/api/builders/select', requireAuth, requirePermission('builders.view'), listBuildersForSelect);
  app.get('/api/builders', requireAuth, requirePermission('builders.view'), listBuilders);
  app.post('/api/builders', requireAuth, requirePermission('builders.edit'), createBuilder);
  app.get('/api/builders/:id', requireAuth, requirePermission('builders.view'), getBuilder);
  app.put('/api/builders/:id', requireAuth, requirePermission('builders.edit'), updateBuilder);
  app.delete('/api/builders/:id', requireAuth, requirePermission('builders.edit'), deleteBuilder);
  app.post(
    '/api/builders/:id/reset-portal-password',
    requireAuth,
    requirePermission('builders.edit'),
    postAdminResetPassword
  );

  /* GET /api/builder-projects registered in builderPortalProjects.js */
}
