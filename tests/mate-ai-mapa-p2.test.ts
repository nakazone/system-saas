import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user")
  .then((rows) => Boolean((rows as Array<{ ok: boolean }>)[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

/** 1×1 JPEG, enough for the photo paths. */
const PHOTO =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

/**
 * Mate AI map, priority 2: field app, crew pay, quotes, cash flow and the dashboard. Actions are
 * prepared from args, confirmed with their signed token and checked in the database; the photo
 * path goes through the AI route with a stub model.
 */
describe.skipIf(!privileged)("Mate AI map — priority 2 (tenant database required)", () => {
  const prisma = new PrismaClient();
  const sfx = Date.now().toString(36);
  const email = "mate-p2m-" + sfx + "@example.com";
  let server: Server;
  let ai: Server;
  let base = "";
  let org = "";
  let cookie = "";
  let userId = "";
  const ids: Record<string, string> = {};
  let nextPick: Record<string, unknown> = { action: "none" };
  const saved = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL };

  async function post(path: string, body: unknown) {
    const r = await fetch(base + path, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  }
  const act = (action: string, args: Record<string, unknown>, patch?: Record<string, unknown>) => post("/api/mate-ai/act", { action, args, patch });
  async function run(action: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const prep = await act(action, args);
    expect(prep.json.type, JSON.stringify(prep.json)).toBe("card");
    const exec = await post("/api/mate-ai/execute", { ...prep.json.card.confirm.exec.body, ...extra });
    return { prep: prep.json, exec };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const created = await createOrganizationWithAdmin({ organizationName: "Mate Map2 " + sfx, slug: "mate-map2-" + sfx, adminName: "Doug", adminEmail: email, password: "password12345" });
    org = created.organization.id;
    userId = created.admin.id;
    await withTenantTransaction(org, async (tx) => {
      await tx.organization.update({ where: { id: org }, data: { timezone: "America/Denver" } });
      const john = await tx.customer.create({ data: { organizationId: org, name: "John Smith", email: "john@example.com", customerType: "particular" } });
      ids.john = john.id;
      const now = new Date();
      const job = await tx.workOrder.create({
        data: { organizationId: org, number: 8200, title: "Kitchen LVP", status: "scheduled", customerId: john.id, assignedUserId: userId, scheduledStart: new Date(now.getTime() - 3600e3), scheduledEnd: new Date(now.getTime() + 6 * 3600e3), lineItems: { create: [{ organizationId: org, serviceName: "LVP Installation", quantitySqft: 400, unitPrice: 4, lineTotal: 1600 }] } },
      });
      ids.job = job.id;
      ids.emp = (await tx.payrollEmployee.create({ data: { organizationId: org, name: "Doug Crew", userId, email, dailyRate: 200, status: "active", requirePhotos: false } })).id;
      ids.carlos = (await tx.payrollEmployee.create({ data: { organizationId: org, name: "Carlos Lima", dailyRate: 250, status: "active", email: "carlos@example.com" } })).id;
      const q = await tx.quote.create({ data: { organizationId: org, number: 3001, quoteNumber: "Q-3001", title: "John Smith", status: "sent", customerId: john.id, total: 5000, subtotal: 5000, payload: { email_sent_at: new Date().toISOString() } } });
      ids.quote = q.id;
      ids.quote2 = (await tx.quote.create({ data: { organizationId: org, number: 3002, quoteNumber: "Q-3002", title: "John Smith", status: "sent", customerId: john.id, total: 800, subtotal: 800 } })).id;
      ids.draft = (await tx.quote.create({ data: { organizationId: org, number: 3003, quoteNumber: "Q-3003", title: "John Smith", status: "draft", customerId: john.id, total: 100, subtotal: 100 } })).id;
      ids.fq = (await tx.fieldQuote.create({ data: { organizationId: org, clientName: "Ana Souza", address: "9 Elm St", totalSqft: 640, total: 3200 } })).id;
      await tx.quoteInvoice.create({ data: { organizationId: org, customerId: john.id, invoiceNumber: "INV-8001", invoiceType: "full", status: "sent", amount: 900, dueDate: new Date(Date.now() - 5 * 864e5), issuedAt: new Date() } });
    });

    ai = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const call = nextPick.action === "none" ? { name: "reply", arguments: { message: "ok" } } : { name: "propose_action", arguments: { action: nextPick.action, args: nextPick.args || {} } };
        res.setHeader("Content-Type", "application/json");
        if (Array.isArray(body.tools)) {
          res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } }], usage: {} }));
        } else res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...nextPick, reply: null }) } }], usage: {} }));
      });
    });
    await new Promise<void>((r) => ai.listen(0, () => r()));
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:" + (ai.address() as AddressInfo).port;

    const app = createApp();
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password12345", organizationId: org }), redirect: "manual" });
    const h = r.headers as Headers & { getSetCookie?: () => string[] };
    cookie = (h.getSetCookie?.() ?? [r.headers.get("set-cookie") || ""]).flatMap((v) => v.split(/,\s*(?=[^;,]+=)/)).map((v) => v.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
    if (saved.url === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = saved.url;
    await new Promise<void>((r) => server?.close(() => r()));
    await new Promise<void>((r) => ai?.close(() => r()));
    await prisma.$disconnect();
  });

  it("field app: start the day with location, next job, measure, checklist, expense with photo, problem, finish, week", async () => {
    const start = await run("campo.arrive", { job: "8200" }, { geo: { lat: 39.74, lng: -104.99, accuracy: 12 } });
    expect(start.prep.card.confirm.geo).toBe(true);
    expect(start.exec.status, JSON.stringify(start.exec.json)).toBe(200);
    const shift = await prisma.campoShift.findFirstOrThrow({ where: { organizationId: org, userId } });
    expect(Number(shift.clockInLat)).toBeCloseTo(39.74);

    const next = await act("campo.next", {});
    expect(next.json.type).toBe("answer");

    const m = await run("campo.measure", { job: "8200", label: "Sala", length_ft: 18, width_ft: 22 });
    expect(m.prep.card.sections[0].rows[1].value).toBe("18 × 22 ft = 396 sq ft");
    expect(m.exec.status, JSON.stringify(m.exec.json)).toBe(200);
    expect(Number((await prisma.jobMeasurement.findFirstOrThrow({ where: { workOrderId: ids.job } })).value)).toBe(396);

    const ck = await act("campo.checklist", { job: "8200", item: "zzzz" });
    expect(ck.json.type).toBe("clarify");
    const first = ck.json.clarify.options[0];
    const tick = await post("/api/mate-ai/act", { action: "campo.checklist", args: ck.json.args, patch: first.patch });
    const done = await post("/api/mate-ai/execute", tick.json.card.confirm.exec.body);
    expect(done.status, JSON.stringify(done.json)).toBe(200);

    // Expense with a photo: the photo travels with the AI request and the action picks it up.
    nextPick = { action: "campo.expense", args: { amount: 40, description: "gasolina" } };
    const ex = await post("/api/mate-ai/act", { text: "gastei 40 de gasolina", attachment: PHOTO });
    expect(ex.json.type, JSON.stringify(ex.json)).toBe("card");
    expect(ex.json.args.photo_id).toBeTruthy();
    expect(ex.json.card.sections[0].rows[2].value).toBe("foto anexada");
    const exDone = await post("/api/mate-ai/execute", ex.json.card.confirm.exec.body);
    expect(exDone.status, JSON.stringify(exDone.json)).toBe(200);
    const exp = await prisma.campoShiftExpense.findFirstOrThrow({ where: { shiftId: shift.id } });
    expect([Number(exp.amount), exp.description, Boolean(exp.receiptUrl)]).toEqual([40, "gasolina", true]);

    const prob = await run("campo.problem", { job: "8200", note: "contrapiso úmido" });
    expect(prob.exec.status, JSON.stringify(prob.exec.json)).toBe(200);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: ids.job } })).campoProblemNote).toContain("contrapiso úmido");

    const fin = await run("campo.finish", { sqft: 300 }, { geo: { lat: 39.74, lng: -104.99, accuracy: 10 } });
    expect(fin.prep.card.sections[0].rows[0].value).toBe("300 sq ft");
    expect(fin.prep.card.sections[1].text).toContain("Sem foto de hoje em: #8200");
    expect(fin.exec.status, JSON.stringify(fin.exec.json)).toBe(200);
    expect(fin.exec.json.result.next).toMatchObject({ action: "campo.week" });
    expect((await prisma.campoShift.findUniqueOrThrow({ where: { id: shift.id } })).clockOutAt).not.toBeNull();

    const week = await run("campo.week", {});
    expect(week.exec.status, JSON.stringify(week.exec.json)).toBe(200);
  });

  it("crew pay: pending + approve, expenses, week, log a day, pay, conference", async () => {
    const pend = await act("folha.pending", {});
    expect(pend.json.type).toBe("answer");
    const ap = await act("folha.approve", {});
    if (ap.json.type === "card") {
      const ok = await post("/api/mate-ai/execute", ap.json.card.confirm.exec.body);
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    }
    const ex = await act("folha.expense", { employee: "Doug", decision: "approve" });
    if (ex.json.type === "card") {
      const ok = await post("/api/mate-ai/execute", ex.json.card.confirm.exec.body);
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    }

    const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const logged = await run("folha.day", { employee: "carlos", date: day, jobs: [{ job: "8200", sqft: 120 }] });
    expect(logged.exec.status, JSON.stringify(logged.exec.json)).toBe(200);
    expect(await prisma.campoShift.count({ where: { organizationId: org, employeeId: ids.carlos } })).toBe(1);

    const wk = await act("folha.week", { week: day });
    expect(wk.json.card.title).toMatch(/^Folha .+ a pagar$/);

    const pay = await run("folha.pay", { employee: "Carlos", method: "zelle", week: day });
    expect(pay.exec.status, JSON.stringify(pay.exec.json)).toBe(200);
    expect(await prisma.payrollPayment.count({ where: { employeeId: ids.carlos, status: "paid" } })).toBe(1);
    const again = await act("folha.pay", { employee: "Carlos", week: day });
    expect(again.json.message).toContain("já foi pago");

    const conf = await act("folha.conference", { employee: "Carlos", week: day });
    expect(conf.json.card.confirm.checkbox).toBe("Enviar para carlos@example.com");
  });

  it("quotes: duplicate, PDF, discounted copy, archive, did they open it, field quote", async () => {
    const dup = await run("quote.duplicate", { quote: "Q-3001", title: "John Smith — beach house" });
    expect(dup.exec.status, JSON.stringify(dup.exec.json)).toBe(200);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: dup.exec.json.result.entity.id } })).title).toBe("John Smith — beach house");

    const eng = await act("quote.engagement", { quote: "Q-3001" });
    expect(eng.json.card.title).toBe("Ainda não abriu");

    const dc = await act("quote.discount_copy", { quote: "Q-3001" });
    expect(dc.json.type).toBe("clarify");
    const five = await post("/api/mate-ai/act", { action: "quote.discount_copy", args: dc.json.args, patch: dc.json.clarify.options[0].patch });
    expect(five.json.card.sections[0].rows.at(-1).value).toBe("$4,750.00");
    const made = await post("/api/mate-ai/execute", five.json.card.confirm.exec.body);
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    expect(made.json.result.client).toMatchObject({ type: "copy" });

    expect((await act("quotes.archive", { quote: "Q-3003" })).json.message).toContain("rascunho não se arquiva");
    const arch = await act("quotes.archive", { quote: "Q-3002", reason: "cliente desistiu" });
    const archived = await post("/api/mate-ai/execute", arch.json.card.confirm.exec.body);
    expect(archived.status, JSON.stringify(archived.json)).toBe(200);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: ids.quote2 } })).status).toBe("archived");

    const fq = await act("fieldquote.open", { client: "ana" });
    expect(fq.json.card.links[0].href).toBe("field-quote.html?id=" + ids.fq);
  });

  it("money: cost on a job, cash flow, receivables, week, month vs month", async () => {
    const cost = await run("finance.cost", { amount: 340, vendor: "Home Depot", description: "cola e rodapé", job: "8200" });
    expect(cost.prep.card.subtitle).toBe("Job #8200 · Kitchen LVP");
    expect(cost.exec.status, JSON.stringify(cost.exec.json)).toBe(200);
    const row = await prisma.financeCost.findFirstOrThrow({ where: { organizationId: org } });
    expect([Number(row.amount), row.workOrderId, row.category]).toEqual([340, ids.job, "materials"]);

    const cf = await act("finance.cashflow", {});
    expect(cf.json.card.sections[0].rows[1]).toMatchObject({ label: "Custos lançados", value: "$340.00" });
    const rec = await act("finance.receivables", {});
    expect(rec.json.card.subtitle).toContain("$900.00 já vencido");
    const wk = await act("dashboard.week", {});
    expect(wk.json.card.sections[0].rows.at(-1)).toMatchObject({ label: "Clientes devem", value: "$900.00" });
    const cmp = await act("dashboard.compare", {});
    expect(cmp.json.card.sections[0].rows[0][0]).toBe("Faturado");
  });
});
