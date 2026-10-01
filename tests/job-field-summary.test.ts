import { describe, it, expect } from "vitest";
import { summarizeHours } from "../src/crm/routes/job-field-summary.js";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const at = (s: string) => new Date(s);

describe("job field summary — hours by person", () => {
  it("adds clock segments and manual entries per person, ignoring breaks", () => {
    const rows = summarizeHours(
      [
        { userId: "a", userName: "Ana", activityKind: "on_site", startedAt: at("2026-09-24T14:00:00Z"), endedAt: at("2026-09-24T22:00:00Z"), workDate: day("2026-09-24") },
        { userId: "a", userName: "Ana", activityKind: "break", startedAt: at("2026-09-24T18:00:00Z"), endedAt: at("2026-09-24T18:30:00Z"), workDate: day("2026-09-24") },
        { userId: "a", userName: "Ana", activityKind: "travel", startedAt: at("2026-09-25T13:00:00Z"), endedAt: at("2026-09-25T13:30:00Z"), workDate: day("2026-09-25") },
        { userId: "b", userName: "Bruno", activityKind: "on_site", startedAt: at("2026-09-25T14:00:00Z"), endedAt: null, workDate: day("2026-09-25") },
      ],
      [
        { userId: "b", userName: "Bruno", entryType: "hours", activityKind: "on_site", hours: 2, sqft: null, workDate: day("2026-09-26") },
        { userId: "c", userName: "Carla", entryType: "production", activityKind: null, hours: null, sqft: 450, workDate: day("2026-09-26") },
      ],
      at("2026-09-25T17:00:00Z"),
    );
    expect(rows).toEqual([
      { user_id: "a", name: "Ana", hours: 8.5, on_site_hours: 8, sqft: 0, days: 2 },
      { user_id: "b", name: "Bruno", hours: 5, on_site_hours: 5, sqft: 0, days: 2 },
      { user_id: "c", name: "Carla", hours: 0, on_site_hours: 0, sqft: 450, days: 1 },
    ]);
  });
});

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role (see invoices-module test). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("job field summary — HTTP access", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgA = "";
  let orgB = "";
  let jobId = "";
  const suffix = `jfs${Date.now().toString(36)}`;
  const emails = { admin: `jf-a-${suffix}@example.com`, lead: `jf-l-${suffix}@example.com`, other: `jf-o-${suffix}@example.com`, b: `jf-b-${suffix}@example.com` };

  async function login(email: string, organizationId: string) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
      redirect: "manual",
    });
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  async function get(cookie: string, path: string) {
    const r = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    orgA = (await createOrganizationWithAdmin({ organizationName: `JF A ${suffix}`, slug: `jf-a-${suffix}`, adminName: "A", adminEmail: emails.admin, password: "password12345" })).organization.id;
    orgB = (await createOrganizationWithAdmin({ organizationName: `JF B ${suffix}`, slug: `jf-b-${suffix}`, adminName: "B", adminEmail: emails.b, password: "password12345" })).organization.id;
    const passwordHash = await hashPassword("password12345");
    await withTenantTransaction(orgA, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: "crew_lead" } });
      const lead = await tx.user.create({ data: { organizationId: orgA, email: emails.lead, name: "Lead", passwordHash, roleId: role.id } });
      await tx.user.create({ data: { organizationId: orgA, email: emails.other, name: "Other", passwordHash, roleId: role.id } });
      const wo = await tx.workOrder.create({
        data: {
          organizationId: orgA,
          number: 1,
          title: "Lot 3",
          assignedUserId: lead.id,
          campoAttention: "Proteger degraus",
          campoChecklist: [{ id: "c1", text: "Fotos do antes", done: true }, { id: "c2", text: "Rodapé", done: false }],
        },
      });
      jobId = wo.id;
      const shift = await tx.campoShift.create({
        data: { organizationId: orgA, userId: lead.id, workDate: new Date("2026-09-24"), clockInAt: new Date("2026-09-24T14:00:00Z"), status: "closed" },
      });
      await tx.campoSegment.create({
        data: { organizationId: orgA, shiftId: shift.id, activityKind: "on_site", workOrderId: wo.id, startedAt: new Date("2026-09-24T14:00:00Z"), endedAt: new Date("2026-09-24T20:00:00Z") },
      });
    });
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("office sees the field summary; the crew only on their own job; other tenants never", async () => {
    const admin = await login(emails.admin, orgA);
    const r = await get(admin, `/api/work-orders/${jobId}/field`);
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({
      attention: "Proteger degraus",
      checklist: { done: 1, total: 2, customized: true },
      hours: { total: 6 },
    });
    expect(r.json.data.hours.people[0]).toMatchObject({ name: "Lead", hours: 6, days: 1 });

    const job = await get(admin, `/api/work-orders/${jobId}`);
    expect(job.json.data.campo_attention).toBe("Proteger degraus");

    expect((await get(await login(emails.lead, orgA), `/api/work-orders/${jobId}/field`)).status).toBe(200);
    expect((await get(await login(emails.other, orgA), `/api/work-orders/${jobId}/field`)).status).toBe(404);
    expect((await get(await login(emails.b, orgB), `/api/work-orders/${jobId}/field`)).status).toBe(404);
  });
});
