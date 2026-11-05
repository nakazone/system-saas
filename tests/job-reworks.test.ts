/**
 * Countertops remakes: a piece made again is recorded on the job with the reason and who answers
 * for it. The crew records it on their jobs (no cost); the office sets the cost and removes
 * mistakes; trades without remakes refuse it; one company never sees another's (RLS).
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

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("remakes on a countertops job", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `rw${Date.now().toString(36)}`;
  const org = { tops: "", wood: "" };
  let job = "";
  let woodJob = "";
  const cookies: Record<string, string> = {};

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
    const a = await createOrganizationWithAdmin({ organizationName: `Tops ${suffix}`, slug: `tops-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    const w = await createOrganizationWithAdmin({ organizationName: `Wood ${suffix}`, slug: `wood-${suffix}`, adminName: "Admin", adminEmail: `wadm-${suffix}@example.com`, password: "password12345" });
    org.tops = a.organization.id;
    org.wood = w.organization.id;
    await prisma.organization.update({ where: { id: org.tops }, data: { tradePacks: ["countertops"] } });
    const role = await prisma.role.findFirst({ where: { organizationId: org.tops, key: "installer" } });
    const crew = await prisma.user.create({ data: { organizationId: org.tops, name: "Luis Ortega", email: `crew-${suffix}@example.com`, passwordHash: await hashPassword("password12345"), roleId: role!.id } as never });
    job = await withTenantTransaction(org.tops, async (tx) => (await tx.workOrder.create({ data: { organizationId: org.tops, number: 41, title: "Kitchen tops", status: "in_progress", assignedUserId: crew.id } })).id);
    woodJob = await withTenantTransaction(org.wood, async (tx) => (await tx.workOrder.create({ data: { organizationId: org.wood, number: 9, title: "Oak floor", status: "in_progress" } })).id);
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cookies.office = await login(`adm-${suffix}@example.com`, org.tops);
    cookies.crew = await login(`crew-${suffix}@example.com`, org.tops);
    // A crew member without office permission. The role sync on the first request after a server
    // start grants installers work_orders.manage today (projects.view counts as an office role):
    // let it run, then take the permission back.
    await fetch(`${base}/api/work-orders/${job}/phases`, { headers: { Cookie: cookies.office! } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role!.id, permission: { key: { in: ["work_orders.manage", "schedule.manage"] } } } });
    cookies.crew = await login(`crew-${suffix}@example.com`, org.tops);
    cookies.wood = await login(`wadm-${suffix}@example.com`, org.wood);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("the phases bring the pack's reasons and responsible parties", async () => {
    const r = await call("office", "GET", `/api/work-orders/${job}/phases`);
    expect(r.status).toBe(200);
    const rw = r.json.data.reworks;
    expect(rw.reasons.map((x: any) => x.key)).toEqual(["measure", "fabrication", "transport", "install", "material", "change", "other"]);
    expect(rw.responsible.map((x: any) => x.key)).toContain("installer");
    expect(rw.items).toEqual([]);
  });

  it("the crew records a broken top; a cost sent by the crew is ignored", async () => {
    const r = await call("crew", "POST", `/api/work-orders/${job}/reworks`, { piece: "Island", reason: "transport", responsible: "installer", phase_key: "install", cost: 999, notes: "Cracked at the sink cutout" });
    expect(r.status).toBe(200);
    const it0 = r.json.data.reworks.items[0];
    expect(it0).toMatchObject({ piece: "Island", reason_label: "Quebrou no transporte", responsible_label: "Equipe de instalação", phase_label: "Instalação", by: "Luis Ortega", cost: null });
    expect(r.json.data.reworks.total_cost).toBeNull(); // the crew doesn't see costs
    const row = await withTenantTransaction(org.tops, (tx) => tx.jobRework.findFirst({ where: { workOrderId: job } }));
    expect(row?.cost).toBeNull();
    // Unknown reason or responsible are refused.
    expect((await call("crew", "POST", `/api/work-orders/${job}/reworks`, { piece: "X", reason: "aliens", responsible: "shop" })).status).toBe(400);
    // The crew can't remove it.
    expect((await call("crew", "DELETE", `/api/work-orders/${job}/reworks/${it0.id}`)).status).toBe(403);
  });

  it("the office sets the cost, sees the total and removes a mistake", async () => {
    const list = (await call("office", "GET", `/api/work-orders/${job}/phases`)).json.data.reworks.items;
    const r = await call("office", "PATCH", `/api/work-orders/${job}/reworks/${list[0].id}`, { cost: 1850 });
    expect(r.status).toBe(200);
    expect(r.json.data.reworks.total_cost).toBe(1850);
    const r2 = await call("office", "POST", `/api/work-orders/${job}/reworks`, { piece: "Vanity", reason: "measure", responsible: "templater", cost: 420.5 });
    expect(r2.json.data.reworks.total_cost).toBe(2270.5);
    const mistake = r2.json.data.reworks.items[1].id;
    const r3 = await call("office", "DELETE", `/api/work-orders/${job}/reworks/${mistake}`);
    expect(r3.json.data.reworks.items).toHaveLength(1);
  });

  it("a photo of the damaged piece goes to the job's ObraCam and shows on the record", async () => {
    const PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
    const photo = { data_url: PIXEL, client_upload_id: `rwph-${suffix}`, device_label: "iPhone" };
    const r = await call("crew", "POST", `/api/work-orders/${job}/reworks`, { piece: "Sink wall", reason: "material", responsible: "supplier", photo });
    expect(r.status).toBe(200);
    const item = r.json.data.reworks.items.find((x: any) => x.piece === "Sink wall");
    expect(item.photo?.url).toBeTruthy();
    const media = await withTenantTransaction(org.tops, (tx) => tx.jobMedia.count({ where: { workOrderId: job } }));
    expect(media).toBe(1);
    // A bad file is refused before anything is saved.
    expect((await call("crew", "POST", `/api/work-orders/${job}/reworks`, { piece: "X", reason: "other", responsible: "other", photo: { data_url: "data:text/plain;base64,aGk=" } })).status).toBe(400);
    await withTenantTransaction(org.tops, (tx) => tx.jobRework.deleteMany({ where: { id: item.id } }));
  });

  it("Relatórios: remakes of the period by reason and responsible, cost for the office, CSV", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const hub = await call("office", "GET", `/api/reports/hub?from=${today}&to=${today}`);
    expect(hub.status).toBe(200);
    const rw = hub.json.data.reworks;
    expect(rw).toMatchObject({ count: 1, jobs: 1, cost: 1850 });
    expect(rw.by_reason).toEqual([{ key: "transport", label: "Quebrou no transporte", count: 1, cost: 1850 }]);
    expect(rw.by_responsible[0]).toMatchObject({ key: "installer", count: 1 });
    expect(rw.recent[0]).toMatchObject({ job: "#41 · Kitchen tops", piece: "Island", cost: 1850 });
    const csv = await fetch(`${base}/api/reports/reworks?format=csv&from=${today}&to=${today}`, { headers: { Cookie: cookies.office! } });
    const text = await csv.text();
    expect(csv.status).toBe(200);
    expect(text).toContain("date,job,piece,reason,responsible,phase,cost,notes,recorded_by");
    expect(text).toContain("Quebrou no transporte");
    // A hardwood company has no remakes report.
    const wood = await call("wood", "GET", `/api/reports/hub?from=${today}&to=${today}`);
    expect(wood.json.data.reworks).toBeNull();
    expect((await call("wood", "GET", `/api/reports/reworks?from=${today}&to=${today}`)).status).toBe(404);
  });

  it("a hardwood company has no remakes", async () => {
    const r = await call("wood", "GET", `/api/work-orders/${woodJob}/phases`);
    expect(r.json.data.reworks).toBeNull();
    expect((await call("wood", "POST", `/api/work-orders/${woodJob}/reworks`, { piece: "Board", reason: "other", responsible: "other" })).status).toBe(409);
  });

  it("one company never sees the other's remakes (RLS), nor reaches its job", async () => {
    const leaked = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${org.wood}', true)`);
      return tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "JobRework" WHERE "organizationId" = '${org.tops}'`);
    });
    expect(Number(leaked[0]!.n)).toBe(0);
    expect(await prisma.jobRework.count({ where: { organizationId: org.tops } })).toBe(1);
    expect((await call("wood", "POST", `/api/work-orders/${job}/reworks`, { piece: "Island", reason: "other", responsible: "other" })).status).toBe(404);
    expect((await call("wood", "DELETE", `/api/work-orders/${job}/reworks/x`)).status).toBe(404);
  });
});
