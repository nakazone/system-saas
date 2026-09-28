/**
 * Field OCR for labels / serial plates (OpenAI vision).
 */
import { aiChatJson, isAiConfigured } from "../ai/client.js";

export type LabelOcrResult = {
  serial_number: string | null;
  label_text: string | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  confidence: number;
};

export async function extractLabelFromImageUrl(imageUrl: string): Promise<
  | { ok: true; data: LabelOcrResult; model: string }
  | { ok: false; error: string }
> {
  if (!isAiConfigured()) {
    return { ok: false, error: "OCR needs OPENAI_API_KEY" };
  }
  if (!imageUrl) return { ok: false, error: "Image URL required" };

  const result = await aiChatJson({
    system: `You read equipment labels, serial plates, and stickers from job site photos.
Return ONLY JSON:
{ "serial_number": string|null, "label_text": string|null, "brand": string|null, "model": string|null, "notes": string|null, "confidence": number }
Use null when unreadable. confidence 0..1.`,
    user: "Extract any serial / model / brand text visible on this photo.",
    imageUrls: [imageUrl],
    timeoutMs: 45_000,
  });
  if (!result.ok) return { ok: false, error: result.error };

  try {
    const parsed = JSON.parse(result.text) as Record<string, unknown>;
    return {
      ok: true,
      model: result.model,
      data: {
        serial_number: parsed.serial_number != null ? String(parsed.serial_number) : null,
        label_text: parsed.label_text != null ? String(parsed.label_text) : null,
        brand: parsed.brand != null ? String(parsed.brand) : null,
        model: parsed.model != null ? String(parsed.model) : null,
        notes: parsed.notes != null ? String(parsed.notes) : null,
        confidence: Number(parsed.confidence) || 0,
      },
    };
  } catch {
    return { ok: false, error: "OCR returned invalid JSON" };
  }
}

export function isFieldMeasureEnabled(featureFlags: unknown): boolean {
  if (featureFlags == null) return true;
  if (typeof featureFlags !== "object" || Array.isArray(featureFlags)) return true;
  const flags = featureFlags as Record<string, unknown>;
  if (flags.job_measure === false || flags.jobMeasure === false) return false;
  return true;
}
