import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { createOrganizationWithAdmin, validateSlug } from "./service.js";
import { env } from "../../config/env.js";
import {
  subdomainTenantsSupported,
  workspaceHomeUrl,
  workspaceLoginUrl,
} from "../../lib/tenant/workspace-url.js";

export const organizationsRouter = Router();

function publicLocals(extra: Record<string, unknown> = {}) {
  return {
    organization: null,
    productName: env.PRODUCT_NAME,
    appRootDomain: env.APP_ROOT_DOMAIN,
    appBaseUrl: env.APP_BASE_URL,
    subdomainTenants: subdomainTenantsSupported(),
    ...extra,
  };
}

organizationsRouter.get("/pricing", (_req, res) => {
  res.render(
    "marketing/pricing",
    publicLocals({
      title: "Pricing",
    }),
  );
});

organizationsRouter.get("/find-workspace", (_req, res) => {
  res.render(
    "marketing/find-workspace",
    publicLocals({
      title: "Find your workspace",
      error: null,
      values: {},
    }),
  );
});

organizationsRouter.post("/find-workspace", (req, res) => {
  const schema = z.object({
    slug: z.string().min(2).max(48),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).render(
      "marketing/find-workspace",
      publicLocals({
        title: "Find your workspace",
        error: "Enter your organization subdomain slug.",
        values: req.body,
      }),
    );
    return;
  }

  const slug = parsed.data.slug.toLowerCase().trim();
  const slugError = validateSlug(slug);
  if (slugError) {
    res.status(400).render(
      "marketing/find-workspace",
      publicLocals({
        title: "Find your workspace",
        error: slugError,
        values: req.body,
      }),
    );
    return;
  }

  // Stay on the apex host when subdomain TLS is unavailable (Railway default).
  req.session.workspaceSlug = slug;
  res.redirect(workspaceLoginUrl(slug));
});

organizationsRouter.get("/signup", (req, res) => {
  if ((req as AuthedRequest).organizationId) {
    res.redirect("/");
    return;
  }
  res.render(
    "organizations/signup",
    publicLocals({
      title: "Create organization",
      error: null,
      values: {},
    }),
  );
});

organizationsRouter.post("/signup", async (req, res, next) => {
  try {
    const schema = z.object({
      organizationName: z.string().min(2).max(120),
      slug: z.string().min(2).max(48),
      adminName: z.string().min(2).max(120),
      adminEmail: z.string().email(),
      password: z.string().min(8).max(128),
      contactEmail: z.string().email().optional().or(z.literal("")),
      contactPhone: z.string().max(40).optional().or(z.literal("")),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).render(
        "organizations/signup",
        publicLocals({
          title: "Create organization",
          error: "Please check the form fields and try again.",
          values: req.body,
        }),
      );
      return;
    }

    const data = parsed.data;
    const slug = data.slug.toLowerCase();
    const slugError = validateSlug(slug);
    if (slugError) {
      res.status(400).render(
        "organizations/signup",
        publicLocals({
          title: "Create organization",
          error: slugError,
          values: req.body,
        }),
      );
      return;
    }

    const { organization, admin } = await createOrganizationWithAdmin({
      organizationName: data.organizationName,
      slug,
      adminName: data.adminName,
      adminEmail: data.adminEmail,
      password: data.password,
      contactEmail: data.contactEmail || undefined,
      contactPhone: data.contactPhone || undefined,
    });

    req.session.userId = admin.id;
    req.session.organizationId = organization.id;
    req.session.workspaceSlug = organization.slug;

    res.render(
      "organizations/signup-success",
      publicLocals({
        title: "Workspace ready",
        organizationName: organization.name,
        slug: organization.slug,
        workspaceUrl: workspaceHomeUrl(organization.slug),
        loginUrl: workspaceLoginUrl(organization.slug),
        subdomainTenants: subdomainTenantsSupported(),
      }),
    );
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).render(
        "organizations/signup",
        publicLocals({
          title: "Create organization",
          error: error.message,
          values: req.body,
        }),
      );
      return;
    }
    next(error);
  }
});
