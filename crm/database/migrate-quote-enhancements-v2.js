/**
 * Quote enhancements: dual catalog rates (builder/customer), per-line service type,
 * catalog customer notes snapshot on lines, template item fields.
 * Idempotent. Run: npm run migrate:quote-enhancements-v2
 * Railway: railway run npm run migrate:quote-enhancements-v2
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

async function addColumn(conn, table, ddl) {
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
}

async function main() {
  const base = applyRailwayTcpProxyIfNeeded(getMysqlConnectionConfig());
  if (!base) {
    const d = getMysqlEnvDiagnostics();
    console.error('Sem configuração MySQL válida.', d);
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...base, multipleStatements: true });

  console.log('migrate-quote-enhancements-v2…');

  const catalogCols = [
    ['rate_builder', '`rate_builder` DECIMAL(12,2) NULL DEFAULT NULL'],
    ['rate_customer', '`rate_customer` DECIMAL(12,2) NULL DEFAULT NULL'],
    ['notes_builder', '`notes_builder` TEXT NULL'],
    ['notes_customer', '`notes_customer` TEXT NULL'],
  ];
  for (const [name, ddl] of catalogCols) {
    if (!(await columnExists(conn, 'quote_service_catalog', name))) {
      await addColumn(conn, 'quote_service_catalog', ddl);
      console.log('  + quote_service_catalog.' + name);
    }
  }

  await conn.query(`
    UPDATE quote_service_catalog
    SET rate_builder = COALESCE(rate_builder, default_rate),
        rate_customer = COALESCE(rate_customer, default_rate)
    WHERE rate_builder IS NULL OR rate_customer IS NULL
  `);
  console.log('  ✓ backfill quote_service_catalog rates from default_rate');

  const itemCols = [
    ['service_type', '`service_type` VARCHAR(64) NULL DEFAULT NULL'],
    ['catalog_customer_notes', '`catalog_customer_notes` TEXT NULL'],
  ];
  for (const [name, ddl] of itemCols) {
    if (!(await columnExists(conn, 'quote_items', name))) {
      await addColumn(conn, 'quote_items', ddl);
      console.log('  + quote_items.' + name);
    }
  }

  for (const [name, ddl] of itemCols) {
    if (!(await columnExists(conn, 'quote_template_items', name))) {
      await addColumn(conn, 'quote_template_items', ddl);
      console.log('  + quote_template_items.' + name);
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
