# 📧 Solução para Problema de Email

## ⚠️ Situação Atual

Você está recebendo erro de autenticação do Gmail, mas **o mais importante é que os leads estão sendo salvos no Railway**.

**Boa notícia:** O código já foi atualizado para **NÃO bloquear** o fluxo se o email falhar. Os leads continuam sendo salvos normalmente.

---

## ✅ Verificar se Leads Estão Sendo Salvos

### 1. Verifique nos Logs da Vercel

Vercel → **Deployments** → deploy mais recente → **Functions** → `/api/send-lead` → **View Logs**

Procure por:
- ✅ `✅ Lead saved via System API (Railway) | ID: X` → **Leads estão sendo salvos!**
- ⚠️ `⚠️ Email failed (non-blocking)` → Email falhou, mas não bloqueou

### 2. Verifique no Railway System

1. Acesse o dashboard do Railway System
2. Vá em **Leads**
3. Verifique se os leads aparecem lá

**Se os leads estão aparecendo no Railway, está tudo funcionando!** O email é apenas um extra.

---

## 🔧 Opções para Resolver o Email

### Opção 1: Desabilitar Email Temporariamente (Recomendado)

Se você não precisa de email agora, simplesmente **remova ou deixe vazias** as variáveis SMTP na Vercel:

**Vercel Dashboard** → **Settings** → **Environment Variables**

Remova ou deixe vazias:
- `SMTP_PASS` (deixe vazio)
- Ou remova todas as variáveis `SMTP_*`

**Resultado:** O sistema continuará salvando leads normalmente, apenas não enviará emails.

---

### Opção 2: Usar SendGrid (Recomendado para Produção)

SendGrid é mais confiável que Gmail para envio de emails em produção:

1. **Criar conta:** https://sendgrid.com (plano gratuito: 100 emails/dia)

2. **Gerar API Key:**
   - SendGrid Dashboard → **Settings** → **API Keys**
   - Clique em **"Create API Key"**
   - Nome: `Senior Floors Vercel`
   - Permissões: **"Full Access"** ou **"Mail Send"**
   - Copie a API Key gerada

3. **Configurar na Vercel:**

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=sua-api-key-do-sendgrid-aqui
SMTP_FROM_EMAIL=seu-email@senior-floors.com
SMTP_FROM_NAME=Senior Floors Website
SMTP_TO_EMAIL=leads@senior-floors.com
```

**Vantagens:**
- ✅ Mais confiável que Gmail
- ✅ Não precisa de App Password
- ✅ Melhor para produção
- ✅ 100 emails/dia grátis

---

### Opção 3: Tentar Gmail Novamente (Se Quiser)

Se ainda quiser usar Gmail, verifique:

1. **2FA está habilitado?**
   - https://myaccount.google.com/security
   - Deve estar **ATIVADO**

2. **App Password foi gerada?**
   - https://myaccount.google.com/apppasswords
   - Deve ter **16 caracteres** (sem espaços)

3. **Variáveis na Vercel estão corretas?**
   - `SMTP_USER`: email completo (ex: `joao@gmail.com`)
   - `SMTP_PASS`: App Password de 16 caracteres
   - Não use a senha normal do Gmail!

4. **Teste manual:**
   - Use o código de teste em `TESTE_APP_PASSWORD.md`
   - Se funcionar localmente mas não na Vercel, pode ser cache - force um novo deploy

---

## 🎯 Recomendação

**Para agora:**
1. ✅ Verifique se os leads estão sendo salvos no Railway (isso é o mais importante!)
2. ⚠️ Se estiverem sendo salvos, pode desabilitar o email temporariamente
3. 📧 Depois configure SendGrid para produção (mais confiável)

**Para produção:**
- Use **SendGrid** ao invés de Gmail
- Mais confiável e profissional
- Não precisa lidar com App Passwords

---

## 📊 Status Atual

O código foi atualizado para:
- ✅ **NÃO bloquear** o fluxo se email falhar
- ✅ Continuar salvando leads no Railway mesmo se email falhar
- ✅ Logs mais claros sobre o que está acontecendo

**O importante:** Se você vê `✅ Lead saved via System API (Railway) | ID: X` nos logs, está tudo funcionando! O email é apenas um extra.

---

## ❓ Precisa de Ajuda?

**Se os leads NÃO estão sendo salvos no Railway:**
- Verifique se `SYSTEM_API_URL` está configurada na Vercel
- Verifique os logs da Vercel para erros de conexão
- Veja `FIX_LEAD_SUBMISSION.md` para troubleshooting

**Se os leads ESTÃO sendo salvos mas email não funciona:**
- Pode desabilitar email temporariamente (Opção 1)
- Ou configurar SendGrid (Opção 2)
- O sistema continuará funcionando normalmente
