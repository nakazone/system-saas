/**
 * Configurações › Agenda — mensagens SMS ao cliente.
 *
 *   GET  /api/settings/schedule-messages   settings.manage | schedule.view
 *   PUT  /api/settings/schedule-messages   settings.manage
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { fieldErrors } from "../../lib/settings/organization.js";
import { parseScheduleSettings, serializeScheduleSettings } from "../../lib/settings/schedule.js";
import {
  applyScheduleClientMessagesPut,
  scheduleClientMessagesPutSchema,
  serializeScheduleClientMessages,
} from "../../lib/settings/schedule-messages.js";

export const settingsScheduleMessagesRouter = Router();

function canRead(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return (
    perms.includes("settings.manage") ||
    perms.includes("schedule.view") ||
    perms.includes("schedule.manage") ||
    perms.includes("work_orders.view")
  );
}

settingsScheduleMessagesRouter.get(
  "/api/settings/schedule-messages",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canRead(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { name: true, scheduleSettings: true },
      });
      const settings = parseScheduleSettings(org.scheduleSettings);
      const payload = serializeScheduleClientMessages(settings.clientMessages);
      res.json({
        success: true,
        data: {
          ...payload,
          company_name: settings.clientMessages.company_name || org.name || null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

settingsScheduleMessagesRouter.put(
  "/api/settings/schedule-messages",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = scheduleClientMessagesPutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Revise as mensagens destacadas.",
          fields: fieldErrors(parsed.error),
        });
        return;
      }
      const orgId = req.organizationId!;
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { name: true, scheduleSettings: true },
      });
      const current = parseScheduleSettings(org.scheduleSettings);
      const clientMessages = applyScheduleClientMessagesPut(current.clientMessages, parsed.data);
      const next = { ...current, clientMessages };
      const stored = serializeScheduleSettings(next);

      await withTenantTransaction(orgId, async (tx) => {
        await tx.organization.update({
          where: { id: orgId },
          data: { scheduleSettings: stored as Prisma.InputJsonValue },
        });
        await recordActivity(tx, {
          organizationId: orgId,
          entityType: "organization",
          entityId: orgId,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.schedule_messages_updated",
          changes: null,
        });
      });

      const payload = serializeScheduleClientMessages(clientMessages);
      res.json({
        success: true,
        data: {
          ...payload,
          company_name: clientMessages.company_name || org.name || null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
