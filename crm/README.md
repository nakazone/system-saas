# Senior Floors CRM (vendored)

This directory is a sync of [`senior-floors-system`](https://github.com/nakazone/senior-floors-system)
used as the **internal product UI + API source** for System SaaS.

## Sync

```bash
./scripts/sync-senior-floors-crm.sh
# or
SENIOR_FLOORS_SYSTEM_PATH=/path/to/senior-floors-system ./scripts/sync-senior-floors-crm.sh
```

## Multi-tenant adaptation

See [docs/CRM_PORT_PLAN.md](../docs/CRM_PORT_PLAN.md).

**Phase 0 (current):** static UI is served to authenticated tenants; `/api/auth/*` is
bridged to System SaaS Postgres users/sessions.

**Next:** port `/api/leads`, pipeline, quotes, … with `organization_id` on Postgres.
