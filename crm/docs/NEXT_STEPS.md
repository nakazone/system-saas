# Próximos Passos - Acessar o Sistema

## ✅ O que já está pronto

1. ✅ Banco de dados importado (38 tabelas)
2. ✅ API funcionando
3. ✅ Autenticação implementada
4. ✅ Painel admin criado

---

## 🚀 Como Acessar o Sistema

### 1. Aguardar Deploy no Railway

O Railway vai fazer deploy automaticamente após o push. Aguarde alguns minutos.

### 2. Acessar o Painel Admin

Abra no navegador:
```
https://sua-url-railway.up.railway.app
```

Você será redirecionado para `/login.html`

### 3. Fazer Login

**Credenciais padrão do dump do Hostinger:**

- **Email:** `admin@senior-floors.com`
- **Senha:** (verifique no banco ou use uma das senhas dos outros usuários)

**Outros usuários no banco:**
- `leads@senior-floors.com` (Douglas Nakazone)
- `contact@senior-floors.com` (Victor Castro)

**Se nenhuma senha funcionar:**

Você pode criar uma nova senha para o admin:

```bash
# Via Railway CLI
railway run node -e "
import bcrypt from 'bcryptjs';
const hash = await bcrypt.hash('sua_nova_senha', 10);
console.log('Hash:', hash);
// Depois atualize no banco:
// UPDATE users SET password_hash = 'HASH_AQUI' WHERE email = 'admin@senior-floors.com';
"
```

Ou via MySQL direto:
```sql
UPDATE users 
SET password_hash = '$2a$10$...' -- gere o hash acima
WHERE email = 'admin@senior-floors.com';
```

---

## 📋 Funcionalidades Disponíveis

### ✅ Implementado

- **Login/Logout** - Autenticação funcional
- **Dashboard** - Visualização básica
- **Lista de Leads** - Ver todos os leads com paginação
- **API de Leads** - GET /api/leads, GET /api/leads/:id, PUT /api/leads/:id

### 🚧 Em Desenvolvimento

- Visualizar detalhes de um lead
- Editar lead (status, prioridade, etc.)
- Adicionar notas aos leads
- Ver atividades
- Gerenciar customers
- Configurações

---

## 🔧 Configurações Importantes

### Variável de Ambiente: SESSION_SECRET

No Railway, adicione uma variável de ambiente:

```
SESSION_SECRET=uma-string-secreta-aleatoria-aqui
```

Isso é importante para segurança das sessões. Use uma string longa e aleatória.

**Como gerar:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🐛 Troubleshooting

### Erro: "Cannot GET /login.html"

- Verifique se o deploy foi concluído
- Verifique os logs do Railway para erros

### Erro: "Authentication required"

- Faça login primeiro em `/login.html`
- Verifique se as credenciais estão corretas

### Erro: "Database not available"

- Verifique se as variáveis `DB_*` estão configuradas no Railway
- Teste com: `curl https://sua-url/api/db-check`

### Senha não funciona

- Verifique se o hash da senha está correto no banco
- Use o script acima para gerar um novo hash
- Certifique-se de que está usando `password_hash` (não `password`)

---

## 📝 Próximas Melhorias Sugeridas

1. **Visualizar Lead** - Página de detalhes do lead
2. **Editar Lead** - Formulário para atualizar status, prioridade, etc.
3. **Adicionar Notas** - Criar notas sobre leads
4. **Filtros** - Filtrar leads por status, data, etc.
5. **Busca** - Buscar leads por nome, email, telefone
6. **Exportar** - Exportar leads para CSV/Excel
7. **Dashboard Stats** - Estatísticas e gráficos
8. **Atividades** - Ver histórico de atividades dos leads

---

## 🔗 Links Úteis

- **Railway Dashboard:** https://railway.app
- **API Health Check:** `https://sua-url/api/health`
- **API DB Check:** `https://sua-url/api/db-check`

---

## 💡 Dica

Para desenvolvimento local:

```bash
cd senior-floors-system
npm install
npm start
```

Acesse: `http://localhost:3000`
