/**
 * Chat realtime bus — in-memory pub/sub for SSE.
 * Swap implementation later (Postgres LISTEN/NOTIFY / Redis) behind the same interface.
 */

import { randomUUID } from "node:crypto";

export const CHAT_REALTIME_EVENT_TYPES = [
  "message.created",
  "message.updated",
  "message.hidden",
  "typing",
  "read",
  "mention.created",
  "conversation.updated",
  "ping",
] as const;

export type ChatRealtimeEventType = (typeof CHAT_REALTIME_EVENT_TYPES)[number];

export type ChatRealtimeEvent = {
  /** Monotonic-ish event id for Last-Event-ID / catch-up */
  id: string;
  type: ChatRealtimeEventType;
  organizationId: string;
  conversationId: string;
  at: string;
  actorId?: string | null;
  /** Target users for mention.created; empty/undefined = all conversation subscribers */
  targetUserIds?: string[];
  payload: Record<string, unknown>;
};

export type ChatRealtimePublishInput = {
  type: ChatRealtimeEventType;
  organizationId: string;
  conversationId: string;
  actorId?: string | null;
  targetUserIds?: string[];
  payload?: Record<string, unknown>;
  at?: string;
};

export type ChatRealtimeSubscription = {
  organizationId: string;
  userId: string;
  /** Restrict to these conversations; null = any conversation the filter allows */
  conversationIds: Set<string> | null;
  listener: (event: ChatRealtimeEvent) => void;
};

export interface ChatRealtimeBus {
  publish(input: ChatRealtimePublishInput): ChatRealtimeEvent;
  subscribe(sub: ChatRealtimeSubscription): () => void;
  /** Replay events after lastEventId (exclusive), filtered for subscriber */
  replaySince(
    lastEventId: string | null | undefined,
    filter: {
      organizationId: string;
      userId: string;
      conversationIds: Set<string> | null;
    },
  ): ChatRealtimeEvent[];
  subscriberCount(): number;
  /** Test helper */
  clear(): void;
}

const RING_MAX = 800;

type TypingEntry = { userId: string; name: string; expiresAt: number };

export class InMemoryChatRealtimeBus implements ChatRealtimeBus {
  private seq = 0;
  private ring: ChatRealtimeEvent[] = [];
  private subs = new Set<ChatRealtimeSubscription>();
  /** conversationId → userId → typing */
  private typing = new Map<string, Map<string, TypingEntry>>();

  publish(input: ChatRealtimePublishInput): ChatRealtimeEvent {
    this.seq += 1;
    const event: ChatRealtimeEvent = {
      id: `chat_${this.seq}_${randomUUID().slice(0, 8)}`,
      type: input.type,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      at: input.at ?? new Date().toISOString(),
      actorId: input.actorId ?? null,
      targetUserIds: input.targetUserIds,
      payload: input.payload ?? {},
    };
    this.ring.push(event);
    if (this.ring.length > RING_MAX) {
      this.ring.splice(0, this.ring.length - RING_MAX);
    }
    for (const sub of this.subs) {
      if (!this.matches(sub, event)) continue;
      try {
        sub.listener(event);
      } catch (err) {
        console.error("[chat-realtime] listener error", err);
      }
    }
    return event;
  }

  subscribe(sub: ChatRealtimeSubscription): () => void {
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  replaySince(
    lastEventId: string | null | undefined,
    filter: {
      organizationId: string;
      userId: string;
      conversationIds: Set<string> | null;
    },
  ): ChatRealtimeEvent[] {
    if (!lastEventId) return [];
    const idx = this.ring.findIndex((e) => e.id === lastEventId);
    const slice = idx >= 0 ? this.ring.slice(idx + 1) : this.ring.slice(-50);
    const pseudo: ChatRealtimeSubscription = {
      ...filter,
      listener: () => {},
    };
    return slice.filter((e) => this.matches(pseudo, e));
  }

  subscriberCount(): number {
    return this.subs.size;
  }

  clear(): void {
    this.seq = 0;
    this.ring = [];
    this.subs.clear();
    this.typing.clear();
  }

  setTyping(params: {
    conversationId: string;
    userId: string;
    name: string;
    ttlMs?: number;
  }): TypingEntry[] {
    const ttl = params.ttlMs ?? 5000;
    let map = this.typing.get(params.conversationId);
    if (!map) {
      map = new Map();
      this.typing.set(params.conversationId, map);
    }
    const entry: TypingEntry = {
      userId: params.userId,
      name: params.name,
      expiresAt: Date.now() + ttl,
    };
    map.set(params.userId, entry);
    return this.getTyping(params.conversationId);
  }

  clearTyping(conversationId: string, userId: string): TypingEntry[] {
    const map = this.typing.get(conversationId);
    if (map) {
      map.delete(userId);
      if (map.size === 0) this.typing.delete(conversationId);
    }
    return this.getTyping(conversationId);
  }

  getTyping(conversationId: string): TypingEntry[] {
    const map = this.typing.get(conversationId);
    if (!map) return [];
    const now = Date.now();
    for (const [uid, entry] of map) {
      if (entry.expiresAt <= now) map.delete(uid);
    }
    if (map.size === 0) {
      this.typing.delete(conversationId);
      return [];
    }
    return [...map.values()];
  }

  private matches(sub: ChatRealtimeSubscription, event: ChatRealtimeEvent): boolean {
    if (sub.organizationId !== event.organizationId) return false;
    if (sub.conversationIds && !sub.conversationIds.has(event.conversationId)) return false;
    if (event.type === "mention.created" && event.targetUserIds?.length) {
      return event.targetUserIds.includes(sub.userId);
    }
    return true;
  }
}

export const chatRealtimeBus = new InMemoryChatRealtimeBus();

export function publishChatEvent(input: ChatRealtimePublishInput): ChatRealtimeEvent {
  return chatRealtimeBus.publish(input);
}

/** Format one SSE frame */
export function formatSseFrame(event: ChatRealtimeEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function formatSseComment(text: string): string {
  return `: ${text}\n\n`;
}
