import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("agenda — visita do lead ligada ao compromisso", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  let leadId = "";
  let cookie = "";
  const suffix = `agv${Date.now().toString(36)}`;
  const email = `ag-${suffix}@example.com`;

  async function call(method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `Agenda ${suffix}`, slug: `ag-${suffix}`, adminName: "Admin", adminEmail: email, password: "password12345" });
    orgId = a.organization.id;
    leadId = await withTenantTransaction(orgId, async (tx) =>
      (await tx.lead.create({ data: { organizationId: orgId, name: "Teri Hubbeling", phone: "(512) 484-7818", status: "new" } })).id,
    );
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("a visita aparece como 'visit' com o lead, e editar/cancelar na agenda atualiza o lead", async () => {
    const at = new Date("2026-10-08T15:00:00.000Z");
    const visit = await call("POST", "/api/visits", { lead_id: leadId, scheduled_at: at.toISOString(), address: "33980 Broce Ranch Trail, Evergreen, CO 80439" });
    expect(visit.status).toBe(201);
    const meetingId = visit.json.data.meeting_id;
    expect(meetingId).toBeTruthy();

    const ev = await call("GET", `/api/schedule/events?from=2026-10-01T00:00:00.000Z&to=2026-10-31T00:00:00.000Z`);
    const row = ev.json.data.find((e: any) => e.id === meetingId);
    expect(row.type).toBe("visit");
    expect(row.title).toBe("Teri Hubbeling");
    expect(row.meta.lead).toMatchObject({ id: leadId, name: "Teri Hubbeling", phone: "(512) 484-7818" });

    // Moving it on the agenda moves the lead's visit.
    const moved = await call("PUT", `/api/meetings/${meetingId}`, {
      scheduled_start: "2026-10-09T16:00:00.000Z",
      scheduled_end: "2026-10-09T17:00:00.000Z",
      notes: "Portão lateral",
    });
    expect(moved.status).toBe(200);
    let visits = (await call("GET", `/api/visits?lead_id=${leadId}`)).json.data;
    expect(visits[0].scheduled_at).toBe("2026-10-09T16:00:00.000Z");
    expect(visits[0].notes).toBe("Portão lateral");

    // Cancelling it on the agenda marks the visit cancelled.
    expect((await call("DELETE", `/api/meetings/${meetingId}`)).status).toBe(200);
    visits = (await call("GET", `/api/visits?lead_id=${leadId}`)).json.data;
    expect(visits[0].status).toBe("cancelled");

    // Visit statuses map onto meeting statuses (no_show is not a meeting status).
    const v2 = await call("POST", "/api/visits", { lead_id: leadId, scheduled_at: at.toISOString() });
    const upd = await call("PUT", `/api/visits/${v2.json.data.id}`, { lead_id: leadId, status: "no_show" });
    expect(upd.status).toBe(200);
    const mtg = await prisma.meeting.findFirst({ where: { id: v2.json.data.meeting_id } });
    expect(mtg?.status).toBe("completed");
    expect(mtg?.leadId).toBe(leadId);
  });
});
