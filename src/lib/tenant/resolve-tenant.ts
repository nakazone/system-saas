import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { subdomainTenantsSupported } from "./workspace-url.js";
import { isReservedTenantSlug } from "./reserved-slugs.js";

export type TenantRequest = Request & {
  organizationId?: string;
  organization?: {
    id: string;
    slug: string;
    name: string;
    status: string;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
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

/** Apex paths that work before a workspace is chosen (email-first login). */
const PUBLIC_AUTH_PATHS = new Set([
  "/login",
  "/login.html",
  "/api/auth/login",
  "/api/auth/session",
  "/api/auth/logout",
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
      accentColor: true,
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
      accentColor: true,
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

    if (subdomain && isReservedTenantSlug(subdomain)) {
      res.status(404).render("errors/not-found", {
        title: "Reserved hostname",
        message: "This subdomain is reserved for the ObraMate platform.",
        organization: null,
      });
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

    // Email-first login on apex (no workspace slug required)
    if (
      PUBLIC_AUTH_PATHS.has(req.path) ||
      req.path === "/logout" ||
      // Login page assets (css/js) before a workspace exists
      (/\.(css|js)$/i.test(req.path) &&
        !req.session?.organizationId &&
        !req.session?.workspaceSlug)
    ) {
      req.isPublicHost = true;
      next();
      return;
    }

    // CRM entry points without a session → login form (not find-workspace)
    if (
      req.path === "/dashboard.html" ||
      req.path === "/change-password.html" ||
      req.path === "/jobs.html" ||
      req.path === "/schedule.html" ||
      req.path === "/payroll-module.html" ||
      req.path === "/builder-pricing-admin.html" ||
      req.path === "/ajustes.html" ||
      req.path === "/products-erp.html" ||
      req.path === "/quote-catalog.html" ||
      req.path === "/quote-builder.html"
    ) {
      res.redirect("/login.html");
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
    const wantsJson =
      String(req.path || "").startsWith("/api/") ||
      String(req.headers.accept || "").includes("application/json");
    if (wantsJson) {
      res.status(404).json({
        success: false,
        error: "Organization required",
        code: "ORG_REQUIRED",
      });
      return;
    }
    res.status(404).render("errors/not-found", {
      title: "Organization required",
      message: subdomainTenantsSupported()
        ? "Access this application via your organization subdomain, or sign in at /login.html."
        : "Sign in at /login.html with your email and password.",
      organization: null,
    });
    return;
  }
  next();
}
