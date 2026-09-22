/**
 * Adiciona coluna `address` em `leads` (endereço completo em uma linha).
 * Idempotente. Run: node database/add-lead-address-column.js
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
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
  } catch (_) {
    return null;
  }
}

function getConfig() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  const fromUrl = parseDatabaseUrl(url);
  if (fromUrl && fromUrl.user && fromUrl.database) return fromUrl;
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS && process.env.DB_NAME) {
    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    };
  }
  return null;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function main() {
  const cfg = getConfig();
  if (!cfg) {
    console.error('Defina DATABASE_URL ou DB_HOST, DB_USER, DB_PASS, DB_NAME');
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...cfg, charset: 'utf8mb4' });
  try {
    if (await columnExists(conn, 'leads', 'address')) {
      console.log('Coluna leads.address já existe.');
      return;
    }
    await conn.query(
      "ALTER TABLE `leads` ADD COLUMN `address` VARCHAR(500) NULL DEFAULT NULL COMMENT 'Endereço completo (linha única)' AFTER `zipcode`"
    );
    console.log('Coluna leads.address criada.');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
