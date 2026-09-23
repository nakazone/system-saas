import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import {
  moveLeadToSystemStage,
  moveLeadForQuoteEvent,
} from "../src/lib/pipeline/move.js";
import {
  staleNewLeadWhere,
  buildActionHome,
} from "../src/lib/home/actions.js";
import {
  projectedRevenueFromOpen,
  openInvoiceBalance,
  arAgingFromOpen,
} from "../src/lib/reports/queries.js";

const prisma = new PrismaClient();

describe("pipeline move + loss reason", () => {
  let orgId: string;
  let leadId: string;
  let lossReasonId: string;
  let quoteId: string;

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
      organizationName: `M8 Org ${suffix}`,
      slug: `m8-org-${suffix}`,
      adminName: "Admin",
      adminEmail: `m8-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = org.organization.id;

    const seeded = await withTenantTransaction(orgId, async (tx) => {
      const newStage = await tx.pipelineStage.findFirstOrThrow({
        where: { slug: "new" },
      });
      const lead = await tx.lead.create({
        data: {
          organizationId: orgId,
          name: "Board Lead",
          status: "new",
          pipelineStageId: newStage.id,
          source: "web",
        },
      });
      const reason = await tx.lossReason.findFirstOrThrow({ where: { slug: "price" } });
      const customer = await tx.customer.create({
        data: {
          organizationId: orgId,
          leadId: lead.id,
          name: "Board Customer",
          email: `board-${suffix}@example.com`,
        },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 80,
          title: "Approve me",
          customerId: customer.id,
          leadId: lead.id,
          status: "sent",
          total: 1500,
          subtotal: 1500,
        },
      });
      return { leadId: lead.id, lossReasonId: reason.id, quoteId: quote.id };
    });
    leadId = seeded.leadId;
    lossReasonId = seeded.lossReasonId;
    quoteId = seeded.quoteId;
  });

  afterAll(async () => {
    /* shared prisma disconnected in later suite */
  });

  it("rejects Lost without loss reason", async () => {
    const result = await withTenantTransaction(orgId, async (tx) => {
      return moveLeadToSystemStage(tx, {
        organizationId: orgId,
        leadId,
        slug: "lost",
      });
    });
    expect(result.moved).toBe(false);
    expect(result.reason).toBe("loss_reason_required");
  });

  it("moves to Won on quote approve event", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      await moveLeadForQuoteEvent(tx, {
        organizationId: orgId,
        quoteId,
        slug: "won",
      });
      const lead = await tx.lead.findFirstOrThrow({
        where: { id: leadId },
        include: { pipelineStage: true },
      });
      expect(lead.pipelineStage?.slug).toBe("won");
      expect(lead.status).toBe("won");
    });
  });

  it("moves to Lost with reason", async () => {
    // create a fresh open lead
    await withTenantTransaction(orgId, async (tx) => {
      const newStage = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "new" } });
      const lead = await tx.lead.create({
        data: {
          organizationId: orgId,
          name: "To Lose",
          status: "new",
          pipelineStageId: newStage.id,
        },
      });
      const result = await moveLeadToSystemStage(tx, {
        organizationId: orgId,
        leadId: lead.id,
        slug: "lost",
        lossReasonId,
      });
      expect(result.moved).toBe(true);
      const after = await tx.lead.findFirstOrThrow({
        where: { id: lead.id },
        include: { pipelineStage: true },
      });
      expect(after.pipelineStage?.slug).toBe("lost");
      expect(after.lossReasonId).toBe(lossReasonId);
    });
  });
});

describe("action home counts match filters", () => {
  let orgId: string;

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
    const suffix = Date.now().toString(36) + "h";
    const org = await createOrganizationWithAdmin({
      organizationName: `Home Org ${suffix}`,
      slug: `home-org-${suffix}`,
      adminName: "Admin",
      adminEmail: `home-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = org.organization.id;

    const now = new Date("2030-06-15T12:00:00.000Z");
    await withTenantTransaction(orgId, async (tx) => {
      await tx.lead.create({
        data: {
          organizationId: orgId,
          name: "Stale",
          status: "new",
          createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
        },
      });
      await tx.lead.create({
        data: {
          organizationId: orgId,
          name: "Fresh",
          status: "new",
          createdAt: now,
        },
      });
      await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 1,
          title: "Stale quote",
          status: "sent",
          total: 100,
          subtotal: 100,
          updatedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.project.create({
        data: {
          organizationId: orgId,
          name: "Bill me",
          status: "needs_invoicing",
        },
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("home stale lead count equals filtered list count", async () => {
    const now = new Date("2030-06-15T12:00:00.000Z");
    await withTenantTransaction(orgId, async (tx) => {
      const home = await buildActionHome(tx, now);
      const staleBlock = home.blocks.find((b) => b.key === "stale_leads");
      const listCount = await tx.lead.count({ where: staleNewLeadWhere(now) });
      expect(staleBlock?.count).toBe(listCount);
      expect(listCount).toBeGreaterThanOrEqual(1);

      const needs = home.blocks.find((b) => b.key === "needs_invoicing");
      const needsList = await tx.project.count({
        where: { status: "needs_invoicing", deletedAt: null },
      });
      expect(needs?.count).toBe(needsList);
    });
  });
});

describe("projected revenue = open installments", () => {
  it("sums open balances exactly", () => {
    const invoices = [
      {
        id: "1",
        amount: 100,
        status: "sent",
        dueDate: new Date("2030-01-15"),
        createdAt: new Date("2030-01-01"),
        receipts: [{ amount: 40 }],
      },
      {
        id: "2",
        amount: 200,
        status: "partially_paid",
        dueDate: new Date("2030-02-01"),
        createdAt: new Date("2030-01-01"),
        receipts: [{ amount: 50 }],
      },
      {
        id: "3",
        amount: 50,
        status: "paid",
        dueDate: new Date("2030-01-01"),
        createdAt: new Date("2030-01-01"),
        receipts: [{ amount: 50 }],
      },
    ];
    expect(openInvoiceBalance(invoices[0]!)).toBe(60);
    expect(openInvoiceBalance(invoices[2]!)).toBe(0);
    const proj = projectedRevenueFromOpen(invoices);
    expect(proj.total).toBe(210);
    expect(proj.byMonth.find((m) => m.month === "2030-01")?.amount).toBe(60);
    expect(proj.byMonth.find((m) => m.month === "2030-02")?.amount).toBe(150);

    const aging = arAgingFromOpen(invoices, new Date("2030-03-01"));
    expect(aging.total).toBe(210);
  });
});
