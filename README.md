# Flooring SaaS Platform

Multi-tenant SaaS for flooring installation companies: leads, pipeline, quotes, customers, and organization settings.

## Stack

- Node.js + Express + TypeScript (`strict`)
- PostgreSQL + Prisma Migrate (Row-Level Security enabled)
- Cookie sessions for staff; JWT prepared for partner portal
- Server-rendered EJS views with shared layout/branding
- S3-compatible storage abstraction (memory fallback in dev)

## Quick start

```bash
cp .env.example .env
# Start PostgreSQL 16, then create the database (example with Homebrew):
#   brew services start postgresql@16
#   createuser -s postgres   # if needed
#   createdb flooring_saas

# Apply migrations as a superuser (creates app_user + RLS policies)
DATABASE_URL="postgresql://$(whoami)@localhost:5432/flooring_saas?schema=public" npx prisma migrate deploy

# Point the app at the non-superuser role so RLS is enforced
# DATABASE_URL=postgresql://app_user:app_user@localhost:5432/flooring_saas?schema=public

npm install
npm run db:seed
npm run dev
```

1. Open `http://localhost:3000/signup` and create an organization (choose a slug, e.g. `acme`).
2. You will be redirected to `http://acme.localhost:3000/`.
3. Platform admin: `http://admin.localhost:3000/login` (credentials from seed / env).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run lint` | Typecheck |
| `npm test` | Unit + tenant isolation tests |
| `npx prisma migrate deploy` | Apply migrations |

## Multi-tenant model

- Tenant resolved from subdomain `{slug}.{APP_ROOT_DOMAIN}`
- Prisma extension injects `organizationId` from request context (never from the client)
- Postgres RLS policies enforce `organizationId = current_setting('app.current_tenant_id')`
- App connects as `app_user` (non-superuser) so RLS cannot be bypassed by table ownership
