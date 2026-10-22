import { normalizeMateAiUnit, resolveCustomerUnitPrice } from "../command.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { builderUnit, loadMateAiCatalog, pickService } from "./catalog.js";
import { quoteLabel, quoteStatusPt, resolveQuote } from "./resolve.js";
import type { ActionDef, Clarify } from "./types.js";
import { money, num, str, unitLabel, uuidOrNull } from "./types.js";

function builderLink(id: string) {
  return { label: "Abrir no editor", href: "quote-builder.html?id=" + encodeURIComponent(id) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function quoteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value).trim().replace(/[$\s]/g, "");
  if (!raw) return null;
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    raw = /,\d{1,2}$/.test(raw) ? raw.replace(",", ".") : raw.replace(/,/g, "");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedUnit(value: unknown): string {
  const unit = normalizeMateAiUnit(String(value || "").toLowerCase().replace(/[\s.-]+/g, "_"));
  return unit || String(value || "").toLowerCase().replace(/[\s.-]+/g, "_");
}

function foldText(value: unknown): string {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/* ───────────────────────── edit (add lines / discount) ───────────────────────── */

export const editQuote: ActionDef = {
  name: "quote.edit",
  description:
    "Edit an existing quote. Use line_item / unit_price to change the price of an existing service line (for example, the sqft price in the quote just created); use line_item / quantity to change its quantity. Use items only when adding a new service line, or discount_type / discount_value for a discount. Follow-up changes refer to the current quote.",
  args: {
    quote: "quote number, or empty to use the customer's open quote / current screen",
    customer: "customer name when the quote is identified by customer",
    line_item: "existing quote line by service name or unit, e.g. Hardwood Installation or sq ft",
    line_item_id: "exact existing quote line id when a clarification choice provided one",
    unit_price: "new USD price per unit for an existing line (e.g. 3.85 for $3.85/sq ft)",
    quantity: "new quantity for an existing line (optional)",
    items: "lines to add: [{service_ref, service_text, quantity, unit, unit_price?}] like quote.create; unit_price when the user states the price",
    discount_type: "percent | fixed (optional)",
    discount_value: "number (optional): 10 for 10% or 500 for $500",
  },
  examples: ["Muda o preço por square foot para $3.85 no quote que você acabou de criar", "Change the Hardwood Installation rate to $3.85 per sqft", "Adiciona 14 degraus no quote do John", "Dá 10% de desconto no quote 2041"],
  permissions: ["quotes.edit", "pricing.view"],
  async prepare(ctx, args) {
    const q = await resolveQuote(ctx, args, { openOnly: true });
    if (q.status === "clarify") return { kind: "clarify", clarify: q.clarify, args };
    if (q.status === "missing") return { kind: "error", message: q.message, args };
    const quote = q.row;
    const s = normalizeQuoteStatus(quote.status);
    if (!["draft", "sent", "changes_requested"].includes(s)) {
      return { kind: "error", message: `O Quote ${quoteLabel(quote)} está ${quoteStatusPt(quote.status)}. Abra no editor para mudar.`, args };
    }
    const full = await ctx.tx.quote.findFirst({
      where: { id: quote.id },
      select: {
        subtotal: true, discountType: true, discountValue: true, taxTotal: true, total: true, payload: true,
        lineItems: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, description: true, unit: true, quantity: true, unitPrice: true, amount: true } },
        customer: { select: { id: true, name: true, customerType: true, pricingMode: true, customPricingRates: true } },
      },
    });
    if (!full) return { kind: "error", message: "Quote não encontrado.", args };

    const requestedPrice = quoteNumber(args.unit_price ?? args.new_unit_price);
    const requestedQuantity = quoteNumber(args.quantity);
    const lineItemId = uuidOrNull(args.line_item_id);
    const lineQuery = foldText(args.line_item ?? args.item_query ?? args.service);
    const editingExistingLine = requestedPrice != null || requestedQuantity != null || Boolean(lineItemId || lineQuery);
    if (editingExistingLine) {
      if (s !== "draft") {
        return { kind: "error", message: `O Quote ${quoteLabel(quote)} já foi enviado ou aprovado. Reabra uma revisão no editor antes de alterar uma linha.`, args: { ...args, quote_id: quote.id } };
      }
      if (requestedPrice == null && requestedQuantity == null) {
        return { kind: "error", message: "Qual alteração devo fazer nessa linha? Diga o novo preço por unidade ou a nova quantidade.", args: { ...args, quote_id: quote.id } };
      }
      const quoteLines = full.lineItems;
      let candidates = lineItemId ? quoteLines.filter((line) => line.id === lineItemId) : [];
      if (!candidates.length && lineQuery) {
        const sqftQuery = /\b(sq\s*ft|sqft|square\s*(foot|feet|footage)|square\s*ft)\b/.test(lineQuery.replace(/_/g, " "));
        const unitQuery = sqftQuery
          ? "sq_ft"
          : /\b(linear\s*(foot|feet|ft)|lin\s*ft|lf)\b/.test(lineQuery.replace(/_/g, " ")) ? "linear_ft" : "";
        candidates = quoteLines.filter((line) => {
          const lineUnit = normalizedUnit(line.unit);
          const fullName = foldText(`${line.name || ""} ${line.description || ""}`);
          if (unitQuery) return lineUnit === unitQuery;
          const words = lineQuery.split(/\s+/).filter((word) => word.length > 2);
          return fullName.includes(lineQuery) || (words.length > 0 && words.every((word) => fullName.includes(word)));
        });
      }
      if (!candidates.length && !lineQuery && !lineItemId && quoteLines.length === 1) candidates = [quoteLines[0]!];
      if (candidates.length !== 1) {
        if (!quoteLines.length) return { kind: "error", message: `O Quote ${quoteLabel(quote)} não tem linhas para editar.`, args: { ...args, quote_id: quote.id } };
        const asked = lineQuery ? `Não identifiquei uma única linha para “${str(args.line_item, 100)}”.` : "Qual linha do quote você quer alterar?";
        return {
          kind: "clarify",
          args: { ...args, quote_id: quote.id },
          clarify: {
            question: asked,
            options: quoteLines.map((line) => ({
              label: String(line.name || line.description || "Serviço"),
              detail: `${Number(line.quantity).toLocaleString("en-US")} ${unitLabel(normalizedUnit(line.unit))} · ${money(Number(line.unitPrice))}/${unitLabel(normalizedUnit(line.unit))}`,
              patch: { line_item_id: line.id },
            })),
          },
        };
      }
      const line = candidates[0]!;
      const oldPrice = Number(line.unitPrice);
      const oldQuantity = Number(line.quantity);
      const nextPrice = requestedPrice ?? oldPrice;
      const nextQuantity = requestedQuantity ?? oldQuantity;
      if (nextPrice < 0 || nextPrice > 1_000_000) return { kind: "error", message: "O preço precisa estar entre $0 e $1.000.000 por unidade.", args: { ...args, quote_id: quote.id } };
      if (nextQuantity <= 0 || nextQuantity > 1_000_000) return { kind: "error", message: "A quantidade precisa ser maior que zero.", args: { ...args, quote_id: quote.id } };
      const nextAmount = round2(nextPrice * nextQuantity);
      const currentAmount = round2(Number(line.amount));
      const subtotal = round2(Number(full.subtotal) + nextAmount - currentAmount);
      const discountType = full.discountType === "fixed" ? "fixed" : "percentage";
      const discountValue = Number(full.discountValue || 0);
      const discount = discountType === "fixed" ? Math.min(Math.max(0, discountValue), subtotal) : Math.min(subtotal * (discountValue / 100), subtotal);
      const tax = Number(full.taxTotal || 0);
      const total = Math.max(0, round2(subtotal - discount + tax));
      const label = String(line.name || line.description || "Serviço").split("\n")[0]!;
      const unit = unitLabel(normalizedUnit(line.unit));
      const exec = {
        quote_id: quote.id,
        line_item_id: line.id,
        label: quoteLabel(quote),
        line_label: label,
        unit,
        before_price: oldPrice,
        before_quantity: oldQuantity,
        unit_price: nextPrice,
        quantity: nextQuantity,
        subtotal,
        total,
      };
      return {
        kind: "card",
        args: { ...args, quote_id: quote.id, line_item_id: line.id },
        card: {
          title: `Atualizar ${label} · ${quoteLabel(quote)}`,
          subtitle: `Rascunho para ${full.customer?.name || "cliente"}`,
          sections: [
            { type: "table", columns: ["Serviço", "Qtd", "Preço por unidade", "Total da linha"], rows: [[label, `${nextQuantity.toLocaleString("en-US")} ${unit}`, `${money(oldPrice)} → ${money(nextPrice)}/${unit}`, money(nextAmount)]], align: ["left", "right", "right", "right"] },
            { type: "totals", rows: [{ label: "Total atual", value: money(Number(full.total)) }, { label: "Novo subtotal", value: money(subtotal) }, { label: "Novo total", value: money(total), strong: true }] },
            { type: "note", text: "O rascunho será atualizado e continuará nesta conversa. Nada será enviado ao cliente." },
          ],
          confirm: { label: "Atualizar rascunho", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
          open: builderLink(quote.id),
        },
      };
    }

    const rawItems = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
    const discountValue = num(args.discount_value);
    const discountTypeArg = str(args.discount_type).toLowerCase();
    if (!rawItems.length && discountValue == null) {
      return { kind: "error", message: "O que devo mudar no Quote? Diga um serviço com quantidade ou um desconto.", args: { ...args, quote_id: quote.id } };
    }

    const catalog = rawItems.length ? await loadMateAiCatalog(ctx.tx, ctx.organizationId) : [];
    const customer = full.customer || { id: null, name: "este cliente", customerType: "particular", pricingMode: "table", customPricingRates: null };
    const added: Array<Record<string, unknown>> = [];
    const overrides: Array<Record<string, unknown>> = [];
    const rows: string[][] = [];
    for (let i = 0; i < rawItems.length && i < 8; i++) {
      const spec = rawItems[i]!;
      const qty = num(spec.quantity);
      if (qty == null || qty <= 0) return { kind: "error", message: "Qual a quantidade de “" + str(spec.service_text) + "”?", args };
      const picked = pickService(catalog, spec);
      if (picked.status === "choose") {
        const clarify: Clarify = {
          question: `Qual serviço do catálogo é “${str(spec.service_text) || "serviço " + (i + 1)}”?`,
          options: picked.options.map((o) => ({
            label: o.name,
            detail: normalizeMateAiUnit(o.unit) || o.unit,
            patch: { [`items.${i}.catalog_item_id`]: o.id, [`items.${i}.catalog_source`]: o.source, [`items.${i}.unit`]: null },
          })),
        };
        return { kind: "clarify", clarify, args: { ...args, quote_id: quote.id } };
      }
      const item = picked.item;
      const said = num(spec.unit_price);
      const rate = said != null && said > 0 ? round2(said) : resolveCustomerUnitPrice(item, customer) || 0;
      if (rate <= 0) {
        // Ask in the conversation; the answer becomes this line's price.
        return {
          kind: "clarify",
          args: { ...args, quote_id: quote.id },
          clarify: {
            question: `“${item.name}” não tem preço para ${customer.name}. Qual o preço por ${unitLabel(normalizeMateAiUnit(item.unit) || item.unit) || "unidade"}?`,
            options: [],
            search: { placeholder: "Preço em $ (ex.: 0.80)", path: `items.${i}.unit_price` },
          },
        };
      }
      if (said != null && said > 0 && round2(said) !== round2(resolveCustomerUnitPrice(item, customer) || 0)) {
        overrides.push({ catalog_item_id: item.id, catalog_source: item.source, pricing_item_id: item.pricingItemId, name: item.name, unit_price: rate });
      }
      const amount = round2(qty * rate);
      added.push({
        item_type: "service",
        name: item.name,
        description: item.description || "",
        unit_type: builderUnit(item.unit),
        quantity: qty,
        rate,
        sell_price: rate,
        service_type: item.category || null,
        catalog_customer_notes: item.description || null,
        service_catalog_id: item.source === "quote-catalog" ? item.id : null,
        pricing_item_id: item.pricingItemId,
      });
      rows.push([item.name, (qty.toLocaleString("en-US") + " " + unitLabel(normalizeMateAiUnit(item.unit) || item.unit)).trim(), money(rate), money(amount)]);
    }

    // Same math as the Quote Builder: discount on the subtotal, tax kept as entered.
    const sub0 = Number(full.subtotal);
    const sub = round2(sub0 + added.reduce((s, it) => s + round2(Number(it.quantity) * Number(it.rate)), 0));
    const dt = discountValue != null ? (discountTypeArg === "fixed" ? "fixed" : "percentage") : full.discountType === "fixed" ? "fixed" : "percentage";
    const dv = discountValue != null ? discountValue : Number(full.discountValue || 0);
    if (dt === "percentage" && (dv < 0 || dv > 100)) return { kind: "error", message: "O desconto em % precisa estar entre 0 e 100.", args };
    const disc = dt === "fixed" ? Math.min(Math.max(0, dv), sub) : Math.min(sub * (dv / 100), sub);
    const tax = Number(full.taxTotal || 0);
    const total = Math.max(0, round2(sub - disc + tax));

    const ops = {
      add_items: added,
      ...(discountValue != null ? { discount: { type: dt, value: dv } } : {}),
    };
    const exec = { quote_id: quote.id, label: quoteLabel(quote), ops, total, overrides, customer_id: customer.id };
    return {
      kind: "card",
      args: { ...args, quote_id: quote.id },
      card: {
        title: "Editar Quote " + quoteLabel(quote),
        subtitle: quoteStatusPt(quote.status),
        sections: [
          ...(rows.length ? [{ type: "table" as const, columns: ["Adicionar", "Qtd", "Preço", "Total"], rows, align: ["left", "right", "right", "right"] as Array<"left" | "right"> }] : []),
          {
            type: "totals",
            rows: [
              { label: "Total atual", value: money(Number(full.total)) },
              ...(discountValue != null
                ? [{ label: "Desconto", value: dt === "fixed" ? money(dv) : dv + "% (" + money(disc) + ")" }]
                : []),
              { label: "Novo total (estimado)", value: money(total), strong: true },
            ],
          },
          ...(overrides.length
            ? [{
                type: "note" as const,
                tone: "warning" as const,
                text: "Preço informado por você: " + overrides.map((o) => `${o.name} ${money(Number(o.unit_price))}`).join(", ") + ".",
              }]
            : []),
          { type: "note", text: "Abre o Quote no editor com a mudança aplicada; você revisa o imposto e salva." },
        ],
        confirm: { label: "Aplicar no Quote", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } } },
        open: builderLink(quote.id),
      },
    };
  },
  async execute(_ctx, exec) {
    if (exec.line_item_id) {
      const updated = await callInternalApi<{ data?: { quote_number?: string; line_name?: string; total?: number } }>(
        _ctx.req,
        "PATCH",
        `/api/quotes/${encodeURIComponent(String(exec.quote_id))}/line-items/${encodeURIComponent(String(exec.line_item_id))}`,
        { unit_price: exec.unit_price, quantity: exec.quantity, expected_unit_price: exec.before_price, expected_quantity: exec.before_quantity },
      );
      if (!updated.ok || !updated.json.data) return { ok: false, status: updated.status, error: internalError(updated, "Não foi possível atualizar essa linha do Quote.") };
      const d = updated.json.data;
      return {
        ok: true,
        title: `${d.line_name || exec.line_label} atualizado · Quote ${d.quote_number || exec.label}`,
        detail: `${Number(exec.quantity).toLocaleString("en-US")} ${exec.unit} × ${money(Number(exec.unit_price))}/${exec.unit} · novo total ${money(Number(d.total ?? exec.total))}`,
        links: [builderLink(String(exec.quote_id))],
        entity: { type: "quote", id: String(exec.quote_id) },
        memory: `Updated ${d.line_name || exec.line_label} on quote ${d.quote_number || exec.label}: ${money(Number(exec.before_price))} to ${money(Number(exec.unit_price))} per ${exec.unit}`,
        undo: { quote_id: exec.quote_id, line_item_id: exec.line_item_id, unit_price: exec.before_price, quantity: exec.before_quantity, expected_unit_price: exec.unit_price, expected_quantity: exec.quantity, label: exec.line_label, quote_label: exec.label, unit: exec.unit },
      };
    }
    // No server write: the Builder applies the change and the user saves it through the normal path.
    return {
      ok: true,
      title: "Abrindo o Quote " + exec.label + " com a mudança",
      detail: "Revise e salve no editor.",
      links: [builderLink(String(exec.quote_id))],
      client: {
        type: "quote_edit",
        quote_id: String(exec.quote_id),
        ops: (exec.ops || {}) as Record<string, unknown>,
        href: "quote-builder.html?id=" + encodeURIComponent(String(exec.quote_id)) + "&mate_edit=1",
      },
      entity: { type: "quote", id: String(exec.quote_id) },
      ...(Array.isArray(exec.overrides) && exec.overrides.length && exec.customer_id
        ? { next: { label: "Salvar preço", action: "pricing.set", args: { items: exec.overrides, customer_id: exec.customer_id, column: "customer" } } }
        : {}),
      memory: `Opened quote ${exec.label} in the editor with changes`,
    };
  },
  async undo(ctx, undo) {
    const res = await callInternalApi<{ data?: { quote_number?: string; line_name?: string; total?: number } }>(
      ctx.req,
      "PATCH",
      `/api/quotes/${encodeURIComponent(String(undo.quote_id))}/line-items/${encodeURIComponent(String(undo.line_item_id))}`,
      { unit_price: undo.unit_price, quantity: undo.quantity, expected_unit_price: undo.expected_unit_price, expected_quantity: undo.expected_quantity },
    );
    if (!res.ok || !res.json.data) return { ok: false, status: res.status, error: internalError(res, "Não foi possível desfazer essa alteração.") };
    return {
      ok: true,
      title: `Alteração desfeita · ${undo.label}`,
      detail: `Preço restaurado para ${money(Number(undo.unit_price))}/${undo.unit}`,
      links: [builderLink(String(undo.quote_id))],
      entity: { type: "quote", id: String(undo.quote_id) },
      memory: `Undid price update on ${undo.quote_label}`,
    };
  },
};

/* ───────────────────────── send ───────────────────────── */

export const sendQuote: ActionDef = {
  name: "quote.send",
  description: "Send a quote to the customer by e-mail, or get its link to send by text message (SMS) from the phone.",
  args: { quote: "quote number", customer: "customer name", channel: "email | sms | link", to: "e-mail address if the user said a different one" },
  examples: ["Manda o quote do John por e-mail", "Send quote 2041 by text", "Me dá o link do quote da Maria"],
  permissions: ["quotes.edit"],
  async prepare(ctx, args) {
    const q = await resolveQuote(ctx, args, { openOnly: true });
    if (q.status === "clarify") return { kind: "clarify", clarify: q.clarify, args };
    if (q.status === "missing") return { kind: "error", message: q.message, args };
    const quote = q.row;
    if (!(Number(quote.total) > 0)) {
      return {
        kind: "error",
        message: `O Quote ${quoteLabel(quote)} está vazio (${money(Number(quote.total))}) e não deve ir para o cliente. Abra no editor ou peça um Quote novo — ex.: “cria e envia um quote pro ${quote.customer?.name || "cliente"} com …”.`,
        args: { ...args, quote_id: quote.id },
      };
    }
    const channel = ["email", "sms", "link"].includes(str(args.channel)) ? str(args.channel) : "";
    const email = str(args.to, 200) || quote.customer?.email || quote.builder?.email || "";
    const phone = quote.customer?.phone || quote.builder?.phone || "";
    const who = quote.customer?.name || quote.builder?.company || quote.title;
    if (!channel) {
      return {
        kind: "clarify",
        args: { ...args, quote_id: quote.id },
        clarify: {
          question: `Como enviar o Quote ${quoteLabel(quote)}?`,
          options: [
            ...(email ? [{ label: "E-mail", detail: email, patch: { channel: "email" } }] : []),
            { label: "SMS pelo celular", detail: phone || "sem telefone no cadastro", patch: { channel: "sms" } },
            { label: "Só o link", patch: { channel: "link" } },
          ],
        },
      };
    }
    if (channel === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return {
        kind: "clarify",
        args: { ...args, quote_id: quote.id },
        clarify: { question: `${who} não tem e-mail no cadastro. Para qual e-mail enviar?`, options: [], search: { placeholder: "email@exemplo.com", path: "to" } },
      };
    }
    const exec = { quote_id: quote.id, label: quoteLabel(quote), channel, to: email, phone, who };
    return {
      kind: "card",
      args: { ...args, quote_id: quote.id },
      card: {
        title: (channel === "email" ? "Enviar por e-mail o Quote " : channel === "sms" ? "Enviar por SMS o Quote " : "Link do Quote ") + quoteLabel(quote),
        subtitle: who,
        badge: channel === "link" ? undefined : { text: "Vai para o cliente", tone: "warning" },
        sections: [
          {
            type: "fields",
            rows: [
              { label: "Total", value: money(Number(quote.total)) },
              { label: "Status", value: quoteStatusPt(quote.status) },
              ...(channel === "email" ? [{ label: "Para", value: email, edit: { path: "to", input: "text" as const, value: email } }] : []),
              ...(channel === "sms" ? [{ label: "Telefone", value: phone || "escolher no celular" }] : []),
            ],
          },
          {
            type: "note",
            text:
              channel === "email"
                ? "O cliente recebe o e-mail com o link para ver e aprovar. O Quote passa para “enviado”."
                : "Gero o link do Quote e abro o app de mensagens do seu celular com o texto pronto. O Quote passa para “enviado”.",
          },
        ],
        confirm: {
          label: channel === "email" ? "Enviar e-mail" : channel === "sms" ? "Gerar link e abrir SMS" : "Gerar link",
          tone: channel === "link" ? "normal" : "send",
          checkbox: channel === "email" ? "Enviar para " + email : undefined,
          exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign(exec) } },
        },
        open: builderLink(quote.id),
      },
    };
  },
  async execute(ctx, exec) {
    const id = encodeURIComponent(String(exec.quote_id));
    if (exec.channel === "email") {
      const res = await callInternalApi(ctx.req, "POST", `/api/quotes/${id}/send-email`, { to: exec.to });
      if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não foi possível enviar o e-mail.") };
      return {
        ok: true,
        title: "Quote " + exec.label + " enviado",
        detail: "Para " + exec.to,
        links: [builderLink(String(exec.quote_id))],
        entity: { type: "quote", id: String(exec.quote_id) },
        memory: `Sent quote ${exec.label} by e-mail to ${exec.to}`,
      };
    }
    const res = await callInternalApi<{ public_url?: string }>(ctx.req, "POST", `/api/quotes/${id}/publish-client`, { mark_sent: exec.channel !== "link" });
    const url = res.json.public_url;
    if (!res.ok || !url) return { ok: false, status: res.status, error: internalError(res, "Não foi possível gerar o link.") };
    const text = `Olá ${String(exec.who || "").split(" ")[0]}, segue o orçamento: ${url}`;
    const phone = String(exec.phone || "").replace(/[^\d+]/g, "");
    return {
      ok: true,
      title: exec.channel === "sms" ? "Link pronto para SMS" : "Link do Quote " + exec.label,
      detail: url,
      links: [
        ...(exec.channel === "sms" ? [{ label: "Abrir Mensagens", href: "sms:" + phone + "?&body=" + encodeURIComponent(text) }] : []),
        { label: "Abrir link", href: url },
      ],
      client: { type: "copy", text: url },
      entity: { type: "quote", id: String(exec.quote_id) },
      memory: `Shared quote ${exec.label} link`,
    };
  },
};
