/**
 * Tile phases recorded on a phone without signal and sent later: the crew (installer role, no
 * office permission) sends proofs and photos in one request each, the time they were done is kept
 * (never in the future, at most 3 days back), and a resent photo lands on the same ObraCam photo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { getPack } from "../src/lib/trades/index.js";
import { addPhaseEvidence, closeJobPhase, ensureJobPhases } from "../src/lib/trades/job-phases-db.js";
import { clientTime } from "../src/crm/routes/job-phases.js";
import { markWorkOrderCompletedForInvoice } from "../src/lib/invoices/job.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

const PIXEL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

describe("phone time of an action sent later", () => {
  const now = new Date("2026-11-03T20:00:00Z");
  it("is kept when it is in the last 3 days", () => {
    expect(clientTime("2026-11-03T18:30:00Z", now)?.toISOString()).toBe("2026-11-03T18:30:00.000Z");
  });
  it("is never in the future and never more than 3 days back", () => {
    expect(clientTime("2026-11-04T09:00:00Z", now)?.toISOString()).toBe(now.toISOString());
    expect(clientTime("2026-10-20T09:00:00Z", now)?.toISOString()).toBe("2026-10-31T20:00:00.000Z");
    expect(clientTime(undefined, now)).toBeNull();
    expect(clientTime("nope", now)).toBeNull();
  });
});

describe.skipIf(!privileged)("Tile phases from the crew's phone, sent when the signal comes back", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  let jobId = "";
  let cookie = "";
  const suffix = `off${Date.now().toString(36)}`;
  const crewEmail = `crew-${suffix}@example.com`;
  const H = 3600_000;

  async function call(method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const a = await createOrganizationWithAdmin({ organizationName: `Tile ${suffix}`, slug: `tile-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    orgId = a.organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { tradePacks: ["tile"] } });
    const role = await prisma.role.findFirst({ where: { organizationId: orgId, key: "installer" } });
    const crew = await prisma.user.create({ data: { organizationId: orgId, name: "Carlos Silva", email: crewEmail, passwordHash: await hashPassword("password12345"), roleId: role!.id } as never });
    const tile = getPack("tile");
    const now = Date.now();
    jobId = await withTenantTransaction(orgId, async (tx) => {
      const wo = await tx.workOrder.create({ data: { organizationId: orgId, number: 7, title: "Shower", status: "in_progress", assignedUserId: crew.id, scheduledStart: new Date(now - 60 * H) } });
      await ensureJobPhases(tx, orgId, wo.id, tile);
      await addPhaseEvidence(tx, tile, wo.id, "site_ready", "ready_checklist", { at: new Date(now - 60 * H).toISOString(), value: { confirmed: true } });
      await closeJobPhase(tx, tile, wo.id, "site_ready", { now: new Date(now - 60 * H) });
      await addPhaseEvidence(tx, tile, wo.id, "prep", "flatness", { at: new Date(now - 58 * H).toISOString(), value: { text: "ok" } });
      await closeJobPhase(tx, tile, wo.id, "prep", { now: new Date(now - 58 * H) });
      await addPhaseEvidence(tx, tile, wo.id, "waterproofing", "membrane_photo", { at: new Date(now - 40 * H).toISOString(), value: { confirmed: true } });
      await closeJobPhase(tx, tile, wo.id, "waterproofing", { now: new Date(now - 40 * H) });
      return wo.id;
    });
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: crewEmail, password: "password12345", organizationId: orgId }), redirect: "manual" });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("the crew records the flood test, the photo and closes the phase, each at the phone's time", async () => {
    const p = `/api/work-orders/${jobId}/phases/flood_test`;
    const t1 = new Date(Date.now() - 2 * H).toISOString();
    const r1 = await call("POST", `${p}/evidence/flood_result`, { value: { depth_in: 2, hours: 24, passed: true }, at: t1 });
    expect(r1.status).toBe(200);

    // The installer has no office permission: the photo still goes in, in the same request.
    const photo = { data_url: PIXEL, client_upload_id: `up-${suffix}`, device_label: "iPhone" };
    const r2 = await call("POST", `${p}/evidence/water_line_photo`, { photo, at: new Date(Date.now() - 110 * 60_000).toISOString() });
    expect(r2.status).toBe(200);
    const ft = r2.json.data.phases.find((x: any) => x.key === "flood_test");
    expect(ft.requires.find((r: any) => r.key === "water_line_photo").photo?.url).toBeTruthy();
    // Sent twice (the phone lost the answer): same photo, not a second one.
    expect((await call("POST", `${p}/evidence/water_line_photo`, { photo })).status).toBe(200);
    const photos = await withTenantTransaction(orgId, (tx) => tx.jobMedia.count({ where: { workOrderId: jobId } }));
    expect(photos).toBe(1);

    const t3 = new Date(Date.now() - 100 * 60_000).toISOString();
    const r3 = await call("POST", `${p}/complete`, { at: t3 });
    expect(r3.status).toBe(200);
    const done = r3.json.data.phases.find((x: any) => x.key === "flood_test");
    expect(done.status).toBe("done");
    expect(done.done_at).toBe(t3);

    const row = await withTenantTransaction(orgId, (tx) => tx.jobPhase.findFirst({ where: { workOrderId: jobId, phaseKey: "flood_test" } }));
    const ev = row!.evidence as Record<string, any>;
    expect(ev.flood_result.at).toBe(t1);
    expect(ev.flood_result.offline).toBe(true);
    expect(ev.flood_result.receivedAt).toBeTruthy();
  });

  it("a resent 'Concluir' is refused (already done), so the phone can drop it", async () => {
    const r = await call("POST", `/api/work-orders/${jobId}/phases/flood_test/complete`, { at: new Date().toISOString() });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("already_done");
  });

  it("a backdated time doesn't skip a cure wait (grout waits 24 h after setting)", async () => {
    const p = `/api/work-orders/${jobId}/phases`;
    await call("POST", `${p}/setting/evidence/coverage_photo`, { photo: { data_url: PIXEL, client_upload_id: `cov-${suffix}` } });
    expect((await call("POST", `${p}/setting/complete`, {})).status).toBe(200);
    // Grout right after setting, claiming a time from two days ago: still waiting for the cure.
    const r = await call("POST", `${p}/grout/complete`, { at: new Date(Date.now() - 48 * H).toISOString() });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("waiting");
  });

  it("a quote invoice doesn't finish a tile job while phases are open", async () => {
    const out = await withTenantTransaction(orgId, (tx) => markWorkOrderCompletedForInvoice(tx, { organizationId: orgId, workOrderId: jobId, actorId: jobId, reason: "quote_invoice_issued" }));
    expect(out.completed).toBe(false);
    expect(out.openPhases).toBeGreaterThan(0);
    const wo = await withTenantTransaction(orgId, (tx) => tx.workOrder.findFirst({ where: { id: jobId }, select: { status: true } }));
    expect(wo?.status).toBe("in_progress");
  });
});
