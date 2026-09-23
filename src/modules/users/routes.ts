import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/auth/password.js";
import { email } from "../../lib/email/index.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { env } from "../../config/env.js";
import { ensureDefaultRoles } from "../../lib/tenant/ensure-default-roles.js";
import { DEFAULT_ROLE_PERMISSIONS } from "../../lib/tenant/defaults.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get(
  "/",
  requirePermission("users.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const users = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.user.findMany({
          include: { role: true },
          orderBy: { createdAt: "asc" },
        });
      });
      const invitations = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.invitation.findMany({
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
        });
      });
      const roles = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.role.findMany({ orderBy: { name: "asc" } });
      });
      const existingKeys = new Set(roles.map((r) => r.key));
      const missingDefaultRoles = Object.keys(DEFAULT_ROLE_PERMISSIONS).filter(
        (k) => !existingKeys.has(k),
      );

      res.render("users/index", {
        title: "Users",
        organization: req.organization,
        user: req.user,
        users,
        invitations,
        roles,
        missingDefaultRoles,
        error: typeof req.query.error === "string" ? req.query.error : null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.post(
  "/ensure-default-roles",
  requirePermission("roles.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { created, permissionsAdded } = await withTenantTransaction(
        req.organizationId!,
        async (tx) => {
          return ensureDefaultRoles(req.organizationId!, tx);
        },
      );
      const parts: string[] = [];
      if (created.length > 0) parts.push(`Added roles: ${created.join(", ")}`);
      if (permissionsAdded > 0) parts.push(`Granted ${permissionsAdded} missing permissions`);
      const msg = parts.length > 0 ? parts.join(". ") : "All default roles and permissions already present.";
      res.redirect(`/users?success=${encodeURIComponent(msg)}`);
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.post(
  "/invite",
  requirePermission("users.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        roleId: z.string().uuid(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/users?error=invalid");
        return;
      }

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await withTenantTransaction(req.organizationId!, async (tx) => {
        const existing = await tx.user.findFirst({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (existing) {
          throw new Error("A user with this email already exists");
        }

        await tx.invitation.create({
          data: {
            organizationId: req.organizationId!,
            email: parsed.data.email.toLowerCase(),
            roleId: parsed.data.roleId,
            token,
            expiresAt,
            invitedBy: req.user!.id,
            status: "pending",
          },
        });
      });

      const host = req.get("host");
      const inviteUrl = `${req.protocol}://${host}/invitations/${token}`;
      await email.send({
        to: parsed.data.email,
        subject: `Invitation to join ${req.organization!.name}`,
        text: `You have been invited to join ${req.organization!.name}. Accept here: ${inviteUrl}`,
      });

      res.redirect("/users");
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.post(
  "/:id/status",
  requirePermission("users.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        status: z.enum(["active", "suspended", "disabled"]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/users");
        return;
      }
      if (req.params.id === req.user!.id) {
        res.redirect("/users");
        return;
      }

      await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.user.update({
          where: { id: param(req, "id") },
          data: { status: parsed.data.status },
        });
      });
      res.redirect("/users");
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.post(
  "/:id/role",
  requirePermission("users.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({ roleId: z.string().uuid() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/users");
        return;
      }

      await withTenantTransaction(req.organizationId!, async (tx) => {
        const role = await tx.role.findFirst({ where: { id: parsed.data.roleId } });
        if (!role) throw new Error("Role not found");
        await tx.user.update({
          where: { id: param(req, "id") },
          data: { roleId: role.id },
        });
      });
      res.redirect("/users");
    } catch (error) {
      next(error);
    }
  },
);

export const invitationsRouter = Router();

invitationsRouter.get("/:token", async (req, res, next) => {
  try {
    const invitation = await prisma.invitation.findUnique({
      where: { token: req.params.token },
      include: { organization: true },
    });
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
      res.status(404).render("errors/not-found", {
        title: "Invitation not found",
        message: "This invitation is invalid or has expired.",
        organization: null,
      });
      return;
    }

    res.render("users/accept-invitation", {
      title: "Accept invitation",
      organization: invitation.organization,
      invitation,
      error: null,
      appRootDomain: env.APP_ROOT_DOMAIN,
    });
  } catch (error) {
    next(error);
  }
});

invitationsRouter.post("/:token", async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(120),
      password: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    const invitation = await prisma.invitation.findUnique({
      where: { token: req.params.token },
      include: { organization: true },
    });

    if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
      res.status(404).render("errors/not-found", {
        title: "Invitation not found",
        message: "This invitation is invalid or has expired.",
        organization: null,
      });
      return;
    }

    if (!parsed.success) {
      res.status(400).render("users/accept-invitation", {
        title: "Accept invitation",
        organization: invitation.organization,
        invitation,
        error: "Name and password (min 8 characters) are required.",
        appRootDomain: env.APP_ROOT_DOMAIN,
      });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${invitation.organizationId}, true)`;
      const created = await tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email: invitation.email,
          name: parsed.data.name,
          passwordHash,
          roleId: invitation.roleId,
          status: "active",
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "accepted" },
      });
      return created;
    });

    req.session.userId = user.id;
    req.session.organizationId = invitation.organizationId;

    const protocol = req.protocol;
    const port = env.PORT === 80 || env.PORT === 443 ? "" : `:${env.PORT}`;
    res.redirect(
      `${protocol}://${invitation.organization.slug}.${env.APP_ROOT_DOMAIN}${port}/`,
    );
  } catch (error) {
    next(error);
  }
});
