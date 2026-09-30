/**
 * Configurações (CRM) — company details and the settings overview.
 *
 *   GET    /api/settings/overview                        any signed-in user
 *   GET    /api/settings/organization                    settings.manage
 *   PATCH  /api/settings/organization                    settings.manage
 *   PUT    /api/settings/organization/insurance-certificate   settings.manage
 *   DELETE /api/settings/organization/insurance-certificate   settings.manage
 */
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage/index.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity, type ActivityChanges } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import {
  ORGANIZATION_SETTINGS_SELECT,
  PATCH_FIELD_MAP,
  buildSetupSteps,
  expiryAlerts,
  fieldErrors,
  organizationSettingsPatchSchema,
  serializeOrganizationSettings,
} from "../../lib/settings/organization.js";

export const settingsOrganizationRouter = Router();

function can(req: AuthedRequest, perm: string | null): boolean {
  if (!perm) return true;
  if (req.user?.roleKey === "admin") return true;
  return Boolean(req.user?.permissions.includes(perm));
}

async function loadSettings(organizationId: string) {
  return prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: ORGANIZATION_SETTINGS_SELECT,
  });
}

function comparable(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v ?? "");
}

settingsOrganizationRouter.get(
  "/api/settings/overview",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const orgId = req.organizationId!;
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: {
          name: true,
          status: true,
          plan: true,
          trialEndsAt: true,
          logoUrl: true,
          contactPhone: true,
          contactEmail: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          licenseNumber: true,
          licenseExpiresOn: true,
          defaultQuoteTerms: true,
          insuranceExpiresOn: true,
        },
      });
      const facts = await withTenantTransaction(orgId, async (tx) => {
        const [pricing, catalog, activeUsers, quotes, push] = await Promise.all([
          tx.pricingItem.count({ where: { active: true } }),
          tx.quoteCatalogItem.count({ where: { active: true } }),
          tx.user.count({ where: { status: "active" } }),
          tx.quote.count(),
          tx.pushSubscription.count({ where: { userId: req.user!.id } }),
        ]);
        return { pricingCount: pricing + catalog, activeUsers, quoteCount: quotes, viewerHasPush: push > 0 };
      });
      const steps = buildSetupSteps({
        hasLogo: Boolean(org.logoUrl),
        hasContact: Boolean(org.contactPhone && org.contactEmail),
        hasAddress: Boolean(org.addressLine1 && org.city && org.state && org.postalCode),
        hasLicense: Boolean(org.licenseNumber),
        hasQuoteTerms: Boolean(org.defaultQuoteTerms && org.defaultQuoteTerms.trim()),
        ...facts,
      });
      const canManage = can(req, "settings.manage");
      const now = new Date();
      res.json({
        success: true,
        data: {
          organization: {
            name: org.name,
            status: org.status,
            plan: org.plan,
            trial_days_left: org.trialEndsAt
              ? Math.max(0, Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / 86_400_000))
              : null,
          },
          // Steps the viewer cannot act on are still counted but not linked.
          setup: steps.map((s) => ({ ...s, can_open: can(req, s.perm) })),
          alerts: canManage ? expiryAlerts(org, now) : [],
          counts: { active_users: facts.activeUsers, pricing_items: facts.pricingCount },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

settingsOrganizationRouter.get(
  "/api/settings/organization",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const org = await loadSettings(req.organizationId!);
      res.json({ success: true, data: serializeOrganizationSettings(org) });
    } catch (error) {
      next(error);
    }
  },
);

settingsOrganizationRouter.patch(
  "/api/settings/organization",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = organizationSettingsPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Revise os campos destacados.",
          fields: fieldErrors(parsed.error),
        });
        return;
      }
      const orgId = req.organizationId!;
      const before = await loadSettings(orgId);
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value === undefined) continue;
        const column = PATCH_FIELD_MAP[key as keyof typeof PATCH_FIELD_MAP];
        data[column] = value;
      }

      const changes: ActivityChanges = {};
      for (const [column, to] of Object.entries(data)) {
        const from = (before as Record<string, unknown>)[column];
        if (comparable(from) !== comparable(to)) {
          changes[column] = { from: comparable(from) || null, to: comparable(to) || null };
        }
      }

      if (Object.keys(changes).length === 0) {
        res.json({ success: true, data: serializeOrganizationSettings(before), changed: [] });
        return;
      }

      const updated = await prisma.organization.update({
        where: { id: orgId },
        data: data as Prisma.OrganizationUpdateInput,
        select: ORGANIZATION_SETTINGS_SELECT,
      });

      await withTenantTransaction(orgId, async (tx) => {
        await recordActivity(tx, {
          organizationId: orgId,
          entityType: "organization",
          entityId: orgId,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.updated",
          changes,
        });
      });

      if (req.organization) {
        req.organization.name = updated.name;
      }

      res.json({
        success: true,
        data: serializeOrganizationSettings(updated),
        changed: Object.keys(changes),
      });
    } catch (error) {
      next(error);
    }
  },
);

const CERT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

settingsOrganizationRouter.put(
  "/api/settings/organization/insurance-certificate",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z.object({ data_url: z.string().min(20) }).safeParse(req.body ?? {});
      const match = parsed.success ? /^data:([^;]+);base64,(.+)$/.exec(parsed.data.data_url) : null;
      const ext = match ? CERT_TYPES[match[1]!] : undefined;
      if (!match || !ext) {
        res.status(400).json({ success: false, error: "Envie um PDF ou imagem (PNG/JPG)." });
        return;
      }
      const body = Buffer.from(match[2]!, "base64");
      if (body.length > 5 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "O arquivo deve ter no máximo 5 MB." });
        return;
      }
      const orgId = req.organizationId!;
      const stored = await storage.upload({
        key: `orgs/${orgId}/insurance-certificate-${Date.now()}.${ext}`,
        body,
        contentType: match[1]!,
      });
      const updated = await prisma.organization.update({
        where: { id: orgId },
        data: { insuranceCertificateUrl: stored.url },
        select: ORGANIZATION_SETTINGS_SELECT,
      });
      await withTenantTransaction(orgId, async (tx) => {
        await recordActivity(tx, {
          organizationId: orgId,
          entityType: "organization",
          entityId: orgId,
          actorType: "user",
          actorId: req.user!.id,
          action: "settings.insurance_certificate_uploaded",
        });
      });
      res.json({ success: true, data: serializeOrganizationSettings(updated) });
    } catch (error) {
      next(error);
    }
  },
);

settingsOrganizationRouter.delete(
  "/api/settings/organization/insurance-certificate",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const updated = await prisma.organization.update({
        where: { id: req.organizationId! },
        data: { insuranceCertificateUrl: null },
        select: ORGANIZATION_SETTINGS_SELECT,
      });
      res.json({ success: true, data: serializeOrganizationSettings(updated) });
    } catch (error) {
      next(error);
    }
  },
);
