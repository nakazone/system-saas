/**
 * Configurações › Automações de Leads.
 *
 *   GET   /api/settings/lead-automations   settings.manage | leads.view
 *   PUT   /api/settings/lead-automations   settings.manage
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { fieldErrors } from "../../lib/settings/organization.js";
import {
  DEFAULT_AUTOMATION_SETTINGS,
  parseAutomationSettings,
} from "../../lib/automations/settings.js";

export const settingsLeadAutomationsRouter = Router();

function canRead(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return perms.includes("settings.manage") || perms.includes("leads.view");
}

const putSchema = z.object({
  quoteSentAutoFollowUpStageEnabled: z.boolean().optional(),
  quoteFollowUpDays: z.coerce.number().int().min(0).max(90).optional(),
  quoteFollowUpEnabled: z.boolean().optional(),
});

settingsLeadAutomationsRouter.get(
  "/api/settings/lead-automations",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canRead(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { automationSettings: true },
      });
      const settings = parseAutomationSettings(org.automationSettings);
      res.json({
        success: true,
        data: {
          quoteSentAutoFollowUpStageEnabled: settings.quoteSentAutoFollowUpStageEnabled,
          quoteFollowUpDays: settings.quoteFollowUpDays,
          quoteFollowUpEnabled: settings.quoteFollowUpEnabled,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

settingsLeadAutomationsRouter.put(
  "/api/settings/lead-automations",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = putSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Revise os campos destacados.",
          fields: fieldErrors(parsed.error),
        });
        return;
      }
      const orgId = req.organizationId!;
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { automationSettings: true },
      });
      const current = parseAutomationSettings(org.automationSettings);
      const next = {
        ...DEFAULT_AUTOMATION_SETTINGS,
        ...current,
        ...(parsed.data.quoteSentAutoFollowUpStageEnabled !== undefined
          ? { quoteSentAutoFollowUpStageEnabled: parsed.data.quoteSentAutoFollowUpStageEnabled }
          : {}),
        ...(parsed.data.quoteFollowUpDays !== undefined
          ? { quoteFollowUpDays: parsed.data.quoteFollowUpDays }
          : {}),
        ...(parsed.data.quoteFollowUpEnabled !== undefined
          ? { quoteFollowUpEnabled: parsed.data.quoteFollowUpEnabled }
          : {}),
      };

      await prisma.organization.update({
        where: { id: orgId },
        data: { automationSettings: next as unknown as Prisma.InputJsonValue },
      });

      await withTenantTransaction(orgId, (tx) =>
        recordActivity(tx, {
          organizationId: orgId,
          entityType: "organization",
          entityId: orgId,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.lead_automations_updated",
          changes: null,
        }),
      );

      res.json({
        success: true,
        data: {
          quoteSentAutoFollowUpStageEnabled: next.quoteSentAutoFollowUpStageEnabled,
          quoteFollowUpDays: next.quoteFollowUpDays,
          quoteFollowUpEnabled: next.quoteFollowUpEnabled,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
