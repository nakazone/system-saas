import { randomUUID } from "node:crypto";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { storage } from "../storage/index.js";
import {
  canMentionAll,
  type ChatAccessUser,
  mapMessageForViewer,
} from "./access.js";
import {
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  parseDataUrl,
  publicUrlForStorageKey,
  validateChatAttachment,
} from "./attachments.js";
import { chatNotifier } from "./notifier.js";
import { parseChatTokens, sanitizeChatBody } from "./tokens.js";
import { Prisma } from "@prisma/client";

export type IncomingAttachment = {
  data_url: string;
  captured_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  width?: number | null;
  height?: number | null;
};

export async function resolveMentionUserIds(
  tx: TenantPrisma,
  organizationId: string,
  conversationId: string,
  tokens: ReturnType<typeof parseChatTokens>,
  author: ChatAccessUser,
  jobWorkOrderId: string | null,
): Promise<{ userIds: string[]; mentionRows: { userId: string; mentionType: string }[]; error?: string }> {
  const mentionRows: { userId: string; mentionType: string }[] = [];
  const userIds = new Set<string>();

  for (const t of tokens) {
    if (t.kind === "user") {
      const u = await tx.user.findFirst({
        where: { id: t.userId, organizationId, status: "active" },
        select: { id: true },
      });
      if (u) {
        userIds.add(u.id);
        mentionRows.push({ userId: u.id, mentionType: "user" });
      }
    } else if (t.kind === "team") {
      if (!jobWorkOrderId) {
        // In DM/group without job channel, @equipe uses conversation members
        const members = await tx.chatConversationMember.findMany({
          where: { conversationId, leftAt: null },
          select: { userId: true },
        });
        for (const m of members) {
          if (m.userId === author.id) continue;
          userIds.add(m.userId);
          mentionRows.push({ userId: m.userId, mentionType: "team" });
        }
      } else {
        const wo = await tx.workOrder.findFirst({
          where: { id: jobWorkOrderId, organizationId },
          select: {
            assignedUserId: true,
            members: { select: { userId: true } },
          },
        });
        if (wo) {
          const ids = new Set<string>();
          if (wo.assignedUserId) ids.add(wo.assignedUserId);
          for (const m of wo.members) ids.add(m.userId);
          for (const id of ids) {
            if (id === author.id) continue;
            userIds.add(id);
            mentionRows.push({ userId: id, mentionType: "team" });
          }
        }
      }
    } else if (t.kind === "all") {
      if (!canMentionAll(author)) {
        return { userIds: [], mentionRows: [], error: "Missing permission chat.mention_all" };
      }
      const members = await tx.chatConversationMember.findMany({
        where: { conversationId, leftAt: null },
        select: { userId: true },
      });
      for (const m of members) {
        if (m.userId === author.id) continue;
        userIds.add(m.userId);
        mentionRows.push({ userId: m.userId, mentionType: "all" });
      }
    }
  }

  // Dedupe mention rows by user (prefer user > team > all)
  const byUser = new Map<string, string>();
  const rank: Record<string, number> = { user: 3, team: 2, all: 1 };
  for (const row of mentionRows) {
    const prev = byUser.get(row.userId);
    if (!prev || (rank[row.mentionType] ?? 0) > (rank[prev] ?? 0)) {
      byUser.set(row.userId, row.mentionType);
    }
  }
  return {
    userIds: [...userIds],
    mentionRows: [...byUser.entries()].map(([userId, mentionType]) => ({ userId, mentionType })),
  };
}

export async function createChatMessage(
  tx: TenantPrisma,
  params: {
    organizationId: string;
    conversationId: string;
    author: ChatAccessUser;
    body: string;
    attachments?: IncomingAttachment[];
    contextWorkOrderId?: string | null;
    conversationType: string;
    conversationWorkOrderId: string | null;
  },
) {
  const body = sanitizeChatBody(params.body);
  if (!body.trim() && !(params.attachments?.length)) {
    throw Object.assign(new Error("Message body or attachment required"), { status: 400 });
  }

  const tokens = parseChatTokens(body);
  const jobIdsFromBody = tokens.filter((t) => t.kind === "job").map((t) => t.workOrderId);

  // Context job auto-link for DM/group
  const contextJobId =
    params.conversationType === "job"
      ? params.conversationWorkOrderId
      : params.contextWorkOrderId ?? null;

  const jobLinkTargets = new Set<string>(jobIdsFromBody);
  if (contextJobId) jobLinkTargets.add(contextJobId);
  if (params.conversationType === "job" && params.conversationWorkOrderId) {
    jobLinkTargets.add(params.conversationWorkOrderId);
  }

  // Validate job ids exist in org
  const jobIds = [...jobLinkTargets];
  if (jobIds.length) {
    const found = await tx.workOrder.findMany({
      where: { organizationId: params.organizationId, id: { in: jobIds } },
      select: { id: true },
    });
    const ok = new Set(found.map((j) => j.id));
    for (const id of jobIds) {
      if (!ok.has(id)) {
        throw Object.assign(new Error(`Unknown job in message: ${id}`), { status: 400 });
      }
    }
  }

  const mentionJobId =
    params.conversationType === "job"
      ? params.conversationWorkOrderId
      : contextJobId;

  const mentions = await resolveMentionUserIds(
    tx,
    params.organizationId,
    params.conversationId,
    tokens,
    params.author,
    mentionJobId,
  );
  if (mentions.error) {
    throw Object.assign(new Error(mentions.error), { status: 403 });
  }

  // Mentions of non-members: return flag (caller may ask UI); still store mention
  const memberRows = await tx.chatConversationMember.findMany({
    where: { conversationId: params.conversationId, leftAt: null },
    select: { userId: true },
  });
  const memberSet = new Set(memberRows.map((m) => m.userId));
  const nonMemberMentions = mentions.mentionRows
    .filter((m) => m.mentionType === "user" && !memberSet.has(m.userId))
    .map((m) => m.userId);

  const message = await tx.chatMessage.create({
    data: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      authorId: params.author.id,
      body,
      type: "text",
    },
  });

  for (const jobId of jobLinkTargets) {
    const source =
      jobIdsFromBody.includes(jobId)
        ? "inline"
        : contextJobId === jobId
          ? "context"
          : "inline";
    await tx.chatMessageJob.create({
      data: {
        organizationId: params.organizationId,
        messageId: message.id,
        workOrderId: jobId,
        linkedById: params.author.id,
        source,
      },
    });
  }

  for (const row of mentions.mentionRows) {
    await tx.chatMessageMention.create({
      data: {
        organizationId: params.organizationId,
        messageId: message.id,
        userId: row.userId,
        mentionType: row.mentionType,
      },
    });
  }

  const attachmentInputs = (params.attachments ?? []).slice(0, CHAT_MAX_ATTACHMENTS_PER_MESSAGE);
  const storedAttachments = [];
  for (const att of attachmentInputs) {
    const parsed = parseDataUrl(att.data_url);
    if (!parsed) {
      throw Object.assign(new Error("Invalid attachment data_url"), { status: 400 });
    }
    const check = validateChatAttachment({
      contentType: parsed.contentType,
      size: parsed.body.length,
    });
    if (!check.ok) {
      throw Object.assign(new Error(check.error), { status: 400 });
    }
    const key = `orgs/${params.organizationId}/chat/${params.conversationId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
    const uploaded = await storage.upload({
      key,
      body: parsed.body,
      contentType: check.mime,
    });
    // MVP: thumbnail = same key for images (no image-processing dependency)
    const isImage = check.mime.startsWith("image/");
    const row = await tx.chatAttachment.create({
      data: {
        organizationId: params.organizationId,
        messageId: message.id,
        storageKey: uploaded.key,
        mimeType: check.mime,
        size: parsed.body.length,
        width: att.width ?? null,
        height: att.height ?? null,
        thumbnailKey: isImage ? uploaded.key : null,
        capturedAt: att.captured_at ? new Date(att.captured_at) : null,
        lat: att.lat != null ? new Prisma.Decimal(att.lat) : null,
        lng: att.lng != null ? new Prisma.Decimal(att.lng) : null,
      },
    });
    storedAttachments.push({
      id: row.id,
      storage_key: row.storageKey,
      url: uploaded.url || publicUrlForStorageKey(uploaded.key),
      thumb_url: isImage ? uploaded.url || publicUrlForStorageKey(uploaded.key) : null,
      mime_type: row.mimeType,
      size: row.size,
      width: row.width,
      height: row.height,
      captured_at: row.capturedAt?.toISOString() ?? null,
      lat: row.lat != null ? Number(row.lat) : null,
      lng: row.lng != null ? Number(row.lng) : null,
    });
  }

  // Bump author's read cursor
  await tx.chatConversationMember.updateMany({
    where: {
      conversationId: params.conversationId,
      userId: params.author.id,
      leftAt: null,
    },
    data: {
      lastReadAt: message.createdAt,
      lastReadMessageId: message.id,
    },
  });

  await tx.chatConversation.update({
    where: { id: params.conversationId },
    data: { updatedAt: new Date() },
  });

  return {
    message,
    mapped: mapMessageForViewer(message, params.author),
    attachments: storedAttachments,
    job_ids: [...jobLinkTargets],
    mention_user_ids: mentions.userIds,
    non_member_mentions: nonMemberMentions,
  };
}

export function previewFromBody(body: string): string {
  return body
    .replace(/<@user:[0-9a-f-]+>/gi, "@alguém")
    .replace(/<@team>/gi, "@equipe")
    .replace(/<@all>/gi, "@todos")
    .replace(/<#job:[0-9a-f-]+>/gi, "Job")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .slice(0, 140);
}

export async function notifyAfterMessage(params: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  authorId: string;
  body: string;
  memberUserIds: string[];
  mentionUserIds: string[];
  mutedUserIds?: string[];
}): Promise<void> {
  const preview = previewFromBody(params.body);
  const muted = new Set(params.mutedUserIds || []);
  const recipients = params.memberUserIds.filter(
    (id) => id !== params.authorId && !muted.has(id),
  );
  void chatNotifier.notify({
    type: "message",
    organizationId: params.organizationId,
    userIds: recipients,
    conversationId: params.conversationId,
    messageId: params.messageId,
    preview,
    excludeUserId: params.authorId,
  });
  const mentionRecipients = params.mentionUserIds.filter(
    (id) => id !== params.authorId && !muted.has(id),
  );
  if (mentionRecipients.length) {
    void chatNotifier.notify({
      type: "mention",
      organizationId: params.organizationId,
      userIds: mentionRecipients,
      conversationId: params.conversationId,
      messageId: params.messageId,
      preview,
      excludeUserId: params.authorId,
    });
  }
}
