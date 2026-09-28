/**
 * Field checklist helpers for Campo jobs (Phase 3).
 */
import { randomUUID } from "node:crypto";
import { aiChatJson, isAiConfigured } from "../ai/client.js";

export type CampoChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  photo_required?: boolean;
  photo_media_ids?: string[];
  note?: string | null;
  done_by?: string | null;
  done_at?: string | null;
};

export const DEFAULT_CAMPO_CHECKLIST: CampoChecklistItem[] = [
  { id: "c1", text: "Furniture moved out of work area", done: false, photo_required: false },
  { id: "c2", text: "Baseboards protected / taped", done: false, photo_required: false },
  { id: "c3", text: "Subfloor checked and prepped", done: false, photo_required: true },
  { id: "c4", text: "Before photos of each room", done: false, photo_required: true },
  { id: "c5", text: "After photos of completed areas", done: false, photo_required: true },
];

export const FIELD_CHECKLIST_TEMPLATES: {
  key: string;
  name: string;
  items: Omit<CampoChecklistItem, "done" | "done_by" | "done_at" | "photo_media_ids">[];
}[] = [
  {
    key: "pre_install",
    name: "Pre-install",
    items: [
      { id: "pi1", text: "Moisture reading recorded", photo_required: false },
      { id: "pi2", text: "Subfloor flat and clean", photo_required: true },
      { id: "pi3", text: "Material acclimated", photo_required: false },
      { id: "pi4", text: "Area cleared of furniture", photo_required: true },
    ],
  },
  {
    key: "install_day",
    name: "Install day",
    items: [
      { id: "id1", text: "Layout / chalk lines set", photo_required: false },
      { id: "id2", text: "First rows installed", photo_required: true },
      { id: "id3", text: "Transitions planned", photo_required: false },
      { id: "id4", text: "End-of-day cleanup", photo_required: true },
    ],
  },
  {
    key: "final_walkthrough",
    name: "Final walkthrough",
    items: [
      { id: "fw1", text: "Punch list reviewed", photo_required: false },
      { id: "fw2", text: "After photos complete", photo_required: true },
      { id: "fw3", text: "Customer walkthrough done", photo_required: false },
      { id: "fw4", text: "Warranty / care sheet left", photo_required: false },
    ],
  },
];

export function parseCampoChecklist(raw: unknown): CampoChecklistItem[] {
  if (!Array.isArray(raw) || !raw.length) {
    return DEFAULT_CAMPO_CHECKLIST.map((x) => ({ ...x, photo_media_ids: [] }));
  }
  return raw.map((item, i) => {
    const row = item as Record<string, unknown>;
    const ids = Array.isArray(row.photo_media_ids)
      ? row.photo_media_ids.map(String)
      : Array.isArray(row.photoMediaIds)
        ? row.photoMediaIds.map(String)
        : [];
    return {
      id: String(row.id || `c${i + 1}`),
      text: String(row.text || "Item"),
      done: Boolean(row.done),
      photo_required: Boolean(row.photo_required ?? row.photoRequired),
      photo_media_ids: ids,
      note: row.note != null ? String(row.note).slice(0, 500) : null,
      done_by: row.done_by != null ? String(row.done_by) : row.doneBy != null ? String(row.doneBy) : null,
      done_at: row.done_at != null ? String(row.done_at) : row.doneAt != null ? String(row.doneAt) : null,
    };
  });
}

export function templateToChecklist(key: string): CampoChecklistItem[] | null {
  const tpl = FIELD_CHECKLIST_TEMPLATES.find((t) => t.key === key);
  if (!tpl) return null;
  return tpl.items.map((it) => ({
    ...it,
    done: false,
    photo_media_ids: [],
    note: null,
    done_by: null,
    done_at: null,
  }));
}

export function canCompleteChecklistItem(
  item: CampoChecklistItem,
  nextDone: boolean,
): { ok: true } | { ok: false; error: string } {
  if (!nextDone) return { ok: true };
  if (item.photo_required && !(item.photo_media_ids && item.photo_media_ids.length)) {
    return { ok: false, error: "This item requires at least one photo before it can be completed" };
  }
  return { ok: true };
}

export function applyChecklistToggle(
  items: CampoChecklistItem[],
  itemId: string,
  done: boolean,
  actorName: string | null,
  photoMediaId?: string | null,
): { ok: true; items: CampoChecklistItem[] } | { ok: false; error: string } {
  const next = items.map((item) => {
    if (item.id !== itemId) return item;
    const photo_media_ids = [...(item.photo_media_ids || [])];
    if (photoMediaId && !photo_media_ids.includes(photoMediaId)) {
      photo_media_ids.push(photoMediaId);
    }
    const merged = { ...item, photo_media_ids };
    return merged;
  });
  const target = next.find((i) => i.id === itemId);
  if (!target) return { ok: false, error: "Checklist item not found" };
  const gate = canCompleteChecklistItem(target, done);
  if (!gate.ok) return gate;
  return {
    ok: true,
    items: next.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        done,
        done_by: done ? actorName : null,
        done_at: done ? new Date().toISOString() : null,
      };
    }),
  };
}

export type AnnotationShape =
  | { id: string; type: "freehand"; color: string; width: number; points: number[] }
  | { id: string; type: "arrow"; color: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { id: string; type: "circle"; color: string; width: number; cx: number; cy: number; r: number }
  | { id: string; type: "text"; color: string; x: number; y: number; text: string; size: number };

export type AnnotationsDoc = {
  version: 1;
  shapes: AnnotationShape[];
  updated_at?: string;
};

export function parseAnnotations(raw: unknown): AnnotationsDoc {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: 1, shapes: [] };
  }
  const o = raw as Record<string, unknown>;
  const shapes = Array.isArray(o.shapes) ? (o.shapes as AnnotationShape[]) : [];
  return {
    version: 1,
    shapes: shapes.filter((s) => s && typeof s === "object" && "type" in s),
    updated_at: o.updated_at ? String(o.updated_at) : undefined,
  };
}

export function normalizeAnnotations(raw: unknown): AnnotationsDoc {
  const doc = parseAnnotations(raw);
  return {
    version: 1,
    shapes: doc.shapes.slice(0, 200).map((s) => {
      if (!s.id) return { ...s, id: randomUUID() };
      return s;
    }),
    updated_at: new Date().toISOString(),
  };
}

export async function proposeChecklistFromSpeech(transcript: string): Promise<
  | { ok: true; items: { text: string; photo_required: boolean }[]; model: string }
  | { ok: false; error: string }
> {
  const text = String(transcript || "").trim();
  if (text.length < 4) return { ok: false, error: "Say or type what needs to be checked" };
  if (!isAiConfigured()) {
    // Fallback: split on commas / "and" / newlines
    const parts = text
      .split(/[\n,;]+|\band\b/gi)
      .map((p) => p.trim())
      .filter((p) => p.length > 2)
      .slice(0, 20);
    if (!parts.length) return { ok: false, error: "Could not parse checklist items" };
    return {
      ok: true,
      model: "heuristic",
      items: parts.map((p) => ({
        text: p.replace(/^(check|verify|inspect)\s+/i, "").replace(/^./, (c) => c.toUpperCase()),
        photo_required: /photo|picture|image|before|after/i.test(p),
      })),
    };
  }

  const result = await aiChatJson({
    system: `You turn spoken field notes into a job checklist for US flooring installers.
Return ONLY JSON: { "items": [ { "text": string, "photo_required": boolean } ] }
Max 15 items. Short actionable labels. American English.`,
    user: `Create checklist items from this:\n"""${text.slice(0, 2000)}"""`,
    timeoutMs: 45_000,
  });
  if (!result.ok) return { ok: false, error: result.error };
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(result.text) as { items?: unknown };
  } catch {
    return { ok: false, error: "AI returned invalid JSON" };
  }
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const row = it as Record<string, unknown>;
          const t = String(row.text || "").trim();
          if (!t) return null;
          return { text: t.slice(0, 200), photo_required: Boolean(row.photo_required) };
        })
        .filter((x): x is { text: string; photo_required: boolean } => Boolean(x))
        .slice(0, 15)
    : [];
  if (!items.length) return { ok: false, error: "AI proposed no items" };
  return { ok: true, items, model: result.model };
}

export function buildRecap(input: {
  checklist: CampoChecklistItem[];
  photoCount: number;
  photosByStage: Record<string, number>;
  lastPhotoAt: string | null;
}): {
  done: string[];
  pending: string[];
  risks: string[];
  photo_summary: string;
} {
  const done = input.checklist.filter((c) => c.done).map((c) => c.text);
  const pending = input.checklist.filter((c) => !c.done).map((c) => c.text);
  const risks: string[] = [];
  for (const c of input.checklist) {
    if (!c.done && c.photo_required) risks.push(`Missing required photo: ${c.text}`);
  }
  if (input.photoCount === 0) risks.push("No job photos uploaded yet");
  if (!input.photosByStage.after && done.length) {
    risks.push("No after photos tagged yet");
  }
  const parts = Object.entries(input.photosByStage)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  const photo_summary =
    input.photoCount === 0
      ? "No photos"
      : `${input.photoCount} photo(s)${parts.length ? ` (${parts.join(", ")})` : ""}${
          input.lastPhotoAt ? `; last ${input.lastPhotoAt}` : ""
        }`;
  return { done, pending, risks, photo_summary };
}
