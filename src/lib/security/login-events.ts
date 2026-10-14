import crypto from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { email as emailProvider } from "../email/index.js";

/**
 * Login history (Master team and company users, 180 days), the Master's device cookie,
 * new-device alerts with a "não fui eu" link, and the list of the Master's open sessions.
 */

export const LOGIN_HISTORY_DAYS = 180;
export const LOGIN_CLEANUP_JOB = "login-history-cleanup";
const DEVICE_COOKIE = "om_mdev";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export function clientIpOf(req: Request): string {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (fwd || req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "").slice(0, 80);
}

/** Country from the proxy in front of the app, when it sends one (Cloudflare, Vercel, Fly). */
export function countryOf(req: Request): string | null {
  const v = String(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["fly-client-country"] || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) && v !== "XX" ? v : null;
}

/** "Chrome · macOS", "Safari · iPhone", "App · Android"… from the user agent. */
export function deviceLabel(ua: string | null | undefined): string {
  const s = String(ua || "");
  if (!s) return "Aparelho desconhecido";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(s)
            ? "macOS"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/.test(s)
                ? "Linux"
                : "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\//.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /CriOS|Chrome\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : /curl|node|undici|python/i.test(s)
              ? "Script"
              : "Navegador";
  return os ? `${browser} · ${os}` : browser;
}

/** Device id from the long-lived cookie (Master area). Created when missing. */
export function masterDeviceId(req: Request, res: Response): string {
  const cookies = String(req.headers.cookie || "");
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([A-Za-z0-9_-]{20,80})`));
  let raw = m?.[1];
  if (!raw) {
    raw = crypto.randomBytes(24).toString("base64url");
    res.cookie(DEVICE_COOKIE, raw, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 400 * 86400e3,
      path: "/master",
    });
  }
  return sha(`dev:${raw}`);
}

type Base = { email: string; ip?: string | null; userAgent?: string | null; country?: string | null; reason?: string | null; method?: string | null };

export async function recordUserLogin(e: Base & { userId?: string | null; organizationId?: string | null; success: boolean }): Promise<void> {
  try {
    await prisma.loginEvent.create({
      data: {
        kind: "user",
        userId: e.userId ?? null,
        organizationId: e.organizationId ?? null,
        email: e.email.slice(0, 200),
        success: e.success,
        reason: e.reason ?? null,
        method: e.method ?? "password",
        ip: e.ip ?? null,
        userAgent: e.userAgent?.slice(0, 300) ?? null,
        device: deviceLabel(e.userAgent),
        country: e.country ?? null,
      },
    });
  } catch (error) {
    console.error("[login] history failed", error);
  }
}

export function fromRequest(req: Request): { ip: string; userAgent: string; country: string | null } {
  return { ip: clientIpOf(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 300), country: countryOf(req) };
}

export async function recordMasterFailure(admin: { id: string; email: string } | null, email: string, reason: string, req: Request): Promise<void> {
  try {
    const r = fromRequest(req);
    await prisma.loginEvent.create({
      data: { kind: "master", adminId: admin?.id ?? null, email: (admin?.email ?? email).slice(0, 200), success: false, reason, ...r, device: deviceLabel(r.userAgent) },
    });
  } catch (error) {
    console.error("[login] history failed", error);
  }
}

/**
 * Successful Master sign-in. New device = this cookie never signed in to this account in 180 days
 * (or a country never seen). Then an alert goes to the account's e-mail with a "não fui eu" link.
 */
export async function recordMasterLogin(
  admin: { id: string; name: string; email: string },
  method: string,
  req: Request,
  res: Response,
): Promise<{ newDevice: boolean; deviceId: string; device: string }> {
  const r = fromRequest(req);
  const deviceId = masterDeviceId(req, res);
  const since = new Date(Date.now() - LOGIN_HISTORY_DAYS * 86400e3);
  const prior = await prisma.loginEvent.findMany({ where: { adminId: admin.id, success: true, createdAt: { gte: since } }, select: { deviceId: true, country: true } });
  const knownDevice = prior.some((p) => p.deviceId === deviceId);
  const newCountry = !!r.country && prior.some((p) => p.country) && !prior.some((p) => p.country === r.country);
  const first = prior.length === 0;
  const newDevice = !first && (!knownDevice || newCountry);
  const device = deviceLabel(r.userAgent);
  let token: string | null = null;
  if (newDevice) token = crypto.randomBytes(32).toString("base64url");
  await prisma.loginEvent.create({
    data: { kind: "master", adminId: admin.id, email: admin.email, success: true, method, ...r, device, deviceId, newDevice, alertTokenHash: token ? sha(token) : null },
  });
  if (token) await sendLoginAlert(admin, { device, ip: r.ip, country: r.country, method }, token).catch((e) => console.error("[login] alert failed", e));
  return { newDevice, deviceId, device };
}

async function sendLoginAlert(admin: { name: string; email: string }, info: { device: string; ip: string; country: string | null; method: string }, token: string) {
  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Denver", dateStyle: "short", timeStyle: "short" });
  const link = `${env.APP_BASE_URL.replace(/\/$/, "")}/master/nao-fui-eu/${token}`;
  const lines = [
    `Olá, ${admin.name.split(/\s+/)[0]}.`,
    "",
    "Alguém entrou no ObraMate Master com a sua conta em um aparelho novo:",
    `• ${info.device}`,
    `• IP ${info.ip || "desconhecido"}${info.country ? ` · ${info.country}` : ""}`,
    `• ${when} (horário de Denver)${info.method === "recovery" ? " · usando código de recuperação" : ""}`,
    "",
    "Foi você? Então não precisa fazer nada.",
    "",
    "Não foi você? Abra o link abaixo: ele derruba todas as sessões e trava a conta na hora.",
    link,
    "",
    "O link vale por 7 dias.",
  ];
  await emailProvider.send({
    to: admin.email,
    subject: "ObraMate Master: novo acesso à sua conta",
    text: lines.join("\n"),
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#211d1a;max-width:520px;margin:0 auto;padding:24px;line-height:1.5">
<p style="margin:0 0 12px">Olá, ${esc(admin.name.split(/\s+/)[0])}.</p>
<p style="margin:0 0 12px">Alguém entrou no <b>ObraMate Master</b> com a sua conta em um aparelho novo:</p>
<p style="margin:0 0 16px;background:#f7f4ee;border-radius:12px;padding:12px 14px;font-weight:600">${esc(info.device)}<br>IP ${esc(info.ip || "desconhecido")}${info.country ? ` · ${esc(info.country)}` : ""}<br>${esc(when)} (horário de Denver)${info.method === "recovery" ? "<br>usando código de recuperação" : ""}</p>
<p style="margin:0 0 16px">Foi você? Então não precisa fazer nada.</p>
<p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#a4401b;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Não fui eu — travar a conta</a></p>
<p style="margin:0;font-size:13px;color:#6e655c">Derruba todas as sessões e trava a conta na hora. O link vale por 7 dias.</p></div>`,
    meta: { category: "internal", template: "master_login_alert", organizationId: null },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function findAlert(token: string) {
  if (!token || token.length > 200) return null;
  const ev = await prisma.loginEvent.findUnique({ where: { alertTokenHash: sha(token) } });
  if (!ev || !ev.adminId || ev.alertUsedAt || Date.now() - ev.createdAt.getTime() > 7 * 86400e3) return null;
  return ev;
}

/** "Não fui eu": ends every Master session of the account and locks it until a new access link is used. */
export async function lockFromAlert(eventId: string): Promise<{ adminId: string; sessions: number } | null> {
  const ev = await prisma.loginEvent.findUnique({ where: { id: eventId } });
  if (!ev?.adminId || ev.alertUsedAt) return null;
  await prisma.loginEvent.update({ where: { id: ev.id }, data: { alertUsedAt: new Date() } });
  await prisma.platformAdmin.update({ where: { id: ev.adminId }, data: { securityLockedAt: new Date() } });
  const sessions = await prisma.$executeRaw`DELETE FROM "session" WHERE sess->'master'->>'adminId' = ${ev.adminId}`.catch(() => 0);
  return { adminId: ev.adminId, sessions };
}

/* ───────────────────────── history and sessions ───────────────────────── */

const REASON_TEXT: Record<string, string> = {
  wrong_password: "Senha errada",
  wrong_2fa: "Código 2FA errado",
  wrong_recovery: "Código de recuperação errado",
  locked: "Conta travada",
  security_locked: "Conta travada (não fui eu)",
  blocked: "Usuário bloqueado",
  company_closed: "Empresa suspensa/cancelada",
  unknown_email: "E-mail não cadastrado",
  throttled: "Muitas tentativas",
};

export type HistoryRow = { when: Date; success: boolean; text: string; device: string; ip: string; country: string | null; newDevice: boolean };

export async function loginHistory(where: { adminId?: string; userId?: string }, take = 50): Promise<HistoryRow[]> {
  const rows = await prisma.loginEvent.findMany({ where, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({
    when: r.createdAt,
    success: r.success,
    text: r.success ? (r.method === "recovery" ? "Entrou com código de recuperação" : r.kind === "master" ? "Entrou (senha + 2FA)" : "Entrou") : REASON_TEXT[r.reason ?? ""] ?? r.reason ?? "Falhou",
    device: r.device ?? deviceLabel(r.userAgent),
    ip: r.ip ?? "—",
    country: r.country,
    newDevice: r.newDevice,
  }));
}

export type MasterSessionRow = { sid: string; device: string; ip: string; loginAt: Date | null; lastSeen: Date | null; current: boolean; stale: boolean };

/** Open Master sessions of an account (from the session store). */
export async function masterSessions(adminId: string, currentSid: string | null, idleMs: number, absoluteMs = 12 * 3600e3): Promise<MasterSessionRow[]> {
  const rows = await prisma.$queryRaw<{ sid: string; sess: { master?: { loginAt?: number; lastSeen?: number; ip?: string; device?: string; stage?: string } } }[]>`
    SELECT sid, sess FROM "session" WHERE sess->'master'->>'adminId' = ${adminId} AND expire > now()`;
  return rows
    .filter((r) => r.sess.master?.stage === "full")
    // Idle for 30 min or older than 12 h = already dead for requireMaster: not shown.
    .filter((r) => r.sid === currentSid || ((r.sess.master!.lastSeen ?? 0) > Date.now() - idleMs && (r.sess.master!.loginAt ?? 0) > Date.now() - absoluteMs))
    .map((r) => {
      const m = r.sess.master!;
      const last = m.lastSeen ? new Date(m.lastSeen) : null;
      return {
        sid: r.sid,
        device: m.device || "Aparelho desconhecido",
        ip: m.ip || "—",
        loginAt: m.loginAt ? new Date(m.loginAt) : null,
        lastSeen: last,
        current: r.sid === currentSid,
        stale: !!last && Date.now() - last.getTime() > idleMs,
      };
    })
    .sort((a, b) => (a.current ? -1 : b.current ? 1 : (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0)));
}

export async function endMasterSession(adminId: string, sid: string): Promise<number> {
  return prisma.$executeRaw`DELETE FROM "session" WHERE sid = ${sid} AND sess->'master'->>'adminId' = ${adminId}`;
}

export async function endOtherMasterSessions(adminId: string, keepSid: string): Promise<number> {
  return prisma.$executeRaw`DELETE FROM "session" WHERE sess->'master'->>'adminId' = ${adminId} AND sid <> ${keepSid}`;
}

/** Daily: drop history older than 180 days. */
export async function cleanupLoginHistory(now = new Date()): Promise<{ processed: number }> {
  const r = await prisma.loginEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - LOGIN_HISTORY_DAYS * 86400e3) } } });
  return { processed: r.count };
}
