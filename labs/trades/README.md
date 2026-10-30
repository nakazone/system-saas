# Trades Lab — dedicated editions per trade (parallel area)

Branch: `trades-lab`. **Nothing here runs in production.**

This folder is where we design ObraMate editions for other trades — Tile, Carpet, Natural Stone,
Countertops and Cabinetry — as **Trade Packs** on top of the shared core, without touching the
ObraMate CRM or ObraBuilder that are live today.

## Why it can't affect the app
- It lives at the repo root, **outside `src/`**. The app build (`tsc`, `include: ["src/**/*"]`)
  does not compile it, and `npm run build` copies only `src/views`, `src/public`, `crm/public`
  and `crm/assets`.
- Tests run only `tests/**/*.test.ts`; nothing here is a test file.
- Nothing in `src/` or `crm/` imports it.
- The branch only reaches `main` when Naka says "Deploy".

## What's here
| Path | What |
|---|---|
| `types.ts` | The `TradePack` contract: units, materials + spec fields, waste rules (percent / by pattern / computed by an engine), seed services, quote sections, phases with waits, required evidence (photo, test, signature, checklist), cross-trade dependencies, pay rules, measurement model, AI hints, new models, open questions |
| `packs/hardwood.ts` | What is live today, written as a pack (target of Phase 0) |
| `packs/{tile,carpet,stone,countertops,cabinetry}.ts` | Draft packs from the research (ranges are estimates) |
| `index.ts` | Registry + `validatePack()` consistency checks |
| `check.ts` | Prints a summary of every pack and fails on inconsistencies |
| `docs/phase-0-inventory.md` | Every place in `src/` and `crm/` that assumes wood/LVP flooring, with effort per area |

## Commands
```bash
npx tsc -p labs/trades          # type-check the lab alone
npx tsx labs/trades/check.ts    # pack summary + consistency checks
```

## Rules for working here
- Same repo rules as the app: code in English, no competitor or design references in code/copy.
- Packs are **data + small engines**, never forks of app screens.
- When a pack is ready to go live, the work moves into `src/lib/trades/` in its own branch
  (Phase 0 first), with migrations, RLS and tenant-isolation tests as usual.
