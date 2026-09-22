import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { createOrganizationWithAdmin, validateSlug } from "./service.js";
import { env } from "../../config/env.js";

export const organizationsRouter = Router();

organizationsRouter.get("/signup", (req, res) => {
  if ((req as AuthedRequest).organizationId) {
    res.redirect("/");
    return;
  }
  res.render("organizations/signup", {
    title: "Create organization",
    organization: null,
    error: null,
    values: {},
    appRootDomain: env.APP_ROOT_DOMAIN,
  });
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
      res.status(400).render("organizations/signup", {
        title: "Create organization",
        organization: null,
        error: "Please check the form fields and try again.",
        values: req.body,
        appRootDomain: env.APP_ROOT_DOMAIN,
      });
      return;
    }

    const data = parsed.data;
    const slugError = validateSlug(data.slug.toLowerCase());
    if (slugError) {
      res.status(400).render("organizations/signup", {
        title: "Create organization",
        organization: null,
        error: slugError,
        values: req.body,
        appRootDomain: env.APP_ROOT_DOMAIN,
      });
      return;
    }

    const { organization, admin } = await createOrganizationWithAdmin({
      organizationName: data.organizationName,
      slug: data.slug.toLowerCase(),
      adminName: data.adminName,
      adminEmail: data.adminEmail,
      password: data.password,
      contactEmail: data.contactEmail || undefined,
      contactPhone: data.contactPhone || undefined,
    });

    req.session.userId = admin.id;
    req.session.organizationId = organization.id;

    const protocol = req.protocol;
    const port = env.PORT === 80 || env.PORT === 443 ? "" : `:${env.PORT}`;
    const redirectUrl = `${protocol}://${organization.slug}.${env.APP_ROOT_DOMAIN}${port}/`;
    res.redirect(redirectUrl);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).render("organizations/signup", {
        title: "Create organization",
        organization: null,
        error: error.message,
        values: req.body,
        appRootDomain: env.APP_ROOT_DOMAIN,
      });
      return;
    }
    next(error);
  }
});
