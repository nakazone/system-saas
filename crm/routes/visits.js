/**
 * Visits/Schedule API - Site visits and scheduling
 */
import { getDBConnection } from '../config/db.js';
import { syncVisitById } from '../services/googleCalendarSync.js';

function buildAddressFromParts({ address, address_line1, address_line2, city, zipcode }) {
  if (address && String(address).trim()) return String(address).trim();
  const parts = [address_line1, address_line2, city, zipcode].filter(Boolean).map(String).map((s) => s.trim());
  return parts.join(', ') || '';
}

/** DB enum: scheduled, completed, cancelled, no_show */
function normalizeVisitStatus(s) {
  const v = (s && String(s).toLowerCase()) || '';
  if (['scheduled', 'completed', 'cancelled', 'no_show'].includes(v)) return v;
  return 'scheduled';
}

/** Aceita datetime-local (…T…) ou MySQL */
function normalizeScheduledAt(v) {
  if (v === undefined || v === null) return null;
  let s = typeof v === 'string' ? v.trim() : String(v);
  if (!s) return null;
  if (s.includes('T')) {
    s = s.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
  }
  return s;
}

function isUnknownColumnError(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || (err.message && /Unknown column/i.test(err.message)));
}

export async function listVisits(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const sellerId = req.query.seller_id || null;
    const leadId = req.query.lead_id || null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;

    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND v.status = ?';
      params.push(status);
    }
    if (sellerId) {
      whereClause += ' AND v.assigned_to = ?';
      params.push(sellerId);
    }
    if (leadId) {
      whereClause += ' AND v.lead_id = ?';
      params.push(leadId);
    }
    if (dateFrom) {
      whereClause += ' AND DATE(v.scheduled_at) >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClause += ' AND DATE(v.scheduled_at) <= ?';
      params.push(dateTo);
    }

    const baseFrom = `FROM visits v
       LEFT JOIN leads l ON v.lead_id = l.id`;

    let rows;
    let total;
    const limitParams = [...params, limit, offset];

    try {
      [rows] = await pool.query(
        `SELECT v.*, 
                l.name as lead_name, l.email as lead_email, l.phone as lead_phone,
                u.name as assigned_to_name
         ${baseFrom}
         LEFT JOIN users u ON u.id = v.assigned_to
         WHERE ${whereClause}
         ORDER BY v.scheduled_at ASC 
         LIMIT ? OFFSET ?`,
        limitParams
      );
      [[{ total }]] = await pool.query(
        `SELECT COUNT(*) as total FROM visits v WHERE ${whereClause}`,
        params
      );
    } catch (e) {
      if (!isUnknownColumnError(e)) throw e;
      const whereLegacy = whereClause.replace(/v\.assigned_to/g, 'v.seller_id');
      const paramsLegacy = [...params];
      [rows] = await pool.query(
        `SELECT v.*, 
                l.name as lead_name, l.email as lead_email, l.phone as lead_phone,
                u.name as assigned_to_name
         ${baseFrom}
         LEFT JOIN users u ON u.id = v.seller_id
         WHERE ${whereLegacy}
         ORDER BY v.scheduled_at ASC 
         LIMIT ? OFFSET ?`,
        limitParams
      );
      [[{ total }]] = await pool.query(
        `SELECT COUNT(*) as total FROM visits v WHERE ${whereLegacy}`,
        paramsLegacy
      );
    }

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List visits error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getVisit(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query('SELECT * FROM visits WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Visit not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get visit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

async function updateLeadToVisitScheduled(pool, leadId) {
  if (!leadId) return;
  try {
    const [stageRows] = await pool.query(
      `SELECT id, slug FROM pipeline_stages
       WHERE slug IN ('meeting_scheduled','visit_scheduled')
       ORDER BY FIELD(slug,'meeting_scheduled','visit_scheduled') LIMIT 1`
    );
    if (stageRows.length > 0) {
      const row = stageRows[0];
      await pool.execute('UPDATE leads SET pipeline_stage_id = ?, status = ? WHERE id = ?', [
        row.id,
        row.slug,
        leadId,
      ]);
    }
  } catch (updateErr) {
    console.warn('Could not update lead pipeline stage:', updateErr.message);
  }
}

export async function createVisit(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const body = req.body || {};
    const {
      lead_id,
      customer_id,
      project_id,
      scheduled_at: scheduledRaw,
      seller_id,
      assigned_to,
      technician_id,
      address,
      address_line1,
      address_line2,
      city,
      zipcode,
      notes,
    } = body;

    const scheduled_at = normalizeScheduledAt(scheduledRaw) || (typeof scheduledRaw === 'string' ? scheduledRaw.trim() : null);
    if (!scheduled_at) {
      return res.status(400).json({ success: false, error: 'Scheduled date/time is required' });
    }

    const leadIdInt = lead_id != null ? parseInt(lead_id, 10) : null;
    if (!leadIdInt || Number.isNaN(leadIdInt)) {
      return res.status(400).json({ success: false, error: 'Valid lead_id is required' });
    }

    const assignedUserIdRaw = assigned_to != null && assigned_to !== '' ? assigned_to : seller_id;
    let assignedUserId = null;
    if (assignedUserIdRaw !== undefined && assignedUserIdRaw !== null && assignedUserIdRaw !== '') {
      const n = parseInt(assignedUserIdRaw, 10);
      if (!Number.isNaN(n)) assignedUserId = n;
    }

    const addressValue = buildAddressFromParts({
      address,
      address_line1,
      address_line2,
      city,
      zipcode,
    });
    if (!addressValue || !addressValue.trim()) {
      return res.status(400).json({ success: false, error: 'Address (at least line 1 and city) is required' });
    }
    const addressTrim = addressValue.trim().slice(0, 500);
    const line2 = (address_line2 && String(address_line2).trim()) || null;
    const cityTrim = (city && String(city).trim()) || null;
    const stateTrim = (body.state && String(body.state).trim()) || null;
    const zipRaw = (zipcode && String(zipcode).trim()) || '';
    const notesTrim = notes != null && String(notes).trim() ? String(notes).trim() : null;

    const custId = customer_id != null ? parseInt(customer_id, 10) : null;
    const projId = project_id != null ? parseInt(project_id, 10) : null;
    const techId = technician_id != null ? parseInt(technician_id, 10) : null;

    // Schema CRM (assigned_to + colunas de endereço)
    try {
      const [result] = await pool.execute(
        `INSERT INTO visits (lead_id, scheduled_at, address, address_line2, city, state, zipcode, notes, status, assigned_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
        [
          leadIdInt,
          scheduled_at,
          addressTrim,
          line2,
          cityTrim,
          stateTrim,
          zipRaw ? zipRaw.slice(0, 10) : null,
          notesTrim,
          assignedUserId,
        ]
      );
      await updateLeadToVisitScheduled(pool, leadIdInt);
      await syncVisitById(pool, result.insertId);
      return res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Visit scheduled' });
    } catch (err) {
      if (!isUnknownColumnError(err)) {
        console.error('Create visit error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // Legado (seller_id, customer_id, project_id)
    try {
      const [result] = await pool.execute(
        `INSERT INTO visits (lead_id, customer_id, project_id, scheduled_at, seller_id, technician_id, address, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
        [
          leadIdInt,
          Number.isNaN(custId) ? null : custId,
          Number.isNaN(projId) ? null : projId,
          scheduled_at,
          assignedUserId,
          Number.isNaN(techId) ? null : techId,
          addressTrim,
          notesTrim,
        ]
      );
      await updateLeadToVisitScheduled(pool, leadIdInt);
      await syncVisitById(pool, result.insertId);
      return res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Visit scheduled' });
    } catch (err2) {
      console.error('Create visit error (legacy):', err2);
      return res.status(500).json({ success: false, error: err2.message });
    }
  } catch (error) {
    console.error('Create visit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateVisit(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const updates = [];
    const values = [];
    const allowedFields = ['scheduled_at', 'ended_at', 'seller_id', 'technician_id', 'address', 'notes', 'status'];

    const addressValue = buildAddressFromParts({
      address: req.body.address,
      address_line1: req.body.address_line1,
      address_line2: req.body.address_line2,
      city: req.body.city,
      zipcode: req.body.zipcode,
    });
    const usedAddressFromParts = Boolean(addressValue);
    if (usedAddressFromParts) {
      updates.push('address = ?');
      values.push(addressValue);
    }

    for (const field of allowedFields) {
      if (field === 'address' && usedAddressFromParts) continue;
      if (req.body[field] !== undefined) {
        let val = field === 'status' ? normalizeVisitStatus(req.body[field]) : req.body[field];
        if (field === 'scheduled_at' && val != null) {
          const n = normalizeScheduledAt(val);
          if (n) val = n;
        }
        updates.push(`${field} = ?`);
        values.push(val);
      }
    }

    if (req.body.assigned_to !== undefined && req.body.seller_id === undefined) {
      const v =
        req.body.assigned_to === '' || req.body.assigned_to === null
          ? null
          : parseInt(req.body.assigned_to, 10);
      updates.push('assigned_to = ?');
      values.push(v !== null && !Number.isNaN(v) ? v : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);

    const setClause = updates.join(', ');
    const setCrm = setClause.replace(/\bseller_id\b/g, 'assigned_to');

    const visitId = parseInt(req.params.id, 10);

    try {
      await pool.execute(`UPDATE visits SET ${setCrm} WHERE id = ?`, values);
      await syncVisitById(pool, visitId);
      return res.json({ success: true, message: 'Visit updated' });
    } catch (err) {
      if (!isUnknownColumnError(err)) {
        console.error('Update visit error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    try {
      await pool.execute(`UPDATE visits SET ${setClause} WHERE id = ?`, values);
      await syncVisitById(pool, visitId);
      return res.json({ success: true, message: 'Visit updated' });
    } catch (err2) {
      console.error('Update visit error (legacy):', err2);
      return res.status(500).json({ success: false, error: err2.message });
    }
  } catch (error) {
    console.error('Update visit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
