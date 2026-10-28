/** Configures whether partner portal submissions need review before becoming Jobs. */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { parsePartnerPortalSettings, partnerPortalSettingsPatchSchema } from "../../lib/settings/partner-portal.js";

export const settingsPartnerPortalRouter = Router();

function canRead(req: AuthedRequest): boolean {
  const permissions = req.user?.permissions || [];
  return req.user?.roleKey === "admin" || permissions.some((permission) =>
    ["settings.manage", "work_orders.view", "work_orders.manage"].includes(permission),
  );
}

settingsPartnerPortalRouter.get("/api/settings/partner-portal", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!canRead(req)) {
      res.status(403).json({ success: false, error: "Sem permissão" });
      return;
    }
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.organizationId! },
      select: { partnerPortalSettings: true },
    });
    res.json({
      success: true,
      data: {
        ...parsePartnerPortalSettings(org.partnerPortalSettings),
        can_edit: req.user?.roleKey === "admin" || Boolean(req.user?.permissions?.includes("settings.manage")),
      },
    });
  } catch (error) {
    next(error);
  }
});

settingsPartnerPortalRouter.patch(
  "/api/settings/partner-portal",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = partnerPortalSettingsPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Escolha como os pedidos do portal devem entrar em Jobs." });
        return;
      }
      const organizationId = req.organizationId!;
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { partnerPortalSettings: true },
      });
      const before = parsePartnerPortalSettings(org.partnerPortalSettings);
      const after = parsed.data;
      if (before.request_mode !== after.request_mode) {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { partnerPortalSettings: after as Prisma.InputJsonValue },
        });
        await withTenantTransaction(organizationId, (tx) => recordActivity(tx, {
          organizationId,
          entityType: "organization",
          entityId: organizationId,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.partner_portal_updated",
          changes: { requestMode: { from: before.request_mode, to: after.request_mode } },
        }));
      }
      res.json({ success: true, data: { ...after, can_edit: true } });
    } catch (error) {
      next(error);
    }
  },
);
