import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { prisma } from "../../lib/prisma.js";
import {
  DEFAULT_AUTOMATION_SETTINGS,
  parseAutomationSettings,
} from "../../lib/automations/settings.js";
import { processDueScheduledMessages } from "../../lib/automations/worker.js";

export const automationsRouter = Router();
automationsRouter.use(requireAuth);

automationsRouter.get(
  "/",
  requirePermission("automations.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
      });
      const settings = parseAutomationSettings(org.automationSettings);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const pending = await tx.scheduledMessage.findMany({
          where: { status: { in: ["pending", "processing"] } },
          orderBy: { scheduledFor: "asc" },
          take: 50,
        });
        const logs = await tx.communicationLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return { pending, logs };
      });
      res.render("settings/automations", {
        title: "Automations",
        organization: req.organization,
        user: req.user,
        settings,
        pending: data.pending,
        logs: data.logs,
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

automationsRouter.post(
  "/",
  requirePermission("automations.manage"),
  async (req: AuthedRequest, res, _next) => {
    try {
      const schema = z.object({
        quoteFollowUpEnabled: z.string().optional(),
        quoteFollowUpDays: z.coerce.number().int().min(0).max(90),
        visitReminderEnabled: z.string().optional(),
        visitReminderHours: z.coerce.number().int().min(0).max(168),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/settings/automations?error=1");
        return;
      }
      const settings = {
        ...DEFAULT_AUTOMATION_SETTINGS,
        quoteFollowUpEnabled: parsed.data.quoteFollowUpEnabled === "on",
        quoteFollowUpDays: parsed.data.quoteFollowUpDays,
        visitReminderEnabled: parsed.data.visitReminderEnabled === "on",
        visitReminderHours: parsed.data.visitReminderHours,
      };
      await prisma.organization.update({
        where: { id: req.organizationId! },
        data: { automationSettings: settings as unknown as Prisma.InputJsonValue },
      });
      res.redirect("/settings/automations?success=saved");
    } catch (error) {
      res.redirect("/settings/automations?error=1");
    }
  },
);

automationsRouter.post(
  "/run-due",
  requirePermission("automations.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await processDueScheduledMessages();
      res.redirect(
        `/settings/automations?success=${encodeURIComponent(
          `Processed ${result.processed}: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`,
        )}`,
      );
    } catch (error) {
      next(error);
    }
  },
);
