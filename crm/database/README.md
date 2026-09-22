# Database Schema

## Schemas Disponíveis

### 1. `schema.sql` - Schema Básico (Mínimo)
Apenas as tabelas essenciais:
- `leads` - Tabela de leads
- `users` - Tabela de usuários básica

**Use quando:** Você só precisa do básico para receber leads da LP.

### 2. `schema-completo.sql` - Schema Completo do CRM ⭐
Todas as tabelas do sistema CRM completo:
- `users` - Usuários com roles (admin, sales_rep, project_manager)
- `pipeline_stages` - Estágios do pipeline de vendas
- `leads` - Leads completos com campos adicionais
- `lead_notes` - Notas sobre leads
- `lead_activities` - Histórico de atividades/interações
- `tasks` - Tarefas/TODOs
- `settings` - Configurações do sistema

**Dados iniciais incluídos:**
- 6 estágios padrão do pipeline (Novo Lead, Qualificação, Proposta, etc.)
- 1 usuário admin padrão (email: `admin@senior-floors.com`, senha: `admin123`)
- Configurações padrão do sistema

**Use quando:** Você quer o CRM completo com todas as funcionalidades.

---

## Como Executar

### Opção 1: Via Script Node.js (Recomendado)

```bash
cd /Users/naka/senior-floors-landing/senior-floors-system

# Schema básico
railway run node database/run-schema.js

# Schema completo (edite run-schema.js para usar schema-completo.sql)
# Ou execute diretamente:
railway run node -e "
import mysql from 'mysql2/promise';
import fs from 'fs';
const config = {
  host: process.env.RAILWAY_TCP_PROXY_DOMAIN || process.env.MYSQLHOST || process.env.DB_HOST,
  port: parseInt(process.env.RAILWAY_TCP_PROXY_PORT || process.env.MYSQLPORT || '3306'),
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASS,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  multipleStatements: true
};
const sql = fs.readFileSync('database/schema-completo.sql', 'utf8');
const conn = await mysql.createConnection(config);
await conn.query(sql);
console.log('✅ Schema completo executado!');
await conn.end();
"
```

### Opção 2: Via MySQL CLI

```bash
# Schema básico
mysql -h HOST -P PORT -u USER -pPASSWORD DATABASE < database/schema.sql

# Schema completo
mysql -h HOST -P PORT -u USER -pPASSWORD DATABASE < database/schema-completo.sql
```

### Opção 3: Via Ferramenta GUI

1. Railway MySQL → **"Data"** → **"Connect"** → copie connection string
2. Conecte com MySQL Workbench/DBeaver/TablePlus
3. Execute o conteúdo de `schema-completo.sql`

### Tabela `interactions` (interações por lead)

Se as interações não estiverem sendo salvas (aba Interações no detalhe do lead), garanta que a tabela existe e aceita todos os tipos:

```bash
node database/run-ensure-interactions.js
```

Ou execute o SQL: `database/ensure-interactions-table.sql`. O script também converte a coluna `type` de ENUM para VARCHAR quando necessário (para aceitar "meeting").

---

## Estrutura das Tabelas

### `users`
- **id** - Primary key
- **name** - Nome do usuário
- **email** - Email (único)
- **password** - Hash bcrypt
- **role** - admin, sales_rep, project_manager, user
- **is_active** - 1=ativo, 0=inativo
- **phone** - Telefone
- **avatar** - URL da foto
- **last_login_at** - Último login

### `pipeline_stages`
- **id** - Primary key
- **name** - Nome do estágio
- **description** - Descrição
- **order** - Ordem de exibição
- **color** - Cor (hex)
- **is_active** - Ativo/inativo

### `leads` (completo)
- **id** - Primary key
- **name, email, phone, zipcode** - Dados básicos
- **message** - Mensagem do formulário
- **source** - Origem (LP-Hero, LP-Contact, etc.)
- **status** - new, contacted, qualified, converted, lost
- **priority** - low, medium, high
- **owner_id** - FK para users
- **pipeline_stage_id** - FK para pipeline_stages
- **estimated_value** - Valor estimado do projeto
- **estimated_date** - Data estimada
- **notes** - Notas gerais
- **converted_at** - Data de conversão
- **lost_reason** - Motivo da perda

### `lead_notes`
- **id** - Primary key
- **lead_id** - FK para leads
- **user_id** - FK para users (quem criou)
- **note** - Texto da nota
- **is_private** - Nota privada ou pública

### `lead_activities`
- **id** - Primary key
- **lead_id** - FK para leads
- **user_id** - FK para users
- **activity_type** - call, email, meeting, note, status_change
- **title** - Título da atividade
- **description** - Descrição
- **activity_date** - Data/hora da atividade
- **duration_minutes** - Duração (para calls/meetings)

### `tasks`
- **id** - Primary key
- **lead_id** - FK para leads (opcional)
- **user_id** - FK para users (responsável)
- **title** - Título da tarefa
- **description** - Descrição
- **due_date** - Data de vencimento
- **completed_at** - Data de conclusão
- **priority** - low, medium, high
- **status** - pending, in_progress, completed, cancelled

### `settings`
- **id** - Primary key
- **key** - Chave da configuração (única)
- **value** - Valor (texto ou JSON)
- **type** - string, number, boolean, json
- **description** - Descrição

---

## Após Executar o Schema Completo

1. **Teste a conexão:**
   ```bash
   curl https://sua-url-railway.up.railway.app/api/db-check
   ```
   Deve retornar: `"table_leads_exists": true`

2. **Login inicial:**
   - Email: `admin@senior-floors.com`
   - Senha: `admin123`
   - ⚠️ **ALTERE A SENHA IMEDIATAMENTE APÓS O PRIMEIRO LOGIN!**

3. **Verificar dados iniciais:**
   - 6 estágios do pipeline criados
   - 1 usuário admin criado
   - Configurações padrão inseridas

---

## Migração do Schema Básico para Completo

Se você já executou `schema.sql` e quer migrar para o completo:

1. Execute `schema-completo.sql` - ele usa `CREATE TABLE IF NOT EXISTS`, então não vai duplicar tabelas existentes
2. Os dados existentes em `leads` e `users` serão preservados
3. Novas tabelas (`pipeline_stages`, `lead_notes`, etc.) serão criadas
4. Dados iniciais (estágios, admin, settings) serão inseridos apenas se não existirem (`INSERT IGNORE`)
