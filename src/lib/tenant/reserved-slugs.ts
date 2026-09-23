/**
 * Hostnames that must never be organization slugs on APP_ROOT_DOMAIN.
 */
export const RESERVED_TENANT_SLUGS = [
  "www",
  "admin",
  "app",
  "api",
  "mail",
  "static",
  "cdn",
  "status",
  "support",
  "help",
  "docs",
  "blog",
  "staging",
  "dev",
  "test",
] as const;

export const RESERVED_TENANT_SLUG_SET = new Set<string>(RESERVED_TENANT_SLUGS);

export function isReservedTenantSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUG_SET.has(String(slug || "").toLowerCase().trim());
}
