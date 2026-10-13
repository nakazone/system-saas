import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { encryptSecret, generateTotpSecret, totpAt } from "../src/lib/auth/totp.js";
import { resetThrottle } from "../src/master/auth.js";
import { dayFromToday, daysUntil, cyclePriceCents } from "../src/master/lib.js";
import { refreshPlans } from "../src/master/plans.js";
import { runBillingLadder, saveLadder, DEFAULT_LADDER } from "../src/lib/billing/dunning.js";
import { setStripeClientForTests } from "../src/lib/billing/stripe.js";
import { accountBanner } from "../src/lib/billing/access.js";

/** Like production: the platform reads every tenant (privileged DB role). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

const WEBHOOK_SECRET = "whsec_test_master_fase1";
const signer = new Stripe("sk_test_signer");

describe("Billing helpers", () => {
  it("banner: trial ending, payment failed, read-only", () => {
    const base = { id: "x", plan: "starter", billingCycle: "monthly", planPriceCents: null, stripeSubscriptionId: null, cancelAtPeriodEnd: false, readOnlySince: null };
    expect(accountBanner({ ...base, status: "trial", trialEndsAt: dayFromToday(3), currentPeriodEnd: null })?.text).toContain("em 3 dias");
    expect(accountBanner({ ...base, status: "trial", trialEndsAt: dayFromToday(20), currentPeriodEnd: null })).toBeNull();
    // Card already on file: no nagging during the trial.
    expect(accountBanner({ ...base, status: "trial", trialEndsAt: dayFromToday(3), currentPeriodEnd: null, stripeSubscriptionId: "sub_1" })).toBeNull();
    expect(accountBanner({ ...base, status: "past_due", trialEndsAt: null, currentPeriodEnd: dayFromToday(-2) })?.tone).toBe("warn");
    expect(accountBanner({ ...base, status: "read_only", trialEndsAt: dayFromToday(-1), currentPeriodEnd: null })?.text).toContain("teste grátis acabou");
    expect(accountBanner({ ...base, status: "read_only", trialEndsAt: null, currentPeriodEnd: dayFromToday(-8) })?.text).toContain("atraso");
  });
});

describe.skipIf(!privileged)("Master fase 1 — planos, só leitura, régua, Stripe e suporte", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `f1${Date.now().toString(36)}`;
  const masterEmail = `master-${suffix}@example.com`;
  const masterPassword = "master-password-123";
  const secret = generateTotpSecret();
  let masterCookie = "";
  const orgs: Record<string, { id: string; email: string; cookie: string }> = {};

  const stripeCalls: { method: string; args: unknown }[] = [];
  const fakeStripe = {
    customers: { create: async (args: unknown) => (stripeCalls.push({ method: "customers.create", args }), { id: `cus_${suffix}_${stripeCalls.length}` }) },
    products: { create: async (args: unknown) => (stripeCalls.push({ method: "products.create", args }), { id: `prod_${suffix}` }) },
    prices: { create: async (args: unknown) => (stripeCalls.push({ method: "prices.create", args }), { id: `price_${suffix}_${stripeCalls.length}` }) },
    checkout: { sessions: { create: async (args: unknown) => (stripeCalls.push({ method: "checkout.create", args }), { url: "https://checkout.stripe.test/c/pay_123" }) } },
    billingPortal: { sessions: { create: async (args: unknown) => (stripeCalls.push({ method: "portal.create", args }), { url: "https://billing.stripe.test/p/session_1" }) } },
    subscriptions: { retrieve: async () => ({ status: "canceled", items: { data: [] } }) },
    webhooks: signer.webhooks,
  };

  function cookieOf(r: Response) {
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  async function as(cookie: string, method: string, path: string, body?: Record<string, unknown>, form = false) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: cookie,
        Accept: "application/json",
        "X-Requested-With": "fetch",
        "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
      },
      body: body === undefined ? undefined : form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body),
      redirect: "manual",
    });
    const set = cookieOf(r);
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any>, set };
  }
  const master = (path: string, body: Record<string, string> = {}) => as(masterCookie, "POST", path, body, true);

  async function newOrg(key: string, status: string, data: Record<string, unknown> = {}) {
    const email = `${key}-${suffix}@example.com`;
    const a = await createOrganizationWithAdmin({ organizationName: `${key} ${suffix}`, slug: `${key}-${suffix}`, adminName: "Owner Person", adminEmail: email, password: "password12345" });
    await prisma.organization.update({ where: { id: a.organization.id }, data: { status, ...data } });
    orgs[key] = { id: a.organization.id, email, cookie: "" };
    return orgs[key];
  }
  async function login(key: string) {
    const o = orgs[key];
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: o.email, password: "password12345", organizationId: o.id }), redirect: "manual" });
    o.cookie = cookieOf(r);
    return o.cookie;
  }
  async function postWebhook(event: Record<string, unknown>, sig?: string) {
    const payload = JSON.stringify(event);
    const header = sig ?? signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const r = await fetch(`${base}/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": header, "Content-Type": "application/json" }, body: payload });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }
  const evt = (id: string, type: string, object: Record<string, unknown>) => ({ id, object: "event", type, data: { object }, created: Math.floor(Date.now() / 1000), livemode: false, api_version: "2025-02-24.acacia" });

  beforeAll(async () => {
    resetThrottle();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    setStripeClientForTests(fakeStripe);
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    await saveLadder({ ...DEFAULT_LADDER });
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({
      data: {
        email: masterEmail,
        name: "Naka Fase",
        role: "MASTER",
        status: "active",
        passwordHash: await hashPassword(masterPassword),
        totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!),
        totpEnabledAt: new Date(),
        recoveryCodeHashes: [],
      },
    });
    const app = createApp();
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r1 = await fetch(`${base}/master/entrar`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: masterEmail, password: masterPassword }), redirect: "manual" });
    masterCookie = cookieOf(r1);
    const r2 = await fetch(`${base}/master/2fa`, { method: "POST", headers: { Cookie: masterCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: totpAt(secret, Date.now()) }), redirect: "manual" });
    masterCookie = cookieOf(r2) || masterCookie;
    expect(r2.headers.get("location")).toBe("/master");
  });

  afterAll(async () => {
    setStripeClientForTests(null);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("catálogo de planos: telas abrem e mudar preço preserva quem já paga", async () => {
    for (const p of ["/master/planos", "/master/vencimentos", "/master/pagamentos", "/master/suporte", "/master"]) {
      const r = await fetch(base + p, { headers: { Cookie: masterCookie } });
      expect(r.status, p).toBe(200);
    }
    const payer = await newOrg("payer", "active", { plan: "starter", currentPeriodEnd: dayFromToday(20) });
    const refused = await master("/master/planos/starter", { name: "Starter", monthly: "149", annual: "1490", includedUsers: "5", trialDays: "30", active: "1", visible: "1", grandfather: "1" });
    expect(refused.status).toBe(200); // fresh 2FA from the login still valid
    await refreshPlans();
    const o = await prisma.organization.findUniqueOrThrow({ where: { id: payer.id } });
    expect(o.planPriceCents).toBe(12900);
    expect(cyclePriceCents({ plan: "starter", billingCycle: "monthly", planPriceCents: null })).toBe(14900);
    // Back to the original price for the other tests.
    await prisma.plan.update({ where: { key: "starter" }, data: { monthlyCents: 12900, annualCents: 129000 } });
    await refreshPlans();
    const audit = await prisma.platformAuditLog.findFirst({ where: { action: "plan.update" }, orderBy: { at: "desc" } });
    expect((audit?.meta as any)?.grandfathered).toBeGreaterThanOrEqual(1);
  });

  it("só leitura: lê tudo, não grava, e o aviso aparece", async () => {
    await newOrg("ro", "read_only", { trialEndsAt: dayFromToday(-1), readOnlySince: new Date() });
    const cookie = await login("ro");
    expect(cookie).toBeTruthy();
    const read = await as(cookie, "GET", "/api/leads");
    expect(read.status).toBeLessThan(400);
    const write = await as(cookie, "POST", "/api/leads", { name: "Should Fail", phone: "3035550100" });
    expect(write.status).toBe(402);
    expect(write.json.error).toBe("ACCOUNT_READ_ONLY");
    const st = await as(cookie, "GET", "/api/account/status");
    expect(st.json.data.mode).toBe("read_only");
    expect(st.json.data.banner.text).toContain("teste grátis acabou");
    // Paying and support stay open.
    const sum = await as(cookie, "GET", "/api/billing/summary");
    expect(sum.json.data.status).toBe("read_only");
    const ticket = await as(cookie, "POST", "/api/support/tickets", { category: "question", subject: "Como assino?", body: "Quero assinar o plano Starter hoje." });
    expect(ticket.status).toBe(201);
  });

  it("checkout do Stripe: link para a empresa, cobra só no fim do teste", async () => {
    await newOrg("trial", "trial", { trialEndsAt: dayFromToday(10) });
    const cookie = await login("trial");
    const r = await as(cookie, "POST", "/api/billing/checkout", { plan: "starter", cycle: "monthly" });
    expect(r.status).toBe(200);
    expect(r.json.url).toContain("checkout.stripe.test");
    const call = stripeCalls.find((c) => c.method === "checkout.create")!.args as any;
    expect(call.mode).toBe("subscription");
    expect(call.subscription_data.metadata.organizationId).toBe(orgs.trial.id);
    expect(call.subscription_data.trial_end).toBeGreaterThan(Date.now() / 1000);
    expect(call.success_url).toContain("assinatura=ok");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgs.trial.id } });
    expect(org.stripeCustomerId).toMatch(/^cus_/);
    // Master sends the same kind of link.
    const m = await master(`/master/clientes/${orgs.trial.id}/link-pagamento`, { send: "0" });
    expect(m.json.reveal.value).toContain("checkout.stripe.test");
  });

  it("webhook do Stripe: assinatura confere, pagamento libera, recusa marca atraso, duplicado é ignorado", async () => {
    const bad = await postWebhook(evt("evt_bad", "invoice.paid", {}), "t=1,v1=nope");
    expect(bad.status).toBe(400);

    const ro = orgs.ro;
    const sub = `sub_${suffix}`;
    const cus = `cus_ro_${suffix}`;
    const done = await postWebhook(evt(`evt_ck_${suffix}`, "checkout.session.completed", { object: "checkout.session", mode: "subscription", client_reference_id: ro.id, customer: cus, subscription: sub, metadata: { organizationId: ro.id, plan: "professional", cycle: "monthly" } }));
    expect(done.status).toBe(200);
    let org = await prisma.organization.findUniqueOrThrow({ where: { id: ro.id } });
    expect(org.stripeSubscriptionId).toBe(sub);
    expect(org.plan).toBe("professional");

    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const invoice = {
      object: "invoice",
      id: `in_${suffix}`,
      number: "OM-0001",
      customer: cus,
      subscription: sub,
      amount_paid: 29900,
      amount_due: 29900,
      charge: `ch_${suffix}`,
      hosted_invoice_url: "https://invoice.stripe.test/i/1",
      invoice_pdf: "https://invoice.stripe.test/i/1.pdf",
      status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
      lines: { data: [{ type: "subscription", period: { start: Math.floor(Date.now() / 1000), end: periodEnd } }] },
    };
    const paid = await postWebhook(evt(`evt_paid_${suffix}`, "invoice.paid", invoice));
    expect(paid.status).toBe(200);
    org = await prisma.organization.findUniqueOrThrow({ where: { id: ro.id } });
    expect(org.status).toBe("active");
    expect(org.readOnlySince).toBeNull();
    expect(daysUntil(org.currentPeriodEnd)).toBeGreaterThanOrEqual(29);
    const pay = await prisma.platformPayment.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } });
    expect(pay).toMatchObject({ amountCents: 29900, status: "paid", source: "stripe", stripeChargeId: `ch_${suffix}` });

    // The same event again does nothing.
    const again = await postWebhook(evt(`evt_paid_${suffix}`, "invoice.paid", invoice));
    expect(again.json.duplicate).toBe(true);
    expect(await prisma.platformPayment.count({ where: { organizationId: ro.id } })).toBe(1);

    // Writing works again after paying.
    const write = await as(ro.cookie, "POST", "/api/leads", { name: "Now Works", phone: "3035550101" });
    expect(write.status).not.toBe(402);

    // Next renewal declined → past due, a "Recusado" line in Pagamentos.
    const failed = await postWebhook(evt(`evt_fail_${suffix}`, "invoice.payment_failed", { ...invoice, id: `in2_${suffix}`, amount_paid: 0, attempt_count: 1 }));
    expect(failed.status).toBe(200);
    org = await prisma.organization.findUniqueOrThrow({ where: { id: ro.id } });
    expect(org.status).toBe("past_due");
    expect((await prisma.platformPayment.findUniqueOrThrow({ where: { stripeInvoiceId: `in2_${suffix}` } })).status).toBe("failed");

    // Refund in Stripe marks the payment.
    await postWebhook(evt(`evt_ref_${suffix}`, "charge.refunded", { object: "charge", id: `ch_${suffix}`, amount: 29900, amount_refunded: 29900 }));
    expect((await prisma.platformPayment.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } })).status).toBe("refunded");

    // Subscription canceled in Stripe → company canceled.
    await postWebhook(evt(`evt_del_${suffix}`, "customer.subscription.deleted", { object: "subscription", id: sub, customer: cus, metadata: { organizationId: ro.id }, cancellation_details: { reason: "cancellation_requested" } }));
    org = await prisma.organization.findUniqueOrThrow({ where: { id: ro.id } });
    expect(org.status).toBe("canceled");
    const stored = await prisma.stripeEvent.count({ where: { id: { endsWith: suffix } } });
    expect(stored).toBe(5);
  });

  it("régua: trial vira só leitura, atraso vira só leitura e depois suspensa; uma vez só; pausa respeitada", async () => {
    const t = await newOrg("ladtrial", "trial", { trialEndsAt: dayFromToday(-1) });
    const p = await newOrg("ladpaid", "active", { plan: "starter", currentPeriodEnd: dayFromToday(-8) });
    const card = await newOrg("ladcard", "active", { plan: "starter", currentPeriodEnd: dayFromToday(-8), stripeSubscriptionId: `sub_card_${suffix}` });
    const paused = await newOrg("ladpause", "active", { plan: "starter", currentPeriodEnd: dayFromToday(-20), dunningPausedUntil: dayFromToday(5) });
    const soon = await newOrg("ladsoon", "trial", { trialEndsAt: dayFromToday(3) });

    const r1 = await runBillingLadder();
    const get = (id: string) => prisma.organization.findUniqueOrThrow({ where: { id } });
    expect((await get(t.id)).status).toBe("read_only");
    expect((await get(p.id)).status).toBe("read_only");
    // Card in Stripe: 3 extra days → at D+8 it is past due, not yet read-only.
    expect((await get(card.id)).status).toBe("past_due");
    expect((await get(paused.id)).status).toBe("active");
    expect((await get(soon.id)).status).toBe("trial");
    expect(await prisma.dunningStep.count({ where: { organizationId: soon.id, step: "trial-3" } })).toBe(1);
    expect(r1.emails).toBeGreaterThanOrEqual(3);

    // Same day again: nothing new.
    const before = await prisma.dunningStep.count({ where: { organizationId: { in: [t.id, p.id, card.id, soon.id] } } });
    const r2 = await runBillingLadder();
    expect(await prisma.dunningStep.count({ where: { organizationId: { in: [t.id, p.id, card.id, soon.id] } } })).toBe(before);
    expect(r2.changes.find((c) => c.org.includes(suffix))).toBeUndefined();

    // A week later the unpaid company is suspended and loses its sessions.
    const later = new Date(Date.now() + 7 * 86_400_000);
    await runBillingLadder(later);
    expect((await get(p.id)).status).toBe("suspended");
    const audit = await prisma.platformAuditLog.findFirst({ where: { action: "ladder.suspended", targetId: p.id } });
    expect(audit).toBeTruthy();

    // Master can run it by hand (recorded as a job run).
    const run = await master("/master/vencimentos/regua/rodar");
    expect(run.status).toBe(200);
    expect(await prisma.jobRun.count({ where: { name: "billing-ladder", trigger: "manual", ok: true } })).toBeGreaterThanOrEqual(1);
  });

  it("suporte: Master responde, a empresa vê e responde de volta", async () => {
    const o = await newOrg("sup", "active", { currentPeriodEnd: dayFromToday(15) });
    const cookie = await login("sup");
    const created = await as(cookie, "POST", "/api/support/tickets", { category: "bug", subject: "Erro ao salvar job", body: "Quando clico em salvar o job aparece erro 500." });
    const id = created.json.data.id as string;
    const page = await fetch(`${base}/master/suporte/${id}`, { headers: { Cookie: masterCookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Erro ao salvar job");

    const reply = await master(`/master/suporte/${id}/responder`, { body: "Oi! Já corrigimos, pode tentar de novo?" });
    expect(reply.status).toBe(200);
    let t = await prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    expect(t.status).toBe("waiting");
    expect(t.firstResponseAt).not.toBeNull();

    const list = await as(cookie, "GET", "/api/support/tickets");
    const mine = list.json.data.find((x: any) => x.id === id);
    expect(mine.messages[0]).toMatchObject({ from: "obramate", body: "Oi! Já corrigimos, pode tentar de novo?" });

    const back = await as(cookie, "POST", `/api/support/tickets/${id}/messages`, { body: "Funcionou, obrigado!" });
    expect(back.status).toBe(201);
    t = await prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    expect(t.status).toBe("open");

    // Another company cannot answer this ticket.
    const otherCookie = await login("payer");
    const sneaky = await as(otherCookie, "POST", `/api/support/tickets/${id}/messages`, { body: "hi" });
    expect(sneaky.status).toBe(404);

    await master(`/master/suporte/${id}/responder`, { body: "", close: "1" });
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id } })).status).toBe("closed");
    expect(o.id).toBeTruthy();
  });

  it("health confere o banco", async () => {
    const r = await fetch(`${base}/health`);
    const j = (await r.json()) as { ok: boolean; db: string };
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, db: "ok" });
  });
});
