/**
 * Job header — the one place that answers "who, where, when, who's on it, how's the money"
 * and gives the next step. Shared by the Jobs side panel and the job page.
 *
 * window.JobHeader = { html, bind, primary, noteParts, alerts, menu, whenSub, moneySummary, canEmit }
 *
 * ctx: { mode: "panel" | "page", canManage, canBill, canInvoice, can(perm), billing, invoices, field, photos }
 * handlers: { act(name, el), step(index), status(status) }
 */
(function () {
  const J = () => window.JobsInfo;

  const ICON = {
    phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/>',
    sms: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    cam: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 01-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1121 11.5z"/>',
    ticket: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9"/>',
    quote: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    cost: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

  const STATUS = {
    draft: ["Rascunho", ""],
    scheduled: ["Agendado", ""],
    in_progress: ["Em campo", "dk"],
    completed: ["Concluído", "ok"],
    canceled: ["Cancelado", "late"],
  };
  const SOURCE = { particular: "Particular", builder: "Builder", contractor: "Builder", loja: "Builder", internal: "Interno", other: "Outro" };

  const can = (ctx, perm) => (ctx.can ? ctx.can(perm) : true);
  const undated = (wo) => !wo.scheduled_start && !(wo.sector === "both" && wo.sand_scheduled_start);
  const num = (n) => Number(n) || 0;

  function billingOf(wo, ctx) {
    return ctx.canBill ? ctx.billing || wo.billing || null : null;
  }
  function invoicesOf(wo, ctx) {
    return (ctx.invoices || wo.invoices || []).filter((i) => i && i.id && i.status !== "void" && i.display_status !== "void");
  }
  function canEmit(wo, ctx) {
    const b = billingOf(wo, ctx);
    return Boolean(ctx.canInvoice && b && wo.status !== "canceled" && num(b.remaining_to_invoice) > 0.004 && b.billing_status !== "no_value");
  }
  function openInvoice(wo, ctx) {
    return invoicesOf(wo, ctx).find((i) => !["paid", "draft"].includes(i.display_status || i.status));
  }

  /** One obvious next step, depending on where the job is. */
  function primary(wo, ctx) {
    if (wo.status === "canceled") return null;
    if (ctx.canManage) {
      if (undated(wo) && wo.status !== "completed") return { label: "Schedule Job", act: "edit" };
      if (!(wo.line_items || []).length) return { label: "Adicionar serviços", act: "services" };
      if (wo.status === "draft" || wo.status === "scheduled") return { label: "Iniciar job", act: "start" };
      if (wo.status === "in_progress") {
        const nxt = J().nextFinish?.(wo);
        return { label: nxt ? nxt.label : "Concluir job", act: "complete" };
      }
    }
    if (wo.status === "completed") {
      if (canEmit(wo, ctx)) return { label: "Emitir Invoice", act: "invoice" };
      const open = ctx.canInvoice ? openInvoice(wo, ctx) : null;
      if (open) return { label: "Registrar pagamento", href: `invoices.html?id=${encodeURIComponent(open.id)}` };
    }
    return null;
  }

  /** Lockbox code and the rest of the note, so the code is never shown twice. */
  function noteParts(notes) {
    const raw = String(notes || "").trim();
    const code = typeof window.parseJobLockbox === "function"
      ? window.parseJobLockbox(raw)
      : (raw.match(/\/lockbox\s*[#:]?\s*([0-9A-Za-z-]{2,24})\b/i) || [])[1] || null;
    let text = raw.replace(/\/lockbox\s*[#:]?\s*[0-9A-Za-z-]{2,24}\b\s*[—–.-]?\s*/i, "").trim();
    if (code && text) text = text.charAt(0).toUpperCase() + text.slice(1);
    return { code, text };
  }

  // ---------------------------------------------------------------- identity
  function chips(wo) {
    const { esc } = J();
    const [label, tone] = STATUS[wo.status] || [wo.status, ""];
    const text = wo.status === "in_progress" && J().stageLabel ? J().stageLabel(wo) : label;
    const sector = wo.status !== "in_progress" && (wo.sector === "installation" ? "Instalação" : wo.sector === "sand_finish" ? "Lixa" : "");
    return `<span class="jh-pill${tone ? ` jh-pill--${tone}` : ""}">${esc(text)}</span>${sector ? `<span class="jh-pill">${esc(sector)}</span>` : ""}${
      wo.number != null ? `<span class="jh-num">Job #${esc(wo.number)}</span>` : ""
    }`;
  }

  function actions(wo, ctx) {
    const { esc } = J();
    const p = primary(wo, ctx);
    const edit = ctx.canManage && p?.act !== "edit"
      ? `<button type="button" class="jh-btn" data-jh-act="edit">${svg("edit")}<span>Editar</span></button>`
      : "";
    const main = !p
      ? ""
      : p.href
        ? `<a class="jh-btn jh-btn--pri" href="${esc(p.href)}">${esc(p.label)}</a>`
        : `<button type="button" class="jh-btn jh-btn--pri" data-jh-act="${esc(p.act)}">${esc(p.label)}</button>`;
    return `${edit}${main}${menu(wo, ctx)}`;
  }

  /** The ⋯ menu. `leading` lets a screen add its own items on top. */
  function menu(wo, ctx, leading) {
    const { esc } = J();
    const pageLink = ctx.mode === "panel" ? `<a role="menuitem" href="job-detail.html?id=${encodeURIComponent(wo.id)}">Abrir página do job</a>` : "";
    const lixa = ctx.canManage && wo.sector === "installation" && wo.status !== "canceled"
      ? `<button type="button" role="menuitem" data-jh-act="lixa">Agendar Lixa</button>`
      : "";
    const statusItems = ctx.canManage
      ? `<button type="button" role="menuitem" data-jh-menu-status aria-expanded="false">Mudar status…</button>
         <div class="jh-menu__sub" data-jh-status-list hidden>${Object.entries(STATUS)
           .map(([k, [l]]) => `<button type="button" role="menuitemradio" aria-checked="${k === wo.status}" data-jh-status="${k}">${esc(l)}${k === wo.status ? " ✓" : ""}</button>`)
           .join("")}</div>`
      : "";
    const del = ctx.canManage && wo.status !== "canceled"
      ? `<button type="button" role="menuitem" class="is-danger" data-jh-act="delete">Excluir job</button>`
      : "";
    return leading || pageLink || lixa || statusItems || del
      ? `<div class="jh-menu">
          <button type="button" class="jh-btn jh-btn--icon" data-jh-more aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações">⋯</button>
          <div class="jh-menu__list" data-jh-menu role="menu" hidden>${leading || ""}${pageLink}${lixa}${statusItems}${del}</div>
        </div>`
      : "";
  }

  // ---------------------------------------------------------------- progress
  function steps(wo, ctx) {
    const { esc, money0 } = J();
    const b = billingOf(wo, ctx);
    const done = wo.status === "completed";
    const inField = wo.status === "in_progress";
    const list = [
      {
        label: "Agendado",
        sub: undated(wo) ? "sem data" : "",
        state: done || inField ? "ok" : "cur",
      },
      {
        label: "Em campo",
        sub: (() => {
          const p = J().sectorProgress?.(wo);
          if (p?.both && inField) {
            if (!p.installation) return "Instalação em aberto";
            if (!p.sand) return "Instalação feita · falta a lixa";
          }
          if (inField) return "em andamento";
          const hours = ctx.field?.hours?.total;
          return hours ? `${Number(hours).toLocaleString("en-US", { maximumFractionDigits: 2 })} h registradas` : "";
        })(),
        split: J().fieldHalves?.(wo) || null,
        state: done ? "ok" : inField ? "cur" : "",
      },
      { label: "Concluído", sub: "", state: done ? "ok" : "" },
    ];
    if (b) {
      const fully = num(b.services_total) > 0 && num(b.remaining_to_invoice) <= 0.004;
      list.push({
        label: "Faturado",
        sub: num(b.invoiced_total) > 0 ? money0(b.invoiced_total) : "",
        state: fully ? "ok" : num(b.invoiced_total) > 0 || done ? "cur" : "",
      });
      list.push({
        label: "Pago",
        sub: b.billing_status === "paid" ? money0(b.paid_total) : num(b.open_balance) > 0 ? `falta ${money0(b.open_balance)}` : "",
        state: b.billing_status === "paid" ? "ok" : num(b.open_balance) > 0 ? "cur" : "",
      });
    }
    // Only the first unfinished step is "current".
    let seen = false;
    list.forEach((s) => {
      if (s.state === "cur") {
        if (seen) s.state = "";
        seen = true;
      }
    });
    const nxt = J().nextFinish?.(wo);
    return `<ol class="jh-steps" aria-label="Andamento do job">${list
      .map((s, i) => {
        const st = J().statusForStep?.(i);
        const clickable = ctx.canManage && (st || (i === 3 && ctx.canBill));
        const tip = st ? (i === 1 && nxt ? nxt.label : `Mover para ${s.label}`) : i === 3 ? "Faturar" : s.label;
        const half = (k) => (s.state === "ok" || s.split[k] === "d" ? "is-ok" : s.split[k] === "n" ? "is-cur" : "");
        const bar = s.split
          ? `<i class="jh-step__bar is-split"><b class="${half("inst")}"></b><b class="${half("sand")}"></b></i>`
          : `<i class="jh-step__bar"></i>`;
        const inner = `${bar}<span>${esc(s.label)}</span>${s.sub ? `<small>${esc(s.sub)}</small>` : ""}`;
        const cur = s.state === "cur" ? ' aria-current="step"' : "";
        return `<li class="jh-step${s.state ? ` is-${s.state}` : ""}"${cur}>${
          clickable ? `<button type="button" data-jh-step="${i}" title="${esc(tip)}">${inner}</button>` : `<div>${inner}</div>`
        }</li>`;
      })
      .join("")}</ol>`;
  }

  /** What's wrong right now: late / canceled, with the fix next to it. */
  function statusLine(wo, ctx) {
    const { esc } = J();
    if (wo.status === "canceled") {
      return `<p class="jh-line" role="status"><span>Este job está cancelado e não aparece na busca.</span>${
        ctx.canManage ? `<button type="button" class="jh-line__act" data-jh-act="reopen">Reabrir job</button>` : ""
      }</p>`;
    }
    const lt = J().late?.(wo);
    if (!lt) return "";
    const d = `${lt.days} dia${lt.days > 1 ? "s" : ""}`;
    const text = wo.status === "in_progress" ? `Passou do término há ${d}` : `Não iniciado, ${d} depois da data`;
    const acts = ctx.canManage
      ? `<button type="button" class="jh-line__act" data-jh-act="schedule">Remarcar</button>${
          wo.status !== "in_progress" ? `<button type="button" class="jh-line__act" data-jh-act="complete">Já concluído</button>` : ""
        }`
      : "";
    return `<p class="jh-line" role="status"><span class="jh-line__dot" aria-hidden="true"></span><span>${esc(text)}</span>${acts}</p>`;
  }

  /** Field problem, attention and delivery stay in view on every tab. */
  function alerts(wo, ctx) {
    const { esc } = J();
    const problem = String(ctx.field?.problem_note || "").trim();
    const att = String(wo.campo_attention || "").trim();
    const rows = [];
    if (problem) rows.push(`<li class="is-problem"><b>Problema no campo</b><span>${esc(problem)}</span></li>`);
    if (att) rows.push(`<li><b>Atenção para o campo</b><span>${esc(att)}</span></li>`);
    if (wo.needs_delivery) {
      const f = wo.delivery_attachment;
      const pickup = wo.delivery_pickup_address
        ? `<a href="https://maps.google.com/?q=${encodeURIComponent(wo.delivery_pickup_address)}" target="_blank" rel="noopener">${esc(wo.delivery_pickup_address)}</a>`
        : "Retirar material da obra";
      const share = ctx.canManage && ctx.mode === "page" && ctx.partnerPortal && f?.key
        ? `<button type="button" class="jh-line__act" data-delivery-share data-on="${f.shared_with_partners ? "1" : "0"}" aria-pressed="${f.shared_with_partners ? "true" : "false"}">${f.shared_with_partners ? "Remover do portal do parceiro" : "Compartilhar com parceiro"}</button>`
        : "";
      rows.push(`<li><b>Entrega</b><span>${pickup}${wo.delivery_notes ? ` · ${esc(wo.delivery_notes)}` : ""}${
        f?.url ? ` · <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name || "Anexo")}</a>` : ""
      }${share ? ` ${share}` : ""}</span></li>`);
    }
    return rows.length ? `<ul class="jh-alerts">${rows.join("")}</ul>` : "";
  }

  // ---------------------------------------------------------------- facts
  function fact(label, action, body) {
    return `<div class="jh-fact"><div class="jh-fact__k"><span>${label}</span>${action || ""}</div>${body}</div>`;
  }
  const factBtn = (act, text) => `<button type="button" class="jh-link" data-jh-act="${act}">${text}</button>`;

  function clientFact(wo, ctx) {
    const { esc } = J();
    const c = wo.customer;
    const name = J().client(wo);
    const nameHtml = wo.customer_id && can(ctx, "customers.view")
      ? `<a class="jh-fact__v jh-fact__v--2" href="customers.html?id=${encodeURIComponent(wo.customer_id)}">${esc(name)}</a>`
      : `<b class="jh-fact__v jh-fact__v--2">${esc(name)}</b>`;
    const tel = c?.phone ? String(c.phone).replace(/[^\d+]/g, "") : "";
    const phone = c?.phone ? (typeof window.sfFormatPhone === "function" ? window.sfFormatPhone(c.phone) || c.phone : c.phone) : "";
    const icons = [
      tel ? `<a class="jh-ico" href="tel:${esc(tel)}" aria-label="Ligar para ${esc(name)}" title="Ligar">${svg("phone")}</a>` : "",
      tel ? `<a class="jh-ico" href="sms:${esc(tel)}" aria-label="Mandar SMS para ${esc(name)}" title="SMS">${svg("sms")}</a>` : "",
      c?.email ? `<a class="jh-ico" href="mailto:${esc(c.email)}" aria-label="Mandar e-mail para ${esc(name)}" title="E-mail">${svg("mail")}</a>` : "",
    ].join("");
    const homeowner = String(wo.homeowner_name || "").trim();
    const homeTel = wo.homeowner_phone ? String(wo.homeowner_phone).replace(/[^\d+]/g, "") : "";
    const sub = [
      phone ? `<a href="tel:${esc(tel)}">${esc(phone)}</a>` : c?.email ? esc(c.email) : `<span class="jh-mu">Sem contato</span>`,
      homeowner ? `Morador: ${homeTel ? `<a href="tel:${esc(homeTel)}">${esc(homeowner)}</a>` : esc(homeowner)}` : "",
    ].filter(Boolean).join(" · ");
    return fact("Cliente", icons ? `<span class="jh-icos">${icons}</span>` : "", `${nameHtml}<span class="jh-fact__s">${sub}</span>`);
  }

  function siteFact(wo) {
    const { esc } = J();
    const { code } = noteParts(wo.notes);
    const lock = code ? `<span class="jh-lock" title="Código da caixa (lockbox)">${svg("lock")}${esc(code)}</span>` : "";
    if (!wo.address) return fact("Obra", "", `<b class="jh-fact__v jh-mu">Sem endereço</b>${lock}`);
    const maps = `https://maps.google.com/?q=${encodeURIComponent(wo.address)}`;
    return fact(
      "Obra",
      `<a class="jh-link" href="${esc(maps)}" target="_blank" rel="noopener">Mapa</a>`,
      `<a class="jh-fact__v jh-fact__v--2" href="${esc(maps)}" target="_blank" rel="noopener" title="${esc(wo.address)}">${esc(wo.address)}</a>${lock}`,
    );
  }

  /** Second line of the schedule: until when, or the hours. */
  function whenSub(wo) {
    if (undated(wo)) return "Ainda não agendado";
    if (wo.status === "completed") return `Concluído: ${J().completeLabel?.(wo) || "—"}`;
    const start = wo.scheduled_start ? new Date(wo.scheduled_start) : null;
    const end = wo.scheduled_end ? new Date(wo.scheduled_end) : null;
    const until = start && end && start.toDateString() !== end.toDateString()
      ? `até ${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][end.getDay()]} ${end.getDate()} ${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][end.getMonth()]}`
      : "";
    const t = (x) => x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const hours = !start || wo.all_day ? "Dia inteiro" : end && !until ? `${t(start)} – ${t(end)}` : t(start);
    return [until, until && hours === "Dia inteiro" ? "" : hours].filter(Boolean).join(" · ");
  }

  function whenFact(wo, ctx) {
    const { esc } = J();
    const none = undated(wo);
    const iso = wo.scheduled_start || wo.sand_scheduled_start;
    const href = iso ? `schedule.html?focus=${encodeURIComponent(iso)}&event=${encodeURIComponent(wo.id)}` : "schedule.html";
    const sub = whenSub(wo);
    const act = ctx.canManage && wo.status !== "completed" && wo.status !== "canceled" ? factBtn("schedule", none ? "Agendar" : "Remarcar") : "";
    const main = can(ctx, "schedule.view") && !none
      ? `<a class="jh-fact__v jh-fact__v--2" href="${esc(href)}" title="Ver na agenda">${esc(J().dateRange(wo))}</a>`
      : `<b class="jh-fact__v jh-fact__v--2${none ? " jh-mu" : ""}">${esc(none ? "Sem data" : J().dateRange(wo))}</b>`;
    return fact("Agenda", act, `${main}<span class="jh-fact__s">${esc(sub)}</span>`);
  }

  function teamFact(wo, ctx) {
    const { esc } = J();
    const team = J().team(wo);
    const first = wo.assigned_user?.name || team[0]?.name || "";
    const others = Math.max(0, team.length - (first ? 1 : 0));
    const sub = !team.length
      ? ""
      : others
        ? `+ ${team.filter((t) => t.name !== first).map((t) => t.name.split(" ")[0]).slice(0, 3).join(", ")}${others > 3 ? ` e mais ${others - 3}` : ""}`
        : wo.assigned_user ? "Responsável" : "";
    return fact(
      "Equipe",
      ctx.canManage ? factBtn("team", "Gerir") : "",
      `<b class="jh-fact__v jh-fact__v--2${first ? "" : " jh-mu"}">${esc(first || "Ninguém escalado")}</b>${sub ? `<span class="jh-fact__s">${esc(sub)}</span>` : ""}`,
    );
  }

  /** What to say about the money now: what's left to receive or invoice, and the totals. */
  function moneySummary(b) {
    const { money0 } = J();
    const total = num(b.services_total);
    const paid = num(b.paid_total);
    const open = num(b.open_balance);
    const head =
      b.billing_status === "paid"
        ? { k: "Recebido", v: paid }
        : open > 0.004
          ? { k: "A receber", v: open }
          : { k: "A faturar", v: num(b.remaining_to_invoice) };
    const paidPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
    const openPct = total > 0 ? Math.min(100 - paidPct, (open / total) * 100) : 0;
    return { head, total, paid, paidPct, openPct, parts: [`Total ${money0(total)}`, `Faturado ${money0(b.invoiced_total)}`, `Recebido ${money0(paid)}`] };
  }

  function moneyFact(wo, ctx) {
    const b = billingOf(wo, ctx);
    const { esc, money0 } = J();
    if (!b) {
      if (ctx.canBill === false && (wo.services_total == null)) return "";
      return ctx.canBill ? "" : fact("Total do job", "", `<b class="jh-fact__v">${esc(money0(wo.services_total))}</b>`);
    }
    const { head, total, paid, paidPct, openPct, parts } = moneySummary(b);
    const invs = invoicesOf(wo, ctx);
    const isPrimary = primary(wo, ctx)?.act === "invoice";
    let act = "";
    if (canEmit(wo, ctx) && !isPrimary) act = factBtn("invoice", "Emitir Invoice");
    else if (invs.length === 1) act = `<a class="jh-link" href="invoices.html?id=${encodeURIComponent(invs[0].id)}">Ver invoice</a>`;
    else if (invs.length > 1) act = `<a class="jh-link" href="invoices.html?q=${encodeURIComponent(wo.number != null ? `Job #${wo.number}` : wo.title || "")}">Faturas (${invs.length})</a>`;
    return fact(
      head.k,
      act,
      `<b class="jh-fact__v jh-fact__v--money">${esc(money0(head.v))}</b>${
        total > 0
          ? `<span class="jh-bar" role="img" aria-label="${esc(`Recebido ${money0(paid)} de ${money0(total)}`)}"><i class="p" style="width:${paidPct.toFixed(1)}%"></i><i class="o" style="width:${openPct.toFixed(1)}%"></i></span>`
          : ""
      }<span class="jh-fact__s">${esc(parts.join(" · "))}</span>`,
    );
  }

  // ---------------------------------------------------------------- other modules
  function modules(wo, ctx) {
    const { esc } = J();
    const id = encodeURIComponent(wo.id);
    const items = [];
    if (can(ctx, "work_orders.view")) {
      items.push(`<a class="jh-mod" href="job-media-board.html?id=${id}">${svg("cam")}<span>ObraCam</span>${ctx.photos ? `<em>${esc(ctx.photos)}</em>` : ""}</a>`);
    }
    if (can(ctx, "chat.use")) {
      items.push(`<button type="button" class="jh-mod" data-jh-act="chat">${svg("chat")}<span>ObraChat</span></button>`);
    }
    items.push(`<a class="jh-mod" href="/campo/ticket.html?id=${id}" target="_blank" rel="noopener">${svg("ticket")}<span>Ticket da equipe</span></a>`);
    if (wo.quote_id && can(ctx, "quotes.view")) {
      items.push(`<a class="jh-mod" href="quote-builder.html?id=${encodeURIComponent(wo.quote_id)}">${svg("quote")}<span>Orçamento${wo.quote_number ? ` ${esc(wo.quote_number)}` : ""}</span></a>`);
    }
    if (can(ctx, "finance.manage")) {
      items.push(`<a class="jh-mod" href="finance.html?new=cost&job=${id}">${svg("cost")}<span>Lançar custo</span></a>`);
    }
    return `<nav class="jh-mods" aria-label="Este job em outros módulos">${items.join("")}</nav>`;
  }

  function subtitle(wo, head) {
    const { esc } = J();
    const bits = [];
    if (wo.title && wo.title !== head) bits.push(`<span>${esc(wo.title)}</span>`);
    if (SOURCE[wo.source_type]) bits.push(`<span>${esc(SOURCE[wo.source_type])}</span>`);
    if (wo.related_work_order) {
      bits.push(`<a href="job-detail.html?id=${encodeURIComponent(wo.related_work_order.id)}">Ligado a #${esc(wo.related_work_order.number != null ? wo.related_work_order.number : "—")}</a>`);
    }
    return bits.length ? `<p class="jh-sub">${bits.join('<i aria-hidden="true">·</i>')}</p>` : "";
  }

  function html(wo, ctx) {
    const who = J().client(wo);
    const head = who && who !== "Sem cliente" ? who : wo.title || "Job";
    const tag = ctx.mode === "page" ? "h1" : "h2";
    const alertRows = alerts(wo, ctx);
    return `<header class="jh">
      <div class="jh__band jh__head">
        <div class="jh__top">
          <div class="jh__id">
            <div class="jh__chips">${chips(wo)}</div>
            <${tag} class="jh__title">${J().esc(head)}</${tag}>
            ${subtitle(wo, head)}
          </div>
          <div class="jh__acts">${actions(wo, ctx)}</div>
        </div>
        ${statusLine(wo, ctx)}
      </div>
      ${wo.status !== "canceled" ? `<div class="jh__band jh__progress">${steps(wo, ctx)}</div>` : ""}
      ${alertRows ? `<div class="jh__band jh__notice">${alertRows}</div>` : ""}
      <div class="jh__columns"><div class="jh-facts">${clientFact(wo, ctx)}${siteFact(wo)}${whenFact(wo, ctx)}${teamFact(wo, ctx)}${moneyFact(wo, ctx)}</div></div>
      <div class="jh__band jh__foot">${modules(wo, ctx)}</div>
    </header>`;
  }

  // ---------------------------------------------------------------- behaviour
  let docBound = false;
  function closeMenus(except) {
    document.querySelectorAll("[data-jh-menu]").forEach((m) => {
      if (m === except) return;
      m.hidden = true;
      m.parentElement?.querySelector("[data-jh-more]")?.setAttribute("aria-expanded", "false");
      const list = m.querySelector("[data-jh-status-list]");
      if (list) list.hidden = true;
    });
  }

  /** Event delegation on a host that survives re-renders. */
  function bind(root, handlers) {
    if (!docBound) {
      docBound = true;
      document.addEventListener("click", (e) => {
        if (!e.target.closest?.(".jh-menu")) closeMenus();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const open = document.querySelector("[data-jh-menu]:not([hidden])");
        if (!open) return;
        closeMenus();
        open.parentElement?.querySelector("[data-jh-more]")?.focus();
      });
    }
    root.addEventListener("click", async (e) => {
      const t = e.target;
      const more = t.closest("[data-jh-more]");
      if (more) {
        const menu = more.parentElement.querySelector("[data-jh-menu]");
        const open = menu.hidden;
        closeMenus();
        menu.hidden = !open;
        more.setAttribute("aria-expanded", open ? "true" : "false");
        return;
      }
      const statusToggle = t.closest("[data-jh-menu-status]");
      if (statusToggle) {
        const list = statusToggle.parentElement.querySelector("[data-jh-status-list]");
        list.hidden = !list.hidden;
        statusToggle.setAttribute("aria-expanded", list.hidden ? "false" : "true");
        return;
      }
      const st = t.closest("[data-jh-status]");
      if (st) {
        closeMenus();
        handlers.status?.(st.getAttribute("data-jh-status"));
        return;
      }
      const step = t.closest("[data-jh-step]");
      if (step) {
        handlers.step?.(Number(step.getAttribute("data-jh-step")));
        return;
      }
      const act = t.closest("[data-jh-act]");
      if (!act) return;
      closeMenus();
      const name = act.getAttribute("data-jh-act");
      // Immediate feedback and no double submit while the action runs.
      act.disabled = true;
      act.setAttribute("aria-busy", "true");
      try {
        await handlers.act?.(name, act);
      } finally {
        if (act.isConnected) {
          act.disabled = false;
          act.removeAttribute("aria-busy");
        }
      }
    });
  }

  window.JobHeader = { html, bind, primary, noteParts, alerts, menu, whenSub, moneySummary, canEmit };
})();
