import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { verifyPassword } from "../../lib/auth/password.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireAuth } from "../../middleware/auth.js";
import type { TenantRequest } from "../../lib/tenant/resolve-tenant.js";

export const authRouter = Router();

authRouter.get("/login", (req: TenantRequest, res) => {
  if (!req.organization) {
    res.redirect("/find-workspace");
    return;
  }
  res.render("auth/login", {
    title: "Sign in",
    organization: req.organization,
    error: null,
  });
});

authRouter.post("/login", async (req: TenantRequest, res, next) => {
  try {
    if (!req.organizationId || !req.organization) {
      res.status(404).send("Organization required");
      return;
    }

    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).render("auth/login", {
        title: "Sign in",
        organization: req.organization,
        error: "Invalid email or password.",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: req.organizationId,
          email: parsed.data.email.toLowerCase(),
        },
      },
    });

    if (!user) {
      res.status(401).render("auth/login", {
        title: "Sign in",
        organization: req.organization,
        error: "Invalid email or password.",
      });
      return;
    }

    if (user.status === "suspended" || user.status === "disabled") {
      res.status(403).render("auth/login", {
        title: "Sign in",
        organization: req.organization,
        error: "Your account is not active. Contact your administrator.",
      });
      return;
    }

    if (user.status !== "active") {
      res.status(401).render("auth/login", {
        title: "Sign in",
        organization: req.organization,
        error: "Invalid email or password.",
      });
      return;
    }

    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      res.status(401).render("auth/login", {
        title: "Sign in",
        organization: req.organization,
        error: "Invalid email or password.",
      });
      return;
    }

    req.session.userId = user.id;
    req.session.organizationId = user.organizationId;
    if (req.organization?.slug) {
      req.session.workspaceSlug = req.organization.slug;
    }
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", requireAuth, (req: AuthedRequest, res) => {
  const workspaceSlug = req.session.workspaceSlug;
  req.session.destroy(() => {
    // Keep people on the apex host; they can pick the workspace again.
    if (workspaceSlug) {
      res.redirect("/find-workspace");
      return;
    }
    res.redirect("/login");
  });
});
