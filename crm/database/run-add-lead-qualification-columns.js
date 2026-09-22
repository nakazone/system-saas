/**
 * Add missing columns to lead_qualification table.
 *
 * Run: railway run node database/run-add-lead-qualification-columns.js
 * Or:  node database/run-add-lead-qualification-columns.js (with .env)
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

const alterations = [
  ['decision_maker', `ALTER TABLE lead_qualification ADD COLUMN decision_maker VARCHAR(255) DEFAULT NULL COMMENT 'Nome do tomador de decisão'`],
  ['decision_timeline', `ALTER TABLE lead_qualification ADD COLUMN decision_timeline VARCHAR(100) DEFAULT NULL COMMENT '1 semana, 1 mês, etc.'`],
  ['payment_type', `ALTER TABLE lead_qualification ADD COLUMN payment_type VARCHAR(50) DEFAULT NULL COMMENT 'cash, financing, insurance'`],
  ['score', `ALTER TABLE lead_qualification ADD COLUMN score INT(11) DEFAULT NULL COMMENT 'Score de qualificação (0-100)'`],
  ['qualification_notes', `ALTER TABLE lead_qualification ADD COLUMN qualification_notes TEXT DEFAULT NULL COMMENT 'Notas da qualificação'`],
  ['qualified_by', `ALTER TABLE lead_qualification ADD COLUMN qualified_by INT(11) DEFAULT NULL COMMENT 'FK users'`],
  ['qualified_at', `ALTER TABLE lead_qualification ADD COLUMN qualified_at TIMESTAMP NULL DEFAULT NULL`],
  ['address_street', `ALTER TABLE lead_qualification ADD COLUMN address_street VARCHAR(255) DEFAULT NULL COMMENT 'Rua e número'`],
  ['address_line2', `ALTER TABLE lead_qualification ADD COLUMN address_line2 VARCHAR(255) DEFAULT NULL COMMENT 'Complemento'`],
  ['address_city', `ALTER TABLE lead_qualification ADD COLUMN address_city VARCHAR(120) DEFAULT NULL COMMENT 'Cidade'`],
  ['address_state', `ALTER TABLE lead_qualification ADD COLUMN address_state VARCHAR(50) DEFAULT NULL COMMENT 'Estado'`],
  ['address_zip', `ALTER TABLE lead_qualification ADD COLUMN address_zip VARCHAR(20) DEFAULT NULL COMMENT 'CEP / ZIP'`],
];

async function main() {
  const config = getMySQLConfig();
  if (!config) {
    console.error('No database config found. Set DATABASE_PUBLIC_URL or DB_* env vars.');
    process.exit(1);
  }
  console.log('Connecting to MySQL...');
  const conn = await mysql.createConnection(config);
  try {
    for (const [name, sql] of alterations) {
      try {
        await conn.execute(sql);
        console.log('Column', name, 'added.');
      } catch (err) {
        const isDuplicate = err.code === 'ER_DUP_FIELD_NAME' || (err.message && err.message.includes('Duplicate column name'));
        if (isDuplicate) {
          console.log('Column', name, 'already exists.');
        } else {
          console.error('Error adding', name + ':', err.message);
        }
      }
    }
    console.log('Done.');
  } finally {
    await conn.end();
  }
}

main();
