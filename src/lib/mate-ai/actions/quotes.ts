import { normalizeMateAiUnit, resolveCustomerUnitPrice } from "../command.js";
import { normalizeQuoteStatus } from "../../quotes/transitions.js";
import { callInternalApi, internalError } from "../internal-api.js";
import { builderUnit, loadMateAiCatalog, pickService } from "./catalog.js";
import { quoteLabel, quoteStatusPt, resolveQuote } from "./resolve.js";
import type { ActionDef, Clarify } from "./types.js";
import { money, num, str, unitLabel } from "./types.js";

function builderLink(id: string) {
  return { label: "Abrir no editor", href: "quote-builder.html?id=" + encodeURIComponent(id) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ───────────────────────── edit (add lines / discount) ───────────────────────── */

export const editQuote: ActionDef = {
  name: "quote.edit",
  description:
    "Change an existing open quote: add service lines and/or set a discount. The change is applied inside the Quote Builder for review and save.",
  args: {
    quote: "quote number, or empty to use the customer's open quote / current screen",
    customer: "customer name when the quote is identified by customer",
    items: "lines to add: [{service_ref, service_text, quantity, unit, unit_price?}] like quote.create; unit_price when the user states the price",
    discount_type: "percent | fixed (optional)",
    discount_value: "number (optional): 10 for 10% or 500 for $500",
  },
  examples: ["Adiciona 14 degraus no quote do John", "Dá 10% de desconto no quote 2041", "Add 200 linear feet of baseboard to quote Q-2041"],
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
        customer: { select: { id: true, name: true, customerType: true, pricingMode: true, customPricingRates: true } },
      },
    });
    if (!full) return { kind: "error", message: "Quote não encontrado.", args };
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
