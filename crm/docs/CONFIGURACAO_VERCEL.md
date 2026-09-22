# Configuração Vercel - Para Receber Leads

## Variáveis de Ambiente Necessárias

Configure estas variáveis no **Vercel Dashboard** → seu projeto → **Settings** → **Environment Variables**:

### 1. Sistema Railway (OBRIGATÓRIO)

```
SYSTEM_API_URL=https://sua-url-railway.up.railway.app
```

**Onde encontrar:** No Railway → serviço Node.js → **Settings** → **Generate Domain** (ou copie a URL pública)

**Importante:** Sem essa variável, os leads **NÃO serão salvos no banco** do Railway.

---

### 2. Email (OPCIONAL mas recomendado)

Para receber emails quando um lead é enviado:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-app-password-aqui
SMTP_FROM_EMAIL=seu-email@gmail.com
SMTP_FROM_NAME=Senior Floors Website
SMTP_TO_EMAIL=leads@senior-floors.com
```

**Como obter App Password do Gmail:**
1. Acesse https://myaccount.google.com/apppasswords
2. Selecione "Mail" e "Other (Custom name)"
3. Digite "Senior Floors Vercel"
4. Clique em "Generate"
5. Copie a senha gerada (16 caracteres) e use como `SMTP_PASS`

**Nota:** Se usar outro provedor (não Gmail), ajuste `SMTP_HOST` e `SMTP_PORT` conforme necessário.

---

## Como Verificar se Está Funcionando

### 1. Teste o Formulário

1. Acesse sua LP na Vercel
2. Preencha e envie o formulário
3. Deve aparecer mensagem de sucesso

### 2. Verifique os Logs da Vercel

No Vercel Dashboard → **Deployments** → clique no deploy mais recente → **Functions** → `/api/send-lead` → **View Logs**

Procure por:
- `Sending to System API: https://...`
- `Lead saved via System API (Railway) | ID: X`
- `Email sent successfully` (se configurado)

### 3. Verifique no Railway System

1. Acesse o dashboard do Railway System
2. Vá em **Leads**
3. Deve aparecer o lead recém-enviado

### 4. Verifique o Email

Se configurou SMTP, verifique a caixa de entrada de `SMTP_TO_EMAIL`.

---

## Troubleshooting

### Lead não aparece no Railway

1. **Verifique `SYSTEM_API_URL`:**
   - Está configurada na Vercel?
   - A URL está correta? (sem barra no final)
   - O Railway está rodando? (teste: `curl https://sua-url/api/health`)

2. **Verifique os logs da Vercel:**
   - Procure por erros de conexão
   - Veja se está tentando enviar para o Railway

3. **Teste manualmente:**
   ```bash
   curl -X POST https://sua-url-railway.up.railway.app/api/receive-lead \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "form-name=test&name=Test&email=test@test.com&phone=1234567890&zipcode=80202&message=Test"
   ```

### Email não está chegando

1. **Verifique se todas as variáveis SMTP estão configuradas:**
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS` (App Password, não a senha normal)
   - `SMTP_FROM_EMAIL`
   - `SMTP_TO_EMAIL`

2. **Verifique os logs da Vercel:**
   - Procure por "Email failed" ou "Email sent successfully"

3. **Teste com Gmail App Password:**
   - Certifique-se de usar App Password, não a senha normal
   - Verifique se 2FA está habilitado na conta Gmail

---

## Checklist de Configuração

- [ ] `SYSTEM_API_URL` configurada na Vercel com URL do Railway
- [ ] Railway System está rodando e acessível
- [ ] Teste manual do `/api/receive-lead` funciona
- [ ] (Opcional) Variáveis SMTP configuradas
- [ ] (Opcional) Gmail App Password gerado e configurado
- [ ] Teste do formulário na LP funciona
- [ ] Lead aparece no Railway System
- [ ] (Se configurado) Email chega na caixa de entrada

---

## Exemplo de Resposta do send-lead

Quando tudo está funcionando, a resposta JSON será:

```json
{
  "success": true,
  "message": "Thank you! We'll contact you within 24 hours.",
  "email_sent": true,
  "system_sent": true,
  "system_database_saved": true,
  "database_saved": true,
  "csv_saved": true,
  "lead_id": 123,
  "timestamp": "2026-02-11 10:30:00"
}
```

Se `system_database_saved` for `false`, verifique `system_error` na resposta.
