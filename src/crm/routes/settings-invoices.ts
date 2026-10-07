/**
 * Configurações › Mensagens das Faturas (SMS).
 *
 *   GET   /api/settings/invoices   settings.manage | invoices.view
 *   PATCH /api/settings/invoices   settings.manage
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
  DEFAULT_INVOICE_SHARE_MESSAGES,
  invoiceSettingsPatchSchema,
  parseInvoiceSettings,
} from "../../lib/settings/invoices.js";

export const settingsInvoicesRouter = Router();

function canRead(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return perms.includes("settings.manage") || perms.includes("invoices.view") || perms.includes("invoices.manage");
}

async function loadInvoiceConfig(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, invoiceSettings: true },
  });
  const settings = parseInvoiceSettings(org.invoiceSettings);
  return {
    org,
    settings,
    data: {
      share_messages: settings.share_messages,
      company_name: org.name || null,
      tokens: ["[name]", "[company]", "[invoice_number]", "[amount]", "[balance]", "[due_date]", "[link]"],
      defaults: DEFAULT_INVOICE_SHARE_MESSAGES,
    },
  };
}

settingsInvoicesRouter.get(
  "/api/settings/invoices",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canRead(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      res.json({ success: true, data: (await loadInvoiceConfig(req.organizationId!)).data });
    } catch (error) {
      next(error);
    }
  },
);

settingsInvoicesRouter.patch(
  "/api/settings/invoices",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = invoiceSettingsPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Revise os campos destacados.",
          fields: fieldErrors(parsed.error),
        });
        return;
      }
      const orgId = req.organizationId!;
      const before = await loadInvoiceConfig(orgId);
      const p = parsed.data;
      if (!p.share_messages) {
        res.json({ success: true, data: before.data });
        return;
      }

      const nextSettings = {
        ...before.settings,
        share_messages: p.share_messages,
      };

      await prisma.organization.update({
        where: { id: orgId },
        data: { invoiceSettings: nextSettings as Prisma.InputJsonValue },
      });

      await withTenantTransaction(orgId, (tx) =>
        recordActivity(tx, {
          organizationId: orgId,
          entityType: "organization",
          entityId: orgId,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.invoices_updated",
          changes: {
            shareMessages: { from: before.settings.share_messages, to: p.share_messages },
          },
        }),
      );

      res.json({ success: true, data: (await loadInvoiceConfig(orgId)).data });
    } catch (error) {
      next(error);
    }
  },
);
