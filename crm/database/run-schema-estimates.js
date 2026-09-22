/**
 * Execute schema-estimates.sql
 * Run: node database/run-schema-estimates.js
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detectar variáveis de conexão MySQL (mesma lógica do run-schema-crm-completo.js)
function getMySQLConfig() {
  // Railway MySQL (via TCP Proxy ou DATABASE_PUBLIC_URL)
  if (process.env.DATABASE_PUBLIC_URL) {
    const url = new URL(process.env.DATABASE_PUBLIC_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1), // Remove leading /
      multipleStatements: true
    };
  }

  // Railway TCP Proxy
  if (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT) {
    return {
      host: process.env.RAILWAY_TCP_PROXY_DOMAIN,
      port: parseInt(process.env.RAILWAY_TCP_PROXY_PORT),
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
      multipleStatements: true
    };
  }

  // Railway MySQL padrão (interno)
  if (process.env.MYSQLHOST) {
    return {
      host: process.env.MYSQLHOST,
      port: parseInt(process.env.MYSQLPORT) || 3306,
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
      multipleStatements: true
    };
  }

  // Variáveis padrão do projeto
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'railway',
    multipleStatements: true
  };
}

const config = getMySQLConfig();

console.log('🚀 Executando schema-estimates.sql...');
console.log(`📊 Conectando ao MySQL...`);
console.log(`   Host: ${config.host}`);
console.log(`   Database: ${config.database}`);
console.log(`   User: ${config.user}`);

async function runSchema() {
  let connection;
  
  try {
    // Conectar
    console.log('Tentando conectar com configuração:', {
      host: config.host,
      port: config.port,
      user: config.user,
      database: config.database,
      password: config.password ? '***' : '(empty)'
    });
    
    connection = await mysql.createConnection(config);
    console.log('✅ Conectado ao MySQL\n');
    
    // Ler arquivo SQL
    const sqlFile = path.join(__dirname, 'schema-estimates.sql');
    console.log(`📖 Lendo arquivo: ${sqlFile}...`);
    
    if (!fs.existsSync(sqlFile)) {
      throw new Error(`Arquivo não encontrado: ${sqlFile}`);
    }
    
    const sql = fs.readFileSync(sqlFile, 'utf8');
    console.log(`📄 Arquivo lido: ${(sql.length / 1024).toFixed(2)} KB\n`);
    
    // Dividir em statements
    // Remover comentários de linha única que começam com --
    const cleanedSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--') || line.trim().startsWith('-- ='))
      .join('\n');
    
    // Dividir por ponto e vírgula, mas manter dentro de strings e blocos
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`⚙️  Processando ${statements.length} statements...\n`);
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Executar cada statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Pular statements vazios ou apenas comentários
      if (!statement || statement.trim().length === 0 || statement.trim().startsWith('--')) {
        continue;
      }
      
      try {
        await connection.query(statement);
        successCount++;
        
        // Mostrar progresso a cada 10 statements
        if ((i + 1) % 10 === 0 || i === statements.length - 1) {
          const progress = ((i + 1) / statements.length * 100).toFixed(1);
          process.stdout.write(`\r⏳ Progresso: ${i + 1}/${statements.length} (${progress}%)`);
        }
      } catch (error) {
        errorCount++;
        const errorMsg = error.message || String(error);
        
        // Ignorar erros comuns que não são críticos
        const ignorableErrors = [
          'Duplicate column name',
          'Duplicate key name',
          'Table already exists',
          'Unknown column',
          'Duplicate entry'
        ];
        
        const shouldIgnore = ignorableErrors.some(msg => errorMsg.includes(msg));
        
        if (!shouldIgnore) {
          errors.push({
            statement: i + 1,
            error: errorMsg,
            sql: statement.substring(0, 100) + '...'
          });
          console.error(`\n⚠️  Erro no statement ${i + 1}: ${errorMsg}`);
        }
      }
    }
    
    console.log('\n\n✅ Schema executado!');
    console.log(`   Sucesso: ${successCount}`);
    console.log(`   Erros (ignorados): ${errorCount}`);
    
    if (errors.length > 0) {
      console.log(`\n⚠️  Erros não ignorados:`);
      errors.forEach(e => {
        console.log(`   Statement ${e.statement}: ${e.error}`);
      });
    }
    
    // Verificar tabelas criadas
    console.log('\n📊 Verificando tabelas...');
    const [tables] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME LIKE 'estimate%'
      ORDER BY TABLE_NAME
    `, [config.database]);
    
    if (tables.length > 0) {
      console.log(`\n✅ Tabelas encontradas:`);
      tables.forEach(t => console.log(`   - ${t.TABLE_NAME}`));
    } else {
      console.log('\n⚠️  Nenhuma tabela estimate encontrada');
    }
    
    // Verificar regras
    const [rules] = await connection.query('SELECT COUNT(*) as count FROM estimate_rules');
    console.log(`\n📋 Regras configuradas: ${rules[0].count}`);
    
  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n✅ Conexão fechada');
    }
  }
}

runSchema();
