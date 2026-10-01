import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient, Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import {
  computeDayMinutes,
  distanceM,
  expectedTimes,
  reviewFlags,
  wallTimeOn,
  workDateFor,
} from "../src/lib/payroll/day.js";
import { closeDay } from "../src/lib/payroll/day-service.js";

const TZ = "America/Denver";
const D = new Date(Date.UTC(2026, 9, 1)); // Thu 1 Oct 2026
const at = (hhmm: string) => wallTimeOn(D, hhmm, TZ);

describe("dia de trabalho — rules (pure)", () => {
  const sched = { scheduleStartMode: "job", scheduleStartTime: "07:00", scheduleEndTime: "17:00", lunchMinutes: 30, countEarlyStart: false };

  it("starts at the first scheduled job, ends at the default end (org timezone)", () => {
    const e = expectedTimes(D, sched, TZ, at("07:30"));
    expect(e.start.toISOString()).toBe("2026-10-01T13:30:00.000Z");
    expect(e.end.toISOString()).toBe("2026-10-01T23:00:00.000Z"); // 17:00 MDT
    const fixed = expectedTimes(D, { ...sched, scheduleStartMode: "fixed" }, TZ, at("09:00"));
    expect(fixed.start.toISOString()).toBe("2026-10-01T13:00:00.000Z");
    // A job on another day does not move the start.
    expect(expectedTimes(D, sched, TZ, new Date("2026-10-03T15:00:00Z")).start.toISOString()).toBe("2026-10-01T13:00:00.000Z");
  });

  it("counts overtime after 5pm in 15-minute steps and takes lunch out of long days", () => {
    const e = expectedTimes(D, sched, TZ, at("07:30"));
    const m = computeDayMinutes({ clockIn: at("07:25"), clockOut: at("18:10"), lunchMinutes: 30, expectedStart: e.start, expectedEnd: e.end, countEarlyStart: false });
    expect(m.workedMinutes).toBe(645 - 30);
    expect(m.overtimeMinutes).toBe(75); // 70 min → 75
    const early = computeDayMinutes({ clockIn: at("06:30"), clockOut: at("17:00"), lunchMinutes: 0, expectedStart: e.start, expectedEnd: e.end, countEarlyStart: true });
    expect(early.overtimeMinutes).toBe(60);
    const short = computeDayMinutes({ clockIn: at("08:00"), clockOut: at("11:00"), lunchMinutes: 30, expectedStart: e.start, expectedEnd: e.end, countEarlyStart: false });
    expect(short).toEqual({ workedMinutes: 180, overtimeMinutes: 0 });
  });

  it("knows the calendar day in the org timezone (late evening is still today)", () => {
    expect(workDateFor(new Date("2026-10-02T03:30:00Z"), TZ).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("flags what the office should look at", () => {
    const base = { source: "clock", requireGps: true, hasStartGps: true, hasEndGps: true, startDistanceM: 40, endDistanceM: 60, overtimeMinutes: 60, workedMinutes: 540, jobCount: 1, pastDay: false, missingPhotos: false, payType: "daily" };
    expect(reviewFlags(base)).toEqual([]);
    expect(reviewFlags({ ...base, endDistanceM: 2500, hasStartGps: false })).toEqual(["no_gps", "far_end"]);
    expect(reviewFlags({ ...base, source: "manual", pastDay: true, overtimeMinutes: 240 })).toEqual(["manual", "overtime_high", "past_day"]);
    expect(distanceM({ lat: 39.98, lng: -105.13 }, { lat: 39.981, lng: -105.13 })).toBeGreaterThan(100);
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("dia de trabalho — service + API", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  let userId = "";
  let employeeId = "";
  let jobId = "";
  const suffix = `pday${Date.now().toString(36)}`;
  const emails = { admin: `pd-a-${suffix}@example.com`, crew: `pd-c-${suffix}@example.com`, loose: `pd-x-${suffix}@example.com` };
  const HOUSE = { lat: 39.9778, lng: -105.1319 };

  async function login(email: string) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  async function call(cookie: string, method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    orgId = (await createOrganizationWithAdmin({ organizationName: `PD ${suffix}`, slug: `pd-${suffix}`, adminName: "Admin", adminEmail: emails.admin, password: "password12345" })).organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: TZ } });
    const passwordHash = await hashPassword("password12345");
    await withTenantTransaction(orgId, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: "crew_lead" } });
      userId = (await tx.user.create({ data: { organizationId: orgId, email: emails.crew, name: "Carlos Lima", passwordHash, roleId: role.id } })).id;
      await tx.user.create({ data: { organizationId: orgId, email: emails.loose, name: "Sem Folha", passwordHash, roleId: role.id } });
      employeeId = (
        await tx.payrollEmployee.create({
          data: { organizationId: orgId, userId, name: "Carlos Lima", email: emails.crew, payType: "daily", sector: "installation", dailyRate: 200, overtimeRate: 20, lunchMinutes: 30 },
        })
      ).id;
      jobId = (
        await tx.workOrder.create({
          data: {
            organizationId: orgId,
            number: 1,
            title: "Summit Lot 14",
            address: "14 Summit Way, Louisville CO",
            status: "scheduled",
            assignedUserId: userId,
            scheduledStart: at("07:30"),
            geoLat: new Prisma.Decimal(HOUSE.lat),
            geoLng: new Prisma.Decimal(HOUSE.lng),
          },
        })
      ).id;
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

  async function seedShift(workDate: Date, clockIn: Date, gps: { lat: number; lng: number } | null) {
    return withTenantTransaction(orgId, async (tx) => {
      const s = await tx.campoShift.create({
        data: {
          organizationId: orgId,
          userId,
          employeeId,
          workDate,
          clockInAt: clockIn,
          reviewStatus: "in_progress",
          clockInLat: gps ? new Prisma.Decimal(gps.lat) : null,
          clockInLng: gps ? new Prisma.Decimal(gps.lng) : null,
        },
      });
      await tx.campoShiftJob.create({ data: { organizationId: orgId, shiftId: s.id, workOrderId: jobId, arrivedAt: clockIn } });
      await tx.jobMedia.create({
        data: { organizationId: orgId, workOrderId: jobId, authorId: userId, type: "photo", storageKey: `k-${s.id}`, url: "https://x/p.jpg", sha256: "x", createdAt: new Date(clockIn.getTime() + 3600_000) },
      });
      return s;
    });
  }

  it("a normal day near the job is approved straight into the week's payroll, with overtime after 5pm", async () => {
    const s = await seedShift(D, at("07:25"), { lat: HOUSE.lat + 0.0005, lng: HOUSE.lng });
    const out = await withTenantTransaction(orgId, (tx) =>
      closeDay(tx, s.id, { clockOut: at("18:10"), gps: { ...HOUSE, accuracy: 12 }, deviceAt: null, note: "Terminei a sala", jobs: [{ workOrderId: jobId, sqft: 0 }], now: at("18:11") }, { tz: TZ, userId }),
    );
    expect(out.reviewStatus).toBe("approved");
    expect(out.overtimeMinutes).toBe(75);
    expect(Number(out.amount)).toBe(225); // 200 + 1.25h × $20
    expect(out.flags).toEqual([]);
    const line = await withTenantTransaction(orgId, (tx) => tx.payrollTimesheet.findFirstOrThrow({ where: { shiftId: s.id }, include: { period: true } }));
    expect(Number(line.calculatedAmount)).toBe(225);
    expect(Number(line.overtimeHours)).toBe(1.25);
    expect(line.sector).toBe("installation");
    expect(line.period.label).toBe("Semana 28/09/2026 – 04/10/2026");
  });

  it("finishing far from the job waits for the office", async () => {
    const d2 = new Date(Date.UTC(2026, 9, 2));
    const s = await seedShift(d2, wallTimeOn(d2, "07:30", TZ), { ...HOUSE });
    const out = await withTenantTransaction(orgId, (tx) =>
      closeDay(tx, s.id, { clockOut: wallTimeOn(d2, "16:45", TZ), gps: { lat: 40.1, lng: -105.3, accuracy: 10 }, deviceAt: null, note: null, jobs: [], now: wallTimeOn(d2, "16:46", TZ) }, { tz: TZ, userId }),
    );
    expect(out.reviewStatus).toBe("pending");
    expect(out.flags).toEqual(["far_end"]);
    expect(await withTenantTransaction(orgId, (tx) => tx.payrollTimesheet.count({ where: { shiftId: s.id } }))).toBe(0);
  });

  it("employee app: start, photos required to finish, manual day for a forgotten clock", async () => {
    const crew = await login(emails.crew);
    // Clean slate for "today" (real clock).
    const today = workDateFor(new Date(), TZ);
    await withTenantTransaction(orgId, async (tx) => {
      await tx.campoShift.deleteMany({ where: { userId, workDate: today } });
      await tx.jobMedia.deleteMany({ where: { authorId: userId } });
    });

    const state = await call(crew, "GET", "/api/campo/dia");
    expect(state.status).toBe(200);
    expect(state.json.data.linked).toBe(true);
    expect(state.json.data.employee.schedule.end_time).toBe("17:00");

    const started = await call(crew, "POST", "/api/campo/dia/start", { work_order_id: jobId, lat: HOUSE.lat, lng: HOUSE.lng, accuracy: 8 });
    expect(started.status, JSON.stringify(started.json)).toBe(201);
    expect(started.json.data.day.status).toBe("in_progress");
    expect(started.json.data.day.jobs[0].id).toBe(jobId);
    expect(started.json.data.day.gps_in.distance_m).toBeLessThan(50);
    expect((await call(crew, "POST", "/api/campo/dia/start", {})).json.code).toBe("DAY_EXISTS");

    // No photo of today yet (seeded photos belong to other days) → blocked.
    const blocked = await call(crew, "POST", "/api/campo/dia/finish", { note: "ok", lat: HOUSE.lat, lng: HOUSE.lng });
    expect(blocked.status).toBe(422);
    expect(blocked.json.code).toBe("PHOTOS_REQUIRED");
    expect(blocked.json.data.missing).toEqual([jobId]);

    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const up = await call(crew, "POST", `/api/campo/jobs/${jobId}/photos`, { data_url: png, stage: "during" });
    expect(up.status, JSON.stringify(up.json)).toBeLessThan(300);

    const done = await call(crew, "POST", "/api/campo/dia/finish", { note: "Rodapé falta", lat: HOUSE.lat, lng: HOUSE.lng, accuracy: 9 });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    const day = done.json.data.day;
    expect(day.status).toBe("pending"); // a few seconds of work → short day goes to the office
    expect(day.flags.map((f: { key: string }) => f.key)).toContain("short_day");
    expect(day.note).toBe("Rodapé falta");
    expect(day.jobs[0].photos_today).toBe(1);

    // Forgot to clock yesterday → manual day goes to review.
    const y = workDateFor(new Date(Date.now() - 86400000), TZ).toISOString().slice(0, 10);
    await withTenantTransaction(orgId, (tx) => tx.campoShift.deleteMany({ where: { userId, workDate: new Date(`${y}T00:00:00Z`) } }));
    const noPhoto = await call(crew, "POST", "/api/campo/dia/manual", { date: y, start: "07:30", end: "16:30", jobs: [{ work_order_id: jobId }] });
    expect(noPhoto.json.code, JSON.stringify(noPhoto)).toBe("PHOTOS_REQUIRED");
    await withTenantTransaction(orgId, (tx) => tx.payrollEmployee.update({ where: { id: employeeId }, data: { requirePhotos: false } }));
    const manual = await call(crew, "POST", "/api/campo/dia/manual", { date: y, start: "07:30", end: "16:30", jobs: [{ work_order_id: jobId }], note: "Esqueci" });
    expect(manual.status, JSON.stringify(manual.json)).toBe(200);
    const week = await call(crew, "GET", `/api/campo/dia/semana?week=${y}`);
    const yDay = week.json.data.days.find((d: { date: string }) => d.date === y);
    expect(yDay.status).toBe("pending");
    expect(yDay.flags.map((f: { key: string }) => f.key)).toContain("manual");
    expect(yDay.worked_minutes).toBe(540 - 30);

    const bad = await call(crew, "POST", "/api/campo/dia/manual", { date: "2099-01-01", start: "07:00", end: "17:00", jobs: [{ work_order_id: jobId }] });
    expect(bad.status).toBe(400);
  });

  it("a login without a payroll employee gets a clear message, not fake data", async () => {
    const loose = await login(emails.loose);
    const st = await call(loose, "GET", "/api/campo/dia");
    expect(st.json.data.linked).toBe(false);
    const r = await call(loose, "POST", "/api/campo/dia/start", {});
    expect(r.json.code).toBe("NOT_LINKED");
  });
});
