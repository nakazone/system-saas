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
 * Mate AI phase 1, end to end through the real routes: every action is prepared as a card,
 * confirmed with a signed token, executed through the same API the screens use, logged, and
 * (when reversible) undone.
 */
describe.skipIf(!privileged)("Mate AI phase 1 actions (tenant database required)", () => {
  const prisma = new PrismaClient();
  const sfx = Date.now().toString(36);
  const email = "mate-p1-" + sfx + "@example.com";
  let server: Server;
  let aiServer: Server;
  let base = "";
  let org = "";
  let cookie = "";
  let johnId = "";
  let jobId = "";
  let jobNumber = 0;
  let quoteId = "";
  let invoiceId = "";
  const saved = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL };
  let nextPick: Record<string, unknown> = { action: "none", reply: "?" };
  const seen: string[] = [];

  async function login(): Promise<string> {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: org }),
      redirect: "manual",
    });
    const h = r.headers as Headers & { getSetCookie?: () => string[] };
    return (h.getSetCookie?.() ?? [r.headers.get("set-cookie") || ""])
      .flatMap((v) => v.split(/,\s*(?=[^;,]+=)/))
      .map((v) => v.split(";")[0])
      .join("; ");
  }

  async function post(path: string, body: unknown) {
    const r = await fetch(base + path, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  }

  async function get(path: string) {
    const r = await fetch(base + path, { headers: { Cookie: cookie } });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  }

  /** Prepare → must be a card → confirm. */
  async function run(action: string, args: Record<string, unknown>) {
    const prep = await post("/api/mate-ai/act", { action, args });
    expect(prep.status, JSON.stringify(prep.json)).toBe(200);
    expect(prep.json.type, JSON.stringify(prep.json)).toBe("card");
    const exec = await post("/api/mate-ai/execute", prep.json.card.confirm.exec.body);
    expect(exec.status, JSON.stringify(exec.json)).toBe(200);
    return { prep: prep.json, exec: exec.json };
  }

  const inDays = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const created = await createOrganizationWithAdmin({
      organizationName: "Mate P1 " + sfx,
      slug: "mate-p1-" + sfx,
      adminName: "Doug",
      adminEmail: email,
      password: "password12345",
    });
    org = created.organization.id;
    await withTenantTransaction(org, async (tx) => {
      await tx.organization.update({ where: { id: org }, data: { timezone: "America/Denver" } });
      const john = await tx.customer.create({ data: { organizationId: org, name: "John Smith", email: "john@example.com", phone: "(303) 555-0101", customerType: "particular" } });
      johnId = john.id;
      await tx.customer.create({ data: { organizationId: org, name: "Mike Torres", customerType: "particular" } });
      await tx.quoteCatalogItem.create({ data: { organizationId: org, name: "Hardwood Installation", serviceType: "installation", unitType: "sq ft", unitPrice: 5, active: true } });
      await tx.crew.create({ data: { organizationId: org, name: "Equipe Carlos" } });
      const job = await tx.workOrder.create({
        data: {
          organizationId: org,
          number: 7000 + Math.floor(Math.random() * 900),
          title: "Basement LVP",
          status: "scheduled",
          customerId: john.id,
          lineItems: { create: [{ organizationId: org, serviceName: "LVP Installation", quantitySqft: 500, unitPrice: 4, lineTotal: 2000 }] },
        },
      });
      jobId = job.id;
      jobNumber = job.number!;
    });

    aiServer = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const system = String(body.messages?.[0]?.content || "");
        seen.push(system);
        let pick = { ...nextPick } as Record<string, any>;
        if (pick.action === "quote.create") {
          const ref = system.split("\n").find((l) => l.includes("| Hardwood Installation |"))?.split(" | ")[0];
          pick = { ...pick, args: { ...pick.args, items: [{ service_ref: ref, service_text: "madeira", quantity: 1350, unit: "sq_ft" }] } };
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(pick) } }], usage: {} }));
      });
    });
    await new Promise<void>((r) => aiServer.listen(0, () => r()));
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:" + (aiServer.address() as AddressInfo).port;

    const app = createApp();
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    cookie = await login();
  });

  afterAll(async () => {
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
    if (saved.url === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = saved.url;
    await new Promise<void>((r) => server?.close(() => r()));
    await new Promise<void>((r) => aiServer?.close(() => r()));
    await prisma.$disconnect();
  });

  it("creates a quote from speech, once, and offers to send it", async () => {
    nextPick = { action: "quote.create", args: { customer: "Jon Smith" }, reply: null };
    const prep = await post("/api/mate-ai/act", { text: "quote pro jon smith 1350 pés de madeira", memory: [] });
    expect(prep.json.type).toBe("card");
    expect(prep.json.interpreted_by).toBe("ai");
    expect(prep.json.card.title).toBe("Criar Quote para John Smith");
    expect(prep.json.card.sections[0].rows[0]).toEqual(["Hardwood Installation", "1,350 sq ft", "$5.00", "$6,750.00"]);
    expect(seen.at(-1)).toContain("- invoice.quote:");

    // Edit the quantity on the card: re-prepared from args, no new AI call.
    const calls = seen.length;
    const edited = await post("/api/mate-ai/act", { action: prep.json.action, args: prep.json.args, patch: { "items.0.quantity": 1500 } });
    expect(seen.length).toBe(calls);
    expect(edited.json.card.sections[0].rows[0][3]).toBe("$7,500.00");

    const exec = await post("/api/mate-ai/execute", edited.json.card.confirm.exec.body);
    expect(exec.status).toBe(200);
    expect(exec.json.result.title).toMatch(/^Quote .+ criado$/);
    expect(exec.json.result.next).toMatchObject({ action: "quote.send" });
    quoteId = exec.json.result.entity.id;
    const again = await post("/api/mate-ai/execute", edited.json.card.confirm.exec.body);
    expect(again.status).toBe(409);

    const logged = await prisma.activityEvent.findFirst({ where: { organizationId: org, entityType: "quote", entityId: quoteId, action: "mate_ai.action" } });
    expect(logged).not.toBeNull();
  });

  it("asks for the deposit %, then issues and e-mails the invoice, then records a payment", async () => {
    const ask = await post("/api/mate-ai/act", { action: "invoice.quote", args: { quote_id: quoteId, invoice_type: "deposit" } });
    expect(ask.json.type).toBe("clarify");
    const fifty = ask.json.clarify.options.find((o: { label: string }) => o.label === "50%");
    const card = await post("/api/mate-ai/act", { action: "invoice.quote", args: ask.json.args, patch: fifty.patch });
    expect(card.json.card.confirm.label).toBe("Emitir invoice de $3,750.00");
    const issued = await post("/api/mate-ai/execute", card.json.card.confirm.exec.body);
    expect(issued.status).toBe(200);
    invoiceId = issued.json.result.entity.id;
    const inv = await prisma.quoteInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(Number(inv.amount)).toBe(3750);

    const sendCard = await post("/api/mate-ai/act", { action: "invoice.send", args: { invoice_id: invoiceId } });
    expect(sendCard.json.card.confirm.tone).toBe("send");
    expect(sendCard.json.card.confirm.checkbox).toBe("Enviar para john@example.com");
    // Test e-mail runs in console mode: the route refuses, and its message reaches the user.
    const sent = await post("/api/mate-ai/execute", sendCard.json.card.confirm.exec.body);
    expect(sent.status).toBe(503);
    expect(sent.json.error).toContain("E-mail em modo console");
    // A failed run frees the confirmation so it can be tried again.
    expect((await post("/api/mate-ai/execute", sendCard.json.card.confirm.exec.body)).status).toBe(503);

    // Payments need a sent invoice; the draft one is refused with the route's reason.
    const draft = await post("/api/mate-ai/act", { action: "payment.record", args: { invoice_id: invoiceId, amount: 1000, method: "check" } });
    expect(draft.json).toMatchObject({ type: "error" });
    expect(draft.json.message).toContain("rascunho");
    await prisma.quoteInvoice.update({ where: { id: invoiceId }, data: { status: "sent", issuedAt: new Date() } });

    const paid = await run("payment.record", { customer: "John Smith", amount: 1000, method: "cheque", reference: "1234" });
    expect(paid.prep.card.sections[0].rows[1].value).toBe("Cheque");
    expect(paid.exec.result.title).toBe("Pagamento de $1,000.00 registrado");
    const receipts = await prisma.invoiceReceipt.findMany({ where: { invoiceId } });
    expect(receipts.map((r) => [Number(r.amount), r.method, r.referenceNumber])).toEqual([[1000, "check", "1234"]]);
  });

  it("schedules a job with a crew, and undoes it", async () => {
    const day = inDays(3);
    const { exec } = await run("job.schedule", { job: "job " + jobNumber, date: day, time: "07:00", crew: "Carlos" });
    let job = await prisma.workOrder.findUniqueOrThrow({ where: { id: jobId }, include: { crew: true } });
    expect(job.crew?.name).toBe("Equipe Carlos");
    expect(job.scheduledStart?.toISOString()).toBe(new Date(day + "T13:00:00.000Z").toISOString()); // 07:00 MDT
    expect(exec.undo_token).toBeTruthy();
    const undone = await post("/api/mate-ai/undo", { token: exec.undo_token });
    expect(undone.status).toBe(200);
    job = await prisma.workOrder.findUniqueOrThrow({ where: { id: jobId }, include: { crew: true } });
    expect(job.scheduledStart).toBeNull();
    expect(job.crewId).toBeNull();
  });

  it("uses the screen: 'marca como concluído' on the job page, then a note", async () => {
    nextPick = { action: "job.status", args: { status: "completed" }, reply: null };
    const prep = await post("/api/mate-ai/act", { text: "marca como concluído", screen: { type: "job", id: jobId } });
    expect(prep.json.screen.label).toContain("Basement LVP");
    expect(seen.at(-1)).toContain("The user is looking at: Job #" + jobNumber);
    const exec = await post("/api/mate-ai/execute", prep.json.card.confirm.exec.body);
    expect(exec.json.result.next).toMatchObject({ action: "invoice.job" });
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("completed");

    await run("job.note", { job_id: jobId, text: "Cliente pediu rodapé branco" });
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: jobId } })).notes).toContain("Cliente pediu rodapé branco");
  });

  it("answers questions and suggests the uninvoiced job", async () => {
    const agenda = await post("/api/mate-ai/act", { action: "agenda.list", args: {} });
    expect(agenda.json.type).toBe("answer");
    const money = await post("/api/mate-ai/act", { action: "money.summary", args: { period: "this_month" } });
    expect(money.json.card.sections[0].rows[0][1]).toBe("$3,750.00");
    expect(money.json.card.sections[0].rows[1][1]).toBe("$1,000.00");
    const owes = await post("/api/mate-ai/act", { action: "customer.balance", args: { customer: "john smith" } });
    expect(owes.json.card.title).toBe("John Smith deve $2,750.00");
    const toBill = await post("/api/mate-ai/act", { action: "jobs.uninvoiced", args: {} });
    expect(toBill.json.card.sections[0].items[0].run).toMatchObject({ action: "invoice.job", args: { job_id: jobId } });

    const sug = await get("/api/mate-ai/suggestions");
    expect(sug.json.data.find((s: { id: string }) => s.id === "uninvoiced")?.title).toContain("$2,000.00");
  });

  it("creates the job of the approved quote, shares the quote link, and edits an open quote", async () => {
    const job = await run("job.create", { quote_id: quoteId });
    expect(job.exec.result.title).toMatch(/^Job .+ criado$/);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).workOrderId).toBe(job.exec.result.entity.id);

    const link = await run("quote.send", { quote_id: quoteId, channel: "link" });
    expect(link.exec.result.client).toMatchObject({ type: "copy" });
    expect(String(link.exec.result.client.text)).toMatch(/^https?:\/\//);

    // A second, open quote for Mike: add stairs + 10% off → applied in the editor.
    nextPick = { action: "quote.create", args: { customer: "Mike Torres" }, reply: null };
    const q2 = await post("/api/mate-ai/act", { text: "quote pro mike" });
    const made = await post("/api/mate-ai/execute", q2.json.card.confirm.exec.body);
    const q2id = made.json.result.entity.id;
    const edit = await post("/api/mate-ai/act", {
      action: "quote.edit",
      args: { quote_id: q2id, discount_type: "percent", discount_value: 10, items: [{ service_text: "hardwood", quantity: 100, unit: "sq_ft" }] },
    });
    expect(edit.json.type, JSON.stringify(edit.json)).toBe("card");
    expect(edit.json.card.sections[1].rows.at(-1)).toMatchObject({ label: "Novo total (estimado)", value: "$6,525.00" });
    const applied = await post("/api/mate-ai/execute", edit.json.card.confirm.exec.body);
    expect(applied.json.result.client).toMatchObject({ type: "quote_edit", quote_id: q2id, ops: { discount: { type: "percentage", value: 10 } } });
    expect(applied.json.result.client.ops.add_items[0]).toMatchObject({ name: "Hardwood Installation", quantity: 100, rate: 5 });
  });

  it("invoices a job through the agent", async () => {
    nextPick = { action: "invoice.job", args: { job: String(jobNumber), invoice_type: "full", due_date: inDays(10) }, reply: null };
    const prep = await post("/api/mate-ai/act", { text: "invoice do job " + jobNumber });
    expect(prep.json.type, JSON.stringify(prep.json)).toBe("card");
    expect(prep.json.card.confirm.label).toBe("Emitir invoice de $2,000.00");
    const exec = await post("/api/mate-ai/execute", prep.json.card.confirm.exec.body);
    expect(exec.status, JSON.stringify(exec.json)).toBe(200);
    const inv = await prisma.quoteInvoice.findUniqueOrThrow({ where: { id: exec.json.result.entity.id } });
    expect([Number(inv.amount), inv.workOrderId, inv.dueDate?.toISOString().slice(0, 10)]).toEqual([2000, jobId, inDays(10)]);
  });

  it("creates a lead, schedules the visit, and registers a customer", async () => {
    const lead = await run("lead.create", { name: "Ana Souza", phone: "720 555 0101", notes: "trocar carpete da sala" });
    const leadId = lead.exec.result.entity.id;
    const day = inDays(2);
    const moved = await run("lead.stage", { lead_id: leadId, stage: "visita agendada", date: day, time: "10:00" });
    expect(moved.exec.result.detail).toContain("visita");
    const meeting = await prisma.meeting.findFirst({ where: { organizationId: org, leadId } });
    expect(meeting?.scheduledStart.toISOString()).toBe(new Date(day + "T16:00:00.000Z").toISOString());

    const lost = await post("/api/mate-ai/act", { action: "lead.stage", args: { lead_id: leadId, stage: "perdido" } });
    expect(lost.json.type).toBe("clarify");
    expect(lost.json.clarify.options.map((o: { label: string }) => o.label)).toContain("Price");

    const c = await run("customer.create", { name: "Roberto Alves", customer_type: "construtora", email: "Roberto@Alves.com" });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.exec.result.entity.id } });
    expect([row.customerType, row.email]).toEqual(["builder", "roberto@alves.com"]);
  });

  it("refuses expired, foreign or tampered confirmations", async () => {
    expect((await post("/api/mate-ai/execute", { token: "abc.def" })).status).toBe(400);
    const prep = await post("/api/mate-ai/act", { action: "job.note", args: { job_id: jobId, text: "x" } });
    const [body, sig] = String(prep.json.card.confirm.exec.body.token).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), a: "payment.record" })).toString("base64url");
    expect((await post("/api/mate-ai/execute", { token: forged + "." + sig })).status).toBe(400);
    expect((await post("/api/mate-ai/act", { action: "nope", args: {} })).status).toBe(404);
  });

  it("replies instead of acting when nothing fits", async () => {
    nextPick = { action: "none", args: {}, reply: "Posso ajudar com Quotes, invoices e agenda." };
    const r = await post("/api/mate-ai/act", { text: "qual a previsão do tempo?" });
    expect(r.json).toMatchObject({ type: "reply", message: "Posso ajudar com Quotes, invoices e agenda." });
  });
});
