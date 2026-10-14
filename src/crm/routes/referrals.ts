/**
 * Programa de indicações — lista, saldo e detalhe por cliente.
 *
 *   GET /api/referrals
 *   GET /api/customers/:id/referrals
 */
import { Router } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth } from "../http.js";
import { canViewPricing } from "../../lib/pricing/visibility.js";
import {
  ensureReferralCode,
  referralBalance,
} from "../../lib/referrals/engine.js";
import { parseReferralSettings } from "../../lib/referrals/settings.js";

export const referralsRouter = Router();

function money(n: number, show: boolean) {
  return show ? Math.round(n * 100) / 100 : null;
}

referralsRouter.get("/api/referrals", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const showMoney = canViewPricing(req.user);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { referralSettings: true },
      });
      const settings = parseReferralSettings(org.referralSettings);
      const rewards = await tx.referralReward.findMany({
        orderBy: { creditedAt: "desc" },
        take: 200,
        include: {
          referrerCustomer: { select: { id: true, name: true, customerType: true } },
          referredCustomer: { select: { id: true, name: true, customerType: true } },
        },
      });
      return { settings, rewards };
    });
    res.json({
      success: true,
      data: {
        settings: data.settings,
        rewards: data.rewards.map((r) => ({
          id: r.id,
          status: r.status,
          percent: Number(r.percent),
          project_amount: money(Number(r.projectAmount), showMoney),
          reward_amount: money(Number(r.rewardAmount), showMoney),
          invoice_id: r.invoiceId,
          quote_id: r.quoteId,
          work_order_id: r.workOrderId,
          credited_at: r.creditedAt,
          referrer: {
            id: r.referrerCustomer.id,
            name: r.referrerCustomer.name,
            customer_type: r.referrerCustomer.customerType,
          },
          referred: {
            id: r.referredCustomer.id,
            name: r.referredCustomer.name,
            customer_type: r.referredCustomer.customerType,
          },
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

referralsRouter.get(
  "/api/customers/:id/referrals",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const showMoney = canViewPricing(req.user);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id },
          select: {
            id: true,
            name: true,
            customerType: true,
            referredByCustomerId: true,
            referralCode: true,
          },
        });
        if (!customer) return null;

        let referralCode = customer.referralCode;
        if (String(customer.customerType || "").toLowerCase() === "particular" && !referralCode) {
          referralCode = await ensureReferralCode(tx, req.organizationId!, customer.id, customer.name);
        }

        const referrer = customer.referredByCustomerId
          ? await tx.customer.findFirst({
              where: { id: customer.referredByCustomerId },
              select: { id: true, name: true, customerType: true, referralCode: true },
            })
          : null;

        const referred = await tx.customer.findMany({
          where: { referredByCustomerId: id },
          select: { id: true, name: true, customerType: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        });

        const rewards = await tx.referralReward.findMany({
          where: { referrerCustomerId: id },
          orderBy: { creditedAt: "desc" },
          take: 100,
          include: {
            referredCustomer: { select: { id: true, name: true } },
          },
        });

        const ledger = await tx.referralLedgerEntry.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "desc" },
          take: 100,
        });

        const balance = await referralBalance(tx, id);
        const org = await tx.organization.findUniqueOrThrow({
          where: { id: req.organizationId! },
          select: { referralSettings: true },
        });

        return {
          settings: parseReferralSettings(org.referralSettings),
          customer,
          referralCode,
          referrer,
          referred,
          rewards,
          ledger,
          balance,
        };
      });
      if (!data) {
        res.status(404).json({ success: false, error: "Cliente não encontrado" });
        return;
      }
      res.json({
        success: true,
        data: {
          settings: data.settings,
          referral_code: data.referralCode,
          balance: money(data.balance, showMoney),
          referred_by: data.referrer
            ? {
                id: data.referrer.id,
                name: data.referrer.name,
                customer_type: data.referrer.customerType,
                referral_code: data.referrer.referralCode,
              }
            : null,
          referred_customers: data.referred.map((c) => ({
            id: c.id,
            name: c.name,
            customer_type: c.customerType,
            created_at: c.createdAt,
          })),
          rewards: data.rewards.map((r) => ({
            id: r.id,
            status: r.status,
            percent: Number(r.percent),
            project_amount: money(Number(r.projectAmount), showMoney),
            reward_amount: money(Number(r.rewardAmount), showMoney),
            invoice_id: r.invoiceId,
            credited_at: r.creditedAt,
            referred: { id: r.referredCustomer.id, name: r.referredCustomer.name },
          })),
          ledger: data.ledger.map((e) => ({
            id: e.id,
            type: e.type,
            amount: money(Number(e.amount), showMoney),
            notes: e.notes,
            invoice_id: e.invoiceId,
            created_at: e.createdAt,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Cashback balance for invoice payment UI. */
referralsRouter.get(
  "/api/customers/:id/referral-balance",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const showMoney = canViewPricing(req.user);
      const out = await withTenantTransaction(req.organizationId!, async (tx) => {
        const c = await tx.customer.findFirst({ where: { id }, select: { id: true } });
        if (!c) return null;
        const balance = await referralBalance(tx, id);
        return { balance };
      });
      if (!out) {
        res.status(404).json({ success: false, error: "Cliente não encontrado" });
        return;
      }
      res.json({ success: true, data: { balance: money(out.balance, showMoney) ?? 0 } });
    } catch (error) {
      next(error);
    }
  },
);
