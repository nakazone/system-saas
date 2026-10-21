import { describe, expect, it, vi } from "vitest";
import { createConversationSchema, transcriptMessageSchema } from "../src/lib/mate-voice/contracts.js";
import { buildMateVoiceInstructions, buildRealtimeSession, createRealtimeClientSecret } from "../src/lib/mate-voice/realtime.js";
import { isMateVoiceEnabled } from "../src/lib/mate-voice/staging.js";

describe("Mate Voice environment gate", () => {
  it("requires an explicit opt-in in staging or production", () => {
    expect(isMateVoiceEnabled("staging", true)).toBe(true);
    expect(isMateVoiceEnabled("production", true)).toBe(true);
    expect(isMateVoiceEnabled("development", true)).toBe(false);
    expect(isMateVoiceEnabled("staging", false)).toBe(false);
    expect(isMateVoiceEnabled("production", false)).toBe(false);
  });
});

describe("Mate Voice CRM and transcript contracts", () => {
  it("accepts an unlinked conversation or one complete CRM link", () => {
    expect(createConversationSchema.safeParse({}).success).toBe(true);
    expect(createConversationSchema.safeParse({ crmType: "lead", crmId: "8bfe42de-2714-48ac-86ea-b64e5f6f2a8d" }).success).toBe(true);
    expect(createConversationSchema.safeParse({ crmType: "customer" }).success).toBe(false);
    expect(createConversationSchema.safeParse({ crmId: "8bfe42de-2714-48ac-86ea-b64e5f6f2a8d" }).success).toBe(false);
  });

  it("accepts only nonempty user or assistant transcript messages with a bounded size", () => {
    expect(transcriptMessageSchema.safeParse({ role: "user", content: "Olá, Mate." }).success).toBe(true);
    expect(transcriptMessageSchema.safeParse({ role: "system", content: "internal" }).success).toBe(false);
    expect(transcriptMessageSchema.safeParse({ role: "assistant", content: "   " }).success).toBe(false);
    expect(transcriptMessageSchema.safeParse({ role: "user", content: "x".repeat(10_001) }).success).toBe(false);
  });
});

describe("Realtime client secret", () => {
  it("requests a browser credential with CRM context and returns only the ephemeral value", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ value: "ek_browser_only", expires_at: 1_900_000_000, session: { id: "sess_secret" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const secret = await createRealtimeClientSecret({
      apiKey: "sk-server-secret",
      safetyIdentifier: "hashed-user-identifier",
      context: { kind: "lead", name: "Lead Exemplo", status: "new" },
      fetchImpl,
    });

    expect(secret).toEqual({ value: "ek_browser_only", expires_at: 1_900_000_000 });
    expect(JSON.stringify(secret)).not.toContain("sk-server-secret");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk-server-secret",
      "OpenAI-Safety-Identifier": "hashed-user-identifier",
    });
    const body = JSON.parse(String(init?.body));
    expect(body.session.type).toBe("realtime");
    expect(body.session.model).toBe("gpt-realtime-2.1");
    expect(body.session.instructions).toContain("Lead Exemplo");
    expect(body.session.audio.output.voice).toBe("marin");
  });

  it("describes the selected CRM record without granting the assistant write authority", () => {
    const instructions = buildMateVoiceInstructions({ kind: "customer", name: "Cliente Exemplo", company: "Obra Ltda" });
    expect(instructions).toContain("Cliente Exemplo");
    expect(instructions).toContain("Obra Ltda");
    expect(instructions).toContain("Não invente dados");
    expect(buildRealtimeSession(null).instructions).toContain("Nenhum contato do CRM");
  });

  it("rejects failed or malformed client-secret responses", async () => {
    const failedFetch = vi.fn(async () => new Response("{}", { status: 401 }));
    const malformedFetch = vi.fn(async () => new Response(JSON.stringify({ session: {} }), { status: 200 }));
    await expect(createRealtimeClientSecret({ apiKey: "key", safetyIdentifier: "hash", context: null, fetchImpl: failedFetch as typeof fetch })).rejects.toThrow("realtime_secret_failed");
    await expect(createRealtimeClientSecret({ apiKey: "key", safetyIdentifier: "hash", context: null, fetchImpl: malformedFetch as typeof fetch })).rejects.toThrow("realtime_secret_invalid_response");
  });
});
