/**
 * Estimates API - Professional Flooring Estimate Engine
 */

import { getDBConnection } from '../config/db.js';
import {
  calculateAdjustedSqft,
  getDefaultWastePercentage,
  recalculateEstimate,
  applySmartRules,
  generateEstimateNumber,
  calculateMarginPercentage
} from '../services/estimateCalculator.js';
import { autoCreateProjectFromEstimate } from '../lib/projectAutomation.js';

/**
 * Listar estimativas
 */
export async function listEstimates(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const projectId = req.query.project_id || null;
    const leadId = req.query.lead_id || null;

    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND e.status = ?';
      params.push(status);
    }
    if (projectId) {
      whereClause += ' AND e.project_id = ?';
      params.push(projectId);
    }
    if (leadId) {
      whereClause += ' AND e.lead_id = ?';
      params.push(leadId);
    }

    const [rows] = await pool.query(
      `SELECT e.*, 
              p.project_number, p.flooring_type, p.total_sqft,
              l.name as lead_name, l.email as lead_email,
              u.name as created_by_name
       FROM estimates e
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN leads l ON e.lead_id = l.id
       LEFT JOIN users u ON e.created_by = u.id
       WHERE ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM estimates e WHERE ${whereClause}`,
      params
    );

    return res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('Error listing estimates:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Obter estimativa com itens
 */
export async function getEstimate(req, res) {
  try {
    const pool = await getDBConnection();
    const estimateId = parseInt(req.params.id);

    if (!estimateId) {
      return res.status(400).json({ success: false, error: 'Invalid estimate ID' });
    }

    // Buscar estimativa
    const [estimates] = await pool.query(
      `SELECT e.*, 
              p.*, p.id as project_id,
              l.name as lead_name, l.email as lead_email,
              u.name as created_by_name
       FROM estimates e
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN leads l ON e.lead_id = l.id
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = ?`,
      [estimateId]
    );

    if (estimates.length === 0) {
      return res.status(404).json({ success: false, error: 'Estimate not found' });
    }

    // Buscar itens
    const [items] = await pool.query(
      'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY category, sort_order, id',
      [estimateId]
    );

    const estimate = estimates[0];
    estimate.items = items;

    return res.json({ success: true, data: estimate });
  } catch (error) {
    console.error('Error getting estimate:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Criar nova estimativa
 */
export async function createEstimate(req, res) {
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;

    const {
      project_id,
      lead_id,
      project_data, // Dados do projeto para aplicar regras
      items = [],
      overhead_percentage = 15,
      profit_margin_percentage = 25
    } = req.body;

    if (!project_id) {
      return res.status(400).json({ success: false, error: 'project_id is required' });
    }

    // Buscar projeto
    const [projects] = await pool.query('SELECT * FROM projects WHERE id = ?', [project_id]);
    if (projects.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const project = projects[0];
    const projectData = project_data || project;

    // Aplicar regras inteligentes
    const autoItems = await applySmartRules(pool, projectData, items);

    // Combinar itens manuais e automáticos
    const allItems = [...items, ...autoItems];

    // Calcular valores
    const calculations = recalculateEstimate(allItems, overhead_percentage, profit_margin_percentage);

    // Gerar número da estimativa
    const estimateNumber = await generateEstimateNumber(pool);

    // Criar estimativa
    const [result] = await pool.execute(
      `INSERT INTO estimates 
       (project_id, lead_id, estimate_number, material_cost_total, labor_cost_total, 
        equipment_cost_total, direct_cost, overhead_percentage, overhead_amount,
        profit_margin_percentage, profit_amount, final_price, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_id,
        lead_id || null,
        estimateNumber,
        calculations.material_cost_total,
        calculations.labor_cost_total,
        calculations.equipment_cost_total,
        calculations.direct_cost,
        calculations.overhead_percentage,
        calculations.overhead_amount,
        calculations.profit_margin_percentage,
        calculations.profit_amount,
        calculations.final_price,
        userId
      ]
    );

    const estimateId = result.insertId;

    // Inserir itens
    if (allItems.length > 0) {
      const itemValues = allItems.map((item, index) => [
        estimateId,
        item.category,
        item.name,
        item.description || null,
        item.unit_type,
        item.quantity,
        item.unit_cost,
        item.total_cost,
        item.is_auto_added ? 1 : 0,
        item.sort_order || index
      ]);

      await pool.query(
        `INSERT INTO estimate_items 
         (estimate_id, category, name, description, unit_type, quantity, unit_cost, total_cost, is_auto_added, sort_order)
         VALUES ?`,
        [itemValues]
      );
    }

    // Buscar estimativa criada
    const [created] = await pool.query(
      `SELECT e.*, p.*, p.id as project_id
       FROM estimates e
       LEFT JOIN projects p ON e.project_id = p.id
       WHERE e.id = ?`,
      [estimateId]
    );

    const [estimateItems] = await pool.query(
      'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY category, sort_order',
      [estimateId]
    );

    created[0].items = estimateItems;

    return res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    console.error('Error creating estimate:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Atualizar estimativa
 */
export async function updateEstimate(req, res) {
  try {
    const pool = await getDBConnection();
    const estimateId = parseInt(req.params.id);

    if (!estimateId) {
      return res.status(400).json({ success: false, error: 'Invalid estimate ID' });
    }

    const [[prevEst]] = await pool.query('SELECT status FROM estimates WHERE id = ?', [estimateId]);
    if (!prevEst) {
      return res.status(404).json({ success: false, error: 'Estimate not found' });
    }
    const oldStatus = String(prevEst.status || '');

    const {
      items,
      overhead_percentage,
      profit_margin_percentage,
      status,
      expiration_date,
      notes,
      client_notes,
      payment_schedule
    } = req.body;

    // Se items foram atualizados, recalcular
    if (items && Array.isArray(items)) {
      const calculations = recalculateEstimate(
        items,
        overhead_percentage !== undefined ? overhead_percentage : null,
        profit_margin_percentage !== undefined ? profit_margin_percentage : null
      );

      // Buscar overhead e profit atuais se não fornecidos
      const [current] = await pool.query('SELECT overhead_percentage, profit_margin_percentage FROM estimates WHERE id = ?', [estimateId]);
      const finalOverhead = overhead_percentage !== undefined ? overhead_percentage : current[0]?.overhead_percentage;
      const finalProfit = profit_margin_percentage !== undefined ? profit_margin_percentage : current[0]?.profit_margin_percentage;

      const finalCalculations = recalculateEstimate(items, finalOverhead, finalProfit);

      // Atualizar estimativa
      await pool.execute(
        `UPDATE estimates SET
         material_cost_total = ?,
         labor_cost_total = ?,
         equipment_cost_total = ?,
         direct_cost = ?,
         overhead_percentage = ?,
         overhead_amount = ?,
         profit_margin_percentage = ?,
         profit_amount = ?,
         final_price = ?
         WHERE id = ?`,
        [
          finalCalculations.material_cost_total,
          finalCalculations.labor_cost_total,
          finalCalculations.equipment_cost_total,
          finalCalculations.direct_cost,
          finalCalculations.overhead_percentage,
          finalCalculations.overhead_amount,
          finalCalculations.profit_margin_percentage,
          finalCalculations.profit_amount,
          finalCalculations.final_price,
          estimateId
        ]
      );

      // Deletar itens antigos e inserir novos
      await pool.execute('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);

      if (items.length > 0) {
        const itemValues = items.map((item, index) => [
          estimateId,
          item.category,
          item.name,
          item.description || null,
          item.unit_type,
          item.quantity,
          item.unit_cost,
          item.total_cost,
          item.is_auto_added ? 1 : 0,
          item.sort_order || index
        ]);

        await pool.query(
          `INSERT INTO estimate_items 
           (estimate_id, category, name, description, unit_type, quantity, unit_cost, total_cost, is_auto_added, sort_order)
           VALUES ?`,
          [itemValues]
        );
      }
    }

    // Atualizar outros campos
    const updates = [];
    const values = [];

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
      if (status === 'sent') updates.push('sent_at = NOW()');
      if (status === 'accepted') updates.push('accepted_at = NOW()');
      if (status === 'declined') updates.push('declined_at = NOW()');
    }
    if (expiration_date !== undefined) {
      updates.push('expiration_date = ?');
      values.push(expiration_date);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }
    if (client_notes !== undefined) {
      updates.push('client_notes = ?');
      values.push(client_notes);
    }
    if (payment_schedule !== undefined) {
      updates.push('payment_schedule = ?');
      values.push(JSON.stringify(payment_schedule));
    }

    if (updates.length > 0) {
      values.push(estimateId);
      await pool.execute(
        `UPDATE estimates SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Retornar estimativa atualizada
    const [updated] = await pool.query(
      `SELECT e.*, p.*, p.id as project_id
       FROM estimates e
       LEFT JOIN projects p ON e.project_id = p.id
       WHERE e.id = ?`,
      [estimateId]
    );

    const [estimateItems] = await pool.query(
      'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY category, sort_order',
      [estimateId]
    );

    updated[0].items = estimateItems;

    const newStatus = String(updated[0].status || '');
    if (newStatus === 'accepted' && oldStatus !== 'accepted') {
      const uid = req.session?.userId != null ? parseInt(String(req.session.userId), 10) : null;
      setImmediate(async () => {
        try {
          const result = await autoCreateProjectFromEstimate(
            pool,
            estimateId,
            Number.isFinite(uid) ? uid : null
          );
          if (result.ok) {
            console.log('[AUTO] Projeto criado/atualizado:', result.project_number || result.project_id);
          } else {
            console.warn('[AUTO] Projeto não sincronizado:', result.error);
          }
        } catch (e) {
          console.error('[AUTO] Erro ao criar projeto:', e.message);
        }
      });
    }

    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error updating estimate:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Deletar estimativa
 */
export async function deleteEstimate(req, res) {
  try {
    const pool = await getDBConnection();
    const estimateId = parseInt(req.params.id);

    if (!estimateId) {
      return res.status(400).json({ success: false, error: 'Invalid estimate ID' });
    }

    await pool.execute('DELETE FROM estimates WHERE id = ?', [estimateId]);

    return res.json({ success: true, message: 'Estimate deleted' });
  } catch (error) {
    console.error('Error deleting estimate:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Obter analytics de estimativas
 */
export async function getEstimateAnalytics(req, res) {
  try {
    const pool = await getDBConnection();

    // Média de margem por tipo de projeto
    const [marginByProjectType] = await pool.query(
      `SELECT p.project_type, 
              AVG(e.profit_margin_percentage) as avg_margin_percentage,
              AVG(e.profit_amount) as avg_margin_amount,
              COUNT(*) as count
       FROM estimates e
       JOIN projects p ON e.project_id = p.id
       WHERE e.status IN ('accepted', 'declined')
       GROUP BY p.project_type`
    );

    // Taxa de aceitação
    const [acceptanceRate] = await pool.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
         SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined,
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as pending
       FROM estimates
       WHERE status IN ('accepted', 'declined', 'sent')`
    );

    // Receita por tipo de piso
    const [revenueByFlooring] = await pool.query(
      `SELECT p.flooring_type,
              SUM(e.final_price) as total_revenue,
              COUNT(*) as count,
              AVG(e.final_price) as avg_price
       FROM estimates e
       JOIN projects p ON e.project_id = p.id
       WHERE e.status = 'accepted'
       GROUP BY p.flooring_type`
    );

    return res.json({
      success: true,
      data: {
        margin_by_project_type: marginByProjectType,
        acceptance_rate: acceptanceRate[0] || {},
        revenue_by_flooring: revenueByFlooring
      }
    });
  } catch (error) {
    console.error('Error getting analytics:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
