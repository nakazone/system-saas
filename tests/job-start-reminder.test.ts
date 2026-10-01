import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { processDueJobStartReminders } from "../src/lib/work-orders/start-reminder-job.js";
import { prisma as appPrisma } from "../src/lib/prisma.js";

const prisma = new PrismaClient();

describe("job start reminders", () => {
  let orgId: string;
  let userId: string;
  let jobSoonId: string;
  let jobNowId: string;

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
      organizationName: `JobStart ${suffix}`,
      slug: `job-start-${suffix}`,
      adminName: "Admin",
      adminEmail: `job-start-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = a.organization.id;
    userId = a.admin.id;

    await appPrisma.organization.update({
      where: { id: orgId },
      data: {
        automationSettings: {
          quoteFollowUpEnabled: false,
          quoteFollowUpDays: 3,
          visitReminderEnabled: false,
          visitReminderHours: 24,
          jobStartReminderEnabled: true,
          jobStartReminderMinutesBefore: 30,
          jobStartAtTimeNudgeEnabled: true,
          jobStartAutoOfficeStatus: true,
        },
      },
    });

    const now = Date.now();
    await withTenantTransaction(orgId, async (tx) => {
      const soon = await tx.workOrder.create({
        data: {
          organizationId: orgId,
          number: 101,
          title: "Soon job",
          status: "scheduled",
          fieldStatus: "scheduled",
          assignedUserId: userId,
          scheduledStart: new Date(now + 20 * 60 * 1000),
        },
      });
      jobSoonId = soon.id;

      const due = await tx.workOrder.create({
        data: {
          organizationId: orgId,
          number: 102,
          title: "Due now",
          status: "scheduled",
          fieldStatus: "scheduled",
          assignedUserId: userId,
          scheduledStart: new Date(now - 60 * 1000),
        },
      });
      jobNowId = due.id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sends pre-start reminder and auto-starts office status at scheduled time", async () => {
    const stats = await processDueJobStartReminders(new Date());
    expect(stats.reminders).toBeGreaterThanOrEqual(1);
    expect(stats.autoStarts).toBeGreaterThanOrEqual(1);

    await withTenantTransaction(orgId, async (tx) => {
      const soon = await tx.workOrder.findFirstOrThrow({ where: { id: jobSoonId } });
      expect(soon.startReminderSentAt).toBeTruthy();
      expect(soon.status).toBe("scheduled");
      expect(soon.fieldStatus).toBe("scheduled");

      const due = await tx.workOrder.findFirstOrThrow({ where: { id: jobNowId } });
      expect(due.status).toBe("in_progress");
      expect(due.fieldStatus).toBe("scheduled");
      expect(due.startNudgeSentAt).toBeTruthy();
    });

    // Idempotent
    const again = await processDueJobStartReminders(new Date());
    expect(again.reminders).toBe(0);
    expect(again.autoStarts).toBe(0);
  });
});
