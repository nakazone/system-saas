import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { setStripeClientForTests } from "../src/lib/billing/stripe.js";
import { createCoupon, applyCoupon, archiveCoupon, couponState, couponText, setRetentionCode, retentionOfferFor, normalizeCode, validateCoupon } from "../src/lib/billing/coupons.js";
import { syncCard, cardText, forecast, forecastBuckets, expiringCards, sendCardExpiringEmails, cardExpiresAt } from "../src/lib/billing/cards.js";
import { requestCancel, undoCancel, acceptOffer, cancelOptions, applyScheduledCancellations } from "../src/lib/billing/cancel.js";
import { handleStripeEvent } from "../src/lib/billing/webhook.js";
import { email as emailProvider, type EmailMessage } from "../src/lib/email/index.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { encryptSecret, generateTotpSecret, totpAt } from "../src/lib/auth/totp.js";
import { resetThrottle } from "../src/master/auth.js";

const prisma = new PrismaClient();
const suffix = `cb${Date.now().toString(36)}`;
const DAY = 86400e3;

/** Records every Stripe call; returns plausible objects. */
const calls: { fn: string; args: unknown[] }[] = [];
let cardOnFile = { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 };
const rec = (fn: string, out: (...a: any[]) => unknown) => async (...args: unknown[]) => {
  calls.push({ fn, args });
  return out(...args);
};
const fakeStripe = {
  coupons: { create: rec("coupons.create", () => ({ id: `co_${suffix}_${calls.length}` })) },
  promotionCodes: { create: rec("promotionCodes.create", () => ({ id: `promo_${calls.length}` })), update: rec("promotionCodes.update", () => ({})) },
  subscriptions: {
    update: rec("subscriptions.update", () => ({})),
    deleteDiscount: rec("subscriptions.deleteDiscount", () => ({})),
    retrieve: rec("subscriptions.retrieve", () => ({ id: "sub", default_payment_method: { id: "pm_1", card: cardOnFile } })),
  },
  customers: { retrieve: rec("customers.retrieve", () => ({ id: "cus", invoice_settings: { default_payment_method: null } })) },
};

const sent: EmailMessage[] = [];
const realSend = emailProvider.send.bind(emailProvider);

beforeAll(async () => {
  for (const p of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
  }
  setStripeClientForTests(fakeStripe);
  emailProvider.send = async (m) => {
    sent.push(m);
    return realSend(m);
  };
});
afterAll(async () => {
  setStripeClientForTests(null);
  emailProvider.send = realSend;
  await setRetentionCode(null);
  await prisma.$disconnect();
});

async function newOrg(tag: string, data: Record<string, unknown> = {}) {
  const a = await createOrganizationWithAdmin({ organizationName: `${tag} ${suffix}`, slug: `${tag}-${suffix}`, adminName: "Ana Admin", adminEmail: `${tag}-${suffix}@example.com`, password: "password12345", plan: "professional" });
  await prisma.organization.update({ where: { id: a.organization.id }, data: data as never });
  return { id: a.organization.id, admin: a.admin };
}

describe("Cupons", () => {
  it("valida, cria no Stripe (cupom + código) e escreve o desconto", async () => {
    expect(normalizeCode(" volta 30 ")).toBe("VOLTA30");
    expect(validateCoupon({ code: "X", name: "a", percentOff: 10, duration: "once" })).toMatch(/Código/);
    expect(validateCoupon({ code: "ABC", name: "a", percentOff: 10, amountOffCents: 500, duration: "once" })).toMatch(/percentual ou valor/);
    expect(validateCoupon({ code: "ABC", name: "a", percentOff: 10, duration: "repeating" })).toMatch(/meses/);
    const c = await createCoupon({ code: `v${suffix}`, name: "Volta", percentOff: 30, duration: "repeating", durationMonths: 3, maxRedemptions: 2 }, "Teste");
    expect(c.code).toBe(`V${suffix.toUpperCase()}`);
    expect(c.stripeCouponId).toMatch(/^co_/);
    expect(calls.find((x) => x.fn === "coupons.create")?.args[0]).toMatchObject({ percent_off: 30, duration: "repeating", duration_in_months: 3 });
    expect(calls.find((x) => x.fn === "promotionCodes.create")?.args[0]).toMatchObject({ code: c.code, max_redemptions: 2 });
    expect(couponText(c)).toBe("30% por 3 meses");
    await expect(createCoupon({ code: c.code, name: "dup", percentOff: 5, duration: "once" }, "Teste")).rejects.toThrow(/Já existe/);
  });

  it("aplica na assinatura, respeita plano, esgota e arquiva", async () => {
    const o = await newOrg("cup", { status: "active", stripeSubscriptionId: `sub_cup_${suffix}`, stripeCustomerId: `cus_cup_${suffix}` });
    const c = await createCoupon({ code: `once${suffix}`, name: "Uma vez", amountOffCents: 5000, duration: "once", maxRedemptions: 1, plans: ["professional"] }, "Teste");
    const r = await applyCoupon(o.id, c.code);
    expect(r.viaStripe).toBe(true);
    expect(calls.filter((x) => x.fn === "subscriptions.update").pop()?.args).toEqual([`sub_cup_${suffix}`, { discounts: [{ coupon: c.stripeCouponId }] }]);
    const after = await prisma.coupon.findUniqueOrThrow({ where: { code: c.code } });
    expect(couponState(after)).toBe("used_up");
    const other = await newOrg("cupb", { status: "active", plan: "starter" });
    const starterOnly = await createCoupon({ code: `pro${suffix}`, name: "Só pro", percentOff: 10, duration: "forever", plans: ["professional"] }, "Teste");
    await expect(applyCoupon(other.id, starterOnly.code)).rejects.toThrow(/plano/);
    await archiveCoupon(starterOnly.code);
    expect(couponState(await prisma.coupon.findUniqueOrThrow({ where: { code: starterOnly.code } }))).toBe("archived");
  });
});

describe("Cancelamento pela empresa", () => {
  it("motivo → oferta → aceita: desconto aplicado, nada cancelado", async () => {
    const o = await newOrg("ret", { status: "active", stripeSubscriptionId: `sub_ret_${suffix}`, stripeCustomerId: `cus_ret_${suffix}`, currentPeriodEnd: new Date(Date.now() + 12 * DAY) });
    const c = await createCoupon({ code: `fica${suffix}`, name: "Fica", percentOff: 25, duration: "repeating", durationMonths: 2 }, "Teste");
    await setRetentionCode(c.code);
    const opts = await cancelOptions(o.id);
    expect(opts.can_cancel).toBe(true);
    expect(opts.offer?.text_pt).toBe("25% de desconto por 2 meses");
    await acceptOffer(o.id, "price", { name: "Ana Admin", email: `ret-${suffix}@example.com` });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: o.id } });
    expect(org).toMatchObject({ couponCode: c.code, cancelAtPeriodEnd: false, status: "active" });
    const ev = await prisma.cancellationEvent.findFirstOrThrow({ where: { organizationId: o.id } });
    expect(ev).toMatchObject({ offerShown: true, offerAccepted: true, reasonKey: "price" });
    expect(await retentionOfferFor(o.id)).toBeNull(); // already has a discount
  });

  it("cancela no fim do período (Stripe), avisa o Master e a pessoa; desfazer volta", async () => {
    sent.length = 0;
    const o = await newOrg("can", { status: "active", stripeSubscriptionId: `sub_can_${suffix}`, stripeCustomerId: `cus_can_${suffix}`, currentPeriodEnd: new Date(Date.now() + 9 * DAY) });
    await expect(requestCancel({ organizationId: o.id, reasonKey: "xyz", by: { name: "Ana", email: "a@x.com" }, offerShown: false })).rejects.toThrow(/motivo/);
    const r = await requestCancel({ organizationId: o.id, reasonKey: "missing_feature", comment: "Falta integração com QuickBooks", by: { name: "Ana Admin", email: `can-${suffix}@example.com` }, offerShown: true });
    expect(r.until?.getTime()).toBeGreaterThan(Date.now());
    expect(calls.filter((x) => x.fn === "subscriptions.update").pop()?.args[1]).toMatchObject({ cancel_at_period_end: true });
    let org = await prisma.organization.findUniqueOrThrow({ where: { id: o.id } });
    expect(org).toMatchObject({ status: "active", cancelAtPeriodEnd: true, cancelReasonKey: "missing_feature" });
    expect(sent.some((m) => /pediu cancelamento/.test(m.subject))).toBe(true);
    expect(sent.some((m) => m.to === `can-${suffix}@example.com` && /canceled/.test(m.subject))).toBe(true);
    expect((await cancelOptions(o.id)).can_cancel).toBe(false);
    await undoCancel(o.id, { name: "Ana Admin", email: `can-${suffix}@example.com` });
    org = await prisma.organization.findUniqueOrThrow({ where: { id: o.id } });
    expect(org).toMatchObject({ cancelAtPeriodEnd: false, cancelReasonKey: null });
    expect((await prisma.cancellationEvent.findFirstOrThrow({ where: { organizationId: o.id } })).undoneAt).not.toBeNull();
  });

  it("sem Stripe: o job cancela quando o período acaba; teste sem período cancela na hora", async () => {
    const manual = await newOrg("man", { status: "active", currentPeriodEnd: new Date(Date.now() + 2 * DAY) });
    await requestCancel({ organizationId: manual.id, reasonKey: "closed", by: { name: "Ana", email: "a@x.com" }, offerShown: false });
    await applyScheduledCancellations();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe("active");
    await applyScheduledCancellations(new Date(Date.now() + 3 * DAY));
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe("canceled");
    const ended = await newOrg("end", { status: "read_only", trialEndsAt: new Date(Date.now() - DAY), currentPeriodEnd: null });
    const r = await requestCancel({ organizationId: ended.id, reasonKey: "not_used", by: { name: "Ana", email: "a@x.com" }, offerShown: false });
    expect(r.until).toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ended.id } })).status).toBe("canceled");
  });
});

describe("Cartões, previsão e disputas", () => {
  it("lê o cartão no Stripe, prevê receita separando cartão que vence e avisa 15 dias antes (uma vez)", async () => {
    const soon = new Date(Date.now() + 10 * DAY);
    cardOnFile = { brand: "visa", last4: "1111", exp_month: soon.getUTCMonth() + 1, exp_year: soon.getUTCFullYear() };
    const o = await newOrg("card", { status: "active", stripeSubscriptionId: `sub_card_${suffix}`, stripeCustomerId: `cus_card_${suffix}`, currentPeriodEnd: new Date(Date.now() + 45 * DAY), billingCycle: "monthly" });
    expect(await syncCard(o.id)).toBe(true);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: o.id } });
    expect(cardText(org)).toMatch(/^Visa •••• 1111 · vence/);
    expect(cardExpiresAt(org)!.getUTCDate()).toBeGreaterThanOrEqual(28);
    const rows = (await forecast(90)).filter((r) => r.id === o.id);
    expect(rows[0]).toMatchObject({ card: "expiring", kind: "renewal" });
    const b = forecastBuckets(rows);
    expect(b[0].total).toBe(0);
    expect(b[1].expiring).toBe(rows[0].amountCents);
    expect((await expiringCards()).some((c) => c.id === o.id)).toBe(true);
    sent.length = 0;
    const later = new Date(cardExpiresAt(org)!.getTime() - 12 * DAY);
    await sendCardExpiringEmails(new Date(cardExpiresAt(org)!.getTime() - 20 * DAY)); // too early: nothing
    expect(sent.filter((m) => m.to === `card-${suffix}@example.com`)).toHaveLength(0);
    await sendCardExpiringEmails(later);
    await sendCardExpiringEmails(later);
    const mails = sent.filter((m) => m.to === `card-${suffix}@example.com`);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Your card for ObraMate expires soon");
    expect(mails[0].text).toContain("•••• 1111");
  });

  it("disputa vira linha, avisa o Master uma vez e fecha com o resultado", async () => {
    const o = await newOrg("disp", { status: "active" });
    await prisma.platformPayment.create({ data: { organizationId: o.id, amountCents: 29900, paidAt: new Date(), method: "card", source: "stripe", status: "paid", stripeChargeId: `ch_${suffix}` } });
    sent.length = 0;
    const ev = (status: string) => ({ id: `evt_${status}`, type: status === "needs_response" ? "charge.dispute.created" : "charge.dispute.closed", data: { object: { id: `dp_${suffix}`, charge: `ch_${suffix}`, amount: 29900, reason: "fraudulent", status, evidence_details: { due_by: Math.floor((Date.now() + 7 * DAY) / 1000) } } } }) as never;
    expect(await handleStripeEvent(ev("needs_response"))).toBe(o.id);
    await handleStripeEvent(ev("needs_response"));
    let d = await prisma.platformDispute.findUniqueOrThrow({ where: { id: `dp_${suffix}` } });
    expect(d).toMatchObject({ organizationId: o.id, amountCents: 29900, status: "needs_response", closedAt: null });
    expect(sent.filter((m) => /Disputa/.test(m.subject))).toHaveLength(1);
    await handleStripeEvent(ev("won"));
    d = await prisma.platformDispute.findUniqueOrThrow({ where: { id: `dp_${suffix}` } });
    expect(d.status).toBe("won");
    expect(d.closedAt).not.toBeNull();
  });
});

const privileged = await prisma
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false);

describe.skipIf(!privileged)("Master e CRM (HTTP)", () => {
  let server: Server;
  let base = "";
  let master = "";
  const secret = generateTotpSecret();
  const masterEmail = `master-${suffix}@example.com`;
  const cookieOf = (r: Response) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  async function form(cookie: string, p: string, body: Record<string, string | string[]>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
    const r = await fetch(base + p, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-Requested-With": "fetch" }, body: params });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    resetThrottle();
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({ data: { email: masterEmail, name: "Naka Cob", role: "MASTER", status: "active", passwordHash: await hashPassword("master-password-123"), totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!), totpEnabledAt: new Date(), recoveryCodeHashes: [] } });
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r1 = await fetch(`${base}/master/entrar`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: masterEmail, password: "master-password-123" }), redirect: "manual" });
    master = cookieOf(r1);
    const r2 = await fetch(`${base}/master/2fa`, { method: "POST", headers: { Cookie: master, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: totpAt(secret, Date.now()) }), redirect: "manual" });
    master = cookieOf(r2) || master;
  });
  afterAll(() => server?.close());

  it("telas do Master abrem", async () => {
    const o = await newOrg("http", { status: "active", couponCode: null });
    for (const p of ["/master/cupons", "/master/pagamentos?aba=disputas", "/master/pagamentos?aba=previsao", "/master/metricas", "/master", `/master/clientes/${o.id}`]) {
      const r = await fetch(base + p, { headers: { Cookie: master } });
      expect(r.status, p).toBe(200);
    }
  });

  it("criar cupom pela tela, oferta de retenção e cancelar pelo Master com motivo", async () => {
    const c = await form(master, "/master/cupons", { code: `tela${suffix}`, name: "Pela tela", kind: "percent", value: "15", duration: "forever", plans: ["starter", "professional", "business"] });
    expect(c.status).toBe(200);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: `TELA${suffix.toUpperCase()}` } })).plans).toEqual([]);
    expect((await form(master, "/master/cupons/retencao", { code: `TELA${suffix.toUpperCase()}` })).status).toBe(200);
    const o = await newOrg("mcan", { status: "active", currentPeriodEnd: new Date(Date.now() + 5 * DAY) });
    const slug = (await prisma.organization.findUniqueOrThrow({ where: { id: o.id } })).slug;
    expect((await form(master, `/master/clientes/${o.id}/cancelar`, { reasonKey: "competitor", reason: "Foi para o Jobber", confirm: slug })).status).toBe(200);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "canceled", cancelReasonKey: "competitor" });
    expect(await prisma.cancellationEvent.findFirstOrThrow({ where: { organizationId: o.id } })).toMatchObject({ source: "master", reasonKey: "competitor", comment: "Foi para o Jobber" });
  });

  it("CRM: admin vê opções, cancela e mantém pela API", async () => {
    const o = await newOrg("crm", { status: "active", currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
    const host = `crm-${suffix}.localhost`;
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Host: host }, body: JSON.stringify({ email: `crm-${suffix}@example.com`, password: "password12345", organizationId: o.id }) });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    const j = async (p: string, body?: unknown) => {
      const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { Cookie: cookie, Host: host, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    const opts = await j("/api/billing/cancel");
    expect(opts.status).toBe(200);
    expect(opts.json.data.reasons.length).toBeGreaterThan(4);
    expect(opts.json.data.offer).toBeNull(); // no Stripe subscription → no offer
    expect((await j("/api/billing/cancel", { reason: "price", comment: "caro" })).status).toBe(200);
    expect((await j("/api/billing/summary")).json.data.cancel_at_period_end).toBe(true);
    expect((await j("/api/billing/cancel/undo", {})).status).toBe(200);
    expect((await j("/api/billing/summary")).json.data.cancel_at_period_end).toBe(false);
  });
});
