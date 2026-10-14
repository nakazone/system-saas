/**
 * HTTP hardening shared by every request: security headers, no caching of API data,
 * cross-site write protection (CSRF defense in depth) and neutralising HTML in input that
 * arrives from public (unauthenticated) endpoints.
 */
import type { NextFunction, Request, Response } from "express";
import type { AuthedRequest } from "./auth.js";

const isProduction = () => process.env.NODE_ENV === "production";

/** Paths that carry a secret token in the URL (quote/invoice/job/folha links, invites, feeds). */
function isTokenPath(p: string): boolean {
  return (
    p.startsWith("/public/") ||
    p.startsWith("/t/") ||
    p.startsWith("/f/") ||
    p.startsWith("/feeds/") ||
    p.startsWith("/invitations/") ||
    p.startsWith("/master/ativar") ||
    p.startsWith("/master/acesso")
  );
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  const p = String(req.path || "");
  // Clickjacking: the app may frame itself (previews), nobody else may frame it.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Token links must not leak through the Referer header to fonts/CDNs/maps.
  res.setHeader("Referrer-Policy", isTokenPath(p) ? "no-referrer" : "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.removeHeader("X-Powered-By");
  if (isProduction()) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  if (isTokenPath(p)) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  next();
}

/**
 * API responses carry customer data: never let a browser, proxy or shared device keep a copy.
 * Handlers that set their own Cache-Control (branding.css, files) override this.
 */
export function apiNoStore(req: Request, res: Response, next: NextFunction): void {
  if (String(req.path || "").startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
}

/** Cross-origin by design (landing pages / Google Sheets post leads from other domains). */
const CROSS_SITE_WRITE_ALLOWED = [/^\/api\/receive-lead(-batch)?\/?$/];

function sameSiteHost(originHost: string, requestHost: string, rootDomain: string): boolean {
  const o = originHost.toLowerCase();
  const r = requestHost.toLowerCase();
  if (o === r) return true;
  const root = rootDomain.toLowerCase().replace(/^\./, "");
  if (!root) return false;
  const under = (h: string) => h === root || h.endsWith(`.${root}`);
  return under(o) && under(r);
}

/**
 * Blocks state-changing requests that a browser marks as coming from another site.
 * Session cookies are SameSite=Lax already; this closes the remaining gaps (old browsers,
 * same-site tricks) without touching legitimate same-origin fetch/form posts.
 */
export function rejectCrossSiteWrites(rootDomain: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const m = req.method;
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") {
      next();
      return;
    }
    const p = String(req.path || "");
    if (CROSS_SITE_WRITE_ALLOWED.some((re) => re.test(p))) {
      next();
      return;
    }
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    let crossSite = fetchSite === "cross-site";
    if (!fetchSite) {
      const origin = String(req.headers.origin || "");
      if (origin && origin !== "null") {
        try {
          const originHost = new URL(origin).host;
          const host = String(req.get("host") || "");
          crossSite = !sameSiteHost(originHost.split(":")[0]!, host.split(":")[0]!, rootDomain);
        } catch {
          crossSite = true;
        }
      }
    }
    if (crossSite) {
      res.status(403).json({ success: false, error: "Cross-site request blocked" });
      return;
    }
    next();
  };
}

function neutraliseHtml(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === "string") {
    // Keep the text readable ("<3" → "‹3") but never let it become markup in the CRM.
    return value.includes("<") || value.includes(">")
      ? value.replace(/</g, "‹").replace(/>/g, "›")
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => neutraliseHtml(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      // Passwords and shared secrets are compared/hashed, never shown — keep them byte-exact.
      out[k] = /password|secret/i.test(k) ? v : neutraliseHtml(v, depth + 1);
    }
    return out;
  }
  return value;
}

const PUBLIC_INPUT_PATHS = [
  /^\/api\/receive-lead(-batch)?\/?$/,
  /^\/public\//,
  /^\/t\//,
  /^\/f\//,
  /^\/invitations\//,
  /^\/signup(\/|$)/,
];

/**
 * Text that strangers type (landing-page lead form, customer approving a quote, temporary
 * worker on a job ticket, invite acceptance) ends up inside CRM screens. Angle brackets are
 * replaced so none of it can ever be interpreted as HTML/script, whatever screen shows it.
 */
export function neutralisePublicInput(req: Request, _res: Response, next: NextFunction): void {
  const p = String(req.path || "");
  if (req.body && typeof req.body === "object" && PUBLIC_INPUT_PATHS.some((re) => re.test(p))) {
    req.body = neutraliseHtml(req.body);
  }
  next();
}

/** API calls a user may still make while a password change is pending. */
const PASSWORD_CHANGE_API_ALLOW = [/^\/api\/auth\//, /^\/api\/branding/, /^\/api\/push\/vapid-public-key$/];
const PASSWORD_CHANGE_PAGE_ALLOW = new Set([
  "/change-password.html",
  "/change-password",
  "/login.html",
  "/login",
  "/logout",
]);

/**
 * When an account must change its password (temporary password set by an admin), only the
 * password change itself works — the server enforces what the login screen already asks.
 */
export function enforcePasswordChange(req: AuthedRequest, res: Response, next: NextFunction): void {
  // Support sessions from the Master (read-only) are not the user signing in.
  const isSupport = Boolean((req.session as unknown as { support?: unknown } | undefined)?.support);
  if (!req.user?.mustChangePassword || isSupport) {
    next();
    return;
  }
  const p = String(req.path || "");
  if (p.startsWith("/api/")) {
    if (PASSWORD_CHANGE_API_ALLOW.some((re) => re.test(p))) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      error: "Troque sua senha para continuar.",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    return;
  }
  const isPage = (req.method === "GET" || req.method === "HEAD") && (p === "/" || /\.html$/i.test(p) || !/\.[a-z0-9]+$/i.test(p));
  if (isPage && !PASSWORD_CHANGE_PAGE_ALLOW.has(p)) {
    res.redirect(302, "/change-password.html");
    return;
  }
  next();
}
