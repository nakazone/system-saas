import type { TenantPrisma } from "../tenant/prisma-tenant.js";

export type ChatAccessUser = {
  id: string;
  roleKey: string | null;
  permissions: string[];
};

export function hasChatPermission(user: ChatAccessUser, key: string): boolean {
  if (user.roleKey === "admin") return true;
  return user.permissions.includes(key);
}

export function canViewHiddenMessages(user: ChatAccessUser): boolean {
  return hasChatPermission(user, "chat.view_hidden");
}

export function canMentionAll(user: ChatAccessUser): boolean {
  return hasChatPermission(user, "chat.mention_all");
}

export function canLinkRetroactive(user: ChatAccessUser): boolean {
  return hasChatPermission(user, "chat.link_retroactive");
}

export function canCreateGroup(user: ChatAccessUser): boolean {
  return hasChatPermission(user, "chat.create_group");
}

export function isElevatedAdmin(user: ChatAccessUser): boolean {
  return (
    user.roleKey === "admin" ||
    user.permissions.includes("roles.manage") ||
    user.permissions.includes("settings.manage")
  );
}

export type ConversationAccess = {
  conversation: {
    id: string;
    type: string;
    workOrderId: string | null;
    archivedAt: Date | null;
    name: string | null;
  };
  membership: {
    id: string;
    role: string;
    muted: boolean;
    lastReadAt: Date | null;
    lastReadMessageId: string | null;
    leftAt: Date | null;
  } | null;
  elevated: boolean;
};

export async function assertConversationAccess(
  tx: TenantPrisma,
  organizationId: string,
  conversationId: string,
  user: ChatAccessUser,
  options?: { write?: boolean },
): Promise<ConversationAccess> {
  const conversation = await tx.chatConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: {
      id: true,
      type: true,
      workOrderId: true,
      archivedAt: true,
      name: true,
    },
  });
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }

  const membership = await tx.chatConversationMember.findFirst({
    where: {
      conversationId,
      userId: user.id,
      leftAt: null,
    },
    select: {
      id: true,
      role: true,
      muted: true,
      lastReadAt: true,
      lastReadMessageId: true,
      leftAt: true,
    },
  });

  if (membership) {
    if (options?.write && conversation.archivedAt) {
      throw Object.assign(new Error("Conversation is read-only"), { status: 403 });
    }
    return { conversation, membership, elevated: false };
  }

  if (isElevatedAdmin(user)) {
    await tx.chatAuditLog.create({
      data: {
        organizationId,
        actorId: user.id,
        action: options?.write ? "conversation.elevated_write" : "conversation.elevated_read",
        targetType: "conversation",
        targetId: conversationId,
        metadata: { reason: "admin_bypass" },
      },
    });
    if (options?.write && conversation.archivedAt) {
      throw Object.assign(new Error("Conversation is read-only"), { status: 403 });
    }
    // Elevated admins may read; writes still require membership except system ops
    if (options?.write) {
      throw Object.assign(new Error("Not a member of this conversation"), { status: 403 });
    }
    return { conversation, membership: null, elevated: true };
  }

  throw Object.assign(new Error("Not a member of this conversation"), { status: 403 });
}

export function mapMessageForViewer(
  message: {
    id: string;
    body: string;
    type: string;
    createdAt: Date;
    editedAt: Date | null;
    hiddenAt: Date | null;
    hiddenById: string | null;
    authorId: string | null;
  },
  viewer: ChatAccessUser,
): {
  id: string;
  body: string | null;
  type: string;
  created_at: string;
  edited_at: string | null;
  hidden: boolean;
  hidden_placeholder: string | null;
  author_id: string | null;
  can_view_original: boolean;
} {
  const canView = canViewHiddenMessages(viewer);
  const hidden = Boolean(message.hiddenAt);
  if (hidden && !canView) {
    return {
      id: message.id,
      body: null,
      type: message.type,
      created_at: message.createdAt.toISOString(),
      edited_at: message.editedAt?.toISOString() ?? null,
      hidden: true,
      hidden_placeholder: "Mensagem removida",
      author_id: message.authorId,
      can_view_original: false,
    };
  }
  return {
    id: message.id,
    body: message.body,
    type: message.type,
    created_at: message.createdAt.toISOString(),
    edited_at: message.editedAt?.toISOString() ?? null,
    hidden,
    hidden_placeholder: hidden ? "Mensagem removida" : null,
    author_id: message.authorId,
    can_view_original: hidden && canView,
  };
}
