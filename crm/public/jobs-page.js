/**
 * Jobs (computador e iPad) — números no topo, etapas como filtros, lista agrupada ao lado
 * e o job escolhido aberto à direita. A página completa do job continua em job-detail.html.
 */
(function () {
  const I = () => window.JobsInfo;
  const $ = (id) => document.getElementById(id);
  let all = [];
  let canManage = false;
  let canBill = false;
  let filter = "all";
  let source = "";
  let q = "";
  let selId = null;
  let firstLoad = true;

  const SOURCE = { particular: "Particular", builder: "Builder", contractor: "Builder", loja: "Loja", internal: "Interno", other: "Outro" };
  const SVG = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5V4a2 2 0 00-2-2z"/><path d="M8 7h6M8 11h6"/></svg>',
  };

  function notify(msg, type) {
    if (window.crmToast?.[type || "info"]) window.crmToast[type || "info"](msg);
  }
  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // ---------------------------------------------------------------- buckets
  function bucket(wo) {
    const J = I();
    if (wo.status === "canceled") return "canceled";
    if (J.late(wo)) return "late";
    if (wo.status === "in_progress") return "field";
    if (J.isActive(wo)) return wo.scheduled_start ? "scheduled" : "nodate";
    const b = wo.billing;
    if (b && b.remaining_to_invoice > 0.004 && b.billing_status !== "no_value") return "toinvoice";
    if (b && b.open_balance > 0.004) return "receivable";
    return "done";
  }
  const GROUPS = [
    ["late", "Atrasados"],
    ["field", "Em campo"],
    ["scheduled", "Agendados"],
    ["nodate", "Sem data"],
    ["toinvoice", "A faturar"],
    ["receivable", "A receber"],
    ["done", "Concluídos"],
    ["canceled", "Cancelados"],
  ];

  function matchesFilter(wo, f) {
    const J = I();
    const bk = bucket(wo);
    switch (f) {
      case "all":
        return wo.status !== "canceled";
      case "nodate":
        return J.isActive(wo) && !wo.scheduled_start;
      case "scheduled":
        return (wo.status === "scheduled" || wo.status === "draft") && !!wo.scheduled_start;
      case "field":
        return wo.status === "in_progress";
      case "late":
        return !!J.late(wo);
      case "toinvoice":
        return bk === "toinvoice";
      case "receivable":
        return !!(wo.billing && wo.billing.open_balance > 0.004);
      case "done":
        return wo.status === "completed";
      default:
        return true;
    }
  }

  function sourceMatches(wo) {
    if (!source) return true;
    if (source === "builder") return wo.source_type === "builder" || wo.source_type === "contractor";
    return wo.source_type === source;
  }

  function searchHit(wo) {
    if (!sourceMatches(wo)) return false;
    if (!q) return true;
    const hay = [wo.title, wo.number != null ? `#${wo.number}` : "", String(wo.number || ""), I().client(wo), wo.address, wo.assigned_user?.name]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function sortRows(rows, bk) {
    const t = (wo) => new Date(wo.scheduled_start || wo.created_at || 0).getTime();
    if (bk === "done" || bk === "toinvoice" || bk === "receivable" || bk === "canceled") return rows.sort((a, b) => t(b) - t(a));
    return rows.sort((a, b) => t(a) - t(b));
  }

  // ---------------------------------------------------------------- top
  function renderSum() {
    const J = I();
    const active = all.filter((w) => J.isActive(w));
    const late = all.filter((w) => J.late(w)).length;
    const contracts = active.reduce((s, w) => s + (Number(w.services_total) || 0), 0);
    const toInvoice = all.filter((w) => w.status !== "canceled" && w.billing && w.billing.billing_status !== "no_value").reduce((s, w) => s + (w.billing.remaining_to_invoice || 0), 0);
    const recv = all.reduce((s, w) => s + (w.billing ? w.billing.open_balance || 0 : 0), 0);
    const parts = [
      ["Ativos", String(active.length), ""],
      ["Em contratos", J.money0(contracts), ""],
      ["Atrasados", String(late), late ? "is-hot" : ""],
    ];
    if (canBill) parts.push(["A faturar", J.money0(toInvoice), ""], ["A receber", J.money0(recv), ""]);
    $("jxSum").innerHTML = parts.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${v}</dd></div>`).join("");
  }

  function renderTiles() {
    const J = I();
    const n = (f) => all.filter((w) => matchesFilter(w, f));
    const sum = (rows, fn) => rows.reduce((s, w) => s + (Number(fn(w)) || 0), 0);
    const T = [];
    const allR = n("all");
    T.push(["all", "Todos", allR.length, `${J.money0(sum(allR, (w) => w.services_total))} em jobs`, ""]);
    const nd = n("nodate");
    T.push(["nodate", "Sem data", nd.length, nd.length ? "marcar na agenda" : "tudo agendado", ""]);
    const sc = n("scheduled");
    T.push(["scheduled", "Agendados", sc.length, sc.length ? J.money0(sum(sc, (w) => w.services_total)) : "—", ""]);
    const fi = n("field");
    T.push(["field", "Em campo", fi.length, fi.length ? J.money0(sum(fi, (w) => w.services_total)) : "ninguém em campo", ""]);
    const la = n("late");
    T.push(["late", "Atrasados", la.length, la.length ? "passaram da data" : "nenhum", la.length ? "is-hot" : ""]);
    if (canBill) {
      const ti = n("toinvoice");
      T.push(["toinvoice", "A faturar", ti.length, ti.length ? `${J.money0(sum(ti, (w) => w.billing.remaining_to_invoice))} concluído` : "nada pendente", ""]);
      const re = n("receivable");
      T.push(["receivable", "A receber", re.length, re.length ? J.money0(sum(re, (w) => w.billing.open_balance)) : "nada em aberto", ""]);
    }
    const dn = n("done");
    T.push(["done", "Concluídos", dn.length, dn.length ? (() => { const k = dn.filter((w) => w.billing?.billing_status === "paid").length; return `${k} pago${k === 1 ? "" : "s"}`; })() : "—", ""]);
    const host = $("jxTiles");
    host.style.setProperty("--jx-tiles", T.length);
    host.innerHTML = T.map(
      ([k, l, c, s, cls]) =>
        `<button type="button" class="jx-tile${filter === k ? " is-on" : ""}" data-jx-filter="${k}" aria-pressed="${filter === k}"><span>${l}</span><b>${c}</b><small class="${cls}">${I().esc(s)}</small></button>`,
    ).join("");
  }

  // ---------------------------------------------------------------- list
  function rowHtml(wo) {
    const J = I();
    const lt = J.late(wo);
    const sub = lt ? `<em class="is-hot">${J.esc(lt.label)}</em>` : `<em>${J.esc(wo.status === "completed" ? `concluído ${J.dayShort(wo.scheduled_end || wo.scheduled_start)}` : J.dateRange(wo))}</em>`;
    return `<a class="jx-row${String(wo.id) === String(selId) ? " is-on" : ""}" href="job-detail.html?id=${encodeURIComponent(wo.id)}" data-jx-id="${J.esc(wo.id)}">
      <span class="jx-row__b">
        <span class="jx-row__l1"><b>${J.esc(wo.title || `Job para ${J.client(wo)}`)}</b><em>${canBill || canManage ? J.money0(wo.services_total) : ""}</em></span>
        <span class="jx-row__l2"><span>${J.esc(J.client(wo))}${wo.number != null ? ` · #${J.esc(wo.number)}` : ""}</span>${sub}</span>
        <span class="jx-row__l3">${J.progHtml(wo)}<small>${J.esc(J.stageLabel(wo))}</small></span>
      </span>
    </a>`;
  }

  function visibleRows() {
    return all.filter((w) => matchesFilter(w, filter) && searchHit(w));
  }

  function renderList() {
    const rows = visibleRows();
    const host = $("jxRows");
    $("jxCount").textContent = `${rows.length} job${rows.length === 1 ? "" : "s"}`;
    if (!rows.length) {
      host.innerHTML = `<p class="jx-empty">${all.length ? "Nenhum job neste filtro." : "Nenhum job ainda. Crie o primeiro em Novo job."}</p>`;
      return rows;
    }
    let html = "";
    if (filter === "all" || filter === "done") {
      GROUPS.forEach(([bk, label]) => {
        const g = sortRows(rows.filter((w) => bucket(w) === bk), bk);
        if (!g.length) return;
        const tot = g.reduce((s, w) => s + (Number(w.services_total) || 0), 0);
        html += `<p class="jx-grp"><span>${label}</span><em>${g.length}${canBill ? ` · ${I().money0(tot)}` : ""}</em></p>${g.map(rowHtml).join("")}`;
      });
    } else {
      html = sortRows(rows.slice(), filter).map(rowHtml).join("");
    }
    host.innerHTML = html;
    return rows;
  }

  // ---------------------------------------------------------------- detail
  function primary(wo) {
    if (!canManage || wo.status === "canceled") return null;
    const b = wo.billing;
    if (wo.status === "completed" && canBill && b && b.remaining_to_invoice > 0.004) return { label: `Faturar ${I().money0(b.remaining_to_invoice)}`, href: `job-detail.html?id=${encodeURIComponent(wo.id)}&faturar=1` };
    if (!(wo.line_items || []).length) return { label: "Adicionar serviços", act: "services" };
    if (!wo.scheduled_start) return { label: "Agendar", act: "schedule" };
    if (wo.status === "draft" || wo.status === "scheduled") return { label: "Iniciar job", act: "start" };
    if (wo.status === "in_progress") return { label: "Concluir job", act: "complete" };
    return null;
  }

  function statusPill(wo) {
    const map = { draft: ["Rascunho", ""], scheduled: ["Agendado", ""], in_progress: ["Em campo", "dk"], completed: ["Concluído", "ol"], canceled: ["Cancelado", "late"] };
    const [l, c] = map[wo.status] || [wo.status, ""];
    return `<span class="jx-pill${c ? ` jx-pill--${c}` : ""}">${l}</span>`;
  }

  function unitLabel(u) {
    const m = { sqft: "sq ft", sq_ft: "sq ft", lf: "lf", linear_ft: "lf", step: "steps", steps: "steps", each: "un", unit: "un", hour: "h" };
    return m[u] || (u ? String(u).replace(/_/g, " ") : "sq ft");
  }
  function qty(n) {
    const x = Number(n) || 0;
    return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function renderDetail() {
    const J = I();
    const host = $("jxDetail");
    const wo = all.find((w) => String(w.id) === String(selId));
    if (!wo) {
      host.innerHTML = `<div class="jx-blank">Escolha um job na lista.</div>`;
      return;
    }
    const href = `job-detail.html?id=${encodeURIComponent(wo.id)}`;
    const lt = J.late(wo);
    const b = wo.billing;
    const bl = J.bill(wo);
    const p = primary(wo);
    const phone = wo.customer?.phone ? String(wo.customer.phone).replace(/[^\d+]/g, "") : "";
    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "";
    const s = J.step(wo);
    const steps = J.STEP_NAMES.map((n, i) => `<li class="${s < 0 ? "" : i < s ? "is-ok" : i === s ? "is-cur" : ""}"><i></i>${n}</li>`).join("");
    const team = J.team(wo);
    const kpis = [
      ["Total do job", J.money0(wo.services_total), `${(wo.line_items || []).length} serviço${(wo.line_items || []).length === 1 ? "" : "s"}`],
    ];
    if (canBill && b) {
      kpis.push(["A faturar", J.money0(b.remaining_to_invoice), b.invoiced_total > 0 ? `${J.money0(b.invoiced_total)} faturado` : "nada faturado"]);
      kpis.push([b.open_balance > 0.004 ? "A receber" : "Recebido", J.money0(b.open_balance > 0.004 ? b.open_balance : b.paid_total), b.open_balance > 0.004 ? `${J.money0(b.paid_total)} recebido` : b.billing_status === "paid" ? "tudo pago" : "nada recebido"]);
    }
    kpis.push(["Equipe", team.length ? team.map((t) => t.name.split(" ")[0]).join(", ") : "Sem equipe", team.length ? `${team.length} pessoa${team.length > 1 ? "s" : ""}` : canManage ? "escalar no Editar" : ""]);

    const lines = wo.line_items || [];
    const svc = lines.length
      ? `<table class="jx-tbl"><thead><tr><th>Serviço</th><th class="r">Qtd</th><th class="r">Total</th></tr></thead><tbody>${lines
          .map((l) => `<tr><td>${J.esc(l.service_name)}</td><td class="r">${qty(l.quantity_sqft)} ${J.esc(unitLabel(l.unit))}</td><td class="r">${J.money(l.line_total)}</td></tr>`)
          .join("")}</tbody><tfoot><tr><td colspan="2">Total do job</td><td class="r">${J.money(wo.services_total)}</td></tr></tfoot></table>`
      : `<p class="jx-none">Nenhum serviço ainda.</p>`;

    const ck = Array.isArray(wo.campo_checklist) ? wo.campo_checklist : Array.isArray(wo.campo_checklist?.items) ? wo.campo_checklist.items : [];
    const ckDone = ck.filter((c) => c && (c.done || c.checked || c.completed)).length;
    const notes = String(wo.notes || "").trim();
    const campo = `<dl class="jx-kv">
      <dt>Quando</dt><dd>${J.esc(J.dateRange(wo))}${wo.scheduled_start ? ` · ${new Date(wo.scheduled_start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</dd>
      <dt>Endereço</dt><dd>${wo.address ? `<a href="${J.esc(maps)}" target="_blank" rel="noopener">${J.esc(wo.address)}</a>` : '<span class="jx-mu">Sem endereço</span>'}</dd>
      ${ck.length ? `<dt>Checklist</dt><dd>${ckDone} de ${ck.length}</dd>` : ""}
      ${wo.campo_attention ? `<dt>Atenção</dt><dd>${J.esc(wo.campo_attention)}</dd>` : ""}
      ${wo.needs_delivery ? `<dt>Delivery</dt><dd>${J.esc(wo.delivery_pickup_address || "Retirar material")}</dd>` : ""}
      <dt>Notas</dt><dd>${notes ? J.esc(notes.length > 140 ? `${notes.slice(0, 140)}…` : notes) : '<span class="jx-mu">Sem notas</span>'}</dd>
    </dl>`;
    const teamHtml = team.length
      ? team.map((t) => `<div class="jx-tm"><span class="jx-av${t.lead ? " jx-av--lead" : ""}">${J.esc(J.initials(t.name))}</span><span><b>${J.esc(t.name)}</b><small>${t.lead ? "Responsável" : t.temp ? "Temporário" : "Equipe"}</small></span></div>`).join("")
      : `<p class="jx-none">Ninguém escalado.</p>`;

    host.innerHTML = `
      <a class="jx-back" href="#" data-jx-back>${SVG.back}Jobs</a>
      <div class="jx-ch">
        <div class="jx-ch__r">
          <div class="jx-ch__t">
            <div class="jx-chips">${statusPill(wo)}${lt ? `<span class="jx-pill jx-pill--late">${J.esc(lt.short)}</span>` : ""}${bl && canBill && wo.status === "completed" ? `<span class="jx-pill${bl.cls === "ok" ? " jx-pill--ol" : ""}">${J.esc(bl.text)}</span>` : ""}${wo.number != null ? `<span class="jx-num">Job #${J.esc(wo.number)}</span>` : ""}</div>
            <h2><a href="${href}">${J.esc(wo.title || `Job para ${J.client(wo)}`)}</a></h2>
            <p class="jx-meta">${[`<b>${J.esc(J.client(wo))}</b>${SOURCE[wo.source_type] ? ` · ${SOURCE[wo.source_type]}` : ""}`, wo.address ? `${SVG.pin}${J.esc(wo.address)}` : "", `${SVG.cal}${J.esc(J.dateRange(wo))}`].filter(Boolean).map((x, i) => `<span class="jx-mp">${i ? '<i class="jx-dot">·</i>' : ""}${x}</span>`).join("")}</p>
          </div>
          <div class="jx-ch__acts">
            ${phone ? `<a class="jx-btn jx-btn--sq" href="tel:${J.esc(phone)}" title="Ligar para o cliente" aria-label="Ligar">${SVG.phone}</a>` : ""}
            ${canManage ? `<button type="button" class="jx-btn" data-jx-act="edit">${SVG.edit}<span>Editar</span></button>` : ""}
            ${p ? (p.href ? `<a class="jx-btn jx-btn--pri" href="${p.href}">${J.esc(p.label)}</a>` : `<button type="button" class="jx-btn jx-btn--pri" data-jx-act="${p.act}">${J.esc(p.label)}</button>`) : ""}
            <a class="jx-btn" href="${href}">Abrir job</a>
          </div>
        </div>
        ${s >= 0 ? `<ol class="jx-steps">${steps}</ol>` : ""}
        <div class="jx-kpis">${kpis.map(([k, v, sm]) => `<div><span>${k}</span><b>${J.esc(v)}</b>${sm ? `<small>${J.esc(sm)}</small>` : ""}</div>`).join("")}</div>
      </div>
      ${
        lt
          ? `<div class="jx-alert"><div><b>${wo.status === "in_progress" ? `Passou da data de término há ${lt.days} dia${lt.days > 1 ? "s" : ""}` : `Era para começar e não foi iniciado (${lt.days} dia${lt.days > 1 ? "s" : ""})`}</b><p>${wo.status === "in_progress" ? "O job ainda está em campo. Conclua se o serviço terminou ou remarque o fim." : "Inicie o job ou remarque a data."}</p></div>${canManage ? `<button type="button" class="jx-btn" data-jx-act="schedule">Remarcar</button>` : ""}</div>`
          : ""
      }
      <nav class="jx-tabs"><a class="is-on" href="${href}">Visão geral</a><a href="${href}#servicos">Serviços e faturas</a><a href="${href}#fotos">Fotos</a><a href="${href}#campo">Campo</a><a href="${href}#conversa">Conversa</a></nav>
      <div class="jx-cols">
        <div class="jx-box"><h3>Serviços${canManage ? `<button type="button" class="jx-lnk" data-jx-act="services">Editar</button>` : ""}</h3>${svc}</div>
        <div>
          <div class="jx-box"><h3>Obra e campo${canManage ? `<button type="button" class="jx-lnk" data-jx-act="schedule">Agenda</button>` : ""}</h3>${campo}</div>
          <div class="jx-box"><h3>Equipe${canManage ? `<button type="button" class="jx-lnk" data-jx-act="team">Gerir</button>` : ""}</h3>${teamHtml}</div>
        </div>
      </div>`;
  }

  function render() {
    renderSum();
    renderTiles();
    const rows = renderList();
    const wide = window.matchMedia("(min-width: 1025px)").matches;
    if (wide && !rows.some((w) => String(w.id) === String(selId))) {
      const first = $("jxRows").querySelector("[data-jx-id]");
      selId = first ? first.getAttribute("data-jx-id") : null;
      $("jxRows").querySelectorAll("[data-jx-id]").forEach((a) => a.classList.toggle("is-on", a.getAttribute("data-jx-id") === String(selId)));
    }
    renderDetail();
  }

  function select(id, push) {
    selId = id;
    $("jxRows").querySelectorAll("[data-jx-id]").forEach((a) => a.classList.toggle("is-on", a.getAttribute("data-jx-id") === String(id)));
    renderDetail();
    const narrow = !window.matchMedia("(min-width: 1025px)").matches;
    $("jxSplit").classList.toggle("is-detail", narrow && !!id);
    document.body.classList.toggle("jx-detail-open", narrow && !!id);
    if (push) {
      try {
        const u = new URL(location.href);
        if (id) u.searchParams.set("id", id);
        else u.searchParams.delete("id");
        history.replaceState(null, "", u);
      } catch (_) {}
    }
    if (narrow && id) window.scrollTo(0, 0);
  }

  async function load() {
    const j = await api("/api/work-orders");
    all = j.data || [];
    if (firstLoad) {
      firstLoad = false;
      const qs = new URLSearchParams(location.search);
      const bmap = { to_invoice: "toinvoice", awaiting_payment: "receivable", paid: "done" };
      if (qs.get("billing") && bmap[qs.get("billing")]) filter = bmap[qs.get("billing")];
      if (qs.get("filter")) filter = qs.get("filter");
      if (qs.get("id")) selId = qs.get("id");
    }
    render();
    if (selId && !window.matchMedia("(min-width: 1025px)").matches && new URLSearchParams(location.search).get("id")) select(selId, false);
  }

  async function setStatus(id, status, msg) {
    await api(`/api/work-orders/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    notify(msg, "success");
    await load();
  }

  function bind() {
    $("jxTiles").addEventListener("click", (e) => {
      const t = e.target.closest("[data-jx-filter]");
      if (!t) return;
      filter = t.getAttribute("data-jx-filter");
      render();
    });
    $("jxRows").addEventListener("click", (e) => {
      const a = e.target.closest("[data-jx-id]");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      select(a.getAttribute("data-jx-id"), true);
    });
    $("jxQ").addEventListener("input", (e) => {
      clearTimeout(e.target._t);
      e.target._t = setTimeout(() => {
        q = e.target.value.trim().toLowerCase();
        render();
      }, 150);
    });
    $("jxSource").addEventListener("change", (e) => {
      source = e.target.value === "contractor" ? "builder" : e.target.value;
      if (e.target.value === "contractor") e.target.value = "builder";
      e.target.closest(".jx-sel").classList.toggle("is-on", !!source);
      const params = new URLSearchParams(location.search);
      if (source) params.set("source", source);
      else params.delete("source");
      const qs = params.toString();
      history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
      render();
    });
    $("jxDetail").addEventListener("click", async (e) => {
      if (e.target.closest("[data-jx-back]")) {
        e.preventDefault();
        select(null, true);
        return;
      }
      const b = e.target.closest("[data-jx-act]");
      if (!b) return;
      const act = b.getAttribute("data-jx-act");
      const id = selId;
      try {
        if (act === "edit") await window.__crmJobModal.openEdit(id);
        else if (act === "services") await window.__crmJobModal.openEdit(id, { section: "services" });
        else if (act === "schedule") await window.__crmJobModal.openEdit(id, { section: "schedule" });
        else if (act === "team") await window.__crmJobModal.openEdit(id, { section: "team" });
        else if (act === "start") await setStatus(id, "in_progress", "Job iniciado.");
        else if (act === "complete") {
          if (!confirm("Marcar o job como concluído?")) return;
          await setStatus(id, "completed", "Job concluído.");
        }
      } catch (err) {
        notify(err.message || "Erro", "error");
      }
    });
    $("btnNewJob")?.addEventListener("click", () => window.__crmJobModal.openCreate().catch((e) => notify(e.message, "error")));
    window.__crmJobModal.onSaved((data) => {
      if (data && data.id) selId = data.id;
      load().catch(() => {});
    });
    window.addEventListener("resize", () => {
      const wide = window.matchMedia("(min-width: 1025px)").matches;
      if (wide) {
        $("jxSplit").classList.remove("is-detail");
        document.body.classList.remove("jx-detail-open");
      }
    });
  }

  async function boot() {
    if (!$("jx")) return;
    if (window.__omDevice?.isMobile?.()) return;
    try {
      await window.__crmJobModal.ready;
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      canManage = role === "admin" || perms.includes("work_orders.manage");
      canBill = role === "admin" || perms.includes("invoices.view");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      const sn = $("sidebarUserName");
      if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
      if (!canManage && $("btnNewJob")) $("btnNewJob").style.display = "none";
      let srcQp = new URLSearchParams(location.search).get("source") || "";
      if (srcQp === "contractor") srcQp = "builder";
      if (srcQp && $("jxSource") && [...$("jxSource").options].some((o) => o.value === srcQp)) {
        source = srcQp;
        $("jxSource").value = srcQp;
        $("jxSource").closest(".jx-sel")?.classList.add("is-on");
      }
      bind();
      await load();
      const openId = sessionStorage.getItem("obramate_open_job");
      if (openId) {
        sessionStorage.removeItem("obramate_open_job");
        location.href = `job-detail.html?id=${encodeURIComponent(openId)}`;
        return;
      }
      if (canManage && (sessionStorage.getItem("obramate_job_pref_start") || new URLSearchParams(location.search).get("new") === "1")) {
        window.__crmJobModal.openCreate().catch(() => {});
      }
    } catch (err) {
      notify(err.message || "Falha ao carregar os jobs", "error");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
