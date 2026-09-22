/**
 * Script simplificado para executar schema-estimates.sql
 * Usa a mesma lógica de conexão do run-schema-crm-completo.js
 * 
 * Uso:
 *   railway run node database/run-schema-estimates-simple.js
 * 
 * Ou localmente (com .env):
 *   node database/run-schema-estimates-simple.js
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
      database: url.pathname.slice(1),
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

async function runSchema() {
  const config = getMySQLConfig();
  let connection;
  
  try {
    console.log('🚀 Executando schema-estimates.sql...');
    console.log(`📊 Conectando ao MySQL...`);
    console.log(`   Host: ${config.host}`);
    console.log(`   Database: ${config.database}`);
    console.log(`   User: ${config.user}`);
    
    connection = await mysql.createConnection(config);
    console.log('✅ Conectado ao MySQL\n');
    
    // Ler arquivo SQL (tentar versão simplificada primeiro)
    let sqlFile = path.join(__dirname, 'schema-estimates-simple.sql');
    if (!fs.existsSync(sqlFile)) {
      sqlFile = path.join(__dirname, 'schema-estimates.sql');
    }
    console.log(`📖 Lendo arquivo: ${sqlFile}...`);
    
    if (!fs.existsSync(sqlFile)) {
      throw new Error(`Arquivo não encontrado: ${sqlFile}`);
    }
    
    const sql = fs.readFileSync(sqlFile, 'utf8');
    console.log(`📄 Arquivo lido: ${(sql.length / 1024).toFixed(2)} KB\n`);
    
    // Executar SQL completo (com múltiplos statements)
    console.log('⚙️  Executando SQL...\n');
    
    try {
      await connection.query(sql);
      console.log('✅ SQL executado com sucesso!\n');
    } catch (error) {
      // Se der erro, tentar executar statement por statement
      console.log('⚠️  Erro ao executar SQL completo, tentando statement por statement...\n');
      
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        
        if (!statement || statement.trim().length === 0) continue;
        
        try {
          await connection.query(statement);
          successCount++;
        } catch (err) {
          errorCount++;
          const errorMsg = err.message || String(err);
          
          // Ignorar erros comuns
          const ignorableErrors = [
            'Duplicate column name',
            'Duplicate key name',
            'Table already exists',
            'Duplicate entry',
            'Unknown column'
          ];
          
          if (!ignorableErrors.some(msg => errorMsg.includes(msg))) {
            console.error(`⚠️  Erro no statement ${i + 1}: ${errorMsg}`);
            console.error(`   SQL: ${statement.substring(0, 100)}...\n`);
          }
        }
      }
      
      console.log(`✅ Execução concluída: ${successCount} sucessos, ${errorCount} erros (ignorados)\n`);
    }
    
    // Verificar tabelas criadas
    console.log('📊 Verificando tabelas...');
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
    try {
      const [rules] = await connection.query('SELECT COUNT(*) as count FROM estimate_rules');
      console.log(`\n📋 Regras configuradas: ${rules[0].count}`);
    } catch (e) {
      console.log('\n⚠️  Tabela estimate_rules ainda não existe');
    }
    
    console.log('\n✅ Processo concluído!');
    
  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    if (error.code) {
      console.error('   Código:', error.code);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n✅ Conexão fechada');
    }
  }
}

runSchema();
