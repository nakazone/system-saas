import { prisma } from "../prisma.js";
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLE_META,
  DEFAULT_ROLE_PERMISSIONS,
} from "../tenant/defaults.js";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";

/** Ensure global Permission catalog includes all DEFAULT_PERMISSIONS keys. */
export async function syncPermissionCatalog(): Promise<void> {
  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: {
        key: permission.key,
        group: permission.group,
        description: permission.description,
      },
      update: {
        group: permission.group,
        description: permission.description,
      },
    });
  }
}

/**
 * Add any missing DEFAULT_ROLE_PERMISSIONS keys onto existing system roles.
 * Does not remove custom grants. Safe for orgs created before Phase 2.
 */
export async function syncSystemRolePermissions(
  organizationId: string,
  tx: TenantPrisma,
): Promise<{ added: number }> {
  await syncPermissionCatalog();
  const permissions = await prisma.permission.findMany();
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  const roles = await tx.role.findMany({
    where: { organizationId },
    include: { permissions: { include: { permission: true } } },
  });

  let added = 0;
  for (const role of roles) {
    const haveKeys = new Set(role.permissions.map((rp) => rp.permission.key));
    const haveIds = new Set(role.permissions.map((rp) => rp.permissionId));

    // Full catalog for admin / settings managers; otherwise matrix by role key
    const isFullAccess =
      role.key === "admin" ||
      haveKeys.has("settings.manage") ||
      haveKeys.has("roles.manage");
    const desired = isFullAccess
      ? (DEFAULT_ROLE_PERMISSIONS.admin ?? [])
      : (DEFAULT_ROLE_PERMISSIONS[role.key] ?? null);
    if (!desired) continue;

    for (const key of desired) {
      const permission = permissionByKey.get(key);
      if (!permission || haveIds.has(permission.id)) continue;
      await tx.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
      haveIds.add(permission.id);
      added += 1;
    }
  }
  return { added };
}

const syncedOrgIds = new Set<string>();

/**
 * Idempotently create any missing Phase 2 default roles for an organization
 * and grant missing permissions on existing system roles.
 */
export async function ensureDefaultRoles(
  organizationId: string,
  tx: TenantPrisma,
): Promise<{ created: string[]; permissionsAdded: number }> {
  await syncPermissionCatalog();
  const permissions = await prisma.permission.findMany();
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  const existing = await tx.role.findMany({
    where: { organizationId },
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((r) => r.key));
  const created: string[] = [];

  for (const [roleKey, permKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (existingKeys.has(roleKey)) continue;
    const meta = DEFAULT_ROLE_META[roleKey];
    const role = await tx.role.create({
      data: {
        organizationId,
        key: roleKey,
        name: meta?.name ?? roleKey,
        description: meta?.description ?? null,
        isSystem: true,
      },
    });
    created.push(roleKey);
    for (const key of permKeys) {
      const permission = permissionByKey.get(key);
      if (!permission) continue;
      await tx.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const { added } = await syncSystemRolePermissions(organizationId, tx);
  return { created, permissionsAdded: added };
}

/** Once per process: ensure Phase 2 permission keys exist on system roles. */
export async function ensureOrgPermissionsSynced(
  organizationId: string,
  tx: TenantPrisma,
): Promise<void> {
  if (syncedOrgIds.has(organizationId)) return;
  await ensureDefaultRoles(organizationId, tx);
  syncedOrgIds.add(organizationId);
}

/** Test helper / after manual role edits — allow re-sync in this process. */
export function clearOrgPermissionSyncCache(organizationId?: string): void {
  if (organizationId) syncedOrgIds.delete(organizationId);
  else syncedOrgIds.clear();
}
