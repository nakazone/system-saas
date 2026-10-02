import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("folha — painel do admin (HTTP)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  let installerUserId = "";
  let jobId = "";
  const suffix = `fadm${Date.now().toString(36)}`;
  const emails = { admin: `fa-a-${suffix}@example.com`, inst: `fa-i-${suffix}@example.com` };
  // Week of Mon 7 Sep 2026 (past, so nothing is "today").
  const MON = "2026-09-07";

  async function login(email: string): Promise<string> {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie.includes("=")) throw new Error(`login failed ${r.status}`);
    return cookie;
  }
  async function call(cookie: string, method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = r.headers.get("content-type") || "";
    return { status: r.status, type, text: type.includes("json") ? "" : await r.text(), json: (type.includes("json") ? await r.json() : {}) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `Folha ${suffix}`, slug: `fa-${suffix}`, adminName: "Admin", adminEmail: emails.admin, password: "password12345" });
    orgId = a.organization.id;
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "America/Denver" } });
    const passwordHash = await hashPassword("password12345");
    await withTenantTransaction(orgId, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: "installer" } });
      installerUserId = (await tx.user.create({ data: { organizationId: orgId, email: emails.inst, name: "Rafa", passwordHash, roleId: role.id } })).id;
      jobId = (await tx.workOrder.create({ data: { organizationId: orgId, number: 1, title: "Lot 14", status: "scheduled", address: "14 Summit Way" } })).id;
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

  it("cadastro com horário padrão, dias lançados, folha por setor, pagamento → Financeiro, estorno e relatório", async () => {
    const admin = await login(emails.admin);

    // Employees: one with login (installation), two without (sand), one production.
    const list = await call(admin, "GET", "/api/folha/funcionarios");
    expect(list.json.data.users.some((u: { id: string }) => u.id === installerUserId)).toBe(true);
    const mk = async (body: Record<string, unknown>) => {
      const r = await call(admin, "POST", "/api/folha/funcionarios", body);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      return r.json.data as { id: string; schedule: Record<string, unknown>; overtime_rate: number };
    };
    const rafa = await mk({ name: "Rafa", sector: "installation", pay_type: "daily", daily_rate: 200, user_id: installerUserId, payment_method: "zelle", schedule: { start_mode: "fixed", start_time: "07:00", end_time: "17:00", lunch_minutes: 0 } });
    expect(rafa.schedule).toMatchObject({ start_mode: "fixed", end_time: "17:00" });
    expect(rafa.overtime_rate).toBe(20); // 10% of the daily rate by default
    const marcos = await mk({ name: "Marcos", sector: "sand_finish", pay_type: "daily", daily_rate: 250 });
    const lucas = await mk({ name: "Lucas", sector: "sand_finish", pay_type: "daily", daily_rate: 180 });
    const pedro = await mk({ name: "Pedro", sector: "sand_finish", pay_type: "production", production_rate: 0.5 });
    // Same login can't be linked twice.
    expect((await call(admin, "POST", "/api/folha/funcionarios", { name: "Dup", user_id: installerUserId })).status).toBe(409);
    // Bad time format.
    expect((await call(admin, "PUT", `/api/folha/funcionarios/${marcos.id}`, { schedule: { end_time: "5pm" } })).status).toBe(400);

    // Office logs days — two employees without login on the same date must both work.
    const day = (employee_id: string, date: string, start: string, end: string, jobs: { work_order_id: string; sqft?: number }[] = [{ work_order_id: jobId }]) =>
      call(admin, "POST", "/api/folha/dias", { employee_id, date, start, end, jobs });
    expect((await day(rafa.id, MON, "07:00", "18:00")).status).toBe(201); // 1h extra
    expect((await day(rafa.id, "2026-09-08", "07:00", "17:00")).status).toBe(201);
    expect((await day(marcos.id, MON, "07:00", "17:00")).status).toBe(201);
    const l1 = await day(lucas.id, MON, "07:00", "17:00");
    expect(l1.status, JSON.stringify(l1.json)).toBe(201);
    expect((await day(pedro.id, MON, "07:00", "17:00", [{ work_order_id: jobId, sqft: 800 }])).status).toBe(201);
    // One day per employee per date.
    expect((await day(lucas.id, MON, "08:00", "16:00")).json.code).toBe("DAY_EXISTS");

    const week = await call(admin, "GET", `/api/folha/semana?week=${MON}`);
    expect(week.status).toBe(200);
    const w = week.json.data;
    const row = (id: string) => w.employees.find((e: { id: string }) => e.id === id);
    expect(row(rafa.id).totals).toMatchObject({ days: 2, overtime_minutes: 60, gross: 420, net: 420 }); // 200 + 20 + 200
    expect(row(pedro.id).totals).toMatchObject({ days: 1, sqft: 800, gross: 400 });
    expect(w.totals.installation.net).toBe(420);
    expect(w.totals.sand_finish.net).toBe(250 + 180 + 400);
    expect(w.totals.all.to_pay).toBe(420 + 830);

    // Reimbursement on Rafa, then pay Rafa + Marcos.
    expect((await call(admin, "PUT", `/api/folha/semana/${w.period.id}/ajustes/${rafa.id}`, { reimbursement: 30, discount: 10, notes: "gasolina / adiantamento" })).status).toBe(200);
    const pay = await call(admin, "POST", "/api/folha/pagamentos", { period_id: w.period.id, employee_ids: [rafa.id, marcos.id], paid_on: "2026-09-12", method: "zelle", reference: "ZL-1" });
    expect(pay.status, JSON.stringify(pay.json)).toBe(201);
    expect(pay.json.data.paid.map((p: { amount: number }) => p.amount).sort((a: number, b: number) => a - b)).toEqual([250, 440]);
    expect(pay.json.data.period_closed).toBe(false);

    // Finance gets one outflow per employee, in the payroll category with the sector.
    const outs = await withTenantTransaction(orgId, (tx) => tx.financePayrollAbatement.findMany({ where: { periodId: w.period.id, status: "paid" } }));
    expect(outs).toHaveLength(2);
    expect(outs.map((o) => o.sector).sort()).toEqual(["installation", "sand_finish"]);
    expect(outs.find((o) => o.employeeId === rafa.id)?.label).toContain("Instalação");

    // Paying again is skipped; editing a paid week is blocked.
    const again = await call(admin, "POST", "/api/folha/pagamentos", { period_id: w.period.id, employee_ids: [rafa.id], paid_on: "2026-09-12" });
    expect(again.json.data.skipped[0].reason).toBe("Já pago");
    const rafaDay = row(rafa.id).days[0].id;
    expect((await call(admin, "PUT", `/api/folha/dias/${rafaDay}`, { clock_out: "19:00" })).json.code).toBe("PAID");
    expect((await call(admin, "PUT", `/api/folha/semana/${w.period.id}/ajustes/${rafa.id}`, { reimbursement: 0, discount: 0 })).status).toBe(409);

    // Pay everyone left → week closes.
    const rest = await call(admin, "POST", "/api/folha/pagamentos", { period_id: w.period.id, employee_ids: [lucas.id, pedro.id], paid_on: "2026-09-12", method: "cash" });
    expect(rest.json.data.period_closed).toBe(true);
    // Void Lucas → Finance line voided, week open again.
    const lucasPay = await withTenantTransaction(orgId, (tx) => tx.payrollPayment.findFirstOrThrow({ where: { employeeId: lucas.id, status: "paid" } }));
    expect((await call(admin, "POST", `/api/folha/pagamentos/${lucasPay.id}/estornar`, {})).status).toBe(200);
    const after = await withTenantTransaction(orgId, async (tx) => ({
      ab: await tx.financePayrollAbatement.findFirstOrThrow({ where: { id: lucasPay.financeAbatementId! } }),
      period: await tx.payrollPeriod.findFirstOrThrow({ where: { id: w.period.id } }),
    }));
    expect(after.ab.status).toBe("void");
    expect(after.period.status).toBe("open");

    // Report: earned by work date, paid by pay date, per sector, CSV.
    const rep = await call(admin, "GET", "/api/folha/relatorio?from=2026-09-01&to=2026-09-30");
    expect(rep.json.data.totals.paid).toBe(440 + 250 + 400);
    expect(rep.json.data.totals.earned).toBe(420 + 830);
    const sand = await call(admin, "GET", "/api/folha/relatorio?from=2026-09-01&to=2026-09-30&sector=sand_finish");
    expect(sand.json.data.employees.map((e: { name: string }) => e.name).sort()).toEqual(["Lucas", "Marcos", "Pedro"]);
    const one = await call(admin, "GET", `/api/folha/relatorio?from=2026-01-01&to=2026-12-31&employee_id=${rafa.id}`);
    expect(one.json.data.employees).toHaveLength(1);
    expect(one.json.data.employees[0]).toMatchObject({ paid: 440, reimbursement: 30, discount: 10, net: 440 });
    expect(one.json.data.jobs[0]).toMatchObject({ id: jobId, cost: 420 });
    const csv = await call(admin, "GET", "/api/folha/relatorio?from=2026-09-01&to=2026-09-30&format=csv&kind=payments");
    expect(csv.type).toContain("text/csv");
    expect(csv.text).toContain("Data do pagamento");
    expect(csv.text).toContain("Rafa");
    expect(csv.text).toContain("Zelle");
  });

  it("conferência: aprova em lote, devolve com motivo e um dia pendente bloqueia o pagamento sem 'force'", async () => {
    const admin = await login(emails.admin);
    const emp = (await call(admin, "GET", "/api/folha/funcionarios")).json.data.employees.find((e: { name: string }) => e.name === "Rafa");
    const WED = "2026-09-16";
    // A day the employee sent that needs review (e.g. finished far from the job).
    const created = await call(admin, "POST", "/api/folha/dias", { employee_id: emp.id, date: WED, start: "07:00", end: "17:00", jobs: [{ work_order_id: jobId }] });
    const dayId = created.json.data.id as string;
    await withTenantTransaction(orgId, async (tx) => {
      await tx.payrollTimesheet.deleteMany({ where: { shiftId: dayId } });
      await tx.campoShift.update({ where: { id: dayId }, data: { reviewStatus: "pending", timesheetId: null, flags: ["far_end"] } });
    });
    const pend = await call(admin, "GET", "/api/folha/pendencias");
    expect(pend.json.data.pending.map((d: { id: string }) => d.id)).toContain(dayId);

    const wk = (await call(admin, "GET", `/api/folha/semana?week=${WED}`)).json.data;
    const blocked = await call(admin, "POST", "/api/folha/pagamentos", { period_id: wk.period.id, employee_ids: [emp.id], paid_on: "2026-09-19" });
    expect(blocked.json.data.paid).toHaveLength(0);
    expect(blocked.json.data.skipped[0].reason).toMatch(/conferência/);

    // Return with a reason → out of payroll, employee sees the reason.
    expect((await call(admin, "POST", `/api/folha/dias/${dayId}/devolver`, { reason: "x" })).status).toBe(400);
    const ret = await call(admin, "POST", `/api/folha/dias/${dayId}/devolver`, { reason: "Faltou a foto do job" });
    expect(ret.json.data).toMatchObject({ status: "returned", review_note: "Faltou a foto do job", in_payroll: false });

    // Back to pending, approve in batch → in payroll.
    await withTenantTransaction(orgId, (tx) => tx.campoShift.update({ where: { id: dayId }, data: { reviewStatus: "pending" } }));
    const batch = await call(admin, "POST", "/api/folha/dias/aprovar-lote", { ids: [dayId] });
    expect(batch.json.data.approved).toBe(1);
    const detail = await call(admin, "GET", `/api/folha/dias/${dayId}`);
    expect(detail.json.data).toMatchObject({ status: "approved", in_payroll: true, paid: false });
    expect(detail.json.data.reviewed_by).toBe("Admin");

    // Office edit recomputes overtime and keeps it approved.
    const ed = await call(admin, "PUT", `/api/folha/dias/${dayId}`, { clock_out: "18:30" });
    expect(ed.status, JSON.stringify(ed.json)).toBe(200);
    expect(ed.json.data).toMatchObject({ status: "approved", overtime_minutes: 90, amount: 230 });

    // Installer can't reach the admin API.
    const inst = await login(emails.inst);
    expect((await call(inst, "GET", `/api/folha/semana?week=${WED}`)).status).toBe(403);
  });

  it("lança várias diárias de uma vez e ignora datas que já existem", async () => {
    const admin = await login(emails.admin);
    const emp = (await call(admin, "GET", "/api/folha/funcionarios")).json.data.employees.find((e: { name: string }) => e.name === "Marcos");
    const dates = ["2026-09-21", "2026-09-22", "2026-09-23"]; // Mon–Wed
    // Seed one day that should be skipped as DAY_EXISTS.
    expect((await call(admin, "POST", "/api/folha/dias", { employee_id: emp.id, date: dates[0], start: "07:00", end: "17:00" })).status).toBe(201);
    const lote = await call(admin, "POST", "/api/folha/dias/lote", {
      employee_id: emp.id,
      dates,
      start: "07:00",
      end: "17:00",
      days_worked: 1,
    });
    expect(lote.status, JSON.stringify(lote.json)).toBe(201);
    expect(lote.json.data.created).toBe(2);
    expect(lote.json.data.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: dates[0], ok: false, code: "DAY_EXISTS" }),
        expect.objectContaining({ date: dates[1], ok: true }),
        expect.objectContaining({ date: dates[2], ok: true }),
      ]),
    );
  });
});
