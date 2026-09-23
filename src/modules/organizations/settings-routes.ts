import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { storage } from "../../lib/storage/index.js";
import { prisma } from "../../lib/prisma.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get(
  "/",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
      });
      const estimateRules = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.estimateRule.findMany({ orderBy: { flooringType: "asc" } });
      });
      const roles = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.role.findMany({
          include: { permissions: { include: { permission: true } } },
          orderBy: { name: "asc" },
        });
      });
      const permissions = await prisma.permission.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
      const addOns = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.quoteAddOn.findMany({ orderBy: { sortOrder: "asc" } });
      });

      res.render("settings/index", {
        title: "Settings",
        organization,
        user: req.user,
        estimateRules,
        roles,
        permissions,
        addOns,
        canViewPricing: req.user?.permissions.includes("pricing.view") || req.user?.roleKey === "admin",
        error: null,
        success: req.query.saved === "1" ? "Settings saved." : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.post(
  "/organization",
  requirePermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(120),
        primaryColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional()
          .or(z.literal("")),
        accentColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional()
          .or(z.literal("")),
        contactEmail: z.string().email().optional().or(z.literal("")),
        contactPhone: z.string().max(40).optional().or(z.literal("")),
        timezone: z.string().min(3).max(64).optional().or(z.literal("")),
        quoteValidityDays: z.coerce.number().int().min(1).max(365).optional(),
        defaultQuoteTerms: z.string().max(20000).optional().or(z.literal("")),
        quoteTaxRate: z.coerce.number().min(0).max(100).optional(),
        paymentInstructions: z.string().max(5000).optional().or(z.literal("")),
        logoDataUrl: z.string().optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/settings?error=1");
        return;
      }

      let logoUrl: string | undefined;
      if (parsed.data.logoDataUrl?.startsWith("data:")) {
        const match = /^data:([^;]+);base64,(.+)$/.exec(parsed.data.logoDataUrl);
        if (match) {
          const contentType = match[1]!;
          const body = Buffer.from(match[2]!, "base64");
          const key = `orgs/${req.organizationId}/logo-${Date.now()}`;
          const stored = await storage.upload({ key, body, contentType });
          logoUrl = stored.url;
        }
      }

      await prisma.organization.update({
        where: { id: req.organizationId! },
        data: {
          name: parsed.data.name,
          primaryColor: parsed.data.primaryColor || null,
          accentColor: parsed.data.accentColor || null,
          contactEmail: parsed.data.contactEmail || null,
          contactPhone: parsed.data.contactPhone || null,
          ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
          ...(parsed.data.quoteValidityDays != null
            ? { quoteValidityDays: parsed.data.quoteValidityDays }
            : {}),
          defaultQuoteTerms: parsed.data.defaultQuoteTerms || null,
          ...(parsed.data.quoteTaxRate != null
            ? { quoteTaxRate: parsed.data.quoteTaxRate }
            : {}),
          paymentInstructions: parsed.data.paymentInstructions || null,
          ...(logoUrl ? { logoUrl } : {}),
        },
      });

      res.redirect("/settings?saved=1");
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.post(
  "/estimate-rules",
  requirePermission("estimate_rules.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        id: z.string().uuid(),
        wastePercent: z.coerce.number().min(0).max(100),
        materialMarkup: z.coerce.number().min(0).max(500),
        laborMarkup: z.coerce.number().min(0).max(500),
        defaultPricePerSqft: z.coerce.number().min(0),
        defaultLaborPerSqft: z.coerce.number().min(0),
      });

      // Support multiple rows posted as arrays or single
      const ids = Array.isArray(req.body.id) ? req.body.id : [req.body.id];
      for (let i = 0; i < ids.length; i++) {
        const row = {
          id: Array.isArray(req.body.id) ? req.body.id[i] : req.body.id,
          wastePercent: Array.isArray(req.body.wastePercent)
            ? req.body.wastePercent[i]
            : req.body.wastePercent,
          materialMarkup: Array.isArray(req.body.materialMarkup)
            ? req.body.materialMarkup[i]
            : req.body.materialMarkup,
          laborMarkup: Array.isArray(req.body.laborMarkup)
            ? req.body.laborMarkup[i]
            : req.body.laborMarkup,
          defaultPricePerSqft: Array.isArray(req.body.defaultPricePerSqft)
            ? req.body.defaultPricePerSqft[i]
            : req.body.defaultPricePerSqft,
          defaultLaborPerSqft: Array.isArray(req.body.defaultLaborPerSqft)
            ? req.body.defaultLaborPerSqft[i]
            : req.body.defaultLaborPerSqft,
        };
        const parsed = schema.safeParse(row);
        if (!parsed.success) continue;

        await withTenantTransaction(req.organizationId!, async (tx) => {
          await tx.estimateRule.update({
            where: { id: parsed.data.id },
            data: {
              wastePercent: parsed.data.wastePercent,
              materialMarkup: parsed.data.materialMarkup,
              laborMarkup: parsed.data.laborMarkup,
              defaultPricePerSqft: parsed.data.defaultPricePerSqft,
              defaultLaborPerSqft: parsed.data.defaultLaborPerSqft,
            },
          });
        });
      }

      res.redirect("/settings?saved=1");
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.post(
  "/roles",
  requirePermission("roles.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        key: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z][a-z0-9_]*$/),
        name: z.string().min(2).max(80),
        permissionKeys: z.union([z.string(), z.array(z.string())]).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/settings?error=1");
        return;
      }

      const keys = parsed.data.permissionKeys
        ? Array.isArray(parsed.data.permissionKeys)
          ? parsed.data.permissionKeys
          : [parsed.data.permissionKeys]
        : [];

      await withTenantTransaction(req.organizationId!, async (tx) => {
        const role = await tx.role.create({
          data: {
            organizationId: req.organizationId!,
            key: parsed.data.key,
            name: parsed.data.name,
            isSystem: false,
          },
        });
        const permissions = await prisma.permission.findMany({
          where: { key: { in: keys } },
        });
        for (const permission of permissions) {
          await prisma.rolePermission.create({
            data: { roleId: role.id, permissionId: permission.id },
          });
        }
      });

      res.redirect("/settings?saved=1");
    } catch (error) {
      next(error);
    }
  },
);
