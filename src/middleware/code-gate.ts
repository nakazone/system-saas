/**
 * Keeps the CRM source code (JavaScript and the HTML screens) away from people who are not
 * signed in. Before this, anyone could download all ~120 CRM scripts — readable, with comments —
 * and hand them to a reverse-engineering agent to map every screen and API route.
 *
 * How: at login (and on any request of a signed-in user) the server sets a small signed cookie
 * `om_a` (HMAC with SESSION_SECRET, 7 days). Static .js/.mjs/.map files are served only with a
 * valid cookie — checked without touching the database, so assets stay as fast as before.
 * The few files the login, password and public quote pages need stay open.
 *
 * This is friction, not secrecy: a signed-in user still downloads the code their browser runs.
 * Real protection is that every API checks login, company and permission on the server.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import type { AuthedRequest } from "./auth.js";

export const CODE_COOKIE = "om_a";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_BELOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Scripts the pages before login need (login, change password, public quote page, PWA). */
const ANONYMOUS_SCRIPTS = new Set([
  "/om-device.js",
  "/om-reload.js",
  "/crm-toast.js",
  "/saas-branding.js",
  "/quote-signature-auto.js",
  "/sw.js",
]);

/** Separate cookie for the Master panel scripts (only a fully signed-in Master gets it). */
export const MASTER_CODE_COOKIE = "om_m";
const MASTER_TTL_MS = 12 * 60 * 60 * 1000;

function sign(name: string, exp: number): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`${name}:${exp}`).digest("base64url");
}

function readCookie(req: Request, name: string): string {
  const fromParser = (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
  if (fromParser) return String(fromParser);
  const raw = String(req.headers.cookie || "");
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : "";
}

function msLeft(req: Request, name: string): number {
  const v = readCookie(req, name);
  const dot = v.indexOf(".");
  if (dot <= 0) return 0;
  const exp = Number(v.slice(0, dot));
  if (!Number.isFinite(exp) || exp <= Date.now()) return 0;
  const given = Buffer.from(v.slice(dot + 1));
  const want = Buffer.from(sign(name, exp));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return 0;
  return exp - Date.now();
}

function setSigned(res: Response, name: string, ttl: number): void {
  const exp = Date.now() + ttl;
  res.cookie(name, `${exp}.${sign(name, exp)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ttl,
    path: "/",
  });
}

/** Milliseconds left on a valid cookie, or 0 when missing/forged/expired. */
export function codeCookieMsLeft(req: Request): number {
  return msLeft(req, CODE_COOKIE);
}

export function setCodeCookie(res: Response): void {
  setSigned(res, CODE_COOKIE, TTL_MS);
}

export function clearCodeCookie(res: Response): void {
  res.clearCookie(CODE_COOKIE, { path: "/" });
}

/** /assets/master/*.js only for a browser with a fully signed-in Master session. */
export function gateMasterScripts(req: Request, res: Response, next: NextFunction): void {
  if (!isScriptPath(String(req.path || "")) || msLeft(req, MASTER_CODE_COOKIE) > 0) {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(401).type("text/plain; charset=utf-8").send("Sign in required");
}

/** On /master requests: full Master session → cookie (refreshed); otherwise it is removed. */
export function issueMasterCodeCookie(req: Request, res: Response, next: NextFunction): void {
  const stage = (req.session as unknown as { master?: { stage?: string } } | undefined)?.master?.stage;
  const left = msLeft(req, MASTER_CODE_COOKIE);
  if (stage === "full") {
    if (left < MASTER_TTL_MS / 2) setSigned(res, MASTER_CODE_COOKIE, MASTER_TTL_MS);
  } else if (readCookie(req, MASTER_CODE_COOKIE)) {
    res.clearCookie(MASTER_CODE_COOKIE, { path: "/" });
  }
  next();
}

function isScriptPath(p: string): boolean {
  return /\.(?:js|mjs|map)$/i.test(p);
}

/** Early static stage: block CRM scripts for visitors without a valid cookie. */
export function gateCrmScripts(req: Request, res: Response, next: NextFunction): void {
  const p = String(req.path || "");
  if (!isScriptPath(p) || ANONYMOUS_SCRIPTS.has(p) || codeCookieMsLeft(req) > 0) {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(401).type("text/plain; charset=utf-8").send("Sign in required");
}

/**
 * After the session is loaded: signed-in users get (or refresh) the cookie, so sessions that
 * existed before this change keep working — their next page load sets it before the scripts.
 */
export function issueCodeCookie(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.user && codeCookieMsLeft(req) < REFRESH_BELOW_MS) setCodeCookie(res);
  next();
}

/** HTML screens that may be shown before login (the rest send the visitor to the login page). */
const ANONYMOUS_PAGES = new Set([
  "/login",
  "/login.html",
  "/change-password.html",
  "/change-password",
  "/forgot-password.html",
  "/reset-password.html",
  "/offline.html",
]);

export function gateCrmPages(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  const p = String(req.path || "");
  const isHtml = /\.html$/i.test(p);
  if (!isHtml || req.user || ANONYMOUS_PAGES.has(p)) {
    next();
    return;
  }
  res.redirect(302, "/login.html");
}
