# Phase 2 technical plan — operational modules

**Status:** M1 implemented on `feat/phase2-m1-foundations`. M0 plan kept below.  
**Branch:** `feat/phase2-m1-foundations`  
**Repo conventions win on style; Phase 2 rules 2–4 (tenant RLS, public tokens, English names) win on security.**

---

## M2 delivery notes

### Shipped (branch `feat/phase2-m2-quotes-v2`, based on M1)
- Quote status machine (`transitionQuote`) + legacy status normalization (`accepted`→`approved`, etc.)
- Rooms, option groups, line items with `unitCost`/`isOptional`/`isSelected`; server totals
- `PublicAccessToken` (hashed) + dual-read of legacy `Quote.publicToken`; SECURITY DEFINER lookup
- Public portal: options/optionals, live recalc, canvas signature, request changes, PDF, 14-day light verify
- Internal list metrics/filters; send / mark sent / approve / archive / renew / duplicate; add-ons
- Org quote settings (validity days, terms, tax, payment instructions); default add-on seed
- Hourly expire job for past-`validUntil` quotes
- PDF via **pdfkit** (lightweight, no browser)
- Tests: transitions, totals, public token cross-org isolation, RLS for QuoteRoom/PublicAccessToken

### Decisions
- M2 branch cut from `feat/phase2-m1-foundations` (M1 not yet on `main`)
- CRM `mapQuote` exposes normalized `status` plus `status_raw`
- Single option group auto-created when none provided so estimate lines attach cleanly

---

### Shipped
- **Schema/migration** `20260923000000_phase2_m1_foundations`: `Organization.timezone`, `Property`, `ActivityEvent`, RLS policies, backfill Property from `Customer.address` (column kept, marked deprecated).
- **`recordActivity`** in `src/lib/activity/record.ts`; history partial `src/views/partials/activity-history.ejs` on lead/customer detail.
- **Properties CRUD** on EJS customer detail + CRM `/api/customers/:id/properties` and `/api/properties/:id`.
- **Roles:** new defaults `admin`, `general_manager`, `office`, `sales`, `crew_lead`, `installer`; keys `pricing.view`, `imports.manage`. Existing orgs: **Users → Add missing default roles**.
- **Pricing gate:** `canViewPricing` / `redactMoney` / `withPricingGate` — EJS quotes/dashboard/settings + CRM quote/invoice/catalog JSON omit money without `pricing.view`.
- **CSV import:** Settings → Import (`/settings/import`), session-staged CSV, map columns, skip/update duplicates, ≤5000 rows.
- **Tests:** isolation covers Property + ActivityEvent; unit tests for CSV + pricing redaction. `npm run lint` + `npm test` green.

### Decisions
- New orgs get Phase 2 role keys only (legacy `sales_rep` / `project_manager` / `support` not seeded).
- Dual UI: domain helpers shared; CRM APIs redacted; EJS detail screens updated for history/properties.
- Import stores draft CSV in session (not hidden form field) for large files.

### Deviations
- Lead “detail” is a new EJS `leads/show` (list previously linked only to edit).
- CRM customer UI still uses address string; properties available via API for M2 wiring.

---

## 1. What exists today (reuse map)

### Stack and tenancy

| Concern | Convention in repo |
|---|---|
| Language / runtime | TypeScript `strict`, Express, Prisma, PostgreSQL |
| UI | Dual: **CRM** (`src/crm` + `crm/public`) is the post-login product; EJS under `src/views` still used for marketing, auth, platform admin, and some MVP routes (`/leads`, `/quotes`, `/customers`, `/settings`) |
| Money | `Decimal @db.Decimal(12, 2)` (costs sometimes `12,4`); calc helpers in `src/lib/quotes/calculate.ts` use numbers then `toDecimal` |
| Status fields | **Strings** with comment enums — not Prisma enums |
| IDs | UUID `@db.Uuid` |
| Quote numbering | `Quote.number` Int + `@@unique([organizationId, number])`; optional `quoteNumber` string |
| Permissions | Global `Permission` rows; keys in `DEFAULT_PERMISSIONS`; roles seeded via `DEFAULT_ROLE_PERMISSIONS` in `src/lib/tenant/defaults.ts`; checked with `requirePermission(...)` |
| Tenant Prisma | `TENANT_MODELS` + extension in `src/lib/tenant/prisma-tenant.ts`; `withTenantTransaction` sets `app.current_tenant_id` |
| RLS | Same migration that creates tables: `ENABLE` + `FORCE` + policy `tenant_isolation` matching `organizationId` to `current_setting('app.current_tenant_id')` (see `20260318120000_init`, `20260322130000_crm_modules`) |
| Public quotes today | Plaintext `Quote.publicToken`; lookup via `SECURITY DEFINER` function `get_quote_org_by_public_token`; then `SET LOCAL` + business queries under RLS (`src/modules/quotes/routes.ts`) |
| Email | `src/lib/email` — console provider only |
| Storage | `src/lib/storage` — S3-compatible when configured, else `MemoryStorage` |
| CI | `.github/workflows/ci.yml` — migrate as superuser, test as `app_user`, `npm run lint` + `npm test` |
| Isolation test | `tests/tenant-isolation.test.ts` (Leads today); must grow with every new business table |
| Unit tests | `tests/quote-calculate.test.ts` (Vitest) |

### Models already present (relevant to Phase 2)

- **Org / auth:** `Organization`, `User`, `Role`, `Permission`, `Invitation`, `PartnerUser` (portal backlog-ready)
- **CRM core:** `PipelineStage`, `Lead`, `Customer` (`address` single string — migrate into `Property` in M1, keep column deprecated)
- **Quotes:** `EstimateRule`, `Quote`, `QuoteLineItem` (has `unitPrice`, **no** `unitCost`; no rooms/options), `QuoteCatalogItem`
- **Invoicing (thin):** `QuoteInvoice`, `InvoiceReceipt` — evolve / supersede carefully in M4
- **Projects (thin):** `Project` (builder-centric, `address` string, statuses `"active"`) — rewrite semantically in M5 while preserving table or migrating
- **Payroll (SF port):** `PayrollEmployee`, `PayrollPeriod`, `PayrollTimesheet` — keep for SF parity; M6 `LaborEntry` should be additive and eventually converge (backlog timesheets)

### Default roles today (new orgs)

`admin`, `sales_rep`, `project_manager`, `support` — **not** the Phase 2 set. M1 adds new role keys for **new** orgs and an optional “add missing default roles” action for existing ones.

### Permission keys already registered

Includes `leads.*`, `customers.*`, `quotes.*`, `users.*`, `settings.manage`, `pipeline.manage`, `estimate_rules.manage`, `builders.*`, `payroll.*`, `projects.view`, `reports.view`, `contracts.view`, `visits.view`.  
**Missing for Phase 2:** `pricing.view`, `costs.view`, `invoices.*`, `projects.manage`, `visits.manage`, `checklists.manage`, `automations.manage`, `imports.manage`, etc.

### Estimate engine

`calculateQuote` — single total area + waste + material/labor markups. M2 extends to **per-room sum** and option groups; keep total-area mode.

### Product branding

`Organization` logo/colors/contact; marketing uses product name constants. No competitor branding in code or copy.

---

## 2. Cross-cutting design decisions

### 2.1 Dual UI (CRM vs EJS) — risk and rule

Production staff UX is the **CRM shell**. Phase 2 screens for day-to-day ops (quotes v2, projects, schedule, my-day, invoices, kanban) should land primarily in **CRM APIs + HTML/JS**, reusing SF patterns only for **generic** flooring ops logic — never brand/copy/architecture from competitors.

EJS MVP routes remain for settings, invitations, and any surface not yet ported; new shared domain logic goes in `src/lib/*` and `src/modules/*/service.ts` so both UIs (and tests) call one service layer.

### 2.2 Money, status, naming

- Money: keep `Decimal(12,2)` (and `12,4` only where products already do).
- Status: string fields + pure transition functions (e.g. `transitionQuote`).
- Code/commits/routes/names: English.
- Display timezone: add `Organization.timezone` IANA, default `America/New_York`; store visit times in UTC.

### 2.3 RLS for every new business table

Same pattern as init migration:

1. `organizationId` UUID FK + indexes (unique keys composite with org).
2. Add model name to `TENANT_MODELS`.
3. In the **same** SQL migration: ENABLE/FORCE RLS + `tenant_isolation` policy.
4. Extend `tests/tenant-isolation.test.ts` (create row in A, assert invisible from B).

### 2.4 Public token routes (rule 3)

Evolve beyond plaintext `Quote.publicToken`:

1. Table `PublicAccessToken`: `organizationId`, `entityType`, `entityId`, `tokenHash`, `expiresAt`, `revokedAt?`, `lastUsedAt?`, optional `viewedAt`.
2. Lookup function `SECURITY DEFINER` returns only `(organization_id, entity_type, entity_id)` from **hash** of presented token (never store raw token).
3. App sets `SET LOCAL app.current_tenant_id` and runs normal Prisma under RLS.
4. Never disable RLS for portal pages. Support revoke + expiry; optional light verify after 14 days.

Migrate existing `Quote.publicToken` rows into hashed tokens in M2 (or dual-read briefly).

### 2.5 Activity history

Immutable `ActivityEvent`; single helper `recordActivity(...)` inside the same DB transaction as the mutation. Partial EJS/CRM “History” component from M1 onward.

### 2.6 Pricing visibility

`pricing.view` gates monetary fields in **templates and services** (strip/omit fields). `costs.view` for project cost panels (M6). `crew_lead` / `installer` seed without either.

---

## 3. Milestone plans (M1–M8)

### M1 — Foundations

**Models**

- `ActivityEvent` — fields as Phase 2 §4.1; index `(organizationId, entityType, entityId, createdAt)`.
- `Property` — customer-scoped structured address; `Customer.address` deprecated in comment, backfill first Property from existing address.
- `Organization.timezone` — IANA string, default `America/New_York`.

**Roles / permissions**

- New default role keys for **new** orgs: `admin`, `general_manager`, `office`, `sales`, `crew_lead`, `installer` (keep creating legacy keys only if needed for CRM string checks — prefer mapping CRM role labels to new keys; document mapping in this file when implementing).
- Add `pricing.view`; assign per role matrix in seed.
- Settings → Users: optional “Add missing default roles” idempotent action.

**Import CSV**

- Settings → Import: customers (+ property) and leads; column map, 10-row preview, ≤5000 rows, duplicate by email/phone.

**Routes / views**

- Customer detail: Properties CRUD section + Activity history.
- Lead detail: Activity history.
- Wire `recordActivity` on lead/customer create/update (and later modules).

**Permission keys:** `imports.manage`, `pricing.view` (plus existing).

**Risks**

- CRM vs EJS customer screens diverge — implement service once; surface Properties in CRM customer UI and EJS `customers/show`.
- Existing orgs keep old roles until opt-in.

**Accept:** history on lead/customer; multi-property; installer sees no money on existing quote/dashboard surfaces; CSV ~500 mixed rows; isolation covers `ActivityEvent` + `Property`.

---

### M2 — Quotes v2

**Models / fields**

- Extend `Quote`: `propertyId`, `salespersonId`, `validUntil`, `clientMessage`, `terms`, `clientView` JSON, status machine (`draft|sent|changes_requested|approved|converted|archived|expired`). Map legacy `accepted`→`approved`, `rejected`→`archived` (or lost reason later).
- `QuoteRoom`, extend `QuoteLineItem` (`roomId?`, `unitCost`, `unitPrice`, `isOptional`, `isSelected`, `optionGroupId?`, `name`, …).
- `QuoteOptionGroup`.
- Org settings: quote validity days, default terms, suggested add-ons catalog.
- `PublicAccessToken` (+ migrate off plaintext token).
- Daily job: expire quotes past `validUntil`.

**Logic**

- Pure `transitionQuote(current, event)` + tests.
- Estimate engine: per-room + option groups; server totals authoritative.
- Public portal: approve (canvas signature → storage), request changes; printable CSS + light PDF lib (justify in PR, e.g. `pdfkit` or similar small dep).
- List metrics; history + view tracking.

**Routes:** internal CRM + EJS quote APIs; `/public/quotes/:token` (and approve/changes).  
**Permissions:** existing `quotes.*` + enforce `pricing.view`.

**Risks**

- Status rename breaks CRM clients expecting `accepted` — dual-read or API adapter during migration.
- `Quote.payload` JSON from SF builder vs normalized rooms/items — prefer normalized columns; keep payload only if needed for parity.
- Token migration must not break live public links.

**Accept:** 3 rooms / 2 options / 2 optionals end-to-end; invalid transitions rejected; revoked/expired fail; cross-org token test; installer no amounts.

---

### M3 — Site assessment + checklist engine

**Models**

- `ChecklistTemplate` (`appliesTo`, `visitPhase?`, `fields` JSON).
- `ChecklistResponse` (template snapshot + answers).
- `SiteAssessment` (lead/customer, property, schedule, assignee, status, checklist).

**UI:** Settings → Checklists editor; mobile fill at 375px; convert assessment → draft quote with rooms.

**Risks:** photo upload keys must be tenant-prefixed; template edits must not alter old response snapshots.

---

### M4 — Payment schedule, invoices, payments

**Models**

- `PaymentSchedule` + `PaymentScheduleItem` on quote; copy immutable to project on convert/approve rules.
- Org payment templates + payment instructions text.
- Prefer new `Invoice` / `InvoiceLineItem` / `Payment` (or evolve `QuoteInvoice`/`InvoiceReceipt` with clear migration) — **decision in M4 PR:** new names matching Phase 2 doc if CRM can be updated; else alias layer.
- Sequence table with row lock for `INV-0001`-style numbers per org.
- Portal via `PublicAccessToken`; fields reserved for `externalPaymentId` / `processor`.

**Logic:** schedule validation (100% / fixed = total; last line absorbs cents); triggers create draft invoices; manual payments; customer statement.

**Risks:** coexistence with SF `QuoteInvoice` APIs; concurrency test for numbering.

---

### M5 — Projects, visits, crews, schedule, My Day

**Models**

- Evolve `Project` (quote conversion, numbering, statuses including derived `needs_invoicing`).
- `Visit`, `ProjectEvent`, `Crew`, `CrewMember`.
- Reuse checklist engine; wire payment triggers on phase start/complete.

**UI:** week/month crew schedule; `/my-day` default for installer/crew_lead; `manifest.webmanifest` (no SW offline).

**Logic:** pure schedule conflict detection + tests; email on visit changes; optional crew scoring → TODO if not ported.

**Risks:** naming clash with thin `Project` + payroll timesheets; installer permission scoping (own visits only).

---

### M6 — Project costs

**Models:** `MaterialOrder`, `Expense`, `LaborEntry`, `LaborRate` (dated rates).  
**Logic:** budgeted (frozen at conversion) vs committed vs actual; anti-double-count when expense linked to line item; profitability report CSV; collect actual vs estimated material for future waste tuning (no auto-suggest yet).

**Permissions:** `costs.view` (+ `pricing.view` as needed).

---

### M7 — Communication automations

**Infra:** Postgres-backed queue (`pg-boss` or `ScheduledMessage` + worker); tenant set per job.  
**Models:** automation settings, `CommunicationLog`; customer `marketingConsent` / `transactionalOptOut`.  
**Channel:** `email | sms` enum-ready; implement email only.

**Risks:** worker must never run org A job under org B context (isolation test); clock-mockable follow-ups.

---

### M8 — Kanban, action home, reports

- System milestones fixed: New → Assessment scheduled → Quote sent → Won / Lost; custom stages between.
- Auto-move cards from real entity events; Lost requires loss reason.
- Action-oriented home replacing/augmenting dashboard; installer → My Day.
- Reports + CSV exports listed in Phase 2 §11.3.

**Risks:** current `DEFAULT_PIPELINE_STAGES` already similar but not identical (e.g. Meeting Scheduled vs Assessment scheduled) — migrate stages carefully without deleting org customizations.

---

## 4. Proposed Prisma names (aligned to repo)

Prefer singular Prisma models, `organizationId`, string statuses, `Decimal` money, `sortOrder`/`order` as already used (`sortOrder` on line items; pipeline uses `order` — **new models:** prefer `sortOrder` for consistency with `QuoteLineItem` / `PricingItem`, except where Phase 2 says `order` on rooms/groups — use `sortOrder` in schema, expose as order in UI).

| Milestone | New / changed models |
|---|---|
| M1 | `ActivityEvent`, `Property`; `Organization.timezone` |
| M2 | `QuoteRoom`, `QuoteOptionGroup`; Quote/LineItem fields; `PublicAccessToken`; quote add-on catalog model or JSON settings |
| M3 | `ChecklistTemplate`, `ChecklistResponse`, `SiteAssessment` |
| M4 | `PaymentSchedule`, `PaymentScheduleItem`, `Invoice`, `InvoiceLineItem`, `Payment`, `InvoiceSequence` (or org counter); deprecate/migrate `QuoteInvoice` |
| M5 | expand `Project`; `Visit`, `ProjectEvent`, `Crew`, `CrewMember` |
| M6 | `MaterialOrder`, `Expense`, `LaborEntry`, `LaborRate` |
| M7 | `ScheduledMessage` / job rows, `CommunicationLog`; consent fields on `Customer` |
| M8 | `LossReason`; pipeline flags `isSystemMilestone`; report queries only |

---

## 5. RLS + public token checklist (every PR)

1. Migration creates table + RLS policy together.  
2. `TENANT_MODELS` updated.  
3. Isolation test asserts cross-tenant invisibility.  
4. Public routes: hash lookup → set tenant → RLS queries.  
5. No `BYPASSRLS` for app role; no disabling RLS.

---

## 6. Points that are wrong, risky, or need product calls

1. **“MVP is only EJS modules” is outdated.** The live product is largely the SF CRM port. Building Phase 2 only in EJS would ship the wrong UI. Plan: domain in `src/lib` + services; primary UX in CRM; keep EJS where still in use.
2. **Quote status vocabulary mismatch** (`accepted`/`rejected`/`invoiced` vs `approved`/`changes_requested`/`converted`). Needs an explicit data migration + API compatibility window.
3. **Plaintext `publicToken` on Quote** violates Phase 2 rule 3; M2 must replace with hashed `PublicAccessToken` and update the DEFINER function.
4. **`QuoteInvoice` vs new `Invoice`:** inventing a second invoice stack without migrating CRM endpoints risks dual systems. M4 should pick one canonical model and adapt CRM.
5. **Thin `Project` + payroll timesheets** already exist; M5/M6 must extend rather than create parallel “project” tables with the same name.
6. **Role rename** (`sales_rep` → `sales`, etc.) can break permission checks that hardcode keys in CRM — inventory role key string compares before changing seed.
7. **Heavy CRM surface area** (marketing, gallery, messages, financial) was previously hidden for MVP focus; Phase 2 reintroduces schedule/projects/invoices deliberately — avoid re-enabling unrelated SF modules.
8. **PDF + job queue** are the only justified new deps; ask before any paid external service.
9. **Lead has no address** today — Property links mainly via Customer; site assessments may create Property when converting lead→customer or attach property after customer conversion.
10. **Competitor-informed flows only** — no copying of names, copy, or screens from any named field-service vendor.

### Deferred TODO (document for M5)

- Crew suggestion scoring (legacy profit/speed/risk weights): implement if time; else leave configurable weights stub + TODO here.

---

## 7. Delivery format (reminder)

Each milestone: branch `feat/phase2-mN-<slug>` from updated `main` → migration+RLS → seed/docs → tests → update this file → PR → **stop for approval**.

---

## 8. Milestone status

- [x] M0 — recon + plan  
- [x] M1 — foundations  
- [x] M2 — quotes v2  
- [x] M3 — site assessment + checklist engine (this branch)  
- [ ] **Await review approval before M4** (`feat/phase2-m4-payments`)
