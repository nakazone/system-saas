import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import {
  withTenantTransaction,
  runWithTenant,
  getTenantPrisma,
} from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

const prisma = new PrismaClient();

describe("tenant isolation", () => {
  let orgAId: string;
  let orgBId: string;
  let leadAId: string;
  let leadBId: string;
  let customerAId: string;
  let propertyAId: string;
  let activityAId: string;

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: {
          key: permission.key,
          group: permission.group,
          description: permission.description,
        },
        update: {},
      });
    }

    const suffix = Date.now().toString(36);
    const orgA = await createOrganizationWithAdmin({
      organizationName: `Org A ${suffix}`,
      slug: `org-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: `admin-a-${suffix}@example.com`,
      password: "password12345",
    });
    const orgB = await createOrganizationWithAdmin({
      organizationName: `Org B ${suffix}`,
      slug: `org-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: `admin-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgAId = orgA.organization.id;
    orgBId = orgB.organization.id;

    leadAId = (
      await withTenantTransaction(orgAId, async (tx) => {
        return tx.lead.create({
          data: { organizationId: orgAId, name: "Lead A Secret", status: "new" },
        });
      })
    ).id;

    leadBId = (
      await withTenantTransaction(orgBId, async (tx) => {
        return tx.lead.create({
          data: { organizationId: orgBId, name: "Lead B Secret", status: "new" },
        });
      })
    ).id;

    const seeded = await withTenantTransaction(orgAId, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId: orgAId,
          name: "Customer A",
          email: `cust-a-${suffix}@example.com`,
        },
      });
      const property = await tx.property.create({
        data: {
          organizationId: orgAId,
          customerId: customer.id,
          label: "Primary",
          line1: "100 Secret Lane",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
          country: "US",
        },
      });
      const activity = await tx.activityEvent.create({
        data: {
          organizationId: orgAId,
          entityType: "customer",
          entityId: customer.id,
          actorType: "system",
          action: "created",
        },
      });
      return { customer, property, activity };
    });
    customerAId = seeded.customer.id;
    propertyAId = seeded.property.id;
    activityAId = seeded.activity.id;
  });

  afterAll(async () => {
    if (orgAId) {
      await prisma.organization.delete({ where: { id: orgAId } }).catch(() => undefined);
    }
    if (orgBId) {
      await prisma.organization.delete({ where: { id: orgBId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("does not list another organization's leads via tenant client", async () => {
    const leads = await withTenantTransaction(orgAId, async (tx) => {
      return tx.lead.findMany();
    });
    expect(leads.every((l: { organizationId: string }) => l.organizationId === orgAId)).toBe(true);
    expect(leads.find((l: { id: string }) => l.id === leadBId)).toBeUndefined();
    expect(leads.find((l: { id: string }) => l.id === leadAId)).toBeDefined();
  });

  it("rejects client attempts to override organizationId on create", async () => {
    await expect(
      withTenantTransaction(orgAId, async (tx) => {
        return tx.lead.create({
          data: {
            name: "Cross tenant",
            organizationId: orgBId,
          } as never,
        });
      }),
    ).rejects.toThrow(/organizationId cannot be overridden/);
  });

  it("cannot read another tenant's lead by id through tenant client", async () => {
    const lead = await withTenantTransaction(orgAId, async (tx) => {
      return tx.lead.findFirst({ where: { id: leadBId } });
    });
    expect(lead).toBeNull();
  });

  it("RLS blocks cross-tenant reads even with raw prisma in tenant transaction", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${orgAId}, true)`;
      return tx.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM "Lead" WHERE id = ${leadBId}::uuid
      `;
    });
    expect(rows).toHaveLength(0);
  });

  it("RLS allows same-tenant reads when setting is applied", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${orgAId}, true)`;
      return tx.$queryRaw<{ id: string; name: string }[]>`
        SELECT id, name FROM "Lead" WHERE id = ${leadAId}::uuid
      `;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Lead A Secret");
  });

  it("cannot update another tenant's lead via tenant-scoped update", async () => {
    await expect(
      withTenantTransaction(orgAId, async (tx) => {
        return tx.lead.update({
          where: { id: leadBId },
          data: { name: "Hacked" },
        });
      }),
    ).rejects.toThrow();
  });

  it("getTenantPrisma without matching org filter still scopes finds", async () => {
    const result = await runWithTenant(orgAId, async () => {
      const client = getTenantPrisma();
      await prisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${orgAId}, false)`;
      return client.lead.findMany();
    });
    expect(result.every((l: { organizationId: string }) => l.organizationId === orgAId)).toBe(true);
  });

  it("isolates Property across tenants via RLS", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${orgBId}, true)`;
      return tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Property" WHERE id = ${propertyAId}::uuid
      `;
    });
    expect(rows).toHaveLength(0);

    const visible = await withTenantTransaction(orgAId, async (tx) => {
      return tx.property.findFirst({ where: { id: propertyAId } });
    });
    expect(visible?.customerId).toBe(customerAId);
  });

  it("isolates ActivityEvent across tenants via RLS", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${orgBId}, true)`;
      return tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "ActivityEvent" WHERE id = ${activityAId}::uuid
      `;
    });
    expect(rows).toHaveLength(0);

    const visible = await withTenantTransaction(orgAId, async (tx) => {
      return tx.activityEvent.findFirst({ where: { id: activityAId } });
    });
    expect(visible?.entityId).toBe(customerAId);
  });
});
