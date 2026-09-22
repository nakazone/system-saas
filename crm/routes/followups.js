/**
 * Follow-ups API - Tarefas e lembretes para leads
 * GET, POST, PUT, DELETE /api/leads/:leadId/followups
 */

import { getDBConnection } from '../config/db.js';

export async function listFollowups(req, res) {
  const leadId = parseInt(req.params.leadId);
  
  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  try {
    const pool = await getDBConnection();
    
    const [rows] = await pool.execute(
      `SELECT f.*, u.name as assigned_to_name, u.email as assigned_to_email
       FROM tasks f
       LEFT JOIN users u ON f.user_id = u.id
       WHERE f.lead_id = ?
       ORDER BY f.due_date ASC, f.created_at DESC`,
      [leadId]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing followups:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function createFollowup(req, res) {
  const leadId = parseInt(req.params.leadId);
  const userId = req.session?.user?.id;

  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  const body = req.body || {};
  const title = body.title && body.title.trim();
  const description = body.description != null ? body.description.trim() || null : null;
  const due_date = body.due_date || null;
  const priority = body.priority || 'medium';
  const assigned_to = body.assigned_to != null ? parseInt(body.assigned_to, 10) || null : null;
  const user_id = assigned_to ?? userId ?? null;

  if (!title || title.length < 3) {
    return res.status(400).json({ success: false, error: 'Title is required (min 3 characters)' });
  }

  if (!due_date) {
    return res.status(400).json({ success: false, error: 'Due date is required' });
  }

  try {
    const pool = await getDBConnection();
    
    const [result] = await pool.execute(
      `INSERT INTO tasks 
       (lead_id, user_id, title, description, due_date, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        leadId,
        user_id,
        title,
        description,
        due_date,
        priority
      ]
    );

    // Get created followup
    const [created] = await pool.execute(
      `SELECT t.*, u.name as assigned_to_name, u.email as assigned_to_email
       FROM tasks t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    console.error('Error creating followup:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateFollowup(req, res) {
  const followupId = parseInt(req.params.followupId);

  if (!followupId || isNaN(followupId)) {
    return res.status(400).json({ success: false, error: 'Invalid followup ID' });
  }

  const {
    title,
    description,
    due_date,
    priority,
    status,
    assigned_to,
    completed_at
  } = req.body;

  try {
    const pool = await getDBConnection();
    
    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(due_date);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      values.push(priority);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
      if (status === 'completed' && !completed_at) {
        updates.push('completed_at = NOW()');
      } else if (status !== 'completed') {
        updates.push('completed_at = NULL');
      }
    }
    if (completed_at !== undefined) {
      updates.push('completed_at = ?');
      values.push(completed_at);
    }
    if (assigned_to !== undefined) {
      updates.push('user_id = ?');
      values.push(assigned_to);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(followupId);
    await pool.execute(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Get updated followup
    const [updated] = await pool.execute(
      `SELECT t.*, u.name as assigned_to_name, u.email as assigned_to_email
       FROM tasks t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.id = ?`,
      [followupId]
    );

    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error updating followup:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function deleteFollowup(req, res) {
  const followupId = parseInt(req.params.followupId);

  if (!followupId || isNaN(followupId)) {
    return res.status(400).json({ success: false, error: 'Invalid followup ID' });
  }

  try {
    const pool = await getDBConnection();
    await pool.execute('DELETE FROM tasks WHERE id = ?', [followupId]);
    return res.json({ success: true, message: 'Followup deleted' });
  } catch (error) {
    console.error('Error deleting followup:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
