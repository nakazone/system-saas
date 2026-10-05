/**
 * Configurações › Mensagens padrão por fase.
 *
 *   GET   /api/settings/lead-messages   settings.manage | leads.view
 *   PUT   /api/settings/lead-messages   settings.manage
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { fieldErrors } from "../../lib/settings/organization.js";
import { CANONICAL_STAGE_ORDER } from "../../lib/dashboard/stages.js";
import {
  defaultLeadMessageSettings,
  leadMessageSettingsPutSchema,
  parseLeadMessageSettings,
  serializeLeadMessageSettings,
  type LeadMessageSettings,
  type LeadStageMessages,
} from "../../lib/settings/lead-messages.js";

export const settingsLeadMessagesRouter = Router();

function canReadLeadMessages(req: AuthedRequest): boolean {
  const perms = req.user?.permissions || [];
  if (req.user?.roleKey === "admin") return true;
  return perms.includes("settings.manage") || perms.includes("leads.view");
}

async function loadOrgMessages(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, leadMessageSettings: true },
  });
  const settings = parseLeadMessageSettings(org.leadMessageSettings);
  return { org, settings };
}

function toPublicPayload(settings: LeadMessageSettings, orgName: string) {
  const serialized = serializeLeadMessageSettings(settings);
  return {
    company_name: settings.company_name || orgName || null,
    default_email_subject: settings.default_email_subject,
    coupon_enabled: settings.coupon_enabled,
    coupon_code: settings.coupon_code,
    coupon_label: settings.coupon_label,
    coupon_sms_line: settings.coupon_sms_line,
    stages: serialized.stages,
    tokens: ["[name]", "[company]", "[coupon]"],
  };
}

settingsLeadMessagesRouter.get(
  "/api/settings/lead-messages",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      if (!canReadLeadMessages(req)) {
        res.status(403).json({ success: false, error: "Sem permissão" });
        return;
      }
      const { org, settings } = await loadOrgMessages(req.organizationId!);
      res.json({ success: true, data: toPublicPayload(settings, org.name) });
    } catch (error) {
      next(error);
    }
  },
);

settingsLeadMessagesRouter.put(
  "/api/settings/lead-messages",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = leadMessageSettingsPutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Revise as mensagens destacadas.",
          fields: fieldErrors(parsed.error),
        });
        return;
      }
      const orgId = req.organizationId!;
      const p = parsed.data;
      const defaults = defaultLeadMessageSettings();
      const stages = {} as LeadMessageSettings["stages"];
      for (const slug of CANONICAL_STAGE_ORDER) {
        const incoming = p.stages[slug];
        const fallback = defaults.stages[slug]!;
        stages[slug] = {
          email_subject:
            incoming?.email_subject !== undefined
              ? incoming.email_subject
                ? String(incoming.email_subject).trim() || null
                : null
              : fallback.email_subject,
          templates: (incoming?.templates || fallback.templates).map((t) => {
            const action =
              t.on_send_action && t.on_send_action.set_priority
                ? { set_priority: t.on_send_action.set_priority }
                : t.id === "follow_up_last_check"
                  ? { set_priority: "low" as const }
                  : null;
            return {
              id: t.id,
              label: t.label,
              body: t.body,
              on_send_action: action,
            };
          }),
        } satisfies LeadStageMessages;
      }
      const next: LeadMessageSettings = {
        company_name:
          p.company_name !== undefined
            ? p.company_name
              ? String(p.company_name).trim() || null
              : null
            : defaults.company_name,
        default_email_subject:
          p.default_email_subject !== undefined
            ? p.default_email_subject
              ? String(p.default_email_subject).trim() || null
              : null
            : defaults.default_email_subject,
        coupon_enabled: p.coupon_enabled !== undefined ? !!p.coupon_enabled : defaults.coupon_enabled,
        coupon_code:
          p.coupon_code !== undefined
            ? p.coupon_code
              ? String(p.coupon_code).trim() || null
              : null
            : defaults.coupon_code,
        coupon_label:
          p.coupon_label !== undefined
            ? p.coupon_label
              ? String(p.coupon_label).trim() || null
              : null
            : defaults.coupon_label,
        coupon_sms_line:
          p.coupon_sms_line !== undefined
            ? p.coupon_sms_line
              ? String(p.coupon_sms_line).trim() || null
              : null
            : defaults.coupon_sms_line,
        stages,
      };

      const org = await prisma.organization.update({
        where: { id: orgId },
        data: { leadMessageSettings: next as unknown as Prisma.InputJsonValue },
        select: { name: true, leadMessageSettings: true },
      });

      await withTenantTransaction(orgId, (tx) =>
        recordActivity(tx, {
          organizationId: orgId,
          entityType: "organization",
          entityId: orgId,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.lead_messages_updated",
          changes: null,
        }),
      );

      const settings = parseLeadMessageSettings(org.leadMessageSettings);
      res.json({ success: true, data: toPublicPayload(settings, org.name) });
    } catch (error) {
      next(error);
    }
  },
);
