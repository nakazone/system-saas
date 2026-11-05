/**
 * Relatórios › Lucro › "Por job" (Tile, Countertops): what each job sold minus crew pay from approved
 * Folha days (a day on two jobs is split by sq ft), stone from the yard, remakes and costs posted on
 * the job. Only for people who see prices; Hardwood keeps its Lucro tab as it was.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { jobProfitReport } from "../src/lib/trades/job-profit.js";
import { getPack } from "../src/lib/trades/index.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("profit per job", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `jp${Date.now().toString(36)}`;
  let orgId = "";
  let woodOrg = "";
  const jobs = { a: "", b: "" };
  const cookies: Record<string, string> = {};
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  const ymd = day.toISOString().slice(0, 10);

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const a = await createOrganizationWithAdmin({ organizationName: `Profit ${suffix}`, slug: `profit-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    const w = await createOrganizationWithAdmin({ organizationName: `PWood ${suffix}`, slug: `pwood-${suffix}`, adminName: "Admin", adminEmail: `wadm-${suffix}@example.com`, password: "password12345" });
    orgId = a.organization.id;
    woodOrg = w.organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { tradePacks: ["countertops"] } });
    const admin = await prisma.user.findFirst({ where: { organizationId: orgId } });
    await withTenantTransaction(orgId, async (tx) => {
      const mk = async (n: number, title: string, total: number) => {
        const wo = await tx.workOrder.create({ data: { organizationId: orgId, number: n, title, status: "in_progress", scheduledStart: day, scheduledEnd: day } });
        await tx.workOrderLineItem.create({ data: { organizationId: orgId, workOrderId: wo.id, serviceName: "Countertop – Level 3", quantitySqft: 1, unitPrice: total, lineTotal: total } });
        return wo.id;
      };
      jobs.a = await mk(71, "Kitchen A", 5000);
      jobs.b = await mk(72, "Kitchen B", 2000);
      const emp = await tx.payrollEmployee.create({ data: { organizationId: orgId, name: "Luis", payType: "daily", sector: "installation", dailyRate: 300 } as never });
      // One approved day of $300 on both jobs: 30 sq ft on A, 10 on B → $225 / $75.
      const s = await tx.campoShift.create({ data: { organizationId: orgId, employeeId: emp.id, workDate: day, clockInAt: day, reviewStatus: "approved", amount: 300 } as never });
      await tx.campoShiftJob.create({ data: { organizationId: orgId, shiftId: s.id, workOrderId: jobs.a, sqft: 30 } });
      await tx.campoShiftJob.create({ data: { organizationId: orgId, shiftId: s.id, workOrderId: jobs.b, sqft: 10 } });
      // A day not yet approved does not count.
      const prev = new Date(day.getTime() - 86400_000);
      const p = await tx.campoShift.create({ data: { organizationId: orgId, employeeId: emp.id, workDate: prev, clockInAt: prev, reviewStatus: "pending", amount: 999 } as never });
      await tx.campoShiftJob.create({ data: { organizationId: orgId, shiftId: p.id, workOrderId: jobs.a, sqft: 1 } });
      await tx.slab.create({ data: { organizationId: orgId, material: "quartz", color: "Calacatta", lengthIn: 126, widthIn: 63, cost: 1450, status: "used", workOrderId: jobs.a, usedAt: day } });
      await tx.slab.create({ data: { organizationId: orgId, material: "quartz", color: "Spare", lengthIn: 126, widthIn: 63, cost: 900, status: "available" } });
      await tx.jobRework.create({ data: { organizationId: orgId, workOrderId: jobs.b, trade: "countertops", piece: "Ilha", reason: "transport", responsible: "shop", cost: 1800 } });
      await tx.financeCost.create({ data: { organizationId: orgId, description: "Sink", category: "materials", amount: 120, incurredOn: day, workOrderId: jobs.a, status: "posted" } as never });
      await tx.financeCost.create({ data: { organizationId: orgId, description: "Draft", category: "materials", amount: 500, incurredOn: day, workOrderId: jobs.a, status: "draft" } as never });
      void admin;
    });
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const [k, email, org] of [["tops", `adm-${suffix}@example.com`, orgId], ["wood", `wadm-${suffix}@example.com`, woodOrg]] as const) {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password12345", organizationId: org }), redirect: "manual" });
      cookies[k] = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    }
  });

  afterAll(async () => {
    server?.close();
    await prisma.$disconnect();
  });

  it("revenue minus crew, stone, remakes and posted costs, lowest margin first", async () => {
    const from = new Date(day.getTime() - 86400_000);
    const to = new Date(day.getTime() + 86400_000);
    const r = await withTenantTransaction(orgId, (tx) => jobProfitReport(tx, { from, to }, getPack("countertops")));
    expect(r).not.toBeNull();
    const a = r!.rows.find((x) => x.job_id === jobs.a)!;
    const b = r!.rows.find((x) => x.job_id === jobs.b)!;
    expect(a).toMatchObject({ revenue: 5000, labor: 225, stone: 1450, rework: 0, other: 120, cost: 1795, profit: 3205, margin: 64.1 });
    expect(b).toMatchObject({ revenue: 2000, labor: 75, stone: 0, rework: 1800, other: 0, cost: 1875, profit: 125, margin: 6.3 });
    expect(r!.rows[0]!.job_id).toBe(jobs.b);
    expect(r).toMatchObject({ jobs: 2, revenue: 7000, cost: 3670, profit: 3330, margin: 47.6 });
  });

  it("goes in the hub and the CSV; Hardwood has none", async () => {
    const hub = await fetch(`${base}/api/reports/hub?from=${ymd}&to=${ymd}`, { headers: { Cookie: cookies.tops! } });
    const h = (await hub.json()) as any;
    expect(h.data.job_profit.jobs).toBe(2);
    const csv = await fetch(`${base}/api/reports/job-profit?format=csv&from=${ymd}&to=${ymd}`, { headers: { Cookie: cookies.tops! } });
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text.split("\n")[0]).toContain("stone");
    expect(text).toContain("#72 · Kitchen B");
    const wood = await fetch(`${base}/api/reports/hub?from=${ymd}&to=${ymd}`, { headers: { Cookie: cookies.wood! } });
    expect(((await wood.json()) as any).data.job_profit).toBeNull();
    expect((await fetch(`${base}/api/reports/job-profit?from=${ymd}&to=${ymd}`, { headers: { Cookie: cookies.wood! } })).status).toBe(404);
  });
});
