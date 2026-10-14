import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";

/**
 * Modo manutenção.
 *  - On: every company screen, API and public client link answers 503 "Voltamos já" with the expected time.
 *    The Master, /health, webhooks (Stripe keeps sending), static assets and the marketing site keep working.
 *  - Scheduled: only a notice — companies see a banner in the app during the 24 h before. The Master turns it on.
 */

export type Maintenance = { on: boolean; message: string; until: string | null; startedAt: string | null; scheduledAt: string | null; scheduledNote: string };

const KEY = "platform.maintenance";
const EMPTY: Maintenance = { on: false, message: "", until: null, startedAt: null, scheduledAt: null, scheduledNote: "" };
let cache: { at: number; value: Maintenance } | null = null;

export async function getMaintenance(): Promise<Maintenance> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  let value = EMPTY;
  try {
    value = row ? { ...EMPTY, ...(JSON.parse(row.value) as Partial<Maintenance>) } : EMPTY;
  } catch {
    value = EMPTY;
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function setMaintenance(patch: Partial<Maintenance>): Promise<Maintenance> {
  const next = { ...(await getMaintenance()), ...patch };
  const value = JSON.stringify(next);
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
  return next;
}

/** Notice for the CRM banner: scheduled within the next 24 h. */
export function upcomingNotice(m: Maintenance, now = Date.now()): { at: string; note: string } | null {
  if (m.on || !m.scheduledAt) return null;
  const t = Date.parse(m.scheduledAt);
  if (!Number.isFinite(t) || t < now || t - now > 24 * 3600e3) return null;
  return { at: m.scheduledAt, note: m.scheduledNote };
}

const ALWAYS_OPEN: RegExp[] = [
  /^\/master(\/|$)/,
  /^\/health$/,
  /^\/api\/health\//,
  /^\/webhooks\//,
  /^\/assets\//,
  /\.(css|js|map|png|jpg|jpeg|gif|svg|webp|ico|woff2?|webmanifest)$/i,
];
const MARKETING = new Set(["/", "/pricing", "/terms", "/privacy", "/dpa"]);

function untilText(until: string | null, lang: "pt" | "en"): string {
  if (!until) return "";
  const d = new Date(until);
  if (Number.isNaN(d.getTime())) return "";
  return lang === "pt"
    ? d.toLocaleString("pt-BR", { timeZone: "America/Denver", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " (horário de Denver)"
    : d.toLocaleString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) + " (Mountain Time)";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Mount early (after the session, before any company or public route). */
export async function maintenanceGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (ALWAYS_OPEN.some((r) => r.test(req.path))) return next();
  let m: Maintenance;
  try {
    m = await getMaintenance();
  } catch {
    return next();
  }
  if (!m.on) return next();
  const host = (req.get("host") || "").split(":")[0].toLowerCase();
  const root = env.APP_ROOT_DOMAIN.toLowerCase();
  if ((host === root || host === `www.${root}`) && MARKETING.has(req.path)) return next();
  const back = untilText(m.until, "pt");
  const backEn = untilText(m.until, "en");
  res.setHeader("Retry-After", "900");
  res.setHeader("Cache-Control", "no-store");
  if (req.path.startsWith("/api/") || String(req.headers.accept || "").includes("application/json")) {
    res.status(503).json({ success: false, error: "MAINTENANCE", message: m.message || "Estamos em manutenção. Voltamos já.", until: m.until });
    return;
  }
  res.status(503).type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voltamos já · ObraMate</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f4ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#211d1a;padding:16px}
.c{max-width:460px;background:#fff;border-radius:20px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.08)}.m{display:inline-block;width:44px;height:44px;border-radius:12px;background:#e8792c;margin-bottom:14px}
h1{font-size:24px;margin:0 0 8px}p{margin:0 0 10px;color:#6e655c;line-height:1.5}.en{border-top:1px solid #eee5d8;margin-top:16px;padding-top:14px;font-size:14px}</style></head>
<body><main class="c"><span class="m" aria-hidden="true"></span><h1>Voltamos já</h1><p>${esc(m.message || "O ObraMate está em manutenção para melhorias. Seus dados estão seguros.")}</p>${back ? `<p><b>Previsão: ${esc(back)}</b></p>` : ""}
<p class="en">We'll be right back — ObraMate is down for scheduled maintenance.${backEn ? ` Expected back ${esc(backEn)}.` : ""}</p></main></body></html>`);
}
