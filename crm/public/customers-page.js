/**
 * Clientes — lista ao lado + página do cliente (computador, iPad e iPhone) e popups
 * (novo/editar, preços deste cliente, duplicados).
 * Dados: /api/customers/overview e /api/customers/:id/overview (números já calculados no servidor).
 */
(function () {
  "use strict";

  const S = window.omLeadSignals || {};
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const TYPE_PT = { particular: "Particular", builder: "Builder", loja: "Loja" };
  const DAY = 86400000;

  let rows = [];
  let summary = null;
  let showMoney = true;
  let filter = "all";
  let q = "";
  let selectedId = null;
  let detail = null;
  let expanded = {};
  let canCreate = false;
  let canEdit = false;
  let pricingCache = null;
  let form = { type: "particular", pricing: "table", rates: {} };
  let priceDraft = {};

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- utils
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else if (window.crmToast && window.crmToast[type || "info"]) window.crmToast[type || "info"](msg);
    else alert(msg);
  }
  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const err = new Error(j.error || `HTTP ${r.status}`);
      err.status = r.status;
      err.body = j;
      throw err;
    }
    return j;
  }
  function money(n, cents) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    const c = cents && Math.round(v * 100) % 100 !== 0;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: c ? 2 : 0, maximumFractionDigits: c ? 2 : 0 });
  }
  function shortMoney(n) {
    const v = Number(n) || 0;
    if (v >= 100000) return "$" + Math.round(v / 1000) + "k";
    if (v >= 1000) return "$" + (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return money(v);
  }
  function initials(name) {
    if (S.initials) return S.initials(name);
    const p = String(name || "").trim().split(/\s+/).filter(Boolean);
    return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() : "?";
  }
  function dayDiff(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return null;
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const n = new Date();
    const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    return Math.round((a - b) / DAY);
  }
  function dm(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return "";
    return `${d.getDate()} ${MO[d.getMonth()]}`;
  }
  function ago(iso) {
    const d = dayDiff(iso);
    if (d == null) return "";
    if (d === 0) return "hoje";
    if (d === -1) return "ontem";
    if (d < 0 && d > -7) return `há ${-d} dias`;
    return dm(iso);
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }
  function isOrg(t) {
    return t === "builder" || t === "loja";
  }
  function phoneDigits(p) {
    let d = String(p || "").replace(/\D/g, "");
    if (d.length === 10) d = "1" + d;
    return d;
  }
  function maskPhone(raw) {
    if (typeof window.sfMaskPhoneInput === "function") return window.sfMaskPhoneInput(raw);
    const d = String(raw || "").replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
    if (!d) return "";
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  function single() {
    return window.matchMedia("(max-width: 1024px)").matches;
  }
  function phone() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  const ICO = {
    phone:
      '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.8.4 1.6.7 2.3a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.7-1.7a2 2 0 0 1 2.1-.5c.7.3 1.5.6 2.3.7a2 2 0 0 1 1.7 2z"/>',
    sms: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    job: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    dollar: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    funnel: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  };
  function ic(name, size, w) {
    return `<svg viewBox="0 0 24 24" width="${size || 15}" height="${size || 15}" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[name] || ""}</svg>`;
  }
  function av(c, cls) {
    return `<span class="cx-av${isOrg(c.customer_type) ? " cx-av--sq" : ""}${cls ? " " + cls : ""}" aria-hidden="true">${esc(initials(c.name))}</span>`;
  }

  // ---------------------------------------------------------------- list
  function st(c) {
    return c.stats || {};
  }
  function matches(c) {
    const s = st(c);
    if (filter === "balance" && !(Number(s.open_balance) > 0.004)) return false;
    if (filter !== "all" && filter !== "balance" && c.customer_type !== filter) return false;
    if (q) {
      const hay = [c.name, c.email, c.phone, c.address, c.responsible_name, c.company].filter(Boolean).join(" ").toLowerCase();
      const digits = q.replace(/\D/g, "");
      if (!hay.includes(q) && !(digits.length >= 3 && String(c.phone || "").replace(/\D/g, "").includes(digits))) return false;
    }
    return true;
  }

  function renderSummary() {
    if (!summary) return;
    $("cxSumCount").textContent = String(summary.count);
    $("cxSumActive").textContent = String(summary.with_active_job);
    document.querySelectorAll(".cx-sum [data-money]").forEach((el) => (el.hidden = !showMoney));
    if (showMoney) {
      const p = phone();
      $("cxSumOpen").textContent = p ? shortMoney(summary.open_balance) : money(summary.open_balance);
      const od = $("cxSumOverdue");
      od.textContent = p ? shortMoney(summary.overdue_balance) : money(summary.overdue_balance);
      od.classList.toggle("is-hot", Number(summary.overdue_balance) > 0.004);
      $("cxSumQuotes").textContent = money(summary.quotes_open_value);
    }
  }

  function renderChips() {
    const by = (summary && summary.by_type) || {};
    const items = [
      ["all", "Todos", rows.length],
      ["particular", "Particular", (by.particular || {}).count || 0],
      ["builder", "Builder", (by.builder || {}).count || 0],
      ["loja", "Loja", (by.loja || {}).count || 0],
    ];
    if (showMoney) items.push(["balance", "Com saldo", summary ? summary.with_balance : 0]);
    $("cxChips").innerHTML = items
      .map(([k, l, n]) => `<button type="button" class="cx-chip${filter === k ? " is-on" : ""}" data-filter="${k}" aria-pressed="${filter === k}">${l}<em>${n}</em></button>`)
      .join("");
  }

  function rowHtml(c) {
    const s = st(c);
    const bal = Number(s.open_balance) || 0;
    const right = showMoney && bal > 0.004 ? money(bal) : "";
    const meta = [TYPE_PT[c.customer_type] || "Particular"];
    if (c.city) meta.push(c.city);
    if (s.jobs_active) meta.push(plural(s.jobs_active, "job ativo", "jobs ativos"));
    let sub2 = "";
    let hot = false;
    if (showMoney && Number(s.overdue_balance) > 0.004) {
      sub2 = `vencido ${plural(s.overdue_days || 1, "dia", "dias")}`;
      hot = true;
    } else if (s.last_activity_at) {
      sub2 = ago(s.last_activity_at);
    }
    const on = String(c.id) === String(selectedId);
    return `<a class="cx-row${on ? " is-on" : ""}" role="listitem" href="customers.html?id=${encodeURIComponent(c.id)}" data-id="${esc(c.id)}">
      ${av(c)}
      <span class="cx-row__b">
        <span class="cx-row__l1"><b>${esc(c.name || "Sem nome")}</b>${right ? `<em>${right}</em>` : ""}</span>
        <span class="cx-row__l2"><span>${esc(meta.join(" · "))}</span>${sub2 ? `<em class="${hot ? "is-hot" : ""}">${esc(sub2)}</em>` : ""}</span>
      </span>
    </a>`;
  }

  function renderList() {
    const host = $("cxRows");
    const list = rows.filter(matches);
    if (!list.length) {
      host.innerHTML = `<p class="cx-empty">${rows.length ? "Nenhum cliente encontrado." : "Nenhum cliente ainda. Cadastre o primeiro em “Novo cliente”."}</p>`;
      return;
    }
    const withBal = showMoney ? list.filter((c) => Number(st(c).open_balance) > 0.004) : [];
    const rest = list.filter((c) => !withBal.includes(c));
    withBal.sort((a, b) => (Number(st(b).overdue_balance) || 0) - (Number(st(a).overdue_balance) || 0) || (Number(st(b).open_balance) || 0) - (Number(st(a).open_balance) || 0));
    rest.sort((a, b) => new Date(st(b).last_activity_at || b.created_at || 0) - new Date(st(a).last_activity_at || a.created_at || 0));
    let html = "";
    if (withBal.length) html += `<p class="cx-grp">Com saldo</p>` + withBal.map(rowHtml).join("");
    if (rest.length) html += (withBal.length ? `<p class="cx-grp">Atividade recente</p>` : "") + rest.map(rowHtml).join("");
    host.innerHTML = html;
  }

  function firstVisibleId() {
    const el = $("cxRows").querySelector(".cx-row");
    return el ? el.getAttribute("data-id") : null;
  }

  async function loadList() {
    const j = await api("/api/customers/overview");
    rows = j.data || [];
    summary = j.summary || null;
    showMoney = j.show_money !== false;
    renderSummary();
    renderChips();
    renderList();
  }

  // ---------------------------------------------------------------- detail
  const JOB_TONE = { in_progress: "or", scheduled: "dk", completed: "ol", draft: "mu", canceled: "mu" };
  function quoteStatus(qt) {
    const s = String(qt.status || "draft");
    if (s === "changes_requested") return ["late", "Pediu alterações"];
    if (s === "approved" || s === "accepted" || s === "converted" || s === "invoiced") return ["ol", "Aprovado"];
    if (s === "archived" || s === "rejected") return ["mu", "Arquivado"];
    if (s === "draft") return ["mu", "Rascunho"];
    if (s === "expired" || (qt.valid_until && new Date(qt.valid_until).getTime() < Date.now())) return ["mu", "Expirado"];
    if (s === "viewed" || qt.viewed_at) return ["or", "Visto"];
    return ["dk", "Enviado"];
  }
  function pill(tone, label) {
    return `<span class="cx-pill cx-pill--${tone}"><i></i>${esc(label)}</span>`;
  }

  function boxList(key, title, items, render, action, emptyText) {
    const limit = 5;
    const open = !!expanded[key];
    const shown = open ? items : items.slice(0, limit);
    const more = items.length > limit ? `<button type="button" class="cx-more" data-expand="${key}">${open ? "Mostrar menos" : `Ver todos (${items.length})`}</button>` : "";
    return `<section class="cx-box"><h3>${title}${items.length ? ` · ${items.length}` : ""}${action || ""}</h3>
      ${items.length ? shown.map(render).join("") : `<p class="cx-none">${emptyText}</p>`}${more}</section>`;
  }

  function jobLine(j) {
    let sub = j.number != null ? `#${j.number}` : "";
    if (j.status === "scheduled" && j.scheduled_start) sub += ` · ${dm(j.scheduled_start)}`;
    else if (j.status === "completed") sub += ` · concluído ${dm(j.updated_at)}`;
    else if (j.address) sub += ` · ${j.address}`;
    return `<a class="cx-li" href="job-detail.html?id=${encodeURIComponent(j.id)}"><span class="cx-li__ic">${ic("job", 15)}</span>
      <span class="cx-li__b"><b>${esc(j.title || "Job")}</b><small>${esc(sub)}</small></span>
      <span class="cx-li__v">${pill(JOB_TONE[j.status] || "mu", j.status_label || j.status)}</span></a>`;
  }
  function quoteLine(qt) {
    const [tone, label] = quoteStatus(qt);
    let sub = qt.job_name && qt.job_name !== (detail && detail.customer.name) ? qt.job_name : "";
    const when = qt.viewed_at && label === "Visto" ? `visto ${dm(qt.viewed_at)}` : qt.signed_at ? `assinado ${dm(qt.signed_at)}` : `criado ${dm(qt.created_at)}`;
    sub = [sub, when].filter(Boolean).join(" · ");
    return `<a class="cx-li" href="quote-builder.html?id=${encodeURIComponent(qt.id)}"><span class="cx-li__ic">${ic("doc", 15)}</span>
      <span class="cx-li__b"><b>${esc(qt.quote_number)}</b><small>${esc(sub)}</small></span>
      <span class="cx-li__v">${showMoney && qt.total != null ? `<strong>${money(qt.total)}</strong>` : ""}${pill(tone, label)}</span></a>`;
  }
  function invoiceLine(inv) {
    let sub = inv.job_number != null ? `Job #${inv.job_number}` : inv.quote_number || "";
    let state = "";
    let hot = false;
    const s = String(inv.status || "");
    if (s === "paid") state = inv.paid_at ? `paga ${dm(inv.paid_at)}` : "paga";
    else if (s === "draft") state = "rascunho";
    else if (s === "void") state = "cancelada";
    else if (inv.overdue) {
      state = `vencida ${plural(inv.overdue_days || 1, "dia", "dias")}`;
      hot = true;
    } else if (s === "partially_paid") state = showMoney ? `parcial · falta ${money(inv.balance, true)}` : "parcial";
    else state = inv.due_date ? `vence ${dm(inv.due_date)}` : "enviada";
    if (inv.due_date && s !== "paid" && s !== "draft") sub += ` · vence ${dm(inv.due_date)}`;
    return `<a class="cx-li" href="invoice.html?id=${encodeURIComponent(inv.id)}"><span class="cx-li__ic">${ic("receipt", 15)}</span>
      <span class="cx-li__b"><b>${esc(inv.invoice_number || "Fatura")}</b><small>${esc(sub)}</small></span>
      <span class="cx-li__v cx-li__v--col">${showMoney && inv.amount != null ? `<strong>${money(inv.amount, true)}</strong>` : ""}<small class="${hot ? "is-hot" : ""}">${esc(state)}</small></span></a>`;
  }
  const EV_ICON = { customer: "user", job: "job", job_done: "check", quote: "doc", quote_sent: "send", quote_viewed: "eye", quote_won: "check", invoice: "receipt", payment: "dollar", overdue: "clock" };
  function evLine(e) {
    const tone = e.kind === "overdue" ? " cx-ev__dot--hot" : e.kind === "quote_won" || e.kind === "payment" || e.kind === "job_done" ? " cx-ev__dot--ok" : "";
    const inner = `<span class="cx-ev__dot${tone}">${ic(EV_ICON[e.kind] || "flag", 14)}</span><span class="cx-ev__b"><b>${esc(e.title)}</b>${e.detail ? `<small>${esc(e.detail)}</small>` : ""}</span><time>${esc(ago(e.at))}</time>`;
    return e.href ? `<a class="cx-ev" href="${esc(e.href)}">${inner}</a>` : `<div class="cx-ev">${inner}</div>`;
  }

  function moneyStrip(s) {
    if (!showMoney || !s) return "";
    const inv = Number(s.invoiced) || 0;
    const paid = Number(s.paid) || 0;
    const pct = inv > 0 ? Math.min(100, Math.round((paid / inv) * 100)) : 0;
    const od = Number(s.overdue_balance) || 0;
    return `<div class="cx-mny">
      <div><span>Faturado</span><b>${money(inv)}</b></div>
      <div><span>Recebido</span><b>${money(paid)}</b><i class="cx-bar"><i style="width:${pct}%"></i></i></div>
      <div><span>Em aberto</span><b>${money(s.open_balance)}</b></div>
      <div><span>Vencido</span><b class="${od > 0.004 ? "is-hot" : ""}">${money(od)}</b>${od > 0.004 ? `<small class="is-hot">há ${plural(s.overdue_days || 1, "dia", "dias")}</small>` : ""}</div>
      <div><span>Quotes em aberto</span><b>${money(s.quotes_open_value)}</b>${s.quotes_open ? `<small>${plural(s.quotes_open, "quote", "quotes")}</small>` : ""}</div>
    </div>`;
  }

  function newQuoteHref(c) {
    return c.lead_id ? `quote-builder.html?lead_id=${encodeURIComponent(c.lead_id)}` : "quote-builder.html";
  }

  function renderDetail() {
    const host = $("cxDetail");
    if (!detail) {
      host.innerHTML = `<div class="cx-blank"><p>Escolha um cliente na lista.</p></div>`;
      return;
    }
    const c = detail.customer;
    const s = detail.stats || {};
    const org = isOrg(c.customer_type);
    const created = c.created_at ? new Date(c.created_at) : null;
    const since = created ? `Cliente desde ${MO[created.getMonth()]} ${created.getFullYear()}` : "";
    const tel = c.phone ? `tel:+${phoneDigits(c.phone)}` : "";
    const sms = c.phone ? `sms:+${phoneDigits(c.phone)}` : "";
    const mail = c.email ? `mailto:${c.email}` : "";
    const route = c.address ? `https://maps.google.com/?q=${encodeURIComponent(c.address)}` : "";
    const btnA = (href, icon, label, extra) =>
      href
        ? `<a class="cx-btn${extra || ""}" href="${esc(href)}"${href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${ic(icon)}<span>${label}</span></a>`
        : `<span class="cx-btn is-off${extra || ""}" aria-disabled="true">${ic(icon)}<span>${label}</span></span>`;

    const meta = [`<span class="cx-tag">${TYPE_PT[c.customer_type] || "Particular"}</span>`];
    if (org && c.responsible_name) meta.push(`<span>Contato: ${esc(c.responsible_name)}</span>`);
    if (since) meta.push(`<span>${since}</span>`);
    if (detail.lead) meta.push(`<a class="cx-meta__lead" href="lead-detail.html?id=${encodeURIComponent(detail.lead.id)}">Veio de um lead</a>`);

    const head = `<header class="cx-ch">
      <a class="cx-back" href="customers.html" data-back>${ic("back", 13, 2.4)}Clientes</a>
      <div class="cx-ch__r">
        ${av(c, "cx-av--lg")}
        <div class="cx-ch__t"><h2>${esc(c.name)}</h2><p class="cx-meta">${meta.join('<span class="cx-dot">·</span>')}</p></div>
        <div class="cx-ch__acts">
          ${btnA(tel, "phone", "Ligar", " cx-btn--ic")}${btnA(sms, "sms", "SMS", " cx-btn--ic")}${btnA(mail, "mail", "E-mail", " cx-btn--ic")}
          <button type="button" class="cx-btn cx-btn--sq" data-more aria-label="Mais ações" aria-haspopup="menu">${ic("more", 16)}</button>
          ${canEdit ? `<button type="button" class="cx-btn" data-edit>${ic("edit")}<span>Editar</span></button>` : ""}
          <a class="cx-btn cx-btn--pri" href="${newQuoteHref(c)}">${ic("plus", 15, 2.2)}<span>Novo quote</span></a>
        </div>
      </div>
      <div class="cx-circ">
        ${["phone:Ligar:" + tel, "sms:SMS:" + sms, "mail:E-mail:" + mail, "pin:Rota:" + route]
          .map((x) => {
            const [i, l, ...h] = x.split(":");
            const href = h.join(":");
            return href ? `<a href="${esc(href)}"${href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}><span>${ic(i, 20)}</span>${l}</a>` : `<a class="is-off" aria-disabled="true"><span>${ic(i, 20)}</span>${l}</a>`;
          })
          .join("")}
      </div>
      ${moneyStrip(s)}
    </header>`;

    const kv = [];
    if (org) kv.push(["Responsável", c.responsible_name || "—"]);
    kv.push(["Telefone", c.phone ? `<a href="${tel}">${esc(c.phone)}</a>` : "—", true]);
    kv.push(["E-mail", c.email ? `<a href="${mail}">${esc(c.email)}</a>` : "—", true]);
    kv.push(["Endereço", c.address ? `<a href="${route}" target="_blank" rel="noopener">${esc(c.address)}</a>` : "—", true]);
    if (org) {
      const dumpTxt =
        ynLabel(c.dumpster_status) +
        (c.dumpster_status === "yes" && c.dumpster_notes ? ` · ${c.dumpster_notes}` : "");
      const storTxt =
        ynLabel(c.storage_status) +
        (c.storage_status === "yes" && c.storage_notes ? ` · ${c.storage_notes}` : "");
      kv.push(["Dumpster", dumpTxt]);
      kv.push(["Storage", storTxt]);
    }
    const contact = `<section class="cx-box"><h3>Contato${canEdit ? '<button type="button" class="cx-lnk" data-edit>Editar</button>' : ""}</h3>
      <dl class="cx-kv">${kv.map(([k, v, raw]) => `<dt>${k}</dt><dd>${raw ? v : esc(v)}</dd>`).join("")}</dl></section>`;
    const prices = `<section class="cx-box"><h3>Preços${canEdit ? '<button type="button" class="cx-lnk" data-prices>Editar preços</button>' : ""}</h3>
      <div class="cx-prc">${ic("tag", 16)}<div><b>${c.pricing_mode === "custom" ? "Só deste cliente" : "Tabela de Valores"}</b><small>${
        c.pricing_mode === "custom"
          ? `${plural(c.custom_pricing_count || 0, "preço definido", "preços definidos")}; o resto vem da coluna ${TYPE_PT[c.customer_type]}`
          : `Coluna ${TYPE_PT[c.customer_type] || "Particular"} · jobs e quotes usam esse preço`
      }</small></div></div></section>`;
    const addrs = (detail.addresses || []).filter((a) => a.source !== "customer");
    const addrBox = addrs.length
      ? `<section class="cx-box"><h3>Endereços de obra · ${addrs.length}</h3>${addrs
          .slice(0, 6)
          .map((a) => `<a class="cx-li" href="https://maps.google.com/?q=${encodeURIComponent(a.address)}" target="_blank" rel="noopener"><span class="cx-li__ic">${ic("pin", 15)}</span><span class="cx-li__b"><b>${esc(a.address.split(",")[0])}</b><small>${esc([a.label, a.address.split(",").slice(1).join(",").trim()].filter(Boolean).join(" · "))}</small></span></a>`)
          .join("")}</section>`
      : "";
    const notes = c.notes
      ? `<section class="cx-box"><h3>Notas internas${canEdit ? '<button type="button" class="cx-lnk" data-edit>Editar</button>' : ""}</h3><p class="cx-notes">${esc(c.notes)}</p></section>`
      : "";
    const origin = detail.lead
      ? `<section class="cx-box"><h3>Origem</h3><a class="cx-li" href="lead-detail.html?id=${encodeURIComponent(detail.lead.id)}"><span class="cx-li__ic">${ic("funnel", 15)}</span><span class="cx-li__b"><b>Lead · ${esc(detail.lead.name)}</b><small>${esc(detail.lead.stage || detail.lead.status || "")}</small></span><span class="cx-li__v">${ic("back", 14, 2.2).replace("m15 18-6-6 6-6", "m9 18 6-6-6-6")}</span></a></section>`
      : "";

    const jobs = boxList(
      "jobs",
      "Jobs",
      detail.jobs || [],
      jobLine,
      canEdit ? '<button type="button" class="cx-lnk" data-new-job>Novo job</button>' : "",
      "Nenhum job ainda.",
    );
    const quotes = boxList("quotes", "Quotes", detail.quotes || [], quoteLine, `<a class="cx-lnk" href="${newQuoteHref(c)}">Novo quote</a>`, "Nenhum quote ainda.");
    const invoices = boxList("invoices", "Faturas", detail.invoices || [], invoiceLine, '<a class="cx-lnk" href="invoices.html">Ver faturas</a>', "Nenhuma fatura ainda.");
    const evs = detail.activity || [];
    const activity = boxList("activity", "Atividade", evs, evLine, "", "Sem atividade.");

    host.innerHTML = `<article class="cx-page">${head}
      <div class="cx-cols">
        <div class="cx-col cx-col--info">${contact}${prices}${addrBox}${notes}${origin}</div>
        <div class="cx-col">${jobs}${quotes}</div>
        <div class="cx-col">${invoices}${activity}</div>
      </div>
      <div class="cx-pbar"><button type="button" class="cx-btn" data-new-job>${ic("plus", 15, 2.2)}<span>Novo job</span></button><a class="cx-btn cx-btn--pri" href="${newQuoteHref(c)}">${ic("plus", 15, 2.2)}<span>Novo quote</span></a></div>
    </article>`;
    host.scrollTop = 0;
    // A barra fixa do iPhone fica fora do container da página (container-type prende position:fixed).
    document.getElementById("cxPbar")?.remove();
    const bar = host.querySelector(".cx-pbar");
    if (bar) {
      bar.id = "cxPbar";
      document.body.appendChild(bar);
    }
  }

  async function openDetail(id, opts) {
    const o = opts || {};
    selectedId = id;
    expanded = {};
    document.querySelectorAll("#cxRows .cx-row").forEach((el) => el.classList.toggle("is-on", el.getAttribute("data-id") === String(id)));
    $("cxSplit").classList.add("is-detail");
    document.body.classList.add("cx-detail-open");
    if (!o.keepUrl) {
      const u = new URL(location.href);
      u.searchParams.set("id", String(id));
      ["edit", "new", "q", "type"].forEach((k) => u.searchParams.delete(k));
      if (o.push && single()) history.pushState({ cx: id }, "", u.pathname + "?" + u.searchParams.toString());
      else history.replaceState({ cx: id }, "", u.pathname + "?" + u.searchParams.toString());
    }
    const host = $("cxDetail");
    if (!detail || String(detail.customer.id) !== String(id)) host.innerHTML = `<div class="cx-blank"><p>Carregando…</p></div>`;
    try {
      const j = await api(`/api/customers/${encodeURIComponent(id)}/overview`);
      if (String(selectedId) !== String(id)) return;
      detail = j.data;
      showMoney = detail.show_money !== false;
      renderDetail();
      if (single()) window.scrollTo(0, 0);
    } catch (e) {
      host.innerHTML = `<div class="cx-blank"><p>${esc(e.status === 404 ? "Cliente não encontrado." : e.message || "Erro ao carregar")}</p></div>`;
    }
  }

  function closeDetail() {
    selectedId = null;
    detail = null;
    document.getElementById("cxPbar")?.remove();
    $("cxSplit").classList.remove("is-detail");
    document.body.classList.remove("cx-detail-open");
    const u = new URL(location.href);
    u.searchParams.delete("id");
    history.replaceState({}, "", u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : ""));
    renderList();
    if (!single()) {
      const first = firstVisibleId();
      if (first) openDetail(first);
    }
  }

  // ---------------------------------------------------------------- more menu
  function openMore(anchor) {
    const menu = $("cxMoreMenu");
    if (!detail) return;
    const c = detail.customer;
    const items = [];
    if (c.address) items.push(`<a role="menuitem" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${ic("pin")}Rota no mapa</a>`);
    if (canEdit) items.push(`<button type="button" role="menuitem" data-new-job>${ic("job")}Novo job</button>`);
    items.push(`<a role="menuitem" href="invoices.html">${ic("receipt")}Faturas</a>`);
    items.push(`<button type="button" role="menuitem" data-copy-id>${ic("copy")}Copiar ID do cliente</button>`);
    if (canEdit) items.push(`<button type="button" role="menuitem" class="is-danger" data-delete>${ic("trash")}Excluir cliente</button>`);
    menu.innerHTML = items.join("");
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6 + window.scrollY}px`;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))}px`;
  }
  function closeMore() {
    $("cxMoreMenu").hidden = true;
  }

  // ---------------------------------------------------------------- form
  function openModal(id) {
    const m = $(id);
    m.hidden = false;
    document.body.classList.add("cx-modal-open");
    setTimeout(() => m.querySelector("input:not([type=hidden]), textarea, button")?.focus(), 30);
  }
  function closeModal(id) {
    $(id).hidden = true;
    if (!document.querySelector(".cx-modal:not([hidden])")) document.body.classList.remove("cx-modal-open");
  }

  function ynLabel(v) {
    if (v === "yes") return "Sim";
    if (v === "no") return "Não";
    return "Não informado";
  }

  function syncOrgExtra() {
    const org = isOrg(form.type);
    const wrap = $("cxOrgExtra");
    if (wrap) wrap.hidden = !org;
    if (!org) return;
    const dump = ($("cxDumpster") && $("cxDumpster").value) || "unknown";
    const stor = ($("cxStorage") && $("cxStorage").value) || "unknown";
    if ($("cxDumpsterNotesWrap")) $("cxDumpsterNotesWrap").hidden = dump !== "yes";
    if ($("cxStorageNotesWrap")) $("cxStorageNotesWrap").hidden = stor !== "yes";
  }

  function syncForm() {
    document.querySelectorAll("#cxTypeSeg [data-type]").forEach((b) => {
      const on = b.getAttribute("data-type") === form.type;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
    });
    const org = isOrg(form.type);
    $("cxNameLabel").textContent = org ? "Empresa *" : "Nome *";
    $("cxRespWrap").hidden = !org;
    document.querySelectorAll("[data-pricing]").forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-pricing") === form.pricing));
    $("cxPricingTableHint").textContent = `Coluna ${TYPE_PT[form.type]}`;
    const n = Object.values(form.rates || {}).filter((v) => Number(v) > 0).length;
    $("cxPricingCustomHint").textContent = n ? plural(n, "preço definido", "preços definidos") : "Nenhum preço definido";
    $("cxEditPrices").hidden = form.pricing !== "custom";
    syncOrgExtra();
  }

  function fillForm(c) {
    $("cxFormId").value = c ? c.id : "";
    $("cxFormLeadId").value = c && c.lead_id ? c.lead_id : "";
    $("cxName").value = c ? c.name || "" : "";
    $("cxResp").value = c ? c.responsible_name || "" : "";
    $("cxPhone").value = c ? maskPhone(c.phone || "") : "";
    $("cxEmail").value = c ? c.email || "" : "";
    $("cxAddress").value = c ? c.address || "" : "";
    $("cxNotes").value = c ? c.notes || "" : "";
    const dump = c && ["yes", "no"].includes(c.dumpster_status) ? c.dumpster_status : "unknown";
    const stor = c && ["yes", "no"].includes(c.storage_status) ? c.storage_status : "unknown";
    if ($("cxDumpster")) $("cxDumpster").value = dump;
    if ($("cxStorage")) $("cxStorage").value = stor;
    if ($("cxDumpsterNotes")) $("cxDumpsterNotes").value = c ? c.dumpster_notes || "" : "";
    if ($("cxStorageNotes")) $("cxStorageNotes").value = c ? c.storage_notes || "" : "";
    form = {
      type: c ? c.customer_type || "particular" : "particular",
      pricing: c && c.pricing_mode === "custom" ? "custom" : "table",
      rates: c && c.custom_pricing_rates && typeof c.custom_pricing_rates === "object" ? { ...c.custom_pricing_rates } : {},
    };
    $("cxFormTitle").textContent = c ? "Editar cliente" : "Novo cliente";
    $("cxFormDelete").hidden = !c || !canEdit;
    $("cxFormError").hidden = true;
    syncForm();
  }

  async function openForm(id) {
    if (id) {
      try {
        const j = await api(`/api/customers/${encodeURIComponent(id)}`);
        fillForm(j.data);
      } catch (e) {
        notify(e.message || "Não foi possível abrir o cliente.", "error");
        return;
      }
    } else {
      fillForm(null);
    }
    openModal("cxFormModal");
  }

  function formError(msg) {
    const el = $("cxFormError");
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function submitForm(ev) {
    ev.preventDefault();
    formError("");
    const id = $("cxFormId").value.trim();
    const org = isOrg(form.type);
    const name = $("cxName").value.trim();
    const resp = $("cxResp").value.trim();
    const email = $("cxEmail").value.trim();
    if (name.length < 2) return formError(org ? "Informe o nome da empresa." : "Informe o nome do cliente.");
    if (org && resp.length < 2) return formError("Informe o responsável (pessoa de contato).");
    if (!email) return formError("Informe o e-mail.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return formError("E-mail inválido.");
    const dump = org ? (($("cxDumpster") && $("cxDumpster").value) || "unknown") : "unknown";
    const stor = org ? (($("cxStorage") && $("cxStorage").value) || "unknown") : "unknown";
    const body = {
      name,
      email,
      phone: $("cxPhone").value.trim(),
      address: $("cxAddress").value.trim() || null,
      customer_type: form.type,
      pricing_mode: form.pricing,
      custom_pricing_rates: form.pricing === "custom" ? form.rates : {},
      notes: $("cxNotes").value.trim() || null,
      responsible_name: org ? resp : null,
      dumpster_status: org ? dump : null,
      dumpster_notes: org && dump === "yes" ? ($("cxDumpsterNotes").value.trim() || null) : null,
      storage_status: org ? stor : null,
      storage_notes: org && stor === "yes" ? ($("cxStorageNotes").value.trim() || null) : null,
    };
    const lead = $("cxFormLeadId").value.trim();
    if (lead && !id) body.lead_id = lead;
    const btn = $("cxFormSubmit");
    btn.disabled = true;
    btn.textContent = "Salvando…";
    try {
      const j = await api(id ? `/api/customers/${encodeURIComponent(id)}` : "/api/customers", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      closeModal("cxFormModal");
      notify(id ? "Cliente atualizado." : "Cliente cadastrado.", "success");
      await loadList();
      const nid = (j.data && j.data.id) || id;
      if (nid) openDetail(nid, { push: !id });
    } catch (e) {
      formError(e.message || "Não foi possível salvar.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Salvar";
    }
  }

  async function deleteCustomer(id, name) {
    if (!id) return;
    if (!confirm(`Excluir o cliente “${name || ""}”?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      try {
        await api(`/api/customers/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (e) {
        if (e.status !== 409) throw e;
        if (!confirm(`${e.message}\n\nExcluir mesmo assim? Quotes, jobs e faturas ficam sem cliente.`)) return;
        await api(`/api/customers/${encodeURIComponent(id)}?force=1`, { method: "DELETE" });
      }
      notify("Cliente excluído.", "success");
      closeModal("cxFormModal");
      detail = null;
      await loadList();
      closeDetail();
    } catch (e) {
      notify(e.message || "Não foi possível excluir.", "error");
    }
  }

  // ---------------------------------------------------------------- prices
  function tableRate(item, type) {
    const key = type === "builder" ? "price_builder" : type === "loja" ? "price_loja" : "price_particular";
    const pref = Number(item[key]);
    if (Number.isFinite(pref) && pref > 0) return pref;
    for (const c of [item.price_loja, item.price_min, item.price_builder, item.partner_price, item.price_particular, item.price_max]) {
      const n = Number(c);
      if (c != null && c !== "" && Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }
  function renderPrices() {
    const box = $("cxPriceList");
    const list = pricingCache || [];
    const term = String($("cxPriceSearch").value || "").trim().toLowerCase();
    const shown = list.filter((s) => !term || [s.name, s.unit, s.category].join(" ").toLowerCase().includes(term));
    if (!list.length) {
      box.innerHTML = '<p class="cx-none">Nenhum serviço na Tabela de Valores.</p>';
      return;
    }
    if (!shown.length) {
      box.innerHTML = '<p class="cx-none">Nenhum serviço encontrado.</p>';
      return;
    }
    box.innerHTML =
      `<div class="cx-pr cx-pr--head"><span>Serviço</span><span>Tabela</span><span>Este cliente</span></div>` +
      shown
        .map((s) => {
          const id = String(s.id);
          const tr = tableRate(s, form.type);
          const v = priceDraft[id];
          return `<div class="cx-pr"><span><b>${esc(s.name || "Serviço")}</b><small>${esc([s.category, s.unit].filter(Boolean).join(" · "))}</small></span>
            <span class="cx-pr__t">${tr > 0 ? money(tr, true) : "—"}</span>
            <label class="cx-pr__in"><span>$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-rate="${esc(id)}" value="${v != null && v !== "" ? esc(v) : ""}" placeholder="${tr > 0 ? tr.toFixed(2) : "0.00"}" aria-label="Preço para este cliente" /></label></div>`;
        })
        .join("");
  }
  async function openPrices(fromDetail) {
    priceDraft = { ...(form.rates || {}) };
    $("cxPriceSearch").value = "";
    $("cxPriceIntro").textContent = `Em branco = usa a coluna ${TYPE_PT[form.type]} da Tabela de Valores.`;
    $("cxPriceModal").dataset.fromDetail = fromDetail ? "1" : "";
    $("cxPriceList").innerHTML = '<p class="cx-none">Carregando serviços…</p>';
    openModal("cxPriceModal");
    try {
      if (!pricingCache) {
        const j = await api("/api/pricing");
        pricingCache = Array.isArray(j.data) ? j.data : [];
      }
      renderPrices();
    } catch (e) {
      $("cxPriceList").innerHTML = `<p class="cx-none">${esc(e.message || "Erro ao carregar")}</p>`;
    }
  }
  async function applyPrices() {
    const next = {};
    Object.keys(priceDraft).forEach((id) => {
      const n = Number(priceDraft[id]);
      if (priceDraft[id] !== "" && Number.isFinite(n) && n >= 0) next[id] = Math.round(n * 100) / 100;
    });
    form.rates = next;
    form.pricing = "custom";
    if ($("cxPriceModal").dataset.fromDetail === "1" && detail) {
      try {
        await api(`/api/customers/${encodeURIComponent(detail.customer.id)}`, {
          method: "PUT",
          body: JSON.stringify({ pricing_mode: Object.keys(next).length ? "custom" : "table", custom_pricing_rates: next }),
        });
        notify("Preços do cliente salvos.", "success");
        closeModal("cxPriceModal");
        await Promise.all([loadList(), openDetail(detail.customer.id)]);
      } catch (e) {
        notify(e.message || "Não foi possível salvar.", "error");
      }
      return;
    }
    syncForm();
    closeModal("cxPriceModal");
  }

  // ---------------------------------------------------------------- duplicates
  let dupGroups = [];
  async function refreshDupButton() {
    const btn = $("cxDupBtn");
    if (!canEdit) {
      btn.hidden = true;
      return;
    }
    try {
      const j = await api("/api/customers/duplicates");
      dupGroups = j.data || [];
      btn.hidden = !dupGroups.length;
      btn.querySelector("span").textContent = `Duplicados · ${dupGroups.length}`;
    } catch (_) {
      btn.hidden = true;
    }
  }
  function renderDup() {
    const REASON = { email: "Mesmo e-mail", phone: "Mesmo telefone", name: "Mesmo nome" };
    const body = $("cxDupBody");
    if (!dupGroups.length) {
      body.innerHTML = '<p class="cx-none">Nenhum duplicado encontrado.</p>';
      return;
    }
    const statsOf = (id) => {
      const r = rows.find((x) => String(x.id) === String(id));
      return (r && r.stats) || {};
    };
    body.innerHTML = dupGroups
      .map((g, gi) => {
        const custs = g.customers || [];
        const best = custs
          .map((c, i) => ({ i, n: (statsOf(c.id).jobs_total || 0) + (statsOf(c.id).quotes_total || 0) }))
          .sort((a, b) => b.n - a.n || a.i - b.i)[0].i;
        return `<section class="cx-fs" data-group="${gi}"><h4>${esc(REASON[g.reason] || g.reason)} · ${esc(g.key)}</h4>
          ${custs
            .map((c, i) => {
              const s = statsOf(c.id);
              const created = c.created_at ? new Date(c.created_at) : null;
              return `<label class="cx-opt cx-opt--row${i === best ? " is-on" : ""}"><input type="radio" name="dupkeep${gi}" value="${esc(c.id)}"${i === best ? " checked" : ""} /><i></i>
                <span><b>${esc(c.name || c.company || c.id)}</b><small>${esc([TYPE_PT[c.customer_type] || c.customer_type, plural(s.jobs_total || 0, "job", "jobs"), plural(s.quotes_total || 0, "quote", "quotes"), created ? `desde ${MO[created.getMonth()]} ${created.getFullYear()}` : ""].filter(Boolean).join(" · "))}</small></span>
                <em class="cx-keep">Manter</em></label>`;
            })
            .join("")}
          <div class="cx-dup__acts"><button type="button" class="cx-btn cx-btn--pri" data-merge="${gi}">Unificar ${custs.length} cadastros</button></div></section>`;
      })
      .join("");
  }
  async function mergeGroup(gi, btn) {
    const g = dupGroups[gi];
    if (!g) return;
    const keepId = document.querySelector(`input[name="dupkeep${gi}"]:checked`)?.value;
    const keep = (g.customers || []).find((c) => String(c.id) === String(keepId));
    const others = (g.customers || []).filter((c) => String(c.id) !== String(keepId));
    if (!keep || !others.length) return;
    if (!confirm(`Unificar ${others.length} cadastro(s) em “${keep.name}”? Os outros serão removidos.`)) return;
    btn.disabled = true;
    try {
      for (const o of others) {
        await api("/api/customers/merge", { method: "POST", body: JSON.stringify({ keep_id: keep.id, merge_id: o.id }) });
      }
      notify("Cadastros unificados.", "success");
      await Promise.all([loadList(), refreshDupButton()]);
      renderDup();
      if (!dupGroups.length) closeModal("cxDupModal");
    } catch (e) {
      notify(e.message || "Falha ao unificar.", "error");
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------- new job
  function newJob() {
    const jm = window.__crmJobModal;
    if (!jm || !detail) {
      location.href = "jobs.html";
      return;
    }
    const c = detail.customer;
    if (!newJob.bound && typeof jm.onSaved === "function") {
      newJob.bound = true;
      jm.onSaved(() => {
        if (selectedId) Promise.all([loadList(), openDetail(selectedId, { keepUrl: true })]).catch(() => {});
      });
    }
    jm.openCreate({
      customerId: c.id,
      sourceType: c.customer_type === "builder" ? "builder" : "other",
      sourceName: c.name,
    });
  }

  // ---------------------------------------------------------------- events
  function bind() {
    $("cxChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      filter = b.getAttribute("data-filter");
      renderChips();
      renderList();
    });
    let t = null;
    $("cxSearch").addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        q = $("cxSearch").value.trim().toLowerCase();
        renderList();
      }, 160);
    });
    $("cxRows").addEventListener("click", (e) => {
      const a = e.target.closest(".cx-row");
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      openDetail(a.getAttribute("data-id"), { push: true });
    });
    $("cxNewBtn").addEventListener("click", () => openForm(null));
    $("cxDupBtn").addEventListener("click", () => {
      renderDup();
      openModal("cxDupModal");
    });
    $("cxDupBody").addEventListener("change", (e) => {
      const r = e.target.closest('input[type="radio"]');
      if (!r) return;
      r.closest(".cx-fs").querySelectorAll(".cx-opt").forEach((l) => l.classList.toggle("is-on", l.contains(r)));
    });
    $("cxDupBody").addEventListener("click", (e) => {
      const b = e.target.closest("[data-merge]");
      if (b) mergeGroup(Number(b.getAttribute("data-merge")), b);
    });

    $("cxDetail").addEventListener("click", (e) => {
      const back = e.target.closest("[data-back]");
      if (back) {
        e.preventDefault();
        if (history.state && history.state.cx && single()) history.back();
        else closeDetail();
        return;
      }
      if (e.target.closest("[data-edit]")) {
        if (detail) openForm(detail.customer.id);
        return;
      }
      if (e.target.closest("[data-prices]")) {
        if (!detail) return;
        api(`/api/customers/${encodeURIComponent(detail.customer.id)}`)
          .then((j) => {
            fillForm(j.data);
            openPrices(true);
          })
          .catch((err) => notify(err.message, "error"));
        return;
      }
      if (e.target.closest("[data-new-job]")) {
        newJob();
        return;
      }
      const ex = e.target.closest("[data-expand]");
      if (ex) {
        const k = ex.getAttribute("data-expand");
        expanded[k] = !expanded[k];
        renderDetail();
        return;
      }
      const more = e.target.closest("[data-more]");
      if (more) {
        e.stopPropagation();
        if ($("cxMoreMenu").hidden) openMore(more);
        else closeMore();
      }
    });
    $("cxMoreMenu").addEventListener("click", (e) => {
      if (e.target.closest("[data-new-job]")) newJob();
      if (e.target.closest("[data-copy-id]") && detail && navigator.clipboard) {
        navigator.clipboard.writeText(String(detail.customer.id)).then(() => notify("ID copiado.", "success"));
      }
      if (e.target.closest("[data-delete]") && detail) deleteCustomer(detail.customer.id, detail.customer.name);
      closeMore();
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#cxPbar [data-new-job]")) newJob();
      if (!$("cxMoreMenu").hidden && !e.target.closest("#cxMoreMenu")) closeMore();
    });

    // modais
    document.querySelectorAll(".cx-modal").forEach((m) => {
      m.addEventListener("click", (e) => {
        if (e.target === m || e.target.closest("[data-cx-close]")) closeModal(m.id);
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const open = [...document.querySelectorAll(".cx-modal:not([hidden])")].pop();
      if (open) closeModal(open.id);
      else closeMore();
    });
    $("cxTypeSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-type]");
      if (!b) return;
      form.type = b.getAttribute("data-type");
      syncForm();
    });
    document.querySelectorAll("[data-pricing]").forEach((b) =>
      b.addEventListener("click", () => {
        form.pricing = b.getAttribute("data-pricing");
        syncForm();
        if (form.pricing === "custom" && !Object.keys(form.rates || {}).length) openPrices(false);
      }),
    );
    $("cxEditPrices").addEventListener("click", () => openPrices(false));
    ["cxDumpster", "cxStorage"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", syncOrgExtra);
    });
    $("cxPhone").addEventListener("input", (e) => {
      e.target.value = maskPhone(e.target.value);
    });
    $("cxForm").addEventListener("submit", submitForm);
    $("cxFormDelete").addEventListener("click", () => deleteCustomer($("cxFormId").value, $("cxName").value));
    $("cxPriceSearch").addEventListener("input", renderPrices);
    $("cxPriceList").addEventListener("input", (e) => {
      const inp = e.target.closest("[data-rate]");
      if (!inp) return;
      const id = inp.getAttribute("data-rate");
      if (inp.value === "") delete priceDraft[id];
      else priceDraft[id] = inp.value;
    });
    $("cxPriceApply").addEventListener("click", applyPrices);

    window.addEventListener("popstate", () => {
      const id = new URLSearchParams(location.search).get("id");
      if (id) openDetail(id, { keepUrl: true });
      else if (single()) {
        selectedId = null;
        detail = null;
        document.getElementById("cxPbar")?.remove();
        $("cxSplit").classList.remove("is-detail");
        document.body.classList.remove("cx-detail-open");
        renderList();
      }
    });
    let wasSingle = single();
    window.addEventListener("resize", () => {
      const now = single();
      if (now === wasSingle) return;
      wasSingle = now;
      renderSummary();
      if (!now && !selectedId) {
        const first = firstVisibleId();
        if (first) openDetail(first);
      }
    });
  }

  async function boot() {
    let s;
    try {
      s = await api("/api/auth/session");
    } catch (_) {
      location.href = "/login.html";
      return;
    }
    if (!s.authenticated) {
      location.href = "/login.html";
      return;
    }
    const perms = s.user?.permissions || [];
    const role = String(s.user?.role || "").toLowerCase();
    window.__crmPermissionKeys = perms;
    window.__crmUserRole = role;
    canCreate = role === "admin" || perms.includes("customers.create");
    canEdit = role === "admin" || perms.includes("customers.edit");
    if (!canCreate) $("cxNewBtn").hidden = true;
    const sn = $("sidebarUserName");
    if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
    const sr = $("sidebarUserRole");
    if (sr) sr.textContent = role || "";

    const qp = new URLSearchParams(location.search);
    const tp = qp.get("type");
    if (tp && ["particular", "builder", "loja"].includes(tp)) filter = tp;
    if (qp.get("q")) {
      $("cxSearch").value = qp.get("q");
      q = qp.get("q").trim().toLowerCase();
    }
    bind();
    try {
      await loadList();
    } catch (e) {
      $("cxRows").innerHTML = `<p class="cx-empty">${esc(e.message || "Erro ao carregar")}</p>`;
    }
    refreshDupButton();

    const id = qp.get("id") || qp.get("edit");
    if (id) await openDetail(id, { keepUrl: !qp.get("edit") });
    else if (!single()) {
      const first = firstVisibleId();
      if (first) openDetail(first);
    }
    if (qp.get("edit") && canEdit) openForm(qp.get("edit"));
    if (qp.get("new") && canCreate) openForm(null);

    if (window.OmGestures) {
      window.OmGestures.initPullToRefresh({
        key: "customers",
        indicator: "#cxPtr",
        refresh: async () => {
          await loadList();
          if (selectedId) await openDetail(selectedId, { keepUrl: true });
        },
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
