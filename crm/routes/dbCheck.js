/**
 * GET /api/db-check — DB status (for LP to verify System connection)
 */
import { getDBConnection, isDatabaseConfigured } from '../config/db.js';

export async function handleDbCheck(req, res) {
  const config_loaded = isDatabaseConfigured();
  const out = {
    config_loaded,
    database_configured: config_loaded,
    connection_ok: false,
    table_leads_exists: false,
    hint: '',
    api_version: 'system-node',
  };
  if (!config_loaded) out.hint = 'Set DB_HOST, DB_NAME, DB_USER, DB_PASS in Railway (or .env)';
  else {
    try {
      const pool = await getDBConnection();
      if (!pool) {
        out.connection_ok = false;
        out.hint = 'Pool não criado. Verifique DATABASE_URL (referência ao MySQL) ou DB_* / MYSQL*.';
      } else {
        await pool.query('SELECT 1');
        out.connection_ok = true;
        const [t] = await pool.query("SHOW TABLES LIKE 'leads'");
        out.table_leads_exists = t && t.length > 0;
        if (!out.table_leads_exists) out.hint = "Table 'leads' does not exist. Run your schema SQL.";
      }
    } catch (e) {
      out.connection_ok = false;
      out.hint = e.message;
      if (e.code) out.error_code = e.code;
    }
  }
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.json(out);
}
