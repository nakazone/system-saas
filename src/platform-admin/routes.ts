import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "../lib/auth/password.js";
import { z } from "zod";

/**
 * Platform admin area — served only on admin.{APP_ROOT_DOMAIN}.
 * Completely separate from organization User model.
 */
export const platformAdminRouter = Router();

platformAdminRouter.get("/", async (req: Request, res: Response) => {
  if (!req.session.platformAdminId) {
    res.redirect("/login");
    return;
  }
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      createdAt: true,
      trialEndsAt: true,
      _count: { select: { users: true } },
    },
  });
  res.render("platform-admin/index", {
    title: "Platform admin",
    organizations,
    organization: null,
  });
});

platformAdminRouter.get("/login", (_req, res) => {
  res.render("platform-admin/login", {
    title: "Platform admin login",
    organization: null,
    error: null,
  });
});

platformAdminRouter.post("/login", async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).render("platform-admin/login", {
        title: "Platform admin login",
        organization: null,
        error: "Invalid credentials.",
      });
      return;
    }
    const admin = await prisma.platformAdmin.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!admin || admin.status !== "active") {
      res.status(401).render("platform-admin/login", {
        title: "Platform admin login",
        organization: null,
        error: "Invalid credentials.",
      });
      return;
    }
    const ok = await verifyPassword(parsed.data.password, admin.passwordHash);
    if (!ok) {
      res.status(401).render("platform-admin/login", {
        title: "Platform admin login",
        organization: null,
        error: "Invalid credentials.",
      });
      return;
    }
    req.session.platformAdminId = admin.id;
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

platformAdminRouter.post(
  "/organizations/:id/status",
  async (req: Request, res: Response, next) => {
    try {
      if (!req.session.platformAdminId) {
        res.redirect("/login");
        return;
      }
      const schema = z.object({
        status: z.enum(["trial", "active", "past_due", "canceled"]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/");
        return;
      }
      const organizationId = String(req.params.id);
      await prisma.organization.update({
        where: { id: organizationId },
        data: { status: parsed.data.status },
      });
      res.redirect("/");
    } catch (error) {
      next(error);
    }
  },
);

declare module "express-session" {
  interface SessionData {
    platformAdminId?: string;
  }
}
