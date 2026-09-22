import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage/index.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import type { TenantRequest } from "../../lib/tenant/resolve-tenant.js";
import {
  brandPaletteToCss,
  buildBrandPalette,
  parseHexColor,
} from "../../lib/branding/palette.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";

export const brandingRouter = Router();

function orgBrandFields(org: {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}) {
  return buildBrandPalette({
    name: org.name,
    logoUrl: org.logoUrl,
    primaryColor: org.primaryColor,
    accentColor: org.accentColor,
  });
}

async function loadOrg(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
      accentColor: true,
    },
  });
}

/** Public per-tenant branding (login page needs this before auth). */
brandingRouter.get("/api/branding", async (req: TenantRequest, res, next) => {
  try {
    if (!req.organizationId) {
      res.status(404).json({ success: false, error: "Organization required" });
      return;
    }
    const org = await loadOrg(req.organizationId);
    if (!org) {
      res.status(404).json({ success: false, error: "Organization not found" });
      return;
    }
    res.json({ success: true, data: orgBrandFields(org) });
  } catch (error) {
    next(error);
  }
});

brandingRouter.get("/api/branding.css", async (req: TenantRequest, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, max-age=60");
    if (!req.organizationId) {
      res.type("text/css").send("/* no tenant */\n");
      return;
    }
    const org = await loadOrg(req.organizationId);
    if (!org) {
      res.type("text/css").send("/* org missing */\n");
      return;
    }
    res.type("text/css").send(brandPaletteToCss(orgBrandFields(org)));
  } catch (error) {
    next(error);
  }
});

brandingRouter.put(
  "/api/branding",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({
          name: z.string().min(2).max(120).optional(),
          primary_color: z.string().optional().nullable(),
          accent_color: z.string().optional().nullable(),
          logo_data_url: z.string().optional().nullable(),
          clear_logo: z.boolean().optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid branding payload" });
        return;
      }

      const data: {
        name?: string;
        primaryColor?: string | null;
        accentColor?: string | null;
        logoUrl?: string | null;
      } = {};

      if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();

      if (parsed.data.primary_color !== undefined) {
        if (!parsed.data.primary_color) data.primaryColor = null;
        else {
          const hex = parseHexColor(parsed.data.primary_color);
          if (!hex) {
            res.status(400).json({ success: false, error: "primary_color must be #RRGGBB" });
            return;
          }
          data.primaryColor = hex;
        }
      }

      if (parsed.data.accent_color !== undefined) {
        if (!parsed.data.accent_color) data.accentColor = null;
        else {
          const hex = parseHexColor(parsed.data.accent_color);
          if (!hex) {
            res.status(400).json({ success: false, error: "accent_color must be #RRGGBB" });
            return;
          }
          data.accentColor = hex;
        }
      }

      if (parsed.data.clear_logo) {
        data.logoUrl = null;
      } else if (parsed.data.logo_data_url?.startsWith("data:")) {
        const match = /^data:([^;]+);base64,(.+)$/.exec(parsed.data.logo_data_url);
        if (!match) {
          res.status(400).json({ success: false, error: "Invalid logo data URL" });
          return;
        }
        const contentType = match[1]!;
        if (!contentType.startsWith("image/")) {
          res.status(400).json({ success: false, error: "Logo must be an image" });
          return;
        }
        const body = Buffer.from(match[2]!, "base64");
        if (body.length > 2.5 * 1024 * 1024) {
          res.status(400).json({ success: false, error: "Logo must be under 2.5MB" });
          return;
        }
        const ext = contentType.includes("png")
          ? "png"
          : contentType.includes("webp")
            ? "webp"
            : contentType.includes("gif")
              ? "gif"
              : "jpg";
        const key = `orgs/${req.organizationId}/logo-${Date.now()}.${ext}`;
        const stored = await storage.upload({ key, body, contentType });
        data.logoUrl = stored.url;
      }

      const org = await prisma.organization.update({
        where: { id: req.organizationId! },
        data,
        select: {
          name: true,
          logoUrl: true,
          primaryColor: true,
          accentColor: true,
        },
      });

      // Keep in-request tenant snapshot fresh for subsequent handlers
      if (req.organization) {
        req.organization.name = org.name;
        req.organization.logoUrl = org.logoUrl;
        req.organization.primaryColor = org.primaryColor;
        req.organization.accentColor = org.accentColor;
      }

      res.json({ success: true, data: orgBrandFields(org), message: "Branding atualizado." });
    } catch (error) {
      next(error);
    }
  },
);
