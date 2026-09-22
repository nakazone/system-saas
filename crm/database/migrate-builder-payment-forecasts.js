/**
 * Tabela builder_payment_forecasts. Run: npm run migrate:builder-payment-forecasts
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

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
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
  console.log('migrate-builder-payment-forecasts…');
  if (await tableExists(conn, 'builder_payment_forecasts')) {
    console.log('  (skip) builder_payment_forecasts já existe');
  } else {
    await conn.query(`
CREATE TABLE builder_payment_forecasts (
  id int(11) NOT NULL AUTO_INCREMENT,
  builder_id int(11) NOT NULL COMMENT 'customers.id (builder)',
  project_id int(11) NOT NULL COMMENT 'projects.id',
  expected_payment_date date NOT NULL,
  amount decimal(12,2) DEFAULT NULL,
  notes varchar(500) DEFAULT NULL,
  created_by int(11) DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bpf_builder (builder_id),
  KEY idx_bpf_project (project_id),
  KEY idx_bpf_date (expected_payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    console.log('  + tabela builder_payment_forecasts');
  }
  await conn.end();
  console.log('migrate-builder-payment-forecasts: concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
