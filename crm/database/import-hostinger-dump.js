/**
 * Script para importar dump SQL completo do Hostinger no Railway MySQL
 * Uso: railway run node database/import-hostinger-dump.js
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function importDump() {
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

  console.log('🚀 Importando dump SQL do Hostinger para Railway MySQL...');
  console.log(`Host: ${config.host}`);
  console.log(`Database: ${config.database}`);
  console.log(`User: ${config.user}`);

  if (!config.host || !config.database || !config.user) {
    console.error('❌ Missing MySQL credentials!');
    console.error('Set MYSQLHOST, MYSQLDATABASE, MYSQLUSER, MYSQLPASSWORD (or DB_* equivalents)');
    process.exit(1);
  }

  const dumpPath = path.join(__dirname, 'u485294289_senior_floors_.sql');
  if (!fs.existsSync(dumpPath)) {
    console.error(`❌ Dump file not found: ${dumpPath}`);
    console.error('Make sure u485294289_senior_floors_.sql is in the database/ folder');
    process.exit(1);
  }

  const fileSize = fs.statSync(dumpPath).size;
  console.log(`📄 Dump file found: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to MySQL');

    // Ler o dump em chunks para arquivos grandes
    console.log('📖 Reading dump file...');
    const sql = fs.readFileSync(dumpPath, 'utf8');
    
    // Processar o dump SQL
    console.log('⚙️  Processing SQL dump...');
    let processedSql = sql;
    
    // Remover referências ao banco antigo
    processedSql = processedSql.replace(/CREATE DATABASE.*?;/gi, '');
    processedSql = processedSql.replace(/USE\s+`?u485294289_senior_floors_`?;?/gi, '');
    processedSql = processedSql.replace(/USE\s+`?[^`;]+`?;?/gi, '');
    
    // Remover comentários de linha única (-- comentário)
    processedSql = processedSql.replace(/^--.*$/gm, '');
    
    // Processar statements SQL preservando strings e multi-linha
    // Dividir por ; mas preservar strings que contenham ;
    const statements = [];
    let currentStatement = '';
    let inString = false;
    let stringChar = null;
    
    for (let i = 0; i < processedSql.length; i++) {
      const char = processedSql[i];
      const nextChar = processedSql[i + 1];
      
      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true;
        stringChar = char;
        currentStatement += char;
      } else if (inString && char === stringChar && processedSql[i - 1] !== '\\') {
        inString = false;
        stringChar = null;
        currentStatement += char;
      } else if (!inString && char === ';' && (nextChar === '\n' || nextChar === '\r' || nextChar === undefined || nextChar === ' ')) {
        currentStatement = currentStatement.trim();
        if (currentStatement.length > 0 && 
            !currentStatement.startsWith('--') && 
            !currentStatement.startsWith('/*') &&
            currentStatement !== 'COMMIT' &&
            currentStatement !== 'START TRANSACTION') {
          statements.push(currentStatement);
        }
        currentStatement = '';
      } else {
        currentStatement += char;
      }
    }
    
    // Adicionar último statement se houver
    if (currentStatement.trim().length > 0) {
      statements.push(currentStatement.trim());
    }
    
    console.log(`📊 Found ${statements.length} SQL statements to execute`);
    console.log('⏳ Executing (this may take several minutes for large dumps)...\n');

    let executed = 0;
    let errors = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Pular comentários e statements vazios
      if (!statement || statement.trim().length === 0) continue;
      
      try {
        await connection.query(statement + ';');
        executed++;
        
        // Progress indicator
        if (executed % 50 === 0) {
          const percent = ((executed / statements.length) * 100).toFixed(1);
          process.stdout.write(`\r   Progress: ${executed}/${statements.length} (${percent}%)`);
        }
      } catch (error) {
        errors++;
        // Ignorar erros de "table already exists" ou "duplicate key"
        if (!error.message.includes('already exists') && 
            !error.message.includes('Duplicate') &&
            !error.message.includes('Unknown database')) {
          console.error(`\n⚠️  Error in statement ${i + 1}:`, error.message.substring(0, 100));
          // Continuar mesmo com erros menores
        }
      }
    }
    
    console.log(`\n\n✅ Import completed!`);
    console.log(`   Executed: ${executed} statements`);
    if (errors > 0) {
      console.log(`   Errors (ignored): ${errors}`);
    }

    // Verificar tabelas criadas
    const [tables] = await connection.query("SHOW TABLES");
    console.log(`\n📊 Tabelas no banco: ${tables.length}`);
    if (tables.length > 0) {
      console.log('   Primeiras 10 tabelas:');
      tables.slice(0, 10).forEach(t => console.log(`   - ${Object.values(t)[0]}`));
      if (tables.length > 10) {
        console.log(`   ... e mais ${tables.length - 10} tabelas`);
      }
    }

    await connection.end();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.sql) {
      console.error('SQL (first 500 chars):', error.sql.substring(0, 500));
    }
    if (connection) await connection.end();
    process.exit(1);
  }
}

importDump();
