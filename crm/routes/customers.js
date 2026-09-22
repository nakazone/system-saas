/**
 * Clients API — tabela `customers` (builders, clientes finais convertidos de leads).
 */
import { getDBConnection } from '../config/db.js';
import { ensureClientFromLead } from '../modules/clients/leadToClient.js';
import { mapListProjectRow, money, moneyRound } from '../modules/projects/projectHelpers.js';

/** @param {import('mysql2/promise').Pool} pool */
async function getCustomersOptionalColumns(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
     AND COLUMN_NAME IN ('lead_id', 'responsible_name')`
  );
  return new Set(rows.map((r) => r.n));
}

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

export async function listCustomers(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const search = req.query.search || null;
    const customerType = req.query.customer_type || req.query.type || null;

    const opt = await getCustomersOptionalColumns(pool);

    let whereClause = '1=1';
    const params = [];

    if (customerType && String(customerType).trim()) {
      whereClause += ' AND customer_type = ?';
      params.push(String(customerType).trim().slice(0, 50));
    }

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      const searchTerm = `%${search}%`;
      if (opt.has('responsible_name')) {
        whereClause += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR responsible_name LIKE ?)';
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      } else {
        whereClause += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
        params.push(searchTerm, searchTerm, searchTerm);
      }
    }

    const selectParts = ['id'];
    if (opt.has('lead_id')) selectParts.push('lead_id');
    selectParts.push('name');
    if (opt.has('responsible_name')) selectParts.push('responsible_name');
    selectParts.push('email', 'phone', 'city', 'state', 'zipcode', 'customer_type', 'owner_id', 'status', 'created_at');
    const selectCols = selectParts.join(', ');

    const [rows] = await pool.query(
      `SELECT ${selectCols} FROM customers WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM customers WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const opt = await getCustomersOptionalColumns(pool);

    const {
      name,
      email,
      phone,
      address,
      city,
      state,
      zipcode,
      customer_type,
      owner_id,
      notes,
      lead_id,
      responsible_name,
    } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Nome e email são obrigatórios' });
    }
    const phoneVal = phone != null && String(phone).trim().length >= 3 ? String(phone).trim() : '—';

    const ct = String(customer_type || 'residential').trim();
    const nameTrim = String(name).trim().slice(0, 255);
    let respOut = null;

    if (ct === 'builder') {
      const respRaw = responsible_name != null ? String(responsible_name).trim() : '';
      if (nameTrim.length < 2) {
        return res.status(400).json({ success: false, error: 'Para Builder, indique o nome da empresa.' });
      }
      if (respRaw.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Para Builder, indique o responsável (pessoa de contacto).',
        });
      }
      if (!opt.has('responsible_name')) {
        return res.status(400).json({
          success: false,
          error: 'Base de dados desatualizada. Execute: npm run migrate:customers-responsible-name',
        });
      }
      respOut = respRaw.slice(0, 255);
    }

    const leadIdNum =
      lead_id != null && lead_id !== '' ? parseInt(String(lead_id), 10) : null;
    const leadOk = Number.isFinite(leadIdNum) && leadIdNum > 0 ? leadIdNum : null;
    const hasLeadId = opt.has('lead_id');

    if (hasLeadId && leadOk) {
      const [dup] = await pool.query('SELECT id FROM customers WHERE lead_id = ? LIMIT 1', [leadOk]);
      if (dup.length) {
        return res.status(409).json({
          success: false,
          error: 'Já existe cliente ligado a este lead',
          data: { id: dup[0].id },
        });
      }
    }

    const cols = ['name'];
    const placeholders = ['?'];
    const vals = [nameTrim];

    if (opt.has('responsible_name')) {
      cols.push('responsible_name');
      placeholders.push('?');
      vals.push(respOut);
    }

    cols.push(
      'email',
      'phone',
      'address',
      'city',
      'state',
      'zipcode',
      'customer_type',
      'owner_id',
      'notes',
      'status'
    );
    placeholders.push('?', '?', '?', '?', '?', '?', '?', '?', '?', '?');
    vals.push(
      String(email).trim().slice(0, 255),
      phoneVal.slice(0, 50),
      address != null ? String(address).trim().slice(0, 5000) || null : null,
      city != null ? String(city).trim().slice(0, 100) || null : null,
      state != null ? String(state).trim().slice(0, 50) || null : null,
      zipcode != null ? String(zipcode).replace(/\D/g, '').slice(0, 10) || null : null,
      ct,
      owner_id != null && owner_id !== '' ? parseInt(String(owner_id), 10) || null : null,
      notes != null ? String(notes).trim().slice(0, 8000) || null : null,
      'active'
    );

    if (hasLeadId && leadOk) {
      cols.push('lead_id');
      placeholders.push('?');
      vals.push(leadOk);
    }

    const sql = `INSERT INTO customers (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
    const [result] = await pool.execute(sql, vals);

    res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Client created' });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/** GET cliente ligado a um lead (lead_id). */
export async function getCustomerByLead(req, res) {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    if (!leadId) return res.status(400).json({ success: false, error: 'Invalid lead id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const [colRows] = await pool.query(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'lead_id'`
    );
    if (!colRows.length) {
      return res.json({ success: true, data: null, message: 'lead_id column missing; run migrate:customers-lead-id' });
    }

    const [rows] = await pool.query('SELECT * FROM customers WHERE lead_id = ? LIMIT 1', [leadId]);
    if (!rows.length) return res.json({ success: true, data: null });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('getCustomerByLead:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/** POST corpo { lead_id, customer_type? } — força conversão (qualquer estágio). */
export async function createCustomerFromLead(req, res) {
  try {
    const leadId = parseInt(req.body?.lead_id, 10);
    if (!leadId) return res.status(400).json({ success: false, error: 'lead_id é obrigatório' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const [leads] = await pool.query(
      `SELECT l.*, ps.slug AS pipeline_stage_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [leadId]
    );
    if (!leads.length) return res.status(404).json({ success: false, error: 'Lead not found' });

    const r = await ensureClientFromLead(pool, leads[0], {
      force: true,
      customer_type: req.body?.customer_type,
    });
    if (r.reason === 'invalid_email') {
      return res.status(400).json({
        success: false,
        error: 'Lead sem email válido — corrija no lead antes de criar cliente',
      });
    }
    if (r.created && r.customer_id) {
      return res.status(201).json({
        success: true,
        data: { id: r.customer_id },
        message: 'Client created from lead',
      });
    }
    if (r.customer_id) {
      return res.status(200).json({
        success: true,
        data: { id: r.customer_id },
        message: 'Client already linked to this lead',
      });
    }
    return res.status(400).json({ success: false, error: r.reason || 'Could not create client' });
  } catch (error) {
    console.error('createCustomerFromLead:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const opt = await getCustomersOptionalColumns(pool);
    const [existingRows] = await pool.query(
      'SELECT id, name, customer_type, responsible_name FROM customers WHERE id = ?',
      [req.params.id]
    );
    if (!existingRows.length) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    const row = existingRows[0];

    const {
      name,
      email,
      phone,
      address,
      city,
      state,
      zipcode,
      customer_type,
      owner_id,
      status,
      notes,
      responsible_name,
    } = req.body || {};

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(String(name).trim().slice(0, 255));
    }
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      values.push(phone);
    }
    if (address !== undefined) {
      updates.push('address = ?');
      values.push(address);
    }
    if (city !== undefined) {
      updates.push('city = ?');
      values.push(city);
    }
    if (state !== undefined) {
      updates.push('state = ?');
      values.push(state);
    }
    if (zipcode !== undefined) {
      updates.push('zipcode = ?');
      values.push(zipcode);
    }
    if (customer_type !== undefined) {
      updates.push('customer_type = ?');
      values.push(customer_type);
    }
    if (owner_id !== undefined) {
      updates.push('owner_id = ?');
      values.push(owner_id);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }

    if (opt.has('responsible_name') && (customer_type !== undefined || responsible_name !== undefined)) {
      const effType =
        customer_type !== undefined
          ? String(customer_type).trim()
          : String(row.customer_type || 'residential').trim();
      let effResp =
        responsible_name !== undefined
          ? responsible_name != null && String(responsible_name).trim()
            ? String(responsible_name).trim().slice(0, 255)
            : null
          : row.responsible_name;
      if (effType !== 'builder') effResp = null;
      if (effType === 'builder') {
        const effName =
          name !== undefined
            ? String(name).trim().slice(0, 255)
            : String(row.name || '').trim().slice(0, 255);
        if (effName.length < 2) {
          return res.status(400).json({ success: false, error: 'Para Builder, indique o nome da empresa.' });
        }
        const rs = effResp != null ? String(effResp).trim() : '';
        if (rs.length < 2) {
          return res.status(400).json({ success: false, error: 'Para Builder, indique o responsável.' });
        }
        effResp = rs.slice(0, 255);
      }
      updates.push('responsible_name = ?');
      values.push(effResp);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'Client updated' });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Painel «Ver cliente»: dados do lead (se houver lead_id) e/ou histórico builder (projetos + totais).
 */
export async function getCustomerInsight(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid client id' });
    }

    const [custRows] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
    if (!custRows.length) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    const customer = custRows[0];

    const leadIdRaw = customer.lead_id != null ? parseInt(String(customer.lead_id), 10) : NaN;
    const leadId = Number.isFinite(leadIdRaw) && leadIdRaw > 0 ? leadIdRaw : null;

    let lead_insight = null;
    if (leadId) {
      try {
        const [lr] = await pool.query(
          `SELECT l.*, ps.slug AS pipeline_stage_slug, ps.name AS pipeline_stage_name
           FROM leads l
           LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
           WHERE l.id = ?`,
          [leadId]
        );
        if (lr.length) {
          const lrow = lr[0];
          let quotes_count = 0;
          let estimates_count = 0;
          try {
            const [[q]] = await pool.query('SELECT COUNT(*) AS c FROM quotes WHERE lead_id = ?', [leadId]);
            quotes_count = Number(q?.c) || 0;
          } catch {
            /* */
          }
          try {
            const [[e]] = await pool.query('SELECT COUNT(*) AS c FROM estimates WHERE lead_id = ?', [leadId]);
            estimates_count = Number(e?.c) || 0;
          } catch {
            /* */
          }
          lead_insight = {
            lead: lrow,
            quotes_count,
            estimates_count,
          };
        }
      } catch (e) {
        console.warn('getCustomerInsight lead:', e.message);
      }
    }

    let builder_insight = null;
    const isBuilder = String(customer.customer_type || '').toLowerCase() === 'builder';
    if (isBuilder) {
      try {
        const hasBuilderId = await columnExists(pool, 'projects', 'builder_id');
        const hasClientType = await columnExists(pool, 'projects', 'client_type');
        const hasDeleted = await columnExists(pool, 'projects', 'deleted_at');
        const delClause = hasDeleted ? 'deleted_at IS NULL AND ' : '';
        const typeClause = hasClientType ? "client_type = 'builder' AND " : '';
        let projects = [];
        if (hasBuilderId) {
          const [pr] = await pool.query(
            `SELECT * FROM projects WHERE ${delClause}${typeClause}builder_id = ? ORDER BY created_at DESC`,
            [id]
          );
          projects = pr;
        }

        let totalRev = 0;
        let totalProfit = 0;
        let totalSqft = 0;
        let marginSum = 0;
        let marginN = 0;
        for (const p of projects) {
          const c = money(p.contract_value ?? p.estimated_cost);
          const cost =
            money(p.labor_cost_actual) + money(p.material_cost_actual) + money(p.additional_cost_actual);
          const g = c - cost;
          totalRev += c;
          totalProfit += g;
          totalSqft += money(p.total_sqft);
          if (c > 0) {
            marginSum += (g / c) * 100;
            marginN += 1;
          }
        }

        const mappedProjects = projects.map((p) => {
          const mapped = mapListProjectRow(p);
          return {
            id: mapped.id,
            name: mapped.name,
            project_number: mapped.project_number,
            status: mapped.status,
            contract_value: mapped.contract_value,
            total_cost_actual: mapped.total_cost_actual,
            gross_profit: mapped.gross_profit,
            margin_pct: mapped.margin_pct,
            start_date: mapped.start_date,
          };
        });

        const overall_margin_pct =
          totalRev > 0 ? moneyRound((totalProfit / totalRev) * 100, 1) : 0;

        builder_insight = {
          projects: mappedProjects,
          aggregates: {
            project_count: projects.length,
            total_sqft: moneyRound(totalSqft, 2),
            total_revenue: moneyRound(totalRev, 2),
            total_profit: moneyRound(totalProfit, 2),
            avg_margin_pct: marginN ? moneyRound(marginSum / marginN, 1) : 0,
            overall_margin_pct,
          },
        };
      } catch (e) {
        console.warn('getCustomerInsight builder:', e.message);
        builder_insight = { projects: [], aggregates: null, error: e.message };
      }
    }

    res.json({
      success: true,
      data: {
        customer,
        lead_insight,
        builder_insight,
      },
    });
  } catch (error) {
    console.error('getCustomerInsight:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
