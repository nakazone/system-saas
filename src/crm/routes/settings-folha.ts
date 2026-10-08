/**
 * Configurações › Folha — ciclo de fechamento
 *
 *   GET   /api/settings/folha   settings.manage | payroll.view
 *   PATCH /api/settings/folha   settings.manage
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
  WEEKDAY_LABELS_PT,
  WEEKDAY_SHORT_PT,
  applyPayCyclePatch,
  describePayCycle,
  endWeekdayFromLength,
  parsePayCycle,
  parseReimbursementTiming,
  payCyclePatchSchema,
  periodBoundsFor,
  previewPeriods,
} from "../../lib/settings/payroll-cycle.js";
import { ymdFromDate } from "../../crm/lib/payroll-calc.js";

export const settingsFolhaRouter = Router();

function canRead(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return (
    perms.includes("settings.manage") ||
    perms.includes("payroll.view") ||
    perms.includes("payroll.manage")
  );
}

function serialize(featureFlags: unknown, refYmd?: string) {
  const cycle = parsePayCycle(featureFlags);
  const reimbursement_timing = parseReimbursementTiming(featureFlags);
  const ref = refYmd && /^\d{4}-\d{2}-\d{2}$/.test(refYmd) ? refYmd : ymdFromDate(new Date());
  const current = periodBoundsFor(ref, cycle);
  return {
    cycle: { ...cycle, reimbursement_timing },
    reimbursement_timing,
    summary: describePayCycle(cycle),
    period_end_weekday: endWeekdayFromLength(cycle.period_start_weekday, cycle.period_length_days),
    weekday_labels: WEEKDAY_LABELS_PT,
    weekday_short: WEEKDAY_SHORT_PT,
    preview: {
      ref,
      current,
      upcoming: previewPeriods(ref, cycle, 4),
    },
  };
}

settingsFolhaRouter.get(
  "/api/settings/folha",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canRead(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      const ref = typeof req.query.ref === "string" ? req.query.ref : undefined;
      res.json({ success: true, data: serialize(org.featureFlags, ref) });
    } catch (error) {
      next(error);
    }
  },
);

settingsFolhaRouter.post(
  "/api/settings/folha/preview",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canRead(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const parsed = payCyclePatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Opções inválidas", fields: fieldErrors(parsed.error) });
        return;
      }
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { featureFlags: true },
      });
      const flags = applyPayCyclePatch(org.featureFlags, parsed.data);
      res.json({ success: true, data: serialize(flags) });
    } catch (error) {
      next(error);
    }
  },
);

settingsFolhaRouter.patch(
  "/api/settings/folha",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = payCyclePatchSchema.safeParse(req.body ?? {});
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
          select: { featureFlags: true },
        });
        const nextFlags = applyPayCyclePatch(org.featureFlags, parsed.data);
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
          action: "settings.folha_cycle_updated",
          changes: null,
        });
        return serialize(nextFlags);
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);
