/**
 * Permite mais de uma linha de quadro no mesmo dia (mesmo funcionário/projeto)
 * para registrar double (ex.: 1+1 diárias). Remove o UNIQUE e adiciona índice composto.
 * Idempotente. Run: npm run migrate:payroll-timesheet-allow-double-lines
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

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(rows[0]?.c) > 0;
}

async function main() {
  const base = applyRailwayTcpProxyIfNeeded(getMysqlConnectionConfig());
  if (!base) {
    console.error('Sem configuração MySQL válida.', getMysqlEnvDiagnostics());
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...base, multipleStatements: true });

  console.log('migrate-payroll-timesheet-allow-double-lines…');

  const table = 'construction_payroll_timesheets';
  const uniq = 'uniq_period_emp_proj_day';
  const idx = 'idx_cpt_period_emp_date_proj';

  if (await indexExists(conn, table, uniq)) {
    await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${uniq}\``);
    console.log(`  - removido UNIQUE ${uniq}`);
  } else {
    console.log(`  (skip) UNIQUE ${uniq} já ausente`);
  }

  if (!(await indexExists(conn, table, idx))) {
    await conn.query(
      `ALTER TABLE \`${table}\` ADD INDEX \`${idx}\` (period_id, employee_id, work_date, project_id_norm)`
    );
    console.log(`  + índice ${idx}`);
  } else {
    console.log(`  (skip) índice ${idx} já existe`);
  }

  await conn.end();
  console.log('OK.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
