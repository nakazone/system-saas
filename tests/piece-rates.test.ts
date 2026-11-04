/**
 * Production pay by item (Tile): company rates with per-employee exceptions, quantities per job at
 * the end of the day, the rates copied into the day and its payroll line. Hardwood stays SF × rate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient, Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { wallTimeOn } from "../src/lib/payroll/day.js";
import { closeDay } from "../src/lib/payroll/day-service.js";
import { calcTimesheetLineAmount } from "../src/crm/lib/payroll-calc.js";
import { normalizePieces, pieceItemsFor, priceDay, ratesFor } from "../src/lib/payroll/piece-rates.js";
import { getPack } from "../src/lib/trades/index.js";

const tileItems = getPack("tile").payroll!.pieceItems;

describe("production by item — rules", () => {
  it("only Tile has items; Hardwood keeps SF × one rate", () => {
    expect(pieceItemsFor(["hardwood"])).toEqual([]);
    expect(pieceItemsFor(undefined)).toEqual([]);
    expect(pieceItemsFor(["tile"]).map((i) => i.key)).toEqual(["floor_sf", "wall_sf", "mosaic_sf", "waterproofing_sf", "demo_sf", "shower_pan", "niche", "bench", "trim_lf", "stone_seal_sf"]);
    for (const it of tileItems) expect(it.label["pt-BR"] && it.label["en-US"]).toBeTruthy();
  });

  it("the employee's own rate wins over the company rate; no rate is 0", () => {
    const rows = [
      { employeeId: null, itemKey: "floor_sf", rate: "2.50" },
      { employeeId: null, itemKey: "niche", rate: 85 },
      { employeeId: "e1", itemKey: "floor_sf", rate: 3 },
      { employeeId: "e2", itemKey: "niche", rate: 100 },
    ];
    const r = ratesFor(tileItems, rows, "e1");
    expect(r.find((x) => x.key === "floor_sf")).toMatchObject({ company: 2.5, employee: 3, rate: 3 });
    expect(r.find((x) => x.key === "niche")).toMatchObject({ company: 85, employee: null, rate: 85 });
    expect(r.find((x) => x.key === "bench")).toMatchObject({ company: 0, employee: null, rate: 0 });
    expect(ratesFor(tileItems, rows, null).find((x) => x.key === "floor_sf")!.rate).toBe(2.5);
  });

  it("quantities: unknown items and negatives are dropped, units are whole for 'each'", () => {
    expect(normalizePieces(tileItems, { floor_sf: "120.456", niche: 1.6, wax: 5, wall_sf: -3, bench: 0 })).toEqual({ floor_sf: 120.46, niche: 2 });
    expect(normalizePieces(tileItems, null)).toEqual({});
  });

  it("a day adds every job per item; square feet count floor, walls and mosaic only", () => {
    const rates = ratesFor(tileItems, [
      { employeeId: null, itemKey: "floor_sf", rate: 2 },
      { employeeId: null, itemKey: "wall_sf", rate: 3 },
      { employeeId: null, itemKey: "niche", rate: 80 },
      { employeeId: null, itemKey: "waterproofing_sf", rate: 1 },
    ], null);
    const day = priceDay(tileItems, rates, [{ pieces: { floor_sf: 60, wall_sf: 40 } }, { pieces: { floor_sf: 40, niche: 1, waterproofing_sf: 50 } }]);
    expect(day.lines.map((l) => [l.key, l.qty, l.amount])).toEqual([
      ["floor_sf", 100, 200],
      ["wall_sf", 40, 120],
      ["waterproofing_sf", 50, 50],
      ["niche", 1, 80],
    ]);
    expect(day.amount).toBe(450);
    expect(day.sqft).toBe(140);
  });

  it("payroll line: items pay their saved amounts; without items production is still SF × rate", () => {
    const emp = { payType: "production", productionRate: 1.75, dailyRate: 200 };
    expect(calcTimesheetLineAmount(emp, { sqft: 100, pieces: [{ amount: 200 }, { qty: 2, rate: 40 }] })).toBe(280);
    expect(calcTimesheetLineAmount(emp, { sqft: 100 })).toBe(175);
    expect(calcTimesheetLineAmount(emp, { sqft: 100, pieces: [] })).toBe(175);
    expect(calcTimesheetLineAmount({ payType: "daily", dailyRate: 200 }, { daysWorked: 1, pieces: [{ amount: 999 }] })).toBe(200);
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("production by item — rates API, a Tile day into payroll", () => {
  const prisma = new PrismaClient();
  const TZ = "America/Denver";
  const D = new Date(Date.UTC(2026, 9, 6)); // Tue 6 Oct 2026
  const at = (hhmm: string) => wallTimeOn(D, hhmm, TZ);
  const HOUSE = { lat: 39.9778, lng: -105.1319 };
  const suffix = `pr${Date.now().toString(36)}`;
  let server: Server;
  let base = "";
  const orgs: Record<"tile" | "wood", { id: string; email: string; cookie: string; emp: string; user: string; job: string }> = {} as never;

  async function call(who: "tile" | "wood", method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, { method, headers: { Cookie: orgs[who].cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    for (const who of ["tile", "wood"] as const) {
      const email = `${who}-${suffix}@example.com`;
      const a = await createOrganizationWithAdmin({ organizationName: `${who} ${suffix}`, slug: `${who}-${suffix}`, adminName: "Admin", adminEmail: email, password: "password12345" });
      const id = a.organization.id;
      await prisma.organization.update({ where: { id }, data: { timezone: TZ, tradePacks: [who === "tile" ? "tile" : "hardwood"] } });
      const { emp, job } = await withTenantTransaction(id, async (tx) => {
        const e = await tx.payrollEmployee.create({ data: { organizationId: id, userId: a.admin.id, name: "Rafa Setter", payType: "production", productionRate: 1.75, requirePhotos: false, requireGps: false } });
        const j = await tx.workOrder.create({ data: { organizationId: id, number: 7, title: "Master bath", status: "scheduled", assignedUserId: a.admin.id, scheduledStart: at("07:30"), geoLat: new Prisma.Decimal(HOUSE.lat), geoLng: new Prisma.Decimal(HOUSE.lng) } });
        return { emp: e.id, job: j.id };
      });
      orgs[who] = { id, email, cookie: "", emp, user: a.admin.id, job };
    }
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const who of ["tile", "wood"] as const) {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: orgs[who].email, password: "password12345", organizationId: orgs[who].id }), redirect: "manual" });
      orgs[who].cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.organization.deleteMany({ where: { id: { in: Object.values(orgs).map((o) => o.id) } } });
    await prisma.$disconnect();
  });

  async function seedShift(who: "tile" | "wood") {
    const o = orgs[who];
    return withTenantTransaction(o.id, async (tx) => {
      const s = await tx.campoShift.create({ data: { organizationId: o.id, userId: o.user, employeeId: o.emp, workDate: D, clockInAt: at("07:30"), reviewStatus: "in_progress", clockInLat: new Prisma.Decimal(HOUSE.lat), clockInLng: new Prisma.Decimal(HOUSE.lng) } });
      await tx.campoShiftJob.create({ data: { organizationId: o.id, shiftId: s.id, workOrderId: o.job, arrivedAt: at("07:30") } });
      return s;
    });
  }

  it("company rates and one employee's exception", async () => {
    const empty = await call("tile", "GET", "/api/payroll/piece-rates");
    expect(empty.json.data.enabled).toBe(true);
    expect(empty.json.data.items).toHaveLength(tileItems.length);

    const put = await call("tile", "PUT", "/api/payroll/piece-rates", { rates: { floor_sf: 2.5, wall_sf: 3.25, niche: 85, shower_pan: 150 } });
    expect(put.status).toBe(200);
    expect(put.json.data.items.find((i: any) => i.key === "wall_sf")).toMatchObject({ company: 3.25, rate: 3.25 });

    const own = await call("tile", "PUT", "/api/payroll/piece-rates", { employee_id: orgs.tile.emp, rates: { floor_sf: 3 } });
    expect(own.json.data.items.find((i: any) => i.key === "floor_sf")).toMatchObject({ company: 2.5, employee: 3, rate: 3 });
    expect(own.json.data.items.find((i: any) => i.key === "niche")).toMatchObject({ employee: null, rate: 85 });

    // Back to the company rate, then set again for the day below.
    const back = await call("tile", "PUT", "/api/payroll/piece-rates", { employee_id: orgs.tile.emp, rates: { floor_sf: null } });
    expect(back.json.data.items.find((i: any) => i.key === "floor_sf")).toMatchObject({ employee: null, rate: 2.5 });
    await call("tile", "PUT", "/api/payroll/piece-rates", { employee_id: orgs.tile.emp, rates: { floor_sf: 3 } });

    expect((await call("tile", "PUT", "/api/payroll/piece-rates", { rates: { floor_sf: -1 } })).status).toBe(400);
    expect((await call("tile", "PUT", "/api/payroll/piece-rates", { employee_id: orgs.wood.emp, rates: { floor_sf: 1 } })).status).toBe(404);
  });

  it("Hardwood has no items and can't save them", async () => {
    const r = await call("wood", "GET", "/api/payroll/piece-rates");
    expect(r.json.data).toMatchObject({ enabled: false, items: [] });
    expect((await call("wood", "PUT", "/api/payroll/piece-rates", { rates: { floor_sf: 2 } })).status).toBe(409);
  });

  it("field app: a Tile production employee gets the items with their rates", async () => {
    const r = await call("tile", "GET", "/api/campo/dia");
    expect(r.status).toBe(200);
    expect(r.json.data.piece_items.map((i: any) => [i.key, i.rate])).toContainEqual(["floor_sf", 3]);
    expect(r.json.data.piece_units).toMatchObject({ sf: "sq ft", lf: "LF", each: "un." });
    expect((await call("wood", "GET", "/api/campo/dia")).json.data.piece_items).toEqual([]);
  });

  it("a Tile day pays items × rates, keeps the rates used, and a later rate change doesn't touch it", async () => {
    const o = orgs.tile;
    const s = await seedShift("tile");
    const out = await withTenantTransaction(o.id, (tx) =>
      closeDay(tx, s.id, { clockOut: at("16:30"), gps: { ...HOUSE, accuracy: 10 }, deviceAt: null, note: null, jobs: [{ workOrderId: o.job, sqft: 0, pieces: { floor_sf: 80, wall_sf: 40, niche: 1, wax: 9 } }], now: at("16:31") }, { tz: TZ, userId: o.user }),
    );
    // 80 × $3 (own rate) + 40 × $3.25 + 1 × $85
    expect(Number(out.amount)).toBe(455);
    expect(Number(out.sqft)).toBe(120);
    expect(out.pieces).toEqual([
      { key: "floor_sf", label: "Piso", unit: "sf", qty: 80, rate: 3, amount: 240 },
      { key: "wall_sf", label: "Parede / box", unit: "sf", qty: 40, rate: 3.25, amount: 130 },
      { key: "niche", label: "Nicho", unit: "each", qty: 1, rate: 85, amount: 85 },
    ]);
    const job = await withTenantTransaction(o.id, (tx) => tx.campoShiftJob.findFirstOrThrow({ where: { shiftId: s.id } }));
    expect(job.pieces).toEqual({ floor_sf: 80, wall_sf: 40, niche: 1 });
    expect(Number(job.sqft)).toBe(120);

    // Approved straight into the week's payroll with the same items.
    expect(out.reviewStatus).toBe("approved");
    const line = await withTenantTransaction(o.id, (tx) => tx.payrollTimesheet.findFirstOrThrow({ where: { shiftId: s.id } }));
    expect(Number(line.calculatedAmount)).toBe(455);
    expect(line.pieces).toEqual(out.pieces);

    // The office raises the wall rate: the day already counted stays the same.
    await call("tile", "PUT", "/api/payroll/piece-rates", { rates: { wall_sf: 4 } });
    const again = await withTenantTransaction(o.id, (tx) => tx.campoShift.findUniqueOrThrow({ where: { id: s.id } }));
    expect(Number(again.amount)).toBe(455);
  });

  it("finishing a Tile production day asks for the items, not square feet", async () => {
    await withTenantTransaction(orgs.tile.id, (tx) => tx.campoShift.deleteMany({ where: { employeeId: orgs.tile.emp } }));
    const start = await call("tile", "POST", "/api/campo/dia/start", { work_order_id: orgs.tile.job });
    expect(start.status).toBeLessThan(300);
    const none = await call("tile", "POST", "/api/campo/dia/finish", { jobs: [{ work_order_id: orgs.tile.job, sqft: 100 }] });
    expect(none.status).toBe(422);
    expect(none.json.code).toBe("PIECES_REQUIRED");
    const ok = await call("tile", "POST", "/api/campo/dia/finish", { jobs: [{ work_order_id: orgs.tile.job, pieces: { shower_pan: 1, trim_lf: 12 } }] });
    expect(ok.status).toBe(200);
  });

  it("a Hardwood production day is still square feet × the production rate", async () => {
    const o = orgs.wood;
    const s = await seedShift("wood");
    const out = await withTenantTransaction(o.id, (tx) =>
      closeDay(tx, s.id, { clockOut: at("16:30"), gps: { ...HOUSE, accuracy: 10 }, deviceAt: null, note: null, jobs: [{ workOrderId: o.job, sqft: 200, pieces: { floor_sf: 999 } }], now: at("16:31") }, { tz: TZ, userId: o.user }),
    );
    expect(Number(out.amount)).toBe(350);
    expect(Number(out.sqft)).toBe(200);
    expect(out.pieces).toBeNull();
  });

  it("one company never sees the other's rates (RLS)", async () => {
    const leaked = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${orgs.wood.id}', true)`);
      return tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "PieceRate" WHERE "organizationId" = '${orgs.tile.id}'`);
    });
    expect(Number(leaked[0]!.n)).toBe(0);
    const own = await prisma.pieceRate.count({ where: { organizationId: orgs.tile.id } });
    expect(own).toBeGreaterThan(0);
  });
});
