import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { verifyPassword } from "../../lib/auth/password.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireAuth } from "../../middleware/auth.js";
import type { TenantRequest } from "../../lib/tenant/resolve-tenant.js";

export const authRouter = Router();

authRouter.get("/login", (_req: TenantRequest, res) => {
  res.redirect("/login.html");
});

authRouter.post("/login", async (req: TenantRequest, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
      organizationId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).render("auth/login", {
        title: "Sign in",
        organization: req.organization ?? null,
        error: "Invalid email or password.",
      });
      return;
    }

    const email = parsed.data.email.toLowerCase().trim();
    const orgId = parsed.data.organizationId || req.organizationId;

    let user = null as Awaited<ReturnType<typeof prisma.user.findFirst>>;

    if (orgId) {
      user = await prisma.user.findUnique({
        where: {
          organizationId_email: {
            organizationId: orgId,
            email,
          },
        },
        include: { organization: { select: { slug: true, status: true } } },
      });
    } else {
      const candidates = await prisma.user.findMany({
        where: { email, status: "active" },
        include: { organization: { select: { slug: true, status: true } } },
      });
      for (const candidate of candidates) {
        if (candidate.organization?.status === "canceled") continue;
        const ok = await verifyPassword(parsed.data.password, candidate.passwordHash);
        if (ok) {
          user = candidate;
          break;
        }
      }
      if (!user) {
        res.status(401).render("auth/login", {
          title: "Sign in",
          organization: null,
          error: "Invalid email or password.",
        });
        return;
      }
      // password already verified above for email-first path
      req.session.userId = user.id;
      req.session.organizationId = user.organizationId;
      req.session.workspaceSlug =
        (user as { organization?: { slug?: string } }).organization?.slug;
      req.session.userEmail = user.email;
      req.session.userName = user.name;
      res.redirect("/dashboard.html");
      return;
    }

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
    const slug =
      req.organization?.slug ||
      (user as { organization?: { slug?: string } }).organization?.slug;
    if (slug) {
      req.session.workspaceSlug = slug;
    }
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    res.redirect("/dashboard.html");
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", requireAuth, (req: AuthedRequest, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});
