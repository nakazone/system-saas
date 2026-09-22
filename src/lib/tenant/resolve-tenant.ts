import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { subdomainTenantsSupported } from "./workspace-url.js";

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

const PUBLIC_MARKETING_PATHS = new Set([
  "/pricing",
  "/signup",
  "/find-workspace",
]);

function extractSubdomain(host: string, rootDomain: string): string | null {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  const root = rootDomain.toLowerCase();

  if (hostname === root || hostname === `www.${root}`) {
    return null;
  }

  if (hostname.endsWith(`.${root}`)) {
    const sub = hostname.slice(0, -(root.length + 1));
    if (!sub || sub.includes(".")) {
      return sub.includes(".") ? null : sub;
    }
    return sub;
  }

  if (root === "localhost" && hostname.endsWith(".localhost")) {
    const sub = hostname.replace(/\.localhost$/, "");
    return sub.includes(".") ? null : sub;
  }

  return null;
}

async function loadOrganizationBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
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
}

async function loadOrganizationById(id: string) {
  return prisma.organization.findUnique({
    where: { id },
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
}

function attachOrganization(
  req: TenantRequest,
  organization: NonNullable<Awaited<ReturnType<typeof loadOrganizationBySlug>>>,
): boolean {
  if (organization.status === "canceled") {
    return false;
  }
  req.organizationId = organization.id;
  req.organization = organization;
  return true;
}

/**
 * Resolves the tenant from subdomain (custom domains) or session workspace
 * (Railway default host / no wildcard DNS).
 */
export async function resolveTenant(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const host = req.get("host") ?? "";
    const subdomain = extractSubdomain(host, env.APP_ROOT_DOMAIN);

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

    if (subdomain) {
      const organization = await loadOrganizationBySlug(subdomain);
      if (!organization || !attachOrganization(req, organization)) {
        res.status(404).render("errors/not-found", {
          title: "Organization not found",
          message: "This organization does not exist or is no longer available.",
          organization: null,
        });
        return;
      }
      next();
      return;
    }

    // Apex host — marketing pages stay public
    const isMarketingPath =
      PUBLIC_MARKETING_PATHS.has(req.path) ||
      (req.path === "/" && !req.session?.userId && !req.session?.workspaceSlug);

    if (isMarketingPath) {
      req.isPublicHost = true;
      next();
      return;
    }

    // Session-based tenant (used when subdomain certs are unavailable)
    const workspaceSlug =
      typeof req.session?.workspaceSlug === "string"
        ? req.session.workspaceSlug.toLowerCase().trim()
        : "";
    const organizationId =
      typeof req.session?.organizationId === "string" ? req.session.organizationId : "";

    if (workspaceSlug) {
      const organization = await loadOrganizationBySlug(workspaceSlug);
      if (organization && attachOrganization(req, organization)) {
        next();
        return;
      }
    }

    if (organizationId) {
      const organization = await loadOrganizationById(organizationId);
      if (organization && attachOrganization(req, organization)) {
        if (req.session) {
          req.session.workspaceSlug = organization.slug;
        }
        next();
        return;
      }
    }

    // /login on apex without a workspace — send people to the finder
    if (req.path === "/login" || req.path === "/logout") {
      res.redirect("/find-workspace");
      return;
    }

    if (!subdomainTenantsSupported()) {
      req.isPublicHost = true;
      next();
      return;
    }

    req.isPublicHost = true;
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
      message: subdomainTenantsSupported()
        ? "Access this application via your organization subdomain."
        : "Open your workspace from Find your workspace, then sign in.",
      organization: null,
    });
    return;
  }
  next();
}
