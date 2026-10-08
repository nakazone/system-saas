import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { email as emailProvider } from "../lib/email/index.js";
import { can, normalizeRole, type Capability, type PlatformRole } from "./lib.js";

/** Idle timeout and absolute session length for the Master area. */
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** A 2FA code typed in the last 5 minutes unlocks sensitive actions. */
export const STEP_UP_MS = 5 * 60 * 1000;

export type MasterSession = {
  adminId: string;
  /** password = waiting for 2FA · setup = must enroll 2FA · full = signed in */
  stage: "password" | "setup" | "full";
  loginAt: number;
  lastSeen: number;
  stepUpAt?: number;
  /** TOTP secret during enrollment (never stored in DB until confirmed) */
  pendingTotp?: string;
};

declare module "express-session" {
  interface SessionData {
    master?: MasterSession;
  }
}

export type MasterAdmin = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
};

export type MasterRequest = Request & { master?: MasterAdmin };

export function clientIp(req: Request): string {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.ip || req.socket.remoteAddress || "";
}

export function wantsJson(req: Request): boolean {
  return (
    String(req.headers.accept || "").includes("application/json") ||
    req.headers["x-requested-with"] === "fetch"
  );
}

export function sha256(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex");
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function audit(
  req: Request,
  actor: { id?: string | null; name: string } | null,
  action: string,
  target?: { type?: string; id?: string | null; label?: string | null; meta?: unknown },
  stepUp = false,
): Promise<void> {
  try {
    await prisma.platformAuditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? "Sistema",
        action,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        targetLabel: target?.label ?? null,
        meta: (target?.meta ?? undefined) as never,
        ip: clientIp(req) || null,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 300) || null,
        stepUp,
      },
    });
  } catch (error) {
    console.error("[master] audit failed", error);
  }
}

// ---------------------------------------------------------------------------
// Login throttling (per IP and per e-mail, in memory) + DB lockout
// ---------------------------------------------------------------------------

const attempts = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function throttled(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => {
    const a = attempts.get(k);
    if (!a) return false;
    if (now - a.first > WINDOW_MS) {
      attempts.delete(k);
      return false;
    }
    return a.n >= MAX_ATTEMPTS;
  });
}

export function noteFailure(keys: string[]): void {
  const now = Date.now();
  for (const k of keys) {
    const a = attempts.get(k);
    if (!a || now - a.first > WINDOW_MS) attempts.set(k, { n: 1, first: now });
    else a.n += 1;
  }
}

export function clearFailures(keys: string[]): void {
  for (const k of keys) attempts.delete(k);
}

/** Test hook. */
export function resetThrottle(): void {
  attempts.clear();
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function deny(req: Request, res: Response, status: number, error: string, message: string): void {
  if (wantsJson(req)) {
    res.status(status).json({ ok: false, error, message });
    return;
  }
  if (status === 401) {
    res.redirect("/master/entrar");
    return;
  }
  res.status(status).render("master/error", { title: message, message });
}

/** Signed-in (password + 2FA) platform team member. */
export async function requireMaster(req: MasterRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const s = req.session.master;
    const now = Date.now();
    if (!s || s.stage !== "full") {
      if (s && s.stage === "setup") return res.redirect("/master/2fa/configurar");
      if (s && s.stage === "password") return res.redirect("/master/2fa");
      return deny(req, res, 401, "not_signed_in", "Entre para continuar.");
    }
    if (now - s.lastSeen > IDLE_MS || now - s.loginAt > ABSOLUTE_MS) {
      delete req.session.master;
      req.session.save(() => {
        if (wantsJson(req)) {
          res.status(401).json({ ok: false, error: "session_expired", message: "Sessão expirada. Entre de novo." });
          return;
        }
        res.redirect("/master/entrar?expirou=1");
      });
      return;
    }
    const admin = await prisma.platformAdmin.findUnique({
      where: { id: s.adminId },
      select: { id: true, name: true, email: true, role: true, status: true, totpEnabledAt: true },
    });
    if (!admin || admin.status !== "active" || !admin.totpEnabledAt) {
      delete req.session.master;
      return deny(req, res, 401, "not_signed_in", "Entre para continuar.");
    }
    s.lastSeen = now;
    req.master = { id: admin.id, name: admin.name, email: admin.email, role: normalizeRole(admin.role) };
    res.locals.me = req.master;
    res.locals.can = (cap: Capability) => can(req.master!.role, cap);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireCap(cap: Capability) {
  return (req: MasterRequest, res: Response, next: NextFunction): void => {
    if (!req.master || !can(req.master.role, cap)) {
      deny(req, res, 403, "forbidden", "Seu papel não permite essa ação. Fale com o Master.");
      return;
    }
    next();
  };
}

/** Sensitive actions: needs a 2FA code typed in the last 5 minutes. */
export function requireStepUp(req: MasterRequest, res: Response, next: NextFunction): void {
  const s = req.session.master;
  if (!s?.stepUpAt || Date.now() - s.stepUpAt > STEP_UP_MS) {
    res.status(428).json({ ok: false, error: "step_up_required", message: "Confirme com o código do autenticador." });
    return;
  }
  next();
}

export function isFreshStepUp(req: Request): boolean {
  const s = req.session.master;
  return !!s?.stepUpAt && Date.now() - s.stepUpAt <= STEP_UP_MS;
}

// ---------------------------------------------------------------------------
// Activation links (invite / reset)
// ---------------------------------------------------------------------------

export async function issueActivation(adminId: string, hours = 48): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.platformAdmin.update({
    where: { id: adminId },
    data: { activationTokenHash: sha256(token), activationExpiresAt: new Date(Date.now() + hours * 3600_000) },
  });
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/master/ativar/${token}`;
}

export async function sendActivationEmail(to: string, name: string, link: string, kind: "invite" | "reset" | "master"): Promise<void> {
  const subject =
    kind === "master"
      ? "ObraMate: ative seu acesso Master"
      : kind === "invite"
        ? "ObraMate: convite para a equipe da plataforma"
        : "ObraMate: redefinir seu acesso";
  const text = [
    `Olá, ${name}.`,
    "",
    kind === "reset"
      ? "Use o link abaixo para definir uma nova senha e um novo 2FA."
      : "Use o link abaixo para criar sua senha e configurar o 2FA.",
    link,
    "",
    "O link vale por 48 horas e só pode ser usado uma vez.",
  ].join("\n");
  try {
    await emailProvider.send({ to, subject, text });
  } catch (error) {
    console.error("[master] activation e-mail failed", error);
  }
}

/** A promoted Master without 2FA gets a one-time setup link by e-mail (also logged). */
async function announceSetup(id: string, emailAddr: string, name: string, has2fa: boolean): Promise<void> {
  if (has2fa) return;
  const link = await issueActivation(id);
  console.log(`[master] 2FA setup link for ${emailAddr} (48 h, one use): ${link}`);
  await sendActivationEmail(emailAddr, name, link, "master");
}

// ---------------------------------------------------------------------------
// Bootstrap: make sure the platform has its Master
// ---------------------------------------------------------------------------

/**
 * Runs at startup. Exactly one Master is allowed (unique index).
 * - MASTER_EMAIL set: that account becomes Master (created as "invited" with an
 *   activation link by e-mail + log when it does not exist yet).
 * - Otherwise the oldest active platform admin is promoted.
 * The Master must set up 2FA on the first sign-in.
 */
export async function ensureMaster(): Promise<void> {
  try {
    const existing = await prisma.platformAdmin.findFirst({ where: { role: "MASTER" }, select: { id: true, email: true } });
    if (existing) return;
    const wanted = String(process.env.MASTER_EMAIL || "").trim().toLowerCase();
    if (wanted) {
      const found = await prisma.platformAdmin.findUnique({ where: { email: wanted } });
      if (found) {
        await prisma.platformAdmin.update({ where: { id: found.id }, data: { role: "MASTER", status: found.status === "disabled" ? "active" : found.status } });
        console.log(`[master] ${wanted} promoted to Master`);
        await announceSetup(found.id, found.email, found.name, !!found.totpEnabledAt);
        return;
      }
      const created = await prisma.platformAdmin.create({
        data: { email: wanted, name: wanted.split("@")[0], passwordHash: "", role: "MASTER", status: "invited" },
      });
      const link = await issueActivation(created.id);
      console.log(`[master] Master account created for ${wanted}. Activation link (48 h): ${link}`);
      await sendActivationEmail(wanted, created.name, link, "master");
      return;
    }
    const oldest = await prisma.platformAdmin.findFirst({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
    if (oldest) {
      await prisma.platformAdmin.update({ where: { id: oldest.id }, data: { role: "MASTER" } });
      console.log(`[master] ${oldest.email} promoted to Master (oldest platform admin)`);
      await announceSetup(oldest.id, oldest.email, oldest.name, !!oldest.totpEnabledAt);
    } else {
      console.log("[master] No platform admin yet. Set MASTER_EMAIL to create the Master account.");
    }
  } catch (error) {
    console.error("[master] ensureMaster failed", error);
  }
}
