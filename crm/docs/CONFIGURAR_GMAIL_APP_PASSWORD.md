# 📧 Como Configurar Gmail App Password para Envio de Emails

## ⚠️ Erro Comum

Se você está vendo este erro:
```
Error: Invalid login: 535-5.7.8 Username and Password not accepted
```

**Causa:** Você está usando a senha normal do Gmail ao invés de uma **App Password**.

---

## ✅ Solução: Gerar App Password do Gmail

### Passo 1: Habilitar 2FA (Autenticação de Dois Fatores)

**IMPORTANTE:** Você PRECISA ter 2FA habilitado para gerar App Passwords.

1. Acesse: https://myaccount.google.com/security
2. Procure por **"Verificação em duas etapas"** ou **"2-Step Verification"**
3. Se não estiver habilitado:
   - Clique em **"Ativar"** ou **"Get Started"**
   - Siga as instruções para configurar (pode usar SMS ou app autenticador)
4. **Confirme que está ATIVADO** antes de continuar

---

### Passo 2: Gerar App Password

1. Acesse: https://myaccount.google.com/apppasswords
   - Se não conseguir acessar diretamente, vá em: https://myaccount.google.com/security → **"Senhas de app"** ou **"App passwords"**

2. Se aparecer uma tela pedindo para confirmar sua senha, digite sua senha do Gmail

3. Na página de App Passwords:
   - **Selecione o app:** Escolha **"Mail"**
   - **Selecione o dispositivo:** Escolha **"Other (Custom name)"**
   - **Digite um nome:** Ex: `Senior Floors Vercel`
   - Clique em **"Generate"** ou **"Gerar"**

4. **Copie a senha gerada:**
   - Será uma senha de **16 caracteres** (sem espaços)
   - Exemplo: `abcd efgh ijkl mnop` → use como `abcdefghijklmnop`
   - ⚠️ **IMPORTANTE:** Essa senha só aparece UMA VEZ. Copie agora!

---

### Passo 3: Configurar na Vercel

1. Acesse **Vercel Dashboard** → seu projeto → **Settings** → **Environment Variables**

2. Configure estas variáveis:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=abcdefghijklmnop
SMTP_FROM_EMAIL=seu-email@gmail.com
SMTP_FROM_NAME=Senior Floors Website
SMTP_TO_EMAIL=destino@senior-floors.com
```

**Onde:**
- `SMTP_USER`: Seu email Gmail completo (ex: `joao@gmail.com`)
- `SMTP_PASS`: A App Password de 16 caracteres que você acabou de gerar (SEM espaços)
- `SMTP_FROM_EMAIL`: Pode ser o mesmo que `SMTP_USER`
- `SMTP_TO_EMAIL`: Email onde você quer receber os leads

3. **Salve** as variáveis

4. **Force um novo deploy** ou aguarde o redeploy automático

---

## 🔍 Verificação

### Teste 1: Verificar se App Password foi gerada corretamente

A senha deve ter **exatamente 16 caracteres** (sem espaços).

Exemplos:
- ✅ Correto: `abcdefghijklmnop`
- ❌ Errado: `abcd efgh ijkl mnop` (com espaços)
- ❌ Errado: `sua-senha-normal-do-gmail` (senha normal)

### Teste 2: Verificar nos Logs da Vercel

Após configurar e fazer um novo deploy:

1. Envie um formulário de teste na LP
2. Vercel → **Deployments** → deploy mais recente → **Functions** → `/api/send-lead` → **View Logs**
3. Procure por:
   - ✅ `Email sent successfully to destino@senior-floors.com` → **Funcionou!**
   - ❌ `Email failed: Invalid login` → App Password incorreta

---

## 🚨 Troubleshooting

### "Não consigo acessar a página de App Passwords"

**Causa:** 2FA não está habilitado.

**Solução:**
1. Vá em https://myaccount.google.com/security
2. Habilite **"Verificação em duas etapas"**
3. Depois tente acessar https://myaccount.google.com/apppasswords novamente

---

### "Ainda recebo erro de autenticação"

**Verifique:**

1. ✅ 2FA está habilitado?
2. ✅ App Password tem exatamente 16 caracteres (sem espaços)?
3. ✅ `SMTP_USER` é o email completo (ex: `joao@gmail.com`)?
4. ✅ `SMTP_PASS` é a App Password, não a senha normal?
5. ✅ Variáveis foram salvas na Vercel?
6. ✅ Novo deploy foi feito após adicionar as variáveis?

**Teste manual:**

Tente fazer login manualmente com essas credenciais em um cliente de email (Thunderbird, Outlook) para confirmar que a App Password está correta.

---

### "Quero usar outro provedor de email (não Gmail)"

Você pode usar qualquer provedor SMTP. Ajuste as variáveis:

**Outlook/Hotmail:**
```
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
```

**Yahoo:**
```
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=587
```

**SendGrid (recomendado para produção):**
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=sua-api-key-do-sendgrid
```

---

## 📝 Checklist Final

- [ ] 2FA habilitado no Gmail
- [ ] App Password gerada (16 caracteres)
- [ ] Variáveis configuradas na Vercel:
  - [ ] `SMTP_HOST=smtp.gmail.com`
  - [ ] `SMTP_PORT=587`
  - [ ] `SMTP_USER=seu-email@gmail.com`
  - [ ] `SMTP_PASS=app-password-16-chars` (sem espaços)
  - [ ] `SMTP_FROM_EMAIL=seu-email@gmail.com`
  - [ ] `SMTP_FROM_NAME=Senior Floors Website`
  - [ ] `SMTP_TO_EMAIL=destino@senior-floors.com`
- [ ] Novo deploy feito na Vercel
- [ ] Teste do formulário enviado
- [ ] Logs verificados (deve aparecer "Email sent successfully")

---

## 💡 Dica

Se você não quiser usar Gmail, considere usar **SendGrid** ou **Mailgun** para produção - são mais confiáveis e têm limites maiores de envio.
