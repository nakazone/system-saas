/**
 * Timesheet: optional daily rate per line (override employee default for that day).
 * Idempotent. Run: npm run migrate:payroll-timesheet-daily-override
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getMysqlConnectionConfig, getMysqlEnvDiagnostics } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const envInjectedByRailway =
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.MYSQL_URL?.trim()) ||
  Boolean(process.env.MYSQLHOST?.trim());
if (!envInjectedByRailway) {
  dotenv.config({ path: envPath, override: true });
}

function applyRailwayTcpProxyIfNeeded(cfg) {
  if (!cfg) return null;
  const ph = process.env.RAILWAY_TCP_PROXY_DOMAIN?.trim();
  const pp = process.env.RAILWAY_TCP_PROXY_PORT?.trim();
  if (!ph || !pp) return cfg;
  const h = (cfg.host || '').trim().toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return cfg;
  const railwayHost =
    h.endsWith('.railway.internal') || h.endsWith('.up.railway.app') || h.includes('.railway.app');
  if (!railwayHost) return cfg;
  return { ...cfg, host: ph, port: parseInt(pp, 10) || cfg.port };
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function main() {
  const base = applyRailwayTcpProxyIfNeeded(getMysqlConnectionConfig());
  if (!base) {
    console.error('Sem configuração MySQL válida.', getMysqlEnvDiagnostics());
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...base, multipleStatements: true });

  console.log('migrate-payroll-timesheet-daily-override…');

  if (!(await columnExists(conn, 'construction_payroll_timesheets', 'daily_rate_override'))) {
    await conn.query(
      `ALTER TABLE construction_payroll_timesheets
       ADD COLUMN daily_rate_override decimal(12,2) DEFAULT NULL
       COMMENT 'Diária só nesta linha; NULL = usar cadastro do funcionário'`
    );
    console.log('  + coluna daily_rate_override em construction_payroll_timesheets');
  } else {
    console.log('  (skip) daily_rate_override já existe');
  }

  await conn.end();
  console.log('migrate-payroll-timesheet-daily-override: concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
