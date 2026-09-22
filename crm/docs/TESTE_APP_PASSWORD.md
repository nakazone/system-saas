# 🔧 Teste Rápido: App Password do Gmail

## ⚠️ Você ainda está recebendo erro de autenticação?

Vamos verificar passo a passo:

---

## ✅ Checklist de Verificação

### 1. Você habilitou 2FA (Autenticação de Dois Fatores)?

**Teste rápido:**
- Acesse: https://myaccount.google.com/security
- Procure por **"Verificação em duas etapas"** ou **"2-Step Verification"**
- Deve estar **ATIVADO** (verde/ligado)

**Se NÃO estiver ativado:**
1. Clique em "Ativar" ou "Get Started"
2. Configure usando SMS ou app autenticador
3. **AGUARDE** até estar completamente configurado
4. Só depois vá para o passo 2

---

### 2. Você consegue acessar a página de App Passwords?

**Teste:**
- Acesse: https://myaccount.google.com/apppasswords
- Se aparecer uma mensagem dizendo que precisa habilitar 2FA primeiro, volte ao passo 1
- Se conseguir ver a página de gerar senhas, continue

---

### 3. Você gerou uma App Password específica?

**Como gerar:**
1. Na página https://myaccount.google.com/apppasswords
2. Clique em **"Select app"** → escolha **"Mail"**
3. Clique em **"Select device"** → escolha **"Other (Custom name)"**
4. Digite: `Senior Floors Vercel`
5. Clique em **"Generate"**
6. **COPIE a senha de 16 caracteres** (aparece na tela)

**Formato da senha:**
- ✅ Correto: `abcdefghijklmnop` (16 letras, sem espaços)
- ❌ Errado: `abcd efgh ijkl mnop` (com espaços)
- ❌ Errado: `sua-senha-normal` (senha normal do Gmail)

---

### 4. Você configurou na Vercel corretamente?

**Vercel Dashboard** → seu projeto → **Settings** → **Environment Variables**

Verifique se está assim:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=abcdefghijklmnop
SMTP_FROM_EMAIL=seu-email@gmail.com
SMTP_FROM_NAME=Senior Floors Website
SMTP_TO_EMAIL=destino@senior-floors.com
```

**⚠️ IMPORTANTE:**
- `SMTP_USER` deve ser seu email Gmail completo (ex: `joao@gmail.com`)
- `SMTP_PASS` deve ser a App Password de 16 caracteres (SEM espaços)
- `SMTP_FROM_EMAIL` pode ser o mesmo que `SMTP_USER`

---

### 5. Você fez um novo deploy após configurar?

**Após adicionar/alterar variáveis:**
1. Vercel → **Deployments**
2. Clique nos **3 pontinhos** do deploy mais recente
3. Clique em **"Redeploy"**
4. Aguarde o deploy terminar (2-3 minutos)

**OU** simplesmente faça um commit vazio para forçar novo deploy:
```bash
git commit --allow-empty -m "Trigger redeploy for SMTP config"
git push lp main
```

---

## 🧪 Teste Manual da App Password

Para confirmar que a App Password está correta, teste manualmente:

### Opção 1: Usar Thunderbird (ou outro cliente de email)

1. Baixe o Thunderbird: https://www.thunderbird.net/
2. Configure uma conta de email:
   - Email: seu-email@gmail.com
   - Senha: a App Password de 16 caracteres (sem espaços)
   - Servidor SMTP: smtp.gmail.com
   - Porta: 587
   - Segurança: STARTTLS
3. Se conseguir enviar um email de teste, a App Password está correta ✅
4. Se não conseguir, a App Password está incorreta ❌

### Opção 2: Teste via Node.js local

Crie um arquivo `test-email.js`:

```javascript
import nodemailer from 'nodemailer';

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'seu-email@gmail.com', // Substitua
    pass: 'abcdefghijklmnop' // Substitua pela App Password
  }
});

transport.verify((error, success) => {
  if (error) {
    console.log('❌ Erro:', error.message);
  } else {
    console.log('✅ Conexão OK! App Password está correta.');
  }
});
```

Execute:
```bash
node test-email.js
```

---

## 🚨 Problemas Comuns

### "Não consigo acessar apppasswords.google.com"

**Causa:** 2FA não está habilitado.

**Solução:** Volte ao passo 1 e habilite 2FA primeiro.

---

### "A senha gerada tem espaços"

**Exemplo:** `abcd efgh ijkl mnop`

**Solução:** Remova os espaços ao copiar: `abcdefghijklmnop`

---

### "Usei a senha normal do Gmail"

**Erro:** Você não pode usar a senha normal do Gmail.

**Solução:** Você DEVE gerar uma App Password específica. Volte ao passo 3.

---

### "Já configurei mas ainda dá erro"

**Verifique:**
1. ✅ 2FA está habilitado?
2. ✅ App Password tem exatamente 16 caracteres (sem espaços)?
3. ✅ `SMTP_USER` é o email completo (ex: `joao@gmail.com`)?
4. ✅ `SMTP_PASS` é a App Password, não a senha normal?
5. ✅ Variáveis foram salvas na Vercel?
6. ✅ Novo deploy foi feito após configurar?

**Teste manual:** Use o teste via Node.js acima para confirmar que a App Password funciona.

---

## 💡 Alternativa Temporária: Desabilitar Email

Se você não conseguir configurar o Gmail agora, pode temporariamente desabilitar o envio de email:

**Na Vercel, remova ou deixe vazias as variáveis:**
- `SMTP_PASS` (deixe vazio ou remova)

O sistema continuará funcionando e salvando leads no Railway, apenas não enviará emails.

Depois você pode configurar o email quando tiver tempo.

---

## 📞 Precisa de Ajuda?

Se após seguir todos os passos ainda não funcionar:

1. Confirme que conseguiu gerar a App Password (passo 3)
2. Confirme que copiou exatamente 16 caracteres sem espaços
3. Teste manualmente com o código Node.js acima
4. Se o teste manual funcionar mas a Vercel não, pode ser cache - force um novo deploy
