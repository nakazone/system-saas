# 🔍 Diagnóstico: Leads Não Estão Chegando no Railway

## ⚠️ Problema Crítico

Os leads não estão sendo salvos no Railway System. Vamos diagnosticar passo a passo.

---

## ✅ Checklist de Diagnóstico

### 1. Verificar se SYSTEM_API_URL está Configurada

**Na Vercel:**
1. Vercel Dashboard → seu projeto → **Settings** → **Environment Variables**
2. Procure por `SYSTEM_API_URL`
3. **Deve estar configurada** com a URL do Railway

**Se NÃO estiver configurada:**
- Adicione: `SYSTEM_API_URL=https://sua-url-railway.up.railway.app`
- Substitua pela URL real do seu Railway System
- **Sem barra no final** (ex: `https://...railway.app` não `https://...railway.app/`)

---

### 2. Verificar se Railway está Rodando

**Teste manual:**

```bash
curl https://sua-url-railway.up.railway.app/api/health
```

**Deve retornar:**
```json
{"ok":true,"service":"senior-floors-system",...}
```

**Se retornar erro:**
- Railway pode estar offline
- URL pode estar incorreta
- Verifique no Railway Dashboard se o serviço está rodando

---

### 3. Verificar Logs da Vercel

**Vercel Dashboard** → **Deployments** → deploy mais recente → **Functions** → `/api/send-lead` → **View Logs**

**Procure por:**

#### ✅ Se está funcionando:
- `Sending to System API (Railway): https://...`
- `✅ Lead saved via System API (Railway) | ID: X`

#### ❌ Se NÃO está funcionando:
- `⚠️ SYSTEM_API_URL not configured` → Variável não configurada
- `❌ System API error: HTTP 404` → URL incorreta ou Railway offline
- `❌ System API exception: ...` → Erro de conexão

---

### 4. Teste Manual do Railway

**Teste se o Railway está recebendo leads:**

```bash
curl -X POST https://sua-url-railway.up.railway.app/api/receive-lead \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "form-name=test&name=Test User&email=test@test.com&phone=3035551234&zipcode=80202&message=Test message"
```

**Deve retornar:**
```json
{
  "success": true,
  "database_saved": true,
  "lead_id": 123,
  ...
}
```

**Se retornar erro:**
- Verifique se o Railway está rodando
- Verifique se o banco de dados está configurado
- Veja os logs do Railway para mais detalhes

---

## 🔧 Soluções Comuns

### Problema 1: SYSTEM_API_URL não configurada

**Sintoma nos logs:**
```
⚠️ SYSTEM_API_URL not configured - lead NOT sent to Railway System
```

**Solução:**
1. Vercel → Settings → Environment Variables
2. Adicione: `SYSTEM_API_URL=https://sua-url-railway.up.railway.app`
3. Force um novo deploy (ou aguarde redeploy automático)

---

### Problema 2: URL incorreta

**Sintoma nos logs:**
```
❌ System API error: HTTP 404
```

**Solução:**
1. Verifique a URL no Railway Dashboard
2. Railway → serviço Node.js → **Settings** → **Generate Domain**
3. Copie a URL exata (sem barra no final)
4. Atualize `SYSTEM_API_URL` na Vercel
5. Force novo deploy

---

### Problema 3: Railway offline

**Sintoma nos logs:**
```
❌ System API exception: getaddrinfo ENOTFOUND ...
```

**Solução:**
1. Verifique no Railway Dashboard se o serviço está rodando
2. Veja os logs do Railway para erros
3. Se necessário, reinicie o serviço no Railway

---

### Problema 4: Banco de dados não configurado no Railway

**Sintoma nos logs:**
```
⚠️ System API responded but didn't save: Database not configured
```

**Solução:**
1. Railway → serviço Node.js → **Variables**
2. Verifique se as variáveis do MySQL estão configuradas:
   - `DB_HOST`
   - `DB_NAME`
   - `DB_USER`
   - `DB_PASS`
3. Se não estiverem, configure-as
4. Reinicie o serviço no Railway

---

## 📊 Verificar se Está Funcionando

### Passo 1: Enviar Formulário de Teste

1. Acesse sua LP na Vercel
2. Preencha e envie o formulário
3. Deve aparecer mensagem de sucesso

### Passo 2: Verificar Logs da Vercel

**Vercel** → **Deployments** → deploy mais recente → **Functions** → `/api/send-lead` → **View Logs**

**Procure por:**
- `Sending to System API (Railway): https://...` → Está tentando enviar ✅
- `✅ Lead saved via System API (Railway) | ID: X` → **FUNCIONOU!** ✅✅✅

### Passo 3: Verificar no Railway System

1. Acesse o dashboard do Railway System
2. Faça login
3. Vá em **Leads**
4. Verifique se o lead aparece na lista

**Se aparecer:** ✅ **Está funcionando!**

**Se não aparecer:** Continue diagnosticando...

---

## 🚨 Se Ainda Não Funcionar

### Coletar Informações para Debug

1. **Logs da Vercel:**
   - Copie todas as linhas relacionadas a "System API" ou "Railway"
   - Procure por erros

2. **Teste manual do Railway:**
   - Execute o curl acima
   - Copie a resposta completa

3. **Verificar Railway:**
   - Railway Dashboard → serviço → **Logs**
   - Veja se há erros relacionados a `/api/receive-lead`

4. **Verificar variáveis:**
   - Vercel: `SYSTEM_API_URL` está configurada?
   - Railway: Variáveis do MySQL estão configuradas?

---

## 💡 Próximos Passos

1. ✅ Verifique `SYSTEM_API_URL` na Vercel
2. ✅ Teste se Railway está acessível (`/api/health`)
3. ✅ Envie um formulário de teste
4. ✅ Verifique os logs da Vercel
5. ✅ Verifique se o lead aparece no Railway System

**Me envie:**
- O que aparece nos logs da Vercel (especialmente linhas com "System API" ou "Railway")
- O resultado do teste manual do Railway (`curl`)
- Se `SYSTEM_API_URL` está configurada na Vercel

Com essas informações, posso ajudar a identificar exatamente o problema!
