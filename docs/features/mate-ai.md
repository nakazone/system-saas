# Mate AI: the assistant on every screen

Mate AI turns what people say or type into actions inside the active company. It lives in a panel available on every office screen (floating button, the **Mate AI** button in the top bar, or Ctrl/⌘ + J) and on the full page `/mate-ai`. Nothing changes until the user confirms a card, and nothing reaches a customer without a second, explicit check.

## Actions (phase 1)

| Area | Action | Example | Confirm |
| --- | --- | --- | --- |
| Quotes | `quote.create` | "Quote pro John, 1350 pés de madeira" | Draft quote card (lines editable) |
| | `quote.edit` | "Adiciona 14 degraus no quote do John e dá 10% de desconto" | Opens the Quote Builder with the change applied; user saves |
| | `quote.send` | "Manda o quote do John por e-mail / SMS / link" | Send card with recipient check |
| Invoices | `invoice.job` | "Invoice do job 1042 para sexta" | Money card |
| | `invoice.quote` | "Fatura o depósito de 50% do quote do John" | Money card |
| | `invoice.send` | "Manda a invoice 3012 por e-mail" | Send card with recipient check |
| Payments | `payment.record` | "O John pagou 2 mil em cheque hoje" | Money card (balance before/after) |
| Leads | `lead.create`, `lead.stage` | "Novo lead: Ana, 720 555 0101…", "Move a Ana para visita, quinta 10h" | Card; stage + visit |
| Customers | `customer.create` | "Cadastra o cliente Roberto Alves, builder" | Card (duplicate warning) |
| Jobs | `job.create`, `job.schedule`, `job.status`, `job.note` | "Agenda o job 1042 segunda 7h com a equipe do Carlos" | Card; undo 30 s for schedule/status/note |
| Answers | `agenda.list`, `money.summary`, `customer.balance`, `jobs.uninvoiced`, `quotes.followup`, `invoices.overdue` | "O que tem amanhã?", "Quanto faturei este mês?" | Read-only answer; rows carry a follow-up action |

Proactive suggestions (`GET /api/mate-ai/suggestions`): completed jobs without invoice, overdue invoices, quotes opened by the customer without an answer, approved quotes without a job.

## How it works

- `POST /api/mate-ai/act` with `text`: the model (`MATE_AI_MODEL`, default `gpt-6-luna`) receives only the actions this user may use, the screen the user is on, the last turns of the conversation and the service catalog as refs; it returns one action and its arguments. Without AI, a local reader handles quotes, job invoices and the questions above.
- The action's `prepare` resolves records against the tenant (typo-tolerant), prices from the company tables, and returns a **card** (with a signed 10-minute token), a **question** with tappable options, an **answer**, or an error. Choices and card edits call `/act` again with `action + args + patch` — no new AI call.
- `POST /api/mate-ai/execute` runs a confirmed card once (replay-protected), **through the same HTTP routes the screens use, as the same user** (`src/lib/mate-ai/internal-api.ts`), so permissions, validation, numbering, notifications and activity are identical to a click. The change is logged as `mate_ai.action` on the record.
- `POST /api/mate-ai/undo` reverts reversible actions within 30 s (schedule, status, note, lead stage).
- Actions live in `src/lib/mate-ai/actions/*` (registry in `src/lib/mate-ai/agent.ts`, routes in `src/crm/routes/mate-ai-agent.ts`). A new action is one `ActionDef` with `prepare`, `execute` and optional `undo`.

## Panel

`crm/public/mate-panel.js` + `.css`, loaded by `crm-shell.js` on office screens (not the field crew app). Desktop: side panel that keeps the page usable. Phone: bottom sheet. The record in the URL (job, quote, invoice, lead, customer) becomes the context chip with quick actions. Voice: tap the mic, or press and hold the floating button. The conversation is kept per tab for the day.

## Data and logging

All reads and writes run through the tenant transaction helper. The raw command and audio are not stored. Created quotes and invoices carry `source: mate_ai`; every executed action adds a `mate_ai.action` activity event on its record.

## Configuration

Only `OPENAI_API_KEY` is required (or `JOB_MEDIA_AI_API_KEY`, which takes precedence). Without it Mate AI runs in basic mode (local reader + browser speech recognition).

| Variable | Default | Used for |
| --- | --- | --- |
| `MATE_AI_MODEL` | `gpt-6-luna` | Reading commands. Falls back to the account default chat model if unavailable. |
| `MATE_AI_TRANSCRIBE_MODEL` | `gpt-transcribe` | Voice. Sends the catalog and recent customer names as `keywords[]` and `languages[]` (pt, en). Retries once with `whisper-1` if the model is rejected. |

GPT-5/GPT-6 models get no custom `temperature`. The company plan must include the **IA** feature and have `ai_month` quota left; each command and each recording counts as one use.

Note: `gpt-4o`, `gpt-4o-mini` and `gpt-4.1` leave the OpenAI API on 2027-01-14; `whisper-1` and the `gpt-4o-*-transcribe` models on 2027-02-26. Other AI features still default to `gpt-4o-mini` / `whisper-1` through `OPENAI_CHAT_MODEL` / `JOB_MEDIA_WHISPER_MODEL`.

## Conversa reativa (out/2026)

- **Item pendente**: o painel envia em `pending` o último card / pergunta / erro ainda aberto (`action`, `args`, `status`, `summary`). Uma resposta solta ("é 1 dólar por sq ft", "muda pra 1500") completa esse item — o modelo devolve a MESMA ação com os args completos.
- **Alterar quote em aberto**: mudar preço ou quantidade num card de `quote.create` atualiza a proposta ainda não confirmada, preservando a seleção do catálogo e recalculando o total. Só uma quote já confirmada usa `quote.edit`; o painel confirma a mudança com uma mensagem curta e o card atualizado.
- **Consultas antes de responder**: o modelo pode chamar ferramentas somente-leitura (`find_customers`, `find_leads`, `find_jobs`, `find_quotes`, `find_invoices`, `find_prices`) por até 4 rodadas e termina com `propose_action` ou `reply`. Se o provedor recusar tools, cai para JSON mode, depois para o modelo padrão, e só então para a leitura local.
- **Preço que falta**: linha de Quote sem preço na Tabela vira pergunta (`items.N.unit_price`). O preço informado vale só para aquele Quote (`priceOverride`) e, depois de criado, o Mate oferece **Salvar preço na Tabela** (`pricing.set`, permissão `builders.edit`; coluna pelo tipo do cliente).
- **Diagnóstico**: `GET /api/mate-ai/diagnostics?probe=1` (admin) mostra provedor, modelo, último erro e testa JSON mode e tools mode. Quando a IA falha, administradores veem o motivo no painel em vez de uma resposta genérica.

## Criar e enviar, preço por cliente (out/2026)

- `quote.create` aceita `send` (`email` | `sms` | `link`) e `send_to`: um único "Criar e enviar" cria o Quote e envia pelo mesmo caminho do `quote.send`. Se o envio falhar, o Quote fica criado e o erro aparece, com "Tentar enviar de novo".
- Card não confirmado entra no histórico como "Proposed, NOT confirmed" com seus args, e o item pendente avisa que ele ainda não existe. Assim "envia esse quote" cria e envia em vez de procurar Quotes antigos.
- `quote.edit` pergunta o preço de uma linha sem preço (`items.N.unit_price`) em vez de mandar para o editor.
- `pricing.set` com `column: "customer"` grava um preço especial só daquele cliente (`pricing_mode: custom` + `custom_pricing_rates`, via `PUT /api/customers/:id`, permissão `customers.edit`). Depois de um preço informado no Quote, o Mate oferece "Salvar preço" já nessa opção; o card permite trocar para a Tabela (Particular / Builder / Loja).
- `quote.send` recusa Quote vazio ($0).
