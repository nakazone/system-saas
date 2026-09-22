/**
 * Script para executar schema-completo.sql no Railway MySQL
 * Uso: railway run node database/run-schema-completo.js
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSchema() {
  // Railway MySQL: para conexão externa, use DATABASE_PUBLIC_URL ou TCP Proxy
  let host, port, user, password, database;
  
  if (process.env.DATABASE_PUBLIC_URL) {
    const url = new URL(process.env.DATABASE_PUBLIC_URL);
    host = url.hostname;
    port = parseInt(url.port || '3306');
    user = url.username;
    password = url.password;
    database = url.pathname.slice(1);
  } else {
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

  console.log('🚀 Executando Schema Completo do CRM...');
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

    // Verificar se precisa migrar tabela users (de 'active' para 'is_active')
    try {
      const [columns] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('active', 'is_active')
      `, [config.database]);
      
      const hasActive = columns.some(c => c.COLUMN_NAME === 'active');
      const hasIsActive = columns.some(c => c.COLUMN_NAME === 'is_active');
      
      if (hasActive && !hasIsActive) {
        console.log('🔄 Migrando tabela users (active → is_active)...');
        await connection.query('ALTER TABLE `users` CHANGE COLUMN `active` `is_active` tinyint(1) DEFAULT 1 COMMENT \'1=ativo, 0=inativo\'');
        console.log('✅ Migração concluída');
      }
      
      // Adicionar colunas faltantes se a tabela users já existe
      const [allColumns] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
      `, [config.database]);
      
      const columnNames = allColumns.map(c => c.COLUMN_NAME);
      const alters = [];
      
      if (!columnNames.includes('phone')) {
        alters.push('ADD COLUMN `phone` varchar(50) DEFAULT NULL AFTER `is_active`');
      }
      if (!columnNames.includes('avatar')) {
        alters.push('ADD COLUMN `avatar` varchar(500) DEFAULT NULL COMMENT \'URL da foto do perfil\' AFTER `phone`');
      }
      if (!columnNames.includes('last_login_at')) {
        alters.push('ADD COLUMN `last_login_at` timestamp NULL DEFAULT NULL AFTER `avatar`');
      }
      
      if (alters.length > 0) {
        console.log('🔄 Adicionando colunas faltantes na tabela users...');
        await connection.query(`ALTER TABLE \`users\` ${alters.join(', ')}`);
        console.log('✅ Colunas adicionadas');
      }
      
      // Adicionar índices se não existirem
      const [indexes] = await connection.query(`
        SELECT INDEX_NAME 
        FROM information_schema.STATISTICS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME IN ('idx_role', 'idx_is_active')
      `, [config.database]);
      
      const indexNames = indexes.map(i => i.INDEX_NAME);
      const indexAlters = [];
      
      if (!indexNames.includes('idx_role')) {
        indexAlters.push('ADD KEY `idx_role` (`role`)');
      }
      if (!indexNames.includes('idx_is_active')) {
        indexAlters.push('ADD KEY `idx_is_active` (`is_active`)');
      }
      
      if (indexAlters.length > 0) {
        console.log('🔄 Adicionando índices faltantes...');
        await connection.query(`ALTER TABLE \`users\` ${indexAlters.join(', ')}`);
        console.log('✅ Índices adicionados');
      }
    } catch (migError) {
      // Se a tabela não existe, tudo bem - será criada pelo schema
      if (!migError.message.includes("doesn't exist")) {
        console.warn('⚠️  Aviso na migração:', migError.message);
      }
    }

    const schemaPath = path.join(__dirname, 'schema-completo.sql');
    if (!fs.existsSync(schemaPath)) {
      console.error(`❌ Schema file not found: ${schemaPath}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(schemaPath, 'utf8');
    console.log('\n📄 Executando schema-completo.sql...');
    console.log('   (This may take a few moments...)');

    await connection.query(sql);
    console.log('✅ Schema completo executado com sucesso!');

    // Verificar tabelas criadas
    const [tables] = await connection.query("SHOW TABLES");
    console.log(`\n📊 Tabelas criadas: ${tables.length}`);
    tables.forEach(t => console.log(`   - ${Object.values(t)[0]}`));

    // Verificar dados iniciais
    const [stages] = await connection.query("SELECT COUNT(*) as count FROM pipeline_stages");
    const [users] = await connection.query("SELECT COUNT(*) as count FROM users");
    const [settings] = await connection.query("SELECT COUNT(*) as count FROM settings");

    console.log(`\n📦 Dados iniciais:`);
    console.log(`   - Estágios do pipeline: ${stages[0].count}`);
    console.log(`   - Usuários: ${users[0].count}`);
    console.log(`   - Configurações: ${settings[0].count}`);

    if (users[0].count > 0) {
      const [admin] = await connection.query("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
      if (admin[0]) {
        console.log(`\n🔐 Usuário Admin criado:`);
        console.log(`   Email: ${admin[0].email}`);
        console.log(`   Senha padrão: admin123`);
        console.log(`   ⚠️  ALTERE A SENHA APÓS O PRIMEIRO LOGIN!`);
      }
    }

    await connection.end();
    console.log('\n✅ Concluído!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.sql) console.error('SQL:', error.sql.substring(0, 200));
    if (connection) await connection.end();
    process.exit(1);
  }
}

runSchema();
