/**
 * Coluna customers.responsible_name — pessoa de contacto para tipo builder (empresa em `name`).
 * Idempotente.
 *
 * `railway run` injeta DATABASE_URL interna mas muitas vezes não inclui DATABASE_PUBLIC_URL.
 * Carregamos .env de vários caminhos (merge, sem override) ou podes confiar no arranque do servidor
 * (ensureCustomersResponsibleNameColumn) após deploy no Railway.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getMysqlConnectionConfig, getMysqlEnvDiagnostics } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

/** Vários sítios comuns — não sobrescreve o que o Railway CLI já injetou. */
function loadLocalEnvForMigrate() {
  const candidates = [
    path.join(packageRoot, '.env'),
    path.join(packageRoot, '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
  ];
  const seen = new Set();
  for (const p of candidates) {
    const norm = path.normalize(p);
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (!fs.existsSync(norm)) continue;
    dotenv.config({ path: norm });
    console.log('[migrate] Carregado:', norm);
  }
}

loadLocalEnvForMigrate();

function parseMysqlUrl(url) {
  if (!url?.trim()) return null;
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

/**
 * URLs explícitas de rede pública (Railway → MySQL → Connect → Public).
 * Devem ir primeiro: getMysqlConnectionConfig() prefere DATABASE_URL / MYSQLHOST (internos).
 */
function configFromExplicitPublicMysqlUrls() {
  const candidates = [
    ['DATABASE_PUBLIC_URL', process.env.DATABASE_PUBLIC_URL],
    ['MYSQL_PUBLIC_URL', process.env.MYSQL_PUBLIC_URL],
    ['MYSQL_URL_PUBLIC', process.env.MYSQL_URL_PUBLIC],
  ];
  for (const [key, raw] of candidates) {
    const s = raw?.trim();
    if (!s) continue;
    const cfg = parseMysqlUrl(s);
    if (!cfg?.host || !cfg?.database) {
      continue;
    }
    if (isRailwayInternalHost(cfg.host)) {
      console.warn(
        `[migrate] ${key} aponta para *.railway.internal — precisa da URL "Public network" (ex.: *.proxy.rlwy.net), não a interna.`
      );
      continue;
    }
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

function printInternalHostHelp() {
  const rawPub = process.env.DATABASE_PUBLIC_URL?.trim();
  const parsedPub = rawPub ? parseMysqlUrl(rawPub) : null;
  console.error('');
  console.error('Host mysql.railway.internal não resolve no teu computador — só dentro do deploy Railway.');
  console.error('');
  console.error('Diagnóstico (sem mostrar passwords):');
  console.error('  DATABASE_PUBLIC_URL definida:', Boolean(rawPub));
  if (rawPub) {
    console.error('  Host após parse:', parsedPub?.host || '(URL inválida — escapa caracteres especiais na password na URL)');
    if (parsedPub?.host && isRailwayInternalHost(parsedPub.host)) {
      console.error('  → Estás a usar a URL interna. No MySQL → Variables copia a URL da aba "Public network".');
    }
  }
  console.error('  MYSQL_PUBLIC_URL definida:', Boolean(process.env.MYSQL_PUBLIC_URL?.trim()));
  console.error('');
  console.error('Opção A — Variáveis no Railway (serviço Node senior-floors-system):');
  console.error('  DATABASE_PUBLIC_URL=mysql://user:pass@HOST_PUBLICO:PORTA/railway');
  console.error('  (host da aba MySQL → Connect → Public network, não mysql.railway.internal)');
  console.error('');
  console.error('Opção B — Ficheiro .env local (gitignored), num destes caminhos:');
  console.error(`  ${path.join(packageRoot, '.env')}`);
  console.error(`  ${path.join(process.cwd(), '.env')}`);
  console.error('  DATABASE_PUBLIC_URL=mysql://...');
  console.error('');
  console.error('Opção C — Sem URL pública: faz deploy / reinicia o serviço Node no Railway.');
  console.error('  O arranque da app aplica automaticamente a coluna responsible_name se faltar.');
  console.error('');
  console.error('Depois (se usares A ou B): railway run -s senior-floors-system npm run migrate:customers-responsible-name');
  console.error('');
}

async function main() {
  const base = resolveMigrateConfig();
  if (!base) {
    console.error('Sem MySQL. Diagnóstico:', getMysqlEnvDiagnostics());
    process.exit(1);
  }
  let conn;
  try {
    conn = await mysql.createConnection({ ...base, multipleStatements: true });
  } catch (e) {
    if (e?.code === 'ENOTFOUND' && String(base.host || '').includes('railway.internal')) {
      printInternalHostHelp();
    }
    throw e;
  }
  try {
    const [[{ c }]] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'responsible_name'`
    );
    if (c > 0) {
      console.log('Coluna customers.responsible_name já existe.');
      return;
    }
    await conn.query(`
      ALTER TABLE customers
      ADD COLUMN responsible_name VARCHAR(255) NULL DEFAULT NULL
        COMMENT 'Builder: contacto / responsável (empresa em name)'
        AFTER name
    `);
    console.log('Coluna customers.responsible_name criada.');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
