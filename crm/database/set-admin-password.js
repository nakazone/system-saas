/**
 * Script para definir senha do admin
 * Uso: railway run node database/set-admin-password.js
 */
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

async function setAdminPassword() {
  const password = '@@Senior123';
  
  // Railway MySQL: para conexão externa, use DATABASE_PUBLIC_URL ou TCP Proxy
  let host, port, user, password_db, database;
  
  if (process.env.DATABASE_PUBLIC_URL) {
    const url = new URL(process.env.DATABASE_PUBLIC_URL);
    host = url.hostname;
    port = parseInt(url.port || '3306');
    user = url.username;
    password_db = url.password;
    database = url.pathname.slice(1);
  } else {
    host = process.env.RAILWAY_TCP_PROXY_DOMAIN || process.env.MYSQLHOST || process.env.MYSQL_HOST || process.env.DB_HOST;
    port = parseInt(process.env.RAILWAY_TCP_PROXY_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || process.env.DB_PORT || '3306');
    user = process.env.MYSQLUSER || process.env.MYSQL_USER || process.env.DB_USER;
    password_db = process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.DB_PASS;
    database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.DB_NAME;
  }
  
  const config = {
    host,
    port,
    user,
    password: password_db,
    database,
  };

  console.log('🔐 Definindo senha do admin...');
  console.log(`Host: ${config.host}`);
  console.log(`Database: ${config.database}`);
  console.log(`User: ${config.user}\n`);

  if (!config.host || !config.database || !config.user) {
    console.error('❌ Missing MySQL credentials!');
    console.error('Set MYSQLHOST, MYSQLDATABASE, MYSQLUSER, MYSQLPASSWORD (or DB_* equivalents)');
    process.exit(1);
  }

  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to MySQL\n');

    // Gerar hash da senha
    console.log('🔑 Gerando hash da senha...');
    const hash = await bcrypt.hash(password, 10);
    console.log(`Hash gerado: ${hash.substring(0, 30)}...\n`);

    // Primeiro verificar quais colunas existem
    const [allColumns] = await connection.query(
      `SHOW COLUMNS FROM users`
    );
    
    const columnNames = allColumns.map(c => c.Field);
    console.log('📋 Colunas encontradas na tabela users:');
    columnNames.forEach(col => console.log(`   - ${col}`));
    
    // Verificar se o usuário admin existe (sem incluir coluna de senha ainda)
    const [users] = await connection.query(
      `SELECT id, email FROM users WHERE email = ? LIMIT 1`,
      ['admin@senior-floors.com']
    );

    if (users.length === 0) {
      // Tentar listar todos os usuários para debug
      console.log('\n⚠️  Usuário admin@senior-floors.com não encontrado!');
      console.log('📋 Listando todos os usuários disponíveis:');
      const [allUsers] = await connection.query(`SELECT id, email, name FROM users LIMIT 10`);
      if (allUsers.length > 0) {
        allUsers.forEach(u => console.log(`   - ${u.email} (${u.name || 'N/A'})`));
        console.log('\n💡 Você pode usar qualquer um desses emails ou criar um novo usuário admin.');
      } else {
        console.log('   Nenhum usuário encontrado na tabela!');
      }
      process.exit(1);
    }

    const adminUser = users[0];
    console.log(`\n📧 Usuário encontrado: ${adminUser.email} (ID: ${adminUser.id})`);
    
    // Procurar coluna de senha
    let passwordColumn = null;
    if (columnNames.includes('password_hash')) {
      passwordColumn = 'password_hash';
    } else if (columnNames.includes('password')) {
      passwordColumn = 'password';
    } else {
      console.error('\n❌ Nenhuma coluna de senha encontrada!');
      console.error('Colunas disponíveis:', columnNames.join(', '));
      console.error('\n💡 Você pode criar a coluna manualmente:');
      console.error('ALTER TABLE users ADD COLUMN password VARCHAR(255) NULL;');
      process.exit(1);
    }
    
    console.log(`\n🔧 Usando coluna: ${passwordColumn}`);

    // Atualizar senha
    try {
      const [result] = await connection.query(
        `UPDATE users SET ${passwordColumn} = ? WHERE email = ?`,
        [hash, 'admin@senior-floors.com']
      );
      
      if (result.affectedRows === 0) {
        console.error('\n⚠️  Nenhuma linha foi atualizada!');
        console.error('Verifique se o email está correto ou se o usuário existe.');
        process.exit(1);
      }
      
      console.log(`✅ Senha atualizada na coluna ${passwordColumn}`);
    } catch (e) {
      console.error('❌ Erro ao atualizar senha:', e.message);
      process.exit(1);
    }

    console.log('\n✅ Senha definida com sucesso!');
    console.log('\n📋 Credenciais de acesso:');
    console.log('   Email: admin@senior-floors.com');
    console.log('   Senha: @@Senior123');
    console.log('\n🔗 Acesse: https://sua-url-railway.up.railway.app');

    await connection.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

setAdminPassword();
