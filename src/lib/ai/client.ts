import { takeAiUse } from "../features/index.js";
/**
 * Isolated AI client for ObraMate (OpenAI-compatible HTTP API).
 * Never call providers from the browser — only via this module.
 */
export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail?: "high" | "low" | "auto" } }
        | { type: "file"; file: { filename: string; file_data: string } }
      >;
};

export type AiChatResult = {
  ok: true;
  text: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  provider: string;
};

export type AiErrorResult = {
  ok: false;
  error: string;
  status?: number;
  provider: string;
};

function aiApiKey(): string | undefined {
  const key =
    process.env.JOB_MEDIA_AI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.FINANCE_OCR_API_KEY?.trim();
  return key || undefined;
}

function aiBaseUrl(): string {
  const raw =
    process.env.JOB_MEDIA_AI_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.FINANCE_OCR_BASE_URL?.trim() ||
    "https://api.openai.com/v1";
  return raw.replace(/\/$/, "");
}

function chatModel(): string {
  return (
    process.env.JOB_MEDIA_AI_MODEL?.trim() ||
    process.env.OPENAI_CHAT_MODEL?.trim() ||
    process.env.FINANCE_OCR_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

function whisperModel(): string {
  return process.env.JOB_MEDIA_WHISPER_MODEL?.trim() || "whisper-1";
}

function elevenLabsApiKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY?.trim() || undefined;
}

export type ElevenLabsVoice = {
  voiceId: string;
  name: string;
  category: string;
  description: string;
  labels: Record<string, string>;
  languages: string[];
};

export type ElevenLabsVoiceListResult =
  | { ok: true; voices: ElevenLabsVoice[]; defaultVoiceId: string | null }
  | AiErrorResult;

let elevenLabsVoicesCache: { expiresAt: number; voices: ElevenLabsVoice[] } | null = null;

/** Lists account voices without exposing the ElevenLabs key to the browser. */
export async function aiListElevenLabsVoices(): Promise<ElevenLabsVoiceListResult> {
  const key = elevenLabsApiKey();
  if (!key) {
    return { ok: false, error: "Configure ELEVENLABS_API_KEY no servidor para listar as vozes.", provider: "none" };
  }
  if (elevenLabsVoicesCache && elevenLabsVoicesCache.expiresAt > Date.now()) {
    return {
      ok: true,
      voices: elevenLabsVoicesCache.voices,
      defaultVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const url = new URL("https://api.elevenlabs.io/v2/voices");
    url.searchParams.set("page_size", "100");
    url.searchParams.set("include_total_count", "false");
    const response = await fetch(url, {
      headers: { "xi-api-key": key },
      signal: controller.signal,
    });
    const raw = (await response.json().catch(() => ({}))) as {
      voices?: Array<{
        voice_id?: string;
        name?: string;
        category?: string;
        description?: string;
        labels?: Record<string, unknown>;
        verified_languages?: Array<{ language?: string; locale?: string }>;
      }>;
      detail?: { message?: string } | string;
    };
    if (!response.ok) {
      const detail = typeof raw.detail === "string" ? raw.detail : raw.detail?.message;
      return {
        ok: false,
        error: detail || `ElevenLabs não conseguiu listar as vozes (HTTP ${response.status}).`,
        status: response.status,
        provider: "elevenlabs",
      };
    }
    const voices = (raw.voices || []).filter((voice) => voice.voice_id && voice.name).map((voice) => ({
      voiceId: String(voice.voice_id),
      name: String(voice.name).slice(0, 100),
      category: String(voice.category || "").slice(0, 40),
      description: String(voice.description || "").slice(0, 240),
      labels: Object.fromEntries(Object.entries(voice.labels || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([name, value]) => [name.slice(0, 40), value.slice(0, 80)])),
      languages: (voice.verified_languages || []).map((language) => String(language.locale || language.language || "").slice(0, 40)).filter(Boolean),
    }));
    elevenLabsVoicesCache = { expiresAt: Date.now() + 5 * 60_000, voices };
    return {
      ok: true,
      voices,
      defaultVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha ao listar vozes ElevenLabs.";
    return {
      ok: false,
      error: /abort/i.test(message) ? "A consulta de vozes ElevenLabs expirou." : "Não foi possível consultar as vozes ElevenLabs.",
      provider: "elevenlabs",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Converts text to MP3 on the server. The API key is never sent to the browser. */
export async function aiTextToSpeech(params: {
  text: string;
  voiceId?: string;
  timeoutMs?: number;
  /** Overrides ELEVENLABS_TTS_MODEL (the Mate uses the cheaper v4 Turbo). */
  model?: string;
  /** Style tag like "[warmly…]" in front of v3/v4 text. Tags are billed as characters, so the Mate turns it off. */
  styleTag?: boolean;
  /** ElevenLabs output_format (default mp3_44100_128). */
  outputFormat?: string;
  /** The caller counts usage itself (voice characters), so this call is not counted as one AI use. */
  skipAiUse?: boolean;
}): Promise<{ ok: true; audio: Buffer; model: string } | AiErrorResult> {
  const key = elevenLabsApiKey();
  if (!key) {
    return { ok: false, error: "Configure ELEVENLABS_API_KEY no servidor para ativar a voz.", provider: "none" };
  }
  const voiceId = params.voiceId?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!voiceId) {
    return { ok: false, error: "Escolha uma voz para gerar o áudio.", provider: "elevenlabs" };
  }
  const text = String(params.text || "").trim();
  if (!text) return { ok: false, error: "O texto para narração está vazio.", provider: "elevenlabs" };

  if (!params.skipAiUse) {
    const blocked = await takeAiUse();
    if (blocked) return { ok: false, error: blocked, provider: "none" };
  }

  const model = params.model?.trim() || process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_v4";
  const isV4 = model === "eleven_v4" || model === "eleven_v4_turbo";
  const isV3 = model === "eleven_v3";
  const speechText = (isV4 || isV3) && params.styleTag !== false ? `[warmly, conversational tone] ${text}` : text;
  const outputFormat = /^[a-z0-9_]{3,40}$/.test(params.outputFormat || "") ? params.outputFormat! : "mp3_44100_128";
  const voiceSettings = isV4
    ? { stability: 0.4, similarity_boost: 0.75 }
    : isV3
      ? { stability: 0.4, style: 0.15 }
      : { stability: 0.4, similarity_boost: 0.75, style: 0.15, speed: 0.98, use_speaker_boost: true };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 45_000);
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      signal: controller.signal,
      body: JSON.stringify({
        text: speechText,
        model_id: model,
        voice_settings: voiceSettings,
      }),
    });
    if (!response.ok) {
      const raw = (await response.json().catch(() => ({}))) as { detail?: { message?: string } | string; message?: string };
      const detail = typeof raw.detail === "string" ? raw.detail : raw.detail?.message;
      return {
        ok: false,
        error: detail || raw.message || `ElevenLabs não conseguiu gerar o áudio (HTTP ${response.status}).`,
        status: response.status,
        provider: "elevenlabs",
      };
    }
    return { ok: true, audio: Buffer.from(await response.arrayBuffer()), model };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha ao gerar áudio.";
    return {
      ok: false,
      error: /abort/i.test(message) ? "A geração da voz demorou demais. Tente novamente." : "Não foi possível gerar o áudio da voz.",
      provider: "elevenlabs",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function isAiConfigured(): boolean {
  return Boolean(aiApiKey());
}

export function estimateCostUsd(tokensIn: number | null, tokensOut: number | null): number | null {
  if (tokensIn == null && tokensOut == null) return null;
  // Approximate gpt-4o-mini list pricing (USD / 1M tokens) — logging only
  const inRate = 0.15;
  const outRate = 0.6;
  const cost =
    ((tokensIn || 0) / 1_000_000) * inRate + ((tokensOut || 0) / 1_000_000) * outRate;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** GPT-5/6 and o-series reasoning models reject a custom temperature. */
export function modelAcceptsTemperature(model: string): boolean {
  return !/^(gpt-5|gpt-6|o\d)/i.test(model.trim());
}

export async function aiChatJson(params: {
  system: string;
  user: string;
  imageUrls?: string[];
  /** PDFs as data URLs (sent as file parts; vision-capable models read them page by page). */
  files?: Array<{ filename: string; dataUrl: string }>;
  timeoutMs?: number;
  /** Overrides the default chat model for this call. */
  model?: string;
  /** Most images sent (default 8). */
  maxImages?: number;
  /** Reasoning models (GPT-5/6, o-series): how hard to think — "low" answers much faster. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** "high" reads small print on documents (no downscaling of the images). */
  imageDetail?: "high" | "low" | "auto";
  /** 0 for extraction that must give the same answer every time. */
  temperature?: number;
}): Promise<AiChatResult | AiErrorResult> {
  const key = aiApiKey();
  if (!key) {
    return {
      ok: false,
      error: "AI is not configured. Set OPENAI_API_KEY (or JOB_MEDIA_AI_API_KEY).",
      provider: "none",
    };
  }
  const blocked = await takeAiUse();
  if (blocked) return { ok: false, error: blocked, provider: "none" };

  const model = params.model?.trim() || chatModel();
  const images = (params.imageUrls || [])
    .filter((u) => typeof u === "string" && u.length > 0)
    .slice(0, params.maxImages ?? 8);

  const files = (params.files || []).filter((f) => f && f.dataUrl).slice(0, 5);
  const userContent: AiChatMessage["content"] =
    images.length === 0 && files.length === 0
      ? params.user
      : [
          { type: "text", text: params.user },
          ...images.map((url) => ({
            type: "image_url" as const,
            image_url: params.imageDetail ? { url, detail: params.imageDetail } : { url },
          })),
          ...files.map((f) => ({
            type: "file" as const,
            file: { filename: f.filename, file_data: f.dataUrl },
          })),
        ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);

  try {
    const body: Record<string, unknown> = {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: userContent },
      ],
    };
    if (modelAcceptsTemperature(model)) body.temperature = params.temperature ?? 0.2;
    else if (params.reasoningEffort) body.reasoning_effort = params.reasoningEffort;
    const send = () =>
      fetch(`${aiBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
    let res = await send();
    if (res.status === 400 && "reasoning_effort" in body) {
      const peek = (await res.clone().json().catch(() => ({}))) as { error?: { message?: string; param?: string } };
      if (/reasoning/i.test(String(peek.error?.param || peek.error?.message || ""))) {
        delete body.reasoning_effort;
        res = await send();
      }
    }
    if (res.status === 400 && "temperature" in body) {
      // Some models only accept the default temperature; retry once without it.
      const peek = (await res.clone().json().catch(() => ({}))) as { error?: { message?: string; param?: string } };
      if (/temperature/i.test(String(peek.error?.param || peek.error?.message || ""))) {
        delete body.temperature;
        res = await send();
      }
    }

    const raw = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        error: raw.error?.message || `AI HTTP ${res.status}`,
        status: res.status,
        provider: "openai_compatible",
      };
    }

    const text = raw.choices?.[0]?.message?.content || "";
    if (!text.trim()) {
      return { ok: false, error: "Empty AI response", provider: "openai_compatible" };
    }

    return {
      ok: true,
      text,
      model: raw.model || model,
      tokensIn: raw.usage?.prompt_tokens ?? null,
      tokensOut: raw.usage?.completion_tokens ?? null,
      provider: "openai_compatible",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI request failed";
    return {
      ok: false,
      error: /abort/i.test(msg) ? "AI request timed out" : msg,
      provider: "openai_compatible",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function aiTranscribeAudio(params: {
  body: Buffer;
  contentType: string;
  language?: string;
  /** Vocabulary hint (names, product terms) to bias the transcription. */
  prompt?: string;
  timeoutMs?: number;
  /** Overrides the default transcription model for this call. */
  model?: string;
  /** gpt-transcribe: exact words to recognize (service and customer names). */
  keywords?: string[];
  /** gpt-transcribe: expected languages (ISO-639-1), e.g. ["pt", "en"]. */
  languages?: string[];
}): Promise<{ ok: true; text: string; model: string } | AiErrorResult> {
  const key = aiApiKey();
  if (!key) {
    return {
      ok: false,
      error: "AI is not configured. Set OPENAI_API_KEY (or JOB_MEDIA_AI_API_KEY).",
      provider: "none",
    };
  }
  const blocked = await takeAiUse();
  if (blocked) return { ok: false, error: blocked, provider: "none" };

  const requested = params.model?.trim() || whisperModel();
  const bytes = new Uint8Array(params.body);
  // The provider detects the format from the file extension (Safari records audio/mp4).
  const ct = (params.contentType || "").toLowerCase();
  const ext = ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")
    ? "m4a"
    : ct.includes("mpeg") || ct.includes("mp3")
      ? "mp3"
      : ct.includes("ogg")
        ? "ogg"
        : ct.includes("wav")
          ? "wav"
          : "webm";

  const buildForm = (model: string) => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: params.contentType || "audio/webm" }), "voice." + ext);
    form.append("model", model);
    const newGen = /^gpt-(live-)?transcribe/i.test(model);
    if (newGen) {
      form.append("response_format", "json");
      for (const lang of (params.languages || (params.language ? [params.language] : [])).slice(0, 5)) {
        form.append("languages[]", lang);
      }
      for (const word of cleanKeywords(params.keywords)) form.append("keywords[]", word);
    } else if (params.language) {
      form.append("language", params.language);
    }
    if (params.prompt) form.append("prompt", params.prompt.slice(0, 900));
    return form;
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);

  const attempt = async (model: string) => {
    const res = await fetch(`${aiBaseUrl()}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: buildForm(model),
    });
    const raw = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
    return { res, raw, model };
  };

  try {
    let result = await attempt(requested);
    // A newer model unavailable on this account/provider → fall back to Whisper once.
    if (!result.res.ok && [400, 403, 404].includes(result.res.status) && requested !== "whisper-1") {
      console.warn(`[ai] transcription with ${requested} failed (${result.res.status}): ${result.raw.error?.message || ""}; retrying with whisper-1`);
      result = await attempt("whisper-1");
    }
    const { res, raw, model } = result;
    if (!res.ok) {
      return {
        ok: false,
        error: raw.error?.message || `Transcription HTTP ${res.status}`,
        status: res.status,
        provider: "openai_compatible",
      };
    }
    const text = String(raw.text || "").trim();
    if (!text) {
      return { ok: false, error: "Empty transcription", provider: "openai_compatible" };
    }
    return { ok: true, text, model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Transcription failed";
    return {
      ok: false,
      error: /abort/i.test(msg) ? "Transcription timed out" : msg,
      provider: "openai_compatible",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Keywords must be single-line literals without angle brackets, or the whole request is rejected. */
export function cleanKeywords(words: string[] | undefined, max = 120): string[] {
  const out = new Set<string>();
  for (const w of words || []) {
    const k = String(w || "").replace(/[<>\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (k.length >= 2) out.add(k);
    if (out.size >= max) break;
  }
  return [...out];
}

/* ───────────────────────── multi-turn chat with tools ───────────────────────── */

export type AiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type AiTurn =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type AiTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type AiChatTurnResult =
  | { ok: true; content: string; toolCalls: AiToolCall[]; model: string; tokensIn: number | null; tokensOut: number | null }
  | AiErrorResult;

export type AiErrorLog = { at: string; model: string; status: number | null; message: string; context: string };

let lastAiError: AiErrorLog | null = null;

/** Last provider error seen by this process (for the admin diagnostics in Mate AI). */
export function getLastAiError(): AiErrorLog | null {
  return lastAiError;
}

export function noteAiError(context: string, model: string, status: number | null | undefined, message: string): void {
  lastAiError = { at: new Date().toISOString(), model, status: status ?? null, message: String(message || "").slice(0, 500), context };
  console.warn(`[ai] ${context} failed with ${model} (${status ?? "-"}): ${lastAiError.message}`);
}

/** GPT-5/GPT-6 accept reasoning_effort; with tools on Chat Completions it must be "none". */
function isReasoningFamily(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/i.test(model.trim());
}

/**
 * One chat turn (optionally with tools). Parameters a model rejects (temperature, response_format,
 * reasoning_effort) are dropped and the call retried once each, so a model change never breaks it.
 */
export async function aiChatTurn(params: {
  messages: AiTurn[];
  model?: string;
  tools?: AiTool[];
  toolChoice?: "auto" | "required";
  json?: boolean;
  timeoutMs?: number;
  /** Count this call against the company's AI quota (false for follow-up tool rounds). */
  countUse?: boolean;
}): Promise<AiChatTurnResult> {
  const key = aiApiKey();
  if (!key) return { ok: false, error: "AI is not configured. Set OPENAI_API_KEY (or JOB_MEDIA_AI_API_KEY).", provider: "none" };
  if (params.countUse !== false) {
    const blocked = await takeAiUse();
    if (blocked) return { ok: false, error: blocked, provider: "none" };
  }
  const model = params.model?.trim() || chatModel();
  const body: Record<string, unknown> = { model, messages: params.messages };
  if (params.tools?.length) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice || "auto";
    if (isReasoningFamily(model)) body.reasoning_effort = "none";
  } else if (params.json) {
    body.response_format = { type: "json_object" };
  }
  if (modelAcceptsTemperature(model)) body.temperature = 0.2;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 45_000);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      const raw = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; param?: string; code?: string };
        choices?: { message?: { content?: string | null; tool_calls?: AiToolCall[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      if (!res.ok) {
        const msg = raw.error?.message || `AI HTTP ${res.status}`;
        const where = `${raw.error?.param || ""} ${msg}`.toLowerCase();
        if (res.status === 400) {
          const drop = ["temperature", "response_format", "reasoning_effort"].find((p) => p in body && where.includes(p));
          if (drop) {
            delete body[drop];
            continue;
          }
        }
        return { ok: false, error: msg, status: res.status, provider: "openai_compatible" };
      }
      const message = raw.choices?.[0]?.message || {};
      return {
        ok: true,
        content: String(message.content || ""),
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        model: raw.model || model,
        tokensIn: raw.usage?.prompt_tokens ?? null,
        tokensOut: raw.usage?.completion_tokens ?? null,
      };
    }
    return { ok: false, error: "AI request kept being rejected", provider: "openai_compatible" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI request failed";
    return { ok: false, error: /abort/i.test(msg) ? "AI request timed out" : msg, provider: "openai_compatible" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Host of the AI provider (no path or secrets), for diagnostics. */
export function aiProviderHost(): string {
  try {
    return new URL(aiBaseUrl()).host;
  } catch {
    return "?";
  }
}
