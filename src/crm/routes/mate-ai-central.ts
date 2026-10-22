/**
 * Mate AI central: what the bar and the Mate AI page need besides the actions themselves.
 *
 * - GET  /api/mate-ai/catalog              what the user can ask, by module (from the action registry)
 * - GET  /api/mate-ai/activity?days=2      what the Mate did for this user (confirmed actions)
 * - GET  /api/mate-ai/conversations?q=     this user's conversations, newest first
 * - GET  /api/mate-ai/conversations/:id    one conversation's turns
 * - PUT  /api/mate-ai/conversations/:id    save a conversation (the panel's own id)
 * - DELETE /api/mate-ai/conversations/:id
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { canUse, listActions } from "../../lib/mate-ai/agent.js";
import { foldText } from "../../lib/mate-ai/local.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";

export const mateAiCentralRouter = Router();

/* ───────────────────────── catalog ───────────────────────── */

/** Module of an action by its name; the order is the order shown. */
const MODULES: Array<{ key: string; label: string; prefixes: string[] }> = [
  { key: "inicio", label: "Início", prefixes: ["agenda.", "money.", "dashboard.", "brief."] },
  { key: "calendario", label: "Calendário", prefixes: ["meeting.", "schedule.", "visit.", "jobs.reschedule"] },
  { key: "leads", label: "Leads", prefixes: ["lead.", "leads."] },
  { key: "clientes", label: "Clientes", prefixes: ["customer.", "customers."] },
  { key: "quotes", label: "Quotes", prefixes: ["quote.", "quotes.", "fieldquote."] },
  { key: "jobs", label: "Jobs", prefixes: ["job.", "jobs."] },
  { key: "invoices", label: "Invoices e pagamentos", prefixes: ["invoice.", "invoices.", "payment.", "receipt."] },
  { key: "obracam", label: "ObraCam", prefixes: ["media."] },
  { key: "obrachat", label: "ObraChat", prefixes: ["chat."] },
  { key: "folha", label: "Folha", prefixes: ["folha."] },
  { key: "fluxo", label: "Fluxo de caixa", prefixes: ["finance."] },
  { key: "tabela", label: "Tabela de valores", prefixes: ["pricing.", "supplier."] },
  { key: "relatorios", label: "Relatórios", prefixes: ["report."] },
  { key: "config", label: "Configurações", prefixes: ["settings.", "users."] },
  { key: "campo", label: "App de campo", prefixes: ["campo."] },
];

export function moduleOf(action: string): { key: string; label: string } {
  // Longest prefix wins ("jobs.reschedule" is Calendário, other "jobs." are Jobs).
  let best: { key: string; label: string; len: number } | null = null;
  for (const m of MODULES) {
    for (const p of m.prefixes) {
      if ((action === p || action.startsWith(p)) && (!best || p.length > best.len)) best = { key: m.key, label: m.label, len: p.length };
    }
  }
  return best ? { key: best.key, label: best.label } : { key: "outros", label: "Outros" };
}

/** Portuguese examples come first in each action; English/Spanish ones are left out of the list. */
function looksPortuguese(text: string): boolean {
  const t = foldText(text);
  if (/[ãõçáéíóúâêô]/i.test(text)) return true;
  // English (or Spanish) words decide unless a word that only Portuguese uses is there too.
  const foreign = /\b(the|what|who|how|need|still|send|show|create|log|my|on|for|this|with|to|from|today|yesterday|tomorrow|cual|cuanto|cuando)\b/.test(t);
  const onlyPt = /\b(pro|pra|para|com|esse|essa|este|esta|quanto|quem|qual|hoje|ontem|amanha|nao|voce|manda|lanca|cria|marca|mostra)\b/.test(t);
  if (foreign && !onlyPt) return false;
  return /\b(o|a|os|as|do|da|de|no|na|pro|pra|para|com|esse|essa|este|esta|quanto|quem|qual|hoje|ontem|amanha|manda|lanca|cria|marca|mostra)\b/.test(t);
}

mateAiCentralRouter.get("/api/mate-ai/catalog", requireCrmAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const byModule = new Map<string, { key: string; label: string; items: Array<{ text: string; action: string }> }>();
  for (const def of listActions()) {
    if (!canUse(def, user)) continue;
    const m = moduleOf(def.name);
    const examples = def.examples.filter(looksPortuguese).slice(0, 2);
    if (!examples.length) continue;
    const bucket = byModule.get(m.key) || { key: m.key, label: m.label, items: [] };
    for (const text of examples) bucket.items.push({ text, action: def.name });
    byModule.set(m.key, bucket);
  }
  const order = [...MODULES.map((m) => m.key), "outros"];
  const modules = [...byModule.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  res.setHeader("Cache-Control", "private, max-age=300");
  res.json({ success: true, data: { modules, total: modules.reduce((n, m) => n + m.items.length, 0) } });
});

/* ───────────────────────── activity ───────────────────────── */

type Change<T> = { from: unknown; to: T } | undefined;
type ExecutedChanges = {
  action?: Change<string>;
  title?: Change<string>;
  detail?: Change<string | null>;
  links?: Change<Array<{ label: string; href: string }>>;
  entity?: Change<{ type: string; id: string } | null>;
};

/** Where an entity opens in the CRM. */
function entityHref(entity: { type: string; id: string } | null | undefined): string | null {
  if (!entity?.id) return null;
  const id = encodeURIComponent(entity.id);
  switch (entity.type) {
    case "quote":
      return "quote-builder.html?id=" + id;
    case "invoice":
      return "invoice.html?id=" + id;
    case "work_order":
    case "job":
      return "job-detail.html?id=" + id;
    case "lead":
      return "lead-detail.html?id=" + id;
    case "customer":
      return "customers.html?id=" + id;
    default:
      return null;
  }
}

mateAiCentralRouter.get("/api/mate-ai/activity", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 2));
    const since = new Date(Date.now() - days * 864e5);
    const rows = await withTenantTransaction(req.organizationId!, (tx) =>
      tx.activityEvent.findMany({
        where: { entityType: "mate_ai", action: "mate_ai.executed", actorId: req.user!.id, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { id: true, changes: true, createdAt: true },
      }),
    );
    const data = rows.map((r) => {
      const c = (r.changes || {}) as ExecutedChanges;
      const entity = c.entity?.to ?? null;
      const links = (c.links?.to || []).filter((l) => l && typeof l.href === "string" && typeof l.label === "string").slice(0, 3);
      const open = links[0]?.href || entityHref(entity);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        action: c.action?.to || "",
        module: moduleOf(c.action?.to || "").label,
        title: c.title?.to || "Ação do Mate",
        detail: c.detail?.to || null,
        entity,
        open: open ? { label: links[0]?.label || "Abrir", href: open } : null,
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── conversations ───────────────────────── */

const ID = z.string().uuid();

const itemSchema = z.record(z.string(), z.unknown());
const saveSchema = z.object({
  items: z.array(itemSchema).max(60),
});

/** Removes what must not be stored or replayed: confirmation and undo tokens, photos. */
function sanitize(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return items
    .filter((m) => m && m.kind !== "thinking")
    .map((m) => {
      const copy: Record<string, unknown> = JSON.parse(JSON.stringify(m));
      delete copy.undo;
      delete copy.working;
      if (copy.kind === "card" || copy.kind === "clarify") copy.stale = true;
      const card = copy.card as Record<string, unknown> | undefined;
      if (card && card.confirm && typeof card.confirm === "object") {
        const confirm = { ...(card.confirm as Record<string, unknown>) };
        delete confirm.exec;
        card.confirm = confirm;
      }
      return copy;
    });
}

function textOf(m: Record<string, unknown>): string {
  if (m.role === "user") return String(m.text || "");
  const r = m.result as Record<string, unknown> | undefined;
  if (m.kind === "done" && r) return [r.title, r.detail].filter(Boolean).join(" · ");
  const card = m.card as Record<string, unknown> | undefined;
  if (card?.title) return String(card.title);
  if (m.message) return String(m.message);
  return "";
}

function summarize(items: Array<Record<string, unknown>>) {
  const users = items.filter((m) => m.role === "user");
  const title = String(users[0]?.text || "Conversa").replace(/^📷\s*/, "").slice(0, 140);
  const done = items.filter((m) => m.kind === "done").map((m) => String((m.result as Record<string, unknown> | undefined)?.title || "")).filter(Boolean);
  const outcome = done.length ? done[done.length - 1]!.slice(0, 160) + (done.length > 1 ? ` (+${done.length - 1})` : "") : null;
  const searchText = foldText(items.map(textOf).join(" \n ")).slice(0, 8000);
  return { title, outcome, searchText, turns: users.length };
}

mateAiCentralRouter.get("/api/mate-ai/conversations", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const q = foldText(String(req.query.q || "")).trim().slice(0, 80);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const rows = await withTenantTransaction(req.organizationId!, (tx) =>
      tx.mateAiConversation.findMany({
        where: { userId: req.user!.id, ...(q ? { searchText: { contains: q } } : {}) },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: { id: true, title: true, outcome: true, turns: true, createdAt: true, updatedAt: true },
      }),
    );
    res.json({
      success: true,
      data: rows.map((r) => ({ id: r.id, title: r.title, outcome: r.outcome, turns: r.turns, created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString() })),
    });
  } catch (error) {
    next(error);
  }
});

mateAiCentralRouter.get("/api/mate-ai/conversations/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = ID.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ success: false, error: "Conversa inválida." });
      return;
    }
    const row = await withTenantTransaction(req.organizationId!, (tx) =>
      tx.mateAiConversation.findFirst({ where: { id: id.data, userId: req.user!.id }, select: { id: true, title: true, items: true, updatedAt: true } }),
    );
    if (!row) {
      res.status(404).json({ success: false, error: "Conversa não encontrada." });
      return;
    }
    res.json({ success: true, data: { id: row.id, title: row.title, items: row.items, updated_at: row.updatedAt.toISOString() } });
  } catch (error) {
    next(error);
  }
});

mateAiCentralRouter.put("/api/mate-ai/conversations/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = ID.safeParse(req.params.id);
    const body = saveSchema.safeParse(req.body || {});
    if (!id.success || !body.success) {
      res.status(400).json({ success: false, error: "Conversa inválida." });
      return;
    }
    const items = sanitize(body.data.items as Array<Record<string, unknown>>);
    if (!items.some((m) => m.role === "user")) {
      res.json({ success: true, data: { id: id.data, saved: false } });
      return;
    }
    const json = JSON.stringify(items);
    if (json.length > 400_000) {
      res.status(413).json({ success: false, error: "Conversa grande demais." });
      return;
    }
    const s = summarize(items);
    const organizationId = req.organizationId!;
    const userId = req.user!.id;
    const saved = await withTenantTransaction(organizationId, async (tx) => {
      const existing = await tx.mateAiConversation.findUnique({ where: { id: id.data }, select: { userId: true } });
      if (existing && existing.userId !== userId) return false;
      const data = { title: s.title, outcome: s.outcome, searchText: s.searchText, turns: s.turns, items: items as Prisma.InputJsonValue };
      await tx.mateAiConversation.upsert({
        where: { id: id.data },
        create: { id: id.data, organizationId, userId, ...data },
        update: data,
      });
      return true;
    });
    if (!saved) {
      res.status(404).json({ success: false, error: "Conversa não encontrada." });
      return;
    }
    res.json({ success: true, data: { id: id.data, saved: true } });
  } catch (error) {
    next(error);
  }
});

mateAiCentralRouter.delete("/api/mate-ai/conversations/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = ID.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ success: false, error: "Conversa inválida." });
      return;
    }
    await withTenantTransaction(req.organizationId!, (tx) => tx.mateAiConversation.deleteMany({ where: { id: id.data, userId: req.user!.id } }));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
