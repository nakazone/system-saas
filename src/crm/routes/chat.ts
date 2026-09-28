/**
 * Internal chat API — conversations, messages, mentions, job links, search.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import {
  assertConversationAccess,
  canCreateGroup,
  canLinkRetroactive,
  canViewHiddenMessages,
  mapMessageForViewer,
  type ChatAccessUser,
} from "../../lib/chat/access.js";
import { dmKeyForUsers, ensureJobChatChannel, jobChannelDisplayName, jobChatParts, mapJobChatLabel, JOB_CHAT_LABEL_SELECT } from "../../lib/chat/job-channel.js";
import { CHAT_MESSAGE_RATE, checkRateLimit } from "../../lib/chat/rate-limit.js";
import {
  createChatMessage,
  notifyAfterMessage,
  type IncomingAttachment,
} from "../../lib/chat/send.js";
import { sanitizeChatBody } from "../../lib/chat/tokens.js";
import { publicUrlForStorageKey } from "../../lib/chat/attachments.js";
import {
  chatRealtimeBus,
  formatSseComment,
  formatSseFrame,
  publishChatEvent,
} from "../../lib/chat/realtime.js";
import { myJobAccessWhere } from "../lib/campo-shared.js";

export const chatRouter = Router();

const CHAT_JOB_STATUSES = ["draft", "scheduled", "in_progress", "completed", "canceled"] as const;
const CHAT_JOB_ACTIVE_STATUSES = ["draft", "scheduled", "in_progress"] as const;
const CHAT_OFFICE_SEE_ALL_ROLES = new Set([
  "admin",
  "general_manager",
  "office",
  "sales",
]);

/** Field roles only see jobs they are on (same rule as schedule/jobs board). */
function chatShouldScopeJobsToSelf(user: AuthedRequest["user"]): boolean {
  if (!user?.id) return false;
  const role = String(user.roleKey || "").toLowerCase();
  if (role === "installer" || role === "crew_lead" || role === "subcontractor") return true;
  if (CHAT_OFFICE_SEE_ALL_ROLES.has(role)) return false;
  const perms = user.permissions || [];
  if (perms.includes("work_orders.manage") || perms.includes("schedule.manage")) return false;
  return (
    perms.includes("work_orders.view") ||
    perms.includes("schedule.view") ||
    perms.includes("payroll.self") ||
    perms.includes("chat.use")
  );
}

function chatJobListScope(user: AuthedRequest["user"]): Record<string, unknown> {
  if (!chatShouldScopeJobsToSelf(user)) return {};
  return myJobAccessWhere(user!.id);
}

/** Parse `<input type="date">` value as local calendar day bounds. */
function parseDateInput(raw: string, endOfDay: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function chatUser(req: AuthedRequest): ChatAccessUser {
  return {
    id: req.user!.id,
    roleKey: req.user!.roleKey,
    permissions: req.user!.permissions,
  };
}

function httpError(res: import("express").Response, err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    const status = Number((err as { status: number }).status) || 500;
    const message = err instanceof Error ? err.message : "Error";
    res.status(status).json({ success: false, error: message });
    return true;
  }
  return false;
}

function mapAttachment(row: {
  id: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  thumbnailKey: string | null;
  capturedAt: Date | null;
  lat: Prisma.Decimal | number | null;
  lng: Prisma.Decimal | number | null;
}) {
  const url = publicUrlForStorageKey(row.storageKey);
  const thumb = row.thumbnailKey ? publicUrlForStorageKey(row.thumbnailKey) : null;
  return {
    id: row.id,
    storage_key: row.storageKey,
    url,
    thumb_url: thumb,
    mime_type: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    captured_at: row.capturedAt?.toISOString() ?? null,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
  };
}

const attachmentBody = z.object({
  data_url: z.string().min(1),
  captured_at: z.string().datetime().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  width: z.number().int().optional().nullable(),
  height: z.number().int().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Realtime SSE + typing
// ---------------------------------------------------------------------------

chatRouter.get(
  "/api/chat/events",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const filterConversationId = req.query.conversation_id
        ? String(req.query.conversation_id)
        : null;
      const lastEventId =
        (req.headers["last-event-id"] && String(req.headers["last-event-id"])) ||
        (req.query.last_event_id ? String(req.query.last_event_id) : null);

      const membership = await withTenantTransaction(req.organizationId!, async (tx) => {
        if (filterConversationId) {
          await assertConversationAccess(
            tx,
            req.organizationId!,
            filterConversationId,
            chatUser(req),
          );
          return { conversationIds: new Set([filterConversationId]), fixed: true };
        }
        const rows = await tx.chatConversationMember.findMany({
          where: { userId: req.user!.id, leftAt: null },
          select: { conversationId: true },
        });
        return { conversationIds: new Set(rows.map((r) => r.conversationId)), fixed: false };
      });

      // Mutable set — refreshed on heartbeat so new memberships are picked up
      const conversationIds = membership.conversationIds;
      const membershipFixed = membership.fixed;

      req.socket.setTimeout(0);
      res.setTimeout(0);
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
        (res as { flushHeaders: () => void }).flushHeaders();
      }

      res.write(formatSseComment("connected"));
      res.write(
        `id: chat_hello_${Date.now()}\nevent: ping\ndata: ${JSON.stringify({
          id: `chat_hello_${Date.now()}`,
          type: "ping",
          organizationId: req.organizationId!,
          conversationId: filterConversationId,
          at: new Date().toISOString(),
          actorId: req.user!.id,
          payload: { hello: true },
        })}\n\n`,
      );

      const replay = chatRealtimeBus.replaySince(lastEventId, {
        organizationId: req.organizationId!,
        userId: req.user!.id,
        conversationIds: conversationIds.size ? conversationIds : null,
      });
      for (const ev of replay) {
        if (ev.type === "ping") continue;
        if (conversationIds.size && !conversationIds.has(ev.conversationId)) continue;
        res.write(formatSseFrame(ev));
      }

      const unsubscribe = chatRealtimeBus.subscribe({
        organizationId: req.organizationId!,
        userId: req.user!.id,
        conversationIds,
        listener: (event) => {
          try {
            res.write(formatSseFrame(event));
          } catch {
            /* client gone */
          }
        },
      });

      const heartbeat = setInterval(() => {
        try {
          res.write(formatSseComment(`hb ${Date.now()}`));
        } catch {
          /* ignore */
        }
        if (membershipFixed) return;
        void withTenantTransaction(req.organizationId!, async (tx) => {
          const rows = await tx.chatConversationMember.findMany({
            where: { userId: req.user!.id, leftAt: null },
            select: { conversationId: true },
          });
          const next = new Set(rows.map((r) => r.conversationId));
          for (const id of conversationIds) {
            if (!next.has(id)) conversationIds.delete(id);
          }
          for (const id of next) conversationIds.add(id);
        }).catch(() => {
          /* ignore refresh errors */
        });
      }, 25000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.on("close", cleanup);
      res.on("close", cleanup);
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/conversations/:id/typing",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({
          typing: z.boolean().default(true),
        })
        .safeParse(req.body ?? {});
      const typing = parsed.success ? parsed.data.typing : true;

      await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
        );
        if (!access.membership) {
          throw Object.assign(new Error("Not a member of this conversation"), { status: 403 });
        }
      });

      const conversationId = String(req.params.id);
      const users = typing
        ? chatRealtimeBus.setTyping({
            conversationId,
            userId: req.user!.id,
            name: req.user!.name,
          })
        : chatRealtimeBus.clearTyping(conversationId, req.user!.id);

      publishChatEvent({
        type: "typing",
        organizationId: req.organizationId!,
        conversationId,
        actorId: req.user!.id,
        payload: {
          typing,
          user_id: req.user!.id,
          user_name: req.user!.name,
          users: users
            .filter((u) => u.userId !== req.user!.id)
            .map((u) => ({ user_id: u.userId, name: u.name })),
        },
      });

      res.json({
        success: true,
        data: {
          typing,
          users: users.map((u) => ({ user_id: u.userId, name: u.name })),
        },
      });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Conversations list
// ---------------------------------------------------------------------------

chatRouter.get(
  "/api/chat/conversations",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const q = String(req.query.q || "").trim().toLowerCase();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const memberships = await tx.chatConversationMember.findMany({
          where: { userId: req.user!.id, leftAt: null },
          include: {
            conversation: {
              include: {
                workOrder: { select: JOB_CHAT_LABEL_SELECT },
                members: {
                  where: { leftAt: null },
                  include: { user: { select: { id: true, name: true, status: true } } },
                },
              },
            },
          },
          orderBy: { conversation: { updatedAt: "desc" } },
        });

        const rows = [];
        for (const m of memberships) {
          const c = m.conversation;
          if (c.organizationId !== req.organizationId) continue;
          const last = await tx.chatMessage.findFirst({
            where: { conversationId: c.id },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              body: true,
              createdAt: true,
              authorId: true,
              type: true,
              hiddenAt: true,
            },
          });
          const unread = await tx.chatMessage.count({
            where: {
              conversationId: c.id,
              authorId: { not: req.user!.id },
              ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
              hiddenAt: null,
            },
          });
          const jobParts = c.workOrder ? jobChatParts(c.workOrder) : null;
          const title =
            c.type === "dm"
              ? c.members
                  .filter((x) => x.userId !== req.user!.id)
                  .map((x) => x.user.name)
                  .join(", ") || "DM"
              : c.type === "job" && jobParts
                ? jobParts.company
                : c.name || "Conversa";

          if (q) {
            const hay =
              `${title} ${c.name ?? ""} ${jobParts?.company ?? ""} ${jobParts?.address ?? ""} ${c.workOrder?.title ?? ""}`.toLowerCase();
            if (!hay.includes(q)) continue;
          }

          rows.push({
            id: c.id,
            type: c.type,
            name: c.name,
            title,
            subtitle: c.type === "job" ? jobParts?.address ?? null : null,
            work_order_id: c.workOrderId,
            work_order: c.workOrder
              ? {
                  id: c.workOrder.id,
                  number: c.workOrder.number,
                  title: c.workOrder.title,
                  status: c.workOrder.status,
                  address: c.workOrder.address,
                  customer_name: c.workOrder.customer?.name ?? null,
                  company: jobParts?.company ?? null,
                  label: jobChannelDisplayName(c.workOrder),
                }
              : null,
            archived_at: c.archivedAt?.toISOString() ?? null,
            muted: m.muted,
            unread_count: unread,
            last_message: last
              ? {
                  id: last.id,
                  body: last.hiddenAt ? "Mensagem removida" : last.body,
                  created_at: last.createdAt.toISOString(),
                  author_id: last.authorId,
                  type: last.type,
                }
              : null,
            updated_at: c.updatedAt.toISOString(),
            members: c.members.map((x) => ({
              user_id: x.userId,
              name: x.user.name,
              role: x.role,
            })),
          });
        }
        return rows;
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

chatRouter.get(
  "/api/chat/unread",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const memberships = await tx.chatConversationMember.findMany({
          where: { userId: req.user!.id, leftAt: null, muted: false },
          select: { conversationId: true, lastReadAt: true },
        });
        let total = 0;
        const byConversation: Record<string, number> = {};
        for (const m of memberships) {
          const count = await tx.chatMessage.count({
            where: {
              conversationId: m.conversationId,
              authorId: { not: req.user!.id },
              hiddenAt: null,
              ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
            },
          });
          if (count > 0) {
            byConversation[m.conversationId] = count;
            total += count;
          }
        }
        const unreadMentions = await tx.chatMessageMention.count({
          where: { userId: req.user!.id, readAt: null },
        });
        return { total, by_conversation: byConversation, unread_mentions: unreadMentions };
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// DM / Group create
// ---------------------------------------------------------------------------

chatRouter.post(
  "/api/chat/conversations/dm",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z.object({ user_id: z.string().uuid() }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "user_id required" });
        return;
      }
      if (parsed.data.user_id === req.user!.id) {
        res.status(400).json({ success: false, error: "Cannot DM yourself" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const other = await tx.user.findFirst({
          where: {
            id: parsed.data.user_id,
            organizationId: req.organizationId!,
            status: "active",
          },
          select: { id: true, name: true },
        });
        if (!other) throw Object.assign(new Error("User not found"), { status: 404 });

        const key = dmKeyForUsers(req.user!.id, other.id);
        let conv = await tx.chatConversation.findFirst({
          where: { organizationId: req.organizationId!, type: "dm", dmKey: key },
        });
        if (!conv) {
          conv = await tx.chatConversation.create({
            data: {
              organizationId: req.organizationId!,
              type: "dm",
              dmKey: key,
              createdById: req.user!.id,
            },
          });
          await tx.chatConversationMember.createMany({
            data: [
              {
                organizationId: req.organizationId!,
                conversationId: conv.id,
                userId: req.user!.id,
                role: "admin",
              },
              {
                organizationId: req.organizationId!,
                conversationId: conv.id,
                userId: other.id,
                role: "member",
              },
            ],
          });
        } else {
          // Rejoin if left
          await tx.chatConversationMember.updateMany({
            where: {
              conversationId: conv.id,
              userId: { in: [req.user!.id, other.id] },
              leftAt: { not: null },
            },
            data: { leftAt: null, joinedAt: new Date() },
          });
        }
        return { id: conv.id, type: "dm", other: { id: other.id, name: other.name } };
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/conversations/groups",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const user = chatUser(req);
      if (!canCreateGroup(user)) {
        res.status(403).json({ success: false, error: "Missing permission chat.create_group" });
        return;
      }
      const parsed = z
        .object({
          name: z.string().min(1).max(120),
          member_ids: z.array(z.string().uuid()).max(100).default([]),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid group payload" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const memberIds = [...new Set([req.user!.id, ...parsed.data.member_ids])];
        const valid = await tx.user.findMany({
          where: { organizationId: req.organizationId!, id: { in: memberIds }, status: "active" },
          select: { id: true },
        });
        const validIds = valid.map((u) => u.id);
        const conv = await tx.chatConversation.create({
          data: {
            organizationId: req.organizationId!,
            type: "group",
            name: parsed.data.name.trim(),
            createdById: req.user!.id,
          },
        });
        await tx.chatConversationMember.createMany({
          data: validIds.map((userId) => ({
            organizationId: req.organizationId!,
            conversationId: conv.id,
            userId,
            role: userId === req.user!.id ? "admin" : "member",
          })),
        });
        await tx.chatMessage.create({
          data: {
            organizationId: req.organizationId!,
            conversationId: conv.id,
            authorId: null,
            body: `${req.user!.name} criou o grupo.`,
            type: "system",
          },
        });
        return { id: conv.id, type: "group", name: conv.name, member_ids: validIds };
      });
      publishChatEvent({
        type: "conversation.updated",
        organizationId: req.organizationId!,
        conversationId: data.id,
        actorId: req.user!.id,
        payload: { reason: "group.created", name: data.name, member_ids: data.member_ids },
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

chatRouter.get(
  "/api/chat/conversations/:id",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
        );
        const members = await tx.chatConversationMember.findMany({
          where: { conversationId: access.conversation.id, leftAt: null },
          include: { user: { select: { id: true, name: true, email: true, status: true } } },
        });
        const context = await tx.chatConversationContext.findFirst({
          where: { conversationId: access.conversation.id, userId: req.user!.id },
          include: {
            workOrder: { select: JOB_CHAT_LABEL_SELECT },
          },
        });
        const jobChannelWo =
          access.conversation.type === "job" && access.conversation.workOrderId
            ? await tx.workOrder.findFirst({
                where: { id: access.conversation.workOrderId },
                select: JOB_CHAT_LABEL_SELECT,
              })
            : null;
        const contextWo = context?.workOrder || jobChannelWo;
        return {
          id: access.conversation.id,
          type: access.conversation.type,
          name:
            access.conversation.type === "job" && jobChannelWo
              ? jobChannelDisplayName(jobChannelWo)
              : access.conversation.name,
          work_order_id: access.conversation.workOrderId,
          archived_at: access.conversation.archivedAt?.toISOString() ?? null,
          elevated: access.elevated,
          muted: access.membership?.muted ?? false,
          members: members.map((m) => ({
            user_id: m.userId,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
            status: m.user.status,
          })),
          context_job: contextWo ? mapJobChatLabel(contextWo) : null,
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/conversations/:id/members",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({ user_ids: z.array(z.string().uuid()).min(1).max(50) })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "user_ids required" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
          { write: true },
        );
        if (access.conversation.type === "job") {
          throw Object.assign(new Error("Job channel members sync from job team"), { status: 400 });
        }
        if (access.conversation.type === "dm") {
          throw Object.assign(new Error("Cannot add members to a DM"), { status: 400 });
        }
        const users = await tx.user.findMany({
          where: {
            organizationId: req.organizationId!,
            id: { in: parsed.data.user_ids },
            status: "active",
          },
          select: { id: true, name: true },
        });
        const added = [];
        for (const u of users) {
          const existing = await tx.chatConversationMember.findFirst({
            where: { conversationId: access.conversation.id, userId: u.id },
          });
          if (existing?.leftAt) {
            await tx.chatConversationMember.update({
              where: { id: existing.id },
              data: { leftAt: null, joinedAt: new Date() },
            });
            added.push(u);
          } else if (!existing) {
            await tx.chatConversationMember.create({
              data: {
                organizationId: req.organizationId!,
                conversationId: access.conversation.id,
                userId: u.id,
                role: "member",
              },
            });
            added.push(u);
          }
        }
        if (added.length) {
          await tx.chatMessage.create({
            data: {
              organizationId: req.organizationId!,
              conversationId: access.conversation.id,
              authorId: null,
              body: `${req.user!.name} adicionou ${added.map((a) => a.name).join(", ")}.`,
              type: "system",
            },
          });
        }
        return { added: added.map((a) => ({ id: a.id, name: a.name })) };
      });
      if (data.added.length) {
        publishChatEvent({
          type: "conversation.updated",
          organizationId: req.organizationId!,
          conversationId: String(req.params.id),
          actorId: req.user!.id,
          payload: { reason: "members.added", added: data.added },
        });
      }
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.delete(
  "/api/chat/conversations/:id/members/:userId",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
          { write: true },
        );
        if (access.conversation.type !== "group") {
          throw Object.assign(new Error("Can only remove members from groups"), { status: 400 });
        }
        const targetId = String(req.params.userId);
        const target = await tx.user.findFirst({
          where: { id: targetId, organizationId: req.organizationId! },
          select: { id: true, name: true },
        });
        if (!target) throw Object.assign(new Error("User not found"), { status: 404 });
        await tx.chatConversationMember.updateMany({
          where: {
            conversationId: access.conversation.id,
            userId: targetId,
            leftAt: null,
          },
          data: { leftAt: new Date() },
        });
        await tx.chatMessage.create({
          data: {
            organizationId: req.organizationId!,
            conversationId: access.conversation.id,
            authorId: null,
            body: `${req.user!.name} removeu ${target.name}.`,
            type: "system",
          },
        });
        return { removed_user_id: targetId };
      });
      publishChatEvent({
        type: "conversation.updated",
        organizationId: req.organizationId!,
        conversationId: String(req.params.id),
        actorId: req.user!.id,
        payload: { reason: "members.removed", removed_user_id: data.removed_user_id },
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/conversations/:id/mute",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z.object({ muted: z.boolean() }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "muted boolean required" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
        );
        if (!access.membership) {
          throw Object.assign(new Error("Not a member of this conversation"), { status: 403 });
        }
        await tx.chatConversationMember.update({
          where: { id: access.membership.id },
          data: { muted: parsed.data.muted },
        });
        return { muted: parsed.data.muted };
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.put(
  "/api/chat/conversations/:id/context",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({ work_order_id: z.string().uuid().nullable() })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "work_order_id required (uuid or null)" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
        );
        if (access.conversation.type === "job") {
          throw Object.assign(new Error("Job channel context is fixed"), { status: 400 });
        }
        if (!access.membership) {
          throw Object.assign(new Error("Not a member of this conversation"), { status: 403 });
        }
        if (parsed.data.work_order_id === null) {
          await tx.chatConversationContext.deleteMany({
            where: { conversationId: access.conversation.id, userId: req.user!.id },
          });
          return { context_job: null };
        }
        const wo = await tx.workOrder.findFirst({
          where: { id: parsed.data.work_order_id, organizationId: req.organizationId! },
          select: JOB_CHAT_LABEL_SELECT,
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        await tx.chatConversationContext.upsert({
          where: {
            conversationId_userId: {
              conversationId: access.conversation.id,
              userId: req.user!.id,
            },
          },
          create: {
            organizationId: req.organizationId!,
            conversationId: access.conversation.id,
            userId: req.user!.id,
            workOrderId: wo.id,
          },
          update: { workOrderId: wo.id },
        });
        return { context_job: mapJobChatLabel(wo) };
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

chatRouter.get(
  "/api/chat/conversations/:id/messages",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
      const before = req.query.before ? String(req.query.before) : null;
      const after = req.query.after ? String(req.query.after) : null;
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
        );
        const viewer = chatUser(req);

        let beforeCreatedAt: Date | undefined;
        let afterCreatedAt: Date | undefined;
        if (before) {
          const m = await tx.chatMessage.findFirst({
            where: { id: before, conversationId: access.conversation.id },
            select: { createdAt: true },
          });
          beforeCreatedAt = m?.createdAt;
        }
        if (after) {
          const m = await tx.chatMessage.findFirst({
            where: { id: after, conversationId: access.conversation.id },
            select: { createdAt: true },
          });
          afterCreatedAt = m?.createdAt;
        }

        const rows = await tx.chatMessage.findMany({
          where: {
            conversationId: access.conversation.id,
            ...(beforeCreatedAt ? { createdAt: { lt: beforeCreatedAt } } : {}),
            ...(afterCreatedAt ? { createdAt: { gt: afterCreatedAt } } : {}),
          },
          orderBy: { createdAt: afterCreatedAt ? "asc" : "desc" },
          take: limit,
          include: {
            author: { select: { id: true, name: true } },
            attachments: true,
            jobLinks: {
              include: {
                workOrder: { select: JOB_CHAT_LABEL_SELECT },
              },
            },
            mentions: { select: { userId: true, mentionType: true, readAt: true } },
            edits: canViewHiddenMessages(viewer)
              ? { orderBy: { editedAt: "desc" }, take: 20 }
              : false,
          },
        });

        const ordered = afterCreatedAt ? rows : [...rows].reverse();
        return {
          messages: ordered.map((m) => ({
            ...mapMessageForViewer(m, viewer),
            author: m.author ? { id: m.author.id, name: m.author.name } : null,
            attachments: m.attachments.map(mapAttachment),
            jobs: m.jobLinks.map((j) => ({
              ...mapJobChatLabel(j.workOrder),
              source: j.source,
              linked_at: j.linkedAt.toISOString(),
            })),
            mentions: m.mentions,
            edits:
              "edits" in m && Array.isArray(m.edits)
                ? m.edits.map((e) => ({
                    previous_body: e.previousBody,
                    edited_by_id: e.editedById,
                    edited_at: e.editedAt.toISOString(),
                  }))
                : undefined,
          })),
          has_more: rows.length === limit,
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/conversations/:id/messages",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rate = checkRateLimit(
        `chat:msg:${req.organizationId}:${req.user!.id}`,
        CHAT_MESSAGE_RATE.limit,
        CHAT_MESSAGE_RATE.windowMs,
      );
      if (!rate.ok) {
        res.status(429).json({
          success: false,
          error: "Too many messages",
          retry_after_sec: rate.retryAfterSec,
        });
        return;
      }
      const parsed = z
        .object({
          body: z.string().max(20_000).default(""),
          attachments: z.array(attachmentBody).max(8).optional(),
          add_mentioned_members: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid message payload" });
        return;
      }

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
          { write: true },
        );
        if (!access.membership) {
          throw Object.assign(new Error("Not a member of this conversation"), { status: 403 });
        }

        let contextWorkOrderId: string | null = null;
        if (access.conversation.type !== "job") {
          const ctx = await tx.chatConversationContext.findFirst({
            where: { conversationId: access.conversation.id, userId: req.user!.id },
            select: { workOrderId: true },
          });
          contextWorkOrderId = ctx?.workOrderId ?? null;
        }

        const created = await createChatMessage(tx, {
          organizationId: req.organizationId!,
          conversationId: access.conversation.id,
          author: chatUser(req),
          body: parsed.data.body,
          attachments: parsed.data.attachments as IncomingAttachment[] | undefined,
          contextWorkOrderId,
          conversationType: access.conversation.type,
          conversationWorkOrderId: access.conversation.workOrderId,
        });

        if (parsed.data.add_mentioned_members && created.non_member_mentions.length) {
          for (const userId of created.non_member_mentions) {
            const existing = await tx.chatConversationMember.findFirst({
              where: { conversationId: access.conversation.id, userId },
            });
            if (existing?.leftAt) {
              await tx.chatConversationMember.update({
                where: { id: existing.id },
                data: { leftAt: null, joinedAt: new Date() },
              });
            } else if (!existing) {
              await tx.chatConversationMember.create({
                data: {
                  organizationId: req.organizationId!,
                  conversationId: access.conversation.id,
                  userId,
                  role: "member",
                },
              });
            }
          }
        }

        const members = await tx.chatConversationMember.findMany({
          where: { conversationId: access.conversation.id, leftAt: null },
          select: { userId: true, muted: true },
        });
        const unmutedIds = members.filter((m) => !m.muted).map((m) => m.userId);
        const mutedIds = members.filter((m) => m.muted).map((m) => m.userId);

        return {
          created,
          memberIds: unmutedIds,
          mutedIds,
          conversationId: access.conversation.id,
        };
      });

      void notifyAfterMessage({
        organizationId: req.organizationId!,
        conversationId: result.conversationId,
        messageId: result.created.message.id,
        authorId: req.user!.id,
        body: result.created.message.body,
        memberUserIds: result.memberIds,
        mentionUserIds: result.created.mention_user_ids,
        mutedUserIds: result.mutedIds,
      });

      chatRealtimeBus.clearTyping(result.conversationId, req.user!.id);
      publishChatEvent({
        type: "message.created",
        organizationId: req.organizationId!,
        conversationId: result.conversationId,
        actorId: req.user!.id,
        payload: {
          message: {
            ...result.created.mapped,
            attachments: result.created.attachments,
            job_ids: result.created.job_ids,
            mention_user_ids: result.created.mention_user_ids,
            author: { id: req.user!.id, name: req.user!.name },
          },
        },
      });
      if (result.created.mention_user_ids.length) {
        publishChatEvent({
          type: "mention.created",
          organizationId: req.organizationId!,
          conversationId: result.conversationId,
          actorId: req.user!.id,
          targetUserIds: result.created.mention_user_ids,
          payload: {
            message_id: result.created.message.id,
            mention_user_ids: result.created.mention_user_ids,
          },
        });
      }
      publishChatEvent({
        type: "conversation.updated",
        organizationId: req.organizationId!,
        conversationId: result.conversationId,
        actorId: req.user!.id,
        payload: { reason: "message.created", message_id: result.created.message.id },
      });

      res.status(201).json({
        success: true,
        data: {
          ...result.created.mapped,
          attachments: result.created.attachments,
          job_ids: result.created.job_ids,
          mention_user_ids: result.created.mention_user_ids,
          non_member_mentions: result.created.non_member_mentions,
        },
      });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.patch(
  "/api/chat/messages/:id",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z.object({ body: z.string().min(1).max(20_000) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "body required" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const message = await tx.chatMessage.findFirst({
          where: { id: String(req.params.id), organizationId: req.organizationId! },
        });
        if (!message) throw Object.assign(new Error("Message not found"), { status: 404 });
        if (message.authorId !== req.user!.id) {
          throw Object.assign(new Error("Only the author can edit"), { status: 403 });
        }
        if (message.hiddenAt) {
          throw Object.assign(new Error("Cannot edit a removed message"), { status: 400 });
        }
        if (message.type !== "text") {
          throw Object.assign(new Error("Cannot edit system messages"), { status: 400 });
        }
        await assertConversationAccess(tx, req.organizationId!, message.conversationId, chatUser(req), {
          write: true,
        });
        const nextBody = sanitizeChatBody(parsed.data.body);
        await tx.chatMessageEdit.create({
          data: {
            organizationId: req.organizationId!,
            messageId: message.id,
            previousBody: message.body,
            editedById: req.user!.id,
          },
        });
        const updated = await tx.chatMessage.update({
          where: { id: message.id },
          data: { body: nextBody, editedAt: new Date() },
        });
        return {
          conversationId: message.conversationId,
          mapped: mapMessageForViewer(updated, chatUser(req)),
        };
      });
      publishChatEvent({
        type: "message.updated",
        organizationId: req.organizationId!,
        conversationId: data.conversationId,
        actorId: req.user!.id,
        payload: { message: data.mapped },
      });
      res.json({ success: true, data: data.mapped });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.delete(
  "/api/chat/messages/:id",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const message = await tx.chatMessage.findFirst({
          where: { id: String(req.params.id), organizationId: req.organizationId! },
        });
        if (!message) throw Object.assign(new Error("Message not found"), { status: 404 });
        const viewer = chatUser(req);
        const isAuthor = message.authorId === req.user!.id;
        if (!isAuthor && !canViewHiddenMessages(viewer)) {
          throw Object.assign(new Error("Only the author can remove this message"), { status: 403 });
        }
        await assertConversationAccess(tx, req.organizationId!, message.conversationId, viewer, {
          write: true,
        });
        if (message.hiddenAt) {
          return {
            conversationId: message.conversationId,
            mapped: mapMessageForViewer(message, viewer),
          };
        }
        const updated = await tx.chatMessage.update({
          where: { id: message.id },
          data: { hiddenAt: new Date(), hiddenById: req.user!.id },
        });
        await tx.chatAuditLog.create({
          data: {
            organizationId: req.organizationId!,
            actorId: req.user!.id,
            action: "message.hide",
            targetType: "message",
            targetId: message.id,
            metadata: { conversation_id: message.conversationId },
          },
        });
        return {
          conversationId: message.conversationId,
          mapped: mapMessageForViewer(updated, viewer),
        };
      });
      publishChatEvent({
        type: "message.hidden",
        organizationId: req.organizationId!,
        conversationId: data.conversationId,
        actorId: req.user!.id,
        payload: { message: data.mapped },
      });
      res.json({ success: true, data: data.mapped });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/conversations/:id/read",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z
        .object({
          message_id: z.string().uuid().optional(),
        })
        .safeParse(req.body ?? {});
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const access = await assertConversationAccess(
          tx,
          req.organizationId!,
          String(req.params.id),
          chatUser(req),
        );
        if (!access.membership) {
          throw Object.assign(new Error("Not a member of this conversation"), { status: 403 });
        }
        let lastReadAt = new Date();
        let lastReadMessageId: string | null = parsed.data?.message_id ?? null;
        if (lastReadMessageId) {
          const msg = await tx.chatMessage.findFirst({
            where: { id: lastReadMessageId, conversationId: access.conversation.id },
            select: { id: true, createdAt: true },
          });
          if (!msg) throw Object.assign(new Error("Message not found"), { status: 404 });
          lastReadAt = msg.createdAt;
          lastReadMessageId = msg.id;
        } else {
          const last = await tx.chatMessage.findFirst({
            where: { conversationId: access.conversation.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, createdAt: true },
          });
          if (last) {
            lastReadAt = last.createdAt;
            lastReadMessageId = last.id;
          }
        }
        await tx.chatConversationMember.update({
          where: { id: access.membership.id },
          data: { lastReadAt, lastReadMessageId },
        });
        return {
          conversation_id: access.conversation.id,
          last_read_at: lastReadAt.toISOString(),
          last_read_message_id: lastReadMessageId,
        };
      });
      publishChatEvent({
        type: "read",
        organizationId: req.organizationId!,
        conversationId: data.conversation_id,
        actorId: req.user!.id,
        payload: {
          user_id: req.user!.id,
          user_name: req.user!.name,
          last_read_at: data.last_read_at,
          last_read_message_id: data.last_read_message_id,
        },
      });
      res.json({
        success: true,
        data: {
          last_read_at: data.last_read_at,
          last_read_message_id: data.last_read_message_id,
        },
      });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.get(
  "/api/chat/messages/:id/seen-by",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const message = await tx.chatMessage.findFirst({
          where: { id: String(req.params.id), organizationId: req.organizationId! },
          select: {
            id: true,
            conversationId: true,
            createdAt: true,
            authorId: true,
          },
        });
        if (!message) throw Object.assign(new Error("Message not found"), { status: 404 });
        await assertConversationAccess(tx, req.organizationId!, message.conversationId, chatUser(req));
        const members = await tx.chatConversationMember.findMany({
          where: {
            conversationId: message.conversationId,
            leftAt: null,
            lastReadAt: { gte: message.createdAt },
            userId: { not: message.authorId ?? undefined },
          },
          include: { user: { select: { id: true, name: true } } },
        });
        return {
          message_id: message.id,
          seen_by: members.map((m) => ({
            user_id: m.userId,
            name: m.user.name,
            last_read_at: m.lastReadAt?.toISOString() ?? null,
          })),
        };
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Retroactive job link
// ---------------------------------------------------------------------------

chatRouter.post(
  "/api/chat/messages/link-jobs",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const viewer = chatUser(req);
      if (!canLinkRetroactive(viewer)) {
        res.status(403).json({ success: false, error: "Missing permission chat.link_retroactive" });
        return;
      }
      const parsed = z
        .object({
          message_ids: z.array(z.string().uuid()).min(1).max(50),
          work_order_ids: z.array(z.string().uuid()).min(1).max(20),
          action: z.enum(["link", "unlink"]).default("link"),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid link-jobs payload" });
        return;
      }
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const messages = await tx.chatMessage.findMany({
          where: {
            organizationId: req.organizationId!,
            id: { in: parsed.data.message_ids },
          },
          select: { id: true, conversationId: true },
        });
        if (messages.length !== parsed.data.message_ids.length) {
          throw Object.assign(new Error("One or more messages not found"), { status: 404 });
        }
        for (const m of messages) {
          await assertConversationAccess(tx, req.organizationId!, m.conversationId, viewer);
        }
        const jobs = await tx.workOrder.findMany({
          where: {
            organizationId: req.organizationId!,
            id: { in: parsed.data.work_order_ids },
          },
          select: { id: true },
        });
        if (jobs.length !== parsed.data.work_order_ids.length) {
          throw Object.assign(new Error("One or more jobs not found"), { status: 404 });
        }

        let changed = 0;
        if (parsed.data.action === "unlink") {
          const result = await tx.chatMessageJob.deleteMany({
            where: {
              messageId: { in: parsed.data.message_ids },
              workOrderId: { in: parsed.data.work_order_ids },
            },
          });
          changed = result.count;
        } else {
          for (const messageId of parsed.data.message_ids) {
            for (const workOrderId of parsed.data.work_order_ids) {
              try {
                await tx.chatMessageJob.create({
                  data: {
                    organizationId: req.organizationId!,
                    messageId,
                    workOrderId,
                    linkedById: req.user!.id,
                    source: "retroactive",
                  },
                });
                changed += 1;
              } catch {
                /* unique — already linked */
              }
            }
          }
        }
        await tx.chatAuditLog.create({
          data: {
            organizationId: req.organizationId!,
            actorId: req.user!.id,
            action: parsed.data.action === "link" ? "message.link_jobs" : "message.unlink_jobs",
            targetType: "message",
            targetId: parsed.data.message_ids[0]!,
            metadata: {
              message_ids: parsed.data.message_ids,
              work_order_ids: parsed.data.work_order_ids,
              changed,
            },
          },
        });
        return { changed, action: parsed.data.action };
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Job timeline + gallery (Comunicações data)
// ---------------------------------------------------------------------------

chatRouter.get(
  "/api/chat/jobs/:workOrderId/timeline",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workOrderId = String(req.params.workOrderId);
      const personId = req.query.person_id ? String(req.query.person_id) : null;
      const q = String(req.query.q || "").trim();
      const withAttachments = String(req.query.with_attachments || "") === "1";
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to = req.query.to ? new Date(String(req.query.to)) : null;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: workOrderId, organizationId: req.organizationId! },
          select: { id: true },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });

        const links = await tx.chatMessageJob.findMany({
          where: {
            workOrderId,
            message: {
              ...(personId ? { authorId: personId } : {}),
              ...(from || to
                ? {
                    createdAt: {
                      ...(from ? { gte: from } : {}),
                      ...(to ? { lte: to } : {}),
                    },
                  }
                : {}),
              ...(q
                ? {
                    body: { contains: q, mode: "insensitive" },
                  }
                : {}),
              ...(withAttachments ? { attachments: { some: {} } } : {}),
            },
          },
          orderBy: { linkedAt: "desc" },
          take: limit,
          include: {
            message: {
              include: {
                author: { select: { id: true, name: true } },
                attachments: true,
                conversation: {
                  select: { id: true, type: true, name: true },
                },
              },
            },
          },
        });

        const viewer = chatUser(req);
        // Privacy: DM messages only appear because they were explicitly linked (this query is via ChatMessageJob)
        return links.map((link) => {
          const m = link.message;
          const mapped = mapMessageForViewer(m, viewer);
          return {
            ...mapped,
            author: m.author ? { id: m.author.id, name: m.author.name } : null,
            attachments: m.attachments.map(mapAttachment),
            conversation: {
              id: m.conversation.id,
              type: m.conversation.type,
              name: m.conversation.name,
            },
            link_source: link.source,
            linked_at: link.linkedAt.toISOString(),
            linked_by_id: link.linkedById,
          };
        });
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.get(
  "/api/chat/jobs/:workOrderId/gallery",
  requireCrmAuth,
  requireCrmPermission("work_orders.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const workOrderId = String(req.params.workOrderId);
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: workOrderId, organizationId: req.organizationId! },
          select: { id: true },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        const media = await tx.chatAttachment.findMany({
          where: {
            organizationId: req.organizationId!,
            message: {
              jobLinks: { some: { workOrderId } },
              hiddenAt: null,
            },
            OR: [{ mimeType: { startsWith: "image/" } }, { mimeType: { startsWith: "video/" } }],
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          include: {
            message: {
              select: {
                id: true,
                conversationId: true,
                authorId: true,
                createdAt: true,
              },
            },
          },
        });
        return media.map((a) => ({
          ...mapAttachment(a),
          message_id: a.message.id,
          conversation_id: a.message.conversationId,
          author_id: a.message.authorId,
          message_created_at: a.message.createdAt.toISOString(),
        }));
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Mentions, search, autocomplete
// ---------------------------------------------------------------------------

chatRouter.get(
  "/api/chat/mentions",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const unreadOnly = String(req.query.unread || "") === "1";
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const rows = await tx.chatMessageMention.findMany({
          where: {
            userId: req.user!.id,
            ...(unreadOnly ? { readAt: null } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            message: {
              include: {
                author: { select: { id: true, name: true } },
                conversation: { select: { id: true, type: true, name: true } },
              },
            },
          },
        });
        return rows.map((r) => ({
          id: r.id,
          mention_type: r.mentionType,
          read_at: r.readAt?.toISOString() ?? null,
          created_at: r.createdAt.toISOString(),
          message: {
            id: r.message.id,
            body: r.message.hiddenAt ? "Mensagem removida" : r.message.body,
            created_at: r.message.createdAt.toISOString(),
            author: r.message.author,
            conversation: r.message.conversation,
          },
        }));
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/mentions/read-all",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const result = await tx.chatMessageMention.updateMany({
          where: { userId: req.user!.id, readAt: null },
          data: { readAt: new Date() },
        });
        return { updated: result.count };
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

chatRouter.post(
  "/api/chat/mentions/:id/read",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const row = await tx.chatMessageMention.findFirst({
          where: { id: String(req.params.id), userId: req.user!.id },
        });
        if (!row) throw Object.assign(new Error("Mention not found"), { status: 404 });
        const updated = await tx.chatMessageMention.update({
          where: { id: row.id },
          data: { readAt: new Date() },
        });
        return { id: updated.id, read_at: updated.readAt?.toISOString() ?? null };
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);

chatRouter.get(
  "/api/chat/search",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < 2) {
        res.status(400).json({ success: false, error: "q must be at least 2 characters" });
        return;
      }
      const conversationId = req.query.conversation_id
        ? String(req.query.conversation_id)
        : null;
      const personId = req.query.person_id ? String(req.query.person_id) : null;
      const workOrderId = req.query.work_order_id ? String(req.query.work_order_id) : null;
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to = req.query.to ? new Date(String(req.query.to)) : null;

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const memberOf = await tx.chatConversationMember.findMany({
          where: { userId: req.user!.id, leftAt: null },
          select: { conversationId: true },
        });
        const allowedIds = memberOf.map((m) => m.conversationId);
        if (!allowedIds.length) return [];

        // Full-text via Postgres (membership-scoped)
        type FtsRow = { id: string };
        let ids: string[] = [];
        if (allowedIds.length) {
          try {
            const fts = await tx.$queryRaw<FtsRow[]>`
              SELECT m.id
              FROM "ChatMessage" m
              WHERE m."organizationId" = ${req.organizationId!}::uuid
                AND m."conversationId" IN (${Prisma.join(allowedIds.map((id) => Prisma.sql`${id}::uuid`))})
                AND to_tsvector('simple', coalesce(m.body, '')) @@ plainto_tsquery('simple', ${q})
              ORDER BY m."createdAt" DESC
              LIMIT 50
            `;
            ids = fts.map((r) => r.id);
          } catch {
            ids = [];
          }
        }
        if (!ids.length) {
          const fallback = await tx.chatMessage.findMany({
            where: {
              organizationId: req.organizationId!,
              conversationId: { in: allowedIds },
              body: { contains: q, mode: "insensitive" },
            },
            select: { id: true },
            take: 50,
            orderBy: { createdAt: "desc" },
          });
          ids = fallback.map((r) => r.id);
        }

        const messages = await tx.chatMessage.findMany({
          where: {
            id: { in: ids },
            ...(conversationId ? { conversationId } : {}),
            ...(personId ? { authorId: personId } : {}),
            ...(workOrderId ? { jobLinks: { some: { workOrderId } } } : {}),
            ...(from || to
              ? {
                  createdAt: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                }
              : {}),
          },
          include: {
            author: { select: { id: true, name: true } },
            conversation: { select: { id: true, type: true, name: true } },
            jobLinks: {
              include: { workOrder: { select: { id: true, number: true, title: true } } },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });

        const viewer = chatUser(req);
        return messages.map((m) => ({
          ...mapMessageForViewer(m, viewer),
          author: m.author,
          conversation: m.conversation,
          jobs: m.jobLinks.map((j) => ({
            id: j.workOrder.id,
            number: j.workOrder.number,
            title: j.workOrder.title,
          })),
        }));
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

chatRouter.get(
  "/api/chat/users",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        return tx.user.findMany({
          where: {
            organizationId: req.organizationId!,
            status: "active",
            ...(q
              ? {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
          take: 30,
        });
      });
      res.json({
        success: true,
        data: data.map((u) => ({ id: u.id, name: u.name, email: u.email })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Jobs board for the Chat "Jobs" tab — auto-lists work orders (not only existing channels)
 * with status / date / search filters. Click → ensure-channel.
 */
chatRouter.get(
  "/api/chat/jobs",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      const statusRaw = String(req.query.status || "active").trim().toLowerCase();
      const fromRaw = typeof req.query.from === "string" ? req.query.from : "";
      const toRaw = typeof req.query.to === "string" ? req.query.to : "";
      const from = fromRaw ? parseDateInput(fromRaw, false) : null;
      const to = toRaw ? parseDateInput(toRaw, true) : null;
      const hasFrom = !!from;
      const hasTo = !!to;

      let statusFilter: string[] | null = null;
      if (statusRaw === "active" || statusRaw === "") {
        statusFilter = [...CHAT_JOB_ACTIVE_STATUSES];
      } else if (statusRaw === "all") {
        statusFilter = null;
      } else if ((CHAT_JOB_STATUSES as readonly string[]).includes(statusRaw)) {
        statusFilter = [statusRaw];
      } else {
        res.status(400).json({ success: false, error: "Invalid status filter" });
        return;
      }

      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const fieldScope = chatJobListScope(req.user);
        const searchOr = q
          ? [
              { title: { contains: q, mode: "insensitive" as const } },
              { address: { contains: q, mode: "insensitive" as const } },
              { sourceName: { contains: q, mode: "insensitive" as const } },
              { customer: { name: { contains: q, mode: "insensitive" as const } } },
              ...(Number.isFinite(Number(q)) && String(Number(q)) === q
                ? [{ number: Number(q) }]
                : []),
            ]
          : null;

        const scheduleWhere =
          hasFrom && hasTo
            ? { scheduledStart: { lte: to! }, scheduledEnd: { gte: from! } }
            : hasFrom
              ? {
                  OR: [
                    { scheduledStart: { gte: from! } },
                    { scheduledEnd: { gte: from! } },
                  ],
                }
              : hasTo
                ? { scheduledStart: { lte: to! } }
                : null;

        const rows = await tx.workOrder.findMany({
          where: {
            organizationId: req.organizationId!,
            ...(statusFilter ? { status: { in: statusFilter } } : {}),
            ...(scheduleWhere || {}),
            ...(Object.keys(fieldScope).length || searchOr
              ? {
                  AND: [
                    ...(Object.keys(fieldScope).length ? [fieldScope] : []),
                    ...(searchOr ? [{ OR: searchOr }] : []),
                  ],
                }
              : {}),
          },
          select: {
            ...JOB_CHAT_LABEL_SELECT,
            scheduledStart: true,
            scheduledEnd: true,
            assignedUser: { select: { id: true, name: true } },
          },
          orderBy: [{ scheduledStart: "asc" }, { updatedAt: "desc" }],
          take: 100,
        });

        const woIds = rows.map((r) => r.id);
        const channels = woIds.length
          ? await tx.chatConversation.findMany({
              where: {
                organizationId: req.organizationId!,
                type: "job",
                workOrderId: { in: woIds },
              },
              select: {
                id: true,
                workOrderId: true,
                updatedAt: true,
                members: {
                  where: { userId: req.user!.id, leftAt: null },
                  select: { lastReadAt: true, muted: true },
                },
              },
            })
          : [];
        const byWo = new Map(channels.map((c) => [c.workOrderId!, c]));

        const out = [];
        for (const r of rows) {
          const ch = byWo.get(r.id);
          const membership = ch?.members[0] ?? null;
          let unread = 0;
          let lastMessage: {
            id: string;
            body: string;
            created_at: string;
            type: string;
          } | null = null;
          if (ch) {
            const last = await tx.chatMessage.findFirst({
              where: { conversationId: ch.id },
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                body: true,
                createdAt: true,
                type: true,
                hiddenAt: true,
              },
            });
            if (last) {
              lastMessage = {
                id: last.id,
                body: last.hiddenAt ? "Mensagem removida" : last.body,
                created_at: last.createdAt.toISOString(),
                type: last.type,
              };
            }
            if (membership) {
              unread = await tx.chatMessage.count({
                where: {
                  conversationId: ch.id,
                  authorId: { not: req.user!.id },
                  hiddenAt: null,
                  ...(membership.lastReadAt
                    ? { createdAt: { gt: membership.lastReadAt } }
                    : {}),
                },
              });
            }
          }
          out.push({
            ...mapJobChatLabel(r),
            assigned_user: r.assignedUser
              ? { id: r.assignedUser.id, name: r.assignedUser.name }
              : null,
            scheduled_start: r.scheduledStart?.toISOString() ?? null,
            scheduled_end: r.scheduledEnd?.toISOString() ?? null,
            conversation_id: ch?.id ?? null,
            unread_count: unread,
            last_message: lastMessage,
            muted: membership?.muted ?? false,
          });
        }
        return out;
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

chatRouter.get(
  "/api/chat/jobs-suggest",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const activeFirst = ["draft", "scheduled", "in_progress"];
        const rows = await tx.workOrder.findMany({
          where: {
            organizationId: req.organizationId!,
            status: { not: "canceled" },
            ...(q
              ? {
                  OR: [
                    { title: { contains: q, mode: "insensitive" } },
                    { address: { contains: q, mode: "insensitive" } },
                    ...(Number.isFinite(Number(q)) ? [{ number: Number(q) }] : []),
                    { customer: { name: { contains: q, mode: "insensitive" } } },
                  ],
                }
              : {}),
          },
          select: JOB_CHAT_LABEL_SELECT,
          take: 40,
          orderBy: [{ updatedAt: "desc" }],
        });
        rows.sort((a, b) => {
          const aActive = activeFirst.includes(a.status) ? 0 : 1;
          const bActive = activeFirst.includes(b.status) ? 0 : 1;
          return aActive - bActive;
        });
        return rows.slice(0, 25).map((r) => {
          const mapped = mapJobChatLabel(r);
          return {
            ...mapped,
            token: `<#job:${r.id}>`,
            sub: [mapped.address, mapped.status].filter(Boolean).join(" · "),
          };
        });
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

/** Ensure job channel exists (used by UI / backfill). */
chatRouter.post(
  "/api/chat/jobs/:workOrderId/ensure-channel",
  requireCrmAuth,
  requireCrmPermission("chat.use"),
  async (req: AuthedRequest, res, next) => {
    try {
      const data = await withTenantTransaction(req.organizationId!, async (tx) => {
        const wo = await tx.workOrder.findFirst({
          where: { id: String(req.params.workOrderId), organizationId: req.organizationId! },
          select: { id: true },
        });
        if (!wo) throw Object.assign(new Error("Job not found"), { status: 404 });
        return ensureJobChatChannel(tx, req.organizationId!, wo.id);
      });
      res.json({ success: true, data });
    } catch (error) {
      if (httpError(res, error)) return;
      next(error);
    }
  },
);
