/**
 * allow_work_date_outside_period em construction_payroll_employees.
 * Idempotente. Run: npm run migrate:payroll-employee-flex-dates
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

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
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

  console.log('migrate-payroll-employee-flex-dates…');

  if (!(await tableExists(conn, 'construction_payroll_employees'))) {
    console.error('Tabela construction_payroll_employees não existe. Execute primeiro: npm run migrate:construction-payroll');
    await conn.end();
    process.exit(1);
  }

  if (!(await columnExists(conn, 'construction_payroll_employees', 'allow_work_date_outside_period'))) {
    await conn.query(
      `ALTER TABLE construction_payroll_employees
       ADD COLUMN allow_work_date_outside_period tinyint(1) NOT NULL DEFAULT 0
       COMMENT '1 = permitir work_date fora do período; paga neste fechamento'`
    );
    console.log('  + coluna allow_work_date_outside_period');
  } else {
    console.log('  (skip) allow_work_date_outside_period já existe');
  }

  await conn.end();
  console.log('migrate-payroll-employee-flex-dates: concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
