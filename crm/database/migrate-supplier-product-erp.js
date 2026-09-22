/**
 * Suppliers, products, category margins, quote line product fields.
 * Idempotent.
 * Local com MySQL: npm run migrate:supplier-product-erp
 * Railway (portátil): railway run npm run migrate:supplier-product-erp
 * — com Railway CLI não carrega .env (evita DB_HOST=localhost); usa TCP proxy para hosts Railway.
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
    const d = getMysqlEnvDiagnostics();
    console.error('Sem configuração MySQL válida.');
    console.error('Diagnóstico:', d);
    console.error('');
    console.error('Opções:');
    console.error('  1) senior-floors-system/.env com DB_HOST remoto (Railway MySQL) ou DATABASE_URL');
    console.error('  2) railway link  →  railway run npm run migrate:supplier-product-erp');
    process.exit(1);
  }
  let conn;
  try {
    conn = await mysql.createConnection({ ...base, multipleStatements: true });
  } catch (e) {
    if (e.code === 'ECONNREFUSED' && (base.host === '127.0.0.1' || base.host === 'localhost')) {
      console.error(
        'MySQL recusou em ' + base.host + ':' + base.port + ' — não há servidor MySQL local.'
      );
      console.error('');
      console.error('Use a base na Railway a partir da pasta senior-floors-system:');
      console.error('  railway run npm run migrate:supplier-product-erp');
      console.error('');
      console.error(
        'Ou no .env defina DATABASE_URL / DB_HOST com o host público do MySQL (e porta TCP proxy se aplicável).'
      );
      console.error('Se tiver export DB_HOST=localhost no shell: unset DB_HOST DATABASE_URL MYSQL_URL');
    }
    throw e;
  }

  console.log('migrate-supplier-product-erp…');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255) NULL,
      phone VARCHAR(64) NULL,
      email VARCHAR(255) NULL,
      address TEXT NULL,
      notes TEXT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_suppliers_active (active),
      KEY idx_suppliers_name (name(64))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ suppliers');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(64) NOT NULL COMMENT 'Hardwood, LVP, Engineered, Accessories',
      unit_type VARCHAR(32) NOT NULL DEFAULT 'sq_ft' COMMENT 'sq_ft, box, piece',
      cost_price DECIMAL(12,4) NOT NULL DEFAULT 0,
      sku VARCHAR(128) NULL,
      description TEXT NULL,
      stock_qty INT NULL DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_products_supplier (supplier_id),
      KEY idx_products_category (category),
      KEY idx_products_active (active),
      CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ products');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS category_margin_defaults (
      category VARCHAR(64) PRIMARY KEY,
      margin_percentage DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT 'e.g. 35 = 35%',
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ category_margin_defaults');

  await conn.query(`
    INSERT INTO category_margin_defaults (category, margin_percentage) VALUES
      ('Hardwood', 35), ('LVP', 25), ('Engineered', 30), ('Accessories', 50)
    ON DUPLICATE KEY UPDATE margin_percentage = VALUES(margin_percentage)
  `);

  const qiCols = [
    ['item_type', "`item_type` ENUM('service','product') NOT NULL DEFAULT 'service'"],
    ['product_id', '`product_id` INT NULL DEFAULT NULL'],
    ['cost_price', '`cost_price` DECIMAL(12,4) NULL DEFAULT NULL'],
    ['markup_percentage', '`markup_percentage` DECIMAL(8,4) NULL DEFAULT NULL'],
    ['sell_price', "`sell_price` DECIMAL(12,4) NULL DEFAULT NULL COMMENT 'snapshot sell unit price'"],
  ];
  for (const [name, ddl] of qiCols) {
    if (!(await columnExists(conn, 'quote_items', name))) {
      await addColumn(conn, 'quote_items', ddl);
      console.log('  + quote_items.' + name);
    }
  }

  try {
    await conn.query(`
      ALTER TABLE quote_items
      ADD CONSTRAINT fk_quote_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    `);
    console.log('  ✓ FK quote_items.product_id');
  } catch (e) {
    if (!String(e.message).includes('Duplicate')) console.warn('  (skip FK quote_items.product)', e.message);
  }

  try {
    await conn.query(`
      ALTER TABLE quote_items MODIFY COLUMN unit_type ENUM('sq_ft','linear_ft','inches','fixed','box','piece') NOT NULL DEFAULT 'sq_ft'
    `);
    console.log('  ✓ quote_items.unit_type + box/piece');
  } catch (e) {
    console.warn('  (skip unit_type enum)', e.message);
  }

  if (await tableExists(conn, 'quote_template_items')) {
    const tplCols = [
      ['item_type', "`item_type` ENUM('service','product') NOT NULL DEFAULT 'service'"],
      ['product_id', '`product_id` INT NULL DEFAULT NULL'],
      ['cost_price', '`cost_price` DECIMAL(12,4) NULL DEFAULT NULL'],
      ['markup_percentage', '`markup_percentage` DECIMAL(8,4) NULL DEFAULT NULL'],
      ['sell_price', '`sell_price` DECIMAL(12,4) NULL DEFAULT NULL'],
    ];
    for (const [name, ddl] of tplCols) {
      if (!(await columnExists(conn, 'quote_template_items', name))) {
        await addColumn(conn, 'quote_template_items', ddl);
        console.log('  + quote_template_items.' + name);
      }
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
