import { beforeEach, describe, expect, it, vi } from "vitest";

const tts = vi.fn();
const uploads = new Map<string, Buffer>();
const counted: number[] = [];
let limitOk = true;

vi.mock("../src/lib/ai/client.js", () => ({
  aiTextToSpeech: (params: unknown) => tts(params),
}));

vi.mock("../src/lib/features/index.js", () => ({
  hasFeature: async () => true,
  checkLimit: async (_org: string, _key: string, adding: number) =>
    limitOk ? { ok: true, used: 0, limit: null } : { ok: false, used: 1000, limit: 1000, message: `limite (${adding})` },
  addVoiceChars: async (_org: string, chars: number) => {
    counted.push(chars);
  },
}));

vi.mock("../src/lib/storage/index.js", async () => {
  const { Readable } = await import("node:stream");
  return {
    storage: {
      upload: async (p: { key: string; body: Buffer }) => {
        uploads.set(p.key, p.body);
        return { key: p.key, url: "", contentType: "audio/mpeg", size: p.body.length };
      },
      getStream: async (key: string) => (uploads.has(key) ? Readable.from([uploads.get(key)!]) : null),
    },
  };
});

process.env.ELEVENLABS_API_KEY = "test-key";
process.env.ELEVENLABS_VOICE_ID = "voice-1";

const speech = await import("../src/lib/mate-ai/speech.js");

describe("Mate speech text", () => {
  it("drops markup and keeps short replies as they are", () => {
    expect(speech.cleanSpeechText("**Pronto**, mandei   para a [Maria](x).")).toBe("Pronto, mandei para a Maria.");
  });

  it("cuts long text at the last sentence that fits", () => {
    const long = "Primeira frase curta. " + "Segunda frase bem longa ".repeat(20) + "fim.";
    const out = speech.cleanSpeechText(long);
    expect(out.length).toBeLessThanOrEqual(speech.MATE_SPEECH_MAX_CHARS);
    expect(out.endsWith(".") || out.endsWith("…")).toBe(true);
  });

  it("keeps each company's audio apart", () => {
    const a = speech.speechCacheKey("org-a", "Pronto.", "v", "m");
    const b = speech.speechCacheKey("org-b", "Pronto.", "v", "m");
    expect(a).not.toBe(b);
    expect(a.startsWith("orgs/org-a/mate-voice/")).toBe(true);
    expect(speech.speechCacheKey("org-a", "Pronto.", "v", "m")).toBe(a);
  });

  it("uses the cheaper v4 Turbo by default", () => {
    expect(speech.mateSpeechModel()).toBe("eleven_v4_turbo");
  });
});

describe("speakForMate", () => {
  beforeEach(() => {
    tts.mockReset();
    counted.length = 0;
    limitOk = true;
    tts.mockResolvedValue({ ok: true, audio: Buffer.from("mp3-bytes"), model: "eleven_v4_turbo" });
  });

  it("pays a phrase once and reuses it after", async () => {
    const first = await speech.speakForMate("org-cache", "Te aviso quando ela abrir.");
    expect(first.ok && first.cached).toBe(false);
    expect(tts).toHaveBeenCalledTimes(1);
    const call = tts.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.model).toBe("eleven_v4_turbo");
    expect(call.styleTag).toBe(false);
    expect(call.skipAiUse).toBe(true);
    expect(counted).toEqual(["Te aviso quando ela abrir.".length]);

    const second = await speech.speakForMate("org-cache", "Te aviso quando ela abrir.");
    expect(second.ok && second.cached).toBe(true);
    expect(tts).toHaveBeenCalledTimes(1);
    expect(counted).toHaveLength(1);
  });

  it("stops at the plan limit without calling ElevenLabs", async () => {
    limitOk = false;
    const out = await speech.speakForMate("org-limit", "Frase nova que ainda não existe.");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("limit");
    expect(tts).not.toHaveBeenCalled();
  });

  it("reports provider errors so the panel falls back to the device voice", async () => {
    tts.mockResolvedValue({ ok: false, error: "quota", provider: "elevenlabs" });
    const out = await speech.speakForMate("org-err", "Outra frase.");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("error");
    expect(counted).toHaveLength(0);
  });
});
