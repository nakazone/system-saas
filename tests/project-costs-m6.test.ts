import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { convertQuoteToProject } from "../src/lib/projects/convert.js";
import {
  actualTotalExcludingLinked,
  summarizeProjectCosts,
} from "../src/lib/projects/costs.js";

const prisma = new PrismaClient();

describe("cost anti-double-count helper", () => {
  it("excludes expenses linked to material orders", () => {
    expect(
      actualTotalExcludingLinked({
        materialActual: 100,
        laborActual: 50,
        expenses: [
          { amount: 20 },
          { amount: 30, materialOrderId: "po-1" },
        ],
      }),
    ).toBe(170);
  });
});

describe("project budget freeze + cost summary", () => {
  let orgId: string;
  let projectId: string;

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
    const org = await createOrganizationWithAdmin({
      organizationName: `Cost Org ${suffix}`,
      slug: `cost-org-${suffix}`,
      adminName: "Admin",
      adminEmail: `cost-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = org.organization.id;

    projectId = await withTenantTransaction(orgId, async (tx) => {
      const customer = await tx.customer.create({
        data: { organizationId: orgId, name: "Cost Customer" },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 11,
          title: "Cost quote",
          customerId: customer.id,
          status: "approved",
          total: 2000,
          subtotal: 2000,
          materialCost: 800,
          laborCost: 400,
        },
      });
      await tx.quoteLineItem.create({
        data: {
          organizationId: orgId,
          quoteId: quote.id,
          description: "Flooring material",
          name: "LVP",
          quantity: 100,
          unit: "sqft",
          unitCost: 5,
          unitPrice: 8,
          amount: 800,
          itemType: "product",
          isSelected: true,
        },
      });
      const project = await convertQuoteToProject(tx, {
        organizationId: orgId,
        quoteId: quote.id,
      });
      return project.id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("freezes budget lines at convert", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      const project = await tx.project.findFirstOrThrow({
        where: { id: projectId },
        include: { budgetLines: true },
      });
      expect(project.budgetFrozenAt).not.toBeNull();
      expect(project.budgetLines.length).toBeGreaterThan(0);
      expect(Number(project.budgetedMaterial)).toBeGreaterThan(0);
    });
  });

  it("summarizes committed/actual and skips linked expenses", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      const order = await tx.materialOrder.create({
        data: {
          organizationId: orgId,
          projectId,
          description: "LVP",
          quantityOrdered: 110,
          quantityReceived: 110,
          quantityUsed: 105,
          unitCost: new Prisma.Decimal(5),
          status: "received",
        },
      });
      await tx.expense.create({
        data: {
          organizationId: orgId,
          projectId,
          description: "PO payment",
          amount: new Prisma.Decimal(550),
          incurredOn: new Date(),
          materialOrderId: order.id,
          status: "approved",
        },
      });
      await tx.expense.create({
        data: {
          organizationId: orgId,
          projectId,
          description: "Parking",
          amount: new Prisma.Decimal(25),
          incurredOn: new Date(),
          category: "travel",
          status: "approved",
        },
      });
      await tx.laborEntry.create({
        data: {
          organizationId: orgId,
          projectId,
          workDate: new Date(),
          hours: new Prisma.Decimal(8),
          rateSnapshot: new Prisma.Decimal(40),
          amount: new Prisma.Decimal(320),
        },
      });

      const summary = await summarizeProjectCosts(tx, projectId);
      expect(summary.committed.material).toBe(550); // 110*5
      expect(summary.actual.material).toBe(525); // 105*5
      expect(summary.actual.labor).toBe(320);
      expect(summary.actual.expenses).toBe(25);
      expect(summary.actual.expensesLinkedToOrders).toBe(550);
      expect(summary.actual.total).toBe(870); // 525+320+25
      expect(summary.revenue).toBe(2000);
      expect(summary.margin).toBe(1130);
      expect(summary.wasteHints.some((w) => w.description.includes("LVP"))).toBe(true);
    });
  });
});
