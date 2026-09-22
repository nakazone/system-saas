/**
 * API Routes para Proposals (propostas/orçamentos)
 * GET, POST, PUT /api/leads/:leadId/proposals
 */

import { getDBConnection } from '../config/db.js';
import { isNoSuchTableError } from '../lib/mysqlSchemaErrors.js';

export async function listProposals(req, res) {
  const leadId = parseInt(req.params.leadId);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  try {
    const pool = await getDBConnection();
    
    // Contar total
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM proposals WHERE lead_id = ?',
      [leadId]
    );
    const total = countResult[0].total;

    // Buscar propostas
    const [rows] = await pool.execute(
      `SELECT p.*, u.name as created_by_name,
       (SELECT COUNT(*) FROM proposal_items WHERE proposal_id = p.id) as items_count
       FROM proposals p
       LEFT JOIN users u ON p.created_by = u.id
       WHERE p.lead_id = ?
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [leadId, limit, offset]
    );

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    if (isNoSuchTableError(error)) {
      return res.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 }
      });
    }
    console.error('Error listing proposals:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function getProposal(req, res) {
  const proposalId = parseInt(req.params.proposalId);

  if (!proposalId || isNaN(proposalId)) {
    return res.status(400).json({ success: false, error: 'Invalid proposal ID' });
  }

  try {
    const pool = await getDBConnection();
    
    // Buscar proposta
    const [proposalRows] = await pool.execute(
      `SELECT p.*, u.name as created_by_name, l.name as lead_name
       FROM proposals p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN leads l ON p.lead_id = l.id
       WHERE p.id = ?`,
      [proposalId]
    );

    if (proposalRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    // Buscar itens
    const [items] = await pool.execute(
      `SELECT * FROM proposal_items 
       WHERE proposal_id = ?
       ORDER BY \`order\`, id`,
      [proposalId]
    );

    return res.json({
      success: true,
      data: {
        ...proposalRows[0],
        items: items
      }
    });
  } catch (error) {
    console.error('Error getting proposal:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function createProposal(req, res) {
  const leadId = parseInt(req.params.leadId);
  const userId = req.session?.user?.id;

  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  const {
    version = 1,
    proposal_number,
    items = [],
    tax_rate = 0,
    discount_amount = 0,
    discount_percentage = 0,
    valid_until,
    notes
  } = req.body;

  try {
    const pool = await getDBConnection();
    
    // Calcular totais dos itens
    let subtotal = 0;
    items.forEach(item => {
      const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0) + (parseFloat(item.labor_cost) || 0);
      subtotal += lineTotal;
    });

    // Aplicar desconto
    const discount = discount_percentage > 0 
      ? subtotal * (discount_percentage / 100)
      : discount_amount;
    const subtotalAfterDiscount = subtotal - discount;

    // Calcular imposto
    const taxAmount = subtotalAfterDiscount * (tax_rate / 100);
    const totalValue = subtotalAfterDiscount + taxAmount;

    // Gerar número da proposta se não fornecido
    let finalProposalNumber = proposal_number;
    if (!finalProposalNumber) {
      const [lastProposal] = await pool.execute(
        'SELECT proposal_number FROM proposals WHERE proposal_number LIKE ? ORDER BY id DESC LIMIT 1',
        [`PROP-${new Date().getFullYear()}-%`]
      );
      
      let nextNum = 1;
      if (lastProposal.length > 0) {
        const match = lastProposal[0].proposal_number.match(/\d+$/);
        if (match) nextNum = parseInt(match[0]) + 1;
      }
      finalProposalNumber = `PROP-${new Date().getFullYear()}-${String(nextNum).padStart(3, '0')}`;
    }

    // Criar proposta
    const [result] = await pool.execute(
      `INSERT INTO proposals 
       (lead_id, version, proposal_number, total_value, subtotal, tax_rate, tax_amount,
        discount_amount, discount_percentage, valid_until, notes, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        leadId, version, finalProposalNumber, totalValue, subtotal, tax_rate, taxAmount,
        discount, discount_percentage, valid_until, notes, userId
      ]
    );

    const proposalId = result.insertId;

    // Criar itens
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0) + (parseFloat(item.labor_cost) || 0);
      
      await pool.execute(
        `INSERT INTO proposal_items 
         (proposal_id, product, product_code, description, quantity, unit,
          unit_price, labor_cost, material_cost, margin_percentage, line_total, \`order\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proposalId, item.product, item.product_code, item.description,
          item.quantity || 1, item.unit || 'sqft', item.unit_price || 0,
          item.labor_cost || 0, item.material_cost || 0,
          item.margin_percentage, lineTotal, item.order || i
        ]
      );
    }

    // Buscar proposta criada com itens
    const [created] = await pool.execute(
      `SELECT p.*, u.name as created_by_name, l.name as lead_name
       FROM proposals p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN leads l ON p.lead_id = l.id
       WHERE p.id = ?`,
      [proposalId]
    );

    const [createdItems] = await pool.execute(
      'SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY `order`, id',
      [proposalId]
    );

    return res.status(201).json({
      success: true,
      data: {
        ...created[0],
        items: createdItems
      }
    });
  } catch (error) {
    console.error('Error creating proposal:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateProposal(req, res) {
  const proposalId = parseInt(req.params.proposalId);
  const userId = req.session?.user?.id;

  if (!proposalId || isNaN(proposalId)) {
    return res.status(400).json({ success: false, error: 'Invalid proposal ID' });
  }

  const {
    status,
    sent_at,
    viewed_at,
    accepted_at,
    rejected_at,
    rejection_reason,
    notes,
    items
  } = req.body;

  try {
    const pool = await getDBConnection();
    
    // Atualizar proposta
    const updateFields = [];
    const updateValues = [];

    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    if (sent_at !== undefined) {
      updateFields.push('sent_at = ?');
      updateValues.push(sent_at);
    }
    if (viewed_at !== undefined) {
      updateFields.push('viewed_at = ?');
      updateValues.push(viewed_at);
    }
    if (accepted_at !== undefined) {
      updateFields.push('accepted_at = ?');
      updateValues.push(accepted_at);
    }
    if (rejected_at !== undefined) {
      updateFields.push('rejected_at = ?');
      updateValues.push(rejected_at);
    }
    if (rejection_reason !== undefined) {
      updateFields.push('rejection_reason = ?');
      updateValues.push(rejection_reason);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateValues.push(notes);
    }

    if (updateFields.length > 0) {
      updateValues.push(proposalId);
      await pool.execute(
        `UPDATE proposals SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    // Se items foram fornecidos, atualizar (remover antigos e criar novos)
    if (items && Array.isArray(items)) {
      await pool.execute('DELETE FROM proposal_items WHERE proposal_id = ?', [proposalId]);
      
      // Recalcular totais
      let subtotal = 0;
      items.forEach(item => {
        const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0) + (parseFloat(item.labor_cost) || 0);
        subtotal += lineTotal;
      });

      const discount = (subtotal * (parseFloat(req.body.discount_percentage) || 0) / 100) || (parseFloat(req.body.discount_amount) || 0);
      const subtotalAfterDiscount = subtotal - discount;
      const taxRate = parseFloat(req.body.tax_rate) || 0;
      const taxAmount = subtotalAfterDiscount * (taxRate / 100);
      const totalValue = subtotalAfterDiscount + taxAmount;

      await pool.execute(
        `UPDATE proposals SET subtotal = ?, discount_amount = ?, tax_amount = ?, total_value = ? WHERE id = ?`,
        [subtotal, discount, taxAmount, totalValue, proposalId]
      );

      // Criar novos itens
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0) + (parseFloat(item.labor_cost) || 0);
        
        await pool.execute(
          `INSERT INTO proposal_items 
           (proposal_id, product, product_code, description, quantity, unit,
            unit_price, labor_cost, material_cost, margin_percentage, line_total, \`order\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            proposalId, item.product, item.product_code, item.description,
            item.quantity || 1, item.unit || 'sqft', item.unit_price || 0,
            item.labor_cost || 0, item.material_cost || 0,
            item.margin_percentage, lineTotal, item.order || i
          ]
        );
      }
    }

    // Buscar atualizado
    const [updated] = await pool.execute(
      `SELECT p.*, u.name as created_by_name, l.name as lead_name
       FROM proposals p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN leads l ON p.lead_id = l.id
       WHERE p.id = ?`,
      [proposalId]
    );

    const [updatedItems] = await pool.execute(
      'SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY `order`, id',
      [proposalId]
    );

    return res.json({
      success: true,
      data: {
        ...updated[0],
        items: updatedItems
      }
    });
  } catch (error) {
    console.error('Error updating proposal:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
