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
 * Mate AI map, priority 3: price table, ObraCam/ObraChat, reports, settings and the new routes
 * (daily brief, visit invite, job day summary, job margin).
 */
describe.skipIf(!privileged)("Mate AI map — priority 3 (tenant database required)", () => {
  const prisma = new PrismaClient();
  const sfx = Date.now().toString(36);
  const email = "mate-p3m-" + sfx + "@example.com";
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
    const created = await createOrganizationWithAdmin({ organizationName: "Mate Map3 " + sfx, slug: "mate-map3-" + sfx, adminName: "Doug", adminEmail: email, password: "password12345" });
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

  it("price table: create a service, adjust prices with undo, volume, supplier", async () => {
    const c = await run("pricing.create", { name: "Stair nosing", unit: "each", price: 35, category: "installation" });
    expect(c.exec.status, JSON.stringify(c.exec.json)).toBe(200);
    const adj = await act("pricing.adjust", { percent: 10 });
    expect(adj.json.type, JSON.stringify(adj.json)).toBe("card");
    const done = await post("/api/mate-ai/execute", adj.json.card.confirm.exec.body);
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    const vol = await act("pricing.volume", {});
    expect(vol.json.type, JSON.stringify(vol.json)).toBe("answer");
    const s = await run("supplier.create", { name: "Floor Depot " + sfx, phone: "303-555-0100" });
    expect(s.exec.status, JSON.stringify(s.exec.json)).toBe(200);
  });

  it("ObraCam and ObraChat: list photos, missing before photos, post to the job channel, mentions", async () => {
    const list = await act("media.list", { job: "8200" });
    expect(list.json.type, JSON.stringify(list.json)).toBe("answer");
    const miss = await act("media.missing_before", { days: 7 });
    expect(miss.json.type, JSON.stringify(miss.json)).toBe("answer");
    const p = await run("chat.post", { job: "8200", text: "Material chega amanhã às 8h" });
    expect(p.exec.status, JSON.stringify(p.exec.json)).toBe(200);
    const m = await act("chat.mentions", {});
    expect(m.json.type, JSON.stringify(m.json)).toBe("answer");
  });

  it("reports and settings: sales, funnel, earnings, invoice due days drives new invoices", async () => {
    for (const a of ["report.sales", "report.referrals", "report.funnel", "report.earnings"]) {
      const r = await act(a, {});
      expect(r.json.type, a + " " + JSON.stringify(r.json)).toBe("answer");
      expect(JSON.stringify(r.json.card), a).not.toMatch(/undefined|NaN/);
    }
    const due = await run("settings.invoice_due", { days: 15 });
    expect(due.exec.status, JSON.stringify(due.exec.json)).toBe(200);
    const s = await fetch(base + "/api/settings/invoices", { headers: { Cookie: cookie } }).then((r) => r.json() as Promise<any>);
    expect(JSON.stringify(s)).toContain('"default_due_days":15');
    const v = await run("settings.quote_validity", { days: 45 });
    expect(v.exec.status, JSON.stringify(v.exec.json)).toBe(200);
    const msg = await run("settings.lead_message", { stage: "new lead", text: "Oi {name}, obrigado pelo contato!" });
    expect(msg.exec.status, JSON.stringify(msg.exec.json)).toBe(200);
    const inv = await act("users.invite", { name: "Pedro", email: "pedro@example.com" });
    expect(inv.json.type).toBe("answer");
  });

  it("new routes: daily brief, visit invite, job day summary, job margin", async () => {
    const now = await act("brief.schedule", { now: true });
    expect(now.json.type, JSON.stringify(now.json)).toBe("answer");
    const on = await run("brief.schedule", { hour: 6, channels: "both" });
    expect(on.exec.status, JSON.stringify(on.exec.json)).toBe(200);
    const prefs = await fetch(base + "/api/mate-ai/brief", { headers: { Cookie: cookie } }).then((r) => r.json() as Promise<any>);
    expect(prefs.data.prefs).toMatchObject({ enabled: true, hour: 6, channels: ["push", "email"] });
    const { sendDueBriefs } = await import("../src/lib/mate-ai/daily-brief.js");
    const late = new Date();
    late.setUTCHours(23, 30, 0, 0); // 17:30 in Denver, past 6h
    const r1 = await sendDueBriefs(late);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const again = await sendDueBriefs(late);
    const mine = await prisma.systemSetting.findUniqueOrThrow({ where: { key: `mate_brief:${org}:${userId}` } });
    expect(JSON.parse(mine.value).last_sent).toBeTruthy();
    expect(again.sent).toBeLessThan(r1.sent + 1);

    const meet = await withTenantTransaction(org, (tx) =>
      tx.meeting.create({ data: { organizationId: org, title: "Visita Ana", customerId: ids.john, scheduledStart: new Date(Date.now() + 2 * 864e5), scheduledEnd: new Date(Date.now() + 2 * 864e5 + 3600e3) } }),
    );
    const vi = await act("visit.invite", { meeting_id: meet.id });
    expect(vi.json.type, JSON.stringify(vi.json)).toBe("card");
    expect(vi.json.card.sections[0].rows[0].value).toBe("john@example.com");
    const sent = await post("/api/mate-ai/execute", vi.json.card.confirm.exec.body);
    // Console e-mail mode in tests may refuse delivery; the route answers 200 or a clean 503.
    expect([200, 503]).toContain(sent.status);

    const sum = await act("chat.summary", { job: "8200" });
    expect(sum.json.type, JSON.stringify(sum.json)).toBe("answer");
    expect(sum.json.card.sections[0].text).toBeTruthy();

    await withTenantTransaction(org, (tx) => tx.financeCost.create({ data: { organizationId: org, description: "LVP boxes", amount: 600, category: "materials", incurredOn: new Date(), workOrderId: ids.job } }));
    const mg = await act("job.margin", { job: "8200" });
    expect(mg.json.type, JSON.stringify(mg.json)).toBe("answer");
    const rows = mg.json.card.sections[0].rows;
    expect(rows[0].value).toBe("$1,600.00");
    expect(rows[2].value).toBe("−$600.00");
  });
});
