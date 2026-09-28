import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryChatRealtimeBus,
  formatSseFrame,
  formatSseComment,
} from "../src/lib/chat/realtime.js";

describe("chat realtime bus", () => {
  let bus: InMemoryChatRealtimeBus;

  beforeEach(() => {
    bus = new InMemoryChatRealtimeBus();
  });

  it("delivers events only to matching org + conversation subscribers", () => {
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const org = "org-1";
    const c1 = "conv-1";
    const c2 = "conv-2";

    bus.subscribe({
      organizationId: org,
      userId: "u1",
      conversationIds: new Set([c1]),
      listener: (e) => receivedA.push(e.type),
    });
    bus.subscribe({
      organizationId: org,
      userId: "u2",
      conversationIds: new Set([c2]),
      listener: (e) => receivedB.push(e.type),
    });

    bus.publish({
      type: "message.created",
      organizationId: org,
      conversationId: c1,
      actorId: "u1",
      payload: { ok: true },
    });
    bus.publish({
      type: "typing",
      organizationId: org,
      conversationId: c2,
      actorId: "u2",
    });
    bus.publish({
      type: "message.created",
      organizationId: "other-org",
      conversationId: c1,
      actorId: "x",
    });

    expect(receivedA).toEqual(["message.created"]);
    expect(receivedB).toEqual(["typing"]);
  });

  it("scopes mention.created to target users only", () => {
    const hits: string[] = [];
    const org = "org-1";
    const conv = "conv-1";
    bus.subscribe({
      organizationId: org,
      userId: "mentioned",
      conversationIds: new Set([conv]),
      listener: (e) => hits.push(`mentioned:${e.type}`),
    });
    bus.subscribe({
      organizationId: org,
      userId: "other",
      conversationIds: new Set([conv]),
      listener: (e) => hits.push(`other:${e.type}`),
    });

    bus.publish({
      type: "mention.created",
      organizationId: org,
      conversationId: conv,
      actorId: "author",
      targetUserIds: ["mentioned"],
      payload: { message_id: "m1" },
    });
    bus.publish({
      type: "message.created",
      organizationId: org,
      conversationId: conv,
      actorId: "author",
    });

    expect(hits).toEqual([
      "mentioned:mention.created",
      "mentioned:message.created",
      "other:message.created",
    ]);
  });

  it("replays events after last_event_id", () => {
    const org = "org-1";
    const conv = "conv-1";
    const e1 = bus.publish({
      type: "message.created",
      organizationId: org,
      conversationId: conv,
    });
    bus.publish({
      type: "message.updated",
      organizationId: org,
      conversationId: conv,
    });
    bus.publish({
      type: "read",
      organizationId: org,
      conversationId: conv,
    });

    const replay = bus.replaySince(e1.id, {
      organizationId: org,
      userId: "u1",
      conversationIds: new Set([conv]),
    });
    expect(replay.map((e) => e.type)).toEqual(["message.updated", "read"]);
  });

  it("tracks typing with TTL cleanup", () => {
    const conv = "c1";
    bus.setTyping({ conversationId: conv, userId: "u1", name: "Ana", ttlMs: 50 });
    expect(bus.getTyping(conv)).toHaveLength(1);
    bus.clearTyping(conv, "u1");
    expect(bus.getTyping(conv)).toHaveLength(0);
  });

  it("formats SSE frames", () => {
    const frame = formatSseFrame({
      id: "chat_1_abc",
      type: "message.created",
      organizationId: "o",
      conversationId: "c",
      at: "2026-09-28T00:00:00.000Z",
      payload: { x: 1 },
    });
    expect(frame).toContain("id: chat_1_abc\n");
    expect(frame).toContain("event: message.created\n");
    expect(frame).toContain('data: {"id":"chat_1_abc"');
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(formatSseComment("hb")).toBe(": hb\n\n");
  });
});
