/**
 * Receipt / nota fiscal OCR for the Finance module.
 * Uses OpenAI-compatible Vision when OPENAI_API_KEY (or FINANCE_OCR_API_KEY) is set.
 */

export type ReceiptOcrResult = {
  provider: string;
  status: "extracted" | "failed" | "skipped" | "unavailable";
  vendorName: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  description: string | null;
  category: string | null;
  confidence: number;
  raw: unknown;
  error?: string;
};

const CATEGORIES = new Set([
  "materials",
  "services",
  "utilities",
  "travel",
  "equipment",
  "taxes",
  "other",
]);

function ocrApiKey(): string | undefined {
  const key =
    process.env.FINANCE_OCR_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.OCR_API_KEY?.trim();
  return key || undefined;
}

function ocrBaseUrl(): string {
  const raw =
    process.env.FINANCE_OCR_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai.com/v1";
  return raw.replace(/\/$/, "");
}

function ocrModel(): string {
  return (
    process.env.FINANCE_OCR_MODEL?.trim() ||
    process.env.OPENAI_OCR_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

export function isReceiptOcrConfigured(): boolean {
  return Boolean(ocrApiKey());
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || "").trim());
  if (!match) return null;
  return { mime: match[1]!.toLowerCase(), base64: match[2]! };
}

/** Normalize money strings like "$1,234.56", "1.234,56", "R$ 50,00" → number */
export function parseMoneyLoose(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[^\d.,\-]/g, "");
  if (!s) return null;
  // BR format 1.234,56
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",") && s.includes(".")) {
    // 1,234.56
    s = s.replace(/,/g, "");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function parseDateLoose(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (br) {
    const d = Number(br[1]);
    const m = Number(br[2]);
    let y = Number(br[3]);
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

export function normalizeOcrPayload(parsed: Record<string, unknown>, provider: string): ReceiptOcrResult {
  const amount = parseMoneyLoose(parsed.amount ?? parsed.total ?? parsed.value);
  const vendorRaw = parsed.vendor_name ?? parsed.vendorName ?? parsed.vendor ?? parsed.merchant;
  const vendorName = vendorRaw != null && String(vendorRaw).trim() ? String(vendorRaw).trim() : null;
  const date = parseDateLoose(parsed.date || parsed.incurred_on || parsed.invoice_date);
  const description =
    parsed.description != null && String(parsed.description).trim()
      ? String(parsed.description).trim()
      : null;
  let category = parsed.category ? String(parsed.category).toLowerCase().trim() : null;
  if (category && !CATEGORIES.has(category)) category = "other";
  const currency = parsed.currency ? String(parsed.currency).toUpperCase().slice(0, 3) : null;
  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = amount ? 0.75 : 0.3;
  confidence = Math.max(0, Math.min(1, confidence));

  if (!amount && !vendorName && !date) {
    return {
      provider,
      status: "failed",
      vendorName: null,
      amount: null,
      currency,
      date: null,
      description: null,
      category: null,
      confidence: 0,
      raw: parsed,
      error: "Não foi possível extrair dados do documento",
    };
  }

  return {
    provider,
    status: "extracted",
    vendorName,
    amount,
    currency,
    date,
    description,
    category,
    confidence,
    raw: parsed,
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  } catch {
    /* try fence */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) {
    try {
      const inner = JSON.parse(fence[1]!.trim());
      if (inner && typeof inner === "object") return inner as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const slice = JSON.parse(trimmed.slice(start, end + 1));
      if (slice && typeof slice === "object") return slice as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You extract structured data from receipts, invoices, and Brazilian "notas fiscais" (NF-e / NFC-e).
Return ONLY a JSON object with these keys:
- vendor_name: string|null (store / company name)
- amount: number|null (TOTAL due / paid — the final amount, not subtotal; use a plain number like 1234.56)
- currency: string|null (USD, BRL, etc.)
- date: string|null (ISO YYYY-MM-DD of the receipt/invoice)
- description: string|null (short label, e.g. "Home Depot materials" or "NF material construção")
- category: one of materials|services|utilities|travel|equipment|taxes|other
- confidence: number 0..1 how sure you are about the amount
If a field is unreadable, use null. Prefer the grand total including tax.`;

export async function extractReceiptFromDataUrl(dataUrl: string): Promise<ReceiptOcrResult> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return {
      provider: "none",
      status: "failed",
      vendorName: null,
      amount: null,
      currency: null,
      date: null,
      description: null,
      category: null,
      confidence: 0,
      raw: null,
      error: "Imagem inválida",
    };
  }

  if (parsed.mime === "application/pdf") {
    return {
      provider: "none",
      status: "failed",
      vendorName: null,
      amount: null,
      currency: null,
      date: null,
      description: null,
      category: null,
      confidence: 0,
      raw: null,
      error: "OCR automático funciona melhor com foto (JPG/PNG). Converta o PDF ou fotografe o documento.",
    };
  }

  if (!parsed.mime.startsWith("image/")) {
    return {
      provider: "none",
      status: "failed",
      vendorName: null,
      amount: null,
      currency: null,
      date: null,
      description: null,
      category: null,
      confidence: 0,
      raw: null,
      error: "Formato não suportado para OCR",
    };
  }

  const key = ocrApiKey();
  if (!key) {
    return {
      provider: "none",
      status: "unavailable",
      vendorName: null,
      amount: null,
      currency: null,
      date: null,
      description: null,
      category: null,
      confidence: 0,
      raw: null,
      error:
        "OCR não configurado. Defina OPENAI_API_KEY (ou FINANCE_OCR_API_KEY) no ambiente para leitura automática.",
    };
  }

  const provider = "openai_vision";
  const model = ocrModel();
  const url = `${ocrBaseUrl()}/chat/completions`;
  const imageUrl = `data:${parsed.mime};base64,${parsed.base64}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the receipt/invoice fields from this image.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!res.ok) {
      return {
        provider,
        status: "failed",
        vendorName: null,
        amount: null,
        currency: null,
        date: null,
        description: null,
        category: null,
        confidence: 0,
        raw: json,
        error: json.error?.message || `OCR HTTP ${res.status}`,
      };
    }

    const content = json.choices?.[0]?.message?.content || "";
    const obj = extractJsonObject(content);
    if (!obj) {
      return {
        provider,
        status: "failed",
        vendorName: null,
        amount: null,
        currency: null,
        date: null,
        description: null,
        category: null,
        confidence: 0,
        raw: { content },
        error: "Resposta OCR inválida",
      };
    }

    return normalizeOcrPayload(obj, provider);
  } catch (err) {
    return {
      provider,
      status: "failed",
      vendorName: null,
      amount: null,
      currency: null,
      date: null,
      description: null,
      category: null,
      confidence: 0,
      raw: null,
      error: err instanceof Error ? err.message : "Falha no OCR",
    };
  }
}
