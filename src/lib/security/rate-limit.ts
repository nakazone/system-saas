/**
 * In-memory sliding-window-ish rate limiter (per process).
 *
 * Good enough for a single Railway instance. Counters reset on deploy; if the app ever runs
 * with several replicas, move this to Postgres/Redis so the limits are shared.
 */
import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

/** Count one hit. Returns retry-after seconds when the key is over the limit, else 0. */
export function hit(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  b.count += 1;
  if (b.count > limit) return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return 0;
}

/** True (with retry seconds) when the key already used its budget, without counting a hit. */
export function blockedFor(key: string, limit: number): number {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return 0;
  return b.count >= limit ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : 0;
}

export function reset(key: string): void {
  buckets.delete(key);
}

/** Test helper */
export function clearRateLimits(): void {
  buckets.clear();
}

export function clientIp(req: Request): string {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function tooMany(req: Request, res: Response, retryAfter: number, message: string): void {
  res.setHeader("Retry-After", String(retryAfter));
  const wantsJson =
    String(req.path || "").startsWith("/api/") ||
    String(req.headers.accept || "").includes("application/json") ||
    String(req.headers["content-type"] || "").includes("application/json");
  if (wantsJson) {
    res.status(429).json({ success: false, error: message, retry_after: retryAfter });
    return;
  }
  res.status(429).type("text/plain; charset=utf-8").send(message);
}

/**
 * Express middleware: `limit` requests per `windowMs` for each key.
 * The default key is the client IP plus the route name.
 */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowMs: number;
  key?: (req: Request) => string;
  message?: string;
}) {
  const message = opts.message || "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  return (req: Request, res: Response, next: NextFunction): void => {
    const k = `${opts.name}:${opts.key ? opts.key(req) : clientIp(req)}`;
    const retry = hit(k, opts.limit, opts.windowMs);
    if (retry > 0) {
      tooMany(req, res, retry, message);
      return;
    }
    next();
  };
}

/**
 * Login throttling: failures are counted per account (email) and per IP.
 * - 8 failures for the same email within 15 min → that email is locked for the rest of the window.
 * - 40 failures from the same IP within 15 min → that IP is locked (generous, offices share IPs).
 * A successful login clears the email counter.
 */
export const LOGIN_EMAIL_LIMIT = 8;
export const LOGIN_IP_LIMIT = 40;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function loginBlockedFor(scope: string, req: Request, email: string): number {
  const e = String(email || "").toLowerCase().trim();
  return Math.max(
    blockedFor(`${scope}:email:${e}`, LOGIN_EMAIL_LIMIT),
    blockedFor(`${scope}:ip:${clientIp(req)}`, LOGIN_IP_LIMIT),
  );
}

export function recordLoginFailure(scope: string, req: Request, email: string): void {
  const e = String(email || "").toLowerCase().trim();
  hit(`${scope}:email:${e}`, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS);
  hit(`${scope}:ip:${clientIp(req)}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
}

export function recordLoginSuccess(scope: string, email: string): void {
  reset(`${scope}:email:${String(email || "").toLowerCase().trim()}`);
}

export function loginLockedMessage(retryAfterSec: number): string {
  const min = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Muitas tentativas de login. Tente de novo em ${min} min.`;
}
