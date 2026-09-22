/**
 * Script para executar schema.sql no Railway MySQL
 * Uso: railway run node database/run-schema.js
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSchema() {
  // Railway MySQL: para conexão externa, use DATABASE_PUBLIC_URL ou TCP Proxy
  // DATABASE_PUBLIC_URL tem formato: mysql://user:pass@host:port/dbname
  let host, port, user, password, database;
  
  if (process.env.DATABASE_PUBLIC_URL) {
    // Parse DATABASE_PUBLIC_URL
    const url = new URL(process.env.DATABASE_PUBLIC_URL);
    host = url.hostname;
    port = parseInt(url.port || '3306');
    user = url.username;
    password = url.password;
    database = url.pathname.slice(1); // Remove leading /
  } else {
    // Fallback para variáveis individuais (TCP Proxy ou manual)
    host = process.env.RAILWAY_TCP_PROXY_DOMAIN || process.env.MYSQLHOST || process.env.MYSQL_HOST || process.env.DB_HOST;
    port = parseInt(process.env.RAILWAY_TCP_PROXY_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || process.env.DB_PORT || '3306');
    user = process.env.MYSQLUSER || process.env.MYSQL_USER || process.env.DB_USER;
    password = process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.DB_PASS;
    database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.DB_NAME;
  }
  
  const config = {
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  };

  console.log('Connecting to MySQL...');
  console.log(`Host: ${config.host}`);
  console.log(`Database: ${config.database}`);
  console.log(`User: ${config.user}`);

  if (!config.host || !config.database || !config.user) {
    console.error('❌ Missing MySQL credentials!');
    console.error('Set MYSQLHOST, MYSQLDATABASE, MYSQLUSER, MYSQLPASSWORD (or DB_* equivalents)');
    process.exit(1);
  }

  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to MySQL');

    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.error(`❌ Schema file not found: ${schemaPath}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(schemaPath, 'utf8');
    console.log('📄 Executing schema.sql...');

    await connection.query(sql);
    console.log('✅ Schema executed successfully!');

    // Verificar se a tabela foi criada
    const [tables] = await connection.query("SHOW TABLES LIKE 'leads'");
    if (tables && tables.length > 0) {
      console.log('✅ Table "leads" exists');
    } else {
      console.warn('⚠️  Table "leads" not found (check SQL for errors)');
    }

    await connection.end();
    console.log('✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

runSchema();
