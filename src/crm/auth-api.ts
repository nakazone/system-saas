import { Router } from "express";
import { passwordResetRouter } from "./password-reset.js";
import { applyFeaturePermissions } from "../lib/features/index.js";
import { z } from "zod";
import { fromRequest, recordUserLogin } from "../lib/security/login-events.js";
import { prisma } from "../lib/prisma.js";
import { verifyPassword, hashPassword } from "../lib/auth/password.js";
import { storage } from "../lib/storage/index.js";
import type { AuthedRequest } from "../middleware/auth.js";
import type { TenantRequest } from "../lib/tenant/resolve-tenant.js";
import {
  burnPasswordCheck,
  isLeakedDefaultPassword,
  LEAKED_PASSWORD_LOGIN_MESSAGE,
  newPasswordProblem,
} from "../lib/auth/password-policy.js";
import { purgeUserSessions } from "../lib/auth/session-purge.js";
import {
  loginBlockedFor,
  loginLockedMessage,
  rateLimit,
  recordLoginFailure,
  recordLoginSuccess,
} from "../lib/security/rate-limit.js";

const LOGIN_SCOPE = "crm-login";

/**
 * Auth API shaped like senior-floors-system `/api/auth/*`
 * so the vendored CRM UI can talk to System SaaS sessions.
 */
export const crmAuthRouter = Router();
crmAuthRouter.use(passwordResetRouter);

export function buildPermissionKeys(user: {
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
  const roleKey = String(user.role?.key || "").toLowerCase();
  // Field workers only use Campo — strip office CRM / pipeline even if legacy role grants exist.
  if (roleKey === "installer" || roleKey === "crew_lead" || roleKey === "subcontractor") {
    for (const key of Array.from(perms)) {
      if (
        key.startsWith("leads.") ||
        key.startsWith("pipeline.") ||
        key === "quotes.view" ||
        key === "quotes.create" ||
        key === "quotes.edit" ||
        key === "quotes.delete" ||
        key === "customers.view" ||
        key === "customers.create" ||
        key === "customers.edit" ||
        key === "finance.view" ||
        key === "finance.manage" ||
        key === "reports.view" ||
        key === "pricing.view"
      ) {
        perms.delete(key);
      }
    }
  }
  return Array.from(perms);
}

crmAuthRouter.get("/api/auth/session", async (req: AuthedRequest, res) => {
  try {
    const organizationId = req.organizationId || req.session?.organizationId;
    if (!req.session?.userId || !organizationId) {
      res.json({ success: true, authenticated: false });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        id: req.session.userId,
        organizationId,
        status: "active",
      },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
        permissions: { include: { permission: true } },
        organization: { select: { id: true, slug: true, name: true, referralSettings: true } },
      },
    });

    if (!user) {
      res.json({ success: true, authenticated: false });
      return;
    }

    const permissions = await applyFeaturePermissions(user.organizationId, buildPermissionKeys(user));
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    req.session.userRole = user.role?.key ?? "staff";
    req.session.permissionKeys = permissions;
    req.session.mustChangePassword = user.mustChangePassword;
    if (user.organization?.slug) {
      req.session.workspaceSlug = user.organization.slug;
    }

    const referralSettings = user.organization?.referralSettings;
    const referralEnabled =
      referralSettings != null &&
      typeof referralSettings === "object" &&
      !Array.isArray(referralSettings) &&
      (referralSettings as Record<string, unknown>).enabled === true;

    res.json({
      success: true,
      authenticated: true,
      organization: {
        id: user.organization?.id || organizationId,
        slug: user.organization?.slug || req.session.workspaceSlug || null,
        name: user.organization?.name || null,
        referral_program_enabled: referralEnabled,
      },
      user: {
        id: user.id,
        email: user.email,
        role: user.role?.key ?? "staff",
        name: user.name,
        phone: user.phone || null,
        avatar_url: user.avatarUrl || null,
        must_change_password: user.mustChangePassword,
        route_start_address: user.routeStartAddress || null,
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

const userAuthInclude = {
  organization: {
    select: { id: true, slug: true, name: true, status: true },
  },
  role: {
    include: { permissions: { include: { permission: true } } },
  },
  permissions: { include: { permission: true } },
} as const;

type AuthUser = Awaited<
  ReturnType<
    typeof prisma.user.findFirst<{ include: typeof userAuthInclude }>
  >
>;

async function establishSession(
  req: TenantRequest,
  user: NonNullable<AuthUser>,
  res: import("express").Response,
) {
  const permissionKeys = await applyFeaturePermissions(user.organizationId, buildPermissionKeys(user));
  const slug = user.organization.slug;

  // New session id on every login (prevents session fixation).
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      res.status(500).json({ success: false, error: "Could not establish session" });
      return;
    }
    fillSession(req, user, permissionKeys, slug, res);
  });
}

function fillSession(
  req: TenantRequest,
  user: NonNullable<AuthUser>,
  permissionKeys: string[],
  slug: string,
  res: import("express").Response,
) {
  req.session.userId = user.id;
  req.session.organizationId = user.organizationId;
  req.session.workspaceSlug = slug;
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
        organization: {
          id: user.organization.id,
          slug: user.organization.slug,
          name: user.organization.name,
        },
      },
    });
  });
}

crmAuthRouter.post("/api/auth/login", async (req: TenantRequest, res, next) => {
  try {
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        organizationId: z.string().uuid().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid email or password." });
      return;
    }

    const email = parsed.data.email.toLowerCase().trim();
    const password = parsed.data.password;
    const preferredOrgId =
      parsed.data.organizationId || req.organizationId || undefined;

    const locked = loginBlockedFor(LOGIN_SCOPE, req, email);
    if (locked > 0) {
      res.setHeader("Retry-After", String(locked));
      res.status(429).json({ success: false, error: loginLockedMessage(locked), message: loginLockedMessage(locked) });
      return;
    }
    const fail = () => {
      recordLoginFailure(LOGIN_SCOPE, req, email);
      res.status(401).json({ success: false, error: "Invalid email or password." });
    };
    const refuseLeaked = () => {
      recordLoginFailure(LOGIN_SCOPE, req, email);
      res.status(403).json({
        success: false,
        error: LEAKED_PASSWORD_LOGIN_MESSAGE,
        message: LEAKED_PASSWORD_LOGIN_MESSAGE,
        code: "DEFAULT_PASSWORD_BLOCKED",
      });
    };

    // Tenant host (subdomain) or explicit org: keep lookup scoped.
    if (preferredOrgId) {
      const user = await prisma.user.findUnique({
        where: {
          organizationId_email: {
            organizationId: preferredOrgId,
            email,
          },
        },
        include: userAuthInclude,
      });

      if (!user || user.status !== "active" || ["canceled", "suspended"].includes(user.organization.status)) {
        if (user) await recordUserLogin({ ...fromRequest(req), email, userId: user.id, organizationId: user.organizationId, success: false, reason: user.status !== "active" ? "blocked" : "company_closed" });
        await burnPasswordCheck(password);
        fail();
        return;
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        await recordUserLogin({ ...fromRequest(req), email, userId: user.id, organizationId: user.organizationId, success: false, reason: "wrong_password" });
        fail();
        return;
      }
      if (isLeakedDefaultPassword(password)) {
        await recordUserLogin({ ...fromRequest(req), email, userId: user.id, organizationId: user.organizationId, success: false, reason: "default_password" });
        refuseLeaked();
        return;
      }

      recordLoginSuccess(LOGIN_SCOPE, email);
      await recordUserLogin({ ...fromRequest(req), email, userId: user.id, organizationId: user.organizationId, success: true });
      await establishSession(req, user, res);
      return;
    }

    // Apex email-first: resolve workspace from email + password (no slug).
    const candidates = await prisma.user.findMany({
      where: { email, status: "active" },
      include: userAuthInclude,
    });

    if (candidates.length === 0) await burnPasswordCheck(password);
    const matches: NonNullable<AuthUser>[] = [];
    for (const candidate of candidates) {
      if (!candidate.organization || ["canceled", "suspended"].includes(candidate.organization.status)) {
        continue;
      }
      const ok = await verifyPassword(password, candidate.passwordHash);
      if (ok) matches.push(candidate);
    }

    if (matches.length === 0) {
      for (const c of candidates) await recordUserLogin({ ...fromRequest(req), email, userId: c.id, organizationId: c.organizationId, success: false, reason: "wrong_password" });
      fail();
      return;
    }
    if (isLeakedDefaultPassword(password)) {
      refuseLeaked();
      return;
    }
    recordLoginSuccess(LOGIN_SCOPE, email);

    if (matches.length > 1) {
      res.status(200).json({
        success: false,
        error: "multiple_workspaces",
        message: "Choose which company workspace to open.",
        workspaces: matches.map((u) => ({
          id: u.organization.id,
          slug: u.organization.slug,
          name: u.organization.name,
        })),
      });
      return;
    }

    await recordUserLogin({ ...fromRequest(req), email, userId: matches[0]!.id, organizationId: matches[0]!.organizationId, success: true });
    await establishSession(req, matches[0]!, res);
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

crmAuthRouter.post(
  "/api/auth/change-password",
  rateLimit({
    name: "change-password",
    limit: 10,
    windowMs: 15 * 60 * 1000,
    key: (req) => String(req.session?.userId || req.ip),
  }),
  async (req: AuthedRequest, res, next) => {
  try {
    if (!req.session.userId || !req.organizationId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    const newPassword = String(req.body.new_password || "").trim();
    const currentPassword = String(req.body.current_password || "").trim();
    const problem = newPasswordProblem(newPassword, { email: req.session.userEmail });
    if (problem) {
      res.status(400).json({ success: false, error: problem });
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
    if (currentPassword === newPassword) {
      res.status(400).json({ success: false, error: "A nova senha precisa ser diferente da atual." });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    req.session.mustChangePassword = false;
    // Other devices / stolen sessions stop working once the password changes.
    await purgeUserSessions(user.id, req.sessionID);

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
  },
);

function mePayload(user: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  routeStartAddress: string | null;
  role: { key: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    avatar_url: user.avatarUrl || null,
    role: user.role?.key ?? "staff",
    role_name: user.role?.name ?? null,
    must_change_password: user.mustChangePassword,
    route_start_address: user.routeStartAddress || null,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

const meSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  avatarUrl: true,
  mustChangePassword: true,
  routeStartAddress: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { key: true, name: true } },
} as const;

/** Self-service profile (Meu Perfil). */
crmAuthRouter.get("/api/me", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.session?.userId || !req.organizationId) {
      res.status(401).json({ success: false, error: "Não autenticado" });
      return;
    }
    const user = await prisma.user.findFirst({
      where: { id: req.session.userId, organizationId: req.organizationId, status: "active" },
      select: meSelect,
    });
    if (!user) {
      res.status(404).json({ success: false, error: "Usuário não encontrado" });
      return;
    }
    res.json({ success: true, data: mePayload(user) });
  } catch (error) {
    next(error);
  }
});

const patchMeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.union([z.string().trim().max(40), z.literal(""), z.null()]).optional(),
  route_start_address: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
  clear_avatar: z.boolean().optional(),
  avatar_data_url: z.string().max(3_500_000).optional(),
});

crmAuthRouter.patch("/api/me", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.session?.userId || !req.organizationId) {
      res.status(401).json({ success: false, error: "Não autenticado" });
      return;
    }
    const parsed = patchMeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Dados inválidos", details: parsed.error.flatten() });
      return;
    }
    const existing = await prisma.user.findFirst({
      where: { id: req.session.userId, organizationId: req.organizationId, status: "active" },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: "Usuário não encontrado" });
      return;
    }

    const data: {
      name?: string;
      phone?: string | null;
      routeStartAddress?: string | null;
      avatarUrl?: string | null;
    } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.phone !== undefined) {
      data.phone = parsed.data.phone === "" || parsed.data.phone == null ? null : String(parsed.data.phone);
    }
    if (parsed.data.route_start_address !== undefined) {
      data.routeStartAddress =
        parsed.data.route_start_address === "" || parsed.data.route_start_address == null
          ? null
          : String(parsed.data.route_start_address);
    }
    if (parsed.data.clear_avatar) {
      data.avatarUrl = null;
    } else if (parsed.data.avatar_data_url?.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(parsed.data.avatar_data_url);
      if (!match) {
        res.status(400).json({ success: false, error: "Foto inválida" });
        return;
      }
      const contentType = match[1]!;
      if (!contentType.startsWith("image/")) {
        res.status(400).json({ success: false, error: "A foto deve ser uma imagem" });
        return;
      }
      const body = Buffer.from(match[2]!, "base64");
      if (body.length > 2.5 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "A foto deve ter menos de 2,5 MB" });
        return;
      }
      const ext = contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
          ? "webp"
          : contentType.includes("gif")
            ? "gif"
            : "jpg";
      const key = `users/${req.organizationId}/${existing.id}/avatar-${Date.now()}.${ext}`;
      const stored = await storage.upload({ key, body, contentType });
      data.avatarUrl = stored.url;
    }

    if (!Object.keys(data).length) {
      res.status(400).json({ success: false, error: "Nada para atualizar" });
      return;
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: meSelect,
    });
    if (data.name) req.session.userName = data.name;
    res.json({ success: true, data: mePayload(user), message: "Perfil atualizado." });
  } catch (error) {
    next(error);
  }
});

/** Save the usual start address used on day route maps. */
crmAuthRouter.put("/api/auth/route-start", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.session?.userId || !req.organizationId) {
      res.status(401).json({ success: false, error: "Não autenticado" });
      return;
    }
    const raw = req.body?.address;
    const address =
      raw == null || raw === ""
        ? null
        : String(raw)
            .trim()
            .slice(0, 500) || null;
    const existing = await prisma.user.findFirst({
      where: { id: req.session.userId, organizationId: req.organizationId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: "Usuário não encontrado" });
      return;
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { routeStartAddress: address },
      select: { routeStartAddress: true },
    });
    res.json({ success: true, data: { route_start_address: user.routeStartAddress || null } });
  } catch (error) {
    next(error);
  }
});
