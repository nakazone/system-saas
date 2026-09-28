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

export async function aiChatJson(params: {
  system: string;
  user: string;
  imageUrls?: string[];
  timeoutMs?: number;
}): Promise<AiChatResult | AiErrorResult> {
  const key = aiApiKey();
  if (!key) {
    return {
      ok: false,
      error: "AI is not configured. Set OPENAI_API_KEY (or JOB_MEDIA_AI_API_KEY).",
      provider: "none",
    };
  }

  const model = chatModel();
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
    const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: userContent },
        ],
      }),
    });

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
  timeoutMs?: number;
}): Promise<{ ok: true; text: string; model: string } | AiErrorResult> {
  const key = aiApiKey();
  if (!key) {
    return {
      ok: false,
      error: "AI is not configured. Set OPENAI_API_KEY (or JOB_MEDIA_AI_API_KEY).",
      provider: "none",
    };
  }

  const model = whisperModel();
  const form = new FormData();
  const bytes = new Uint8Array(params.body);
  const blob = new Blob([bytes], { type: params.contentType || "audio/webm" });
  form.append("file", blob, "voice.webm");
  form.append("model", model);
  if (params.language) form.append("language", params.language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);

  try {
    const res = await fetch(`${aiBaseUrl()}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: form,
    });
    const raw = (await res.json().catch(() => ({}))) as {
      text?: string;
      error?: { message?: string };
    };
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
