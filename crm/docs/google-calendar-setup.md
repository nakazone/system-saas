# Google Calendar — passo a passo (CRM → Google Agenda)

Sincronização **unidirecional**: ao criar ou atualizar **agendamentos de projeto** (`project_schedules`) ou **visitas de leads** (`visits`), o CRM cria ou atualiza eventos no Google Calendar. Visitas **canceladas** removem o evento.

---

## 1. Google Cloud Console

1. Aceda a [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto novo ou escolha um existente.
3. No menu **APIs e serviços** → **Biblioteca**, procure **Google Calendar API** e clique **Ativar**.

---

## 2. Credenciais OAuth 2.0 (tipo “Aplicação Web”)

1. Vá a **APIs e serviços** → **Credenciais** → **Criar credenciais** → **ID cliente OAuth**.
2. Tipo de aplicação: **Aplicação Web**.
3. **URIs de redirecionamento autorizados** — adicione **exatamente** (ajuste ao seu domínio):

   **Produção (Railway)**  
   `https://SEU-SERVICO.up.railway.app/api/integrations/google-calendar/callback`

   **Desenvolvimento local** (opcional)  
   `http://localhost:3000/api/integrations/google-calendar/callback`

4. Guarde o **ID do cliente** e o **Segredo do cliente** — vão para as variáveis `GOOGLE_CALENDAR_CLIENT_ID` e `GOOGLE_CALENDAR_CLIENT_SECRET`.

5. Se a app estiver em modo **Teste**, em **Ecrã de consentimento OAuth** adicione o seu Gmail (e o dos colegas) como **utilizadores de teste**, para poderem autorizar.

---

## 3. Base de dados MySQL

Na base usada pelo CRM, execute **uma vez** o ficheiro:

`database/add-google-calendar-event-ids.sql`

Isto cria a coluna `google_calendar_event_id` nas tabelas `project_schedules` e `visits` (para o CRM saber qual evento atualizar no Google).

Se o MySQL devolver erro de coluna duplicada, a migração já foi aplicada — pode ignorar.

---

## 4. Variáveis de ambiente (ex.: Railway)

Defina no serviço Node do CRM:

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `GOOGLE_CALENDAR_CLIENT_ID` | Sim | ID do cliente OAuth (Web). |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Sim | Segredo do cliente. |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Sim | Token obtido no passo 5 (fica estável até revogar). |
| `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI` | Recomendado | **Igual** à URI de callback registada no Google (ex.: `https://…railway.app/api/integrations/google-calendar/callback`). |
| `GOOGLE_CALENDAR_ID` | Não | ID do calendário (predefinição: `primary` = calendário principal da conta que autorizou). |
| `GOOGLE_CALENDAR_TIMEZONE` | Não | Fuso para horários das visitas (predefinição: `America/Chicago`). |
| `GOOGLE_CALENDAR_VISIT_DURATION_MINUTES` | Não | Duração do bloco da visita (predefinição: `60`). |
| `PUBLIC_CRM_URL` | Não | URL pública do CRM (sem barra final); usada nas descrições dos eventos com links para o dashboard / lead. |

**Importante:** `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI` no servidor tem de coincidir com uma das URIs autorizadas no Google Cloud.

Faça **redeploy** após alterar variáveis.

---

## 5. Obter o `GOOGLE_CALENDAR_REFRESH_TOKEN`

O Google **só devolve `refresh_token` na primeira vez** que essa combinação (app + conta + scope) recebe consentimento **com acesso offline**. Se já autorizou antes, a resposta pode trazer só `access_token` — aí **não há refresh** até revogar e repetir.

### Passo obrigatório se já tentou antes: revogar

1. Abra [Conta Google → Segurança → Acesso de terceiros](https://myaccount.google.com/permissions) (ou “Ligações com terceiros”).
2. Encontre o **nome do projeto** da Google Cloud (como aparece no ecrã de consentimento).
3. Clique **Remover acesso** / **Eliminar todas as ligações**.
4. Volte a fazer **uma** das opções A, B ou C abaixo (como se fosse a primeira vez).

---

### Opção A — Script local (`npm run google-calendar:token`)

1. Na pasta `senior-floors-system`, no `.env`:
   - `GOOGLE_CALENDAR_CLIENT_ID`
   - `GOOGLE_CALENDAR_CLIENT_SECRET`
   - `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI=http://localhost:3000/api/integrations/google-calendar/callback`
2. No Google Cloud → credenciais OAuth **Aplicação Web**, em **URIs de redirecionamento** tem de existir **exatamente** a mesma linha (incluindo `http`, porta `3000`, sem barra no fim).
3. **Arranque o CRM** noutro terminal (`npm start` ou `npm run dev`) para que, ao autorizar no browser, o Google consiga abrir essa URL e mostrar a página (ou, em alternativa, copie só o `code` da barra de endereço após o redirect).
4. Execute:

   ```bash
   npm run google-calendar:token
   ```

5. Abra o URL que o script imprimir, faça login e **Aceitar** no ecrã de consentimento.
6. Na barra de endereço aparece `...?code=...&...` — pode **colar a URL inteira** no script (ou só o valor do parâmetro `code`). O code expira em poucos minutos e **só pode ser usado uma vez**.
7. Copie `GOOGLE_CALENDAR_REFRESH_TOKEN=...` para o Railway.

**Erros frequentes**

| Erro / sintoma | Causa provável |
|----------------|----------------|
| `redirect_uri_mismatch` | URI no `.env` ≠ URI no Google Cloud (caractere a caractere). |
| `invalid_grant` | Code já usado ou expirado — gere novo URL e autorize de novo. |
| Só `access_token`, sem refresh | Não revogou a app; ou cliente OAuth não é “Aplicação Web”. |

---

### Opção B — CRM em produção (admin)

1. No Railway, defina `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI` **igual** à URI autorizada no Google, por exemplo:  
   `https://SEU-SERVICO.up.railway.app/api/integrations/google-calendar/callback`
2. Redeploy.
3. Inicie sessão como **admin**, abra:  
   `https://SEU-SERVICO.../api/integrations/google-calendar/oauth-url`  
   (no browser, com cookie de sessão).
4. Copie `authUrl` do JSON, abra num separador, autorize.
5. A página de callback mostra o refresh token (ou instruções se não vier).

---

### Opção C — OAuth 2.0 Playground (muito fiável)

Útil quando localhost ou callback do CRM dão problemas.

1. Abra [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Ícone **⚙️** (canto superior direito) → marque **“Use your own OAuth credentials”**.
3. Cole o **Client ID** e **Client Secret** do Google Cloud (tipo **Aplicação Web**).
4. No Google Cloud, nas **URIs de redirecionamento autorizados**, adicione **também**:  
   `https://developers.google.com/oauthplayground`  
   Guarde.
5. No Playground, na lista à esquerda, procure **Calendar API v3** e selecione:  
   `https://www.googleapis.com/auth/calendar.events`  
   (ou `.../auth/calendar` se preferir scope completo).
6. **Step 1** → **Authorize APIs** → escolha a conta Google → **Allow**.
7. **Step 2** → **Exchange authorization code for tokens**.
8. No painel da direita aparece **Refresh token** — copie para `GOOGLE_CALENDAR_REFRESH_TOKEN` no Railway.

---

## 6. Confirmar que está ativo

1. Abra o **dashboard** → **Smart Scheduling**: deve aparecer uma faixa a indicar que a sincronização com o Google Calendar está **ativa** (se as três variáveis principais estiverem definidas).
2. Crie ou edite uma **visita** ou um **agendamento de projeto** no CRM e verifique o **Google Calendar** da conta que autorizou (ou o calendário definido em `GOOGLE_CALENDAR_ID`).

---

## Resolução de problemas

| Problema | O que verificar |
|----------|------------------|
| `redirect_uri_mismatch` | URI no Google Cloud = `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI` no servidor. |
| **Nunca aparece `refresh_token`** | 1) Revogar app em [myaccount.google.com/permissions](https://myaccount.google.com/permissions). 2) Cliente OAuth = **Aplicação Web** (não “Computador”). 3) Tentar **Opção C — OAuth Playground** acima. |
| `invalid_grant` no script | Code expirou ou já foi usado — novo fluxo desde o URL de autorização. |
| Eventos não aparecem | Migração SQL aplicada? Logs do servidor com `[google-calendar]`? Calendar API ativada? |
| Horários das visitas errados | Ajuste `GOOGLE_CALENDAR_TIMEZONE` ao fuso onde grava `scheduled_at` na BD. |

---

## Limitações atuais

- Não há importação **Google → CRM** (só CRM → Google).
- Registos **antigos** criados antes da integração não são enviados automaticamente; seria necessário um “backfill” separado.

Para mais detalhes das variáveis, veja também `env.example` na raiz do `senior-floors-system`.
