# Como Habilitar TCP Proxy no Railway MySQL

Para conectar ao MySQL do Railway de fora (localmente), você precisa habilitar o **TCP Proxy**.

## Passo a Passo

### 1. No Railway Dashboard

1. Vá no serviço **MySQL** (não no Node.js)
2. Clique em **"Settings"** (ou **"Networking"**)
3. Role até **"TCP Proxy"** ou **"Public Networking"**
4. Clique em **"Enable TCP Proxy"** ou **"Generate Domain"**

### 2. Copiar as Variáveis

Após habilitar, o Railway vai criar:
- `RAILWAY_TCP_PROXY_DOMAIN` - hostname público (ex: `monorail.proxy.rlwy.net`)
- `RAILWAY_TCP_PROXY_PORT` - porta pública (ex: `12345`)

**Onde encontrar:**
- No serviço MySQL → aba **"Variables"**
- Ou no serviço MySQL → **"Settings"** → **"TCP Proxy"** → copie o hostname e porta

### 3. Executar o Schema

Agora você pode executar:

```bash
cd /Users/naka/senior-floors-landing/senior-floors-system

# Opção A: Usar variáveis do Railway CLI
railway run node database/run-schema.js

# Opção B: Definir variáveis manualmente
RAILWAY_TCP_PROXY_DOMAIN=monorail.proxy.rlwy.net \
RAILWAY_TCP_PROXY_PORT=12345 \
MYSQLUSER=root \
MYSQLPASSWORD=sua_senha \
MYSQLDATABASE=railway \
node database/run-schema.js
```

---

## Alternativa: Usar MySQL CLI Direto

Se preferir usar MySQL CLI:

```bash
mysql -h RAILWAY_TCP_PROXY_DOMAIN -P RAILWAY_TCP_PROXY_PORT -u MYSQLUSER -pMYSQLPASSWORD MYSQLDATABASE < database/schema.sql
```

**Exemplo:**
```bash
mysql -h monorail.proxy.rlwy.net -P 12345 -u root -pSuaSenha railway < database/schema.sql
```

---

## Nota Importante

⚠️ **Custos:** Conexões externas ao MySQL podem gerar custos de egress no Railway. Para produção, prefira executar o schema dentro do Railway (via deploy ou one-off container).

---

## Método Alternativo: Executar Dentro do Railway

Se não quiser habilitar TCP Proxy, você pode executar o schema **dentro** do Railway:

1. Crie um serviço temporário ou use o serviço Node.js existente
2. Adicione um script no `package.json`:
   ```json
   "scripts": {
     "schema": "node database/run-schema.js"
   }
   ```
3. Execute via Railway dashboard → **"Deployments"** → **"Run Command"** → `npm run schema`

Ou use Railway CLI com o contexto correto:
```bash
railway run --service mysql npm run schema
```
