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
 * Central do Mate: catalog by module, conversations saved per user (tokens stripped), and what
 * the Mate did (confirmed actions with a link).
 */
describe.skipIf(!privileged)("Mate AI — central (tenant database required)", () => {
  const prisma = new PrismaClient();
  const sfx = Date.now().toString(36);
  const email = "mate-cen-" + sfx + "@example.com";
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
    const created = await createOrganizationWithAdmin({ organizationName: "Mate Central " + sfx, slug: "mate-cen-" + sfx, adminName: "Doug", adminEmail: email, password: "password12345" });
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

  const get = async (path: string, c = cookie) => {
    const r = await fetch(base + path, { headers: { Cookie: c } });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  };
  const put = async (path: string, body: unknown, c = cookie) => {
    const r = await fetch(base + path, { method: "PUT", headers: { Cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  };

  it("catalog lists Portuguese examples by module, only for allowed actions", async () => {
    const r = await get("/api/mate-ai/catalog");
    expect(r.status).toBe(200);
    const mods = r.json.data.modules as Array<{ key: string; label: string; items: Array<{ text: string; action: string }> }>;
    expect(mods.length).toBeGreaterThan(8);
    expect(mods[0]!.key).toBe("inicio");
    const all = mods.flatMap((m) => m.items);
    expect(all.some((i) => i.action === "quote.create")).toBe(true);
    expect(all.filter((i) => /^(Log|Send|Show|What|Margin on)\b/.test(i.text)).map((i) => i.text)).toEqual([]);
    expect(mods.find((m) => m.key === "calendario")!.items.some((i) => i.action === "jobs.reschedule")).toBe(true);
  });

  it("conversations: saved without tokens, listed, searched, opened, and private to the user", async () => {
    const id = "6f1c2b9e-0d4a-4c1e-9a77-3b2f1e0c9d11";
    const items = [
      { id: "a", role: "user", text: "quote pro John, 1350 pés" },
      { id: "b", kind: "card", action: "quote.create", at: Date.now(), card: { title: "Criar Quote para John Smith", confirm: { label: "Criar", exec: { endpoint: "/api/mate-ai/execute", body: { token: "SECRET-TOKEN" } } } } },
      { id: "c", kind: "done", result: { title: "Quote Q-1001 criado", detail: "John Smith" }, undo: { token: "UNDO-SECRET", expires: new Date().toISOString() } },
    ];
    const s = await put("/api/mate-ai/conversations/" + id, { items });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    const row = await prisma.mateAiConversation.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(row.items)).not.toContain("SECRET");
    expect(row.outcome).toBe("Quote Q-1001 criado");

    const list = await get("/api/mate-ai/conversations");
    expect(list.json.data[0]).toMatchObject({ id, title: "quote pro John, 1350 pés", outcome: "Quote Q-1001 criado", turns: 1 });
    expect((await get("/api/mate-ai/conversations?q=JOHN")).json.data).toHaveLength(1);
    expect((await get("/api/mate-ai/conversations?q=carpete")).json.data).toHaveLength(0);
    const one = await get("/api/mate-ai/conversations/" + id);
    expect(one.json.data.items[1].stale).toBe(true);

    // Another company neither sees it nor changes it.
    const em2 = "mate-cen2-" + sfx + "@example.com";
    const o2 = await createOrganizationWithAdmin({ organizationName: "Other " + sfx, slug: "mate-cen2-" + sfx, adminName: "Other", adminEmail: em2, password: "password12345" });
    const lr = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em2, password: "password12345", organizationId: o2.organization.id }), redirect: "manual" });
    const h2 = lr.headers as Headers & { getSetCookie?: () => string[] };
    const c2 = (h2.getSetCookie?.() ?? [lr.headers.get("set-cookie") || ""]).flatMap((v) => v.split(/,\s*(?=[^;,]+=)/)).map((v) => v.split(";")[0]).join("; ");
    expect((await get("/api/mate-ai/conversations", c2)).json.data).toHaveLength(0);
    expect((await get("/api/mate-ai/conversations/" + id, c2)).status).toBe(404);
    await put("/api/mate-ai/conversations/" + id, { items: [{ role: "user", text: "hijack" }] }, c2);
    expect((await prisma.mateAiConversation.findUniqueOrThrow({ where: { id } })).title).toBe("quote pro John, 1350 pés");
    const d = await fetch(base + "/api/mate-ai/conversations/" + id, { method: "DELETE", headers: { Cookie: cookie } });
    expect(d.status).toBe(200);
    expect(await prisma.mateAiConversation.count({ where: { id } })).toBe(0);
  });

  it("activity: a confirmed action shows up with its title and a link to open it", async () => {
    const prep = await post("/api/mate-ai/act", { action: "customer.create", args: { name: "Ana Souza", phone: "720 555 0101" } });
    expect(prep.json.type, JSON.stringify(prep.json)).toBe("card");
    const exec = await post("/api/mate-ai/execute", prep.json.card.confirm.exec.body);
    expect(exec.status, JSON.stringify(exec.json)).toBe(200);
    const a = await get("/api/mate-ai/activity?days=1");
    expect(a.status).toBe(200);
    const row = (a.json.data as Array<any>).find((x) => x.action === "customer.create");
    expect(row, JSON.stringify(a.json.data)).toBeTruthy();
    expect(row.module).toBe("Clientes");
    expect(row.title).toMatch(/Ana Souza/);
  });
});
