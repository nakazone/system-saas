import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { ensureWorkOrderOnApprove, syncLinkedJobFromQuote, syncLinkedQuoteFromJob } from "../src/lib/work-orders/from-quote.js";

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
        data: {
          organizationId: orgId,
          name: "Job Customer",
          email: "jobc@example.com",
          address: "123 Oak St, Denver, CO",
          customerType: "particular",
        },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 1,
          title: "Hardwood install",
          status: "approved",
          customerId: customer.id,
          total: 2500,
          // Particulars do not store job_address in payload — site lives on the customer.
          payload: { quote_party: "particular" },
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
      expect(wo.title).toBe("Job Customer");
      expect(wo.address).toContain("Oak St");
      expect(wo.status).toBe("draft");
      expect(wo.lineItems.length).toBe(1);
      expect(Number(wo.lineItems[0]?.quantitySqft)).toBe(500);
      expect(wo.lineItems[0]?.serviceName).toBe("Hardwood");
      expect(wo.lineItems[0]?.notes).toBe("Install hardwood");
    });
  });

  it("copies a job name and description onto the quote, and keeps the quote text when the job description is cleared", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId }, include: { lineItems: true } });
      const line = quote.lineItems[0];
      expect(line).toBeTruthy();
      await tx.quoteLineItem.update({
        where: { id: line!.id },
        data: { name: "Hardwood", description: "Hardwood\nSand and finish the floor" },
      });
      await syncLinkedJobFromQuote(tx, { organizationId: orgId, quoteId });
      const job = await tx.workOrder.findFirstOrThrow({
        where: { id: quote.workOrderId! },
        include: { lineItems: true },
      });
      const jobLine = job.lineItems.find((row) => row.notes !== "quote-discount");
      expect(jobLine?.serviceName).toBe("Hardwood");
      expect(jobLine?.notes).toBe("Sand and finish the floor");

      await tx.workOrderLineItem.update({
        where: { id: jobLine!.id },
        data: { serviceName: "Red oak", notes: "Two coats" },
      });
      await syncLinkedQuoteFromJob(tx, { organizationId: orgId, workOrderId: job.id });
      const updated = await tx.quoteLineItem.findFirstOrThrow({ where: { quoteId, name: "Red oak" } });
      expect(updated.description).toBe("Red oak\nTwo coats");
      const meta =
        updated.meta && typeof updated.meta === "object" && !Array.isArray(updated.meta)
          ? (updated.meta as Record<string, unknown>)
          : {};
      expect(meta.notes == null || meta.notes === "").toBe(true);

      await tx.workOrderLineItem.update({
        where: { id: jobLine!.id },
        data: { notes: null },
      });
      await syncLinkedQuoteFromJob(tx, {
        organizationId: orgId,
        workOrderId: job.id,
        priorLines: [{ pricingItemId: jobLine!.pricingItemId, serviceName: "Red oak", notes: "Two coats" }],
      });
      const cleared = await tx.quoteLineItem.findFirstOrThrow({ where: { quoteId, name: "Red oak" } });
      expect(cleared.description).toBe("Red oak");

      await tx.quoteLineItem.update({
        where: { id: cleared.id },
        data: { description: "Red oak\nKeep this" },
      });
      await syncLinkedQuoteFromJob(tx, {
        organizationId: orgId,
        workOrderId: job.id,
        priorLines: [{ pricingItemId: jobLine!.pricingItemId, serviceName: "Red oak", notes: null }],
      });
      const kept = await tx.quoteLineItem.findFirstOrThrow({ where: { quoteId, name: "Red oak" } });
      expect(kept.description).toBe("Red oak\nKeep this");
    });
  });
});
