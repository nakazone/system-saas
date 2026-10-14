/**
 * Configurações › Indicações
 *
 *   GET   /api/settings/referrals   settings.manage | customers.view | invoices.view
 *   PATCH /api/settings/referrals   settings.manage
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { fieldErrors } from "../../lib/settings/organization.js";
import {
  applyReferralSettingsPatch,
  parseReferralSettings,
  referralSettingsPatchSchema,
} from "../../lib/referrals/settings.js";

export const settingsReferralsRouter = Router();

function canRead(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return (
    perms.includes("settings.manage") ||
    perms.includes("customers.view") ||
    perms.includes("customers.edit") ||
    perms.includes("invoices.view") ||
    perms.includes("invoices.record_payment")
  );
}

settingsReferralsRouter.get(
  "/api/settings/referrals",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canRead(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { referralSettings: true },
      });
      res.json({ success: true, data: parseReferralSettings(org.referralSettings) });
    } catch (error) {
      next(error);
    }
  },
);

settingsReferralsRouter.patch(
  "/api/settings/referrals",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = referralSettingsPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Revise as opções destacadas.",
          fields: fieldErrors(parsed.error),
        });
        return;
      }
      if (Object.keys(parsed.data).length === 0) {
        res.status(400).json({ success: false, error: "Nenhuma alteração enviada." });
        return;
      }

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const org = await tx.organization.findUniqueOrThrow({
          where: { id: req.organizationId! },
          select: { referralSettings: true },
        });
        const next = applyReferralSettingsPatch(org.referralSettings, parsed.data);
        await tx.organization.update({
          where: { id: req.organizationId! },
          data: { referralSettings: next as Prisma.InputJsonValue },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "organization",
          entityId: req.organizationId!,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.referrals_updated",
          changes: null,
        });
        return next;
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);
