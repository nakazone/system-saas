# 🔧 Corrigir Envio de Leads - Checklist

## Problema
Formulário da LP não está salvando leads nem enviando email.

## Solução

### ✅ Passo 1: Configurar SYSTEM_API_URL na Vercel

1. Acesse **Vercel Dashboard** → seu projeto → **Settings** → **Environment Variables**
2. Adicione a variável:

```
SYSTEM_API_URL=https://sua-url-railway.up.railway.app
```

**Onde encontrar a URL do Railway:**
- Railway → serviço Node.js → **Settings** → **Generate Domain**
- Ou copie a URL pública do seu serviço (ex: `https://senior-floors-system-production.up.railway.app`)

**⚠️ IMPORTANTE:** 
- Sem essa variável, os leads **NÃO serão salvos no banco**
- A URL deve ser **sem barra no final** (ex: `https://...railway.app` não `https://...railway.app/`)

---

### ✅ Passo 2: Configurar Email (Opcional mas Recomendado)

Para receber emails quando um lead é enviado:

1. No **Vercel** → **Environment Variables**, adicione:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-app-password-aqui
SMTP_FROM_EMAIL=seu-email@gmail.com
SMTP_FROM_NAME=Senior Floors Website
SMTP_TO_EMAIL=leads@senior-floors.com
```

**Como gerar App Password do Gmail:**
1. Acesse: https://myaccount.google.com/apppasswords
2. Selecione "Mail" → "Other (Custom name)" → digite "Senior Floors"
3. Clique em "Generate"
4. Copie a senha de 16 caracteres
5. Use como `SMTP_PASS` (não use a senha normal da conta!)

---

### ✅ Passo 3: Verificar se Railway está Rodando

Teste se o Railway está acessível:

```bash
curl https://sua-url-railway.up.railway.app/api/health
```

Deve retornar: `{"ok":true,"service":"senior-floors-system",...}`

---

### ✅ Passo 4: Testar o Fluxo Completo

1. **Aguardar deploy na Vercel** (2-3 minutos após adicionar variáveis)

2. **Enviar formulário de teste** na LP:
   - Preencha todos os campos
   - Envie o formulário
   - Deve aparecer mensagem de sucesso

3. **Verificar nos Logs da Vercel:**
   - Vercel → **Deployments** → deploy mais recente → **Functions** → `/api/send-lead` → **View Logs**
   - Procure por:
     - `Sending to System API (Railway): https://...`
     - `✅ Lead saved via System API (Railway) | ID: X`
     - `Email sent successfully` (se configurado)

4. **Verificar no Railway System:**
   - Acesse o dashboard do Railway System
   - Vá em **Leads**
   - Deve aparecer o lead recém-enviado

5. **Verificar Email:**
   - Se configurou SMTP, verifique a caixa de entrada de `SMTP_TO_EMAIL`

---

## Troubleshooting

### Lead não aparece no Railway

**Verifique:**
1. `SYSTEM_API_URL` está configurada? (sem barra no final)
2. Railway está rodando? (`/api/health` responde?)
3. Logs da Vercel mostram erro? (veja "View Logs")

**Teste manual:**
```bash
curl -X POST https://sua-url-railway.up.railway.app/api/receive-lead \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "form-name=test&name=Test User&email=test@test.com&phone=3035551234&zipcode=80202&message=Test message"
```

Deve retornar: `{"success":true,"database_saved":true,"lead_id":X,...}`

### Email não está chegando

**Verifique:**
1. Todas as variáveis SMTP estão configuradas?
2. `SMTP_PASS` é App Password (16 caracteres), não senha normal?
3. Logs da Vercel mostram "Email sent successfully" ou "Email failed"?

**Teste manual do email:**
- Verifique se o Gmail App Password está correto
- Tente enviar um email de teste manualmente

---

## Resumo das Variáveis Necessárias

### Obrigatório:
- `SYSTEM_API_URL` - URL do Railway System

### Opcional (mas recomendado):
- `SMTP_HOST` - smtp.gmail.com
- `SMTP_PORT` - 587
- `SMTP_USER` - seu email Gmail
- `SMTP_PASS` - App Password do Gmail
- `SMTP_FROM_EMAIL` - email remetente
- `SMTP_FROM_NAME` - nome remetente
- `SMTP_TO_EMAIL` - email destinatário

---

## Após Configurar

1. Aguarde o redeploy automático na Vercel (ou force um novo deploy)
2. Teste o formulário
3. Verifique os logs se algo não funcionar

**O código já foi atualizado para:**
- ✅ Sempre enviar para Railway quando `SYSTEM_API_URL` estiver configurado
- ✅ Melhorar logs para debug
- ✅ Melhorar parsing do body
- ✅ Melhorar tratamento de erros
