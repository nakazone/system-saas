# Importar Dump SQL do Hostinger para Railway

Este guia mostra como importar o dump completo do Hostinger (`u485294289_senior_floors_.sql`) para o Railway MySQL.

## Método 1: Via Script Node.js (Recomendado)

```bash
cd /Users/naka/senior-floors-landing/senior-floors-system
railway run node database/import-hostinger-dump.js
```

O script vai:
- Conectar ao Railway MySQL
- Processar o dump SQL
- Remover referências ao banco antigo (`u485294289_senior_floors_`)
- Executar todos os statements SQL
- Mostrar progresso e tabelas criadas

---

## Método 2: Via MySQL CLI (Mais Confiável para Dumps Grandes)

### Passo 1: Obter credenciais do Railway

No Railway → serviço MySQL → **"Variables"** → copie:
- `RAILWAY_TCP_PROXY_DOMAIN` (ou `MYSQLHOST`)
- `RAILWAY_TCP_PROXY_PORT` (ou `MYSQLPORT`)
- `MYSQLUSER`
- `MYSQLPASSWORD`
- `MYSQLDATABASE`

### Passo 2: Processar o dump (remover referências ao banco antigo)

```bash
cd /Users/naka/senior-floors-landing/senior-floors-system/database

# Criar versão processada do dump
sed -e "s/u485294289_senior_floors_/railway/g" \
    -e "/CREATE DATABASE/d" \
    -e "/USE.*u485294289_senior_floors_/d" \
    u485294289_senior_floors_.sql > dump-processed.sql
```

### Passo 3: Importar via MySQL CLI

```bash
mysql -h RAILWAY_TCP_PROXY_DOMAIN \
      -P RAILWAY_TCP_PROXY_PORT \
      -u MYSQLUSER \
      -pMYSQLPASSWORD \
      MYSQLDATABASE < dump-processed.sql
```

**Exemplo real:**
```bash
mysql -h switchback.proxy.rlwy.net \
      -P 12345 \
      -u root \
      -pSuaSenha \
      railway < dump-processed.sql
```

---

## Método 3: Via Ferramenta GUI (MySQL Workbench, DBeaver, TablePlus)

### Passo 1: Conectar ao Railway MySQL

1. Railway MySQL → **"Data"** → **"Connect"** → copie connection string
2. Conecte com MySQL Workbench/DBeaver/TablePlus usando:
   - Host: `RAILWAY_TCP_PROXY_DOMAIN`
   - Port: `RAILWAY_TCP_PROXY_PORT`
   - User: `MYSQLUSER`
   - Password: `MYSQLPASSWORD`
   - Database: `MYSQLDATABASE`

### Passo 2: Processar o dump

Antes de importar, remova manualmente ou via find/replace:
- `CREATE DATABASE ...`
- `USE u485294289_senior_floors_;`

### Passo 3: Importar

1. Abra o arquivo `u485294289_senior_floors_.sql`
2. Remova as linhas mencionadas acima
3. Execute o SQL (F9 no Workbench, ou botão "Execute")

---

## Verificar Importação

Após importar, teste:

```bash
# Via API
curl https://sua-url-railway.up.railway.app/api/db-check

# Via MySQL CLI
mysql -h HOST -P PORT -u USER -pPASSWORD DATABASE -e "SHOW TABLES;"
```

Deve mostrar todas as tabelas do dump original.

---

## Troubleshooting

### Erro: "Unknown database"
- Certifique-se de que o banco `MYSQLDATABASE` existe no Railway
- O Railway cria automaticamente quando você cria o serviço MySQL

### Erro: "Table already exists"
- Isso é normal se você já executou antes
- O script ignora esses erros automaticamente
- Se quiser recriar tudo, delete as tabelas primeiro

### Erro: "Access denied"
- Verifique se o TCP Proxy está habilitado no Railway MySQL
- Verifique se as credenciais estão corretas

### Dump muito grande (>100MB)
- Use o Método 2 (MySQL CLI) que é mais eficiente
- Ou divida o dump em partes menores

---

## Tabelas Esperadas

O dump deve criar tabelas como:
- `activities`
- `leads`
- `users`
- `customers`
- `projects`
- `pipeline_stages`
- E outras do seu CRM
