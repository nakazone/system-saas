/**
 * The role sync (first request after each server start) must not turn field crews into office:
 * installer and subcontractor see projects, but never get work_orders.manage / schedule.manage.
 * Old custom office roles (project_manager…) still get Jobs and Agenda.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { ensureDefaultRoles } from "../src/lib/tenant/ensure-default-roles.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("role sync keeps field crews out of the office", () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  const keysOf = async (organizationId: string, roleKey: string) =>
    (await prisma.rolePermission.findMany({ where: { role: { organizationId, key: roleKey } }, include: { permission: true } })).map((rp) => rp.permission.key).sort();

  it("installer and subcontractor keep their own permissions; an old office role gets Jobs", async () => {
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const suffix = `frp${Date.now().toString(36)}`;
    const a = await createOrganizationWithAdmin({ organizationName: `Crew ${suffix}`, slug: `crew-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    const org = a.organization.id;
    // A legacy custom office role that only sees projects.
    const pv = await prisma.permission.findUniqueOrThrow({ where: { key: "projects.view" } });
    await prisma.role.create({ data: { organizationId: org, key: "project_manager", name: "Project manager", permissions: { create: [{ permissionId: pv.id }] } } as never });

    await withTenantTransaction(org, (tx) => ensureDefaultRoles(org, tx));
    await withTenantTransaction(org, (tx) => ensureDefaultRoles(org, tx)); // twice: still the same

    for (const field of ["installer", "subcontractor"]) {
      const keys = await keysOf(org, field);
      expect(keys).toContain("work_orders.view");
      expect(keys).not.toContain("work_orders.manage");
      expect(keys).not.toContain("schedule.manage");
    }
    expect(await keysOf(org, "project_manager")).toEqual(expect.arrayContaining(["work_orders.manage", "schedule.manage"]));
    expect(await keysOf(org, "office")).toContain("work_orders.manage");
  });
});
