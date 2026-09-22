import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { verifyPassword, hashPassword } from "../lib/auth/password.js";
import type { AuthedRequest } from "../middleware/auth.js";
import type { TenantRequest } from "../lib/tenant/resolve-tenant.js";

/**
 * Auth API shaped like senior-floors-system `/api/auth/*`
 * so the vendored CRM UI can talk to System SaaS sessions.
 */
export const crmAuthRouter = Router();

function buildPermissionKeys(user: {
  role: {
    key: string;
    permissions: { permission: { key: string } }[];
  } | null;
  permissions: { granted: boolean; permission: { key: string } }[];
}): string[] {
  const perms = new Set(user.role?.permissions.map((rp) => rp.permission.key) ?? []);
  for (const up of user.permissions) {
    if (up.granted) perms.add(up.permission.key);
    else perms.delete(up.permission.key);
  }
  return Array.from(perms);
}

crmAuthRouter.get("/api/auth/session", async (req: AuthedRequest, res) => {
  try {
    if (!req.session?.userId || !req.organizationId) {
      res.json({ success: true, authenticated: false });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        id: req.session.userId,
        organizationId: req.organizationId,
        status: "active",
      },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
        permissions: { include: { permission: true } },
      },
    });

    if (!user) {
      res.json({ success: true, authenticated: false });
      return;
    }

    const permissions = buildPermissionKeys(user);
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    req.session.userRole = user.role?.key ?? "staff";
    req.session.permissionKeys = permissions;
    req.session.mustChangePassword = user.mustChangePassword;

    res.json({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role?.key ?? "staff",
        name: user.name,
        must_change_password: user.mustChangePassword,
        permissions,
      },
    });
  } catch (error) {
    console.error("[crm-auth] session", error);
    res.status(500).json({
      success: false,
      authenticated: false,
      error: "check_session_failed",
    });
  }
});

crmAuthRouter.post("/api/auth/login", async (req: TenantRequest, res, next) => {
  try {
    if (!req.organizationId || !req.organization) {
      res.status(404).json({
        success: false,
        error: "Organization required. Use Find your workspace first.",
      });
      return;
    }

    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid email or password." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: req.organizationId,
          email: parsed.data.email.toLowerCase(),
        },
      },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
        permissions: { include: { permission: true } },
      },
    });

    if (!user || user.status !== "active") {
      res.status(401).json({ success: false, error: "Invalid email or password." });
      return;
    }

    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ success: false, error: "Invalid email or password." });
      return;
    }

    const permissionKeys = buildPermissionKeys(user);

    req.session.userId = user.id;
    req.session.organizationId = user.organizationId;
    req.session.workspaceSlug = req.organization.slug;
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    req.session.userRole = user.role?.key ?? "staff";
    req.session.permissionKeys = permissionKeys;
    req.session.mustChangePassword = user.mustChangePassword;

    req.session.save((err) => {
      if (err) {
        res.status(500).json({ success: false, error: "Could not establish session" });
        return;
      }
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role?.key ?? "staff",
          name: user.name,
          must_change_password: user.mustChangePassword,
          permissions: permissionKeys,
        },
      });
    });
  } catch (error) {
    next(error);
  }
});

crmAuthRouter.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ success: false, error: "Could not logout" });
      return;
    }
    res.json({ success: true, message: "Logged out" });
  });
});

crmAuthRouter.post("/api/auth/change-password", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.session.userId || !req.organizationId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    const newPassword = String(req.body.new_password || "").trim();
    const currentPassword = String(req.body.current_password || "").trim();
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({
        success: false,
        error: "A nova senha deve ter pelo menos 8 caracteres.",
      });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { id: req.session.userId, organizationId: req.organizationId },
    });
    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    if (!currentPassword) {
      res.status(400).json({ success: false, error: "Indique a senha atual." });
      return;
    }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      res.status(400).json({ success: false, error: "Senha atual incorreta." });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    req.session.mustChangePassword = false;

    req.session.save((err) => {
      if (err) {
        res.status(500).json({
          success: false,
          error: "Senha atualizada; falha ao gravar sessão.",
        });
        return;
      }
      res.json({ success: true, message: "Senha alterada com sucesso." });
    });
  } catch (error) {
    next(error);
  }
});
