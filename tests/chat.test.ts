import { describe, it, expect, beforeEach } from "vitest";
import {
  sanitizeChatBody,
  parseChatTokens,
  bodyToChips,
  userMentionToken,
  jobLinkToken,
  dmKeyForUsers,
  jobChannelDisplayName,
  isJobChannelReadOnly,
  mapMessageForViewer,
  canViewHiddenMessages,
  canMentionAll,
  canLinkRetroactive,
  isElevatedAdmin,
  checkRateLimit,
  clearChatRateLimits,
  validateChatAttachment,
  parseDataUrl,
  previewFromBody,
} from "../src/lib/chat/index.js";

describe("chat tokens", () => {
  it("sanitizes XSS while preserving structured tokens", () => {
    const uid = "11111111-1111-4111-8111-111111111111";
    const jid = "22222222-2222-4222-8222-222222222222";
    const raw = `Olá <@user:${uid}> veja <#job:${jid}> <script>alert(1)</script>`;
    const clean = sanitizeChatBody(raw);
    expect(clean).toContain(`<@user:${uid}>`);
    expect(clean).toContain(`<#job:${jid}>`);
    expect(clean).toContain("&lt;script&gt;");
    expect(clean).not.toContain("<script>");
  });

  it("normalizes @equipe/@todos aliases", () => {
    const clean = sanitizeChatBody("oi <@equipe> e <@todos>");
    expect(clean).toContain("<@team>");
    expect(clean).toContain("<@all>");
    expect(parseChatTokens(clean).map((t) => t.kind).sort()).toEqual(["all", "team"]);
  });

  it("parses user and job tokens", () => {
    const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const jid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const body = `${userMentionToken(uid)} ${jobLinkToken(jid)}`;
    const tokens = parseChatTokens(body);
    expect(tokens).toEqual([
      { kind: "user", userId: uid },
      { kind: "job", workOrderId: jid },
    ]);
  });

  it("splits body into chips", () => {
    const uid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const chips = bodyToChips(`Oi <@user:${uid}>`);
    expect(chips[0]).toEqual({ type: "text", text: "Oi " });
    expect(chips[1]).toEqual({ type: "user", userId: uid });
  });
});

describe("chat job channel helpers", () => {
  it("builds stable dm keys", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(dmKeyForUsers(a, b)).toBe(dmKeyForUsers(b, a));
    expect(dmKeyForUsers(a, b)).toBe(`${a}:${b}`);
  });

  it("names job channels and detects read-only statuses", () => {
    expect(jobChannelDisplayName({ number: 12, title: "Kitchen" })).toBe("Job #12 — Kitchen");
    expect(jobChannelDisplayName({ number: null, title: "Patio" })).toBe("Patio");
    expect(isJobChannelReadOnly("completed")).toBe(true);
    expect(isJobChannelReadOnly("canceled")).toBe(true);
    expect(isJobChannelReadOnly("in_progress")).toBe(false);
  });
});

describe("chat permissions + soft delete visibility", () => {
  const installer = {
    id: "u1",
    roleKey: "installer",
    permissions: ["chat.use", "chat.create_group"],
  };
  const manager = {
    id: "u2",
    roleKey: "office",
    permissions: ["chat.use", "chat.view_hidden", "chat.mention_all", "chat.link_retroactive"],
  };
  const admin = { id: "u3", roleKey: "admin", permissions: [] as string[] };

  it("gates mention_all / link_retroactive / view_hidden", () => {
    expect(canMentionAll(installer)).toBe(false);
    expect(canMentionAll(manager)).toBe(true);
    expect(canLinkRetroactive(installer)).toBe(false);
    expect(canLinkRetroactive(manager)).toBe(true);
    expect(canViewHiddenMessages(installer)).toBe(false);
    expect(canViewHiddenMessages(manager)).toBe(true);
    expect(canViewHiddenMessages(admin)).toBe(true);
    expect(isElevatedAdmin(admin)).toBe(true);
    expect(isElevatedAdmin(installer)).toBe(false);
  });

  it("hides soft-deleted body from regular users", () => {
    const msg = {
      id: "m1",
      body: "segredo",
      type: "text",
      createdAt: new Date("2026-09-28T12:00:00.000Z"),
      editedAt: null,
      hiddenAt: new Date("2026-09-28T12:05:00.000Z"),
      hiddenById: "u1",
      authorId: "u1",
    };
    const forInstaller = mapMessageForViewer(msg, installer);
    expect(forInstaller.body).toBeNull();
    expect(forInstaller.hidden).toBe(true);
    expect(forInstaller.hidden_placeholder).toBe("Mensagem removida");
    expect(forInstaller.can_view_original).toBe(false);

    const forManager = mapMessageForViewer(msg, manager);
    expect(forManager.body).toBe("segredo");
    expect(forManager.can_view_original).toBe(true);
  });
});

describe("chat rate limit", () => {
  beforeEach(() => clearChatRateLimits());

  it("allows up to limit then blocks", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("t1", 3, 60_000).ok).toBe(true);
    }
    const blocked = checkRateLimit("t1", 3, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("chat attachments", () => {
  it("parses data urls and validates mime/size", () => {
    const parsed = parseDataUrl("data:image/png;base64,aGVsbG8=");
    expect(parsed?.contentType).toBe("image/png");
    expect(parsed?.body.toString("utf8")).toBe("hello");
    expect(validateChatAttachment({ contentType: "image/png", size: 5 }).ok).toBe(true);
    expect(validateChatAttachment({ contentType: "image/heic", size: 5 }).ok).toBe(false);
    expect(validateChatAttachment({ contentType: "application/pdf", size: 20 * 1024 * 1024 }).ok).toBe(
      false,
    );
  });
});

describe("chat preview", () => {
  it("strips tokens for notification preview", () => {
    const uid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    expect(previewFromBody(`Oi <@user:${uid}>`)).toContain("@user");
    expect(previewFromBody("x".repeat(200)).length).toBeLessThanOrEqual(140);
  });
});
