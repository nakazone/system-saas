import Stripe from "stripe";
import { prisma } from "../prisma.js";
import { workspaceHomeUrl } from "../tenant/workspace-url.js";
import { planByKey } from "../../master/plans.js";
import { cyclePriceCents } from "../../master/lib.js";

/**
 * Stripe billing for the platform (companies paying ObraMate).
 *
 * Off unless STRIPE_SECRET_KEY is set. The webhook (./webhook.ts) is the only
 * place that changes a company's status/period from Stripe data; the calls in
 * this file only create things in Stripe (customers, prices, checkout, portal).
 */

let client: Stripe | null = null;
let testClient: Stripe | null = null;

export function stripeEnabled(): boolean {
  return !!testClient || !!process.env.STRIPE_SECRET_KEY;
}

export function stripeMode(): "live" | "test" | "off" {
  if (testClient) return "test";
  const k = process.env.STRIPE_SECRET_KEY || "";
  if (!k) return "off";
  return k.startsWith("sk_live") || k.startsWith("rk_live") ? "live" : "test";
}

export function getStripe(): Stripe {
  if (testClient) return testClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingError("stripe_off", "Stripe não configurado (STRIPE_SECRET_KEY).");
  if (!client) client = new Stripe(key, { apiVersion: "2025-02-24.acacia", appInfo: { name: "ObraMate" } });
  return client;
}

/** Tests only: replace the Stripe client with a fake. */
export function setStripeClientForTests(fake: unknown): void {
  testClient = fake as Stripe | null;
}

export class BillingError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Page of the company's own workspace (Stripe sends people back there). */
export function workspacePage(slug: string, path = "configuracoes.html#plano"): string {
  return workspaceHomeUrl(slug) + path.replace(/^\//, "");
}

async function ownerOf(organizationId: string) {
  return prisma.user.findFirst({
    where: { organizationId, role: { key: "admin" }, status: { in: ["active", "invited"] } },
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true },
  });
}

/** The company's Stripe customer (created on first use). */
export async function ensureCustomer(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, stripeCustomerId: true, billingContactEmail: true, contactEmail: true },
  });
  if (!org) throw new BillingError("not_found", "Empresa não encontrada.");
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const owner = await ownerOf(org.id);
  const customer = await getStripe().customers.create({
    name: org.name,
    email: org.billingContactEmail || owner?.email || org.contactEmail || undefined,
    metadata: { organizationId: org.id, slug: org.slug },
  });
  await prisma.organization.update({ where: { id: org.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** A Stripe price id for the plan list price (created once per price and cached on the plan). */
async function listPriceId(planKey: string, cycle: "monthly" | "annual"): Promise<string> {
  const plan = await planByKey(planKey);
  if (!plan) throw new BillingError("plan", "Plano não existe no catálogo.");
  const stripe = getStripe();
  const field = cycle === "annual" ? "stripeAnnualPriceId" : "stripeMonthlyPriceId";
  if (plan[field]) return plan[field]!;
  let productId = plan.stripeProductId;
  if (!productId) {
    const product = await stripe.products.create({ name: `ObraMate ${plan.name}`, metadata: { planKey: plan.key } });
    productId = product.id;
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: cycle === "annual" ? plan.annualCents : plan.monthlyCents,
    recurring: { interval: cycle === "annual" ? "year" : "month" },
    metadata: { planKey: plan.key, cycle },
  });
  await prisma.plan.update({ where: { key: plan.key }, data: { stripeProductId: productId, [field]: price.id } });
  plan.stripeProductId = productId;
  plan[field] = price.id;
  return price.id;
}

/** Line item for the company's current plan/cycle, honoring a special price. */
async function lineItemFor(org: { plan: string; billingCycle: string; planPriceCents: number | null }) {
  const cycle = org.billingCycle === "annual" ? "annual" : "monthly";
  if (org.planPriceCents == null) return { price: await listPriceId(org.plan, cycle), quantity: 1 };
  const plan = await planByKey(org.plan);
  await listPriceId(org.plan, cycle); // makes sure the product exists
  const fresh = await planByKey(org.plan);
  return {
    price_data: {
      currency: "usd",
      product: fresh?.stripeProductId || plan?.stripeProductId || undefined,
      unit_amount: cyclePriceCents(org),
      recurring: { interval: cycle === "annual" ? ("year" as const) : ("month" as const) },
    },
    quantity: 1,
  };
}

/**
 * Checkout link for the company to subscribe (or to subscribe again).
 * If the trial still has 2+ days, the first charge happens when it ends.
 */
export async function createCheckoutUrl(
  organizationId: string,
  opts: { plan?: string; cycle?: "monthly" | "annual"; returnPath?: string; createdBy?: string } = {},
): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new BillingError("not_found", "Empresa não encontrada.");
  if (org.stripeSubscriptionId && ["active", "past_due", "trial", "read_only"].includes(org.status) && !org.cancelAtPeriodEnd) {
    const sub = await getStripe().subscriptions.retrieve(org.stripeSubscriptionId).catch(() => null);
    if (sub && !["canceled", "incomplete_expired"].includes(sub.status)) {
      throw new BillingError("has_subscription", "Esta empresa já tem assinatura. Use o portal de cobrança para trocar o cartão.");
    }
  }
  const plan = (opts.plan || org.plan || "starter").toLowerCase();
  const cycle = opts.cycle || (org.billingCycle === "annual" ? "annual" : "monthly");
  const target = { plan, billingCycle: cycle, planPriceCents: plan === org.plan && cycle === org.billingCycle ? org.planPriceCents : null };
  const customer = await ensureCustomer(org.id);
  const back = workspacePage(org.slug, opts.returnPath);
  const trialEnd =
    org.status === "trial" && org.trialEndsAt && org.trialEndsAt.getTime() - Date.now() > 2 * 86_400_000
      ? Math.floor(org.trialEndsAt.getTime() / 1000)
      : undefined;
  const meta = { organizationId: org.id, plan, cycle };
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: org.id,
    line_items: [await lineItemFor(target)],
    subscription_data: { metadata: meta, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    metadata: { ...meta, createdBy: opts.createdBy || "company" },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    success_url: back.replace("#", "?assinatura=ok#"),
    cancel_url: back,
  });
  if (!session.url) throw new BillingError("checkout", "O Stripe não devolveu o link de pagamento.");
  return session.url;
}

/** Stripe customer portal (change card, download invoices, cancel). */
export async function createPortalUrl(organizationId: string, returnPath = "configuracoes.html#plano"): Promise<string> {
  const customer = await ensureCustomer(organizationId);
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  const session = await getStripe().billingPortal.sessions.create({ customer, return_url: workspacePage(org!.slug, returnPath) });
  return session.url;
}

/** Applies a plan/cycle/price change to the live Stripe subscription (proration on). */
export async function syncSubscriptionPrice(organizationId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org?.stripeSubscriptionId) return false;
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (!item) return false;
  const line = await lineItemFor(org);
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, ...("price" in line ? { price: line.price } : { price_data: { ...line.price_data, product: line.price_data.product! } }) }],
    proration_behavior: "create_prorations",
    metadata: { organizationId: org.id, plan: org.plan, cycle: org.billingCycle },
  });
  return true;
}

/** Cancels in Stripe; the webhook then marks the company. */
export async function cancelSubscription(organizationId: string, atPeriodEnd: boolean): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeSubscriptionId: true } });
  if (!org?.stripeSubscriptionId) return false;
  const stripe = getStripe();
  if (atPeriodEnd) await stripe.subscriptions.update(org.stripeSubscriptionId, { cancel_at_period_end: true });
  else await stripe.subscriptions.cancel(org.stripeSubscriptionId);
  return true;
}

/** Tries to charge the latest open invoice now. */
export async function payOpenInvoice(organizationId: string): Promise<{ paid: boolean; message: string }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeCustomerId: true } });
  if (!org?.stripeCustomerId) return { paid: false, message: "Essa empresa ainda não tem cadastro no Stripe." };
  const stripe = getStripe();
  const open = await stripe.invoices.list({ customer: org.stripeCustomerId, status: "open", limit: 1 });
  const inv = open.data[0];
  if (!inv) return { paid: false, message: "Não há fatura em aberto no Stripe." };
  try {
    const paid = await stripe.invoices.pay(inv.id!);
    return { paid: paid.status === "paid", message: paid.status === "paid" ? "Cobrança aprovada." : `Fatura ficou ${paid.status}.` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Cobrança recusada.";
    return { paid: false, message: `Recusado: ${msg}` };
  }
}

/** Refund in Stripe (whole charge, or `amountCents`). The webhook marks the payment. */
export async function refundCharge(chargeId: string, amountCents?: number): Promise<void> {
  await getStripe().refunds.create({ charge: chargeId, ...(amountCents ? { amount: amountCents } : {}) });
}
