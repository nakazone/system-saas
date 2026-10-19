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
        | { type: "image_url"; image_url: { url: string } }
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
  timeoutMs?: number;
  /** Overrides the default chat model for this call. */
  model?: string;
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
    .slice(0, 8);

  const userContent: AiChatMessage["content"] =
    images.length === 0
      ? params.user
      : [
          { type: "text", text: params.user },
          ...images.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
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
    if (modelAcceptsTemperature(model)) body.temperature = 0.2;
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
