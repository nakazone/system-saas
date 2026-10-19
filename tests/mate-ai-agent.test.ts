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

/**
 * End-to-end Mate AI agent flow with a stub OpenAI-compatible server standing in for the model:
 * natural-language quote (typo'd customer, "pés de madeira"), tap-to-pick customer, and a
 * job invoice with a due date — preview, confirm, replay protection and stale detection.
 */
describe.skipIf(!privileged)("Mate AI agent (tenant database required)", () => {
  const prisma = new PrismaClient();
  const suffix = Date.now().toString(36);
  const email = "mate-agent-" + suffix + "@example.com";
  let server: Server;
  let aiServer: Server;
  let base = "";
  let orgId = "";
  let cookie = "";
  let jobId = "";
  let jobNumber = 0;
  const seenPrompts: string[] = [];
  const saved = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL };

  /** Plays the model: reads the catalog refs from the system prompt like the real model would. */
  function fakeModel(system: string, user: string): Record<string, unknown> {
    const ref = (name: string) => system.split("\n").find((line) => line.includes("| " + name + " |"))?.split(" | ")[0] ?? null;
    if (/quote/i.test(user) && /jon/i.test(user)) {
      return {
        action: "quote",
        customer: "Jon Smith " + suffix,
        items: [{ service_ref: ref("Agent Hardwood Installation"), service_text: "instalação de madeira", quantity: "1.350", unit: "pés" }],
        job: "",
        invoice_type: null,
        deposit_pct: null,
        amount: null,
        due_date: null,
        question: null,
      };
    }
    if (/quote/i.test(user) && /mike/i.test(user)) {
      return { action: "quote", customer: "Mike", items: [{ service_ref: null, service_text: "piso de madeira", quantity: 200, unit: "sq_ft" }] };
    }
    if (/invoice|fatura/i.test(user)) {
      return { action: "invoice", customer: "", job: "job " + jobNumber, invoice_type: "deposit", deposit_pct: 30, amount: null, due_date: "2026-10-30" };
    }
    return { action: "unknown", question: "Não entendi." };
  }

  async function login(): Promise<string> {
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") || ""];
    return values
      .flatMap((value) => value.split(/,\s*(?=[^;,]+=)/))
      .map((value) => value.split(";")[0])
      .join("; ");
  }

  async function post(path: string, body: unknown) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: { key: permission.key, group: permission.group, description: permission.description },
        update: {},
      });
    }
    const created = await createOrganizationWithAdmin({
      organizationName: "Mate Agent " + suffix,
      slug: "mate-agent-" + suffix,
      adminName: "Mate Agent Admin",
      adminEmail: email,
      password: "password12345",
    });
    orgId = created.organization.id;

    await withTenantTransaction(orgId, async (tx) => {
      const john = await tx.customer.create({ data: { organizationId: orgId, name: "John Smith " + suffix, customerType: "particular" } });
      await tx.customer.create({ data: { organizationId: orgId, name: "Mike Johnson " + suffix, customerType: "particular" } });
      await tx.customer.create({ data: { organizationId: orgId, name: "Mike Torres " + suffix, customerType: "particular" } });
      await tx.quoteCatalogItem.create({
        data: { organizationId: orgId, name: "Agent Hardwood Installation", serviceType: "installation", unitType: "sq ft", unitPrice: 4.5, active: true },
      });
      await tx.quoteCatalogItem.create({
        data: { organizationId: orgId, name: "Agent Carpet Removal", serviceType: "removal", unitType: "sq ft", unitPrice: 1, active: true },
      });
      const job = await tx.workOrder.create({
        data: {
          organizationId: orgId,
          number: 4100 + Math.floor(Math.random() * 500),
          title: "Kitchen hardwood",
          status: "completed",
          customerId: john.id,
          lineItems: {
            create: [{ organizationId: orgId, serviceName: "Hardwood Installation", quantitySqft: 1000, unitPrice: 5, lineTotal: 5000 }],
          },
        },
      });
      jobId = job.id;
      jobNumber = job.number!;
    });

    aiServer = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const system = String(body.messages?.[0]?.content || "");
        const user = String(body.messages?.[1]?.content || "");
        seenPrompts.push(system);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fakeModel(system, user)) } }], usage: {} }));
      });
    });
    await new Promise<void>((resolve) => aiServer.listen(0, () => resolve()));
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:" + (aiServer.address() as AddressInfo).port;

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    cookie = await login();
  });

  afterAll(async () => {
    process.env.OPENAI_API_KEY = saved.key;
    process.env.OPENAI_BASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    if (saved.url === undefined) delete process.env.OPENAI_BASE_URL;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await new Promise<void>((resolve) => aiServer?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("understands a spoken-style quote and resolves a misspelled customer and 'pés de madeira'", async () => {
    const preview = await post("/api/mate-ai/preview", {
      command: "criar um quote pro jon smith, instalação de 1350 pés de madeira",
    });
    expect(preview.status).toBe(200);
    expect(preview.json.interpreted_by).toBe("ai");
    expect(preview.json.status).toBe("ready");
    expect(preview.json.customer.name).toBe("John Smith " + suffix);
    expect(preview.json.items).toHaveLength(1);
    expect(preview.json.items[0]).toMatchObject({ name: "Agent Hardwood Installation", quantity: 1350, unitPrice: 4.5, amount: 6075 });
    expect(seenPrompts.at(-1)).toContain("Agent Hardwood Installation | sq_ft");

    const created = await post("/api/mate-ai/quote-drafts", { preview_token: preview.json.preview_token, confirmed_review: true });
    expect(created.status).toBe(201);
    expect(created.json.data.total).toBeGreaterThanOrEqual(6075);
  });

  it("asks which customer and which service, then finishes with the user's taps (no new AI call)", async () => {
    const first = await post("/api/mate-ai/preview", { command: "quote para o Mike com 200 pés de piso de madeira" });
    expect(first.json.status).toBe("customer_ambiguous");
    expect(first.json.candidates.map((c: { name: string }) => c.name).sort()).toEqual([
      "Mike Johnson " + suffix,
      "Mike Torres " + suffix,
    ]);

    const callsBefore = seenPrompts.length;
    const torres = first.json.candidates.find((c: { name: string }) => c.name.startsWith("Mike Torres"));
    const second = await post("/api/mate-ai/preview", { plan: { ...first.json.plan, customer_id: torres.id } });
    expect(second.json.status).toBe("needs_clarification");
    expect(second.json.issues[0].code).toBe("service_not_found");
    expect(second.json.catalog.length).toBeGreaterThanOrEqual(2);

    const hardwood = second.json.catalog.find((c: { name: string }) => c.name === "Agent Hardwood Installation");
    const plan = second.json.plan;
    plan.items[0] = { ...plan.items[0], catalog_item_id: hardwood.id, catalog_source: hardwood.source, unit: null };
    const third = await post("/api/mate-ai/preview", { plan });
    expect(third.json.status).toBe("ready");
    expect(third.json.customer.name).toBe("Mike Torres " + suffix);
    expect(third.json.items[0]).toMatchObject({ quantity: 200, amount: 900 });
    expect(seenPrompts.length).toBe(callsBefore);
  });

  it("issues a job invoice with the spoken due date, once, and detects stale previews", async () => {
    const preview = await post("/api/mate-ai/preview", { command: "emitir a fatura de depósito de 30% do job, vencimento dia 30" });
    expect(preview.json.action).toBe("invoice");
    expect(preview.json.status).toBe("ready");
    expect(preview.json.job.id).toBe(jobId);
    expect(preview.json.invoice).toMatchObject({ type: "deposit", amount: 1500, due_date: "2026-10-30" });

    const unconfirmed = await post("/api/mate-ai/invoices", { preview_token: preview.json.preview_token });
    expect(unconfirmed.status).toBe(400);

    const created = await post("/api/mate-ai/invoices", { preview_token: preview.json.preview_token, confirmed_review: true });
    expect(created.status).toBe(201);
    expect(created.json.data.amount).toBe(1500);
    const invoice = await prisma.quoteInvoice.findUniqueOrThrow({ where: { id: created.json.data.id } });
    expect(invoice.workOrderId).toBe(jobId);
    expect(invoice.dueDate?.toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(invoice.payload).toMatchObject({ source: "mate_ai" });

    const replay = await post("/api/mate-ai/invoices", { preview_token: preview.json.preview_token, confirmed_review: true });
    expect(replay.status).toBe(409);

    // A second preview made before the first invoice existed must not be usable afterwards.
    const plan = { ...preview.json.plan, invoice_type: "final", deposit_pct: null };
    const balance = await post("/api/mate-ai/preview", { plan });
    expect(balance.json.invoice).toMatchObject({ type: "final", amount: 3500 });
    await withTenantTransaction(orgId, (tx) =>
      tx.workOrderLineItem.updateMany({ where: { workOrderId: jobId }, data: { lineTotal: 6000, unitPrice: 6 } }),
    );
    const stale = await post("/api/mate-ai/invoices", { preview_token: balance.json.preview_token, confirmed_review: true });
    expect(stale.status).toBe(409);
  });

  it("explains what it can do when the request is not supported", async () => {
    const response = await post("/api/mate-ai/preview", { command: "qual a previsão do tempo amanhã?" });
    expect(response.status).toBe(422);
    expect(response.json.error).toBeTruthy();
  });
});
