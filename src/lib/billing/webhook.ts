import express, { Router, type Request, type Response } from "express";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { getStripe } from "./stripe.js";
import { systemAudit } from "./audit.js";
import { PLAN_LABEL } from "../../master/lib.js";

/**
 * POST /webhooks/stripe — must be mounted BEFORE express.json() (needs the raw body).
 * Each event is stored in StripeEvent and processed once; a failure returns 500 so
 * Stripe retries, and the next attempt runs the handler again.
 */
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post("/webhooks/stripe", express.raw({ type: "*/*", limit: "1mb" }), async (req: Request, res: Response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: "webhook_not_configured" });
    return;
  }
  let event: Stripe.Event;
  try {
    const sig = String(req.headers["stripe-signature"] || "");
    event = getStripe().webhooks.constructEvent(req.body as Buffer, sig, secret);
  } catch {
    res.status(400).json({ ok: false, error: "bad_signature" });
    return;
  }
  const seen = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (seen?.processedAt) {
    res.json({ ok: true, duplicate: true });
    return;
  }
  if (!seen) {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type, payload: event as never } }).catch(() => undefined);
  }
  try {
    const organizationId = await handleStripeEvent(event);
    await prisma.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null, organizationId } });
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[stripe] event failed", event.type, event.id, message);
    await prisma.stripeEvent.update({ where: { id: event.id }, data: { error: message.slice(0, 500) } }).catch(() => undefined);
    res.status(500).json({ ok: false, error: "processing_failed" });
  }
});

type Org = NonNullable<Awaited<ReturnType<typeof prisma.organization.findUnique>>>;

const idOf = (v: string | { id: string } | null | undefined): string | null => (v == null ? null : typeof v === "string" ? v : v.id);
const fromUnix = (n: number | null | undefined) => (n ? new Date(n * 1000) : null);

async function findOrg(hints: { orgId?: string | null; subscription?: string | null; customer?: string | null }): Promise<Org | null> {
  if (hints.orgId) {
    const o = await prisma.organization.findUnique({ where: { id: hints.orgId } }).catch(() => null);
    if (o) return o;
  }
  if (hints.subscription) {
    const o = await prisma.organization.findFirst({ where: { stripeSubscriptionId: hints.subscription } });
    if (o) return o;
  }
  if (hints.customer) {
    const o = await prisma.organization.findFirst({ where: { stripeCustomerId: hints.customer } });
    if (o) return o;
  }
  return null;
}

/** Company back to normal after a payment (leaves read-only/suspended). */
function reopenData(org: Org) {
  return {
    status: "active",
    readOnlySince: null,
    suspendedAt: null,
    ...(org.status === "canceled" ? { canceledAt: null, cancelReason: null } : {}),
  };
}

function planFromSubscription(sub: Stripe.Subscription): { plan?: string; cycle?: string; priceCents?: number } {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  const cycle = sub.metadata?.cycle || (price?.recurring?.interval === "year" ? "annual" : price?.recurring?.interval === "month" ? "monthly" : undefined);
  const plan = sub.metadata?.plan || (price?.metadata?.planKey as string | undefined);
  return { plan: plan && plan in PLAN_LABEL ? plan : undefined, cycle, priceCents: price?.unit_amount ?? undefined };
}

export async function handleStripeEvent(event: Stripe.Event): Promise<string | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode !== "subscription") return null;
      const org = await findOrg({ orgId: s.metadata?.organizationId || s.client_reference_id, customer: idOf(s.customer) });
      if (!org) return null;
      const plan = s.metadata?.plan && s.metadata.plan in PLAN_LABEL ? s.metadata.plan : org.plan;
      const cycle = s.metadata?.cycle === "annual" ? "annual" : s.metadata?.cycle === "monthly" ? "monthly" : org.billingCycle;
      await prisma.organization.update({
        where: { id: org.id },
        data: {
          stripeCustomerId: idOf(s.customer) ?? org.stripeCustomerId,
          stripeSubscriptionId: idOf(s.subscription) ?? org.stripeSubscriptionId,
          plan,
          billingCycle: cycle,
          ...(plan !== org.plan || cycle !== org.billingCycle ? { planPriceCents: null } : {}),
          cancelAtPeriodEnd: false,
        },
      });
      await systemAudit("stripe.checkout_completed", { type: "organization", id: org.id, label: org.name, meta: { plan, cycle } });
      return org.id;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const org = await findOrg({ orgId: sub.metadata?.organizationId, subscription: sub.id, customer: idOf(sub.customer) });
      if (!org) return null;
      const info = planFromSubscription(sub);
      const data: Record<string, unknown> = {
        stripeSubscriptionId: sub.id,
        stripeCustomerId: idOf(sub.customer) ?? org.stripeCustomerId,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      };
      if (info.plan) data.plan = info.plan;
      if (info.cycle) data.billingCycle = info.cycle;
      if (sub.status === "trialing") {
        data.status = org.status === "suspended" || org.status === "canceled" ? org.status : "trial";
        data.trialEndsAt = fromUnix(sub.trial_end) ?? org.trialEndsAt;
        data.readOnlySince = null;
      } else if (sub.status === "active") {
        Object.assign(data, reopenData(org));
        data.currentPeriodEnd = fromUnix(sub.current_period_end) ?? org.currentPeriodEnd;
      } else if (sub.status === "past_due" || sub.status === "unpaid") {
        // Reminders/read-only are applied by the daily billing job from the due date.
        if (org.status === "active" || org.status === "trial") data.status = "past_due";
      }
      await prisma.organization.update({ where: { id: org.id }, data });
      if (event.type === "customer.subscription.created" || org.status !== data.status) {
        await systemAudit("stripe.subscription", { type: "organization", id: org.id, label: org.name, meta: { stripeStatus: sub.status, from: org.status, to: data.status ?? org.status } });
      }
      return org.id;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const org = await findOrg({ orgId: sub.metadata?.organizationId, subscription: sub.id, customer: idOf(sub.customer) });
      if (!org) return null;
      if (org.stripeSubscriptionId && org.stripeSubscriptionId !== sub.id) return org.id; // an old subscription
      const reason = sub.cancellation_details?.feedback || sub.cancellation_details?.reason || null;
      await prisma.organization.update({
        where: { id: org.id },
        data: { status: "canceled", canceledAt: new Date(), cancelReason: org.cancelReason || (reason ? `Stripe: ${reason}` : "Assinatura cancelada no Stripe"), cancelAtPeriodEnd: false },
      });
      await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'organizationId' = ${org.id}`.catch(() => 0);
      await systemAudit("stripe.subscription_canceled", { type: "organization", id: org.id, label: org.name, meta: { reason } });
      return org.id;
    }

    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const org = await findOrg({ orgId: inv.subscription_details?.metadata?.organizationId, subscription: idOf(inv.subscription), customer: idOf(inv.customer) });
      if (!org) return null;
      const line = inv.lines?.data?.find((l) => l.type === "subscription") ?? inv.lines?.data?.[0];
      const periodStart = fromUnix(line?.period?.start);
      const periodEnd = fromUnix(line?.period?.end);
      if (inv.amount_paid > 0) {
        await prisma.platformPayment.upsert({
          where: { stripeInvoiceId: inv.id! },
          create: {
            organizationId: org.id,
            amountCents: inv.amount_paid,
            paidAt: fromUnix(inv.status_transitions?.paid_at) ?? new Date(),
            method: "card",
            source: "stripe",
            status: "paid",
            stripeInvoiceId: inv.id!,
            stripeChargeId: idOf(inv.charge),
            invoiceUrl: inv.hosted_invoice_url ?? null,
            invoicePdfUrl: inv.invoice_pdf ?? null,
            periodStart,
            periodEnd,
            note: inv.number ? `Fatura ${inv.number}` : null,
          },
          update: {
            amountCents: inv.amount_paid,
            status: "paid",
            failureReason: null,
            paidAt: fromUnix(inv.status_transitions?.paid_at) ?? new Date(),
            stripeChargeId: idOf(inv.charge),
            invoiceUrl: inv.hosted_invoice_url ?? null,
            invoicePdfUrl: inv.invoice_pdf ?? null,
          },
        });
      }
      const later = periodEnd && (!org.currentPeriodEnd || periodEnd > org.currentPeriodEnd) ? periodEnd : org.currentPeriodEnd;
      // A $0 invoice at the start of a trial does not activate the account.
      const activate = inv.amount_paid > 0 || org.status !== "trial";
      await prisma.organization.update({
        where: { id: org.id },
        data: { ...(activate ? reopenData(org) : {}), currentPeriodEnd: later },
      });
      if (inv.amount_paid > 0) {
        await systemAudit("payment.stripe_paid", { type: "organization", id: org.id, label: org.name, meta: { amountCents: inv.amount_paid, invoice: inv.number, periodEnd: periodEnd?.toISOString() } });
      }
      return org.id;
    }

    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const org = await findOrg({ orgId: inv.subscription_details?.metadata?.organizationId, subscription: idOf(inv.subscription), customer: idOf(inv.customer) });
      if (!org) return null;
      const reason = inv.last_finalization_error?.message || "Cartão recusado pelo banco";
      const line = inv.lines?.data?.[0];
      await prisma.platformPayment.upsert({
        where: { stripeInvoiceId: inv.id! },
        create: {
          organizationId: org.id,
          amountCents: inv.amount_due,
          paidAt: new Date(),
          method: "card",
          source: "stripe",
          status: "failed",
          failureReason: reason,
          stripeInvoiceId: inv.id!,
          invoiceUrl: inv.hosted_invoice_url ?? null,
          periodStart: fromUnix(line?.period?.start),
          periodEnd: fromUnix(line?.period?.end),
          note: `Tentativa ${inv.attempt_count || 1}${inv.number ? ` · fatura ${inv.number}` : ""}`,
        },
        update: { status: "failed", failureReason: reason, note: `Tentativa ${inv.attempt_count || 1}${inv.number ? ` · fatura ${inv.number}` : ""}` },
      });
      if (org.status === "active") await prisma.organization.update({ where: { id: org.id }, data: { status: "past_due" } });
      await systemAudit("payment.stripe_failed", { type: "organization", id: org.id, label: org.name, meta: { amountCents: inv.amount_due, attempt: inv.attempt_count, reason } });
      return org.id;
    }

    case "charge.refunded": {
      const ch = event.data.object as Stripe.Charge;
      const pay = await prisma.platformPayment.findFirst({ where: { stripeChargeId: ch.id } });
      if (!pay) return null;
      const full = ch.amount_refunded >= ch.amount;
      await prisma.platformPayment.update({
        where: { id: pay.id },
        data: full ? { status: "refunded", refundedAt: new Date() } : { note: `${pay.note ? pay.note + " · " : ""}reembolso parcial de $${(ch.amount_refunded / 100).toFixed(2)}` },
      });
      await systemAudit("payment.stripe_refunded", { type: "organization", id: pay.organizationId, label: null, meta: { amountCents: ch.amount_refunded, full } });
      return pay.organizationId;
    }

    case "charge.dispute.created": {
      const d = event.data.object as Stripe.Dispute;
      const pay = await prisma.platformPayment.findFirst({ where: { stripeChargeId: idOf(d.charge) } });
      if (!pay) return null;
      await prisma.platformNote.create({
        data: { organizationId: pay.organizationId, authorName: "Stripe", body: `Disputa (chargeback) aberta: $${(d.amount / 100).toFixed(2)} · motivo ${d.reason}. Responder no Stripe até ${d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString().slice(0, 10) : "o prazo"}.` },
      });
      await systemAudit("payment.dispute", { type: "organization", id: pay.organizationId, label: null, meta: { amountCents: d.amount, reason: d.reason } });
      return pay.organizationId;
    }

    default:
      return null;
  }
}
