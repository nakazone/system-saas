/**
 * Rules for managing other users (Equipe / Usuários), so a manager with "users.*" permissions
 * cannot climb to Admin or take over an Admin account:
 * - only an Admin may create, edit, disable, re-role or reset the password of an Admin;
 * - only an Admin may give someone the Admin role;
 * - only an Admin may change their own per-user permissions;
 * - a non-Admin may only grant per-user permissions they hold themselves.
 */
import type { SessionUser } from "../../middleware/auth.js";

export class UserAdminError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
  }
}

export function actorIsAdmin(actor: SessionUser | undefined): boolean {
  return actor?.roleKey === "admin";
}

export function assertCanManageUser(
  actor: SessionUser | undefined,
  target: { id: string; roleKey: string | null | undefined },
): void {
  if (actorIsAdmin(actor)) return;
  if (String(target.roleKey || "").toLowerCase() === "admin") {
    throw new UserAdminError("Só um Admin pode alterar a conta de outro Admin.");
  }
}

export function assertCanAssignRole(
  actor: SessionUser | undefined,
  role: { key: string | null | undefined } | null,
): void {
  if (actorIsAdmin(actor)) return;
  if (role && String(role.key || "").toLowerCase() === "admin") {
    throw new UserAdminError("Só um Admin pode dar o cargo de Admin.");
  }
}

export function assertCanSetPermissions(
  actor: SessionUser | undefined,
  targetUserId: string,
  permissionKeys: string[],
): void {
  if (actorIsAdmin(actor)) return;
  if (actor && actor.id === targetUserId) {
    throw new UserAdminError("Você não pode alterar as suas próprias permissões.");
  }
  const held = new Set(actor?.permissions || []);
  const extra = permissionKeys.filter((k) => !held.has(k));
  if (extra.length) {
    throw new UserAdminError("Você só pode dar permissões que você mesmo tem.");
  }
}
