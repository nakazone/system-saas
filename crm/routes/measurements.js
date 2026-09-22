/**
 * API Routes para Measurements (medições realizadas durante visitas)
 * GET, POST, PUT /api/visits/:visitId/measurement
 */

import { getDBConnection } from '../config/db.js';

export async function getMeasurement(req, res) {
  const visitId = parseInt(req.params.visitId);
  
  if (!visitId || isNaN(visitId)) {
    return res.status(400).json({ success: false, error: 'Invalid visit ID' });
  }

  try {
    const pool = await getDBConnection();
    const [rows] = await pool.execute(
      `SELECT m.*, u.name as measured_by_name, v.scheduled_at, v.address
       FROM measurements m
       LEFT JOIN users u ON m.measured_by = u.id
       LEFT JOIN visits v ON m.visit_id = v.id
       WHERE m.visit_id = ?`,
      [visitId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Measurement not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error getting measurement:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function createOrUpdateMeasurement(req, res) {
  const visitId = parseInt(req.params.visitId);
  const userId = req.session?.user?.id;

  if (!visitId || isNaN(visitId)) {
    return res.status(400).json({ success: false, error: 'Invalid visit ID' });
  }

  // Buscar lead_id da visita
  try {
    const pool = await getDBConnection();
    const [visitRows] = await pool.execute(
      'SELECT lead_id FROM visits WHERE id = ?',
      [visitId]
    );

    if (visitRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Visit not found' });
    }

    const leadId = visitRows[0].lead_id;

    const {
      final_area,
      rooms_count,
      technical_notes,
      photos,
      risks,
      subfloor_condition,
      preparation_needed,
      preparation_notes
    } = req.body;

    // Verificar se já existe
    const [existing] = await pool.execute(
      'SELECT id FROM measurements WHERE visit_id = ?',
      [visitId]
    );

    if (existing.length > 0) {
      // Update
      await pool.execute(
        `UPDATE measurements SET
          final_area = ?, rooms_count = ?, technical_notes = ?,
          photos = ?, risks = ?, subfloor_condition = ?,
          preparation_needed = ?, preparation_notes = ?,
          measured_by = ?, measured_at = NOW()
        WHERE visit_id = ?`,
        [
          final_area, rooms_count, technical_notes,
          JSON.stringify(photos || []), risks, subfloor_condition,
          preparation_needed, preparation_notes, userId, visitId
        ]
      );
    } else {
      // Insert
      await pool.execute(
        `INSERT INTO measurements 
        (visit_id, lead_id, final_area, rooms_count, technical_notes,
         photos, risks, subfloor_condition, preparation_needed,
         preparation_notes, measured_by, measured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          visitId, leadId, final_area, rooms_count, technical_notes,
          JSON.stringify(photos || []), risks, subfloor_condition,
          preparation_needed, preparation_notes, userId
        ]
      );
    }

    // Buscar atualizado
    const [updated] = await pool.execute(
      `SELECT m.*, u.name as measured_by_name, v.scheduled_at, v.address
       FROM measurements m
       LEFT JOIN users u ON m.measured_by = u.id
       LEFT JOIN visits v ON m.visit_id = v.id
       WHERE m.visit_id = ?`,
      [visitId]
    );

    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error saving measurement:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
