# Como Importar schema.sql no Railway MySQL

## Método 1: Via MySQL CLI (Recomendado)

### Passo 1: Obter credenciais de conexão

1. No Railway, vá no serviço **MySQL**
2. Clique na aba **"Data"** ou **"Variables"**
3. Anote as variáveis:
   - `MYSQLHOST` (ou `MYSQL_HOST`)
   - `MYSQLDATABASE` (ou `MYSQL_DATABASE`)
   - `MYSQLUSER` (ou `MYSQL_USER`)
   - `MYSQLPASSWORD` (ou `MYSQL_PASSWORD`)
   - `MYSQLPORT` (geralmente 3306)

### Passo 2: Executar o SQL localmente

No terminal, execute:

```bash
# Opção A: Via pipe
mysql -h MYSQLHOST -P MYSQLPORT -u MYSQLUSER -pMYSQLPASSWORD MYSQLDATABASE < database/schema.sql

# Opção B: Conectar e executar
mysql -h MYSQLHOST -P MYSQLPORT -u MYSQLUSER -pMYSQLPASSWORD MYSQLDATABASE
# Depois dentro do MySQL:
source database/schema.sql;
# ou cole o conteúdo do arquivo
```

**Exemplo real:**
```bash
mysql -h mysql.railway.internal -P 3306 -u root -pSuaSenhaAqui senior_floors_db < database/schema.sql
```

---

## Método 2: Via Railway CLI

### Passo 1: Instalar Railway CLI

```bash
npm install -g @railway/cli
# ou
brew install railway
```

### Passo 2: Conectar ao MySQL

```bash
# Login no Railway
railway login

# Conectar ao projeto
railway link

# Conectar ao MySQL via tunnel
railway connect mysql
```

Isso abrirá uma conexão MySQL interativa. Depois execute:

```sql
USE seu_database;
SOURCE database/schema.sql;
```

Ou cole o conteúdo do `schema.sql` diretamente.

---

## Método 3: Via Ferramenta GUI (MySQL Workbench, DBeaver, TablePlus)

### Passo 1: Obter string de conexão

No Railway MySQL → **"Data"** → **"Connect"** → copie a connection string ou use:

```
Host: MYSQLHOST
Port: MYSQLPORT
Database: MYSQLDATABASE
User: MYSQLUSER
Password: MYSQLPASSWORD
```

### Passo 2: Conectar e executar

1. Abra MySQL Workbench (ou DBeaver, TablePlus, etc.)
2. Crie uma nova conexão com os dados acima
3. Conecte ao banco
4. Abra o arquivo `database/schema.sql`
5. Execute o SQL (F9 no Workbench, ou botão "Execute")

---

## Método 4: Via código Node.js (temporário)

Crie um script temporário para executar o schema:

```javascript
// run-schema.js
import mysql from 'mysql2/promise';
import fs from 'fs';

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  port: process.env.MYSQLPORT || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASS,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  multipleStatements: true
});

const sql = fs.readFileSync('./database/schema.sql', 'utf8');
await pool.query(sql);
console.log('Schema imported!');
await pool.end();
```

Execute:
```bash
railway run node run-schema.js
```

---

## Verificar se funcionou

Após importar, teste:

```bash
curl https://sua-url-railway.up.railway.app/api/db-check
```

Deve retornar: `"table_leads_exists": true`

---

## Troubleshooting

### Erro: "Access denied"
- Verifique se as credenciais estão corretas
- Verifique se o IP está liberado (se aplicável)

### Erro: "Table already exists"
- Isso é normal se você já executou antes
- O `CREATE TABLE IF NOT EXISTS` evita erros

### Não consigo conectar
- Verifique se o MySQL está rodando no Railway
- Verifique se as variáveis de ambiente estão corretas
- Tente usar o método via Railway CLI (método 2)
