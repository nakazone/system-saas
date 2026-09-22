/**
 * Garante que a tabela interactions existe e aceita todos os tipos (call, whatsapp, email, visit, meeting).
 * Execute uma vez: node database/run-ensure-interactions.js (com .env)
 * Ou no Railway: railway run node database/run-ensure-interactions.js
 *
 * Variáveis aceitas (uma das opções):
 *   - DATABASE_URL ou DATABASE_PUBLIC_URL ou MYSQL_URL (URL: mysql://user:pass@host:port/dbname)
 *   - DB_HOST + DB_USER + DB_PASS + DB_NAME (e opcional DB_PORT)
 *   - No Railway: MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carregar .env de vários locais possíveis (pasta do sistema, cwd, raiz do repo)
const envPaths = [
  path.join(__dirname, '..', '.env'),                    // senior-floors-system/.env
  path.join(__dirname, '..', '..', '.env'),             // senior-floors-landing/.env (raiz do repo)
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'senior-floors-system', '.env'),
];
let loadedEnvPath = null;
for (const p of envPaths) {
  const r = dotenv.config({ path: p });
  if (r.parsed && Object.keys(r.parsed).length) {
    loadedEnvPath = p;
    break;
  }
}

function parseUrl(u) {
  if (!u || typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      database: url.pathname.replace(/^\//, '').replace(/\?.*$/, '') || 'railway',
    };
  } catch (_) {
    return null;
  }
}

function getMySQLConfig() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  if (url) {
    const c = parseUrl(url.startsWith('mysql') ? url : 'mysql://' + url.replace(/^\/\//, ''));
    if (c && c.user && c.database) return c;
  }
  if (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT) {
    return {
      host: process.env.RAILWAY_TCP_PROXY_DOMAIN,
      port: parseInt(process.env.RAILWAY_TCP_PROXY_PORT) || 3306,
      user: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '',
      database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
    };
  }
  if (process.env.MYSQLHOST || process.env.MYSQL_HOST) {
    return {
      host: process.env.MYSQLHOST || process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '',
      database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
    };
  }
  const dbHost = process.env.DB_HOST;
  const dbUser = process.env.DB_USER;
  const dbPass = process.env.DB_PASS;
  const dbName = process.env.DB_NAME;
  if (dbHost && dbUser && dbPass && dbName) {
    return {
      host: dbHost,
      port: parseInt(process.env.DB_PORT || '3306'),
      user: dbUser,
      password: dbPass,
      database: dbName,
    };
  }
  return null;
}

const createTableSql = `
CREATE TABLE IF NOT EXISTS interactions (
  id int(11) NOT NULL AUTO_INCREMENT,
  lead_id int(11) NOT NULL,
  user_id int(11) DEFAULT NULL,
  type varchar(50) NOT NULL COMMENT 'call, whatsapp, email, visit, meeting',
  subject varchar(255) DEFAULT NULL,
  notes text DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_id (lead_id),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function printConfigHelp() {
  const dbVars = ['DATABASE_URL', 'DATABASE_PUBLIC_URL', 'MYSQL_URL', 'DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'MYSQLHOST', 'MYSQLUSER', 'MYSQLPASSWORD', 'MYSQLDATABASE'];
  const found = dbVars.filter((k) => process.env[k]);
  console.error('');
  if (loadedEnvPath) {
    console.error('Arquivo .env carregado: ' + loadedEnvPath);
    if (found.length) console.error('Variáveis de DB encontradas: ' + found.join(', '));
    else console.error('Nenhuma variável de banco encontrada no .env (use os nomes exatos abaixo).');
  } else {
    console.error('Nenhum .env foi carregado. Procurou em:');
    envPaths.forEach((p) => console.error('  - ' + p));
    if (found.length) console.error('Variáveis de DB no ambiente: ' + found.join(', '));
  }
  console.error('');
  console.error('Configure o banco de uma destas formas:');
  console.error('');
  console.error('1) URL única: DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE_NAME');
  console.error('2) DB_*: DB_HOST, DB_USER, DB_PASS, DB_NAME (no .env)');
  console.error('3) Railway: MYSQLHOST, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE');
  console.error('');
}

async function main() {
  const config = getMySQLConfig();
  if (!config) {
    console.error('No database config. Set DATABASE_PUBLIC_URL or DB_* / MYSQL* env vars.');
    printConfigHelp();
    process.exit(1);
  }
  console.log('Connecting to MySQL...');
  const conn = await mysql.createConnection(config);
  try {
    await conn.execute(createTableSql);
    console.log('Table interactions ensured (CREATE TABLE IF NOT EXISTS).');

    const [cols] = await conn.execute("SHOW COLUMNS FROM interactions WHERE Field = 'type'");
    if (cols.length > 0 && cols[0].Type && String(cols[0].Type).toLowerCase().includes('enum')) {
      await conn.execute('ALTER TABLE interactions MODIFY type VARCHAR(50) NOT NULL');
      console.log('Column type changed from ENUM to VARCHAR(50) to accept "meeting".');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
