import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";

export type TenantRequest = Request & {
  organizationId?: string;
  organization?: {
    id: string;
    slug: string;
    name: string;
    status: string;
    logoUrl: string | null;
    primaryColor: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  };
  isPlatformAdminHost?: boolean;
  isPublicHost?: boolean;
};

function extractSubdomain(host: string, rootDomain: string): string | null {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  const root = rootDomain.toLowerCase();

  if (hostname === root || hostname === `www.${root}`) {
    return null;
  }

  if (hostname.endsWith(`.${root}`)) {
    const sub = hostname.slice(0, -(root.length + 1));
    if (!sub || sub.includes(".")) {
      // Only single-level subdomains are supported in v1
      return sub.includes(".") ? null : sub;
    }
    return sub;
  }

  // Local development convenience: org-a.localhost
  if (root === "localhost" && hostname.endsWith(".localhost")) {
    const sub = hostname.replace(/\.localhost$/, "");
    return sub.includes(".") ? null : sub;
  }

  return null;
}

/**
 * Resolves the tenant from the request subdomain and attaches organization context.
 * Skips: root domain (signup), admin subdomain, health, and public quote tokens.
 */
export async function resolveTenant(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const host = req.get("host") ?? "";
    const subdomain = extractSubdomain(host, env.APP_ROOT_DOMAIN);

    // Paths that never require a tenant
    if (req.path === "/health" || req.path.startsWith("/public/")) {
      req.isPublicHost = true;
      next();
      return;
    }

    if (subdomain === "admin") {
      req.isPlatformAdminHost = true;
      next();
      return;
    }

    // Root domain: signup / landing only
    if (!subdomain) {
      req.isPublicHost = true;
      next();
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { slug: subdomain },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        logoUrl: true,
        primaryColor: true,
        contactEmail: true,
        contactPhone: true,
      },
    });

    if (!organization || organization.status === "canceled") {
      res.status(404).render("errors/not-found", {
        title: "Organization not found",
        message: "This organization does not exist or is no longer available.",
        organization: null,
      });
      return;
    }

    req.organizationId = organization.id;
    req.organization = organization;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireTenant(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.organizationId || !req.organization) {
    res.status(404).render("errors/not-found", {
      title: "Organization required",
      message: "Access this application via your organization subdomain.",
      organization: null,
    });
    return;
  }
  next();
}
