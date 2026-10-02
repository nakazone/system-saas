/**
 * Configurações › Agenda (calendars / cores).
 *
 *   GET  /api/settings/schedule   settings.manage | schedule.view
 *   PUT  /api/settings/schedule   settings.manage
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
  applyScheduleSettingsPut,
  mergeOrphanCalendars,
  parseScheduleSettings,
  scheduleSettingsPutSchema,
  serializeScheduleSettings,
} from "../../lib/settings/schedule.js";

export const settingsScheduleRouter = Router();

function canReadScheduleSettings(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return (
    perms.includes("settings.manage") ||
    perms.includes("schedule.view") ||
    perms.includes("schedule.manage")
  );
}

settingsScheduleRouter.get(
  "/api/settings/schedule",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canReadScheduleSettings(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { scheduleSettings: true },
      });
      let settings = parseScheduleSettings(org.scheduleSettings);

      // Register custom agendas already used on meetings but missing from settings.
      const used = await prisma.meeting.findMany({
        where: {
          organizationId: req.organizationId!,
          calendarId: { not: null },
        },
        select: { calendarId: true },
        distinct: ["calendarId"],
      });
      const merged = mergeOrphanCalendars(
        settings,
        used.map((r) => r.calendarId),
      );
      if (merged.added) {
        settings = merged.settings;
        const payload = serializeScheduleSettings(settings);
        await prisma.organization.update({
          where: { id: req.organizationId! },
          data: { scheduleSettings: payload as Prisma.InputJsonValue },
        });
      }

      res.json({ success: true, data: serializeScheduleSettings(settings) });
    } catch (error) {
      next(error);
    }
  },
);

settingsScheduleRouter.put(
  "/api/settings/schedule",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = scheduleSettingsPutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Revise as agendas destacadas.",
          fields: fieldErrors(parsed.error),
        });
        return;
      }
      const settings = applyScheduleSettingsPut(parsed.data);
      const payload = serializeScheduleSettings(settings);

      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.organization.update({
          where: { id: req.organizationId! },
          data: { scheduleSettings: payload as Prisma.InputJsonValue },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "organization",
          entityId: req.organizationId!,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.schedule_updated",
          changes: null,
        });
      });

      res.json({ success: true, data: payload });
    } catch (error) {
      next(error);
    }
  },
);
