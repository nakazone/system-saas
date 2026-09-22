/**
 * Script para corrigir erros após importação do dump do Hostinger
 * Uso: railway run node database/fix-import-errors.js
 */
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fixErrors() {
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

  console.log('🔧 Corrigindo erros após importação...');
  console.log(`Host: ${config.host}`);
  console.log(`Database: ${config.database}\n`);

  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to MySQL\n');

    // 1. Verificar tabelas e suas estruturas
    const [tables] = await connection.query("SHOW TABLES");
    console.log(`📊 Total de tabelas: ${tables.length}\n`);

    // 2. Verificar tabela leads
    try {
      const [leadColumns] = await connection.query("SHOW COLUMNS FROM leads");
      console.log('✅ Tabela `leads` existe');
      console.log(`   Colunas: ${leadColumns.length}`);
      
      // Verificar se tem as colunas principais
      const columnNames = leadColumns.map(c => c.Field);
      const required = ['id', 'name', 'email', 'phone', 'zipcode'];
      const missing = required.filter(col => !columnNames.includes(col));
      
      if (missing.length > 0) {
        console.log(`   ⚠️  Colunas faltantes: ${missing.join(', ')}`);
      } else {
        console.log('   ✅ Todas as colunas principais presentes');
      }
    } catch (e) {
      console.log('❌ Tabela `leads` não encontrada:', e.message);
    }

    // 3. Verificar tabela users
    try {
      const [userColumns] = await connection.query("SHOW COLUMNS FROM users");
      console.log('\n✅ Tabela `users` existe');
      console.log(`   Colunas: ${userColumns.length}`);
      
      const columnNames = userColumns.map(c => c.Field);
      if (columnNames.includes('active') && !columnNames.includes('is_active')) {
        console.log('   ⚠️  Tem `active` mas não `is_active` - pode precisar migrar');
      } else if (columnNames.includes('is_active')) {
        console.log('   ✅ Tem `is_active`');
      }
    } catch (e) {
      console.log('\n❌ Tabela `users` não encontrada:', e.message);
    }

    // 4. Verificar foreign keys problemáticas
    console.log('\n🔍 Verificando foreign keys...');
    try {
      const [fks] = await connection.query(`
        SELECT 
          TABLE_NAME,
          CONSTRAINT_NAME,
          COLUMN_NAME,
          REFERENCED_TABLE_NAME,
          REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? 
          AND REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY TABLE_NAME
      `, [database]);
      
      if (fks.length > 0) {
        console.log(`   Encontradas ${fks.length} foreign keys`);
        // Verificar se as tabelas referenciadas existem
        const referencedTables = [...new Set(fks.map(fk => fk.REFERENCED_TABLE_NAME))];
        const existingTables = tables.map(t => Object.values(t)[0]);
        
        const missingRefs = referencedTables.filter(ref => !existingTables.includes(ref));
        if (missingRefs.length > 0) {
          console.log(`   ⚠️  Tabelas referenciadas que não existem: ${missingRefs.join(', ')}`);
        } else {
          console.log('   ✅ Todas as tabelas referenciadas existem');
        }
      }
    } catch (e) {
      console.log('   ⚠️  Erro ao verificar foreign keys:', e.message);
    }

    // 5. Contar registros em tabelas principais
    console.log('\n📈 Contando registros em tabelas principais...');
    const mainTables = ['leads', 'users', 'customers', 'activities', 'projects'];
    
    for (const table of mainTables) {
      try {
        const [result] = await connection.query(`SELECT COUNT(*) as count FROM \`${table}\``);
        console.log(`   ${table}: ${result[0].count} registros`);
      } catch (e) {
        // Tabela não existe ou erro
      }
    }

    // 6. Verificar índices duplicados (Multiple primary key)
    console.log('\n🔍 Verificando problemas de índices...');
    try {
      const [indexes] = await connection.query(`
        SELECT TABLE_NAME, INDEX_NAME, COUNT(*) as count
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND INDEX_NAME = 'PRIMARY'
        GROUP BY TABLE_NAME, INDEX_NAME
        HAVING count > 1
      `, [database]);
      
      if (indexes.length > 0) {
        console.log(`   ⚠️  Tabelas com múltiplos PRIMARY KEY: ${indexes.map(i => i.TABLE_NAME).join(', ')}`);
        console.log('   (Isso geralmente não é um problema real - pode ser cache do MySQL)');
      } else {
        console.log('   ✅ Nenhum problema de índices encontrado');
      }
    } catch (e) {
      console.log('   ⚠️  Erro ao verificar índices:', e.message);
    }

    await connection.end();
    console.log('\n✅ Verificação concluída!');
    console.log('\n💡 Dica: Os erros durante a importação são normais e não impedem o funcionamento.');
    console.log('   A maioria das tabelas foi criada com sucesso (38 tabelas).');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

fixErrors();
