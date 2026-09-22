/**
 * GET /api/permissions — registo de permissões (para UI de módulos)
 */
import { getDBConnection } from '../config/db.js';

export async function listPermissionRegistry(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query(
      `SELECT id, permission_key, permission_name, permission_group, description
       FROM permissions
       ORDER BY permission_group, id`
    );

    const byGroup = {};
    for (const row of rows || []) {
      const g = row.permission_group || 'other';
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(row);
    }

    res.json({ success: true, data: rows || [], by_group: byGroup });
  } catch (error) {
    console.error('listPermissionRegistry:', error);
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json({ success: true, data: [], by_group: {}, note: 'Tabela permissions inexistente — execute o schema SQL completo.' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
}
