/**
 * Add notes column to leads table.
 *
 * Run: railway run node database/run-add-leads-notes.js
 * Or:  node database/run-add-leads-notes.js (with .env)
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function getMySQLConfig() {
  if (process.env.DATABASE_PUBLIC_URL) {
    const url = new URL(process.env.DATABASE_PUBLIC_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
    };
  }
  if (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT) {
    return {
      host: process.env.RAILWAY_TCP_PROXY_DOMAIN,
      port: parseInt(process.env.RAILWAY_TCP_PROXY_PORT),
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
    };
  }
  if (process.env.MYSQLHOST) {
    return {
      host: process.env.MYSQLHOST,
      port: parseInt(process.env.MYSQLPORT) || 3306,
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
    };
  }
  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME || 'railway',
    };
  }
  return null;
}

const sql = `ALTER TABLE leads ADD COLUMN notes TEXT DEFAULT NULL COMMENT 'Notas gerais'`;

async function main() {
  const config = getMySQLConfig();
  if (!config) {
    console.error('No database config found. Set DATABASE_PUBLIC_URL or DB_* env vars.');
    process.exit(1);
  }
  console.log('Connecting to MySQL...');
  const conn = await mysql.createConnection(config);
  try {
    await conn.execute(sql);
    console.log('Column notes added to leads.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELD_NAME') {
      console.log('Column notes already exists. Nothing to do.');
    } else {
      console.error('Error:', err.message);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

main();
