import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { ensureWorkOrderOnApprove } from "../src/lib/work-orders/from-quote.js";

const prisma = new PrismaClient();

describe("quote approve → job", () => {
  let orgId: string;
  let quoteId: string;

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: { key: permission.key, group: permission.group, description: permission.description },
        update: {},
      });
    }
    const suffix = Date.now().toString(36);
    const a = await createOrganizationWithAdmin({
      organizationName: `JobFromQuote ${suffix}`,
      slug: `job-quote-${suffix}`,
      adminName: "Admin",
      adminEmail: `job-quote-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = a.organization.id;

    const seeded = await withTenantTransaction(orgId, async (tx) => {
      const customer = await tx.customer.create({
        data: { organizationId: orgId, name: "Job Customer", email: "jobc@example.com" },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 1,
          title: "Hardwood install",
          status: "approved",
          customerId: customer.id,
          total: 2500,
          payload: { job_address: "123 Oak St, Denver, CO" },
          lineItems: {
            create: [
              {
                organizationId: orgId,
                description: "Install hardwood",
                name: "Hardwood",
                quantity: 500,
                unit: "sq_ft",
                unitPrice: 5,
                amount: 2500,
                sortOrder: 0,
              },
            ],
          },
        },
      });
      return { quote };
    });
    quoteId = seeded.quote.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a WorkOrder linked to the quote on approve (idempotent)", async () => {
    const first = await withTenantTransaction(orgId, (tx) =>
      ensureWorkOrderOnApprove(tx, { organizationId: orgId, quoteId }),
    );
    expect(first?.created).toBe(true);
    expect(first?.id).toBeTruthy();

    const second = await withTenantTransaction(orgId, (tx) =>
      ensureWorkOrderOnApprove(tx, { organizationId: orgId, quoteId }),
    );
    expect(second?.created).toBe(false);
    expect(second?.id).toBe(first!.id);

    await withTenantTransaction(orgId, async (tx) => {
      const q = await tx.quote.findFirstOrThrow({ where: { id: quoteId } });
      expect(q.workOrderId).toBe(first!.id);
      const wo = await tx.workOrder.findFirstOrThrow({
        where: { id: first!.id },
        include: { lineItems: true },
      });
      expect(wo.title).toBe("Hardwood install");
      expect(wo.address).toContain("Oak St");
      expect(wo.status).toBe("draft");
      expect(wo.lineItems.length).toBe(1);
      expect(Number(wo.lineItems[0]?.quantitySqft)).toBe(500);
    });
  });
});
