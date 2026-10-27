import { prisma } from "../prisma.js";
import { BillingError, getStripe, stripeEnabled } from "./stripe.js";
import { money } from "../../master/lib.js";

/**
 * Cupons (Master › Cupons). Created here and mirrored in Stripe:
 *  - a Stripe coupon (the discount) + a promotion code with the same code, so the company can
 *    type it in the Stripe checkout (allow_promotion_codes is on);
 *  - the Master can also apply it straight to a company's subscription.
 * Stripe does not allow editing a coupon's discount: to change it, archive and create another.
 */

export type CouponInput = {
  code: string;
  name: string;
  percentOff?: number | null;
  amountOffCents?: number | null;
  duration: "once" | "repeating" | "forever";
  durationMonths?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
  plans?: string[];
};

export function normalizeCode(code: string): string {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function validateCoupon(i: CouponInput): string | null {
  if (!/^[A-Z0-9][A-Z0-9_-]{2,29}$/.test(i.code)) return "Código: 3 a 30 letras, números, - ou _ (sem espaço).";
  if (!i.name.trim()) return "Dê um nome ao cupom.";
  const hasPct = i.percentOff != null;
  const hasAmt = i.amountOffCents != null;
  if (hasPct === hasAmt) return "Escolha percentual ou valor fixo.";
  if (hasPct && (i.percentOff! < 1 || i.percentOff! > 100)) return "Percentual entre 1 e 100.";
  if (hasAmt && i.amountOffCents! < 100) return "Valor fixo mínimo de $1.";
  if (i.duration === "repeating" && (!i.durationMonths || i.durationMonths < 1 || i.durationMonths > 36)) return "Número de meses entre 1 e 36.";
  if (i.maxRedemptions != null && i.maxRedemptions < 1) return "Limite de usos precisa ser 1 ou mais.";
  if (i.expiresAt && i.expiresAt.getTime() < Date.now()) return "A validade precisa ser no futuro.";
  return null;
}

/** "30% por 3 meses", "$50 na primeira cobrança", "20% para sempre". */
export function couponText(c: { percentOff: number | null; amountOffCents: number | null; duration: string; durationMonths: number | null }): string {
  const off = c.percentOff != null ? `${c.percentOff}%` : money(c.amountOffCents ?? 0);
  if (c.duration === "once") return `${off} na primeira cobrança`;
  if (c.duration === "forever") return `${off} para sempre`;
  return `${off} por ${c.durationMonths} ${c.durationMonths === 1 ? "mês" : "meses"}`;
}

/** Same text in English (shown to the company inside the cancellation flow and in Stripe). */
export function couponTextEn(c: { percentOff: number | null; amountOffCents: number | null; duration: string; durationMonths: number | null }): string {
  const off = c.percentOff != null ? `${c.percentOff}% off` : `${money(c.amountOffCents ?? 0)} off`;
  if (c.duration === "once") return `${off} your next payment`;
  if (c.duration === "forever") return `${off} for as long as you stay`;
  return `${off} for ${c.durationMonths} ${c.durationMonths === 1 ? "month" : "months"}`;
}

export async function createCoupon(i: CouponInput, byName: string) {
  const code = normalizeCode(i.code);
  const err = validateCoupon({ ...i, code });
  if (err) throw new BillingError("invalid", err);
  if (await prisma.coupon.findUnique({ where: { code } })) throw new BillingError("exists", `Já existe um cupom ${code}.`);
  let stripeCouponId: string | null = null;
  let stripePromotionCodeId: string | null = null;
  if (stripeEnabled()) {
    const stripe = getStripe();
    const sc = await stripe.coupons.create({
      name: `${i.name} (${code})`.slice(0, 40),
      ...(i.percentOff != null ? { percent_off: i.percentOff } : { amount_off: i.amountOffCents!, currency: "usd" }),
      duration: i.duration,
      ...(i.duration === "repeating" ? { duration_in_months: i.durationMonths! } : {}),
      metadata: { code, source: "obramate-master" },
    });
    stripeCouponId = sc.id;
    const pc = await stripe.promotionCodes.create({
      coupon: sc.id,
      code,
      ...(i.maxRedemptions ? { max_redemptions: i.maxRedemptions } : {}),
      ...(i.expiresAt ? { expires_at: Math.floor(i.expiresAt.getTime() / 1000) } : {}),
      metadata: { code },
    });
    stripePromotionCodeId = pc.id;
  }
  return prisma.coupon.create({
    data: {
      code,
      name: i.name.trim(),
      percentOff: i.percentOff ?? null,
      amountOffCents: i.amountOffCents ?? null,
      duration: i.duration,
      durationMonths: i.duration === "repeating" ? i.durationMonths ?? null : null,
      maxRedemptions: i.maxRedemptions ?? null,
      expiresAt: i.expiresAt ?? null,
      plans: i.plans ?? [],
      stripeCouponId,
      stripePromotionCodeId,
      createdByName: byName,
    },
  });
}

/** Turns the code off (in Stripe too). Companies that already have it keep the discount. */
export async function archiveCoupon(code: string) {
  const c = await prisma.coupon.findUnique({ where: { code } });
  if (!c) throw new BillingError("not_found", "Cupom não encontrado.");
  if (c.stripePromotionCodeId && stripeEnabled()) await getStripe().promotionCodes.update(c.stripePromotionCodeId, { active: false });
  return prisma.coupon.update({ where: { code }, data: { active: false } });
}

export type CouponState = "active" | "expired" | "used_up" | "archived";

export function couponState(c: { active: boolean; expiresAt: Date | null; maxRedemptions: number | null; timesRedeemed: number }, now = new Date()): CouponState {
  if (!c.active) return "archived";
  if (c.expiresAt && c.expiresAt <= now) return "expired";
  if (c.maxRedemptions != null && c.timesRedeemed >= c.maxRedemptions) return "used_up";
  return "active";
}

/** Applies a coupon to the company's live Stripe subscription (or just records it when there is none). */
export async function applyCoupon(organizationId: string, code: string): Promise<{ viaStripe: boolean; coupon: Awaited<ReturnType<typeof prisma.coupon.findUniqueOrThrow>> }> {
  const c = await prisma.coupon.findUnique({ where: { code: normalizeCode(code) } });
  if (!c) throw new BillingError("not_found", "Cupom não encontrado.");
  if (couponState(c) !== "active") throw new BillingError("inactive", "Esse cupom não está mais valendo.");
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, plan: true, stripeSubscriptionId: true, couponCode: true } });
  if (!org) throw new BillingError("not_found", "Empresa não encontrada.");
  if (c.plans.length && !c.plans.includes(org.plan)) throw new BillingError("plan", "Esse cupom não vale para o plano da empresa.");
  let viaStripe = false;
  if (org.stripeSubscriptionId && stripeEnabled()) {
    if (!c.stripeCouponId) throw new BillingError("no_stripe_coupon", "Esse cupom foi criado com o Stripe desligado. Crie de novo agora que o Stripe está ligado.");
    await getStripe().subscriptions.update(org.stripeSubscriptionId, { discounts: [{ coupon: c.stripeCouponId }] });
    viaStripe = true;
  }
  await prisma.organization.update({ where: { id: org.id }, data: { couponCode: c.code } });
  if (org.couponCode !== c.code) await prisma.coupon.update({ where: { code: c.code }, data: { timesRedeemed: { increment: 1 } } });
  return { viaStripe, coupon: c };
}

export async function removeCoupon(organizationId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeSubscriptionId: true } });
  if (!org) throw new BillingError("not_found", "Empresa não encontrada.");
  let viaStripe = false;
  if (org.stripeSubscriptionId && stripeEnabled()) {
    await getStripe().subscriptions.deleteDiscount(org.stripeSubscriptionId);
    viaStripe = true;
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { couponCode: null } });
  return viaStripe;
}

/** Code of the coupon on a Stripe subscription (when the company typed it in the checkout). */
export async function couponCodeFromStripe(couponId: string | null | undefined): Promise<string | null> {
  if (!couponId) return null;
  const c = await prisma.coupon.findFirst({ where: { stripeCouponId: couponId }, select: { code: true } });
  return c?.code ?? null;
}

/* ───────────────────────── retention offer ───────────────────────── */

const RETENTION_KEY = "platform.retention_offer";

export async function getRetentionCode(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: RETENTION_KEY } }).catch(() => null);
  return row?.value || null;
}

export async function setRetentionCode(code: string | null): Promise<void> {
  if (!code) {
    await prisma.systemSetting.deleteMany({ where: { key: RETENTION_KEY } });
    return;
  }
  await prisma.systemSetting.upsert({ where: { key: RETENTION_KEY }, create: { key: RETENTION_KEY, value: code }, update: { value: code } });
}

/** The offer a company sees before canceling (only if it can actually be applied). */
export async function retentionOfferFor(organizationId: string) {
  const code = await getRetentionCode();
  if (!code) return null;
  const c = await prisma.coupon.findUnique({ where: { code } });
  if (!c || couponState(c) !== "active") return null;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true, stripeSubscriptionId: true, couponCode: true } });
  if (!org?.stripeSubscriptionId || !stripeEnabled() || !c.stripeCouponId) return null;
  if (org.couponCode) return null; // already has a discount
  if (c.plans.length && !c.plans.includes(org.plan)) return null;
  return c;
}

/* ───────────────────────── builder referral ───────────────────────── */

const BUILDER_REFERRAL_KEY = "platform.builder_referral_coupon";

/** Coupon a company gets when it signs up from a builder's invitation (Master › Cupons). */
export async function getBuilderReferralCode(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: BUILDER_REFERRAL_KEY } }).catch(() => null);
  return row?.value || null;
}

export async function setBuilderReferralCode(code: string | null): Promise<void> {
  if (!code) {
    await prisma.systemSetting.deleteMany({ where: { key: BUILDER_REFERRAL_KEY } });
    return;
  }
  await prisma.systemSetting.upsert({ where: { key: BUILDER_REFERRAL_KEY }, create: { key: BUILDER_REFERRAL_KEY, value: code }, update: { value: code } });
}

/** The referral coupon if it can still be used, for the invite text and the sign-up. */
export async function builderReferralCoupon() {
  const code = await getBuilderReferralCode();
  if (!code) return null;
  const c = await prisma.coupon.findUnique({ where: { code } });
  return c && couponState(c) === "active" ? c : null;
}
