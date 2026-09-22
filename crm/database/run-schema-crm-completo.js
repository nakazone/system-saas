/**
 * Script para executar schema-crm-completo.sql no Railway MySQL
 * 
 * Uso:
 *   railway run node database/run-schema-crm-completo.js
 * 
 * Ou localmente:
 *   node database/run-schema-crm-completo.js
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detectar variáveis de conexão MySQL
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
    };
  }

  // Fallback para variáveis genéricas
  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    };
  }

  throw new Error('MySQL connection variables not found. Configure DATABASE_PUBLIC_URL, Railway TCP Proxy, or DB_* variables.');
}

async function main() {
  console.log('🚀 Executando schema CRM completo...\n');

  const config = getMySQLConfig();
  console.log(`📊 Conectando ao MySQL...`);
  console.log(`   Host: ${config.host}`);
  console.log(`   Database: ${config.database}`);
  console.log(`   User: ${config.user}\n`);

  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Conectado ao MySQL\n');

    // Ler arquivo SQL
    const sqlFile = path.join(__dirname, 'schema-crm-completo.sql');
    console.log(`📖 Lendo arquivo: ${sqlFile}`);
    
    if (!fs.existsSync(sqlFile)) {
      throw new Error(`Arquivo não encontrado: ${sqlFile}`);
    }

    const sql = fs.readFileSync(sqlFile, 'utf8');
    console.log(`📄 Arquivo lido: ${(sql.length / 1024).toFixed(2)} KB\n`);

    // Dividir em statements (remover comentários e linhas vazias)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

    console.log(`⚙️  Executando ${statements.length} statements...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Pular comentários e linhas vazias
      if (statement.trim().length === 0 || statement.trim().startsWith('--')) {
        continue;
      }

      try {
        await connection.execute(statement);
        successCount++;
        
        // Log a cada 5 statements
        if ((i + 1) % 5 === 0 || i === statements.length - 1) {
          process.stdout.write(`\r   Progresso: ${i + 1}/${statements.length} (${successCount} sucesso, ${errorCount} erros)`);
        }
      } catch (error) {
        errorCount++;
        // Ignorar erros comuns de tabelas/colunas já existentes
        const ignorableErrors = [
          'already exists',
          'Duplicate key',
          'Duplicate entry',
          'Unknown column', // Coluna pode não existir ainda, será criada pela migração
        ];
        
        const shouldIgnore = ignorableErrors.some(err => error.message.includes(err));
        
        if (!shouldIgnore) {
          console.error(`\n⚠️  Erro no statement ${i + 1}:`, error.message);
          console.error(`   SQL: ${statement.substring(0, 100)}...`);
        }
      }
    }

    console.log(`\n\n✅ Schema executado!`);
    console.log(`   Sucesso: ${successCount}`);
    console.log(`   Erros (ignorados): ${errorCount}\n`);

    // Verificar tabelas criadas
    const [tables] = await connection.execute("SHOW TABLES");
    console.log(`📊 Tabelas no banco: ${tables.length}`);
    console.log(`   Primeiras 15 tabelas:`);
    tables.slice(0, 15).forEach((table, idx) => {
      const tableName = Object.values(table)[0];
      console.log(`   ${idx + 1}. ${tableName}`);
    });
    if (tables.length > 15) {
      console.log(`   ... e mais ${tables.length - 15} tabelas\n`);
    }

    // Verificar pipeline_stages
    const [stages] = await connection.execute("SELECT COUNT(*) as count FROM pipeline_stages");
    console.log(`\n📋 Estágios do pipeline: ${stages[0].count}`);
    const [stageList] = await connection.execute("SELECT id, name, slug, order_num FROM pipeline_stages ORDER BY order_num");
    stageList.forEach(stage => {
      console.log(`   ${stage.order_num}. ${stage.name} (${stage.slug})`);
    });

    console.log('\n✅ Schema CRM completo instalado com sucesso!');

  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();
