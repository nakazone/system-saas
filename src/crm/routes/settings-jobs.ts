/**
 * Configurações › Jobs
 *
 *   GET   /api/settings/jobs   settings.manage | work_orders.view | schedule.view
 *   PATCH /api/settings/jobs   settings.manage
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { fieldErrors } from "../../lib/settings/organization.js";
import { primaryPack } from "../../lib/trades/index.js";
import {
  applyJobsSettingsPatch,
  jobsSettingsPatchSchema,
  parseJobsSettings,
} from "../../lib/settings/jobs.js";

export const settingsJobsRouter = Router();

/** The trade's phase with a shop lead time (Countertops install), for the settings screen; null when none. */
function leadTimeInfo(tradePacks: unknown) {
  const pack = primaryPack(tradePacks);
  const def = pack.phases.find((p) => p.leadTime);
  if (!def?.leadTime) return null;
  const after = pack.phases.find((p) => p.key === def.leadTime!.after);
  return { default_days: def.leadTime.businessDays, phase_label: def.label["pt-BR"], after_label: after?.label["pt-BR"] ?? def.leadTime.after };
}

function canReadJobsSettings(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return (
    perms.includes("settings.manage") ||
    perms.includes("work_orders.view") ||
    perms.includes("work_orders.manage") ||
    perms.includes("schedule.view") ||
    perms.includes("schedule.manage")
  );
}

settingsJobsRouter.get(
  "/api/settings/jobs",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canReadJobsSettings(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { featureFlags: true, tradePacks: true },
      });
      res.json({ success: true, data: { ...parseJobsSettings(org.featureFlags), lead_time: leadTimeInfo(org.tradePacks) } });
    } catch (error) {
      next(error);
    }
  },
);

settingsJobsRouter.patch(
  "/api/settings/jobs",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = jobsSettingsPatchSchema.safeParse(req.body ?? {});
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
          select: { featureFlags: true, tradePacks: true },
        });
        const nextFlags = applyJobsSettingsPatch(org.featureFlags, parsed.data);
        await tx.organization.update({
          where: { id: req.organizationId! },
          data: { featureFlags: nextFlags as Prisma.InputJsonValue },
        });
        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "organization",
          entityId: req.organizationId!,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.jobs_updated",
          changes: null,
        });
        return { ...parseJobsSettings(nextFlags), lead_time: leadTimeInfo(org.tradePacks) };
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);
