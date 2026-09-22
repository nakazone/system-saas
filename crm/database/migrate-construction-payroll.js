/**
 * Construction payroll module — schema + permissions.
 * Idempotent for permissions. Run: npm run migrate:construction-payroll
 * Na máquina local com MYSQLHOST=*.railway.internal: npm run migrate:construction-payroll:railway
 */
import dotenv from 'dotenv';
import fs from 'fs';
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

async function ensurePermission(conn, key, name, group, description) {
  const [rows] = await conn.query('SELECT id FROM permissions WHERE permission_key = ? LIMIT 1', [key]);
  if (rows.length) return;
  await conn.query(
    `INSERT INTO permissions (permission_key, permission_name, permission_group, description)
     VALUES (?, ?, ?, ?)`,
    [key, name, group, description]
  );
  console.log('  + permission:', key);
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

/** Bases antigas: a tabela já existia sem esta coluna (CREATE TABLE IF NOT EXISTS não acrescenta colunas). */
async function ensureTimesheetDailyRateOverride(conn) {
  const [t] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_timesheets'`
  );
  if (!t[0]?.c) return;
  if (await columnExists(conn, 'construction_payroll_timesheets', 'daily_rate_override')) {
    console.log('  (skip) daily_rate_override já existe em construction_payroll_timesheets');
    return;
  }
  await conn.query(
    `ALTER TABLE construction_payroll_timesheets
     ADD COLUMN daily_rate_override decimal(12,2) DEFAULT NULL
     COMMENT 'Diária só nesta linha; NULL = usar cadastro do funcionário'`
  );
  console.log('  + coluna daily_rate_override em construction_payroll_timesheets');
}

/** Várias linhas no mesmo dia (double): remove UNIQUE legado e garante índice composto. */
async function ensureTimesheetAllowDoubleLines(conn) {
  const [uniqRows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'construction_payroll_timesheets'
       AND INDEX_NAME = 'uniq_period_emp_proj_day'`
  );
  if (Number(uniqRows[0]?.c) > 0) {
    await conn.query('ALTER TABLE construction_payroll_timesheets DROP INDEX uniq_period_emp_proj_day');
    console.log('  - removido UNIQUE uniq_period_emp_proj_day (double / várias linhas por dia)');
  }
  const [idxRows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'construction_payroll_timesheets'
       AND INDEX_NAME = 'idx_cpt_period_emp_date_proj'`
  );
  if (Number(idxRows[0]?.c) === 0) {
    await conn.query(
      `ALTER TABLE construction_payroll_timesheets
       ADD INDEX idx_cpt_period_emp_date_proj (period_id, employee_id, work_date, project_id_norm)`
    );
    console.log('  + índice idx_cpt_period_emp_date_proj em construction_payroll_timesheets');
  }
}

async function main() {
  const base = applyRailwayTcpProxyIfNeeded(getMysqlConnectionConfig());
  if (!base) {
    console.error('Sem configuração MySQL válida.', getMysqlEnvDiagnostics());
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...base, multipleStatements: true });

  const sqlPath = path.join(__dirname, 'schema-construction-payroll.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('migrate-construction-payroll: aplicando DDL…');
  await conn.query(sql);

  console.log('migrate-construction-payroll: colunas em falta (compatibilidade)…');
  await ensureTimesheetDailyRateOverride(conn);

  console.log('migrate-construction-payroll: timesheet — double (várias linhas / mesmo dia)…');
  await ensureTimesheetAllowDoubleLines(conn);

  console.log('migrate-construction-payroll: permissões…');
  await ensurePermission(
    conn,
    'payroll.view',
    'Construction payroll (view)',
    'payroll',
    'Ver funcionários de obra, períodos, timesheets e relatórios'
  );
  await ensurePermission(
    conn,
    'payroll.manage',
    'Construction payroll (manage)',
    'payroll',
    'Criar/editar funcionários, períodos, timesheets e fechar folha'
  );

  await conn.end();
  console.log('migrate-construction-payroll: concluído.');
}

main().catch((e) => {
  console.error(e);
  const msg = String(e?.message || e || '');
  if (e?.code === 'ENOTFOUND' && (msg.includes('railway.internal') || /\.railway\.internal/i.test(msg))) {
    console.error(`
→ Host *.railway.internal só resolve dentro da rede Railway (não no seu computador).

  Opção 1 — atalho npm (precisa Railway CLI ligado a este projeto, na pasta senior-floors-system):
     npm run migrate:construction-payroll:railway

     (equivale a: railway run npm run migrate:construction-payroll)

  Opção 2 — no .env local, acrescente DATABASE_PUBLIC_URL
     (Railway → serviço MySQL → Variables). Sem isto, o PC não consegue resolver mysql.railway.internal.

  Opção 3 — TCP Proxy: database/RAILWAY_TCP_PROXY.md (RAILWAY_TCP_PROXY_DOMAIN + PORT).
`);
  }
  process.exit(1);
});
