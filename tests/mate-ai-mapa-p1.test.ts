import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
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

/**
 * Mate AI map, priority 1 (invoices, leads, calendar, jobs, customers): each action is prepared
 * from args (no AI), confirmed with its signed token and checked in the database.
 */
describe.skipIf(!privileged)("Mate AI map — priority 1 (tenant database required)", () => {
  const prisma = new PrismaClient();
  const sfx = Date.now().toString(36);
  const email = "mate-p1m-" + sfx + "@example.com";
  let server: Server;
  let base = "";
  let org = "";
  let cookie = "";
  const ids: Record<string, string> = {};
  const day = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const local = (d: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };

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
    const created = await createOrganizationWithAdmin({ organizationName: "Mate Map " + sfx, slug: "mate-map-" + sfx, adminName: "Doug", adminEmail: email, password: "password12345" });
    org = created.organization.id;
    await withTenantTransaction(org, async (tx) => {
      await tx.organization.update({ where: { id: org }, data: { timezone: "America/Denver" } });
      const john = await tx.customer.create({ data: { organizationId: org, name: "John Smith", email: "john@example.com", phone: "(303) 555-0101", customerType: "particular" } });
      ids.john = john.id;
      ids.mike = (await tx.customer.create({ data: { organizationId: org, name: "Mike Torres", customerType: "particular" } })).id;
      ids.dup = (await tx.customer.create({ data: { organizationId: org, name: "Mike Torres", email: "mike@torres.com", customerType: "particular" } })).id;
      await tx.quoteCatalogItem.create({ data: { organizationId: org, name: "Baseboard Installation", serviceType: "trim", unitType: "linear ft", unitPrice: 2.5, active: true } });
      ids.crew = (await tx.crew.create({ data: { organizationId: org, name: "Equipe Carlos" } })).id;
      const tomorrow = new Date(day(1) + "T15:00:00.000Z");
      const job = await tx.workOrder.create({
        data: {
          organizationId: org,
          number: 8100,
          title: "Living room hardwood",
          status: "scheduled",
          customerId: john.id,
          scheduledStart: tomorrow,
          scheduledEnd: new Date(tomorrow.getTime() + 8 * 3600e3),
          lineItems: { create: [{ organizationId: org, serviceName: "Hardwood Installation", quantitySqft: 500, unitPrice: 5, lineTotal: 2500 }] },
        },
      });
      ids.job = job.id;
      const inv = await tx.quoteInvoice.create({
        data: { organizationId: org, customerId: john.id, workOrderId: job.id, invoiceNumber: "INV-9001", invoiceType: "full", status: "sent", amount: 1200, dueDate: new Date(day(-20) + "T18:00:00.000Z"), issuedAt: new Date() },
      });
      ids.inv = inv.id;
      ids.inv2 = (await tx.quoteInvoice.create({ data: { organizationId: org, customerId: ids.mike, invoiceNumber: "INV-9002", invoiceType: "full", status: "sent", amount: 300, dueDate: new Date(day(10) + "T18:00:00.000Z"), issuedAt: new Date() } })).id;
      const old = new Date(Date.now() - 20 * 864e5);
      ids.ana = (await tx.lead.create({ data: { organizationId: org, name: "Ana Souza", phone: "(720) 555-0101", status: "new", source: "google", createdAt: old, updatedAt: old } })).id;
      ids.mark = (await tx.lead.create({ data: { organizationId: org, name: "Mark Lee", status: "new", source: "indicação" } })).id;
    });
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
    await new Promise<void>((r) => server?.close(() => r()));
    await prisma.$disconnect();
  });

  /* ───── invoices ───── */

  it("invoices: reminders list, due date + undo, link, void, payments", async () => {
    const remind = await act("invoice.remind", { min_days: 15 });
    expect(remind.json.type).toBe("card");
    const pick = remind.json.card.sections.find((s: { type: string }) => s.type === "pick");
    expect(pick.items.map((i: { id: string }) => i.id)).toEqual([ids.inv]);
    // Unchecking every item leaves nothing to send.
    const none = await post("/api/mate-ai/execute", { ...remind.json.card.confirm.exec.body, exclude: [ids.inv] });
    expect(none.status).toBe(400);
    // Test e-mail runs in console mode: the route's reason comes back.
    const sent = await post("/api/mate-ai/execute", remind.json.card.confirm.exec.body);
    expect(sent.status).toBe(502);
    expect(sent.json.error).toContain("console");

    const due = await run("invoice.due", { invoice: "INV-9001", due_date: day(30) });
    expect(due.exec.status).toBe(200);
    expect((await prisma.quoteInvoice.findUniqueOrThrow({ where: { id: ids.inv } })).dueDate?.toISOString().slice(0, 10)).toBe(day(30));
    expect((await post("/api/mate-ai/undo", { token: due.exec.json.undo_token })).status).toBe(200);
    expect((await prisma.quoteInvoice.findUniqueOrThrow({ where: { id: ids.inv } })).dueDate?.toISOString().slice(0, 10)).toBe(day(-20));

    const link = await run("invoice.link", { invoice_id: ids.inv });
    expect(link.exec.json.result.client).toMatchObject({ type: "copy" });

    const paid = await run("payment.record", { invoice_id: ids.inv, amount: 200, method: "zelle" });
    expect(paid.exec.status, JSON.stringify(paid.exec.json)).toBe(200);
    const blocked = await act("invoice.void", { invoice_id: ids.inv });
    expect(blocked.json.message).toContain("tem pagamentos");
    const rm = await run("payment.remove", { invoice: "INV-9001" });
    expect(rm.prep.card.confirm.checkbox).toContain("$200.00");
    expect(rm.exec.status).toBe(200);
    expect(await prisma.invoiceReceipt.count({ where: { invoiceId: ids.inv } })).toBe(0);
    expect(rm.exec.json.result.next).toMatchObject({ action: "payment.record" });

    const v = await run("invoice.void", { invoice: "INV-9002", reason: "emitida errada" });
    expect(v.exec.status).toBe(200);
    expect((await prisma.quoteInvoice.findUniqueOrThrow({ where: { id: ids.inv2 } })).status).toBe("void");
  });

  /* ───── leads ───── */

  it("leads: contact + follow-up, stale and new lists, qualification merge, convert", async () => {
    const log = await run("lead.log", { lead: "ana", type: "ligação", notes: "pediu orçamento", followup_date: day(3) });
    expect(log.exec.status, JSON.stringify(log.exec.json)).toBe(200);
    let meta = (await prisma.lead.findUniqueOrThrow({ where: { id: ids.ana } })).metadata as Record<string, any>;
    expect(meta.interactions[0]).toMatchObject({ type: "call", notes: "pediu orçamento" });
    expect(meta.followups[0]).toMatchObject({ due_date: day(3) });

    const fu = await run("lead.followup", { lead_id: ids.mark, due_date: day(1) });
    expect(fu.prep.card.title).toBe("Lembrete: Ligar para Mark");

    // Ana was contacted just now; Mark is new: nobody is stale for 7 days.
    const stale = await act("leads.stale", { days: 7 });
    expect(stale.json.card.title).toContain("Nenhum lead parado");
    const fresh = await act("leads.new", { period: "today" });
    expect(fresh.json.card.sections[0].items.map((i: { title: string }) => i.title)).toContain("Mark Lee");

    await run("lead.qualify", { lead_id: ids.ana, estimated_area: 900, estimated_budget: "8000" });
    const q2 = await run("lead.qualify", { lead_id: ids.ana, decision_timeline: "dezembro" });
    expect(q2.exec.status).toBe(200);
    meta = (await prisma.lead.findUniqueOrThrow({ where: { id: ids.ana } })).metadata as Record<string, any>;
    expect(meta.qualification).toMatchObject({ estimated_area: 900, estimated_budget: 8000, decision_timeline: "dezembro" });

    const conv = await run("lead.convert", { lead_id: ids.ana });
    expect(conv.exec.json.result.next).toMatchObject({ action: "quote.create" });
    expect(await prisma.customer.count({ where: { organizationId: org, leadId: ids.ana } })).toBe(1);
    const again = await act("lead.convert", { lead_id: ids.ana });
    expect(again.json.card.title).toBe("Ana Souza já é cliente");

    const coupon = await act("lead.coupon", { lead_id: ids.mark });
    expect(coupon.json.type).toBe("error");
  });

  /* ───── calendar ───── */

  it("calendar: create, move + undo, cancel, free time, move a day of jobs", async () => {
    const m = await run("meeting.create", { title: "Reunião de obra", customer: "John Smith", date: day(2), time: "14:00", location: "Escritório" });
    expect(m.exec.status, JSON.stringify(m.exec.json)).toBe(200);
    const row = await prisma.meeting.findFirstOrThrow({ where: { organizationId: org, title: "Reunião de obra" } });
    expect(local(row.scheduledStart)).toBe(day(2) + " 14:00");
    expect(row.customerId).toBe(ids.john);

    const mv = await run("meeting.move", { who: "john", new_date: day(4), new_time: "09:00" });
    expect(mv.exec.status).toBe(200);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: row.id } })).scheduledStart.toISOString().slice(0, 10)).toBe(day(4));
    expect((await post("/api/mate-ai/undo", { token: mv.exec.json.undo_token })).status).toBe(200);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: row.id } })).scheduledStart.toISOString()).toBe(row.scheduledStart.toISOString());

    const cancel = await run("meeting.cancel", { meeting_id: row.id });
    expect(cancel.exec.status).toBe(200);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("canceled");

    const free = await act("schedule.free", { date: day(1) });
    expect(free.json.card.sections[0].items[0].detail).toMatch(/^Livre: |Sem janela/);

    const moveDay = await act("jobs.reschedule", { date: day(1), new_date: day(3) });
    expect(moveDay.json.card.sections[0].items.map((i: { id: string }) => i.id)).toEqual([ids.job]);
    const moved = await post("/api/mate-ai/execute", moveDay.json.card.confirm.exec.body);
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    const job = await prisma.workOrder.findUniqueOrThrow({ where: { id: ids.job } });
    expect(local(job.scheduledStart!)).toBe(day(3) + " " + local(new Date(day(1) + "T15:00:00.000Z")).slice(11));
    expect((await post("/api/mate-ai/undo", { token: moved.json.undo_token })).status).toBe(200);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: ids.job } })).scheduledStart?.toISOString().slice(0, 10)).toBe(day(1));
  });

  /* ───── jobs ───── */

  it("jobs: no crew list, add services + undo, labor, temp worker, review", async () => {
    const nocrew = await act("jobs.nocrew", {});
    expect(nocrew.json.card.sections[0].items[0].run).toMatchObject({ action: "job.schedule", args: { job_id: ids.job } });

    const add = await run("job.add_service", { job: "8100", items: [{ service_text: "baseboard", quantity: 200, unit: "linear_ft" }] });
    expect(add.prep.card.sections[1].rows[1].value).toBe("$3,000.00");
    expect(add.exec.status, JSON.stringify(add.exec.json)).toBe(200);
    expect(await prisma.workOrderLineItem.count({ where: { workOrderId: ids.job } })).toBe(2);
    expect((await post("/api/mate-ai/undo", { token: add.exec.json.undo_token })).status).toBe(200);
    expect(await prisma.workOrderLineItem.count({ where: { workOrderId: ids.job } })).toBe(1);

    const labor = await act("job.labor", { job_id: ids.job });
    expect(labor.json.card.title).toBe("Mão de obra do job #8100 · Living room hardwood: $0.00");

    const temp = await run("job.temp", { job_id: ids.job, name: "pedro silva", phone: "720 555 0110" });
    expect(temp.exec.status).toBe(200);
    expect(temp.exec.json.result.client).toMatchObject({ type: "copy" });
    expect(await prisma.workOrderTempWorker.count({ where: { workOrderId: ids.job } })).toBe(1);

    const review = await act("job.review", { job_id: ids.job });
    expect(review.json.type).toBe("answer");
    expect(review.json.card.links.map((l: { label: string }) => l.label)).toEqual(["Abrir SMS", "WhatsApp", "E-mail"]);
  });

  /* ───── customers ───── */

  it("customers: update + undo, overview, address, referral link, duplicates and merge", async () => {
    const up = await run("customer.update", { customer: "John Smith", phone: "303 555 0199" });
    expect(up.prep.card.sections[0].rows[0]).toEqual(["Telefone", "(303) 555-0101", "(303) 555-0199"]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ids.john } })).phone).toBe("(303) 555-0199");
    await post("/api/mate-ai/undo", { token: up.exec.json.undo_token });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ids.john } })).phone).toBe("(303) 555-0101");

    const ov = await act("customer.overview", { customer_id: ids.john });
    expect(ov.json.card.title).toBe("John Smith");
    expect(ov.json.card.sections[1].rows.at(-1)).toMatchObject({ label: "Deve", value: "$1,200.00" });

    const addr = await run("customer.address", { customer_id: ids.john, line1: "45 Oak St", city: "Denver", state: "co", label: "Casa da praia" });
    expect(addr.exec.status).toBe(200);
    expect(await prisma.property.count({ where: { customerId: ids.john, line1: "45 Oak St" } })).toBe(1);

    const ref = await act("customer.referral", { customer_id: ids.john });
    expect(ref.json.type, JSON.stringify(ref.json)).toBe("answer");
    expect(ref.json.card.links.at(-1).href).toMatch(/\/r\//);

    const dups = await act("customers.duplicates", {});
    const merge = dups.json.card.sections[0].items.find((i: { title: string }) => i.title.includes("Mike Torres")).run;
    expect(merge.action).toBe("customer.merge");
    const mg = await run("customer.merge", merge.args);
    expect(mg.prep.card.confirm.checkbox).toContain("Apagar Mike Torres");
    expect(mg.exec.status).toBe(200);
    expect(await prisma.customer.count({ where: { organizationId: org, name: "Mike Torres" } })).toBe(1);
  });
});
