/**
 * Job channel helpers — ensure each WorkOrder has a chat channel and members
 * stay in sync with assignee + WorkOrderMember.
 */

import type { TenantPrisma } from "../tenant/prisma-tenant.js";

export const CHAT_ACTIVE_JOB_STATUSES = ["draft", "scheduled", "in_progress"] as const;
export const CHAT_READONLY_JOB_STATUSES = ["completed", "canceled"] as const;

export function isJobChannelReadOnly(status: string): boolean {
  return (CHAT_READONLY_JOB_STATUSES as readonly string[]).includes(status);
}

/** Fields needed to build company + site labels for chat UI. */
export type JobChatLabelInput = {
  number?: number | null;
  title?: string | null;
  address?: string | null;
  sourceName?: string | null;
  customer?: { name: string } | null;
  builder?: {
    company?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
};

export const JOB_CHAT_LABEL_SELECT = {
  id: true,
  number: true,
  title: true,
  address: true,
  status: true,
  sourceName: true,
  customer: { select: { name: true } },
  builder: { select: { company: true, firstName: true, lastName: true } },
} as const;

/** Company / client name for a job (customer → builder → source → title). */
export function jobCompanyName(wo: JobChatLabelInput): string {
  const builderName = wo.builder
    ? String(wo.builder.company || "").trim() ||
      `${wo.builder.firstName || ""} ${wo.builder.lastName || ""}`.trim()
    : "";
  return (
    String(wo.customer?.name || "").trim() ||
    builderName ||
    String(wo.sourceName || "").trim() ||
    String(wo.title || "").trim() ||
    (wo.number != null ? `Job #${wo.number}` : "Job")
  );
}

export function jobSiteAddress(wo: JobChatLabelInput): string | null {
  const a = String(wo.address || "").trim();
  return a || null;
}

export function jobChatParts(wo: JobChatLabelInput): {
  company: string;
  address: string | null;
} {
  return { company: jobCompanyName(wo), address: jobSiteAddress(wo) };
}

/**
 * Channel / chip label: "Company · Address" (address omitted when missing).
 */
export function jobChannelDisplayName(wo: JobChatLabelInput): string {
  const { company, address } = jobChatParts(wo);
  return address ? `${company} · ${address}` : company;
}

/** API payload fields shared by chat job endpoints. */
export function mapJobChatLabel(wo: JobChatLabelInput & { id: string; status?: string }) {
  const { company, address } = jobChatParts(wo);
  return {
    id: wo.id,
    number: wo.number ?? null,
    title: wo.title ?? null,
    address,
    status: wo.status ?? null,
    customer_name: wo.customer?.name ?? null,
    company,
    label: jobChannelDisplayName(wo),
  };
}

/** Sorted pair key for DM uniqueness within an organization. */
export function dmKeyForUsers(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(":");
}

export async function collectJobTeamUserIds(
  tx: TenantPrisma,
  workOrderId: string,
): Promise<string[]> {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      assignedUserId: true,
      members: { select: { userId: true } },
    },
  });
  if (!wo) return [];
  const ids = new Set<string>();
  if (wo.assignedUserId) ids.add(wo.assignedUserId);
  for (const m of wo.members) ids.add(m.userId);
  return [...ids];
}

/**
 * Create or update the job chat channel for a work order.
 * Idempotent. Members = assignee + WorkOrderMember (active users).
 * Archives (read-only) when job is completed/canceled.
 */
export async function ensureJobChatChannel(
  tx: TenantPrisma,
  organizationId: string,
  workOrderId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const wo = await tx.workOrder.findFirst({
    where: { id: workOrderId, organizationId },
    select: {
      id: true,
      number: true,
      title: true,
      address: true,
      status: true,
      sourceName: true,
      assignedUserId: true,
      customer: { select: { name: true } },
      builder: { select: { company: true, firstName: true, lastName: true } },
      members: { select: { userId: true } },
    },
  });
  if (!wo) {
    throw new Error(`WorkOrder not found: ${workOrderId}`);
  }

  const name = jobChannelDisplayName(wo);
  const readOnly = isJobChannelReadOnly(wo.status);
  const existing = await tx.chatConversation.findFirst({
    where: { organizationId, workOrderId: wo.id, type: "job" },
    select: { id: true, archivedAt: true, name: true },
  });

  let conversationId: string;
  let created = false;

  if (existing) {
    conversationId = existing.id;
    const patch: { name?: string; archivedAt?: Date | null; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (existing.name !== name) patch.name = name;
    if (readOnly && !existing.archivedAt) patch.archivedAt = new Date();
    if (!readOnly && existing.archivedAt) patch.archivedAt = null;
    if (patch.name !== undefined || patch.archivedAt !== undefined) {
      await tx.chatConversation.update({
        where: { id: conversationId },
        data: patch,
      });
    }
  } else {
    const createdConv = await tx.chatConversation.create({
      data: {
        organizationId,
        type: "job",
        workOrderId: wo.id,
        name,
        archivedAt: readOnly ? new Date() : null,
      },
      select: { id: true },
    });
    conversationId = createdConv.id;
    created = true;
    await tx.chatMessage.create({
      data: {
        organizationId,
        conversationId,
        authorId: null,
        body: "Canal da obra criado automaticamente.",
        type: "system",
      },
    });
  }

  const teamIds = new Set<string>();
  if (wo.assignedUserId) teamIds.add(wo.assignedUserId);
  for (const m of wo.members) teamIds.add(m.userId);

  const activeUsers = teamIds.size
    ? await tx.user.findMany({
        where: {
          organizationId,
          id: { in: [...teamIds] },
          status: "active",
        },
        select: { id: true },
      })
    : [];
  const activeIds = new Set(activeUsers.map((u) => u.id));

  const currentMembers = await tx.chatConversationMember.findMany({
    where: { conversationId },
    select: { id: true, userId: true, leftAt: true },
  });
  const byUser = new Map(currentMembers.map((m) => [m.userId, m]));

  for (const userId of activeIds) {
    const existingMember = byUser.get(userId);
    if (!existingMember) {
      await tx.chatConversationMember.create({
        data: {
          organizationId,
          conversationId,
          userId,
          role: "member",
        },
      });
    } else if (existingMember.leftAt) {
      await tx.chatConversationMember.update({
        where: { id: existingMember.id },
        data: { leftAt: null, joinedAt: new Date() },
      });
    }
  }

  // Soft-remove members no longer on the job team
  for (const member of currentMembers) {
    if (!activeIds.has(member.userId) && !member.leftAt) {
      await tx.chatConversationMember.update({
        where: { id: member.id },
        data: { leftAt: new Date() },
      });
    }
  }

  return { conversationId, created };
}

/** Backfill job channels for all active (or all non-canceled) work orders in an org. */
export async function backfillJobChatChannelsForOrg(
  tx: TenantPrisma,
  organizationId: string,
  options?: { includeCompleted?: boolean },
): Promise<{ created: number; updated: number }> {
  const statuses = options?.includeCompleted
    ? [...CHAT_ACTIVE_JOB_STATUSES, ...CHAT_READONLY_JOB_STATUSES]
    : [...CHAT_ACTIVE_JOB_STATUSES];

  const workOrders = await tx.workOrder.findMany({
    where: { organizationId, status: { in: statuses } },
    select: { id: true },
  });

  let created = 0;
  let updated = 0;
  for (const wo of workOrders) {
    const result = await ensureJobChatChannel(tx, organizationId, wo.id);
    if (result.created) created += 1;
    else updated += 1;
  }
  return { created, updated };
}
