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

## Deploy on Railway

1. Create a Railway project from this repo.
2. Add a **PostgreSQL** plugin and link it to the web service (injects `DATABASE_URL`).
3. Set these **Variables** on the web service (required — the app will not start without them):

| Variable | Example |
|----------|---------|
| `APP_ROOT_DOMAIN` | `system-saas-production.up.railway.app` |
| `APP_BASE_URL` | `https://system-saas-production.up.railway.app` |
| `SESSION_SECRET` | output of `openssl rand -base64 32` |
| `JWT_SECRET` | another `openssl rand -base64 32` |
| `DATABASE_URL` | Variable Reference → Postgres → `DATABASE_URL` (or `DATABASE_PRIVATE_URL`) |
| `NODE_ENV` | `production` |

**Important:** if `DATABASE_URL` exists but is blank, delete it and recreate it as a reference from the Postgres service. A blank value overrides the plugin and crashes startup.

4. Redeploy. `npm start` runs `prisma migrate deploy` then the server.
5. Open `/signup` to create the first organization.

**Note:** Real per-tenant subdomains need a custom domain with a wildcard DNS record (`*.yourdomain.com`). The default `*.up.railway.app` hostname does not support arbitrary org subdomains.
