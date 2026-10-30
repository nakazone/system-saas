# Phase 0 inventory: where the app assumes wood/LVP flooring

_Generated from `main` @ 076d06a (2026-10-30). Read-only survey; nothing in `src/` was changed._

The product assumes wood/LVP flooring almost everywhere. That assumption lives in three kinds of places:
- **Data defaults:** seeds, catalogs and enums.
- **Workflow:** the Installation/Sand & Finish sectors, sq ft production pay and stairs/vents.
- **Wording:** AI prompts, PDF taglines and landing copy.

**Organization has no industry or trade field.** The only related settings are `areaUnit` (`sq_ft | m2`) and `featureFlags`. All paths below are relative to `/home/claude/system-saas`. Nothing was modified.

---

## 1. Hardcoded service catalogs and seeds
- `src/lib/pricing/default-services.ts:7-13` – category type is `installation | sand_finish | supply | custom`.
- `src/lib/pricing/default-services.ts:15-680` – 92 seeded Tabela de Valores services, all wood/LVP or stairs. Examples: Hardwood Nail Down (`:170-190`), Engineered (`:140-150`), Luxury Vinyl (`:60`), Chevron (`:120`), Box/Open Stair, Treads & Risers, Wood Vents (`:381, :437`). Lines `:451-620` are a block of about 25 `sand_finish` items. Supply: Hardwood/LVP (`:388, :640`).
- `src/lib/pricing/default-services.ts:681` – `seedDefaultPricingServices()`. Called from `src/modules/organizations/service.ts:177` (org creation) and `src/crm/routes/builders-pricing.ts:602` (manual reseed).
- `src/lib/tenant/defaults.ts:310-351` – `DEFAULT_ESTIMATE_RULES`: one row each for hardwood, lvp, laminate, tile, carpet, with waste % and price per sq ft.
- `src/lib/tenant/defaults.ts:353-395` – `DEFAULT_QUOTE_ADDONS`: floor removal, baseboards, stair tread finish, subfloor leveling.
- `src/lib/tenant/defaults.ts:203-219` – an "Installer" role.
- `src/modules/organizations/service.ts:147-177` – org creation seeds the estimate rules, add-ons, checklists, payment templates and pricing services.
- `src/lib/checklists/defaults.ts:34-78` – site assessment checklist: existing flooring, subfloor type, moisture reading, stair count, acclimation days, "Area completed today (sqft)".
- `src/lib/payments/defaults.ts:32` – payment schedule milestone `phaseKey: "installation"`.
- `crm/public/products-erp.js:132,177` – product category defaults to `'Hardwood'`.

## 2. Payroll sectors (Instalação/Lixa), sector-finish logic, field app
- `src/lib/work-orders/sector-finish.ts:1-38` – a `sector === "both"` job closes Installation first (`installationDoneAt`), then Sand (`sandDoneAt`).
- `src/crm/routes/schedule-jobs.ts:43-47` – `WO_SECTORS = installation | sand_finish | both`. Also `:1070, :1183-1188, :1329-1353, :1403-1411` (save logic and `sandScheduledStart`) and `:2215-2273` (calendar feed splits jobs into "Installation" and "Sand & Finish" slots).
- `src/lib/settings/schedule.ts:9, 64, 136, 173, 241-266` – `ScheduleJobSector = all | installation | sand_finish`; routes each sector to its own job calendar.
- `src/crm/routes/folha-admin.ts:103-104` – `SECTOR_LABEL = { installation: "Instalação", sand_finish: "Lixa" }` and `sectorKey()`. Sector splits and filters at `:363-364, :1422-1448, :1530, :1698-1789`. sq ft production totals at `:156, :253-317, :605-739, :1126`. Job cost is split by sq ft at `:1774-1776`.
- `src/crm/routes/reports-hub.ts:356-429` – payroll report sector filter.
- `src/crm/routes/construction-payroll.ts`, `campo-jobs.ts`, `campo-dia.ts`, `src/lib/payroll/day-service.ts` – sector snapshot and sq ft (12, 4, 3 and 2 references).
- `src/lib/mate-ai/job-economics.ts:4-43` – a field day's pay is split across jobs by sq ft.
- Field app `crm/public/campo/`:
  - `dia.js:69` – `SECTOR = { installation: "Instalação", sand_finish: "Lixa" }`.
  - `dia.js:200, 525-546, 570, 615, 689, 744-796, 908-914` – sq ft production input and pay (`sqft × production_rate`).
  - `horas.js:51`, `ticket.js:213-275` – sq ft totals.
  - `ticket.js:894-908` – "Área em sqft", JobMeasurement `area_sqft`.
  - `ticket.html:105` – placeholder "piso instalado".
  - `campo-data.js:20,33` – demo data "Instalação", "Lixamento".
- `src/lib/features/index.ts` – the "campo" module is named "App do instalador".
- Frontend sector UI:
  - `crm/public/crm-job-modal.js:80,118-119,669-1289` – sector picker "Installation + Sand & Finish".
  - `folha.js` (27 refs), `agenda.js` (15), `jobs-info.js` (11), `payroll-module.js/.html` (15), `project-detail.js` (11), `job-detail.js` (8), `jobs-page.js` (7).
- `src/lib/dashboard/overview.ts:148-151, 787-802, 1079-1205` – agenda slots "· Instalação" and "· Lixa".

## 3. Quote sections Supply / Installation / Sand & Finish
- `src/lib/quotes/pdf.ts:31` – `DEFAULT_TAGLINE = "Hardwood · LVP · Refinishing"`.
- `src/lib/quotes/pdf.ts:227-231` – fixed section order SUPPLY → INSTALLATION → SAND & FINISH → Add On.
- `src/lib/quotes/pdf.ts:378-426` – keyword bucketing (`sand|finish|lix|acab`, `supply|fornec|delivery`); sections rendered at `:914-1034`.
- `src/lib/quotes/client-document.ts:4-9` – `DEFAULT_QUOTE_INCLUSIONS`: hardwood sanding, hardwood/LVP installation, dust containment.
- `src/lib/quotes/calculate.ts:3-49` – "Generic flooring estimate engine": area sq ft × (1 + waste %) × price per sq ft, plus labor per sq ft.
- `src/lib/settings/quotes.ts:210-235` – `FLOORING_TYPES` and `FLOORING_LABELS` (Madeira, Vinílico, Laminado, Cerâmica, Carpete); schema fields `default_price_per_sqft` and `default_labor_per_sqft`.
- `src/modules/quotes/routes.ts:172-373` – `flooringType` hardcoded as `z.enum(["hardwood","lvp","laminate","tile","carpet"])` (`:207`); options named "Option A: {flooringType}"; `floorAreaSqft` at `:918`.
- `src/modules/quotes/service.ts:113-182` – generates "`{flooringType}` material" and "labor" lines, unit `"sqft"`.
- `src/modules/assessments/routes.ts:436` – `const flooringType = "hardwood"` hardcoded when converting an assessment to a quote.
- `src/lib/work-orders/from-quote.ts:552,566` – unit falls back to `"sqft"`.
- Frontend:
  - `crm/public/quote-builder.js:41,71-103,1000-1108,4977` – section buckets, plus a sq ft/waste/stairs calculator at `:1280-1359`.
  - `crm/public/quote-paper.js:14-17,67-82,211` and `crm/public/quote-public.js:16-24,80-87` – duplicate the PDF section logic and tagline.
  - `src/views/quotes/form.ejs:32-39` – "Flooring type" select.

## 4. Field Quote measurement model and units
- `crm/public/field-quote-catalog.js`:
  - `:9-13` – SERVICES: demolition, installation ("Flooring installation"), sanding ("Sand & refinish").
  - `:16` – SUPPLY "Flooring material".
  - `:18-26` – MATERIALS: lvp, solid/engineered hardwood, laminate, tile, carpet, each with install/supply rates.
  - `:28-33` – PATTERNS with waste 10/15/20/20.
  - `:35-40` – SANDING_TYPES.
  - `:60-72` – EXTRAS: stairs, baseboard, quarter round, transitions, underlayment, moisture, leveling.
  - `:111-112` – unit labels.
- `crm/public/field-quote.js:66` – default material `'lvp'`. `:110-117, 215-216, 770, 808, 911, 1892, 2214-2236` – waste stepper and "sq ft + N% waste" supply line.
- `src/crm/routes/field-quotes.ts`:
  - `:34-36` – `SERVICE_IDS` and `EXTRA_IDS`.
  - `:39-173` – zod schemas: rooms `l_ft/l_in/w_ft/w_in/sqft`, material enum `:166`, sanding_type enum `:170`.
  - `:265, 512, 576, 605, 648` – five AI prompts written for a "flooring contractor".
- `src/lib/field-quote/tour.ts`:
  - `:22` – `TourGroup.flooringType`.
  - `:45-69` – `per_sqft`, `floor`, `stairs`.
  - `:86-104` – MATERIAL, EXISTING, SANDING copy and `UNIT_EN` (box → "boxes").
  - `:111-127` – keyword categories (Stairs, Subfloor prep, "Flooring material", "Sand & finish").
  - `:210-216` – default `"lvp"`, "Your flooring team".
- `prisma/schema.prisma:3477` – `FieldQuote.totalSqft`.

## 5. ObraBuilder takeoff and measurements
- `src/lib/builders/takeoff.ts`:
  - `:10` – `FLOOR_KINDS`.
  - `:14` – `FLOORING_KINDS`, with a comment saying tile, stone and countertops are excluded "for now".
  - `:16` – `KIND_LABEL`.
  - `:142-153` – `SPEC_FIELDS` (hardwood: species, grade, sheen…; lvp: wear, underlayment; carpet: pad) and `SPEC_LABEL`.
  - `:174` – `DEFAULT_WASTE`.
  - `:177-187` – `takeoffSettings` (`waste`, `box_sf`).
  - `:198` – `PlanTotal.sand_finish`.
  - `:219` – `withWaste()`.
- `src/lib/builders/measurements.ts`:
  - `:25-109` – stair schema (tread/riser/nosing, open sides, returns, species, `riser_material`) and vent schema (`VENT_TYPES` flush, self_rimming, return_air; species).
  - `:164-249` – summary and counts (tread/riser/nosing/vent/floor; "sand & finish on site").
  - `:567+` – PDF pack with stair drawings.
- `crm/public/partner-portal-takeoff.js`:
  - `:22-34` – LEGEND regexes (hardwood/LVP/laminate), `FLOORING`, `DEFAULT_ON`.
  - `:596-608` – `NOTE_KIND` (oak, hickory…), `NOT_FLOOR`.
  - `:716-815` – species and finish parsing; `sand_finish` is auto-set for hardwood.
  - `:830-1009` – stair detection.
- `crm/public/partner-portal.js` (7.5k lines, about 1,351 trade-term hits):
  - `:1344` – `square_feet`, `material` fields.
  - `:1820-1825` – unit-of-measure lists.
  - `:3930-3936` – `SPECIES`, `FINISHES`, `VENT_SIZES`, `RISER_OPTS`.
  - `:4232-4236` – `WOOD`, `STAINS`.
  - `:4483` – `STAIR_TURNS`.
  - `:5415-5430` – `FLOOR_KIND_OPTS`, `SPEC_FIELDS`, `SPEC_OPTS` (these duplicate the server-side lists).
- Also: `crm/public/partner-portal-3d.js` (46 hits), `builder-calculator.js` (27), `builder-pricing.js` (41), `builder-project.js` (54).
- `prisma/schema.prisma:3616` (`takeoffSettings`), `:3761-3775` (`BuilderMeasurement` stairs/vents), `:3824` (`BuilderPriceItem.unit` includes `step`).

## 6. AI prompts and Mate vocabulary
- `src/lib/partner-intake/extract.ts`:
  - `:93-133` – SYSTEM_PROMPT: "You read flooring work orders…", with stair tread/riser/vent/"SITE FINISHED SAND" rules and LVP/SPC matching.
  - `:85-91` – stair types.
  - `:241-326` – stair and sand reconciliation heuristics.
- `src/lib/mate-ai/agent.ts:168` – "a CRM for flooring installation companies".
- `src/lib/mate-ai/agent.ts:188` – Portuguese → service mapping (madeira, lixa, rodapé, degraus).
- `src/lib/mate-ai/interpret.ts:117, 133-138, 244, 283` – the same persona and mapping; "1350 sqft de hardwood".
- `src/lib/mate-ai/local.ts:53, 178-198, 236-238` – local synonym dictionary (madeira/taco/assoalho → hardwood, lixa → sand, vinil/lvp/spc → vinyl, contrapiso).
- `src/lib/mate-ai/command.ts:87-89` – lixa → sand.
- `src/lib/mate-ai/actions/pricing-more.ts:13-18, 29, 68, 145` – `CATS` labels; "sand|lix|acaba|refin" → `sand_finish`.
- `src/lib/mate-voice/realtime.ts:47, 61, 64` – "empresa de flooring" persona.
- `src/lib/job-media/report.ts:141` and `src/lib/job-media/checklist.ts:207` – "US flooring crews/installers".
- `src/lib/builders/voice.ts:101-117, 191-192, 252` – stair voice prompt (White Oak, Jacobean, nosing).
- `src/lib/builders/mate.ts:30, 49` – "send work orders to flooring companies".
- `src/lib/ai/client.ts` – generic, no trade terms.

## 7. Prisma schema (`prisma/schema.prisma`)
| Line | Field | Notes |
|---|---|---|
| 1427, 2070 | `ChecklistTemplate.visitPhase`, `Visit.phase` | removal / subfloor_prep / installation / sanding_finishing (default `"installation"`) |
| 1505-1514 | `EstimateRule.flooringType`, `*PerSqft` | unique per org + type |
| 1539-1541 | `Quote.flooringType` (default `"hardwood"`), `areaSqft`, `wastePercent` | |
| 1601, 1617, 1638 | `QuoteRoom.areaSqft`, `QuoteOptionGroup.flooringType`, `QuoteLineItem.unit` default `"sqft"` | |
| 1735-1736 | `PricingItem.category` (supply/installation/sand_finish/custom), `unit` `"sq_ft"` | |
| 1786-1787 | `Product.category` default `"Hardwood"`, `unitType` `"sq_ft"` | |
| 2301, 2324-2328 | `FinancePayrollAbatement.sector`, `PayrollEmployee.sector`, `productionRate` ($/sq ft) | |
| 2415-2417, 2443 | `PayrollTimesheet.sqft/sector`, `PayrollHourBankEntry.sqft` | |
| 2634-2647 | `WorkOrder.sector`, `relatedWorkOrderId` (Lixa → Instalação), `sandScheduledStart`, `installationDoneAt`, `sandDoneAt` | index on sector at `:2685` |
| 2796-2799 | `JobMeasurement.kind` `area_sqft`, unit `"sqft"` | |
| 2861 | `WorkOrderLineItem.quantitySqft` | |
| 2993-2995, 3022, 3082, 3156 | `CampoShift.sqft/sector`, `CampoShiftJob.sqft`, `PayrollPayment.sector`, `CampoManualEntry.sqft` | |
| 3477 | `FieldQuote.totalSqft` | |
| 3616, 3775, 3824 | `BuilderAccount.takeoffSettings`, `BuilderMeasurement.data`, `BuilderPriceItem.unit` | |

There are no Prisma `enum` declarations; every one of these is a free-form string, so changing them needs no enum migration.

## 8. Marketing, onboarding and i18n copy (counts of flooring/piso/hardwood)
- `src/lib/i18n/dictionary.json` – 77 hits (e.g. "{0} active · {1} Installation · {2} Sanding", "+ Linha · Lixa e acabamento", "10% off your flooring project"). `ignore.json` – 6.
- `src/views/landing.ejs` – 15 (`:30` "Feito para empresas de flooring", `:32, 62, 73, 104, 126-187, 253, 276`).
- `src/views/marketing/pricing.ejs:5` – "full flooring workspace".
- `src/views/builders/landing.ejs` – 4; `src/views/quotes/form.ejs` – 10.
- `src/lib/email/templates.ts:389-402, 585` – "empresa de piso", "flooring companies", email footer.
- `src/lib/settings/lead-messages.ts:69, 104, 131` – "your flooring project".
- `src/lib/legal/documents.ts:61` – Terms: "software for flooring and construction companies".
- CRM frontend: `partner-portal.js` (44), `field-quote.js` (20), `estimate-builder.js` (16), `configuracoes.js` (15), `projects.js/.html` (25), `field-quote-catalog.js` (14), `quote-builder.js` (13), `project-detail.js` (12), `partner-portal-takeoff.js` (12), `estimate-analytics.js` (11).
- Signup (`SignupRequest`, `:563`) and invites (`SignupInvite`) do not collect a trade.

## 9. Feature flags and settings
- `src/lib/features/index.ts:18` – `FeatureKey` is all module-level (field_quote, job_media, ai, payroll, finance, chat, reports, campo, public_portfolio). None are per-trade. The only trade wording is the campo name "App do instalador" (about `:94`).
- `src/lib/settings/organization.ts:25, 186, 218, 260, 293, 329` – `AREA_UNITS = ["sq_ft","m2"]`; UI at `crm/public/configuracoes.js:172`. Nothing else in the code reads `areaUnit`.
- `src/lib/settings/schedule.ts` – sector calendars (see area 2).
- `src/lib/settings/quotes.ts` – flooring types and estimate rules (see area 3).
- `Organization.featureFlags` (JSON, `schema:744`) and `OrgFeatureOverride` are the only existing per-org switches.

## 10. Dashboard and report metrics
- `src/lib/reports/queries.ts:221-249` – profitability grouped by `quote.flooringType` (`byFlooringType`). Exported via `src/modules/reports/routes.ts:122-129` and `src/crm/routes/reports-hub.ts:727`.
- `crm/public/relatorios.js:156, 406, 650` – "Custo por sq ft"; `:443-456, 669-696, 800` – "Lucro por tipo de piso"; `:787-788` – sq ft per job.
- `crm/public/estimate-analytics.js:60-124` – `revenue_by_flooring`, "flooring types" chart. I found no backend producer for this field; it looks like a legacy page.
- `crm/public/dashboard.js:2885` – "Sqft (soma)".
- `src/lib/dashboard/overview.ts:265, 787-802` – "Upcoming installations" and the Instalação/Lixa slots.

---

## Organization model
`prisma/schema.prisma:673-776` has nothing for industry, trade, vertical or segment. Trade-adjacent fields are limited to `areaUnit` (`:769`) and `featureFlags` (`:744`). The smallest future change would be an `Organization.tradePacks` JSON or string-array column, or reusing `featureFlags`.

## Where an isolated `src/lib/trades/` could live
- `src/lib/trades/` does not exist yet. `tsconfig.json` compiles all of `src/**/*`, so files there would be type-checked by `npm run lint` (`tsc --noEmit`) and built into `dist`. They would not affect the app as long as nothing imports them. Keep them free of unused locals, because `noUnusedLocals` is on.
- Tests in `tests/**/*.test.ts` (outside the tsconfig, run by vitest) can import from it. Existing examples to model on: `tests/builder-takeoff.test.ts`, `builder-measurements.test.ts`.
- To keep it out of the build entirely, a top-level `trades/` folder (next to `prisma/`) would be skipped by tsc. It would still be reachable from vitest.
- Suggested pack shape, based on what's duplicated today: services seed, estimate rules and add-ons, sectors/phases, quote sections and keyword rules, field-quote catalog, takeoff kinds/spec fields/waste, measurement types (stairs/vents), AI vocabulary and prompt fragments, and copy/i18n.

## Extraction effort estimate
| # | Area | Effort | Why |
|---|---|---|---|
| 1 | Service catalogs and seeds | **S** | Pure data in 3–4 files; seeding goes through one function |
| 2 | Sectors (Instalação/Lixa) and field app | **L** | Built into the WorkOrder columns (`sand*`, `installationDone*`), scheduling, payroll, reports and about 10 frontend files |
| 3 | Quote sections | **M** | Logic copied in 4 places (`pdf.ts`, `quote-paper.js`, `quote-public.js`, `quote-builder.js`), plus a hardcoded zod enum |
| 4 | Field Quote model | **M** | The catalog is one file, but the services/material/sanding enums and 5 prompts are in `field-quotes.ts`, `field-quote.js` and `tour.ts` |
| 5 | ObraBuilder takeoff and measurements | **L** | Stairs/vents schema plus about 1.3k trade refs in `partner-portal.js`; server and client keep duplicate lists |
| 6 | AI prompts and vocabulary | **M** | About 12 files; mostly string swaps, but the intake stair heuristics are flooring-specific code |
| 7 | Prisma fields | **M–L** | All strings (no enums), so new values need no migration; renaming `*Sqft` and `flooringType` would be a large migration, so keep the names and generalize what they mean |
| 8 | Marketing, i18n, copy | **S–M** | Many strings, but mechanical; the 77 dictionary entries need translation in pt/en/es |
| 9 | Feature flags and settings | **S** | Nothing per-trade exists; add a trade selection and wire `areaUnit` (currently stored but unused) |
| 10 | Dashboard and reports | **S** | A few metrics (cost per sq ft, profit by flooring type) and their labels |
