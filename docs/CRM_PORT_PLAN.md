# Port Senior Floors System → System SaaS (multi-tenant)

## Goal

The **internal product** (what staff see after login) must be the Senior Floors CRM
(`senior-floors-system`): same screens, same APIs, same workflows.

The **SaaS shell** stays responsible for:

- Marketing / pricing / signup
- Organizations (tenants), plans, platform admin
- Session + `organizationId` isolation (Postgres RLS)
- Workspace routing on Railway apex hosts

## Source system facts

| | Senior Floors System | System SaaS (today) |
|--|--|--|
| Stack | Express + MySQL (`mysql2`) + static HTML/JS | Express + Postgres/Prisma + EJS |
| Auth | Session + role/permission keys | Session + roles/permissions (UUID orgs) |
| Tenancy | Single company | Multi-tenant (`organizationId`) |
| Size | ~20k LOC routes + ~2.4MB UI | MVP modules only |

## Strategy (not a rewrite from scratch)

1. **Vendor** the SF CRM into this repo under `crm/` (UI + routes + lib).
2. **Keep SF UI + `/api/*` contracts** so the product “feels identical”.
3. **Adapt the data layer** to Postgres + `organization_id` on every tenant table.
4. **Bridge auth**: SaaS login establishes session; CRM middleware reads the same session
   (`userId`, `organizationId`, permission keys).
5. **Replace the EJS “app shell”** (dashboard/leads/quotes views) with the SF CRM UI for
   tenant users. Marketing EJS pages remain for the public host.

## Phases

### Phase 0 — Foundation (started)

- [x] This plan document
- [x] `crm/` tree synced from `senior-floors-system` (exclude `node_modules`)
- [x] Sync script `scripts/sync-senior-floors-crm.sh`
- [x] Multi-tenant mount (`src/crm/`) — SF static UI at tenant root
- [x] Session bridge: `/api/auth/*` → System SaaS Postgres users
- [x] Minimal `/api/leads` + `/api/dashboard/stats` + `/api/pipeline-stages`
- [ ] Expand SF pipeline stage model (slugs, kanban v9) to match SF exactly

### Phase 1 — Core commercial parity

Port with tenant scoping (Postgres + `organization_id`):

1. Auth/session API compatible with SF (`/api/auth/*`)
2. Leads + pipeline stages + interactions
3. Customers
4. Quotes / estimates (SF quote builder)
5. Dashboard stats the SF home screen needs

### Phase 2 — Operations

Projects, schedule/visits, crews, builder payment forecasts

### Phase 3 — Money & people

Financial complete, construction payroll

### Phase 4 — Partner surface

Builder portal (JWT) scoped per organization

### Phase 5 — Retire MVP EJS modules

Remove duplicate EJS leads/customers/quotes once CRM APIs cover them.

## Multi-tenant rules (non-negotiable)

1. Every CRM business row includes `organization_id` (UUID, FK → `Organization`).
2. Every CRM query filters by `organization_id` from server session — never from the client body alone.
3. Prefer Postgres RLS (extend existing policies) for defense in depth.
4. File uploads / S3 keys prefixed by `organizationId`.
5. Public quote links stay token-based (already in SaaS).

## ID strategy

SF uses MySQL auto-increment integers. SaaS uses UUIDs for org/users.

**Decision for the port:**

- Keep **numeric IDs** inside CRM tables (serial/bigserial) for minimal UI/API churn.
- `organization_id` is UUID.
- SaaS `User.id` (UUID) is the session principal; store `crm_user_id` mapping or migrate SF
  `users` table to UUID later. Phase 0 bridge may create a per-org CRM user row linked by email.

## Database migration approach

1. Generate Postgres DDL from SF MySQL schemas + add `organization_id`.
2. Ship as Prisma migrations (or raw SQL migrations) in phases matching modules above.
3. Do **not** run dual MySQL+Postgres in production long-term.

## What “done” looks like for an org admin

After signup / find-workspace / login on the SaaS host, they land on the SF dashboard
(`dashboard.html` flows), with navy/gold SF chrome, and can run leads → quotes → projects
without touching the old EJS screens.

## Out of scope for early phases

- Copying Senior Floors marketing website/LP into the SaaS marketing site
- Importing production SF MySQL data (separate migration project)
- Perfect pixel parity on mobile before Phase 1 APIs are stable
