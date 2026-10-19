# Mate AI: voice and text actions

Mate AI turns a spoken or typed request into a reviewed action inside the active company:

- **Quote**: "Criar um quote para o John Smith, instalação de 1350 pés de madeira e tirar 400 pés de carpete"
- **Job invoice**: "Emitir a invoice do job 1042 com vencimento sexta que vem", "Fatura de depósito de 30% para o trabalho da Maria"

Nothing is created until the user reviews the preview and confirms. Nothing is e-mailed to the client.

## How it works

1. **Voice** — the browser records audio (MediaRecorder) and `POST /api/mate-ai/transcribe` transcribes it on the server (Whisper-compatible API). The request is biased with the company's catalog and recent customer names so they come out spelled like in the CRM. If server transcription is unavailable, the page falls back to the browser's speech recognition.
2. **Understanding** — `POST /api/mate-ai/preview` with `command` sends the text to the LLM (`src/lib/mate-ai/interpret.ts`) together with today's date in the company timezone and the company's service catalog (as short refs `S1…Sn`). The model returns intent, customer, services (by catalog ref), quantities, units, job reference, invoice type and due date. The output is validated with zod; refs that are not in the catalog are dropped. The model never sees prices and never chooses IDs directly.
3. **Resolution** — customers and jobs are matched against the database with accent- and typo-tolerant fuzzy matching (`src/lib/mate-ai/match.ts`). When two candidates are close, the response lists them and the page shows them as tappable choices. Services fall back to lexical matching and, when still unclear, the page offers similar catalog items and the full catalog.
4. **Picks without a new AI call** — every preview returns a `plan`. The page edits it (chosen `customer_id`, `catalog_item_id`, `job_id`, invoice type, amount, due date) and calls `/api/mate-ai/preview` with `plan` instead of `command`. The server re-validates everything.
5. **Confirm** — previews return a short-lived signed token (10 minutes):
   - `POST /api/mate-ai/quote-drafts` creates a draft Quote (unchanged behaviour: catalog, customer and prices are re-checked).
   - `POST /api/mate-ai/invoices` issues the job invoice through the same `createJobInvoice` used by the Jobs screen, after re-checking the job's services total and what was already invoiced. The preview id is stored on the invoice payload to block replays.

If AI is not configured (`OPENAI_API_KEY`) or the call fails, quotes fall back to the original rule-based parser.

## Permissions

- Quotes: `quotes.create`, `customers.view`, `pricing.view`
- Invoices: `invoices.view`, `invoices.manage`

The preview endpoint checks the permissions for the action it detected. AI calls count toward the company's `ai_month` usage and respect the `ai` plan feature.

## Invoice types

`auto` (full when nothing was invoiced yet, otherwise the remaining balance), `full`, `final`, `deposit` (with %), `progress` and `custom` (with a dollar amount). Without a spoken date the due date defaults to tomorrow, as in the Jobs screen.

## Data and logging

All reads and writes run through the tenant transaction helper. The raw command and audio are not stored. A quote preview adds a `mate_ai.quote_previewed` customer activity event; created quotes and invoices carry `source: mate_ai` in their payload.

## Limits

- Up to 8 services per Quote, 500 characters per command, 2 decimal places per quantity, 8 MB / 60 s of audio.
- Units: square feet, linear feet, fixed, each, box, step and hour. Values are not converted; when the spoken unit differs from the catalog unit the user must confirm the service.
- Job invoices only (quote-based invoices and other actions — scheduling, sending, payments — are next steps).
