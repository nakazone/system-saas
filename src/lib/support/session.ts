import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { newToken, hashToken, requestIp } from "../security/db-rate-limit.js";
import { email as emailProvider } from "../email/index.js";
import { workspaceHomeUrl } from "../tenant/workspace-url.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { buildPermissionKeys } from "../../crm/auth-api.js";
import { applyFeaturePermissions } from "../features/index.js";

/**
 * "Entrar como suporte" — a platform admin opens a company's CRM as one of its users.
 *
 * - The Master creates a single-use link (valid 2 minutes) for one company + user, with a reason and 30/60 min.
 * - Opening it on the company's host signs that browser tab in as the user, in support mode.
 * - Support mode is READ-ONLY: every write is refused (403 SUPPORT_READ_ONLY).
 * - Payroll and employee pages/APIs are hidden (403 SUPPORT_HIDDEN).
 * - A red banner shows who is in, until when, and an "Exit" button; the company admins get an e-mail.
 * - Ending (by the person, by the Master or by time) restores whatever session the browser had before.
 */

export const SUPPORT_LINK_TTL_MS = 2 * 60e3;
export const SUPPORT_DURATIONS = [30, 60] as const;

/** Session keys that describe "who is logged in" in the CRM; swapped on entry and restored on exit. */
const IDENTITY_KEYS = ["userId", "organizationId", "workspaceSlug", "userEmail", "userName", "userRole", "permissionKeys", "mustChangePassword"] as const;
type IdentityKey = (typeof IDENTITY_KEYS)[number];

export type SupportState = {
  id: string;
  adminName: string;
  userName: string;
  orgName: string;
  expiresAt: number;
  prev: Partial<Record<IdentityKey, unknown>> | null;
};

declare module "express-session" {
  interface SessionData {
    support?: SupportState;
  }
}

/** Paths that are never shown during support (payroll, employee pay and documents). */
const HIDDEN: RegExp[] = [
  /^\/api\/folha(\/|$)/,
  /^\/api\/payroll(\/|$)/,
  /^\/api\/finance\/payroll(\/|$)/,
  /^\/api\/campo\/folha(\/|$)/,
  /^\/(folha|payroll-module|funcionario)\.html$/,
];

/** Writes allowed in read-only support (leaving support, logging out). */
const WRITE_ALLOWED: RegExp[] = [/^\/api\/support-session\/exit$/, /^\/api\/auth\/logout$/, /^\/logout$/];

export function isHiddenInSupport(path: string): boolean {
  return HIDDEN.some((r) => r.test(path));
}

/* ───────────────────────── create (Master) ───────────────────────── */

export type CreateSupportInput = {
  admin: { id: string; name: string };
  organizationId: string;
  userId?: string | null;
  reason: string;
  minutes: number;
  ticketId?: string | null;
};

/** Main admin of a company: oldest active user with the admin role. */
export async function defaultSupportUser(organizationId: string) {
  return prisma.user.findFirst({
    where: { organizationId, status: "active", role: { key: "admin" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
}

export async function createSupportSession(input: CreateSupportInput): Promise<{ ok: true; id: string; url: string; userName: string } | { ok: false; message: string }> {
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, slug: true, status: true, name: true } });
  if (!org) return { ok: false, message: "Empresa não encontrada." };
  if (org.status === "suspended" || org.status === "canceled") {
    return { ok: false, message: "Empresa suspensa ou cancelada: o CRM dela está fechado. Reative antes de entrar." };
  }
  const user = input.userId
    ? await prisma.user.findFirst({ where: { id: input.userId, organizationId: org.id }, select: { id: true, name: true, status: true } })
    : await defaultSupportUser(org.id).then((u) => (u ? { ...u, status: "active" } : null));
  if (!user) return { ok: false, message: "A empresa não tem um usuário ativo para entrar." };
  if (user.status !== "active") return { ok: false, message: "Esse usuário está bloqueado ou ainda não aceitou o convite." };
  const minutes = SUPPORT_DURATIONS.includes(input.minutes as 30 | 60) ? input.minutes : 30;
  const { token, hash } = newToken();
  const now = Date.now();
  const row = await prisma.supportSession.create({
    data: {
      organizationId: org.id,
      adminId: input.admin.id,
      adminName: input.admin.name,
      userId: user.id,
      userName: user.name,
      reason: input.reason.trim().slice(0, 500),
      ticketId: input.ticketId || null,
      tokenHash: hash,
      tokenExpiresAt: new Date(now + SUPPORT_LINK_TTL_MS),
      expiresAt: new Date(now + SUPPORT_LINK_TTL_MS + minutes * 60e3),
    },
  });
  const url = `${workspaceHomeUrl(org.slug).replace(/\/$/, "")}/suporte/entrar?token=${encodeURIComponent(token)}&m=${minutes}`;
  return { ok: true, id: row.id, url, userName: user.name };
}

/** Ends a session from the Master (or by time). The tab notices on its next request. */
export async function endSupportSession(id: string, by: "user" | "master" | "expired"): Promise<boolean> {
  const r = await prisma.supportSession.updateMany({ where: { id, endedAt: null }, data: { endedAt: new Date(), endedBy: by } });
  return r.count > 0;
}

/* ───────────────────────── entry (company host) ───────────────────────── */

export const supportEntryRouter = Router();

function page(res: Response, status: number, title: string, body: string, back = false): void {
  res.status(status).type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f4ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#211d1a;padding:16px}
.c{max-width:440px;background:#fff;border-radius:18px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#6e655c;line-height:1.5}</style></head>
<body><div class="c"><h1>${title}</h1><p>${body}</p>${back ? '<a href="/" style="display:inline-flex;margin-top:16px;height:40px;align-items:center;padding:0 16px;border-radius:10px;background:#211d1a;color:#fff;text-decoration:none;font-weight:700">Voltar ao início</a>' : ""}</div></body></html>`);
}

supportEntryRouter.get("/suporte/entrar", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token || token.length > 200) return page(res, 410, "Link inválido", "Gere um novo link na ficha da empresa, no Master.");
    // Claim the link first: single use, even with two clicks at once.
    const now = new Date();
    const claimed = await prisma.supportSession.updateMany({
      where: { tokenHash: hashToken(token), startedAt: null, endedAt: null, tokenExpiresAt: { gt: now } },
      data: { startedAt: now, ip: requestIp(req).slice(0, 80), userAgent: String(req.headers["user-agent"] || "").slice(0, 300) },
    });
    if (claimed.count === 0) return page(res, 410, "Link expirado ou já usado", "O link de suporte vale 2 minutos e uma vez só. Gere outro na ficha da empresa, no Master.");
    const row = await prisma.supportSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: { select: { id: true, slug: true, name: true, status: true } } },
    });
    if (!row) return page(res, 410, "Link inválido", "Gere um novo link na ficha da empresa, no Master.");
    const minutes = Math.round((row.expiresAt.getTime() - row.tokenExpiresAt.getTime()) / 60e3);
    const expiresAt = new Date(now.getTime() + minutes * 60e3);
    await prisma.supportSession.update({ where: { id: row.id }, data: { expiresAt } });

    const user = await prisma.user.findFirst({
      where: { id: row.userId, organizationId: row.organizationId, status: "active" },
      include: { role: { include: { permissions: { include: { permission: true } } } }, permissions: { include: { permission: true } } },
    });
    if (!user) {
      await endSupportSession(row.id, "expired");
      return page(res, 410, "Usuário indisponível", "Esse usuário foi bloqueado ou removido. Escolha outro no Master.");
    }

    const s = req.session as unknown as Record<string, unknown>;
    // Keep whatever this browser had (e.g. the owner's own login on this workspace) to put back on exit.
    const prev = s.support ? (s.support as SupportState).prev : Object.fromEntries(IDENTITY_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
    s.userId = user.id;
    s.organizationId = row.organizationId;
    s.workspaceSlug = row.organization.slug;
    s.userEmail = user.email;
    s.userName = user.name;
    s.userRole = user.role?.key ?? "staff";
    s.permissionKeys = await applyFeaturePermissions(row.organizationId, buildPermissionKeys(user));
    s.mustChangePassword = false;
    s.support = { id: row.id, adminName: row.adminName, userName: user.name, orgName: row.organization.name, expiresAt: expiresAt.getTime(), prev: Object.keys(prev || {}).length ? prev : null } satisfies SupportState;

    void notifyCompanyAdmins(row.organizationId, row.organization.name, row.adminName, row.reason, minutes).catch((e) => console.error("[support] notice failed", e));
    req.session.save(() => res.redirect(303, "/"));
  } catch (error) {
    next(error);
  }
});

async function notifyCompanyAdmins(organizationId: string, company: string, staff: string, reason: string, minutes: number): Promise<void> {
  const admins = await prisma.user.findMany({ where: { organizationId, status: "active", role: { key: "admin" } }, select: { email: true, name: true }, take: 5 });
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
  for (const a of admins) {
    const first = a.name.split(/\s+/)[0] || a.name;
    const text = [
      `Hi ${first},`,
      "",
      `${env.PRODUCT_NAME} support (${staff}) opened your ${company} workspace on ${when} (Mountain Time) to help you.`,
      `Reason: ${reason}`,
      `Access: view only, up to ${minutes} minutes. Payroll and employee pay are hidden from support.`,
      "",
      "If you did not ask for help, reply to this e-mail and we will look into it right away.",
    ].join("\n");
    await emailProvider.send({
      to: a.email,
      subject: `${env.PRODUCT_NAME} support accessed your workspace`,
      text,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#211d1a;max-width:520px;margin:0 auto;padding:24px">${text
        .split("\n")
        .map((l) => (l ? `<p style="margin:0 0 10px;line-height:1.5">${l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</p>` : ""))
        .join("")}</div>`,
    });
  }
}

/* ───────────────────────── guard (every tenant request) ───────────────────────── */

function restore(req: Request): void {
  const s = req.session as unknown as Record<string, unknown>;
  const prev = (s.support as SupportState | undefined)?.prev || null;
  for (const k of IDENTITY_KEYS) delete s[k];
  if (prev) for (const [k, v] of Object.entries(prev)) s[k] = v;
  delete s.support;
}

function wantsJson(req: Request): boolean {
  return req.path.startsWith("/api/") || String(req.headers.accept || "").includes("application/json") || req.xhr;
}

/** Mount after loadSessionUser. Ends expired sessions, refuses writes and hides payroll during support. */
export async function supportGuard(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const sup = req.session?.support;
  if (!sup) return next();
  try {
    const row = await prisma.supportSession.findUnique({ where: { id: sup.id }, select: { endedAt: true, expiresAt: true } });
    const expired = !row || row.endedAt || row.expiresAt.getTime() <= Date.now();
    if (expired) {
      if (row && !row.endedAt) await endSupportSession(sup.id, "expired");
      restore(req);
      req.session.save(() => {
        if (wantsJson(req)) res.status(401).json({ success: false, error: "SUPPORT_ENDED", message: "A sessão de suporte terminou." });
        else page(res, 200, "Sessão de suporte encerrada", "O tempo acabou ou a sessão foi encerrada no Master. Pode fechar esta aba.");
      });
      return;
    }
    const m = req.method.toUpperCase();
    const isWrite = !(m === "GET" || m === "HEAD" || m === "OPTIONS");
    const hidden = isHiddenInSupport(req.path);
    const blockedWrite = isWrite && !WRITE_ALLOWED.some((r) => r.test(req.path));
    // Count what support looked at (paths only, never data).
    void prisma.supportSession
      .update({
        where: { id: sup.id },
        data: {
          ...(req.path.startsWith("/api/") || req.path.endsWith(".html") || req.path === "/" ? { views: { increment: 1 }, lastPath: req.path.slice(0, 200) } : {}),
          ...(hidden || blockedWrite ? { blocked: { increment: 1 } } : {}),
        },
      })
      .catch(() => undefined);
    if (hidden) {
      if (wantsJson(req)) return void res.status(403).json({ success: false, error: "SUPPORT_HIDDEN", message: "Folha e dados de funcionários ficam escondidos no modo suporte." });
      return page(res, 403, "Escondido no modo suporte", "Folha de pagamento e dados de funcionários não aparecem para o suporte.", true);
    }
    if (blockedWrite) {
      if (wantsJson(req)) return void res.status(403).json({ success: false, error: "SUPPORT_READ_ONLY", message: "Modo suporte é só leitura: nada pode ser criado ou alterado." });
      return page(res, 403, "Modo suporte: só leitura", "Nada pode ser criado ou alterado durante o suporte.", true);
    }
    next();
  } catch (error) {
    next(error);
  }
}

/* ───────────────────────── company-side API ───────────────────────── */

export const supportSessionApi = Router();

/** Info for the red banner (also returned inside /api/account/status). */
export function supportBanner(req: Request): { admin: string; user: string; company: string; expires_at: string; minutes_left: number } | null {
  const sup = req.session?.support;
  if (!sup) return null;
  return {
    admin: sup.adminName,
    user: sup.userName,
    company: sup.orgName,
    expires_at: new Date(sup.expiresAt).toISOString(),
    minutes_left: Math.max(0, Math.ceil((sup.expiresAt - Date.now()) / 60e3)),
  };
}

supportSessionApi.post("/api/support-session/exit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sup = req.session?.support;
    if (!sup) return void res.json({ success: true });
    await endSupportSession(sup.id, "user");
    const hadPrev = !!sup.prev;
    restore(req);
    req.session.save(() => res.json({ success: true, restored: hadPrev }));
  } catch (error) {
    next(error);
  }
});
