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

function requirePlatformAdmin(req: Request, res: Response): boolean {
  if (!req.session.platformAdminId) {
    res.redirect("/login");
    return false;
  }
  return true;
}

platformAdminRouter.get("/", async (req: Request, res: Response) => {
  if (!requirePlatformAdmin(req, res)) return;
  const [organizations, openCount] = await Promise.all([
    prisma.organization.findMany({
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
    }),
    prisma.supportTicket.count({ where: { status: "open" } }),
  ]);
  res.render("platform-admin/index", {
    title: "Platform admin",
    organizations,
    openCount,
    organization: null,
  });
});

platformAdminRouter.get("/support", async (req: Request, res: Response, next) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const filterStatus = String(req.query.status || "open");
    const where =
      filterStatus === "all"
        ? {}
        : filterStatus === "closed"
          ? { status: "closed" }
          : { status: "open" };
    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    });
    res.render("platform-admin/support-list", {
      title: "Suporte",
      tickets,
      filterStatus: filterStatus === "closed" || filterStatus === "all" ? filterStatus : "open",
      organization: null,
    });
  } catch (error) {
    next(error);
  }
});

platformAdminRouter.get("/support/:id", async (req: Request, res: Response, next) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: String(req.params.id) },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    });
    if (!ticket) {
      res.status(404).send("Ticket not found");
      return;
    }
    res.render("platform-admin/support-show", {
      title: ticket.subject,
      ticket,
      organization: null,
    });
  } catch (error) {
    next(error);
  }
});

platformAdminRouter.post("/support/:id/close", async (req: Request, res: Response, next) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const schema = z.object({
      adminNote: z.string().max(4000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    const adminNote = parsed.success ? (parsed.data.adminNote || "").trim() || null : null;
    await prisma.supportTicket.update({
      where: { id: String(req.params.id) },
      data: {
        status: "closed",
        closedAt: new Date(),
        adminNote,
      },
    });
    res.redirect(`/support/${req.params.id}`);
  } catch (error) {
    next(error);
  }
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
      if (!requirePlatformAdmin(req, res)) return;
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
