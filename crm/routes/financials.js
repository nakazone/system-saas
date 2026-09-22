/**
 * Financial Management API
 * Gestão financeira completa
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDBConnection } from '../config/db.js';
import { updateVendorTotalSpent } from '../lib/financialEngine.js';
import {
  recalculateProjectFinancial,
  allocateExpense,
  allocatePayroll,
  calculateRealTimeProfitAnalysis
} from '../services/financialCalculator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function unlinkExpenseReceiptFile(relRaw) {
  if (!relRaw) return;
  const rel = String(relRaw)
    .trim()
    .replace(/^\/+/, '')
    .replace(/^\/?uploads\/?/, '');
  if (!rel || rel.includes('..')) return;
  const base = path.resolve(path.join(__dirname, '..', 'uploads'));
  const abs = path.resolve(path.join(base, rel));
  try {
    if ((abs === base || abs.startsWith(base + path.sep)) && fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  } catch (_) {
    /* já ausente */
  }
}

async function tableColumnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

/** BD legada sem `projects.project_number` */
let _projectsHasProjectNumberCol = null;

async function sqlProjectsProjectNumberSelect(pool, alias = 'p') {
  if (!pool) return `NULL AS project_number`;
  if (_projectsHasProjectNumberCol === null) {
    _projectsHasProjectNumberCol = await tableColumnExists(pool, 'projects', 'project_number');
  }
  return _projectsHasProjectNumberCol ? `${alias}.project_number` : `NULL AS project_number`;
}

/**
 * Obter financial de um projeto
 */
export async function getProjectFinancial(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.projectId);
    const pnSel = await sqlProjectsProjectNumberSelect(pool);

    let [financials] = await pool.query(
      `SELECT pf.*, ${pnSel}, p.status as project_status
       FROM project_financials pf
       JOIN projects p ON pf.project_id = p.id
       WHERE pf.project_id = ?`,
      [projectId]
    );
    
    if (financials.length === 0) {
      // Criar financial inicial se não existir
      await pool.execute(
        `INSERT INTO project_financials (project_id) VALUES (?)`,
        [projectId]
      );
      [financials] = await pool.query(
        `SELECT pf.*, ${pnSel}, p.status as project_status
         FROM project_financials pf
         JOIN projects p ON pf.project_id = p.id
         WHERE pf.project_id = ?`,
        [projectId]
      );
    }
    
    const financial = financials[0];
    const analysis = await calculateRealTimeProfitAnalysis(pool, projectId);
    
    return res.json({ success: true, data: analysis || financial });
  } catch (error) {
    console.error('Error getting project financial:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Atualizar financial do projeto
 */
export async function updateProjectFinancial(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.projectId);
    
    const {
      estimated_revenue,
      estimated_material_cost,
      estimated_labor_cost,
      estimated_overhead,
      actual_revenue,
      actual_material_cost,
      actual_labor_cost,
      actual_overhead,
      is_locked
    } = req.body;
    
    // Buscar financial existente
    let [financials] = await pool.query(
      'SELECT * FROM project_financials WHERE project_id = ?',
      [projectId]
    );
    
    if (financials.length === 0) {
      // Criar se não existir
      await pool.execute(
        `INSERT INTO project_financials (project_id) VALUES (?)`,
        [projectId]
      );
      [financials] = await pool.query(
        'SELECT * FROM project_financials WHERE project_id = ?',
        [projectId]
      );
    }
    
    const financial = financials[0];
    
    // Atualizar campos fornecidos
    const updates = [];
    const values = [];
    
    if (estimated_revenue !== undefined) {
      updates.push('estimated_revenue = ?');
      values.push(estimated_revenue);
    }
    if (estimated_material_cost !== undefined) {
      updates.push('estimated_material_cost = ?');
      values.push(estimated_material_cost);
    }
    if (estimated_labor_cost !== undefined) {
      updates.push('estimated_labor_cost = ?');
      values.push(estimated_labor_cost);
    }
    if (estimated_overhead !== undefined) {
      updates.push('estimated_overhead = ?');
      values.push(estimated_overhead);
    }
    if (actual_revenue !== undefined) {
      updates.push('actual_revenue = ?');
      values.push(actual_revenue);
    }
    if (actual_material_cost !== undefined) {
      updates.push('actual_material_cost = ?');
      values.push(actual_material_cost);
    }
    if (actual_labor_cost !== undefined) {
      updates.push('actual_labor_cost = ?');
      values.push(actual_labor_cost);
    }
    if (actual_overhead !== undefined) {
      updates.push('actual_overhead = ?');
      values.push(actual_overhead);
    }
    if (is_locked !== undefined) {
      updates.push('is_locked = ?');
      values.push(is_locked ? 1 : 0);
      if (is_locked) {
        updates.push('locked_at = NOW()');
        updates.push('locked_by = ?');
        values.push(req.session?.user?.id);
      }
    }
    
    if (updates.length > 0) {
      values.push(projectId);
      await pool.execute(
        `UPDATE project_financials SET ${updates.join(', ')} WHERE project_id = ?`,
        values
      );
    }
    
    // Recalcular valores
    const updatedFinancial = await calculateRealTimeProfitAnalysis(pool, projectId);
    
    return res.json({ success: true, data: updatedFinancial });
  } catch (error) {
    console.error('Error updating project financial:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Listar expenses
 */
export async function listExpenses(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
    const category = req.query.category || null;
    const status = req.query.status || null;
    const startDate = req.query.start_date || null;
    const endDate = req.query.end_date || null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (projectId) {
      whereClause += ' AND e.project_id = ?';
      params.push(projectId);
    }
    if (category) {
      whereClause += ' AND e.category = ?';
      params.push(category);
    }
    if (status) {
      whereClause += ' AND e.status = ?';
      params.push(status);
    }
    if (startDate) {
      whereClause += ' AND e.expense_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND e.expense_date <= ?';
      params.push(endDate);
    }

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 100;

    const pnSel = await sqlProjectsProjectNumberSelect(pool);
    const [rows] = await pool.query(
      `SELECT e.*,
              ${pnSel},
              u1.name as created_by_name,
              u2.name as approved_by_name
       FROM expenses e
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN users u1 ON e.created_by = u1.id
       LEFT JOIN users u2 ON e.approved_by = u2.id
       WHERE ${whereClause}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT ?`,
      [...params, limit]
    );
    
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing expenses:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Criar expense
 */
export async function createExpense(req, res) {
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;
    
    const {
      category,
      project_id,
      vendor_id: bodyVendorId,
      vendor,
      description,
      amount,
      tax_amount = 0,
      payment_method,
      expense_date,
      receipt_url,
      receipt_file_path
    } = req.body;

    if (!category || !description || !amount || !expense_date) {
      return res.status(400).json({
        success: false,
        error: 'category, description, amount, and expense_date are required'
      });
    }

    let vendorId =
      bodyVendorId != null && bodyVendorId !== '' ? parseInt(String(bodyVendorId), 10) : null;
    if (!Number.isFinite(vendorId) || vendorId <= 0) vendorId = null;

    let vendorStr =
      vendor != null && String(vendor).trim() !== '' ? String(vendor).trim().slice(0, 255) : null;

    if (vendorId) {
      const [vr] = await pool.query('SELECT name FROM vendors WHERE id = ? LIMIT 1', [vendorId]);
      if (vr.length) {
        vendorStr = String(vr[0].name).slice(0, 255);
      } else {
        vendorId = null;
      }
    }

    const totalAmount = parseFloat(amount) + (parseFloat(tax_amount) || 0);

    const hasVendorIdCol = await tableColumnExists(pool, 'expenses', 'vendor_id');
    const hasVendorNameCol = await tableColumnExists(pool, 'expenses', 'vendor_name');

    const cols = ['category', 'project_id'];
    const vals = [category, project_id || null];
    if (hasVendorIdCol) {
      cols.push('vendor_id');
      vals.push(vendorId);
    }
    if (hasVendorNameCol) {
      cols.push('vendor_name');
      vals.push(vendorStr);
    }
    cols.push(
      'vendor',
      'description',
      'amount',
      'tax_amount',
      'total_amount',
      'payment_method',
      'expense_date',
      'receipt_url',
      'receipt_file_path',
      'created_by',
      'status'
    );
    vals.push(
      vendorStr,
      description,
      amount,
      tax_amount || 0,
      totalAmount,
      payment_method || null,
      expense_date,
      receipt_url || null,
      receipt_file_path || null,
      userId,
      'pending'
    );

    const sql = `INSERT INTO expenses (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const [result] = await pool.execute(sql, vals);

    const pnSel = await sqlProjectsProjectNumberSelect(pool);
    const [created] = await pool.query(
      `SELECT e.*, ${pnSel}
       FROM expenses e
       LEFT JOIN projects p ON e.project_id = p.id
       WHERE e.id = ?`,
      [result.insertId]
    );
    
    if (vendorId) {
      await updateVendorTotalSpent(pool, vendorId);
    }

    return res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    console.error('Error creating expense:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Obter uma despesa por id (edição / detalhe).
 */
export async function getExpense(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const pnSel = await sqlProjectsProjectNumberSelect(pool);
    const [rows] = await pool.query(
      `SELECT e.*,
              ${pnSel},
              u1.name as created_by_name,
              u2.name as approved_by_name
       FROM expenses e
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN users u1 ON e.created_by = u1.id
       LEFT JOIN users u2 ON e.approved_by = u2.id
       WHERE e.id = ?`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error getting expense:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Atualizar despesa (campos editáveis + recibo por URL/path se necessário).
 */
export async function updateExpense(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const [[before]] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!before) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const b = req.body || {};
    const hasVendorIdCol = await tableColumnExists(pool, 'expenses', 'vendor_id');
    const hasVendorNameCol = await tableColumnExists(pool, 'expenses', 'vendor_name');

    const updates = [];
    const vals = [];
    const add = (col, val) => {
      updates.push(`\`${col}\` = ?`);
      vals.push(val);
    };

    if (b.category !== undefined) add('category', b.category);
    if (b.description !== undefined) add('description', b.description);
    if (b.expense_date !== undefined) add('expense_date', b.expense_date);
    if (b.payment_method !== undefined) add('payment_method', b.payment_method || null);
    if (b.project_id !== undefined) {
      const pid = b.project_id != null && String(b.project_id).trim() !== '' ? parseInt(String(b.project_id), 10) : null;
      add('project_id', Number.isFinite(pid) && pid > 0 ? pid : null);
    }

    let amt = parseFloat(before.amount);
    let tax = parseFloat(before.tax_amount) || 0;
    if (b.amount !== undefined) {
      const x = parseFloat(b.amount);
      amt = Number.isFinite(x) ? x : amt;
    }
    if (b.tax_amount !== undefined) {
      const x = parseFloat(b.tax_amount);
      tax = Number.isFinite(x) ? x : 0;
    }
    if (b.amount !== undefined || b.tax_amount !== undefined) {
      add('amount', amt);
      add('tax_amount', tax);
      add('total_amount', amt + tax);
    }

    if (b.vendor_id !== undefined || b.vendor !== undefined) {
      let vendorId =
        before.vendor_id != null ? parseInt(String(before.vendor_id), 10) : null;
      if (!Number.isFinite(vendorId) || vendorId <= 0) vendorId = null;

      if (b.vendor_id !== undefined) {
        const raw = b.vendor_id != null && String(b.vendor_id).trim() !== '' ? parseInt(String(b.vendor_id), 10) : null;
        vendorId = Number.isFinite(raw) && raw > 0 ? raw : null;
      }

      let vendorStr =
        before.vendor != null && String(before.vendor).trim() !== ''
          ? String(before.vendor).trim().slice(0, 255)
          : null;
      if (b.vendor !== undefined) {
        const t = String(b.vendor || '').trim();
        vendorStr = t ? t.slice(0, 255) : null;
      }

      if (vendorId) {
        const [vr] = await pool.query('SELECT name FROM vendors WHERE id = ? LIMIT 1', [vendorId]);
        if (vr.length) {
          vendorStr = String(vr[0].name).slice(0, 255);
        } else {
          vendorId = null;
        }
      }

      if (hasVendorIdCol) add('vendor_id', vendorId);
      if (hasVendorNameCol) add('vendor_name', vendorStr);
      add('vendor', vendorStr);
    }

    if (b.receipt_url !== undefined) add('receipt_url', b.receipt_url || null);
    if (b.receipt_file_path !== undefined) add('receipt_file_path', b.receipt_file_path || null);

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    const oldRecPath = before.receipt_file_path ? String(before.receipt_file_path).trim() : '';
    if (oldRecPath) {
      const clearingRec =
        (b.receipt_file_path !== undefined && (b.receipt_file_path == null || b.receipt_file_path === '')) ||
        (b.receipt_url !== undefined && (b.receipt_url == null || b.receipt_url === ''));
      const newPath =
        b.receipt_file_path !== undefined && b.receipt_file_path != null
          ? String(b.receipt_file_path).trim()
          : null;
      const replacingRec =
        b.receipt_file_path !== undefined && newPath && newPath !== oldRecPath;
      if (clearingRec || replacingRec) {
        unlinkExpenseReceiptFile(oldRecPath);
      }
    }

    vals.push(id);
    await pool.execute(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`, vals);

    const toRefresh = new Set();
    const vb = before.vendor_id != null ? parseInt(String(before.vendor_id), 10) : null;
    if (Number.isFinite(vb) && vb > 0) toRefresh.add(vb);
    const [[afterV]] = await pool.query('SELECT vendor_id FROM expenses WHERE id = ?', [id]);
    const va = afterV?.vendor_id != null ? parseInt(String(afterV.vendor_id), 10) : null;
    if (Number.isFinite(va) && va > 0) toRefresh.add(va);
    for (const vid of toRefresh) {
      await updateVendorTotalSpent(pool, vid);
    }

    const pnSel = await sqlProjectsProjectNumberSelect(pool);
    const [rows] = await pool.query(
      `SELECT e.*,
              ${pnSel},
              u1.name as created_by_name,
              u2.name as approved_by_name
       FROM expenses e
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN users u1 ON e.created_by = u1.id
       LEFT JOIN users u2 ON e.approved_by = u2.id
       WHERE e.id = ?`,
      [id]
    );

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error updating expense:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Aprovar expense
 */
export async function approveExpense(req, res) {
  try {
    const pool = await getDBConnection();
    const expenseId = parseInt(req.params.id);
    const userId = req.session?.user?.id;

    const [[before]] = await pool.query('SELECT vendor_id FROM expenses WHERE id = ?', [expenseId]);
    
    // Atualizar status
    await pool.execute(
      `UPDATE expenses 
       SET status = 'approved', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, expenseId]
    );
    
    // Alocar automaticamente
    await allocateExpense(pool, expenseId);
    
    const [updated] = await pool.query('SELECT * FROM expenses WHERE id = ?', [expenseId]);

    const vid = before && before.vendor_id != null ? parseInt(String(before.vendor_id), 10) : null;
    if (vid && Number.isFinite(vid) && vid > 0) {
      await updateVendorTotalSpent(pool, vid);
    }
    
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error approving expense:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Eliminar despesa (tabela expenses) e atualizar total do fornecedor.
 */
export async function deleteExpense(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }
    const [[row]] = await pool.query(
      'SELECT id, vendor_id, receipt_file_path FROM expenses WHERE id = ? LIMIT 1',
      [id]
    );
    if (!row) {
      return res.status(404).json({ success: false, error: 'Despesa não encontrada' });
    }
    await pool.execute('DELETE FROM expenses WHERE id = ?', [id]);
    if (row.receipt_file_path) unlinkExpenseReceiptFile(row.receipt_file_path);
    const vid = row.vendor_id != null ? parseInt(String(row.vendor_id), 10) : null;
    if (vid && Number.isFinite(vid) && vid > 0) {
      await updateVendorTotalSpent(pool, vid);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Listar payroll entries
 */
export async function listPayrollEntries(req, res) {
  try {
    const pool = await getDBConnection();
    const employeeId = req.query.employee_id ? parseInt(req.query.employee_id) : null;
    const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
    const approved = req.query.approved !== undefined ? req.query.approved === 'true' : null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (employeeId) {
      whereClause += ' AND pe.employee_id = ?';
      params.push(employeeId);
    }
    if (projectId) {
      whereClause += ' AND pe.project_id = ?';
      params.push(projectId);
    }
    if (approved !== null) {
      whereClause += ' AND pe.approved = ?';
      params.push(approved ? 1 : 0);
    }

    const pnSel = await sqlProjectsProjectNumberSelect(pool);
    const [rows] = await pool.query(
      `SELECT pe.*,
              u.name as employee_name,
              ${pnSel},
              c.name as crew_name
       FROM payroll_entries pe
       JOIN users u ON pe.employee_id = u.id
       LEFT JOIN projects p ON pe.project_id = p.id
       LEFT JOIN crews c ON pe.crew_id = c.id
       WHERE ${whereClause}
       ORDER BY pe.date DESC
       LIMIT 100`,
      params
    );
    
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing payroll entries:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Criar payroll entry
 */
export async function createPayrollEntry(req, res) {
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;
    
    const {
      employee_id,
      project_id,
      crew_id,
      date,
      hours_worked,
      hourly_rate,
      overtime_hours = 0,
      overtime_rate = null
    } = req.body;
    
    if (!employee_id || !date || !hours_worked || !hourly_rate) {
      return res.status(400).json({ 
        success: false, 
        error: 'employee_id, date, hours_worked, and hourly_rate are required' 
      });
    }
    
    const totalCost = parseFloat(hours_worked) * parseFloat(hourly_rate);
    const overtimeCost = parseFloat(overtime_hours) * (parseFloat(overtime_rate) || parseFloat(hourly_rate) * 1.5);
    
    const [result] = await pool.execute(
      `INSERT INTO payroll_entries
       (employee_id, project_id, crew_id, date, hours_worked, hourly_rate,
        total_cost, overtime_hours, overtime_rate, overtime_cost, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        project_id || null,
        crew_id || null,
        date,
        hours_worked,
        hourly_rate,
        totalCost,
        overtime_hours || 0,
        overtime_rate || null,
        overtimeCost,
        userId
      ]
    );
    
    const [created] = await pool.query(
      `SELECT pe.*, u.name as employee_name
       FROM payroll_entries pe
       JOIN users u ON pe.employee_id = u.id
       WHERE pe.id = ?`,
      [result.insertId]
    );
    
    return res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    console.error('Error creating payroll entry:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Aprovar payroll entry
 */
export async function approvePayrollEntry(req, res) {
  try {
    const pool = await getDBConnection();
    const entryId = parseInt(req.params.id);
    const userId = req.session?.user?.id;
    
    // Atualizar status
    await pool.execute(
      `UPDATE payroll_entries 
       SET approved = 1, approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, entryId]
    );
    
    // Alocar automaticamente
    await allocatePayroll(pool, entryId);
    
    const [updated] = await pool.query('SELECT * FROM payroll_entries WHERE id = ?', [entryId]);
    
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error approving payroll entry:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Dashboard financeiro
 */
export async function getFinancialDashboard(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const startDate = req.query.start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = req.query.end_date || new Date().toISOString().split('T')[0];
    
    // Custo estimado = material + mão de obra + overhead (schema schema-financial-engine.sql)
    let revenueCost = [{}];
    try {
      const [rows] = await pool.query(
        `SELECT 
         SUM(estimated_revenue) as estimated_revenue,
         SUM(actual_revenue) as actual_revenue,
         SUM(COALESCE(estimated_material_cost,0) + COALESCE(estimated_labor_cost,0) + COALESCE(estimated_overhead,0)) as estimated_cost,
         SUM(actual_total_cost) as actual_cost,
         SUM(estimated_profit) as estimated_profit,
         SUM(actual_profit) as actual_profit
       FROM project_financials
       WHERE created_at BETWEEN ? AND ?`,
        [startDate, endDate]
      );
      revenueCost = rows;
    } catch (e) {
      console.warn('getFinancialDashboard revenue_vs_cost:', e.message);
    }

    let expenseBreakdown = [];
    try {
      const [rows] = await pool.query(
        `SELECT category, SUM(total_amount) as total
       FROM expenses
       WHERE status IN ('approved', 'paid') AND expense_date BETWEEN ? AND ?
       GROUP BY category
       ORDER BY total DESC`,
        [startDate, endDate]
      );
      expenseBreakdown = rows;
    } catch (e) {
      console.warn('getFinancialDashboard expense_breakdown:', e.message);
    }

    let cashFlow = [];
    try {
      const [rows] = await pool.query(
        `SELECT 
         DATE_FORMAT(expense_date, '%Y-%m') as month,
         SUM(total_amount) as expenses,
         (SELECT SUM(actual_revenue) FROM project_financials 
          WHERE DATE_FORMAT(updated_at, '%Y-%m') = DATE_FORMAT(expenses.expense_date, '%Y-%m')) as revenue
       FROM expenses
       WHERE status IN ('approved', 'paid') AND expense_date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ORDER BY month`,
        [startDate, endDate]
      );
      cashFlow = rows;
    } catch (e) {
      console.warn('getFinancialDashboard monthly_cash_flow:', e.message);
    }

    let profitabilityRanking = [];
    try {
      const pnSel = await sqlProjectsProjectNumberSelect(pool);
      const [rows] = await pool.query(
        `SELECT 
         pf.project_id,
         ${pnSel},
         pf.actual_profit,
         pf.actual_margin_percentage,
         pf.profit_variance
       FROM project_financials pf
       JOIN projects p ON pf.project_id = p.id
       WHERE pf.actual_profit IS NOT NULL
       ORDER BY pf.actual_profit DESC
       LIMIT 10`
      );
      profitabilityRanking = rows;
    } catch (e) {
      console.warn('getFinancialDashboard profitability_ranking:', e.message);
    }

    let crewCosts = [];
    try {
      const [rows] = await pool.query(
        `SELECT 
         c.id as crew_id,
         c.name as crew_name,
         SUM(pe.total_cost + pe.overtime_cost) as total_cost,
         SUM(pe.hours_worked + pe.overtime_hours) as total_hours
       FROM payroll_entries pe
       JOIN crews c ON pe.crew_id = c.id
       WHERE pe.approved = 1 AND pe.date BETWEEN ? AND ?
       GROUP BY c.id, c.name
       ORDER BY total_cost DESC`,
        [startDate, endDate]
      );
      crewCosts = rows;
    } catch (e) {
      console.warn('getFinancialDashboard crew_cost_analysis:', e.message);
    }

    return res.json({
      success: true,
      data: {
        revenue_vs_cost: revenueCost[0] || {},
        expense_breakdown: expenseBreakdown,
        monthly_cash_flow: cashFlow,
        profitability_ranking: profitabilityRanking,
        crew_cost_analysis: crewCosts,
      },
    });
  } catch (error) {
    console.error('Error getting financial dashboard:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
