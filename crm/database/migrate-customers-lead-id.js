/**
 * Garante coluna customers.lead_id (FK lógica ao lead convertido).
 * Idempotente.
 *
 * No portátil com .env a apontar a mysql.railway.internal: esse hostname só resolve
 * dentro da rede Railway. Opções:
 *   cd senior-floors-system && railway link && railway run npm run migrate:customers-lead-id
 * Ou no .env: DATABASE_PUBLIC_URL (MySQL plugin → Connect → Public network) e comente DATABASE_URL interno.
 * Ou Railway TCP proxy: RAILWAY_TCP_PROXY_DOMAIN + RAILWAY_TCP_PROXY_PORT (ver docs Railway).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getMysqlConnectionConfig, getMysqlEnvDiagnostics } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
// Merge: com `railway run`, DATABASE_PUBLIC_URL pode vir só do .env local (Railway não injeta).
dotenv.config({ path: envPath });

function parseMysqlUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = url.startsWith('mysql') ? url : 'mysql://' + url.replace(/^\/\//, '');
    const parsed = new URL(u);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 3306,
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '').replace(/\?.*$/, '') || 'railway',
    };
  } catch {
    return null;
  }
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

function isRailwayInternalHost(host) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .endsWith('.railway.internal');
}

/** URLs públicas primeiro — getMysqlConnectionConfig() prefere DATABASE_URL / MYSQLHOST (internos). */
function configFromExplicitPublicMysqlUrls() {
  const candidates = [
    process.env.DATABASE_PUBLIC_URL,
    process.env.MYSQL_PUBLIC_URL,
    process.env.MYSQL_URL_PUBLIC,
  ];
  for (const raw of candidates) {
    const s = raw?.trim();
    if (!s) continue;
    const cfg = parseMysqlUrl(s);
    if (!cfg?.host || !cfg?.database) continue;
    if (isRailwayInternalHost(cfg.host)) continue;
    return applyRailwayTcpProxyIfNeeded(cfg);
  }
  return null;
}

function resolveMigrateConfig() {
  const fromPublic = configFromExplicitPublicMysqlUrls();
  if (fromPublic) return fromPublic;

  let base = getMysqlConnectionConfig();
  base = applyRailwayTcpProxyIfNeeded(base);
  if (!base) return null;

  if (isRailwayInternalHost(base.host)) {
    const pubRaw =
      process.env.DATABASE_PUBLIC_URL?.trim() ||
      process.env.MYSQL_PUBLIC_URL?.trim() ||
      process.env.MYSQL_URL_PUBLIC?.trim();
    const fromPub = parseMysqlUrl(pubRaw);
    if (fromPub?.host && fromPub?.database && !isRailwayInternalHost(fromPub.host)) {
      return applyRailwayTcpProxyIfNeeded(fromPub);
    }
  }

  return base;
}

function printRailwayInternalHelp() {
  console.error('');
  console.error('O host mysql.railway.internal (ou *.railway.internal) não resolve no teu Mac — só na rede Railway.');
  console.error('');
  console.error('Corre a migração no ambiente Railway (recomendado):');
  console.error('  cd senior-floors-system');
  console.error('  railway link   # se ainda não estiver ligado ao projeto');
  console.error('  railway run npm run migrate:customers-lead-id');
  console.error('');
  console.error('Alternativa local: no painel Railway → MySQL → Connect → copia a URL pública');
  console.error('e define no .env DATABASE_PUBLIC_URL=mysql://... (mantém user/pass/host público).');
  console.error('Opcional: TCP Proxy (variáveis RAILWAY_TCP_PROXY_DOMAIN / RAILWAY_TCP_PROXY_PORT).');
  console.error('');
}

async function columnExists(conn, table, col) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return rows[0].c > 0;
}

async function main() {
  const base = resolveMigrateConfig();
  if (!base) {
    console.error('Sem configuração MySQL válida.');
    console.error('Diagnóstico:', getMysqlEnvDiagnostics());
    printRailwayInternalHelp();
    process.exit(1);
  }

  let conn;
  try {
    conn = await mysql.createConnection({ ...base, multipleStatements: true });
  } catch (e) {
    if (e.code === 'ENOTFOUND' && String(e.message || '').includes('railway.internal')) {
      console.error(e.message);
      printRailwayInternalHelp();
      process.exit(1);
    }
    if (e.code === 'ECONNREFUSED' && (base.host === '127.0.0.1' || base.host === 'localhost')) {
      console.error('MySQL recusou em', base.host + ':' + base.port);
      printRailwayInternalHelp();
      process.exit(1);
    }
    throw e;
  }

  try {
    if (await columnExists(conn, 'customers', 'lead_id')) {
      console.log('Coluna customers.lead_id já existe.');
      return;
    }
    await conn.query(`
      ALTER TABLE customers
      ADD COLUMN lead_id INT NULL DEFAULT NULL COMMENT 'Lead de origem (conversão CRM)'
      AFTER id
    `);
    console.log('Coluna customers.lead_id criada.');
    try {
      await conn.query('CREATE INDEX idx_customers_lead_id ON customers (lead_id)');
      console.log('Índice idx_customers_lead_id criado.');
    } catch (e) {
      if (!String(e.message || '').includes('Duplicate')) console.warn(e.message);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  if (e.code === 'ENOTFOUND' && String(e.message || '').includes('railway.internal')) {
    printRailwayInternalHelp();
  }
  process.exit(1);
});
