/**
 * Roles inside a builder account (the builder's own team).
 * "legacy" = a portal user a company created before builder accounts existed.
 */
export const BUILDER_ROLES = ["admin", "manager", "office", "field"] as const;
export type BuilderRole = (typeof BUILDER_ROLES)[number];
export type PortalRole = BuilderRole | "legacy";

export const BUILDER_PERMISSIONS = [
  /** See jobs, the ticket, photos and documents. */
  "jobs.view",
  /** Send new jobs and updates. */
  "jobs.send",
  /** Change a job (dates, address, services, instructions); applies right away. */
  "jobs.edit",
  /** Job values, service prices and invoices. */
  "money.view",
  /** Link companies already on ObraMate and invite new ones. */
  "companies.manage",
  /** Invite people, change roles, remove access. */
  "team.manage",
  /** Measure stairs and vents on site (saved until the work order arrives). */
  "measure",
] as const;
export type BuilderPermission = (typeof BUILDER_PERMISSIONS)[number];

const MATRIX: Record<PortalRole, BuilderPermission[]> = {
  admin: ["jobs.view", "jobs.send", "jobs.edit", "money.view", "companies.manage", "team.manage", "measure"],
  manager: ["jobs.view", "jobs.send", "jobs.edit", "money.view", "companies.manage", "measure"],
  office: ["jobs.view", "jobs.send", "jobs.edit", "money.view", "measure"],
  field: ["jobs.view", "measure"],
  legacy: ["jobs.view", "jobs.send", "money.view"],
};

export const ROLE_LABELS: Record<BuilderRole, { pt: string; en: string; hint: string }> = {
  admin: { pt: "Admin", en: "Admin", hint: "Everything, including team and companies." },
  manager: { pt: "Gerente", en: "Manager", hint: "Sends and edits jobs, sees prices, connects companies." },
  office: { pt: "Escritório", en: "Office", hint: "Sends and edits jobs, sees prices and invoices." },
  field: { pt: "Campo", en: "Field", hint: "Sees jobs and tickets without prices, and measures on site." },
};

export function isBuilderRole(value: unknown): value is BuilderRole {
  return typeof value === "string" && (BUILDER_ROLES as readonly string[]).includes(value);
}

export function can(role: PortalRole | string | null | undefined, permission: BuilderPermission): boolean {
  const key = (role && role in MATRIX ? role : "field") as PortalRole;
  return MATRIX[key].includes(permission);
}

export function permissionsFor(role: PortalRole | string | null | undefined): BuilderPermission[] {
  return BUILDER_PERMISSIONS.filter((p) => can(role, p));
}
