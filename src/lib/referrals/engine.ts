/**
 * Referral cashback engine — Particular only; credit on invoice paid (% of invoice).
 */
import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { recordActivity } from "../activity/record.js";
import { parseReferralSettings } from "./settings.js";

function money(n: number) {
  return Math.round(n * 100) / 100;
}

export async function referralBalanceCents(tx: TenantPrisma, customerId: string): Promise<number> {
  const rows = await tx.referralLedgerEntry.findMany({
    where: { customerId },
    select: { amount: true },
  });
  const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
  return Math.round(sum * 100);
}

export async function referralBalance(tx: TenantPrisma, customerId: string): Promise<number> {
  const cents = await referralBalanceCents(tx, customerId);
  return money(cents / 100);
}

/** When invoice becomes paid: credit Particular referrer with % of invoice amount. Idempotent. */
export async function maybeCreditReferralOnInvoicePaid(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    invoiceId: string;
    actorId?: string | null;
  },
): Promise<{ credited: boolean; rewardAmount?: number; reason?: string }> {
  const org = await tx.organization.findUnique({
    where: { id: params.organizationId },
    select: { referralSettings: true },
  });
  const settings = parseReferralSettings(org?.referralSettings);
  if (!settings.enabled || !(settings.percent > 0)) {
    return { credited: false, reason: "program_off" };
  }

  const existing = await tx.referralReward.findFirst({
    where: { invoiceId: params.invoiceId },
  });
  if (existing) return { credited: false, reason: "already_credited" };

  const invoice = await tx.quoteInvoice.findFirst({
    where: { id: params.invoiceId },
    select: {
      id: true,
      status: true,
      amount: true,
      customerId: true,
      quoteId: true,
      workOrderId: true,
      invoiceNumber: true,
    },
  });
  if (!invoice || invoice.status !== "paid" || !invoice.customerId) {
    return { credited: false, reason: "invoice_not_eligible" };
  }

  const referred = await tx.customer.findFirst({
    where: { id: invoice.customerId },
    select: {
      id: true,
      name: true,
      referredByCustomerId: true,
      customerType: true,
    },
  });
  if (!referred?.referredByCustomerId) {
    return { credited: false, reason: "no_referrer" };
  }

  const referrer = await tx.customer.findFirst({
    where: { id: referred.referredByCustomerId },
    select: { id: true, name: true, customerType: true },
  });
  if (!referrer) return { credited: false, reason: "referrer_missing" };
  // Program is Particular-only for cashback.
  if (String(referrer.customerType || "").toLowerCase() !== "particular") {
    return { credited: false, reason: "referrer_not_particular" };
  }
  if (referrer.id === referred.id) {
    return { credited: false, reason: "self_referral" };
  }

  const projectAmount = money(Number(invoice.amount));
  if (!(projectAmount > 0)) return { credited: false, reason: "zero_amount" };
  const rewardAmount = money((projectAmount * settings.percent) / 100);
  if (!(rewardAmount > 0)) return { credited: false, reason: "zero_reward" };

  const reward = await tx.referralReward.create({
    data: {
      organizationId: params.organizationId,
      referrerCustomerId: referrer.id,
      referredCustomerId: referred.id,
      invoiceId: invoice.id,
      quoteId: invoice.quoteId,
      workOrderId: invoice.workOrderId,
      projectAmount: new Prisma.Decimal(projectAmount.toFixed(2)),
      percent: new Prisma.Decimal(settings.percent.toFixed(2)),
      rewardAmount: new Prisma.Decimal(rewardAmount.toFixed(2)),
      status: "credited",
    },
  });

  await tx.referralLedgerEntry.create({
    data: {
      organizationId: params.organizationId,
      customerId: referrer.id,
      type: "credit",
      amount: new Prisma.Decimal(rewardAmount.toFixed(2)),
      referralRewardId: reward.id,
      invoiceId: invoice.id,
      notes: `Cashback ${settings.percent}% · ${invoice.invoiceNumber || "fatura"} · indicado: ${referred.name}`,
    },
  });

  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "customer",
    entityId: referrer.id,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "referral.credit",
    changes: {
      rewardAmount: { from: null, to: rewardAmount },
      referredCustomerId: { from: null, to: referred.id },
      invoiceId: { from: null, to: invoice.id },
    },
  });

  return { credited: true, rewardAmount };
}

/** Redeem cashback against a payment on the referrer's own invoice. */
export async function redeemReferralCredit(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    customerId: string;
    amount: number;
    invoiceId: string;
    invoiceReceiptId: string;
    actorId?: string | null;
  },
): Promise<void> {
  const amount = money(params.amount);
  if (!(amount > 0)) throw new Error("Cashback amount must be positive");
  const balC = await referralBalanceCents(tx, params.customerId);
  const needC = Math.round(amount * 100);
  if (needC > balC + 1) {
    throw new Error(
      `Saldo de cashback insuficiente (disponível $${(balC / 100).toFixed(2)}).`,
    );
  }
  await tx.referralLedgerEntry.create({
    data: {
      organizationId: params.organizationId,
      customerId: params.customerId,
      type: "redeem",
      amount: new Prisma.Decimal((-amount).toFixed(2)),
      invoiceId: params.invoiceId,
      invoiceReceiptId: params.invoiceReceiptId,
      notes: "Cashback aplicado na fatura",
    },
  });
  await recordActivity(tx, {
    organizationId: params.organizationId,
    entityType: "customer",
    entityId: params.customerId,
    actorType: params.actorId ? "user" : "system",
    actorId: params.actorId ?? null,
    action: "referral.redeem",
    changes: {
      amount: { from: null, to: -amount },
      invoiceId: { from: null, to: params.invoiceId },
    },
  });
}

export async function ensureReferralCode(
  tx: TenantPrisma,
  organizationId: string,
  customerId: string,
  name: string,
): Promise<string> {
  const existing = await tx.customer.findFirst({
    where: { id: customerId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;

  const base = String(name || "CLI")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 8)
    .toUpperCase() || "CLI";
  for (let i = 0; i < 20; i++) {
    const code = i === 0 ? base : `${base}${i + 1}`;
    const clash = await tx.customer.findFirst({
      where: { organizationId, referralCode: code },
      select: { id: true },
    });
    if (clash) continue;
    await tx.customer.update({ where: { id: customerId }, data: { referralCode: code } });
    return code;
  }
  const fallback = `R${customerId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  await tx.customer.update({ where: { id: customerId }, data: { referralCode: fallback } });
  return fallback;
}
