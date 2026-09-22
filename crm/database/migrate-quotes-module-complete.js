/**
 * Quotes module v2: catalog, templates, snapshots, public flow fields.
 * Idempotent. Run: node database/migrate-quotes-module-complete.js
 * Railway (no laptop): railway run npm run migrate:quotes-module
 * — não carrega .env (evita DB_HOST=localhost misturado com MYSQL_URL); usa TCP proxy para
 * hosts *.railway.app / *.railway.internal.
 *
 * Local sem CLI: node database/migrate-quotes-module-complete.js — carrega .env com override.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getMysqlConnectionConfig, getMysqlEnvDiagnostics } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
/**
 * `railway run` injeta MYSQL_* / MYSQL_URL. Se carregarmos .env com override:false, o ficheiro
 * ainda preenche DB_HOST=localhost (chave ausente no env) e getMysqlConnectionConfig() passa a
 * usar DB_* em vez do URL — liga ao MySQL errado. Com Railway CLI: não carregar .env.
 */
const envInjectedByRailway =
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.MYSQL_URL?.trim()) ||
  Boolean(process.env.MYSQLHOST?.trim());
if (!envInjectedByRailway) {
  dotenv.config({ path: envPath, override: true });
}

/**
 * A partir do portátil: MYSQL_URL (interno) e host *.up.railway.app na 3306 não aceitam ligação
 * direta. Usar RAILWAY_TCP_PROXY_* (ex.: switchback.proxy.rlwy.net:24357). RDS/outros hosts não
 * são alterados.
 */
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
    console.error('Sem configuração MySQL válida.');
    console.error('');
    console.error('Diagnóstico (nada de senhas):');
    console.error(
      '  DATABASE_URL / DATABASE_PUBLIC_URL / MYSQL_URL:',
      d.urlSet ? (d.urlParsesOk ? 'OK (parseou)' : 'definida mas URL inválida ou incompleta') : 'ausente'
    );
    if (d.urlOvertakenByDbHost) {
      console.error(
        '  (URL apontava para localhost; configuração DB_HOST remoto será usada em vez da URL.)'
      );
    }
    console.error('  DB_HOST:', d.dbHost ? 'OK' : 'ausente');
    console.error('  DB_USER:', d.dbUser ? 'OK' : 'ausente');
    console.error('  DB_NAME:', d.dbName ? 'OK' : 'ausente');
    console.error('  DB_PASS:', d.dbPassSet ? 'definida' : 'ausente (pode ser linha vazia DB_PASS=)');
    console.error('');
    console.error(
      'O arquivo .env deve ficar em:\n  senior-floors-system/.env\n' +
        'Copie: cp env.example .env\n' +
        'Preencha DB_HOST, DB_USER, DB_PASS, DB_NAME (Railway → serviço MySQL → Variables).'
    );
    console.error('');
    console.error(
      'Alternativa: railway link && railway run npm run migrate:quotes-module\n' +
        '(usa as variáveis do projeto no Railway; DATABASE_URL deve ser a do MySQL, não da app errada).'
    );
    process.exit(1);
  }
  let conn;
  try {
    conn = await mysql.createConnection({
      ...base,
      multipleStatements: true,
    });
  } catch (e) {
    if (e.code === 'ECONNREFUSED' && (base.host === '127.0.0.1' || base.host === 'localhost')) {
      const raw = (process.env.DB_HOST || '').trim().toLowerCase();
      const envSaysLocal = raw === 'localhost' || raw === '127.0.0.1' || raw === '::1';
      console.error(
        'MySQL recusou conexão em ' +
          base.host +
          ':' +
          base.port +
          ' — não há MySQL escutando aí (típico sem servidor local).'
      );
      if (envSaysLocal) {
        console.error('');
        console.error(
          'O Node está a usar DB_HOST=localhost (ou 127.0.0.1). No ficheiro senior-floors-system/.env ponha o host do MySQL na Railway;'
        );
        console.error('ex.: DB_HOST=mysql-production-xxxx.up.railway.app');
        console.error(
          'Se o .env já está certo: no terminal pode ter export DB_HOST=localhost — isso ganhava sobre o .env antes. Rode: unset DB_HOST DATABASE_URL MYSQL_URL DATABASE_PUBLIC_URL'
        );
      } else {
        console.error(
          '\nConfira DB_HOST em senior-floors-system/.env ou use DATABASE_URL com o host correto do MySQL.'
        );
      }
      console.error(
        '\nAlternativa: da pasta senior-floors-system, com `railway link` ao serviço Node que referencia o MySQL:'
      );
      console.error('  railway run npm run migrate:quotes-module');
    }
    throw e;
  }

  console.log('Quotes module complete migration…');

  const quoteCols = [
    ['assigned_to', '`assigned_to` INT NULL DEFAULT NULL COMMENT "User id (sales)"'],
    [
      'service_type',
      '`service_type` VARCHAR(64) NULL DEFAULT NULL COMMENT "Installation, Sand & Finishing"',
    ],
    ['terms_conditions', '`terms_conditions` TEXT NULL'],
    ['email_sent_at', '`email_sent_at` DATETIME NULL DEFAULT NULL'],
    ['pdf_viewed_at', '`pdf_viewed_at` DATETIME NULL DEFAULT NULL COMMENT "Cliente descarregou PDF na página pública"'],
  ];
  for (const [name, ddl] of quoteCols) {
    if (!(await columnExists(conn, 'quotes', name))) {
      await addColumn(conn, 'quotes', ddl);
      console.log('  + quotes.' + name);
    }
  }

  const itemCols = [
    ['service_catalog_id', '`service_catalog_id` INT NULL DEFAULT NULL'],
    [
      'unit_type',
      "`unit_type` ENUM('sq_ft','linear_ft','inches','fixed') NOT NULL DEFAULT 'sq_ft'",
    ],
    ['sort_order', '`sort_order` INT NOT NULL DEFAULT 0'],
  ];
  for (const [name, ddl] of itemCols) {
    if (!(await columnExists(conn, 'quote_items', name))) {
      await addColumn(conn, 'quote_items', ddl);
      console.log('  + quote_items.' + name);
    }
  }

  try {
    await conn.query(
      "ALTER TABLE `quote_items` MODIFY `floor_type` VARCHAR(100) NOT NULL DEFAULT 'General'"
    );
    console.log('  ✓ quote_items.floor_type default General');
  } catch (e) {
    console.warn('  (skip floor_type alter)', e.message);
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_service_catalog (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(64) NOT NULL COMMENT 'Installation, Sand & Finishing',
      default_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
      unit_type ENUM('sq_ft','linear_ft','inches','fixed') NOT NULL DEFAULT 'sq_ft',
      default_description TEXT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qsc_category (category),
      KEY idx_qsc_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_service_catalog');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      service_type VARCHAR(64) NULL,
      created_by INT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qtpl_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_templates');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_template_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      service_catalog_id INT NULL,
      description TEXT NOT NULL,
      unit_type ENUM('sq_ft','linear_ft','inches','fixed') NOT NULL DEFAULT 'sq_ft',
      quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
      rate DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      KEY idx_qti_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_template_items');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quote_id INT NOT NULL,
      snapshot_json LONGTEXT NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_qsnap_quote (quote_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_snapshots');

  const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM quote_service_catalog');
  if (cnt === 0) {
    await conn.query(`
      INSERT INTO quote_service_catalog (name, category, default_rate, unit_type, default_description, active) VALUES
      ('Hardwood install — labor', 'Installation', 4.50, 'sq_ft', 'Per sq ft — nail-down / glue assist', 1),
      ('LVP / LVP install — labor', 'Installation', 3.25, 'sq_ft', 'Floating or glue-down LVP', 1),
      ('Screen & recoat', 'Sand & Finishing', 2.75, 'sq_ft', 'Maintenance coat when sanding not required', 1),
      ('Full sand & finish (2 coats)', 'Sand & Finishing', 5.50, 'sq_ft', 'Dust-controlled sanding + finish system', 1),
      ('Trip charge / minimum', 'Installation', 250.00, 'fixed', 'Small job minimum', 1)
    `);
    console.log('  ✓ seeded quote_service_catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
