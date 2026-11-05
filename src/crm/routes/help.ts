/**
 * Help Center AI search: the user types anything ("how do I charge a job that's done?",
 * "cliente não recebeu o orçamento") and the Mate answers in a few short steps and points
 * to the tutorial / fix / module that solves it.
 *
 * The browser sends the help catalog it already has (ids + titles + tags); the model only
 * picks from it, and every id it returns is checked against that list before it goes back.
 */
import { Router } from "express";
import { z } from "zod";
import { aiChatJson, isAiConfigured } from "../../lib/ai/client.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";

export const helpRouter = Router();

const KINDS = ["tour", "problem", "tutorial", "module"] as const;
type Kind = (typeof KINDS)[number];

const catalogItem = z.object({
  kind: z.enum(KINDS),
  id: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(160),
  hint: z.string().trim().max(300).optional(),
});

const askSchema = z.object({
  q: z.string().trim().min(2).max(400),
  page: z.string().trim().max(120).optional(),
  locale: z.enum(["pt", "en", "es"]).default("pt"),
  catalog: z.array(catalogItem).max(160),
});

export type HelpAnswer = {
  answer: string;
  steps: string[];
  matches: Array<{ kind: Kind; id: string }>;
};

const LANG: Record<string, string> = { pt: "Brazilian Portuguese", en: "English", es: "Spanish" };

/** Pull the first JSON object out of a model reply (tolerates code fences / chatter). */
export function parseHelpJson(text: string): Record<string, unknown> | null {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Keep only well-formed fields and ids that exist in the catalog the browser sent. */
export function sanitizeHelpAnswer(obj: Record<string, unknown> | null, catalog: Array<{ kind: Kind; id: string }>): HelpAnswer {
  const known = new Set(catalog.map((c) => `${c.kind}:${c.id}`));
  const answer = typeof obj?.answer === "string" ? obj.answer.trim().slice(0, 600) : "";
  const steps = Array.isArray(obj?.steps)
    ? (obj!.steps as unknown[])
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 220))
        .slice(0, 6)
    : [];
  const seen = new Set<string>();
  const matches: HelpAnswer["matches"] = [];
  if (Array.isArray(obj?.matches)) {
    for (const m of obj!.matches as unknown[]) {
      if (!m || typeof m !== "object") continue;
      const kind = (m as { kind?: unknown }).kind;
      const id = (m as { id?: unknown }).id;
      if (typeof kind !== "string" || typeof id !== "string") continue;
      const key = `${kind}:${id}`;
      if (!known.has(key) || seen.has(key)) continue;
      seen.add(key);
      matches.push({ kind: kind as Kind, id });
      if (matches.length >= 4) break;
    }
  }
  return { answer, steps, matches };
}

// A light per-user brake so a stuck key or a script can't burn the AI quota.
const recent = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function tooMany(userId: string): boolean {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) {
    recent.set(userId, list);
    return true;
  }
  list.push(now);
  recent.set(userId, list);
  return false;
}

helpRouter.post("/api/help/ask", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = askSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid body" });
      return;
    }
    if (!isAiConfigured()) {
      res.status(503).json({ success: false, code: "ai_off", error: "AI is not configured" });
      return;
    }
    if (tooMany(req.user!.id)) {
      res.status(429).json({ success: false, code: "slow_down", error: "Too many questions, try again in a minute" });
      return;
    }
    const { q, page, locale, catalog } = parsed.data;
    const lines = catalog.map((c) => `${c.kind}:${c.id} | ${c.title}${c.hint ? ` | ${c.hint}` : ""}`).join("\n");
    const ai = await aiChatJson({
      system: `You are Mate, the friendly assistant inside ObraMate, a CRM for flooring installation companies (leads, visits, quotes, jobs, invoices, payroll, cash flow, photos, team chat).
The user typed a help question in their own words; it may be vague, misspelled or mixed-language. Understand the intent.
Answer in ${LANG[locale] || LANG.pt}. Be concrete and brief, using the names of screens/buttons from the catalog.
Return ONLY JSON: {"answer": string (1-2 short sentences), "steps": string[] (0-5 short imperative steps, empty if not a how-to), "matches": [{"kind": "tour"|"problem"|"tutorial"|"module", "id": string}] (0-4, best first, ONLY ids from the catalog)}.
Prefer a "tour" match when one teaches that module step by step. If nothing fits, return empty matches and suggest contacting support in the answer.
Never invent features, prices or data about the user's account.`,
      user: `Current page: ${page || "unknown"}\nQuestion: ${q}\n\nCatalog (kind:id | title | hint):\n${lines}`,
      timeoutMs: 20_000,
      temperature: 0.2,
      reasoningEffort: "low",
    });
    if (!ai.ok) {
      res.status(502).json({ success: false, code: "ai_error", error: ai.error });
      return;
    }
    const data = sanitizeHelpAnswer(parseHelpJson(ai.text), catalog);
    if (!data.answer && !data.steps.length && !data.matches.length) {
      res.status(502).json({ success: false, code: "ai_empty", error: "Empty answer" });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
