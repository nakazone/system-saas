import type { Request } from "express";
import { env } from "../../config/env.js";

function isRealDomain(host: string): boolean {
  const h = host.split(":")[0]!.toLowerCase();
  return h.includes(".") && h !== "localhost" && !h.endsWith(".localhost") && !/^\d+\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Base URL for links we hand to people outside the app (workers, clients).
 *
 * Prefers the brand domain (APP_ROOT_DOMAIN, e.g. obramate.com): when the request came in on
 * that domain (or a subdomain of it) we keep that host; when it came in on the hosting
 * provider's domain (…up.railway.app) we still hand out the brand domain. Local/dev hosts
 * keep whatever the request used so links work on the machine that made them.
 */
export function publicBaseUrl(req: Request): string {
  const rawHost =
    String(req.get("x-forwarded-host") || "").split(",")[0]?.trim() || req.get("host") || "";
  const host = rawHost.toLowerCase();
  const root = (env.APP_ROOT_DOMAIN || "").toLowerCase().replace(/^www\./, "");
  const fwdProto = String(req.get("x-forwarded-proto") || "").split(",")[0]?.trim();
  const proto = env.NODE_ENV === "production" ? "https" : fwdProto || req.protocol || "http";

  const hostname = host.split(":")[0] ?? "";
  if (root && isRealDomain(root)) {
    if (hostname === root || hostname.endsWith(`.${root}`)) {
      return `${proto}://${hostname === `www.${root}` ? root : host}`;
    }
    if (env.NODE_ENV === "production" || !host) return `https://${root}`;
  }
  if (host) return `${proto}://${host}`;
  return (env.APP_BASE_URL || "").replace(/\/$/, "");
}
