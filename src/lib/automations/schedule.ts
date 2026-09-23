import { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { parseAutomationSettings, automationClock } from "./settings.js";

export async function cancelPendingMessages(
  tx: TenantPrisma,
  params: { entityType: string; entityId: string; triggerKey?: string },
): Promise<number> {
  const result = await tx.scheduledMessage.updateMany({
    where: {
      entityType: params.entityType,
      entityId: params.entityId,
      status: "pending",
      ...(params.triggerKey ? { triggerKey: params.triggerKey } : {}),
    },
    data: { status: "canceled" },
  });
  return result.count;
}

export async function scheduleQuoteFollowUp(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    quoteId: string;
    customerId: string | null;
    customerEmail: string | null;
    customerName: string | null;
    quoteTitle: string;
    orgName: string;
    automationSettings: unknown;
    publicLink?: string | null;
  },
): Promise<string | null> {
  const settings = parseAutomationSettings(params.automationSettings);
  if (!settings.quoteFollowUpEnabled) return null;
  if (!params.customerEmail) return null;

  await cancelPendingMessages(tx, {
    entityType: "quote",
    entityId: params.quoteId,
    triggerKey: "quote_follow_up",
  });

  const scheduledFor = new Date(
    automationClock.now().getTime() + settings.quoteFollowUpDays * 24 * 60 * 60 * 1000,
  );
  const name = params.customerName || "there";
  const linkLine = params.publicLink ? `\n\nReview your quote:\n${params.publicLink}` : "";
  const row = await tx.scheduledMessage.create({
    data: {
      organizationId: params.organizationId,
      channel: "email",
      triggerKey: "quote_follow_up",
      entityType: "quote",
      entityId: params.quoteId,
      customerId: params.customerId,
      toAddress: params.customerEmail,
      subject: `Following up on your quote from ${params.orgName}`,
      body: `Hi ${name},\n\nJust checking in on your quote "${params.quoteTitle}". We're happy to answer any questions.${linkLine}\n\n— ${params.orgName}`,
      scheduledFor,
      status: "pending",
      payload: {
        quoteFollowUpDays: settings.quoteFollowUpDays,
      } as Prisma.InputJsonValue,
    },
  });
  return row.id;
}

export async function scheduleVisitReminder(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    visitId: string;
    projectId: string;
    projectName: string;
    phase: string;
    scheduledStart: Date;
    customerId: string | null;
    customerEmail: string | null;
    customerName: string | null;
    orgName: string;
    timezone: string;
    automationSettings: unknown;
  },
): Promise<string | null> {
  const settings = parseAutomationSettings(params.automationSettings);
  if (!settings.visitReminderEnabled) return null;
  if (!params.customerEmail) return null;

  await cancelPendingMessages(tx, {
    entityType: "visit",
    entityId: params.visitId,
    triggerKey: "visit_reminder",
  });

  const scheduledFor = new Date(
    params.scheduledStart.getTime() - settings.visitReminderHours * 60 * 60 * 1000,
  );
  // If reminder would be in the past, skip scheduling
  if (scheduledFor.getTime() <= automationClock.now().getTime()) return null;

  const when = params.scheduledStart.toLocaleString("en-US", {
    timeZone: params.timezone || "America/New_York",
    dateStyle: "full",
    timeStyle: "short",
  });
  const name = params.customerName || "there";
  const row = await tx.scheduledMessage.create({
    data: {
      organizationId: params.organizationId,
      channel: "email",
      triggerKey: "visit_reminder",
      entityType: "visit",
      entityId: params.visitId,
      customerId: params.customerId,
      toAddress: params.customerEmail,
      subject: `Reminder: upcoming visit — ${params.projectName}`,
      body: `Hi ${name},\n\nThis is a reminder that our crew is scheduled for ${params.phase} on ${when} for ${params.projectName}.\n\n— ${params.orgName}`,
      scheduledFor,
      status: "pending",
      payload: {
        visitReminderHours: settings.visitReminderHours,
        projectId: params.projectId,
      } as Prisma.InputJsonValue,
    },
  });
  return row.id;
}
