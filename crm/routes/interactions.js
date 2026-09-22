/**
 * API Routes para Interactions (chamadas, emails, WhatsApp, visitas)
 * GET, POST /api/leads/:leadId/interactions
 */

import { getDBConnection } from '../config/db.js';

const CREATE_INTERACTIONS_IF_NOT_EXISTS = `
CREATE TABLE IF NOT EXISTS interactions (
  id int(11) NOT NULL AUTO_INCREMENT,
  lead_id int(11) NOT NULL,
  user_id int(11) DEFAULT NULL,
  type varchar(50) NOT NULL,
  subject varchar(255) DEFAULT NULL,
  notes text DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_id (lead_id),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export async function listInteractions(req, res) {
  const leadId = parseInt(req.params.leadId, 10);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    let rows;
    try {
      const [countResult] = await pool.execute(
        'SELECT COUNT(*) as total FROM interactions WHERE lead_id = ?',
        [leadId]
      );
      const total = Number(countResult[0].total) || 0;

      [rows] = await pool.execute(
        `SELECT i.*, u.name as user_name, u.email as user_email
         FROM interactions i
         LEFT JOIN users u ON i.user_id = u.id
         WHERE i.lead_id = ?
         ORDER BY i.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [leadId]
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
    } catch (tableErr) {
      const msg = tableErr.message || '';
      if (msg.includes("doesn't exist") && msg.includes('interactions')) {
        await pool.execute(CREATE_INTERACTIONS_IF_NOT_EXISTS);
        const [countResult] = await pool.execute(
          'SELECT COUNT(*) as total FROM interactions WHERE lead_id = ?',
          [leadId]
        );
        [rows] = await pool.execute(
          `SELECT i.*, u.name as user_name, u.email as user_email
           FROM interactions i
           LEFT JOIN users u ON i.user_id = u.id
           WHERE i.lead_id = ?
           ORDER BY i.created_at DESC
           LIMIT ${limit} OFFSET ${offset}`,
          [leadId]
        );
        return res.json({
          success: true,
          data: rows || [],
          pagination: {
            page,
            limit,
            total: countResult[0].total,
            totalPages: Math.ceil((countResult[0].total || 0) / limit)
          }
        });
      }
      throw tableErr;
    }
  } catch (error) {
    console.error('Error listing interactions:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

const ALLOWED_TYPES = ['call', 'whatsapp', 'email', 'visit', 'meeting'];

export async function createInteraction(req, res) {
  const leadId = parseInt(req.params.leadId, 10);
  const userId = req.session?.user?.id ?? req.session?.userId;
  const userIdNum = userId != null ? parseInt(userId, 10) || null : null;

  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  const body = req.body || {};
  let type = (body.type || '').trim().toLowerCase();
  const notes = body.notes != null ? String(body.notes).trim() : null;
  const subject = body.subject != null ? String(body.subject).trim() : null;

  if (!type) {
    return res.status(400).json({ success: false, error: 'Type is required' });
  }
  if (!ALLOWED_TYPES.includes(type)) {
    type = 'call';
  }

  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    let result;
    try {
      const [cols] = await pool.execute("SHOW COLUMNS FROM interactions WHERE Field = 'subject'");
      const hasSubject = cols && cols.length > 0;
      if (hasSubject) {
        [result] = await pool.execute(
          `INSERT INTO interactions (lead_id, user_id, type, subject, notes) VALUES (?, ?, ?, ?, ?)`,
          [leadId, userIdNum, type, subject || null, notes]
        );
      } else {
        [result] = await pool.execute(
          `INSERT INTO interactions (lead_id, user_id, type, notes) VALUES (?, ?, ?, ?)`,
          [leadId, userIdNum, type, notes]
        );
      }
    } catch (insertErr) {
      if (insertErr.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || insertErr.message?.includes('enum')) {
        type = type === 'meeting' ? 'visit' : 'call';
        [result] = await pool.execute(
          `INSERT INTO interactions (lead_id, user_id, type, notes) VALUES (?, ?, ?, ?)`,
          [leadId, userIdNum, type, notes]
        );
      } else {
        throw insertErr;
      }
    }

    const insertId = Number(result.insertId);
    const [created] = await pool.execute(
      `SELECT i.*, u.name as user_name, u.email as user_email
       FROM interactions i
       LEFT JOIN users u ON i.user_id = u.id
       WHERE i.id = ?`,
      [insertId]
    );

    return res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    const msg = error.message || '';
    if (msg.includes("doesn't exist") && msg.includes('interactions')) {
      try {
        await pool.execute(CREATE_INTERACTIONS_IF_NOT_EXISTS);
        [result] = await pool.execute(
          `INSERT INTO interactions (lead_id, user_id, type, notes) VALUES (?, ?, ?, ?)`,
          [leadId, userIdNum, type, notes]
        );
        const insertId = Number(result.insertId);
        const [created] = await pool.execute(
          `SELECT i.*, u.name as user_name, u.email as user_email
           FROM interactions i LEFT JOIN users u ON i.user_id = u.id WHERE i.id = ?`,
          [insertId]
        );
        return res.status(201).json({ success: true, data: created[0] });
      } catch (retryErr) {
        console.error('Error after creating table:', retryErr);
        return res.status(500).json({ success: false, error: retryErr.message });
      }
    }
    console.error('Error creating interaction:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
