/**
 * Quotes beyond create/edit/send: duplicate, PDF, discounted copy, archive, "did they open it?",
 * and opening a field quote (the on-site estimate) to turn it into a quote.
 */
import { applyQuoteTransition } from "../../../modules/quotes/service.js";
import { cancelPendingMessages } from "../../automations/schedule.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";
import { withTenantTransaction } from "../../tenant/prisma-tenant.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import { quoteLabel, quoteStatusPt, resolveCustomer, resolveQuote } from "./resolve.js";
import { fmtDate } from "./time.js";
import type { ActionContext, ActionDef, PickItem } from "./types.js";
import { dayIn, kept, money, num, plural, runEach, str } from "./types.js";

const enc = encodeURIComponent;
const editor = (id: string) => ({ label: "Abrir no editor", href: "quote-builder.html?id=" + enc(id) });

async function quoteOr(ctx: ActionContext, args: Record<string, unknown>, filter: { openOnly?: boolean } = {}) {
  const r = await resolveQuote(ctx, args, filter);
  if (r.status === "clarify") return { done: { kind: "clarify" as const, clarify: r.clarify, args } };
  if (r.status === "missing") return { done: { kind: "error" as const, message: r.message, args } };
  return { quote: r.row };
}

/* ───────────────────────── duplicate ───────────────────────── */

export const duplicateQuote: ActionDef = {
  name: "quote.duplicate",
  description: "Make a copy of a quote as a new draft (same lines), e.g. for another property of the same customer.",
  args: { quote: "quote number", customer: "customer name", title: "new title (optional)" },
  examples: ["Duplica o quote do John para a casa da praia", "Copy quote 1007"],
  permissions: ["quotes.create"],
  async prepare(ctx, args) {
    const got = await quoteOr(ctx, args);
    if (got.done) return got.done;
    const q = got.quote;
    const title = str(args.title, 160);
    return {
      kind: "card",
      args: { ...args, quote_id: q.id },
      card: {
        title: "Duplicar " + quoteLabel(q),
        subtitle: q.customer?.name || undefined,
        sections: [{ type: "fields", rows: [{ label: "Total", value: money(Number(q.total)) }, { label: "Novo título", value: title || q.title + " (copy)", edit: { path: "title", input: "text", value: title || null } }] }, { type: "note", text: "Cria um rascunho novo com as mesmas linhas. O original não muda." }],
        confirm: { label: "Duplicar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ quote_id: q.id, label: quoteLabel(q), title: title || null }) } } },
        open: editor(q.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string; quote_number?: string; quoteNumber?: string } }>(ctx.req, "POST", `/api/quotes/${enc(String(exec.quote_id))}/duplicate`, {});
    const id = res.json.data?.id;
    if (!res.ok || !id) return { ok: false, status: res.status, error: internalError(res, "Não consegui duplicar.") };
    if (exec.title) {
      // Only the title: the full PUT would rewrite the payload, so update the row directly.
      await withTenantTransaction(ctx.organizationId, (tx) => tx.quote.update({ where: { id }, data: { title: String(exec.title) } }));
    }
    const num2 = res.json.data?.quote_number || res.json.data?.quoteNumber || "";
    return { ok: true, title: `Cópia criada ${num2}`.trim(), detail: "de " + exec.label, links: [editor(id)], next: { label: "Editar a cópia", action: "quote.edit", args: { quote_id: id } }, entity: { type: "quote", id }, memory: `Duplicated ${exec.label} as new quote ${num2}` };
  },
};

/* ───────────────────────── PDF ───────────────────────── */

export const quotePdf: ActionDef = {
  name: "quote.pdf",
  description: "Generate the PDF of a quote and open it.",
  args: { quote: "quote number", customer: "customer name" },
  examples: ["Gera o PDF do quote 1007", "PDF do orçamento do John"],
  permissions: ["quotes.edit"],
  async prepare(ctx, args) {
    const got = await quoteOr(ctx, args);
    if (got.done) return got.done;
    const q = got.quote;
    return {
      kind: "card",
      args: { ...args, quote_id: q.id },
      card: { title: "PDF do " + quoteLabel(q), subtitle: [q.customer?.name, money(Number(q.total))].filter(Boolean).join(" · "), sections: [], confirm: { label: "Gerar PDF", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ quote_id: q.id, label: quoteLabel(q) }) } } }, open: editor(q.id) },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ invoice_pdf_url?: string }>(ctx.req, "POST", `/api/quotes/${enc(String(exec.quote_id))}/generate-pdf`, {});
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui gerar o PDF.") };
    const href = res.json.invoice_pdf_url || `/api/quotes/${String(exec.quote_id)}/invoice-pdf`;
    return { ok: true, title: "PDF pronto · " + exec.label, links: [{ label: "Abrir PDF", href }, editor(String(exec.quote_id))], entity: { type: "quote", id: String(exec.quote_id) }, memory: `Generated PDF of ${exec.label}` };
  },
};

/* ───────────────────────── discounted copy ───────────────────────── */

export const discountedCopy: ActionDef = {
  name: "quote.discount_copy",
  description: "Send the customer a discounted version of a quote (a copy with % or $ off, marked sent, with its link). The original stays.",
  args: { quote: "quote number", customer: "customer name", discount_type: "percent | fixed", discount_value: "10 for 10% or 500 for $500" },
  examples: ["Manda uma versão com 5% de desconto para o John", "Offer Mike $300 off on quote 1007"],
  permissions: ["quotes.edit"],
  async prepare(ctx, args) {
    const got = await quoteOr(ctx, args, { openOnly: true });
    if (got.done) return got.done;
    const q = got.quote;
    const value = num(args.discount_value);
    const type = str(args.discount_type) === "fixed" ? "fixed" : "percent";
    const a = { ...args, quote_id: q.id, discount_type: type };
    if (!value || value <= 0) return { kind: "clarify", args: a, clarify: { question: "Quanto de desconto?", options: [5, 10, 15].map((p) => ({ label: p + "%", detail: money(Number(q.total) * (1 - p / 100)), patch: { discount_value: p, discount_type: "percent" } })), search: { placeholder: "Ex.: 7 (por cento)", path: "discount_value" } } };
    const total = Number(q.total);
    const after = type === "fixed" ? Math.max(0, total - value) : total * (1 - value / 100);
    return {
      kind: "card",
      args: a,
      card: {
        title: `Versão com ${type === "fixed" ? money(value) : value + "%"} de desconto`,
        subtitle: quoteLabel(q) + (q.customer?.name ? " · " + q.customer.name : ""),
        badge: { text: "Vai para o cliente", tone: "warning" },
        sections: [{ type: "totals", rows: [{ label: "Total original", value: money(total) }, { label: "Desconto", value: type === "fixed" ? money(value) : value + "% (" + money(total - after) + ")" }, { label: "Novo total", value: money(after), strong: true }] }, { type: "note", text: "Cria uma cópia com desconto, marcada como enviada, e copia o link para você mandar." }],
        confirm: { label: "Criar versão com desconto", tone: "send", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ quote_id: q.id, label: quoteLabel(q), type, value }) } } },
        open: editor(q.id),
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { quote_id: string; public_url: string; quote_number?: string; total?: number } }>(ctx.req, "POST", `/api/quotes/${enc(String(exec.quote_id))}/share-discounted-copy`, { discount_type: exec.type, discount_value: exec.value, mark_sent: true });
    const d = res.json.data;
    if (!res.ok || !d) return { ok: false, status: res.status, error: internalError(res, "Não consegui criar a versão com desconto.") };
    return { ok: true, title: `Versão com desconto pronta${d.quote_number ? " · " + d.quote_number : ""}`, detail: d.total != null ? "Novo total " + money(d.total) + " · link copiado" : "Link copiado", links: [{ label: "Abrir link", href: d.public_url }, editor(d.quote_id)], client: { type: "copy", text: d.public_url }, entity: { type: "quote", id: d.quote_id }, memory: `Discounted copy of ${exec.label}` };
  },
};

/* ───────────────────────── archive ───────────────────────── */

export const archiveQuotes: ActionDef = {
  name: "quotes.archive",
  description: "Archive quotes that won't close (one, or all open quotes of a customer). Shows the list to confirm; scheduled follow-ups stop.",
  args: { quote: "quote number (one)", customer: "customer name (all their open quotes)", reason: "why (optional)" },
  examples: ["Arquiva os quotes do Mike que não vão sair", "Archive quote 1003"],
  permissions: ["quotes.edit"],
  async prepare(ctx, args) {
    let rows: Array<{ id: string; label: string; total: number; status: string; when: Date }> = [];
    if (str(args.quote) || args.quote_id) {
      const got = await quoteOr(ctx, args);
      if (got.done) return got.done;
      const q = got.quote;
      rows = [{ id: q.id, label: quoteLabel(q), total: Number(q.total), status: q.status, when: q.updatedAt }];
    } else {
      const c = await resolveCustomer(ctx, args);
      if (c.status === "clarify") return { kind: "clarify", clarify: c.clarify, args };
      if (c.status === "missing") return { kind: "error", message: "De qual cliente?", args };
      const qs = await ctx.tx.quote.findMany({ where: { customerId: c.row.id }, select: { id: true, number: true, quoteNumber: true, title: true, total: true, status: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 30 });
      rows = qs.filter((q) => ["draft", "sent", "changes_requested"].includes(normalizeQuoteStatus(q.status))).map((q) => ({ id: q.id, label: quoteLabel(q), total: Number(q.total), status: q.status, when: q.updatedAt }));
      if (!rows.length) return { kind: "answer", args, card: { title: `${c.row.name} não tem Quote em aberto`, sections: [{ type: "note", text: "Nada para arquivar." }] } };
    }
    // The quote rules: drafts are deleted or sent, not archived; approved ones stay.
    const blocked = rows.filter((r) => ["approved", "converted", "archived", "draft"].includes(normalizeQuoteStatus(r.status)));
    const drafts = blocked.filter((r) => normalizeQuoteStatus(r.status) === "draft");
    if (blocked.length === rows.length) {
      const b = blocked[0]!;
      return { kind: "error", message: normalizeQuoteStatus(b.status) === "draft" ? `${b.label} é rascunho: rascunho não se arquiva (apague no editor ou envie).` : `${b.label} está ${quoteStatusPt(b.status)}; não dá para arquivar.`, args };
    }
    const open = rows.filter((r) => !blocked.includes(r));
    const items: PickItem[] = open.map((r) => ({ id: r.id, title: r.label, detail: `${quoteStatusPt(r.status)} · ${money(r.total)} · ${fmtDate(dayIn(r.when, ctx.timezone)!)}` }));
    const reason = str(args.reason, 200) || "Não fechou";
    return {
      kind: "card",
      args,
      card: {
        title: `Arquivar ${plural(open.length, "quote", "quotes")}`,
        sections: [
          { type: "pick", items },
          { type: "fields", rows: [{ label: "Motivo", value: reason, edit: { path: "reason", input: "text", value: reason } }] },
          ...(drafts.length ? [{ type: "note" as const, tone: "warning" as const, text: `${plural(drafts.length, "rascunho ficou", "rascunhos ficaram")} de fora: rascunho não se arquiva (apague no editor ou envie).` }] : []),
          { type: "note", text: "Saem da lista de abertos e os lembretes automáticos param. Dá para ver em Arquivados." },
        ],
        confirm: { label: "Arquivar", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ items: open.map((r) => ({ id: r.id, label: r.label })), reason }) } } },
        open: { label: "Abrir Quotes", href: "quotes.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const items = kept(ctx, (exec.items || []) as Array<{ id: string; label: string }>);
    if (!items.length) return { ok: false, status: 400, error: "Nenhum quote marcado." };
    // Same steps as the quote screen's archive (status transition + stop scheduled messages).
    const r = await runEach(items, async (it) => {
      await withTenantTransaction(ctx.organizationId, async (tx) => {
        await applyQuoteTransition(tx, { organizationId: ctx.organizationId, quoteId: it.id, event: "archive", actorType: "user", actorId: ctx.userId, note: String(exec.reason), extraData: { archiveReason: String(exec.reason) } });
        await cancelPendingMessages(tx, { entityType: "quote", entityId: it.id });
      });
      return { ok: true };
    });
    if (!r.done.length) return { ok: false, status: 409, error: r.failed[0]?.error || "Nada foi arquivado." };
    return { ok: true, title: `${plural(r.done.length, "quote arquivado", "quotes arquivados")}`, detail: r.failed.length ? "Falharam: " + r.failed.map((f) => f.item.label + " (" + f.error + ")").join(", ") : r.done.map((d) => d.label).join(", "), links: [{ label: "Abrir Quotes", href: "quotes.html" }], memory: `Archived ${r.done.map((d) => d.label).join(", ")}` };
  },
};

/* ───────────────────────── did they open it? ───────────────────────── */

export const quoteEngagement: ActionDef = {
  name: "quote.engagement",
  description: "Did the customer open / sign the quote? When it was sent, first viewed, signed or changes asked.",
  args: { quote: "quote number", customer: "customer name" },
  examples: ["O John abriu o quote?", "Did Mike see the quote?"],
  permissions: ["quotes.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await quoteOr(ctx, args);
    if (got.done) return got.done;
    const q = got.quote;
    const row = await ctx.tx.quote.findFirst({ where: { id: q.id }, select: { viewedAt: true, signedAt: true, payload: true, status: true, changeRequestNote: true } });
    const p = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
    const sentAt = (p.email_sent_at || p.sent_at || null) as string | null;
    const day = (d: Date | string | null | undefined) => (d ? fmtDate(dayIn(d, ctx.timezone)!) : null);
    const viewed = row?.viewedAt;
    const title = row?.signedAt ? `Assinado em ${day(row.signedAt)}` : viewed ? `Sim, abriu em ${day(viewed)}` : sentAt ? "Ainda não abriu" : "Ainda não foi enviado";
    return {
      kind: "answer",
      args: { ...args, quote_id: q.id },
      card: {
        title,
        subtitle: quoteLabel(q) + (q.customer?.name ? " · " + q.customer.name : ""),
        sections: [
          { type: "fields", rows: [{ label: "Status", value: quoteStatusPt(q.status) }, { label: "Enviado", value: day(sentAt) || "—" }, { label: "Aberto", value: day(viewed) || "não" }, { label: "Assinado", value: day(row?.signedAt) || "não" }, ...(row?.changeRequestNote ? [{ label: "Pediu mudança", value: row.changeRequestNote }] : [])] },
        ],
        open: editor(q.id),
      },
    };
  },
};

/* ───────────────────────── field quote → quote ───────────────────────── */

export const openFieldQuote: ActionDef = {
  name: "fieldquote.open",
  description: "Open the field quote (on-site estimate with rooms and measurements) of a client to generate the real quote from it.",
  args: { client: "client name" },
  examples: ["Transforma o orçamento de campo da Ana em quote", "Open Mark's field quote"],
  permissions: ["quotes.create"],
  readOnly: true,
  async prepare(ctx, args) {
    const q = str(args.client || args.customer || args.lead, 80);
    const rows = await ctx.tx.fieldQuote.findMany({ select: { id: true, clientName: true, address: true, totalSqft: true, total: true, quoteId: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 100 });
    const hits = q ? rows.filter((r) => nameSimilarity(q, [r.clientName]) >= 55) : rows.slice(0, 1);
    if (!hits.length) return { kind: "error", message: q ? `Não achei orçamento de campo de “${q}”.` : "De qual cliente?", args };
    const fq = hits[0]!;
    return {
      kind: "answer",
      args,
      card: {
        title: "Orçamento de campo · " + fq.clientName,
        subtitle: [fq.address, Number(fq.totalSqft) ? Number(fq.totalSqft).toLocaleString("en-US") + " sq ft" : null, Number(fq.total) ? money(Number(fq.total)) : null].filter(Boolean).join(" · "),
        sections: [{ type: "note", text: fq.quoteId ? "Já tem Quote gerado. Abra para revisar ou gerar de novo." : "Abra e toque em “Gerar orçamento”: as linhas saem dos cômodos medidos." }],
        links: [{ label: "Abrir orçamento de campo", href: "field-quote.html?id=" + enc(fq.id) }, ...(fq.quoteId ? [editor(fq.quoteId)] : [])],
      },
    };
  },
};

export const QUOTE_MORE_ACTIONS: ActionDef[] = [duplicateQuote, quotePdf, discountedCopy, archiveQuotes, quoteEngagement, openFieldQuote];
