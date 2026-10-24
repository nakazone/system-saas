/**
 * Mate AI action registry — shared types.
 *
 * Every action follows the same contract:
 *   prepare(args) → a read-only look at the tenant's data that returns either
 *     - a CARD to confirm (with a signed token describing exactly what will be done),
 *     - a CLARIFY question with tappable options (each option patches the args), or
 *     - an ANSWER card (read-only questions: agenda, revenue, balances…);
 *   execute(exec) → runs the confirmed change through the routes the screens use.
 */
import type { Request } from "express";
import type { TenantPrisma } from "../../tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../../middleware/auth.js";

export type Tone = "neutral" | "good" | "warning" | "critical" | "accent";

export type CardSection =
  | { type: "fields"; rows: Array<{ label: string; value: string; edit?: FieldEdit }> }
  | {
      type: "table";
      columns: string[];
      rows: string[][];
      align?: Array<"left" | "right">;
      /** Per row: makes the `editColumn` cell editable (e.g. the quantity of a quote line). */
      edits?: Array<FieldEdit | null>;
      editColumn?: number;
      /** Per row: a quiet second line under the first cell (e.g. "Você disse: madeira"). */
      notes?: Array<string | null>;
    }
  | { type: "totals"; rows: Array<{ label: string; value: string; strong?: boolean }> }
  | { type: "list"; items: ListItem[]; empty?: string }
  | { type: "note"; text: string; tone?: Tone }
  /** Batch: rows with a checkbox each (all checked). Unchecked ids go back as `exclude` on confirm. */
  | { type: "pick"; items: PickItem[] };

export type PickItem = { id: string; title: string; detail?: string; meta?: string; tone?: Tone };

export type ListItem = {
  title: string;
  detail?: string;
  meta?: string;
  href?: string;
  tone?: Tone;
  /** Follow-up action prefilled for this row (e.g. "Faturar" on an uninvoiced job). */
  run?: { label: string; action: string; args: Record<string, unknown> };
};

/** A field the user can change on the card itself; changing it patches args and re-runs prepare. */
export type FieldEdit = {
  path: string;
  input: "text" | "number" | "date" | "datetime" | "select" | "money";
  value: string | number | null;
  options?: Array<{ value: string; label: string }>;
};

export type Assumption = { said: string; chosen: string };

export type Card = {
  title: string;
  subtitle?: string;
  badge?: { text: string; tone: Tone };
  sections: CardSection[];
  assumptions?: Assumption[];
  links?: Array<{ label: string; href: string }>;
  confirm?: {
    label: string;
    /** send = goes to the customer; money = creates/changes money records. */
    tone: "normal" | "money" | "send";
    exec: { endpoint: string; body: Record<string, unknown> };
    /** Extra explicit check shown for sends, e.g. "Enviar para john@x.com". */
    checkbox?: string;
    /** The browser sends its location with the confirmation (field day start/finish). */
    geo?: boolean;
  };
  /** Secondary way to do it in the full screen. */
  open?: { label: string; href: string };
};

export type ClarifyOption = {
  label: string;
  detail?: string;
  /** Dot paths into args → new value. */
  patch: Record<string, unknown>;
};

export type Clarify = {
  question: string;
  options: ClarifyOption[];
  /** Free-text search fallback: typed text goes into `path`. */
  search?: { placeholder: string; path: string; clear?: string[] };
};

export type PrepareResult =
  | { kind: "card"; card: Card; args: Record<string, unknown>; message?: string }
  | { kind: "clarify"; clarify: Clarify; args: Record<string, unknown>; message?: string }
  | { kind: "answer"; card: Card; args: Record<string, unknown>; message?: string }
  | { kind: "error"; message: string; args?: Record<string, unknown> };

export type ScreenContext = { type: "customer" | "lead" | "job" | "quote" | "invoice"; id: string } | null;

export type ActionContext = {
  req: AuthedRequest;
  tx: TenantPrisma;
  organizationId: string;
  userId: string;
  timezone: string;
  today: string;
  screen: ScreenContext;
  /** Records from this conversation, newest first ("o último quote que você criou"). */
  recent?: Array<{ type: string; id: string }>;
  /** Signs an execution payload for this action (10-minute token). */
  sign: (exec: Record<string, unknown>) => string;
  /** The office employee handling the request, when the user is talking to one. */
  agentKey?: string;
};

export type ExecuteContext = {
  req: AuthedRequest & Request;
  organizationId: string;
  userId: string;
  timezone: string;
  /** Batch cards: ids the user unchecked. Execute may only drop items, never add. */
  exclude?: string[];
  /** Device location sent with the confirmation, when the card asked for it. */
  geo?: { lat: number; lng: number; accuracy: number | null } | null;
};

export type ExecuteResult =
  | {
      ok: true;
      title: string;
      detail?: string;
      links?: Array<{ label: string; href: string }>;
      /** Signed inverse operation, valid for 30 seconds. */
      undo?: Record<string, unknown>;
      next?: { label: string; action: string; args: Record<string, unknown> };
      /** Short memory line for the conversation ("Created quote Q-2041 for John Smith"). */
      memory?: string;
      /** Entity to log the Mate AI activity on. */
      entity?: { type: string; id: string };
      /** Instruction for the browser after success (open editor with changes, copy a link). */
      client?:
        | { type: "quote_edit"; quote_id: string; ops: Record<string, unknown>; href: string }
        | { type: "copy"; text: string }
        | { type: "open"; href: string };
    }
  | { ok: false; status: number; error: string };

export type ActionDef = {
  name: string;
  /** One line for the model: when to pick this action. */
  description: string;
  /** Argument hints for the model (name → meaning). */
  args: Record<string, string>;
  /** Examples of what users say (pt/en). */
  examples: string[];
  permissions: string[];
  /** At least one of these too (field crew actions: any campo permission). */
  anyPermissions?: string[];
  /** Takes the photo attached to the request (`photo_id` in args). */
  acceptsPhoto?: boolean;
  readOnly?: boolean;
  prepare: (ctx: ActionContext, args: Record<string, unknown>) => Promise<PrepareResult>;
  execute?: (ctx: ExecuteContext, exec: Record<string, unknown>) => Promise<ExecuteResult>;
  /** Undo for reversible actions; gets the `undo` payload from execute. */
  undo?: (ctx: ExecuteContext, undo: Record<string, unknown>) => Promise<ExecuteResult>;
};

export function str(v: unknown, max = 500): string {
  return String(v ?? "").trim().slice(0, max);
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.round(n * 100) / 100);
}

export function uuidOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

const UNIT_LABELS: Record<string, string> = { sq_ft: "sq ft", linear_ft: "lin ft", each: "un", step: "degraus", box: "cx", hour: "h", fixed: "" };

/** "sq_ft" → "sq ft" for cards. */
export function unitLabel(unit: string | null | undefined): string {
  const u = String(unit || "");
  return u in UNIT_LABELS ? UNIT_LABELS[u]! : u.replace(/_/g, " ");
}

/** Items of a batch card the user kept checked. */
export function kept<T extends { id: string }>(ctx: { exclude?: string[] }, items: T[]): T[] {
  const out = new Set(ctx.exclude || []);
  return items.filter((i) => !out.has(i.id));
}

/** Runs a batch one by one; a failure does not stop the rest. */
export async function runEach<T>(items: T[], fn: (item: T) => Promise<{ ok: boolean; error?: string }>) {
  const done: T[] = [];
  const failed: Array<{ item: T; error: string }> = [];
  for (const item of items) {
    try {
      const r = await fn(item);
      if (r.ok) done.push(item);
      else failed.push({ item, error: r.error || "falhou" });
    } catch (e) {
      failed.push({ item, error: e instanceof Error ? e.message : "falhou" });
    }
  }
  return { done, failed };
}

export function plural(n: number, one: string, many: string): string {
  return n + " " + (n === 1 ? one : many);
}

export function isEmail(v: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/** "2026-10-20" in the org's timezone. */
export function dayIn(d: Date | string | null | undefined, tz: string): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(typeof d === "string" ? new Date(d) : d);
}

/** Who can use the field app (same rule as the campo routes). */
export const CAMPO_ANY = ["work_orders.view", "payroll.self", "schedule.view", "visits.view"];
