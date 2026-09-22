/**
 * Activities API - Activity log/history
 */
import { getDBConnection } from '../config/db.js';

export async function listActivities(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const leadId = req.query.lead_id || null;
    const customerId = req.query.customer_id || null;
    const projectId = req.query.project_id || null;
    const activityType = req.query.activity_type || null;

    let whereClause = '1=1';
    const params = [];

    if (leadId) {
      whereClause += ' AND lead_id = ?';
      params.push(leadId);
    }
    if (customerId) {
      whereClause += ' AND customer_id = ?';
      params.push(customerId);
    }
    if (projectId) {
      whereClause += ' AND project_id = ?';
      params.push(projectId);
    }
    if (activityType) {
      whereClause += ' AND activity_type = ?';
      params.push(activityType);
    }

    const [rows] = await pool.query(
      `SELECT a.*, 
              u.name as user_name, u.email as user_email
       FROM activities a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE ${whereClause}
       ORDER BY a.activity_date DESC, a.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM activities WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List activities error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createActivity(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { lead_id, customer_id, project_id, activity_type, subject, description, activity_date, owner_id } = req.body;

    if (!activity_type) {
      return res.status(400).json({ success: false, error: 'Activity type is required' });
    }

    const relatedTo = lead_id ? 'lead' : (customer_id ? 'customer' : (project_id ? 'project' : null));

    const [result] = await pool.execute(
      `INSERT INTO activities (lead_id, customer_id, project_id, activity_type, subject, description, 
                              activity_date, user_id, owner_id, related_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead_id || null, customer_id || null, project_id || null, activity_type,
       subject || null, description || null, activity_date || new Date(),
       req.session.userId || null, owner_id || null, relatedTo]
    );

    res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Activity created' });
  } catch (error) {
    console.error('Create activity error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
