import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { getStripe, stripeEnabled, workspacePage } from "./stripe.js";
import { sendPlatformEmail, dateVar, firstName } from "../email/templates.js";
import { cyclePriceCents, money } from "../../master/lib.js";
import { systemAudit } from "./audit.js";
import { inTenant } from "../data/tables.js";

/**
 * Card on file (brand, last 4, expiry — never the number) copied from Stripe, the forecast of what
 * comes in over the next 30/60/90 days, and the e-mail 15 days before a card expires.
 */

export const CARD_WARN_DAYS = 15;
export const CARD_EXPIRING_JOB = "card-expiring";
const DAY = 86400e3;

/** Last moment the card works: end of its expiry month (UTC). */
export function cardExpiresAt(c: { cardExpMonth: number | null; cardExpYear: number | null }): Date | null {
  if (!c.cardExpMonth || !c.cardExpYear) return null;
  return new Date(Date.UTC(c.cardExpYear, c.cardExpMonth, 1) - 1);
}

function cardOf(pm: Stripe.PaymentMethod | string | null | undefined): Stripe.PaymentMethod.Card | null {
  if (!pm || typeof pm === "string") return null;
  return pm.card ?? null;
}

/** Reads the default card of the company's subscription/customer from Stripe. */
export async function syncCard(organizationId: string): Promise<boolean> {
  if (!stripeEnabled()) return false;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeCustomerId: true, stripeSubscriptionId: true } });
  if (!org?.stripeCustomerId) return false;
  const stripe = getStripe();
  let card: Stripe.PaymentMethod.Card | null = null;
  if (org.stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(org.stripeSubscriptionId, { expand: ["default_payment_method"] }).catch(() => null);
    card = cardOf(sub?.default_payment_method as Stripe.PaymentMethod | string | null);
  }
  if (!card) {
    const cust = (await stripe.customers.retrieve(org.stripeCustomerId, { expand: ["invoice_settings.default_payment_method"] }).catch(() => null)) as Stripe.Customer | null;
    card = cardOf(cust && !("deleted" in cust && cust.deleted) ? (cust.invoice_settings?.default_payment_method as Stripe.PaymentMethod | string | null) : null);
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: card
      ? { cardBrand: card.brand, cardLast4: card.last4, cardExpMonth: card.exp_month, cardExpYear: card.exp_year, cardSyncedAt: new Date() }
      : { cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null, cardSyncedAt: new Date() },
  });
  return !!card;
}

export const BRAND: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners", jcb: "JCB", unionpay: "UnionPay" };

export function cardText(o: { cardBrand: string | null; cardLast4: string | null; cardExpMonth: number | null; cardExpYear: number | null }): string | null {
  if (!o.cardLast4) return null;
  return `${BRAND[o.cardBrand ?? ""] ?? o.cardBrand ?? "Cartão"} •••• ${o.cardLast4} · vence ${String(o.cardExpMonth).padStart(2, "0")}/${String(o.cardExpYear).slice(-2)}`;
}

/* ───────────────────────── forecast ───────────────────────── */

export type ForecastRow = {
  id: string;
  name: string;
  date: Date;
  amountCents: number;
  kind: "renewal" | "first_charge";
  /** ok = card works on that date · expiring = card expires before · none = no card (manual / no Stripe) */
  card: "ok" | "expiring" | "none";
  cardText: string | null;
  couponCode: string | null;
};

/**
 * Charges expected in the next `days` days: renewals of paying companies (not set to cancel) and
 * first charges of trials that already have a subscription. List price per cycle (before coupons).
 */
export async function forecast(days = 90, now = new Date()): Promise<ForecastRow[]> {
  const until = new Date(now.getTime() + days * DAY);
  const orgs = await prisma.organization.findMany({
    where: {
      cancelAtPeriodEnd: false,
      OR: [
        { status: { in: ["active", "past_due"] }, currentPeriodEnd: { gte: new Date(now.getTime() - DAY), lte: until } },
        { status: "trial", stripeSubscriptionId: { not: null }, trialEndsAt: { gte: now, lte: until } },
      ],
    },
    select: { id: true, name: true, status: true, plan: true, billingCycle: true, planPriceCents: true, currentPeriodEnd: true, trialEndsAt: true, stripeSubscriptionId: true, cardBrand: true, cardLast4: true, cardExpMonth: true, cardExpYear: true, couponCode: true },
  });
  return orgs
    .map((o) => {
      const date = o.status === "trial" ? o.trialEndsAt! : o.currentPeriodEnd!;
      const exp = cardExpiresAt(o);
      const card: ForecastRow["card"] = !o.stripeSubscriptionId || !o.cardLast4 ? "none" : exp && exp < date ? "expiring" : "ok";
      return { id: o.id, name: o.name, date, amountCents: cyclePriceCents(o), kind: o.status === "trial" ? ("first_charge" as const) : ("renewal" as const), card, cardText: cardText(o), couponCode: o.couponCode };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function forecastBuckets(rows: ForecastRow[], now = new Date()) {
  return [30, 60, 90].map((d) => {
    const inWin = rows.filter((r) => r.date.getTime() <= now.getTime() + d * DAY);
    const sum = (f: (r: ForecastRow) => boolean) => inWin.filter(f).reduce((a, r) => a + r.amountCents, 0);
    return {
      days: d,
      total: sum(() => true),
      ok: sum((r) => r.card === "ok"),
      expiring: sum((r) => r.card === "expiring"),
      none: sum((r) => r.card === "none"),
      count: inWin.length,
    };
  });
}

/* ───────────────────────── cards expiring ───────────────────────── */

/** Paying companies with Stripe whose card stops working before the next charge. */
export async function expiringCards(now = new Date()) {
  const orgs = await prisma.organization.findMany({
    where: { stripeSubscriptionId: { not: null }, cancelAtPeriodEnd: false, status: { in: ["active", "past_due", "trial"] }, cardExpYear: { not: null } },
    select: { id: true, name: true, slug: true, status: true, currentPeriodEnd: true, trialEndsAt: true, cardBrand: true, cardLast4: true, cardExpMonth: true, cardExpYear: true, billingContactEmail: true, plan: true, billingCycle: true, planPriceCents: true },
  });
  return orgs
    .map((o) => {
      const next = o.status === "trial" ? o.trialEndsAt : o.currentPeriodEnd;
      const exp = cardExpiresAt(o)!;
      return { ...o, next, exp, daysToExp: Math.ceil((exp.getTime() - now.getTime()) / DAY), amountCents: cyclePriceCents(o) };
    })
    .filter((o) => o.next && o.exp < o.next)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());
}

/** Daily: e-mail the company 15 days (or less) before the card expires — once per card. */
export async function sendCardExpiringEmails(now = new Date()): Promise<{ processed: number }> {
  let sent = 0;
  for (const o of await expiringCards(now)) {
    if (o.daysToExp > CARD_WARN_DAYS) continue;
    const dueKey = `card-${o.cardExpYear}-${String(o.cardExpMonth).padStart(2, "0")}-${o.cardLast4}`;
    const done = await prisma.dunningStep.findFirst({ where: { organizationId: o.id, dueKey, step: "card_expiring" } });
    if (done) continue;
    const owner = await inTenant(o.id, (tx) => tx.user.findFirst({ where: { organizationId: o.id, role: { key: "admin" }, status: "active" }, orderBy: { createdAt: "asc" }, select: { email: true, name: true } }));
    const to = o.billingContactEmail || owner?.email;
    if (!to) continue;
    await sendPlatformEmail("card_expiring", {
      to,
      organizationId: o.id,
      vars: {
        name: o.billingContactEmail ? { en: "there", pt: "equipe" } : firstName(owner?.name ?? "there"),
        company: o.name,
        card: `${BRAND[o.cardBrand ?? ""] ?? "card"} •••• ${o.cardLast4}`,
        date: dateVar(o.exp),
        next_charge: dateVar(o.next!),
        amount: money(o.amountCents),
        link: workspacePage(o.slug),
      },
    }).catch((e) => console.error("[cards] e-mail failed", e));
    await prisma.dunningStep.create({ data: { organizationId: o.id, dueKey, step: "card_expiring", action: "email", detail: `Cartão •••• ${o.cardLast4} vence ${o.cardExpMonth}/${o.cardExpYear} → ${to}` } });
    await systemAudit("billing.card_expiring_email", { type: "organization", id: o.id, label: o.name, meta: { last4: o.cardLast4, exp: `${o.cardExpMonth}/${o.cardExpYear}` } });
    sent++;
  }
  return { processed: sent };
}
