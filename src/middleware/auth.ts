import type { NextFunction, Response } from "express";
import type { TenantRequest } from "../lib/tenant/resolve-tenant.js";
import { prisma } from "../lib/prisma.js";

export type SessionUser = {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  roleKey: string | null;
  roleId: string | null;
  permissions: string[];
};

declare module "express-session" {
  interface SessionData {
    userId?: string;
    organizationId?: string;
    /** Active workspace slug on apex host (Railway / no wildcard DNS). */
    workspaceSlug?: string;
    /** Senior Floors CRM session fields (UI compatibility). */
    userEmail?: string;
    userName?: string;
    userRole?: string;
    permissionKeys?: string[];
    mustChangePassword?: boolean;
    /** Staged CSV import (Settings → Import). */
    importDraft?: {
      entity: "customers" | "leads";
      csvText: string;
      headers: string[];
    };
    /** Light verify for old public quote links. */
    publicQuoteVerify?: {
      quoteId: string;
      verifiedAt: number;
    };
  }
}

export type AuthedRequest = TenantRequest & {
  user?: SessionUser;
};

export async function loadSessionUser(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.session.userId;
    if (!userId || !req.organizationId) {
      next();
      return;
    }

    if (req.session.organizationId && req.session.organizationId !== req.organizationId) {
      req.session.destroy(() => undefined);
      next();
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: req.organizationId,
        status: "active",
      },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
        permissions: { include: { permission: true } },
      },
    });

    if (!user) {
      next();
      return;
    }

    const rolePerms = new Set(
      user.role?.permissions.map((rp: { permission: { key: string } }) => rp.permission.key) ?? [],
    );
    for (const up of user.permissions) {
      if (up.granted) {
        rolePerms.add(up.permission.key);
      } else {
        rolePerms.delete(up.permission.key);
      }
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      roleKey: user.role?.key ?? null,
      roleId: user.roleId,
      permissions: Array.from(rolePerms),
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.redirect("/login");
    return;
  }
  next();
}

export function requirePermission(...keys: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.redirect("/login");
      return;
    }
    const missing = keys.filter((k) => !req.user!.permissions.includes(k));
    if (missing.length > 0) {
      res.status(403).render("errors/forbidden", {
        title: "Forbidden",
        message: "You do not have permission to perform this action.",
        organization: req.organization ?? null,
        user: req.user,
      });
      return;
    }
    next();
  };
}

export function requireRole(...roleKeys: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.redirect("/login");
      return;
    }
    if (!req.user.roleKey || !roleKeys.includes(req.user.roleKey)) {
      res.status(403).render("errors/forbidden", {
        title: "Forbidden",
        message: "Your role cannot access this resource.",
        organization: req.organization ?? null,
        user: req.user,
      });
      return;
    }
    next();
  };
}
