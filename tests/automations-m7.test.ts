import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { automationClock } from "../src/lib/automations/settings.js";
import { scheduleQuoteFollowUp } from "../src/lib/automations/schedule.js";
import {
  messageVisibleUnderTenant,
  processDueScheduledMessages,
} from "../src/lib/automations/worker.js";
import { email } from "../src/lib/email/index.js";
import { canonicalStageSlug } from "../src/lib/dashboard/stages.js";
import { moveLeadToSystemStage } from "../src/lib/pipeline/move.js";

const prisma = new PrismaClient();

describe("automations M7", () => {
  let orgAId: string;
  let orgBId: string;
  let customerAId: string;
  let messageAId: string;
  let realNow: () => Date;
  let realSend: typeof email.send;

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
      organizationName: `Auto A ${suffix}`,
      slug: `auto-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: `auto-a-${suffix}@example.com`,
      password: "password12345",
    });
    const orgB = await createOrganizationWithAdmin({
      organizationName: `Auto B ${suffix}`,
      slug: `auto-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: `auto-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgAId = orgA.organization.id;
    orgBId = orgB.organization.id;

    await prisma.organization.update({
      where: { id: orgAId },
      data: {
        automationSettings: {
          quoteFollowUpEnabled: true,
          quoteFollowUpDays: 3,
          visitReminderEnabled: true,
          visitReminderHours: 24,
        },
      },
    });

    messageAId = await withTenantTransaction(orgAId, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId: orgAId,
          name: "Auto Customer A",
          email: `cust-a-${suffix}@example.com`,
        },
      });
      customerAId = customer.id;
      const quote = await tx.quote.create({
        data: {
          organizationId: orgAId,
          number: 70,
          title: "Follow-up quote",
          customerId: customer.id,
          status: "sent",
          total: 100,
          subtotal: 100,
        },
      });
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgAId } });
      const id = await scheduleQuoteFollowUp(tx, {
        organizationId: orgAId,
        quoteId: quote.id,
        customerId: customer.id,
        customerEmail: customer.email,
        customerName: customer.name,
        quoteTitle: quote.title,
        orgName: org.name,
        automationSettings: org.automationSettings,
      });
      if (!id) throw new Error("expected scheduled message");
      return id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    realNow = automationClock.now;
    realSend = email.send.bind(email);
  });

  afterEach(() => {
    automationClock.now = realNow;
    email.send = realSend;
  });

  it("hides org A scheduled messages under org B tenant", async () => {
    expect(await messageVisibleUnderTenant(messageAId, orgAId)).toBe(true);
    expect(await messageVisibleUnderTenant(messageAId, orgBId)).toBe(false);
  });

  it("schedules follow-up relative to injectable clock", async () => {
    const fixed = new Date("2030-01-15T12:00:00.000Z");
    automationClock.now = () => fixed;

    const scheduledFor = await withTenantTransaction(orgAId, async (tx) => {
      const quote = await tx.quote.create({
        data: {
          organizationId: orgAId,
          number: 71,
          title: "Clock quote",
          customerId: customerAId,
          status: "sent",
          total: 50,
          subtotal: 50,
        },
      });
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgAId } });
      const id = await scheduleQuoteFollowUp(tx, {
        organizationId: orgAId,
        quoteId: quote.id,
        customerId: customerAId,
        customerEmail: "clock@example.com",
        customerName: "Clock",
        quoteTitle: quote.title,
        orgName: org.name,
        automationSettings: {
          quoteFollowUpEnabled: true,
          quoteFollowUpDays: 3,
          visitReminderEnabled: false,
          visitReminderHours: 24,
        },
      });
      const msg = await tx.scheduledMessage.findFirstOrThrow({ where: { id: id! } });
      return msg.scheduledFor;
    });

    expect(scheduledFor.toISOString()).toBe("2030-01-18T12:00:00.000Z");
  });

  it("skips send when customer has transactionalOptOut", async () => {
    const sent: string[] = [];
    email.send = async (msg) => {
      sent.push(msg.to);
    };
    const fixed = new Date("2031-06-01T10:00:00.000Z");
    automationClock.now = () => fixed;

    const msgId = await withTenantTransaction(orgAId, async (tx) => {
      await tx.customer.update({
        where: { id: customerAId },
        data: { transactionalOptOut: true },
      });
      return tx.scheduledMessage.create({
        data: {
          organizationId: orgAId,
          channel: "email",
          triggerKey: "quote_follow_up",
          entityType: "quote",
          entityId: "00000000-0000-4000-8000-000000000071",
          customerId: customerAId,
          toAddress: "optout@example.com",
          subject: "Should skip",
          body: "body",
          scheduledFor: new Date(fixed.getTime() - 1000),
          status: "pending",
        },
      });
    });

    const result = await processDueScheduledMessages(fixed);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(sent).not.toContain("optout@example.com");

    const status = await withTenantTransaction(orgAId, async (tx) => {
      const msg = await tx.scheduledMessage.findFirstOrThrow({ where: { id: msgId.id } });
      const log = await tx.communicationLog.findFirst({
        where: { scheduledMessageId: msgId.id },
      });
      return { status: msg.status, skipReason: log?.skipReason };
    });
    expect(status.status).toBe("skipped");
    expect(status.skipReason).toBe("transactional_opt_out");
  });

  it("never processes org A message inside org B context", async () => {
    const fixed = new Date("2032-01-01T08:00:00.000Z");
    automationClock.now = () => fixed;
    const sent: string[] = [];
    email.send = async (msg) => {
      sent.push(msg.to);
    };

    await withTenantTransaction(orgAId, async (tx) => {
      await tx.customer.update({
        where: { id: customerAId },
        data: { transactionalOptOut: false },
      });
      await tx.scheduledMessage.create({
        data: {
          organizationId: orgAId,
          channel: "email",
          triggerKey: "quote_follow_up",
          entityType: "quote",
          entityId: "00000000-0000-4000-8000-000000000072",
          customerId: customerAId,
          toAddress: "iso-a@example.com",
          subject: "Org A only",
          body: "body",
          scheduledFor: new Date(fixed.getTime() - 1000),
          status: "pending",
        },
      });
    });

    // Org B transaction must not see or mutate org A rows
    const visibleInB = await withTenantTransaction(orgBId, async (tx) => {
      return tx.scheduledMessage.findMany({
        where: { toAddress: "iso-a@example.com" },
      });
    });
    expect(visibleInB).toHaveLength(0);

    await processDueScheduledMessages(fixed);
    expect(sent).toContain("iso-a@example.com");
  });

  it("moves quote_sent lead to follow_up_1 when quote follow-up fires", async () => {
    const fixed = new Date("2033-03-01T12:00:00.000Z");
    automationClock.now = () => fixed;
    email.send = async () => undefined;

    const { leadId, msgId } = await withTenantTransaction(orgAId, async (tx) => {
      const quoteSent = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "quote_sent" } });
      const lead = await tx.lead.create({
        data: {
          organizationId: orgAId,
          name: "Stage Auto Lead",
          email: "stage-auto@example.com",
          status: "quote_sent",
          pipelineStageId: quoteSent.id,
        },
      });
      await moveLeadToSystemStage(tx, {
        organizationId: orgAId,
        leadId: lead.id,
        slug: "quote_sent",
        actorType: "system",
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgAId,
          number: 88,
          title: "Stage move quote",
          customerId: customerAId,
          leadId: lead.id,
          status: "sent",
          total: 200,
          subtotal: 200,
        },
      });
      const msg = await tx.scheduledMessage.create({
        data: {
          organizationId: orgAId,
          channel: "email",
          triggerKey: "quote_follow_up",
          entityType: "quote",
          entityId: quote.id,
          customerId: customerAId,
          toAddress: "stage-auto@example.com",
          subject: "Follow up",
          body: "body",
          scheduledFor: new Date(fixed.getTime() - 1000),
          status: "pending",
          payload: { leadId: lead.id, quoteFollowUpDays: 3 },
        },
      });
      return { leadId: lead.id, msgId: msg.id };
    });

    await prisma.organization.update({
      where: { id: orgAId },
      data: {
        automationSettings: {
          quoteFollowUpEnabled: true,
          quoteFollowUpDays: 3,
          quoteSentAutoFollowUpStageEnabled: true,
          visitReminderEnabled: false,
          visitReminderHours: 24,
        },
      },
    });

    const result = await processDueScheduledMessages(fixed);
    expect(result.stagesMoved).toBeGreaterThanOrEqual(1);

    const after = await withTenantTransaction(orgAId, async (tx) => {
      const lead = await tx.lead.findFirstOrThrow({
        where: { id: leadId },
        include: { pipelineStage: true },
      });
      const msg = await tx.scheduledMessage.findFirstOrThrow({ where: { id: msgId } });
      return {
        status: lead.status,
        stageSlug: lead.pipelineStage?.slug ?? null,
        msgStatus: msg.status,
      };
    });

    expect(canonicalStageSlug(after.status)).toBe("follow_up_1");
    expect(canonicalStageSlug(after.stageSlug)).toBe("follow_up_1");
    expect(after.msgStatus).toBe("sent");
  });

  it("does not move lead when quoteSentAutoFollowUpStageEnabled is false", async () => {
    const fixed = new Date("2033-04-01T12:00:00.000Z");
    automationClock.now = () => fixed;
    email.send = async () => undefined;

    await prisma.organization.update({
      where: { id: orgAId },
      data: {
        automationSettings: {
          quoteFollowUpEnabled: true,
          quoteFollowUpDays: 3,
          quoteSentAutoFollowUpStageEnabled: false,
          visitReminderEnabled: false,
          visitReminderHours: 24,
        },
      },
    });

    const leadId = await withTenantTransaction(orgAId, async (tx) => {
      const quoteSent = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "quote_sent" } });
      const lead = await tx.lead.create({
        data: {
          organizationId: orgAId,
          name: "No Move Lead",
          email: "no-move@example.com",
          status: "quote_sent",
          pipelineStageId: quoteSent.id,
        },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgAId,
          number: 89,
          title: "No move quote",
          customerId: customerAId,
          leadId: lead.id,
          status: "sent",
          total: 200,
          subtotal: 200,
        },
      });
      await tx.scheduledMessage.create({
        data: {
          organizationId: orgAId,
          channel: "email",
          triggerKey: "quote_follow_up",
          entityType: "quote",
          entityId: quote.id,
          customerId: customerAId,
          toAddress: "no-move@example.com",
          subject: "Follow up",
          body: "body",
          scheduledFor: new Date(fixed.getTime() - 1000),
          status: "pending",
          payload: { leadId: lead.id },
        },
      });
      return lead.id;
    });

    await processDueScheduledMessages(fixed);

    const after = await withTenantTransaction(orgAId, async (tx) => {
      const lead = await tx.lead.findFirstOrThrow({
        where: { id: leadId },
        include: { pipelineStage: true },
      });
      return canonicalStageSlug(lead.pipelineStage?.slug) || canonicalStageSlug(lead.status);
    });
    expect(after).toBe("quote_sent");
  });
});
