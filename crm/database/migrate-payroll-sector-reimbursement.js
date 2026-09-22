/**
 * Payroll extras: sector on employees + period reimbursement adjustments.
 * Idempotent. Run: npm run migrate:payroll-sector-reimbursement
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

  console.log('migrate-payroll-sector-reimbursement…');

  if (!(await tableExists(conn, 'construction_payroll_employees'))) {
    console.error('Tabela construction_payroll_employees não existe. Execute primeiro: npm run migrate:construction-payroll');
    await conn.end();
    process.exit(1);
  }

  if (!(await columnExists(conn, 'construction_payroll_employees', 'sector'))) {
    await conn.query(
      `ALTER TABLE construction_payroll_employees
       ADD COLUMN sector enum('installation','sand_finish') DEFAULT NULL
       COMMENT 'Installation vs Sand & Finish'
       AFTER payment_method`
    );
    console.log('  + coluna sector em construction_payroll_employees');
  } else {
    console.log('  (skip) sector já existe');
  }

  if (!(await tableExists(conn, 'construction_payroll_period_adjustments'))) {
    await conn.query(`
CREATE TABLE construction_payroll_period_adjustments (
  id int(11) NOT NULL AUTO_INCREMENT,
  period_id int(11) NOT NULL,
  employee_id int(11) NOT NULL,
  reimbursement decimal(12,2) NOT NULL DEFAULT 0.00,
  discount decimal(12,2) NOT NULL DEFAULT 0.00,
  notes varchar(500) DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_period_employee_adj (period_id, employee_id),
  KEY idx_cppa_employee (employee_id),
  CONSTRAINT fk_cppa_period FOREIGN KEY (period_id) REFERENCES construction_payroll_periods (id) ON DELETE CASCADE,
  CONSTRAINT fk_cppa_employee FOREIGN KEY (employee_id) REFERENCES construction_payroll_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
    console.log('  + tabela construction_payroll_period_adjustments');
  } else {
    console.log('  (skip) construction_payroll_period_adjustments já existe');
  }

  if (await tableExists(conn, 'construction_payroll_period_adjustments')) {
    if (!(await columnExists(conn, 'construction_payroll_period_adjustments', 'discount'))) {
      await conn.query(
        `ALTER TABLE construction_payroll_period_adjustments
         ADD COLUMN discount decimal(12,2) NOT NULL DEFAULT 0.00
         COMMENT 'Desconto no fechamento (subtrai ao total do funcionário)'
         AFTER reimbursement`
      );
      console.log('  + coluna discount em construction_payroll_period_adjustments');
    } else {
      console.log('  (skip) discount já existe');
    }
  }

  await conn.end();
  console.log('migrate-payroll-sector-reimbursement: concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
