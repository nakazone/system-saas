import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { email as emailProvider } from "../email/index.js";
import { sendPlatformEmail, dateVar, firstName } from "../email/templates.js";
import { cyclePriceCents, monthlyCents } from "../../master/lib.js";
import { BillingError, getStripe, stripeEnabled, workspacePage } from "./stripe.js";
import { applyCoupon, couponTextEn, retentionOfferFor } from "./coupons.js";
import { systemAudit } from "./audit.js";

/**
 * Cancelamento pela empresa (CRM › Configurações › Plano e cobrança).
 * The admin picks a reason, may get a retention offer (Master › Cupons), and confirms.
 * Access continues until the end of the paid period (or of the trial); then the company is
 * canceled — by Stripe's webhook when there is a subscription, by the daily job otherwise.
 */

export const CANCEL_REASONS: { key: string; pt: string; en: string }[] = [
  { key: "price", pt: "Preço", en: "It's too expensive" },
  { key: "missing_feature", pt: "Falta um recurso", en: "Something I need is missing" },
  { key: "not_used", pt: "Não usou o suficiente", en: "We didn't use it enough" },
  { key: "competitor", pt: "Foi para outro sistema", en: "We moved to another tool" },
  { key: "closed", pt: "Fechou a empresa", en: "We closed the business" },
  { key: "other", pt: "Outro", en: "Other" },
];
export const REASON_LABEL: Record<string, string> = { ...Object.fromEntries(CANCEL_REASONS.map((r) => [r.key, r.pt])), not_paid: "Não pagou", trial_ended: "Teste acabou sem assinar" };
export const SCHEDULED_CANCEL_JOB = "scheduled-cancellations";

type OrgRow = NonNullable<Awaited<ReturnType<typeof loadOrg>>>;
async function loadOrg(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, status: true, plan: true, billingCycle: true, planPriceCents: true, trialEndsAt: true, currentPeriodEnd: true, stripeSubscriptionId: true, cancelAtPeriodEnd: true, cancelRequestedAt: true, couponCode: true },
  });
}

/** When access ends if the company cancels now. */
export function accessUntil(o: Pick<OrgRow, "status" | "trialEndsAt" | "currentPeriodEnd">, now = new Date()): Date | null {
  if (o.status === "trial") return o.trialEndsAt && o.trialEndsAt > now ? o.trialEndsAt : null;
  return o.currentPeriodEnd && o.currentPeriodEnd > now ? o.currentPeriodEnd : null;
}

export function canCancel(o: Pick<OrgRow, "status" | "cancelAtPeriodEnd">): boolean {
  return ["trial", "active", "past_due", "read_only"].includes(o.status) && !o.cancelAtPeriodEnd;
}

export async function cancelOptions(organizationId: string) {
  const o = await loadOrg(organizationId);
  if (!o) throw new BillingError("not_found", "Empresa não encontrada.");
  const offer = canCancel(o) ? await retentionOfferFor(o.id) : null;
  return {
    can_cancel: canCancel(o),
    scheduled: o.cancelAtPeriodEnd,
    access_until: (o.cancelAtPeriodEnd ? accessUntil(o) ?? o.currentPeriodEnd : accessUntil(o))?.toISOString() ?? null,
    reasons: CANCEL_REASONS.map((r) => ({ key: r.key, label: r.pt })),
    offer: offer ? { code: offer.code, text_pt: offerTextPt(offer), text_en: couponTextEn(offer) } : null,
  };
}

function offerTextPt(c: { percentOff: number | null; amountOffCents: number | null; duration: string; durationMonths: number | null }): string {
  const off = c.percentOff != null ? `${c.percentOff}% de desconto` : `$${((c.amountOffCents ?? 0) / 100).toFixed(0)} de desconto`;
  if (c.duration === "once") return `${off} na próxima cobrança`;
  if (c.duration === "forever") return `${off} enquanto continuar`;
  return `${off} por ${c.durationMonths} ${c.durationMonths === 1 ? "mês" : "meses"}`;
}

async function alertMaster(subject: string, lines: string[]): Promise<void> {
  const master = await prisma.platformAdmin.findFirst({ where: { role: "MASTER", status: "active" }, select: { email: true } });
  if (!master) return;
  await emailProvider
    .send({ to: master.email, subject, text: [...lines, "", `${env.APP_BASE_URL.replace(/\/$/, "")}/master`].join("\n"), meta: { category: "internal", template: "cancel_alert", organizationId: null } })
    .catch((e) => console.error("[cancel] master alert failed", e));
}

export async function requestCancel(input: { organizationId: string; reasonKey: string; comment?: string | null; by: { name: string; email: string }; offerShown: boolean }) {
  const o = await loadOrg(input.organizationId);
  if (!o) throw new BillingError("not_found", "Empresa não encontrada.");
  if (!canCancel(o)) throw new BillingError("not_cancelable", o.cancelAtPeriodEnd ? "O cancelamento já está agendado." : "Essa conta não tem assinatura para cancelar.");
  if (!CANCEL_REASONS.some((r) => r.key === input.reasonKey)) throw new BillingError("reason", "Escolha um motivo.");
  const until = accessUntil(o);
  if (o.stripeSubscriptionId && stripeEnabled()) {
    await getStripe().subscriptions.update(o.stripeSubscriptionId, {
      cancel_at_period_end: true,
      cancellation_details: { comment: (input.comment || REASON_LABEL[input.reasonKey]).slice(0, 500) },
    });
  }
  const now = new Date();
  const comment = input.comment?.trim().slice(0, 1000) || null;
  await prisma.organization.update({
    where: { id: o.id },
    data: until
      ? { cancelAtPeriodEnd: true, cancelRequestedAt: now, cancelReasonKey: input.reasonKey, cancelReason: `${REASON_LABEL[input.reasonKey]}${comment ? `: ${comment}` : ""} (pela empresa)` }
      : { status: "canceled", canceledAt: now, cancelAtPeriodEnd: false, cancelRequestedAt: now, cancelReasonKey: input.reasonKey, cancelReason: `${REASON_LABEL[input.reasonKey]}${comment ? `: ${comment}` : ""} (pela empresa)` },
  });
  const ev = await prisma.cancellationEvent.create({
    data: { organizationId: o.id, orgName: o.name, source: "company", reasonKey: input.reasonKey, comment, mrrCents: monthlyCents(o), effectiveAt: until, offerShown: input.offerShown, byName: `${input.by.name} <${input.by.email}>` },
  });
  if (!until) await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'organizationId' = ${o.id}`.catch(() => 0);
  await systemAudit("tenant.cancel_requested", { type: "organization", id: o.id, label: o.name, meta: { reason: input.reasonKey, comment, until: until?.toISOString() ?? null, by: input.by.email } }, input.by.name);
  await alertMaster(`[ObraMate] ${o.name} pediu cancelamento`, [
    `${o.name} pediu para cancelar (${input.by.name}, ${input.by.email}).`,
    `Motivo: ${REASON_LABEL[input.reasonKey]}${comment ? ` — ${comment}` : ""}`,
    until ? `Acesso até ${until.toISOString().slice(0, 10)}. Dá para conversar com a empresa antes disso.` : "Cancelada na hora (não havia período pago).",
  ]);
  await sendPlatformEmail("cancel_confirmed", {
    to: input.by.email,
    organizationId: o.id,
    vars: { name: firstName(input.by.name), company: o.name, date: until ? dateVar(until) : dateVar(now), link: workspacePage(o.slug) },
  }).catch(() => undefined);
  return { event: ev, until };
}

/** The company changed its mind before the end of the period. */
export async function undoCancel(organizationId: string, by: { name: string; email: string }) {
  const o = await loadOrg(organizationId);
  if (!o) throw new BillingError("not_found", "Empresa não encontrada.");
  if (!o.cancelAtPeriodEnd) throw new BillingError("not_scheduled", "Não há cancelamento agendado.");
  if (o.stripeSubscriptionId && stripeEnabled()) await getStripe().subscriptions.update(o.stripeSubscriptionId, { cancel_at_period_end: false });
  await prisma.organization.update({ where: { id: o.id }, data: { cancelAtPeriodEnd: false, cancelRequestedAt: null, cancelReasonKey: null, cancelReason: null } });
  await prisma.cancellationEvent.updateMany({ where: { organizationId: o.id, undoneAt: null, source: "company" }, data: { undoneAt: new Date() } });
  await systemAudit("tenant.cancel_undone", { type: "organization", id: o.id, label: o.name, meta: { by: by.email } }, by.name);
  await alertMaster(`[ObraMate] ${o.name} desistiu de cancelar`, [`${by.name} (${by.email}) manteve a assinatura de ${o.name}.`]);
}

/** Retention offer accepted: discount applied, nothing canceled. */
export async function acceptOffer(organizationId: string, reasonKey: string, by: { name: string; email: string }) {
  const o = await loadOrg(organizationId);
  if (!o) throw new BillingError("not_found", "Empresa não encontrada.");
  const offer = await retentionOfferFor(o.id);
  if (!offer) throw new BillingError("no_offer", "Essa oferta não está mais disponível.");
  await applyCoupon(o.id, offer.code);
  await prisma.cancellationEvent.create({
    data: { organizationId: o.id, orgName: o.name, source: "company", reasonKey: REASON_LABEL[reasonKey] ? reasonKey : "other", mrrCents: monthlyCents(o), offerShown: true, offerAccepted: true, undoneAt: new Date(), byName: `${by.name} <${by.email}>` },
  });
  await systemAudit("tenant.retention_accepted", { type: "organization", id: o.id, label: o.name, meta: { coupon: offer.code, reason: reasonKey } }, by.name);
  await alertMaster(`[ObraMate] ${o.name} aceitou a oferta para ficar`, [`${by.name} ia cancelar (${REASON_LABEL[reasonKey] ?? reasonKey}) e aceitou o cupom ${offer.code}.`]);
  return offer;
}

/** Daily: companies without Stripe whose period ended after a scheduled cancellation. */
export async function applyScheduledCancellations(now = new Date()): Promise<{ processed: number }> {
  const due = await prisma.organization.findMany({
    where: {
      cancelAtPeriodEnd: true,
      status: { not: "canceled" },
      OR: [{ stripeSubscriptionId: null }, ...(stripeEnabled() ? [] : [{ stripeSubscriptionId: { not: null } }])],
    },
    select: { id: true, name: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  let n = 0;
  for (const o of due) {
    const end = o.status === "trial" ? o.trialEndsAt : o.currentPeriodEnd;
    if (end && end > now) continue;
    await prisma.organization.update({ where: { id: o.id }, data: { status: "canceled", canceledAt: now, cancelAtPeriodEnd: false } });
    await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'organizationId' = ${o.id}`.catch(() => 0);
    await systemAudit("tenant.cancel_effective", { type: "organization", id: o.id, label: o.name, meta: { end: end?.toISOString() ?? null } });
    n++;
  }
  return { processed: n };
}

/** Cancellation by the Master also goes into the reasons report. */
export async function recordMasterCancel(o: { id: string; name: string; plan: string; billingCycle: string; planPriceCents: number | null; status: string }, reasonKey: string, comment: string | null, byName: string) {
  await prisma.cancellationEvent.create({
    data: { organizationId: o.id, orgName: o.name, source: "master", reasonKey: REASON_LABEL[reasonKey] ? reasonKey : "other", comment, mrrCents: ["active", "past_due"].includes(o.status) ? monthlyCents(o) : 0, byName },
  });
}

export { cyclePriceCents };
