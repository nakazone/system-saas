/**
 * Countertops slab yard: enter a slab, find what fits a piece, reserve it for a job (one job at a
 * time), use it, bring the leftover back as a remnant. The crew reads without cost and cannot
 * change; trades without slabs get 404; one company never sees another's slabs (RLS).
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
import { parseFits, slabFits, slabSf, yardSummary } from "../src/lib/trades/slabs.js";

describe("slab rules", () => {
  it("square feet, fit either way, the L×W filter", () => {
    expect(slabSf(126, 63)).toBe(55.1);
    expect(slabFits({ lengthIn: 60, widthIn: 30 }, 26, 55)).toBe(true);
    expect(slabFits({ lengthIn: 60, widthIn: 30 }, 61, 20)).toBe(false);
    expect(slabFits({ lengthIn: 60, widthIn: 30 }, 40, 31)).toBe(false);
    expect(parseFits("48 x 22")).toEqual([48, 22]);
    expect(parseFits("48×22.5")).toEqual([48, 22.5]);
    expect(parseFits("abc")).toBeNull();
  });

  it("the yard summary counts free slabs, free remnants and held ones", () => {
    const s = yardSummary([
      { kind: "slab", status: "available", lengthIn: 126, widthIn: 63 },
      { kind: "slab", status: "reserved", lengthIn: 126, widthIn: 63 },
      { kind: "remnant", status: "available", lengthIn: 48, widthIn: 24 },
      { kind: "slab", status: "used", lengthIn: 126, widthIn: 63 },
    ]);
    expect(s.available_slabs).toEqual({ n: 1, sf: 55.1 });
    expect(s.available_remnants).toEqual({ n: 1, sf: 8 });
    expect(s.reserved.n).toBe(1);
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("slab yard API", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `sl${Date.now().toString(36)}`;
  const org = { tops: "", wood: "" };
  const jobs = { a: "", b: "" };
  const cookies: Record<string, string> = {};
  let slab = "";

  const login = async (email: string, organizationId: string) => {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password12345", organizationId }), redirect: "manual" });
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  };
  const call = async (who: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { Cookie: cookies[who]!, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  };

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const a = await createOrganizationWithAdmin({ organizationName: `Yard ${suffix}`, slug: `yard-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    const w = await createOrganizationWithAdmin({ organizationName: `Wood ${suffix}`, slug: `wyard-${suffix}`, adminName: "Admin", adminEmail: `wadm-${suffix}@example.com`, password: "password12345" });
    org.tops = a.organization.id;
    org.wood = w.organization.id;
    await prisma.organization.update({ where: { id: org.tops }, data: { tradePacks: ["countertops"] } });
    const role = await prisma.role.findFirst({ where: { organizationId: org.tops, key: "installer" } });
    await prisma.user.create({ data: { organizationId: org.tops, name: "Luis", email: `crew-${suffix}@example.com`, passwordHash: await hashPassword("password12345"), roleId: role!.id } as never });
    await withTenantTransaction(org.tops, async (tx) => {
      jobs.a = (await tx.workOrder.create({ data: { organizationId: org.tops, number: 51, title: "Kitchen A", status: "scheduled" } })).id;
      jobs.b = (await tx.workOrder.create({ data: { organizationId: org.tops, number: 52, title: "Kitchen B", status: "scheduled" } })).id;
    });
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cookies.office = await login(`adm-${suffix}@example.com`, org.tops);
    cookies.crew = await login(`crew-${suffix}@example.com`, org.tops);
    cookies.wood = await login(`wadm-${suffix}@example.com`, org.wood);
    // The role sync on the first request may give installers office permission; take it back.
    await call("crew", "GET", "/api/auth/session");
    const manage = await prisma.permission.findUnique({ where: { key: "work_orders.manage" } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role!.id, permissionId: manage!.id } });
  });

  afterAll(async () => {
    server?.close();
    await prisma.$disconnect();
  });

  it("the office enters a slab; bad sizes are refused", async () => {
    const bad = await call("office", "POST", "/api/slabs", { material: "quartz", color: "Calacatta Laza", length_in: 0, width_in: 63 });
    expect(bad.status).toBe(400);
    const r = await call("office", "POST", "/api/slabs", { material: "quartz", color: "Calacatta Laza", brand: "MSI", thickness_cm: 3, length_in: 126, width_in: 63, serial: "LOT 4471-07", location: "Rack A3", cost: 1450 });
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ kind: "slab", status: "available", sq_ft: 55.1, cost: 1450, material_label: "Quartzo" });
    slab = r.json.data.id;
    await call("office", "POST", "/api/slabs", { kind: "remnant", material: "granite", color: "Black Pearl", length_in: 50, width_in: 26 });
  });

  it("filters by what fits a piece, and by text", async () => {
    const fits = await call("office", "GET", "/api/slabs?fits=48x24");
    expect(fits.json.data.items.map((s: any) => s.color).sort()).toEqual(["Black Pearl", "Calacatta Laza"]);
    const big = await call("office", "GET", "/api/slabs?fits=100x30");
    expect(big.json.data.items.map((s: any) => s.color)).toEqual(["Calacatta Laza"]);
    const q = await call("office", "GET", "/api/slabs?q=4471");
    expect(q.json.data.items).toHaveLength(1);
    expect(q.json.data.summary.available_slabs.n).toBe(1);
    expect(q.json.data.summary.available_remnants.n).toBe(1);
  });

  it("reserves for one job at a time, releases, uses", async () => {
    const r = await call("office", "POST", `/api/slabs/${slab}/reserve`, { job_id: jobs.a });
    expect(r.json.data).toMatchObject({ status: "reserved", job: { id: jobs.a, number: 51 } });
    const other = await call("office", "POST", `/api/slabs/${slab}/reserve`, { job_id: jobs.b });
    expect(other.status).toBe(409);
    const onJob = await call("office", "GET", `/api/work-orders/${jobs.a}/slabs`);
    expect(onJob.json.data.items.map((s: any) => s.id)).toEqual([slab]);
    const wrongUse = await call("office", "POST", `/api/slabs/${slab}/use`, { job_id: jobs.b });
    expect(wrongUse.status).toBe(409);
    const used = await call("office", "POST", `/api/slabs/${slab}/use`, {});
    expect(used.json.data).toMatchObject({ status: "used", job: { id: jobs.a } });
    // used slabs leave the default yard list but stay on the job
    const yard = await call("office", "GET", "/api/slabs");
    expect(yard.json.data.items.map((s: any) => s.id)).not.toContain(slab);
    const log = await prisma.activityEvent.findMany({ where: { entityId: jobs.a, action: { startsWith: "slab." } }, orderBy: { createdAt: "asc" } });
    expect(log.map((e) => e.action)).toEqual(["slab.reserved", "slab.used"]);
    expect((await call("office", "DELETE", `/api/slabs/${slab}`)).status).toBe(409);
  });

  it("the leftover comes back as a remnant of the same stone, never bigger than the slab", async () => {
    const tooBig = await call("office", "POST", `/api/slabs/${slab}/remnant`, { length_in: 130, width_in: 20 });
    expect(tooBig.status).toBe(400);
    const r = await call("office", "POST", `/api/slabs/${slab}/remnant`, { length_in: 40, width_in: 63, location: "Remnant rack" });
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ kind: "remnant", color: "Calacatta Laza", serial: "LOT 4471-07", parent_id: slab, status: "available", location: "Remnant rack", thickness_cm: 3 });
  });

  it("the crew reads without the cost and cannot change anything", async () => {
    const r = await call("crew", "GET", "/api/slabs");
    expect(r.status).toBe(200);
    expect(r.json.data.can_manage).toBe(false);
    expect(r.json.data.items.every((s: any) => !("cost" in s))).toBe(true);
    expect((await call("crew", "POST", "/api/slabs", { material: "quartz", color: "X", length_in: 10, width_in: 10 })).status).toBe(403);
  });

  it("a hardwood company has no yard, and RLS keeps companies apart", async () => {
    expect((await call("wood", "GET", "/api/slabs")).status).toBe(404);
    expect((await call("wood", "POST", `/api/slabs/${slab}/release`)).status).toBe(404);
    const seen = await withTenantTransaction(org.wood, (tx) => tx.slab.findMany({ where: {} }));
    expect(seen).toHaveLength(0);
  });
});
