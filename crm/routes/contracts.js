/**
 * Contracts/Financeiro API - Contracts and financial management
 */
import { getDBConnection } from '../config/db.js';
import { setLeadPipelineBySlug } from '../lib/pipelineAutomation.js';

export async function listContracts(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const customerId = req.query.customer_id || null;
    const projectId = req.query.project_id || null;

    let whereClause = '1=1';
    const params = [];

    if (customerId) {
      whereClause += ' AND customer_id = ?';
      params.push(customerId);
    }
    if (projectId) {
      whereClause += ' AND project_id = ?';
      params.push(projectId);
    }

    const [rows] = await pool.query(
      `SELECT c.*, 
              cust.name as customer_name, cust.email as customer_email,
              p.name as project_name, q.quote_number
       FROM contracts c
       LEFT JOIN customers cust ON c.customer_id = cust.id
       LEFT JOIN projects p ON c.project_id = p.id
       LEFT JOIN quotes q ON c.quote_id = q.id
       WHERE ${whereClause}
       ORDER BY c.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM contracts WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List contracts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getContract(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query('SELECT * FROM contracts WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Contract not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get contract error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createContract(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { lead_id, customer_id, project_id, quote_id, closed_amount, payment_method, 
            installments, start_date, end_date, responsible_id } = req.body;

    if (!closed_amount) {
      return res.status(400).json({ success: false, error: 'Closed amount is required' });
    }

    const [result] = await pool.execute(
      `INSERT INTO contracts (lead_id, customer_id, project_id, quote_id, closed_amount, 
                              payment_method, installments, start_date, end_date, responsible_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead_id || null, customer_id || null, project_id || null, quote_id || null,
       closed_amount, payment_method || null, installments || 1,
       start_date || null, end_date || null, responsible_id || null]
    );

    if (lead_id) {
      await setLeadPipelineBySlug(lead_id, 'won');
    }

    res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Contract created' });
  } catch (error) {
    console.error('Create contract error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateContract(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const updates = [];
    const values = [];
    const allowedFields = ['closed_amount', 'payment_method', 'installments', 'start_date', 
                          'end_date', 'responsible_id', 'contract_path', 'signed_at'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(
      `UPDATE contracts SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Contract updated' });
  } catch (error) {
    console.error('Update contract error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
