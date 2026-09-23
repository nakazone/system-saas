import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { findScheduleConflicts } from "../src/lib/schedule/conflicts.js";
import { convertQuoteToProject } from "../src/lib/projects/convert.js";
import { upsertQuotePaymentSchedule, runScheduleTriggers } from "../src/lib/payments/engine.js";

const prisma = new PrismaClient();

describe("schedule conflicts", () => {
  it("detects crew overlap and ignores canceled", () => {
    const start = new Date("2026-09-23T10:00:00Z");
    const end = new Date("2026-09-23T12:00:00Z");
    const conflicts = findScheduleConflicts(
      { start, end, crewId: "crew-1" },
      [
        {
          id: "a",
          start: new Date("2026-09-23T11:00:00Z"),
          end: new Date("2026-09-23T13:00:00Z"),
          crewId: "crew-1",
          status: "scheduled",
        },
        {
          id: "b",
          start: new Date("2026-09-23T11:00:00Z"),
          end: new Date("2026-09-23T13:00:00Z"),
          crewId: "crew-1",
          status: "canceled",
        },
      ],
    );
    expect(conflicts).toEqual([{ withId: "a", reason: "crew_overlap" }]);
  });

  it("detects assignee overlap", () => {
    const conflicts = findScheduleConflicts(
      {
        start: new Date("2026-09-23T14:00:00Z"),
        end: new Date("2026-09-23T16:00:00Z"),
        assignedUserId: "u1",
      },
      [
        {
          id: "x",
          start: new Date("2026-09-23T15:00:00Z"),
          end: new Date("2026-09-23T17:00:00Z"),
          assignedUserId: "u1",
          status: "scheduled",
        },
      ],
    );
    expect(conflicts[0]?.reason).toBe("assignee_overlap");
  });
});

describe("quote to project convert + phase payment triggers", () => {
  let orgId: string;
  let quoteId: string;
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
      organizationName: `Proj Org ${suffix}`,
      slug: `proj-org-${suffix}`,
      adminName: "Admin",
      adminEmail: `proj-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = org.organization.id;

    quoteId = await withTenantTransaction(orgId, async (tx) => {
      const customer = await tx.customer.create({
        data: { organizationId: orgId, name: "Job Customer" },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 7,
          title: "Install hardwood",
          customerId: customer.id,
          status: "approved",
          total: 1000,
          subtotal: 1000,
        },
      });
      await upsertQuotePaymentSchedule(tx, {
        organizationId: orgId,
        quoteId: quote.id,
        quoteTotal: 1000,
        items: [
          { label: "Deposit", percent: 30, trigger: "on_approve", sortOrder: 1 },
          {
            label: "Progress",
            percent: 40,
            trigger: "on_phase_start",
            phaseKey: "installation",
            sortOrder: 2,
          },
          {
            label: "Final",
            percent: 30,
            trigger: "on_phase_complete",
            phaseKey: "final_walkthrough",
            sortOrder: 3,
          },
        ],
      });
      return quote.id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("converts approved quote, copies locked payment schedule", async () => {
    const project = await withTenantTransaction(orgId, async (tx) => {
      return convertQuoteToProject(tx, {
        organizationId: orgId,
        quoteId,
        actorId: null,
      });
    });
    projectId = project.id;
    expect(project.number).toBeTruthy();

    await withTenantTransaction(orgId, async (tx) => {
      const schedule = await tx.paymentSchedule.findFirst({
        where: { projectId },
        include: { items: true },
      });
      expect(schedule?.lockedAt).not.toBeNull();
      expect(schedule?.items).toHaveLength(3);
      const quote = await tx.quote.findFirstOrThrow({ where: { id: quoteId } });
      expect(quote.status).toBe("converted");
    });
  });

  it("fires phase invoice on visit phase start", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      const ids = await runScheduleTriggers(tx, {
        organizationId: orgId,
        projectId,
        trigger: "on_phase_start",
        phaseKey: "installation",
      });
      expect(ids.length).toBe(1);
      const inv = await tx.quoteInvoice.findFirstOrThrow({ where: { id: ids[0] } });
      expect(Number(inv.amount)).toBe(400);
    });
  });
});
