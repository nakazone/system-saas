import { env } from "../../config/env.js";

/**
 * Railway default hostnames do not issue certificates for arbitrary
 * `{slug}.{service}.up.railway.app` names (ERR_CERT_COMMON_NAME_INVALID).
 * Until a custom domain with wildcard DNS exists, keep tenants on the apex host
 * and identify the workspace via session.
 */
export function subdomainTenantsSupported(): boolean {
  if (process.env.TENANT_ROUTING === "subdomain") return true;
  if (process.env.TENANT_ROUTING === "session") return false;
  const root = env.APP_ROOT_DOMAIN.toLowerCase();
  return !root.endsWith(".railway.app") && !root.includes(".railway.app");
}

export function workspaceHomeUrl(slug: string): string {
  if (!subdomainTenantsSupported()) {
    return `${env.APP_BASE_URL.replace(/\/$/, "")}/`;
  }
  return subdomainWorkspaceUrl(slug);
}

export function workspaceLoginUrl(slug: string): string {
  if (!subdomainTenantsSupported()) {
    return `${env.APP_BASE_URL.replace(/\/$/, "")}/login`;
  }
  return `${subdomainWorkspaceUrl(slug)}login`;
}

function subdomainWorkspaceUrl(slug: string): string {
  const protocol = env.APP_BASE_URL.startsWith("https") ? "https" : "http";
  const port =
    env.NODE_ENV === "development" && env.PORT !== 80 && env.PORT !== 443
      ? `:${env.PORT}`
      : "";
  return `${protocol}://${slug}.${env.APP_ROOT_DOMAIN}${port}/`;
}
