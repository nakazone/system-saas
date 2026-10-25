import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { env } from "../../config/env.js";
import { aiTextToSpeech } from "../ai/client.js";
import { addVoiceChars, checkLimit, hasFeature } from "../features/index.js";
import { storage } from "../storage/index.js";

/**
 * Mate voice replies (ElevenLabs), built for the lowest running cost:
 * - v4 Turbo by default (half the price of v4), no style tag (tags are billed as characters);
 * - short text only (the card stays on the screen);
 * - every generated phrase is kept per company and reused, so "Pronto, mandei." is paid once;
 * - only generated characters count toward the plan's "Voz do Mate por mês" limit.
 * When ElevenLabs is off, over the limit or failing, the browser voice takes over (fallback "browser").
 */

export const MATE_SPEECH_MAX_CHARS = 320;
const OUTPUT_FORMAT = "mp3_44100_64";
const MEMORY_MAX = 200;

export type MateSpeechResult =
  | { ok: true; audio: Buffer; cached: boolean; chars: number }
  | { ok: false; reason: "not_configured" | "off" | "limit" | "empty" | "error"; error: string };

const memory = new Map<string, Buffer>();

function remember(key: string, audio: Buffer): void {
  memory.delete(key);
  memory.set(key, audio);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export function mateSpeechModel(): string {
  return env.MATE_AI_TTS_MODEL?.trim() || "eleven_v4_turbo";
}

export function mateSpeechVoice(): string {
  return env.MATE_AI_VOICE_ID?.trim() || env.ELEVENLABS_VOICE_ID?.trim() || "";
}

export function isMateSpeechConfigured(): boolean {
  return Boolean(env.ELEVENLABS_API_KEY?.trim() && mateSpeechVoice());
}

/** Collapses spaces, drops markup and cuts at the last sentence that fits. */
export function cleanSpeechText(raw: string): string {
  let text = String(raw || "")
    .replace(/[*_`#>]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MATE_SPEECH_MAX_CHARS) return text;
  const cut = text.slice(0, MATE_SPEECH_MAX_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  text = end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
  return text.trim();
}

export function speechCacheKey(organizationId: string, text: string, voiceId: string, model: string): string {
  const hash = createHash("sha256").update(`${model}|${voiceId}|${OUTPUT_FORMAT}|${text}`).digest("hex").slice(0, 40);
  return `orgs/${organizationId}/mate-voice/${hash}.mp3`;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function speakForMate(organizationId: string, rawText: string): Promise<MateSpeechResult> {
  const text = cleanSpeechText(rawText);
  if (!text) return { ok: false, reason: "empty", error: "Nada para falar." };
  if (!isMateSpeechConfigured()) {
    return { ok: false, reason: "not_configured", error: "Voz do Mate não configurada (ELEVENLABS_API_KEY e voz)." };
  }
  if (!(await hasFeature(organizationId, "ai"))) {
    return { ok: false, reason: "off", error: "A IA não está incluída no plano da empresa." };
  }

  const model = mateSpeechModel();
  const voiceId = mateSpeechVoice();
  const key = speechCacheKey(organizationId, text, voiceId, model);

  const inMemory = memory.get(key);
  if (inMemory) {
    remember(key, inMemory);
    return { ok: true, audio: inMemory, cached: true, chars: text.length };
  }
  try {
    const stream = await storage.getStream(key);
    if (stream) {
      const audio = await readAll(stream);
      if (audio.length > 0) {
        remember(key, audio);
        return { ok: true, audio, cached: true, chars: text.length };
      }
    }
  } catch (error) {
    console.error("[mate-speech] cache read failed", error);
  }

  const limit = await checkLimit(organizationId, "voice_chars_month", text.length);
  if (!limit.ok) return { ok: false, reason: "limit", error: limit.message };

  const result = await aiTextToSpeech({
    text,
    voiceId,
    model,
    styleTag: false,
    outputFormat: OUTPUT_FORMAT,
    skipAiUse: true,
    timeoutMs: 15_000,
  });
  if (!result.ok) return { ok: false, reason: "error", error: result.error };

  await addVoiceChars(organizationId, text.length);
  remember(key, result.audio);
  void storage
    .upload({ key, body: result.audio, contentType: "audio/mpeg" })
    .catch((error) => console.error("[mate-speech] cache write failed", error));
  return { ok: true, audio: result.audio, cached: false, chars: text.length };
}
