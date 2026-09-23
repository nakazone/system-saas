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
 * Idempotently create any missing Phase 2 default roles for an organization.
 * Does not modify existing roles or remove legacy keys (sales_rep, etc.).
 */
export async function ensureDefaultRoles(
  organizationId: string,
  tx: TenantPrisma,
): Promise<{ created: string[] }> {
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

  return { created };
}
