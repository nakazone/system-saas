/**
 * Pipeline Stages API
 * GET /api/pipeline-stages
 */

import { getDBConnection } from '../config/db.js';

export async function listPipelineStages(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM pipeline_stages WHERE is_active = 1 ORDER BY order_num ASC, id ASC'
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing pipeline stages:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
