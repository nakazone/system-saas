/**
 * Script para definir senha de qualquer usuário
 * Uso: railway run node database/set-password.js [email] [senha]
 * Exemplo: railway run node database/set-password.js admin@senior-floors.com "@@Senior123"
 */
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

async function setPassword() {
  // Pegar email e senha dos argumentos ou usar padrão
  const email = process.argv[2] || 'admin@senior-floors.com';
  const password = process.argv[3] || '@@Senior123';
  
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

  console.log(`🔐 Definindo senha para: ${email}`);
  console.log(`Host: ${config.host}`);
  console.log(`Database: ${config.database}`);
  console.log(`User: ${config.user}\n`);

  if (!config.host || !config.database || !config.user) {
    console.error('❌ Missing MySQL credentials!');
    process.exit(1);
  }

  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to MySQL\n');

    // Verificar estrutura da tabela
    const [allColumns] = await connection.query(`SHOW COLUMNS FROM users`);
    const columnNames = allColumns.map(c => c.Field);
    
    // Procurar coluna de senha
    let passwordColumn = null;
    if (columnNames.includes('password_hash')) {
      passwordColumn = 'password_hash';
    } else if (columnNames.includes('password')) {
      passwordColumn = 'password';
    } else {
      console.error('❌ Nenhuma coluna de senha encontrada!');
      console.error('Colunas:', columnNames.join(', '));
      process.exit(1);
    }
    
    console.log(`🔧 Usando coluna: ${passwordColumn}\n`);

    // Listar todos os usuários
    const [allUsers] = await connection.query(`SELECT id, email, name FROM users LIMIT 20`);
    console.log('📋 Usuários disponíveis:');
    allUsers.forEach(u => console.log(`   - ${u.email} (${u.name || 'N/A'})`));
    console.log('');

    // Verificar se o usuário existe
    const [users] = await connection.query(
      `SELECT id, email, name FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    if (users.length === 0) {
      console.error(`❌ Usuário ${email} não encontrado!`);
      console.error('\n💡 Use um dos emails listados acima ou crie um novo usuário.');
      process.exit(1);
    }

    const targetUser = users[0];
    console.log(`📧 Usuário encontrado: ${targetUser.email} (${targetUser.name || 'N/A'}, ID: ${targetUser.id})\n`);

    // Gerar hash da senha
    console.log('🔑 Gerando hash da senha...');
    const hash = await bcrypt.hash(password, 10);
    console.log(`Hash gerado: ${hash.substring(0, 30)}...\n`);

    // Atualizar senha
    const [result] = await connection.query(
      `UPDATE users SET ${passwordColumn} = ? WHERE email = ?`,
      [hash, email]
    );
    
    if (result.affectedRows === 0) {
      console.error('⚠️  Nenhuma linha foi atualizada!');
      process.exit(1);
    }
    
    console.log('✅ Senha atualizada com sucesso!');
    console.log('\n📋 Credenciais de acesso:');
    console.log(`   Email: ${email}`);
    console.log(`   Senha: ${password}`);
    console.log('\n🔗 Acesse: https://sua-url-railway.up.railway.app');

    await connection.end();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

setPassword();
