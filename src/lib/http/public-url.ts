import type { Request } from "express";
import { env } from "../../config/env.js";

/**
 * Base URL for links we hand to people outside the app (workers, clients).
 *
 * 1. `PUBLIC_LINK_BASE_URL` when set (e.g. https://obramate.com) — always wins.
 * 2. Otherwise the host the office is using right now (obramate.com when they work there),
 *    so links never fall back to the hosting provider's domain (…up.railway.app) just because
 *    APP_BASE_URL / APP_ROOT_DOMAIN still point at it. `www.` is dropped (we redirect it anyway).
 * 3. APP_BASE_URL when there is no host at all.
 */
export function publicBaseUrl(req: Request): string {
  const override = String(process.env.PUBLIC_LINK_BASE_URL || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^/\s]+$/i.test(override)) return override;

  const host = (String(req.get("x-forwarded-host") || "").split(",")[0]?.trim() || req.get("host") || "")
    .toLowerCase()
    .replace(/^www\./, "");
  if (!host) return (env.APP_BASE_URL || "").replace(/\/$/, "");
  const hostname = host.split(":")[0] ?? "";
  const local = hostname === "localhost" || hostname.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  const fwdProto = String(req.get("x-forwarded-proto") || "").split(",")[0]?.trim();
  const proto = env.NODE_ENV === "production" && !local ? "https" : fwdProto || req.protocol || "http";
  return `${proto}://${host}`;
}
