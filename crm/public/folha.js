/**
 * Folha de pagamento — painel do admin (desktop + mobile).
 * Semana por setor (Instalação / Lixa) · Conferir dias · Pagar → Financeiro · Pagamentos · Relatórios · Funcionários.
 * API: /api/folha/* (src/crm/routes/folha-admin.ts).
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SECTORS = { installation: "Instalação", sand_finish: "Lixa" };
  let METHODS = [
    ["zelle", "Zelle"],
    ["cash", "Dinheiro"],
    ["check", "Cheque"],
    ["ach", "ACH"],
    ["transfer", "Transferência"],
    ["other", "Outro"],
  ];
  let METHOD_LABEL = Object.fromEntries(METHODS);

  async function loadPayMethods() {
    try {
      const j = await api("/api/folha/formas-pagamento");
      const rows = Array.isArray(j?.data) ? j.data : [];
      if (!rows.length) return;
      METHODS = rows.map((r) => [r.key, r.label || r.key]);
      METHOD_LABEL = Object.fromEntries(METHODS);
    } catch (_) {
      /* keep built-in fallback */
    }
  }
  const TABS = ["semana", "conferir", "pagamentos", "relatorios", "funcionarios"];

  const st = {
    manage: false,
    tab: "semana",
    sector: "all",
    weekRef: null,
    week: null,
    open: new Set(),
    selected: new Set(),
    pend: null,
    pendSel: new Set(),
    emps: null,
    report: null,
    rep: { preset: "year", from: null, to: null, employee: "", sector: "" },
    pays: null,
    payPreset: "month",
    jobsCache: {},
  };

  // ------------------------------------------------------------ utils
  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || `Erro ${r.status}`), { status: r.status, code: j.code });
    return j;
  }
  const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const money0 = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const qty = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  function hm(min) {
    min = Math.round(Number(min) || 0);
    if (!min) return "0h";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  }
  function initials(name) {
    const p = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  const pad = (n) => String(n).padStart(2, "0");
  const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split("-").map(Number);
    const t = new Date(y, m - 1, d + n);
    return ymdOf(t);
  }
  const brDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "");
  const brShort = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : "");
  const mapsUrl = (g) => `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`;
  function distLabel(m) {
    if (m == null) return "";
    return m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km do job` : `${m} m do job`;
  }
  const FAR_M = 300;
  const sectorTag = (s) => `<span class="fo-tag${s === "sand_finish" ? " fo-tag--sand" : ""}">${esc(SECTORS[s] || "Instalação")}</span>`;
  function statusPill(day) {
    const map = { pending: "warn", returned: "red", approved: "muted", in_progress: "info" };
    return `<span class="fo-pill fo-pill--${map[day.status] || "muted"}">${esc(day.status_label || day.status)}</span>`;
  }
  function jobsShort(jobs) {
    if (!jobs || !jobs.length) return '<span class="fo-muted">Sem job</span>';
    return jobs.map((j) => `<span>${j.number != null ? `#${esc(j.number)} ` : ""}${esc(j.title)}</span>`).join("");
  }

  // ------------------------------------------------------------ hash
  function readHash() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const tab = h.get("tab");
    if (tab && TABS.includes(tab)) st.tab = tab;
    const w = h.get("semana");
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
      st.weekRef = w;
      if (!tab) st.tab = "semana";
    }
    const s = h.get("setor");
    if (s && ["all", "installation", "sand_finish"].includes(s)) st.sector = s;
  }
  function writeHash() {
    const h = new URLSearchParams();
    h.set("tab", st.tab);
    if (st.tab === "semana" && st.week) h.set("semana", st.week.week.start);
    if (st.sector !== "all") h.set("setor", st.sector);
    history.replaceState(null, "", `#${h.toString()}`);
  }

  // ------------------------------------------------------------ tabs
  function setTab(tab) {
    st.tab = tab;
    document.querySelectorAll("#foTabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab)));
    document.querySelectorAll("#foRoot [data-panel]").forEach((p) => (p.hidden = p.getAttribute("data-panel") !== tab));
    renderPayBar();
    writeHash();
    if (tab === "semana") loadWeek();
    else if (tab === "conferir") loadPend();
    else if (tab === "pagamentos") loadPays();
    else if (tab === "relatorios") loadReport();
    else if (tab === "funcionarios") loadEmps();
  }

  // ------------------------------------------------------------ semana
  async function loadWeek() {
    const box = $("foSemana");
    if (!st.week) box.innerHTML = '<div class="fo-empty">Carregando…</div>';
    try {
      const j = await api(`/api/folha/semana${st.weekRef ? `?week=${st.weekRef}` : ""}`);
      st.week = j.data;
      st.weekRef = j.data.week.start;
      // Drop selections that are no longer payable.
      for (const id of [...st.selected]) {
        const e = j.data.employees.find((x) => x.id === id);
        if (!e || e.payment || e.totals.net <= 0) st.selected.delete(id);
      }
      renderWeek();
      writeHash();
      refreshPendCount(j.data);
    } catch (e) {
      box.innerHTML = `<div class="fo-empty"><b>Não foi possível carregar a folha.</b>${esc(e.message)}</div>`;
    }
  }
  function refreshPendCount(week) {
    const n = week ? week.totals.all.pending_days : st.pend ? st.pend.pending.length : 0;
    if (st.pend) {
      const p = st.pend.pending.length;
      const b = $("foPendN");
      b.hidden = !p;
      b.textContent = p;
      return;
    }
    const b = $("foPendN");
    b.hidden = !n;
    b.textContent = n;
  }
  function weekRows() {
    const rows = st.week ? st.week.employees : [];
    return st.sector === "all" ? rows : rows.filter((r) => r.sector === st.sector);
  }
  function empStatus(r) {
    if (r.payment) return `<span class="fo-pill fo-pill--paid">Pago ${esc(brShort(r.payment.paid_on))}${r.payment.method_label ? ` · ${esc(r.payment.method_label)}` : ""}</span>`;
    if (r.totals.pending_days) return `<span class="fo-pill fo-pill--warn">${r.totals.pending_days} dia${r.totals.pending_days > 1 ? "s" : ""} p/ conferir</span>`;
    if (r.totals.open_days) return `<span class="fo-pill fo-pill--info">Em andamento</span>`;
    if (r.totals.net > 0) return '<span class="fo-pill fo-pill--due">A pagar</span>';
    return '<span class="fo-muted">—</span>';
  }
  function canPay(r) {
    return st.manage && !r.payment && r.totals.net > 0 && st.week && st.week.period;
  }
  function dayRows(r) {
    if (!r.days.length) return '<div class="fo-empty" style="padding:10px">Nenhum dia nesta semana.</div>';
    return r.days
      .map((d) => {
        const time = d.kind === "line" ? "Escritório" : d.clock_in_label ? `${d.clock_in_label}–${d.clock_out_label || "…"}` : "—";
        const ot = d.overtime_minutes ? ` <span class="fo-tag">+${hm(d.overtime_minutes)} extra</span>` : "";
        // Alerts matter while the day waits for review; once approved only "lançado pelo escritório" stays visible.
        const flags =
          d.status !== "approved" && (d.flags || []).length
            ? `<span class="fo-flag" title="${esc(d.flags.map((f) => f.label).join(" · "))}">${d.flags.length} alerta${d.flags.length > 1 ? "s" : ""}</span>`
            : d.source === "manual"
              ? '<span class="fo-tag">Lançado à mão</span>'
              : "";
        return `<div class="fo-day" data-day="${esc(d.id)}" data-kind="${d.kind}" role="button" tabindex="0">
          <span class="fo-day__d">${esc(d.date_label)}</span>
          <span class="fo-day__t">${esc(time)}${d.worked_minutes ? ` · ${hm(d.worked_minutes)}` : ""}</span>
          <span class="fo-day__j">${d.kind === "line" ? `<span>${esc(d.note || "Lançado na grade")}</span>` : jobsShort(d.jobs)}${ot}${flags}</span>
          <span class="fo-day__p">${d.kind === "line" ? '<span class="fo-pill fo-pill--muted">Grade</span>' : statusPill(d)}</span>
          <span class="fo-day__v">${money(d.amount)}</span>
        </div>`;
      })
      .join("");
  }
  function renderWeek() {
    const w = st.week;
    const box = $("foSemana");
    const t = w.totals[st.sector] || w.totals.all;
    const rows = weekRows();
    const segBtn = (k, l) => `<button type="button" data-sector="${k}" aria-pressed="${st.sector === k}">${l} <small>${w.totals[k].employees}</small></button>`;
    const head = `<div class="fo-tool">
        <div class="fo-week">
          <button type="button" class="fo-ic" data-week="prev" aria-label="Período anterior">‹</button>
          <div><b>${esc(w.week.label)}</b><small>${
            (w.week.today >= w.week.start && w.week.today <= w.week.end ? "Período atual" : esc(w.period ? (w.period.status === "closed" ? "Período fechado" : "Período aberto") : "Sem lançamentos")) +
            (w.week.pay_on_label ? ` · Paga ${esc(w.week.pay_on_label)}` : "")
          }</small></div>
          <button type="button" class="fo-ic" data-week="next" aria-label="Próximo período">›</button>
          ${w.week.today >= w.week.start && w.week.today <= w.week.end ? "" : '<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-week="today">Hoje</button>'}
        </div>
        <div class="fo-seg" role="group" aria-label="Setor">${segBtn("all", "Todos")}${segBtn("installation", "Instalação")}${segBtn("sand_finish", "Lixa")}</div>
      </div>
      <div class="fo-stats">
        <div class="fo-stat fo-stat--ink"><small>A pagar</small><b>${money(t.to_pay)}</b><span>${t.paid ? `${money(t.paid)} já pago` : "nada pago ainda"}</span></div>
        <div class="fo-stat"><small>Total da semana</small><b>${money(t.net)}</b><span>${t.employees} funcionário${t.employees === 1 ? "" : "s"}</span></div>
        <div class="fo-stat${t.pending_days ? " fo-stat--warn" : ""}"><small>Para conferir</small><b>${t.pending_days} dia${t.pending_days === 1 ? "" : "s"}</b><span>${t.pending_days ? '<button type="button" class="fo-link" data-goto="conferir">Conferir agora</button>' : "tudo conferido"}</span></div>
        <div class="fo-stat"><small>Horas extras</small><b>${hm(t.overtime_minutes)}</b><span>${t.sqft ? `${qty(t.sqft)} sq ft de produção` : "depois do horário padrão"}</span></div>
      </div>`;
    if (!rows.length) {
      box.innerHTML = `${head}<div class="fo-card"><div class="fo-empty"><b>Ninguém nesta semana${st.sector !== "all" ? ` em ${SECTORS[st.sector]}` : ""}.</b>Os dias aparecem aqui quando a equipe começa e finaliza o dia no celular.</div></div>`;
      renderPayBar();
      return;
    }
    const payable = rows.filter(canPay);
    const allSel = payable.length && payable.every((r) => st.selected.has(r.id));
    const table = `<div class="fo-card fo-tbl-wrap--week"><table class="fo-tbl">
      <thead><tr>
        <th class="c">${st.manage ? `<input type="checkbox" data-selall ${allSel ? "checked" : ""} ${payable.length ? "" : "disabled"} aria-label="Selecionar todos a pagar" />` : ""}</th>
        <th>Funcionário</th><th class="r">Dias</th><th class="r">Extra</th><th class="r">Sq ft</th><th class="r">Ganho</th><th class="r">Ajustes</th><th class="r">Líquido</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>${rows
        .map((r) => {
          const open = st.open.has(r.id);
          const adj = r.totals.reimbursement - r.totals.discount;
          return `<tr class="is-row${open ? " is-open" : ""}" data-emp="${esc(r.id)}">
            <td class="c">${canPay(r) ? `<input type="checkbox" data-sel="${esc(r.id)}" ${st.selected.has(r.id) ? "checked" : ""} aria-label="Selecionar ${esc(r.name)}" />` : ""}</td>
            <td><div class="fo-name"><span class="fo-chev" aria-hidden="true">›</span><span class="fo-av${r.sector === "sand_finish" ? " fo-av--sand" : ""}">${esc(initials(r.name))}</span><span><b>${esc(r.name)}</b><small>${esc(SECTORS[r.sector])} · ${r.pay_type === "production" ? `produção ${money(r.production_rate)}/sq ft` : `diária ${money0(r.daily_rate)}`}</small></span></div></td>
            <td class="r">${qty(r.totals.days)}</td>
            <td class="r">${r.totals.overtime_minutes ? hm(r.totals.overtime_minutes) : '<span class="fo-muted">—</span>'}</td>
            <td class="r">${r.totals.sqft ? qty(r.totals.sqft) : '<span class="fo-muted">—</span>'}</td>
            <td class="r">${money(r.totals.gross)}</td>
            <td class="r">${adj ? `<span title="Reembolso ${money(r.totals.reimbursement)} · Desconto ${money(r.totals.discount)}">${adj > 0 ? "+" : "−"}${money(Math.abs(adj))}</span>` : '<span class="fo-muted">—</span>'}</td>
            <td class="r fo-strong">${money(r.totals.net)}${r.totals.pending_amount ? `<div class="fo-muted" style="font-size:12px;font-weight:600">+${money(r.totals.pending_amount)} em conferência</div>` : ""}</td>
            <td>${empStatus(r)}</td>
            <td class="r">${rowActions(r)}</td>
          </tr>${open ? `<tr class="is-open"><td colspan="10" style="padding:0 12px 8px"><div class="fo-days">${dayRows(r)}</div></td></tr>` : ""}`;
        })
        .join("")}</tbody>
      <tfoot><tr><td></td><td>Total ${st.sector === "all" ? "" : esc(SECTORS[st.sector])}</td><td class="r">${qty(rows.reduce((s, r) => s + r.totals.days, 0))}</td><td class="r">${hm(t.overtime_minutes)}</td><td class="r">${t.sqft ? qty(t.sqft) : "—"}</td><td class="r">${money(t.gross)}</td><td class="r"></td><td class="r">${money(t.net)}</td><td colspan="2"></td></tr></tfoot>
    </table></div>`;
    const cards = `<div class="fo-mlist">${rows
      .map((r) => {
        const open = st.open.has(r.id);
        return `<div class="fo-mcard" data-emp-card="${esc(r.id)}">
          <div class="fo-mcard__top">
            ${canPay(r) ? `<input type="checkbox" class="fo-mcheck" data-sel="${esc(r.id)}" ${st.selected.has(r.id) ? "checked" : ""} aria-label="Selecionar ${esc(r.name)}" style="width:20px;height:20px;accent-color:#211d1a" />` : ""}
            <div class="fo-name"><span class="fo-av${r.sector === "sand_finish" ? " fo-av--sand" : ""}">${esc(initials(r.name))}</span><span><b>${esc(r.name)}</b><small>${esc(SECTORS[r.sector])}</small></span></div>
            <div class="fo-mcard__v"><b>${money(r.totals.net)}</b>${empStatus(r)}</div>
          </div>
          <div class="fo-mcard__nums"><span><b>${qty(r.totals.days)}</b> dia${r.totals.days === 1 ? "" : "s"}</span>${r.totals.overtime_minutes ? `<span><b>${hm(r.totals.overtime_minutes)}</b> extra</span>` : ""}${r.totals.sqft ? `<span><b>${qty(r.totals.sqft)}</b> sq ft</span>` : ""}${r.totals.pending_amount ? `<span>+${money(r.totals.pending_amount)} em conferência</span>` : ""}</div>
          <div class="fo-mcard__act">
            <button type="button" class="fo-btn fo-btn--sm" data-toggle="${esc(r.id)}">${open ? "Esconder dias" : `Ver ${r.days.length} dia${r.days.length === 1 ? "" : "s"}`}</button>
            ${rowActions(r, true)}
          </div>
          ${open ? `<div class="fo-days">${dayRows(r)}</div>` : ""}
        </div>`;
      })
      .join("")}</div>`;
    box.innerHTML = head + table + cards;
    renderPayBar();
  }
  function rowActions(r, mobile) {
    if (!st.manage) return "";
    if (r.payment) return `<button type="button" class="fo-btn fo-btn--sm fo-btn--ghost" data-receipt="${esc(r.id)}">Recibo</button>`;
    const parts = [];
    if (st.week.period) parts.push(`<button type="button" class="fo-btn fo-btn--sm fo-btn--ghost" data-adjust="${esc(r.id)}">Ajustes</button>`);
    if (canPay(r)) parts.push(`<button type="button" class="fo-btn fo-btn--sm ${mobile ? "fo-btn--pri" : ""}" data-pay="${esc(r.id)}">Pagar</button>`);
    return parts.join(" ");
  }
  function renderPayBar() {
    const bar = $("foPayBar");
    const rows = st.week ? st.week.employees.filter((r) => st.selected.has(r.id)) : [];
    if (st.tab !== "semana" || !rows.length) {
      bar.hidden = true;
      return;
    }
    const total = rows.reduce((s, r) => s + r.totals.net, 0);
    bar.hidden = false;
    bar.innerHTML = `<div><b>${rows.length} selecionado${rows.length > 1 ? "s" : ""} · ${money(total)}</b><br /><span>Cada um vira uma saída no Financeiro</span></div>
      <button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-clearsel>Limpar</button>
      <button type="button" class="fo-btn fo-btn--pri" data-paysel>Pagar</button>`;
  }

  // ------------------------------------------------------------ sheet
  let sheetOnClose = null;
  function openSheet(html, onClose) {
    const sh = $("foSheet");
    sh.innerHTML = html;
    sh.hidden = false;
    $("foScrim").hidden = false;
    document.body.style.overflow = "hidden";
    sheetOnClose = onClose || null;
    setTimeout(() => sh.querySelector("[autofocus]")?.focus(), 30);
  }
  function closeSheet() {
    $("foSheet").hidden = true;
    $("foScrim").hidden = true;
    document.body.style.overflow = "";
    const fn = sheetOnClose;
    sheetOnClose = null;
    if (fn) fn();
  }
  const sheetHead = (title, sub) =>
    `<header class="fo-sheet__hd"><div><h2 id="foSheetTitle">${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div><button type="button" class="fo-x" data-close aria-label="Fechar">×</button></header>`;

  // ------------------------------------------------------------ dia
  async function openDay(id) {
    openSheet(`${sheetHead("Dia de trabalho", "Carregando…")}<div class="fo-sheet__bd"></div>`);
    try {
      const j = await api(`/api/folha/dias/${id}`);
      renderDay(j.data);
    } catch (e) {
      openSheet(`${sheetHead("Dia de trabalho")}<div class="fo-sheet__bd"><div class="fo-alert fo-alert--red">${esc(e.message)}</div></div>`);
    }
  }
  function timeBox(label, time, gps) {
    let where = '<span class="fo-muted">Sem localização</span>';
    if (gps) {
      const far = gps.distance_m != null && gps.distance_m > FAR_M;
      where = `<a href="${mapsUrl(gps)}" target="_blank" rel="noopener">Ver no mapa</a>${gps.distance_m != null ? ` · <span class="${far ? "far" : "fo-muted"}">${esc(distLabel(gps.distance_m))}</span>` : ""}`;
    }
    return `<div class="fo-time"><small>${label}</small><b>${esc(time || "—")}</b>${where}</div>`;
  }
  function renderDay(d, mode) {
    const canAct = st.manage && !d.paid;
    const flags = d.flags || [];
    const photosByJob = {};
    (d.photos || []).forEach((p) => (photosByJob[p.job_id] = (photosByJob[p.job_id] || 0) + 1));
    const sub = `${esc(d.employee_name)} · ${esc(SECTORS[d.sector])} · ${d.source === "manual" ? "lançado manualmente" : d.source === "auto_closed" ? "fechado pelo sistema" : "ponto pelo celular"}`;
    let body = "";
    if (d.paid) body += '<div class="fo-alert"><b>Semana já paga.</b> Para mudar este dia, estorne o pagamento em Pagamentos.</div>';
    if (d.status === "returned" && d.review_note) body += `<div class="fo-alert fo-alert--red"><b>Devolvido ao funcionário:</b> ${esc(d.review_note)}</div>`;
    if (flags.length) body += `<div class="fo-alert fo-alert--red"><b>Conferir:</b> ${flags.map((f) => esc(f.label)).join(" · ")}</div>`;
    if (mode === "edit") body += editForm(d);
    else if (mode === "return") body += `<div class="fo-box"><h3>Devolver para ajuste</h3><label class="fo-field">O que o funcionário precisa corrigir?<textarea class="fo-ta" id="foReturnReason" maxlength="500" autofocus placeholder="Ex.: faltou a foto do job #101; confira a hora de saída."></textarea></label><p class="fo-muted" style="margin:8px 0 0;font-size:13px">Ele recebe uma notificação e o dia sai da folha até ele reenviar.</p></div>`;
    else {
      body += `<div class="fo-box"><div class="fo-times">${timeBox("Entrada", d.clock_in_label, d.gps_in)}${timeBox("Saída", d.clock_out_label, d.gps_out)}</div>
        <div class="fo-kv"><div><small>Trabalhado</small><b>${hm(d.worked_minutes)}</b></div><div><small>Extra</small><b>${d.overtime_minutes ? hm(d.overtime_minutes) : "—"}</b></div><div><small>${d.sqft ? "Sq ft" : "Dias"}</small><b>${d.sqft ? qty(d.sqft) : qty(d.days_worked)}</b></div><div><small>Valor</small><b>${money(d.amount)}</b></div></div>
        ${d.expected_end_label ? `<p class="fo-muted" style="margin:10px 0 0;font-size:12.5px;font-weight:600">Horário padrão até ${esc(d.expected_end_label)} — extra conta depois disso.</p>` : ""}</div>`;
      body += `<div class="fo-box"><h3>Jobs do dia <small>${d.jobs.length}</small></h3>${
        d.jobs.length
          ? `<ul class="fo-jobs">${d.jobs
              .map(
                (j) => `<li><span><b>${j.number != null ? `#${esc(j.number)} ` : ""}${esc(j.title)}</b><small>${esc(j.address || "")}</small></span><span class="fo-muted" style="white-space:nowrap;font-size:13px;font-weight:700">${photosByJob[j.id] || j.photos || 0} foto${(photosByJob[j.id] || j.photos) === 1 ? "" : "s"}${j.sqft ? ` · ${qty(j.sqft)} sq ft` : ""}</span></li>`,
              )
              .join("")}</ul>`
          : '<p class="fo-muted" style="margin:0">Nenhum job informado.</p>'
      }</div>`;
      if ((d.photos || []).length) {
        body += `<div class="fo-box"><h3>Fotos do dia <small>${d.photos.length}</small></h3><div class="fo-photos">${d.photos
          .map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.thumb_url)}" alt="" loading="lazy" />${p.time_label ? `<span>${esc(p.time_label)}</span>` : ""}</a>`)
          .join("")}</div></div>`;
      }
      body += `<div class="fo-box"><h3>Nota do funcionário</h3>${d.note ? `<p class="fo-note">${esc(d.note)}</p>` : '<p class="fo-muted" style="margin:0">Sem nota.</p>'}</div>`;
      if ((d.expenses || []).length) {
        body += `<div class="fo-box"><h3>Reembolsos e descontos <small>${d.expenses.length}</small></h3>
          <ul class="fo-exp">${d.expenses
            .map(
              (x) => `<li>
              ${x.receipt_url ? `<a class="fo-exp__img" href="${esc(x.receipt_url)}" target="_blank" rel="noopener"><img src="${esc(x.receipt_url)}" alt="" /></a>` : `<span class="fo-exp__ph">Sem recibo</span>`}
              <div><b>${x.kind === "discount" ? "−" : "+"}${money(x.amount)}</b><small>${esc(x.kind_label)} · ${esc(x.status_label)}${x.description ? ` · ${esc(x.description)}` : ""}</small></div>
              ${
                canAct && x.status === "pending"
                  ? `<span class="fo-exp__act"><button type="button" class="fo-btn fo-btn--sm fo-btn--pri" data-exp-ok="${esc(x.id)}">Aprovar</button><button type="button" class="fo-btn fo-btn--sm fo-btn--ghost fo-btn--danger" data-exp-no="${esc(x.id)}">Recusar</button></span>`
                  : ""
              }
            </li>`,
            )
            .join("")}</ul>
          ${canAct ? `<button type="button" class="fo-btn fo-btn--sm" data-exp-add="${esc(d.id)}" style="margin-top:10px">+ Lançar reembolso ou desconto</button>` : ""}
        </div>`;
      } else if (canAct) {
        body += `<div class="fo-box"><h3>Reembolsos e descontos</h3><p class="fo-muted" style="margin:0 0 10px">Nenhum lançamento neste dia.</p><button type="button" class="fo-btn fo-btn--sm" data-exp-add="${esc(d.id)}">+ Lançar reembolso ou desconto</button></div>`;
      }
      if (d.reviewed_by) body += `<p class="fo-muted" style="margin:0;font-size:12.5px;font-weight:600">${d.status === "returned" ? "Devolvido" : "Conferido"} por ${esc(d.reviewed_by)}${d.submitted_label ? ` · enviado ${esc(d.submitted_label)}` : ""}</p>`;
      else if (d.submitted_label) body += `<p class="fo-muted" style="margin:0;font-size:12.5px;font-weight:600">Enviado ${esc(d.submitted_label)}</p>`;
    }
    let foot = "";
    if (mode === "edit") foot = `<button type="button" class="fo-btn fo-btn--ghost" data-day-mode="view">Cancelar</button><button type="button" class="fo-btn fo-btn--pri" data-day-save>Salvar e aprovar</button>`;
    else if (mode === "return") foot = `<button type="button" class="fo-btn fo-btn--ghost" data-day-mode="view">Cancelar</button><button type="button" class="fo-btn fo-btn--ink" data-day-return-go>Devolver</button>`;
    else if (canAct && d.status !== "in_progress") {
      foot = `${d.status !== "returned" ? '<button type="button" class="fo-btn fo-btn--ghost fo-btn--danger" data-day-mode="return">Devolver</button>' : ""}<button type="button" class="fo-btn" data-day-mode="edit">Editar</button>${
        d.status !== "approved" ? '<button type="button" class="fo-btn fo-btn--pri" data-day-approve>Aprovar</button>' : ""
      }`;
    } else if (d.status === "in_progress") foot = '<span class="fo-muted" style="font-weight:600;font-size:13px;margin-right:auto">O funcionário ainda não finalizou este dia.</span><button type="button" class="fo-btn" data-close>Fechar</button>';
    else foot = '<button type="button" class="fo-btn" data-close>Fechar</button>';
    openSheet(`${sheetHead(`${esc(d.date_label)} · ${statusPill(d)}`, sub)}<div class="fo-sheet__bd">${body}</div><footer class="fo-sheet__ft">${foot}</footer>`);
    $("foSheet").dataset.dayId = d.id;
    $("foSheet")._day = d;
  }
  function editForm(d) {
    const days = Number(d.days_worked) === 0.5 ? 0.5 : Number(d.days_worked) >= 2 ? 2 : 1;
    const ot = d.overtime_minutes != null ? String(d.overtime_minutes) : "";
    return `<div class="fo-box"><h3>Corrigir o dia</h3>
      <div class="fo-grid2"><label class="fo-field">Entrada<input type="time" class="fo-in" id="foEdIn" value="${esc(d.clock_in_label || "")}" /></label><label class="fo-field">Saída<input type="time" class="fo-in" id="foEdOut" value="${esc(d.clock_out_label || "")}" /></label></div>
      <div style="margin-top:12px">
        <div class="fo-field"><span>Diária</span></div>
        <div class="fo-chiprow" role="group" aria-label="Quantidade de diárias">
          <button type="button" class="fo-chip" data-ed-days="0.5" aria-pressed="${days === 0.5}">½ dia</button>
          <button type="button" class="fo-chip" data-ed-days="1" aria-pressed="${days === 1}">1 diária</button>
          <button type="button" class="fo-chip" data-ed-days="2" aria-pressed="${days === 2}" title="Duas diárias no mesmo dia">Double</button>
        </div>
        <input type="hidden" id="foEdDays" value="${days}" />
      </div>
      <div style="margin-top:12px">
        <label class="fo-field">Extra (minutos)<input type="number" class="fo-in" id="foEdOt" min="0" step="15" value="${esc(ot)}" placeholder="calcular pelo horário" /><small>Vazio = calcula pela saída</small></label>
        <div class="fo-chiprow" style="margin-top:8px" role="group" aria-label="Adicionar hora extra">
          <button type="button" class="fo-chip" data-ed-ot="30">+½ h</button>
          <button type="button" class="fo-chip" data-ed-ot="60">+1 h</button>
        </div>
      </div>
      ${
        d.jobs.length
          ? `<div style="margin-top:10px;display:grid;gap:8px">${d.jobs
              .map((j) => `<label class="fo-field">Sq ft em ${j.number != null ? `#${esc(j.number)}` : esc(j.title)}<input type="number" class="fo-in" data-ed-sqft="${esc(j.id)}" min="0" step="1" value="${j.sqft || ""}" placeholder="0" /></label>`)
              .join("")}</div>`
          : ""
      }
      <label class="fo-field" style="margin-top:10px">Nota<textarea class="fo-ta" id="foEdNote" maxlength="500">${esc(d.note || "")}</textarea></label>
      <p class="fo-muted" style="margin:8px 0 0;font-size:12.5px;font-weight:600">Os alertas originais continuam visíveis. Fica registrado quem alterou.</p></div>`;
  }
  async function dayApprove() {
    const d = $("foSheet")._day;
    try {
      await api(`/api/folha/dias/${d.id}/aprovar`, { method: "POST", body: "{}" });
      notify("Dia aprovado — entrou na folha.", "success");
      closeSheet();
      refreshAfterChange();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  async function dayReturn() {
    const d = $("foSheet")._day;
    const reason = ($("foReturnReason")?.value || "").trim();
    if (reason.length < 3) {
      notify("Escreva o motivo para o funcionário.", "error");
      return;
    }
    try {
      await api(`/api/folha/dias/${d.id}/devolver`, { method: "POST", body: JSON.stringify({ reason }) });
      notify("Dia devolvido — o funcionário foi avisado.", "success");
      closeSheet();
      refreshAfterChange();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  async function daySave() {
    const d = $("foSheet")._day;
    const body = { approve: true };
    const ci = $("foEdIn").value;
    const co = $("foEdOut").value;
    if (ci && ci !== d.clock_in_label) body.clock_in = ci;
    if (co && co !== d.clock_out_label) body.clock_out = co;
    body.days_worked = Number($("foEdDays").value);
    const ot = $("foEdOt").value;
    if (ot !== "") body.overtime_minutes = Math.max(0, Math.round(Number(ot)));
    const sq = [...document.querySelectorAll("[data-ed-sqft]")];
    if (sq.length) body.jobs = sq.map((el) => ({ work_order_id: el.getAttribute("data-ed-sqft"), sqft: Number(el.value) || 0 }));
    body.note = $("foEdNote").value.trim() || null;
    try {
      await api(`/api/folha/dias/${d.id}`, { method: "PUT", body: JSON.stringify(body) });
      notify("Dia corrigido e aprovado.", "success");
      closeSheet();
      refreshAfterChange();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  function refreshAfterChange() {
    st.pend = null;
    if (st.tab === "conferir") loadPend();
    loadWeek();
  }

  // ------------------------------------------------------------ pagar
  function openPay(ids) {
    const w = st.week;
    const rows = w.employees.filter((r) => ids.includes(r.id) && canPay(r));
    if (!rows.length) return;
    const total = rows.reduce((s, r) => s + r.totals.net, 0);
    const waiting = rows.filter((r) => r.totals.pending_days || r.totals.open_days);
    const methods = [...new Set(rows.map((r) => r.payment_method).filter(Boolean))];
    const defMethod = methods.length === 1 ? methods[0] : rows.length === 1 ? rows[0].payment_method || "" : "";
    const body = `<div class="fo-box"><h3>Quem recebe <small>Semana ${esc(w.week.label)}</small></h3>
        <ul class="fo-paylist">${rows.map((r) => `<li><span>${esc(r.name)} <span class="fo-muted" style="font-size:12.5px">· ${esc(SECTORS[r.sector])}</span></span><b>${money(r.totals.net)}</b></li>`).join("")}
        ${rows.length > 1 ? `<li class="tot"><span>Total</span><b>${money(total)}</b></li>` : ""}</ul></div>
      ${
        waiting.length
          ? `<div class="fo-alert"><b>${waiting.map((r) => esc(r.name)).join(", ")}</b> ainda ${waiting.length > 1 ? "têm" : "tem"} dias em conferência ou em andamento — sem marcar abaixo, ${waiting.length > 1 ? "ficam" : "fica"} de fora deste pagamento.
             <label class="fo-check" style="margin-top:8px"><input type="checkbox" id="foPayForce" /> Pagar mesmo assim só o que já está aprovado</label></div>`
          : ""
      }
      <div class="fo-box"><h3>Pagamento</h3>
        <label class="fo-field">Data do pagamento<input type="date" class="fo-in" id="foPayDate" value="${esc(w.week.pay_on || ymdOf(new Date()))}" /></label>
        <div class="fo-field" style="margin-top:10px">Forma${rows.length > 1 && methods.length > 1 ? " <small>(vazio = a forma de cada funcionário)</small>" : ""}
          <div class="fo-methods" id="foPayMethods">${METHODS.map(([k, l]) => `<button type="button" class="fo-chip" data-method="${k}" aria-pressed="${k === defMethod}">${l}</button>`).join("")}</div></div>
        <div class="fo-grid2" style="margin-top:10px"><label class="fo-field">Referência<input type="text" class="fo-in" id="foPayRef" maxlength="120" placeholder="Nº do cheque, Zelle…" /></label>
        <label class="fo-field">Observação<input type="text" class="fo-in" id="foPayNote" maxlength="500" /></label></div>
      </div>
      <p class="fo-muted" style="margin:0;font-size:13px;font-weight:600">Cada funcionário vira uma saída no Financeiro (categoria Folha · ${rows.length === 1 ? esc(SECTORS[rows[0].sector]) : "Instalação/Lixa"}). Quando todos estiverem pagos, a semana fecha.</p>`;
    openSheet(
      `${sheetHead(rows.length === 1 ? `Pagar ${esc(rows[0].name)}` : `Pagar ${rows.length} funcionários`, money(total))}<div class="fo-sheet__bd">${body}</div>
       <footer class="fo-sheet__ft"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--pri" data-pay-go>Confirmar pagamento · ${money(total)}</button></footer>`,
    );
    $("foSheet")._payIds = rows.map((r) => r.id);
  }
  async function payGo(btn) {
    const ids = $("foSheet")._payIds;
    const method = document.querySelector('#foPayMethods [aria-pressed="true"]')?.getAttribute("data-method") || null;
    const body = {
      period_id: st.week.period.id,
      employee_ids: ids,
      paid_on: $("foPayDate").value,
      method,
      reference: $("foPayRef").value.trim() || null,
      notes: $("foPayNote").value.trim() || null,
      force: Boolean($("foPayForce")?.checked),
    };
    if (!body.paid_on) {
      notify("Informe a data do pagamento.", "error");
      return;
    }
    btn.disabled = true;
    try {
      const j = await api("/api/folha/pagamentos", { method: "POST", body: JSON.stringify(body) });
      const d = j.data;
      ids.forEach((id) => st.selected.delete(id));
      if (d.paid.length) notify(`${d.paid.length === 1 ? `${d.paid[0].name} pago` : `${d.paid.length} pagos`} · ${money(d.total)} lançado no Financeiro.${d.period_closed ? " Semana fechada." : ""}`, "success");
      if (d.skipped.length) notify(`Não pagos: ${d.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`, d.paid.length ? "warning" : "error");
      closeSheet();
      st.pays = null;
      loadWeek();
    } catch (e) {
      btn.disabled = false;
      notify(e.message, "error");
    }
  }
  function openAdjust(id) {
    const r = st.week.employees.find((x) => x.id === id);
    if (!r) return;
    const dayExps = r.days
      .filter((d) => d.kind !== "line" && (d.expenses || []).length)
      .flatMap((d) =>
        (d.expenses || []).map((x) => ({
          ...x,
          date_label: d.date_label,
          day_id: d.id,
        })),
      );
    openSheet(
      `${sheetHead(`Ajustes · ${esc(r.name)}`, `Semana ${esc(st.week.week.label)}`)}<div class="fo-sheet__bd">
        ${
          dayExps.length
            ? `<div class="fo-box"><h3>Recibos dos dias</h3><ul class="fo-exp">${dayExps
                .map(
                  (x) => `<li>
                  ${x.receipt_url ? `<a class="fo-exp__img" href="${esc(x.receipt_url)}" target="_blank" rel="noopener"><img src="${esc(x.receipt_url)}" alt="" /></a>` : `<span class="fo-exp__ph">—</span>`}
                  <div><b>${x.kind === "discount" ? "−" : "+"}${money(x.amount)}</b><small>${esc(x.date_label)} · ${esc(x.status_label)}${x.description ? ` · ${esc(x.description)}` : ""}</small></div>
                </li>`,
                )
                .join("")}</ul><p class="fo-muted" style="margin:8px 0 0;font-size:12.5px;font-weight:600">Aprovar o dia (ou o lançamento) inclui o valor no pagamento. Abaixo você ajusta o total da semana.</p></div>`
            : ""
        }
        <div class="fo-box">
        <div class="fo-grid2"><label class="fo-field">Reembolso<input type="number" class="fo-in" id="foAdjR" min="0" step="0.01" value="${r.adjustment.reimbursement || ""}" placeholder="0.00" /><small>Material, gasolina, ferramenta…</small></label>
        <label class="fo-field">Desconto<input type="number" class="fo-in" id="foAdjD" min="0" step="0.01" value="${r.adjustment.discount || ""}" placeholder="0.00" /><small>Adiantamento, dano…</small></label></div>
        <label class="fo-field" style="margin-top:10px">Motivo<input type="text" class="fo-in" id="foAdjN" maxlength="500" value="${esc(r.adjustment.notes || "")}" /></label>
      </div></div>
      <footer class="fo-sheet__ft"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--pri" data-adj-go="${esc(r.id)}">Salvar</button></footer>`,
    );
  }
  function openAddExpense(dayId) {
    openSheet(
      `${sheetHead("Lançar reembolso ou desconto", "Entra no pagamento da semana ao aprovar")}<div class="fo-sheet__bd"><div class="fo-box">
        <div class="fo-chiprow" role="group" aria-label="Tipo">
          <button type="button" class="fo-chip" data-exp-kind="reimbursement" aria-pressed="true">Reembolso</button>
          <button type="button" class="fo-chip" data-exp-kind="discount" aria-pressed="false">Desconto</button>
        </div>
        <input type="hidden" id="foExpKind" value="reimbursement" />
        <div class="fo-grid2" style="margin-top:12px"><label class="fo-field">Valor ($)<input type="number" class="fo-in" id="foExpAmt" min="0" step="0.01" autofocus placeholder="0.00" /></label>
        <label class="fo-field">Descrição<input type="text" class="fo-in" id="foExpDesc" maxlength="300" placeholder="Ex.: gasolina, adiantamento…" /></label></div>
        <label class="fo-field" style="margin-top:10px">Recibo (opcional)<input type="file" class="fo-in" id="foExpFile" accept="image/*,application/pdf" /></label>
        <label class="fo-check" style="margin-top:12px"><input type="checkbox" id="foExpApprove" checked /> Aprovar e incluir no pagamento agora</label>
      </div></div>
      <footer class="fo-sheet__ft"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--pri" data-exp-go="${esc(dayId)}">Salvar</button></footer>`,
    );
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("Não deu para ler o arquivo"));
      r.readAsDataURL(file);
    });
  }
  async function expGo(dayId, btn) {
    const amount = Number($("foExpAmt")?.value || 0);
    if (!(amount > 0)) {
      notify("Informe o valor.", "error");
      return;
    }
    const body = {
      kind: $("foExpKind")?.value || "reimbursement",
      amount,
      description: ($("foExpDesc")?.value || "").trim() || null,
      approve: Boolean($("foExpApprove")?.checked),
    };
    const file = $("foExpFile")?.files?.[0];
    btn.disabled = true;
    try {
      if (file) body.receipt_data_url = await fileToDataUrl(file);
      await api(`/api/folha/dias/${dayId}/despesas`, { method: "POST", body: JSON.stringify(body) });
      notify(body.approve ? "Lançamento aprovado e incluído no pagamento." : "Lançamento salvo para conferir.", "success");
      closeSheet();
      refreshAfterChange();
      openDay(dayId);
    } catch (e) {
      btn.disabled = false;
      notify(e.message, "error");
    }
  }
  async function adjustGo(id) {
    try {
      await api(`/api/folha/semana/${st.week.period.id}/ajustes/${id}`, {
        method: "PUT",
        body: JSON.stringify({ reimbursement: Number($("foAdjR").value) || 0, discount: Number($("foAdjD").value) || 0, notes: $("foAdjN").value.trim() || null }),
      });
      notify("Ajuste salvo.", "success");
      closeSheet();
      loadWeek();
    } catch (e) {
      notify(e.message, "error");
    }
  }
  function openReceipt(id) {
    const r = st.week.employees.find((x) => x.id === id);
    if (!r || !r.payment) return;
    const p = r.payment;
    const lines = r.days
      .filter((d) => d.kind === "line" || d.status === "approved")
      .map((d) => `<li><span>${esc(d.date_label)} <span class="fo-muted" style="font-size:12.5px">${d.kind === "line" ? "· grade" : `· ${esc(d.clock_in_label || "")}–${esc(d.clock_out_label || "")}`}${d.overtime_minutes ? ` · +${hm(d.overtime_minutes)}` : ""}</span></span><b>${money(d.amount)}</b></li>`)
      .join("");
    openSheet(
      `${sheetHead(`Pagamento · ${esc(r.name)}`, `Semana ${esc(st.week.week.label)}`)}<div class="fo-sheet__bd">
        <div class="fo-box"><div class="fo-kv" style="margin:0;padding:0;border:0"><div><small>Pago em</small><b>${esc(brDate(p.paid_on))}</b></div><div><small>Forma</small><b>${esc(p.method_label || "—")}</b></div><div><small>Referência</small><b>${esc(p.reference || "—")}</b></div><div><small>Valor</small><b>${money(p.amount)}</b></div></div></div>
        <div class="fo-box"><h3>Dias pagos</h3><ul class="fo-paylist">${lines || '<li class="fo-muted">—</li>'}
          ${r.totals.reimbursement ? `<li><span>Reembolso</span><b>+${money(r.totals.reimbursement)}</b></li>` : ""}
          ${r.totals.discount ? `<li><span>Desconto</span><b>−${money(r.totals.discount)}</b></li>` : ""}
          <li class="tot"><span>Total</span><b>${money(p.amount)}</b></li></ul></div>
      </div>
      <footer class="fo-sheet__ft"><button type="button" class="fo-btn fo-btn--ghost fo-btn--danger" data-void="${esc(p.id)}">Estornar</button><button type="button" class="fo-btn" data-print>Imprimir</button><button type="button" class="fo-btn fo-btn--pri" data-close>Fechar</button></footer>`,
    );
  }
  async function voidPay(id) {
    if (!confirm("Estornar este pagamento? A saída no Financeiro é anulada e a semana volta a ficar aberta.")) return;
    try {
      await api(`/api/folha/pagamentos/${id}/estornar`, { method: "POST", body: "{}" });
      notify("Pagamento estornado.", "success");
      closeSheet();
      st.pays = null;
      if (st.tab === "pagamentos") loadPays();
      loadWeek();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  // ------------------------------------------------------------ conferir
  async function loadPend() {
    const box = $("foConferir");
    if (!st.pend) box.innerHTML = '<div class="fo-empty">Carregando…</div>';
    try {
      const j = await api("/api/folha/pendencias");
      st.pend = j.data;
      for (const id of [...st.pendSel]) if (!j.data.pending.some((d) => d.id === id)) st.pendSel.delete(id);
      renderPend();
      refreshPendCount();
    } catch (e) {
      box.innerHTML = `<div class="fo-empty"><b>Não foi possível carregar.</b>${esc(e.message)}</div>`;
    }
  }
  function pcard(d, opts) {
    const time = d.clock_in_label ? `${d.clock_in_label}–${d.clock_out_label || "…"}${d.worked_minutes ? ` · ${hm(d.worked_minutes)}` : ""}${d.overtime_minutes ? ` · +${hm(d.overtime_minutes)} extra` : ""}` : "";
    return `<div class="fo-pcard">
      ${opts.check && st.manage ? `<input type="checkbox" data-psel="${esc(d.id)}" ${st.pendSel.has(d.id) ? "checked" : ""} style="width:20px;height:20px;margin-top:2px;accent-color:#211d1a" aria-label="Selecionar" />` : `<span class="fo-av${d.sector === "sand_finish" ? " fo-av--sand" : ""}">${esc(initials(d.employee_name))}</span>`}
      <div class="fo-pcard__m" data-day="${esc(d.id)}" data-kind="day" role="button" tabindex="0">
        <b>${esc(d.employee_name)}</b> ${sectorTag(d.sector)} <span class="fo-muted" style="font-weight:700">· ${esc(d.date_label)}</span>
        <p>${esc(time)}${d.jobs.length ? ` · ${d.jobs.map((j) => (j.number != null ? `#${j.number}` : j.title)).map(esc).join(", ")}` : ""}</p>
        ${opts.reason && d.review_note ? `<p style="color:#b42318">Motivo: ${esc(d.review_note)}</p>` : ""}
        ${(d.flags || []).length ? `<div class="fo-pcard__f">${d.flags.map((f) => `<span class="fo-flag">${esc(f.label)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="fo-pcard__a"><span class="fo-pcard__v">${money(d.amount)}</span>${opts.check && st.manage ? `<button type="button" class="fo-btn fo-btn--sm" data-papprove="${esc(d.id)}">Aprovar</button>` : ""}</div>
    </div>`;
  }
  function renderPend() {
    const p = st.pend;
    const box = $("foConferir");
    const sel = p.pending.filter((d) => st.pendSel.has(d.id)).length;
    let html = `<div class="fo-sec-t"><span>Para conferir · ${p.pending.length}</span>${
      st.manage && p.pending.length
        ? `<span style="display:flex;gap:6px"><button type="button" class="fo-btn fo-btn--sm fo-btn--ghost" data-pselall>${sel === p.pending.length ? "Desmarcar" : "Marcar todos"}</button><button type="button" class="fo-btn fo-btn--sm fo-btn--pri" data-papprove-sel ${sel ? "" : "disabled"}>Aprovar ${sel || ""}</button></span>`
        : ""
    }</div>`;
    html += p.pending.length
      ? `<div class="fo-pend">${p.pending.map((d) => pcard(d, { check: true })).join("")}</div>`
      : '<div class="fo-card"><div class="fo-empty"><b>Nada para conferir.</b>Dias com fotos, GPS no local e horário normal entram sozinhos na folha. Aqui ficam só os que precisam do seu olho.</div></div>';
    if (p.returned.length) html += `<div class="fo-sec-t"><span>Devolvidos · aguardando o funcionário · ${p.returned.length}</span></div><div class="fo-pend">${p.returned.map((d) => pcard(d, { reason: true })).join("")}</div>`;
    html += `<div class="fo-sec-t"><span>Trabalhando agora · ${p.working_now.length}</span></div>`;
    html += p.working_now.length
      ? `<div class="fo-pend">${p.working_now
          .map(
            (d) => `<div class="fo-pcard"><span class="fo-av${d.sector === "sand_finish" ? " fo-av--sand" : ""}">${esc(initials(d.employee_name))}</span><div class="fo-pcard__m" data-day="${esc(d.id)}" data-kind="day" role="button" tabindex="0"><b>${esc(d.employee_name)}</b> ${sectorTag(d.sector)}<p>Começou ${esc(d.date_label)} às ${esc(d.clock_in_label || "—")}${d.jobs.length ? ` · ${d.jobs.map((j) => (j.number != null ? `#${j.number} ${j.title}` : j.title)).map(esc).join(", ")}` : ""}</p>${
              d.gps_in && d.gps_in.distance_m != null && d.gps_in.distance_m > FAR_M ? `<div class="fo-pcard__f"><span class="fo-flag">${esc(distLabel(d.gps_in.distance_m))}</span></div>` : ""
            }</div><div class="fo-pcard__a"><span class="fo-pill fo-pill--info">Em andamento</span></div></div>`,
          )
          .join("")}</div>`
      : '<div class="fo-card"><div class="fo-empty">Ninguém com o dia aberto agora.</div></div>';
    box.innerHTML = html;
  }
  async function approveMany(ids) {
    if (!ids.length) return;
    try {
      const j = await api("/api/folha/dias/aprovar-lote", { method: "POST", body: JSON.stringify({ ids }) });
      const bad = j.data.results.filter((r) => !r.ok);
      notify(`${j.data.approved} dia${j.data.approved === 1 ? "" : "s"} aprovado${j.data.approved === 1 ? "" : "s"}.`, "success");
      if (bad.length) notify(`${bad.length} não aprovado${bad.length > 1 ? "s" : ""}: ${bad[0].error}`, "warning");
      ids.forEach((id) => st.pendSel.delete(id));
      loadPend();
      loadWeek();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  // ------------------------------------------------------------ períodos (presets)
  function presetRange(key) {
    const t = new Date();
    const y = t.getFullYear();
    const m = t.getMonth();
    if (key === "month") return [ymdOf(new Date(y, m, 1)), ymdOf(t)];
    if (key === "last_month") return [ymdOf(new Date(y, m - 1, 1)), ymdOf(new Date(y, m, 0))];
    if (key === "quarter") return [ymdOf(new Date(y, Math.floor(m / 3) * 3, 1)), ymdOf(t)];
    if (key === "last_year") return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    return [`${y}-01-01`, ymdOf(t)];
  }
  const PRESETS = [
    ["month", "Este mês"],
    ["last_month", "Mês passado"],
    ["quarter", "Trimestre"],
    ["year", "Este ano"],
    ["last_year", "Ano passado"],
  ];

  // ------------------------------------------------------------ pagamentos
  async function loadPays() {
    const box = $("foPagamentos");
    const [from, to] = presetRange(st.payPreset);
    if (!st.pays) box.innerHTML = '<div class="fo-empty">Carregando…</div>';
    try {
      const j = await api(`/api/folha/relatorio?from=${from}&to=${to}`);
      st.pays = j.data;
      renderPays();
    } catch (e) {
      box.innerHTML = `<div class="fo-empty"><b>Não foi possível carregar.</b>${esc(e.message)}</div>`;
    }
  }
  function renderPays() {
    const d = st.pays;
    const list = d.payments;
    const total = list.reduce((s, p) => s + p.amount, 0);
    const bySector = (k) => list.filter((p) => p.sector === k).reduce((s, p) => s + p.amount, 0);
    $("foPagamentos").innerHTML = `<div class="fo-presets">${PRESETS.map(([k, l]) => `<button type="button" class="fo-chip" data-paypreset="${k}" aria-pressed="${st.payPreset === k}">${l}</button>`).join("")}</div>
      <div class="fo-stats">
        <div class="fo-stat fo-stat--ink"><small>Pago no período</small><b>${money(total)}</b><span>${list.length} pagamento${list.length === 1 ? "" : "s"}</span></div>
        <div class="fo-stat"><small>Instalação</small><b>${money(bySector("installation"))}</b><span>&nbsp;</span></div>
        <div class="fo-stat"><small>Lixa</small><b>${money(bySector("sand_finish"))}</b><span>&nbsp;</span></div>
        <div class="fo-stat"><small>Período</small><b style="font-size:16px">${esc(brShort(d.filter.from))} – ${esc(brShort(d.filter.to))}</b><span>pela data do pagamento</span></div>
      </div>
      <div class="fo-card">${
        list.length
          ? `<table class="fo-tbl fo-tbl--scroll"><thead><tr><th>Data</th><th>Funcionário</th><th>Setor</th><th>Semana</th><th>Forma</th><th>Referência</th><th class="r">Valor</th><th></th></tr></thead><tbody>${list
              .map(
                (p) => `<tr><td>${esc(brDate(p.paid_on))}</td><td class="fo-strong">${esc(p.name)}</td><td>${sectorTag(p.sector)}</td><td><button type="button" class="fo-link" data-gotoweek="${esc(p.week_start)}">${esc(p.week)}</button></td><td>${esc(p.method_label || "—")}</td><td>${esc(p.reference || "—")}</td><td class="r fo-strong">${money(p.amount)}</td><td class="r">${st.manage ? `<button type="button" class="fo-btn fo-btn--sm fo-btn--ghost fo-btn--danger" data-void="${esc(p.id)}">Estornar</button>` : ""}</td></tr>`,
              )
              .join("")}</tbody><tfoot><tr><td colspan="6">Total</td><td class="r">${money(total)}</td><td></td></tr></tfoot></table>`
          : '<div class="fo-empty"><b>Nenhum pagamento no período.</b>Pague pela aba Semana — cada pagamento aparece aqui e no Financeiro.</div>'
      }</div>
      <p class="fo-muted" style="font-size:13px;font-weight:600;margin:10px 2px 0">Estornar anula a saída no Financeiro e reabre a semana para correção.</p>`;
  }

  // ------------------------------------------------------------ relatórios
  async function ensureEmps() {
    if (st.emps) return st.emps;
    const j = await api("/api/folha/funcionarios");
    st.emps = j.data;
    return st.emps;
  }
  function repQuery() {
    const r = st.rep;
    if (r.preset !== "custom") [r.from, r.to] = presetRange(r.preset);
    const q = new URLSearchParams({ from: r.from, to: r.to });
    if (r.employee) q.set("employee_id", r.employee);
    if (r.sector) q.set("sector", r.sector);
    return q.toString();
  }
  async function loadReport() {
    const box = $("foRelatorios");
    if (!st.report) box.innerHTML = '<div class="fo-empty">Carregando…</div>';
    try {
      await ensureEmps().catch(() => null);
      const j = await api(`/api/folha/relatorio?${repQuery()}`);
      st.report = j.data;
      renderReport();
    } catch (e) {
      box.innerHTML = `<div class="fo-empty"><b>Não foi possível carregar.</b>${esc(e.message)}</div>`;
    }
  }
  function renderReport() {
    const d = st.report;
    const r = st.rep;
    const t = d.totals;
    const emps = st.emps ? st.emps.employees : [];
    const csv = (kind) => `/api/folha/relatorio?${repQuery()}&format=csv&kind=${kind}`;
    const one = r.employee ? d.employees[0] : null;
    $("foRelatorios").innerHTML = `<div class="fo-tool"><div class="fo-presets" style="margin:0">${PRESETS.map(([k, l]) => `<button type="button" class="fo-chip" data-preset="${k}" aria-pressed="${r.preset === k}">${l}</button>`).join("")}</div>
        <div class="fo-dl"><a class="fo-btn fo-btn--sm" href="${csv("employees")}" download>⤓ CSV funcionários</a><a class="fo-btn fo-btn--sm" href="${csv("payments")}" download>⤓ CSV pagamentos</a><a class="fo-btn fo-btn--sm" href="${csv("jobs")}" download>⤓ CSV jobs</a></div></div>
      <div class="fo-filters">
        <label class="fo-field">Funcionário<select class="fo-sel" id="foRepEmp"><option value="">Todos</option>${emps.map((e) => `<option value="${esc(e.id)}"${r.employee === e.id ? " selected" : ""}>${esc(e.name)}${e.status !== "active" ? " (inativo)" : ""}</option>`).join("")}</select></label>
        <label class="fo-field">Setor<select class="fo-sel" id="foRepSector"><option value="">Todos</option><option value="installation"${r.sector === "installation" ? " selected" : ""}>Instalação</option><option value="sand_finish"${r.sector === "sand_finish" ? " selected" : ""}>Lixa</option></select></label>
        <label class="fo-field">De<input type="date" class="fo-in" id="foRepFrom" value="${esc(d.filter.from)}" /></label>
        <label class="fo-field">Até<input type="date" class="fo-in" id="foRepTo" value="${esc(d.filter.to)}" /></label>
      </div>
      <div class="fo-stats">
        <div class="fo-stat fo-stat--ink"><small>Pago no período</small><b>${money(t.paid)}</b><span>base para 1099 / impostos</span></div>
        <div class="fo-stat"><small>Ganho (dias aprovados)</small><b>${money(t.earned)}</b><span>${qty(t.days)} dias${t.sqft ? ` · ${qty(t.sqft)} sq ft` : ""}</span></div>
        <div class="fo-stat"><small>Reembolsos − descontos</small><b>${money(t.reimbursement - t.discount)}</b><span>${money(t.reimbursement)} − ${money(t.discount)}</span></div>
        <div class="fo-stat"><small>Horas extras</small><b>${hm(t.overtime_hours * 60)}</b><span>${t.employees} funcionário${t.employees === 1 ? "" : "s"}</span></div>
      </div>
      ${one ? `<div class="fo-alert" style="margin-bottom:14px"><b>${esc(one.name)}</b> · ${esc(SECTORS[one.sector])} · ${one.email ? esc(one.email) : "sem e-mail"}${one.phone ? ` · ${esc(one.phone)}` : ""} — pago ${money(one.paid)} em ${one.payments} pagamento${one.payments === 1 ? "" : "s"} de ${esc(brDate(d.filter.from))} a ${esc(brDate(d.filter.to))}.</div>` : ""}
      <div class="fo-card"><div class="fo-card__hd"><h2>Por funcionário</h2><span>Ganho pela data do trabalho · pago pela data do pagamento</span></div>${
        d.employees.length
          ? `<table class="fo-tbl fo-tbl--scroll"><thead><tr><th>Funcionário</th><th>Setor</th><th class="r">Dias</th><th class="r">Extra</th><th class="r">Sq ft</th><th class="r">Ganho</th><th class="r">Reemb.</th><th class="r">Desc.</th><th class="r">Pago</th></tr></thead><tbody>${d.employees
              .map(
                (e) => `<tr class="is-row" data-repemp="${esc(e.id)}"><td class="fo-strong">${esc(e.name)}</td><td>${sectorTag(e.sector)}</td><td class="r">${qty(e.days)}</td><td class="r">${e.overtime_hours ? hm(e.overtime_hours * 60) : "—"}</td><td class="r">${e.sqft ? qty(e.sqft) : "—"}</td><td class="r">${money(e.earned)}</td><td class="r">${e.reimbursement ? money(e.reimbursement) : "—"}</td><td class="r">${e.discount ? money(e.discount) : "—"}</td><td class="r fo-strong">${money(e.paid)}</td></tr>`,
              )
              .join("")}</tbody><tfoot><tr><td colspan="2">Total</td><td class="r">${qty(t.days)}</td><td class="r">${hm(t.overtime_hours * 60)}</td><td class="r">${t.sqft ? qty(t.sqft) : "—"}</td><td class="r">${money(t.earned)}</td><td class="r">${money(t.reimbursement)}</td><td class="r">${money(t.discount)}</td><td class="r">${money(t.paid)}</td></tr></tfoot></table>`
          : '<div class="fo-empty">Nada no período com esses filtros.</div>'
      }</div>
      <div class="fo-card"><div class="fo-card__hd"><h2>Mão de obra por job</h2><span>Valor do dia dividido entre os jobs do dia (por sq ft na produção)</span></div>${
        d.jobs.length
          ? `<table class="fo-tbl fo-tbl--scroll"><thead><tr><th>Job</th><th class="r">Dias-pessoa</th><th class="r">Pessoas</th><th class="r">Sq ft</th><th class="r">Custo</th></tr></thead><tbody>${d.jobs
              .slice(0, 50)
              .map((j) => `<tr><td><a class="fo-link" href="job-detail.html?id=${esc(j.id)}">${j.number != null ? `#${esc(j.number)} ` : ""}${esc(j.title)}</a></td><td class="r">${qty(j.days)}</td><td class="r">${j.people}</td><td class="r">${j.sqft ? qty(j.sqft) : "—"}</td><td class="r fo-strong">${money(j.cost)}</td></tr>`)
              .join("")}</tbody></table>`
          : '<div class="fo-empty">Os jobs aparecem aqui quando os dias de trabalho com jobs são aprovados.</div>'
      }</div>`;
  }

  // ------------------------------------------------------------ funcionários
  async function loadEmps() {
    const box = $("foFuncionarios");
    if (!st.emps) box.innerHTML = '<div class="fo-empty">Carregando…</div>';
    try {
      const j = await api("/api/folha/funcionarios");
      st.emps = j.data;
      renderEmps();
    } catch (e) {
      box.innerHTML = `<div class="fo-empty"><b>Não foi possível carregar.</b>${esc(e.message)}</div>`;
    }
  }
  function schedLabel(e) {
    const s = e.schedule;
    const start = s.start_mode === "job" ? "início no job" : s.start_time;
    return `${start} → ${s.end_time}${s.lunch_minutes ? ` · almoço ${s.lunch_minutes}min` : ""}`;
  }
  function renderEmps() {
    const list = st.emps.employees;
    const by = (k) => list.filter((e) => e.status === "active" && (e.sector || "installation") === k).length;
    $("foFuncionarios").innerHTML = `<div class="fo-tool"><div class="fo-muted" style="font-weight:700;font-size:14px">${list.filter((e) => e.status === "active").length} ativos · ${by("installation")} Instalação · ${by("sand_finish")} Lixa</div>${
      st.manage ? '<button type="button" class="fo-btn fo-btn--pri" data-emp-new>+ Novo funcionário</button>' : ""
    }</div>
      <div class="fo-card">${
        list.length
          ? `<table class="fo-tbl fo-tbl--scroll"><thead><tr><th>Funcionário</th><th>Setor</th><th>Pagamento</th><th>Horário padrão</th><th>Login no app</th><th>Status</th></tr></thead><tbody>${list
              .map((e) => {
                const ph = e.phone && typeof window.sfFormatPhone === "function" ? window.sfFormatPhone(e.phone) || e.phone : e.phone;
                return `<tr class="is-row" data-emp-edit="${esc(e.id)}"><td><div class="fo-name"><span class="fo-av${e.sector === "sand_finish" ? " fo-av--sand" : ""}">${esc(initials(e.name))}</span><span><b>${esc(e.name)}</b><small>${esc(e.role_title || ph || e.email || "")}</small></span></div></td>
                <td>${e.sector ? sectorTag(e.sector) : '<span class="fo-pill fo-pill--due">Definir</span>'}</td>
                <td>${e.pay_type === "production" ? `Produção · ${money(e.production_rate)}/sq ft` : `Diária · ${money0(e.daily_rate)}`}<div class="fo-muted" style="font-size:12px">extra ${money(e.overtime_rate)}/h${e.payment_method ? ` · ${esc(METHOD_LABEL[e.payment_method] || e.payment_method)}` : ""}</div></td>
                <td>${esc(schedLabel(e))}<div class="fo-muted" style="font-size:12px">${[e.require_photos ? "fotos obrigatórias" : "", e.require_gps ? "GPS" : ""].filter(Boolean).join(" · ") || "sem exigências"}</div></td>
                <td>${e.user ? esc(e.user.name || e.user.email) : '<span class="fo-pill fo-pill--due">Sem login</span>'}</td>
                <td>${e.status === "active" ? '<span class="fo-pill fo-pill--muted">Ativo</span>' : '<span class="fo-pill fo-pill--red">Inativo</span>'}</td></tr>`;
              })
              .join("")}</tbody></table>`
          : '<div class="fo-empty"><b>Nenhum funcionário ainda.</b>Cadastre a equipe com setor, diária e horário padrão.</div>'
      }</div>
      <p class="fo-muted" style="font-size:13px;font-weight:600;margin:10px 2px 0">Sem login no app, o funcionário não bate o ponto pelo celular — o escritório lança os dias em "+ Lançar dia".</p>`;
  }
  function openEmp(id) {
    const e = id ? st.emps.employees.find((x) => x.id === id) : null;
    const users = st.emps.users || [];
    const v = e || { name: "", sector: "installation", pay_type: "daily", daily_rate: 0, overtime_rate: 0, production_rate: 0, payment_method: "zelle", status: "active", schedule: { start_mode: "job", start_time: "07:00", end_time: "17:00", lunch_minutes: 0, count_early_start: false }, require_photos: true, require_gps: true, user: null };
    const s = v.schedule;
    const dis = st.manage ? "" : "disabled";
    const body = `<div class="fo-box"><h3>Dados</h3>
        <label class="fo-field">Nome<input type="text" class="fo-in" id="feName" value="${esc(v.name)}" maxlength="120" autofocus ${dis} /></label>
        <div class="fo-grid2" style="margin-top:10px"><label class="fo-field">Telefone<input type="tel" class="fo-in" id="fePhone" value="${esc(typeof window.sfFormatPhone === "function" ? window.sfFormatPhone(v.phone) || v.phone || "" : v.phone || "")}" ${dis} /></label><label class="fo-field">E-mail<input type="email" class="fo-in" id="feEmail" value="${esc(v.email || "")}" ${dis} /></label></div>
        <div class="fo-grid2" style="margin-top:10px"><label class="fo-field">Função<input type="text" class="fo-in" id="feRole" value="${esc(v.role_title || "")}" maxlength="80" placeholder="Instalador, ajudante…" ${dis} /></label>
        <label class="fo-field">Setor da folha<select class="fo-sel" id="feSector" ${dis}><option value="installation"${v.sector !== "sand_finish" ? " selected" : ""}>Instalação</option><option value="sand_finish"${v.sector === "sand_finish" ? " selected" : ""}>Lixa</option></select></label></div>
      </div>
      <div class="fo-box"><h3>Pagamento</h3>
        <div class="fo-grid2"><label class="fo-field">Tipo<select class="fo-sel" id="fePayType" ${dis}><option value="daily"${v.pay_type !== "production" ? " selected" : ""}>Diária</option><option value="production"${v.pay_type === "production" ? " selected" : ""}>Produção (sq ft)</option></select></label>
        <label class="fo-field">Forma de pagamento<select class="fo-sel" id="feMethod" ${dis}><option value="">—</option>${METHODS.map(([k, l]) => `<option value="${k}"${v.payment_method === k ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <div class="fo-grid3" style="margin-top:10px"><label class="fo-field">Diária ($)<input type="number" class="fo-in" id="feDaily" min="0" step="1" value="${v.daily_rate || ""}" ${dis} /></label>
        <label class="fo-field">Extra ($/hora)<input type="number" class="fo-in" id="feOt" min="0" step="0.5" value="${v.overtime_rate || ""}" placeholder="10% da diária" ${dis} /></label>
        <label class="fo-field">Produção ($/sq ft)<input type="number" class="fo-in" id="feProd" min="0" step="0.01" value="${v.production_rate || ""}" ${dis} /></label></div>
      </div>
      <div class="fo-box"><h3>Horário padrão</h3>
        <div class="fo-grid2"><label class="fo-field">Início do dia<select class="fo-sel" id="feStartMode" ${dis}><option value="job"${s.start_mode === "job" ? " selected" : ""}>Hora do 1º job agendado</option><option value="fixed"${s.start_mode === "fixed" ? " selected" : ""}>Horário fixo</option></select></label>
        <label class="fo-field">${s.start_mode === "job" ? "Se não tiver job agendado" : "Começa às"}<input type="time" class="fo-in" id="feStart" value="${esc(s.start_time)}" ${dis} /></label></div>
        <div class="fo-grid2" style="margin-top:10px"><label class="fo-field">Termina às<input type="time" class="fo-in" id="feEnd" value="${esc(s.end_time)}" ${dis} /><small>Depois disso conta hora extra</small></label>
        <label class="fo-field">Almoço (min)<input type="number" class="fo-in" id="feLunch" min="0" max="180" step="15" value="${s.lunch_minutes || 0}" ${dis} /><small>Descontado das horas trabalhadas</small></label></div>
        <label class="fo-check" style="margin-top:10px"><input type="checkbox" id="feEarly" ${s.count_early_start ? "checked" : ""} ${dis} /> Contar como extra o tempo antes do início</label>
      </div>
      <div class="fo-box"><h3>Regras para finalizar o dia</h3>
        <label class="fo-check"><input type="checkbox" id="fePhotos" ${v.require_photos ? "checked" : ""} ${dis} /> Exigir pelo menos 1 foto de hoje em cada job</label>
        <label class="fo-check" style="margin-top:8px"><input type="checkbox" id="feGps" ${v.require_gps ? "checked" : ""} ${dis} /> Pegar a localização ao começar e finalizar</label>
      </div>
      <div class="fo-box"><h3>Acesso</h3>
        <label class="fo-field">Login no app (para bater o ponto)<select class="fo-sel" id="feUser" ${dis}><option value="">Sem login</option>${users
          .filter((u) => !u.linked || (v.user && v.user.id === u.id))
          .map((u) => `<option value="${esc(u.id)}"${v.user && v.user.id === u.id ? " selected" : ""}>${esc(u.name || u.email)}${u.name ? ` · ${esc(u.email)}` : ""}</option>`)
          .join("")}</select><small>Só aparecem usuários que ainda não estão ligados a outro funcionário.</small></label>
        ${e ? `<label class="fo-check" style="margin-top:10px"><input type="checkbox" id="feActive" ${v.status === "active" ? "checked" : ""} ${dis} /> Ativo (inativos não aparecem na semana, mas o histórico fica)</label>` : ""}
      </div>`;
    openSheet(
      `${sheetHead(e ? esc(e.name) : "Novo funcionário", e ? esc(SECTORS[e.sector || "installation"]) : "Setor, pagamento e horário padrão")}<div class="fo-sheet__bd">${body}</div>
       <footer class="fo-sheet__ft"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button>${st.manage ? `<button type="button" class="fo-btn fo-btn--pri" data-emp-save="${esc(e ? e.id : "")}">Salvar</button>` : ""}</footer>`,
    );
  }
  async function saveEmp(id) {
    const val = (x) => $(x)?.value;
    const name = (val("feName") || "").trim();
    if (name.length < 2) {
      notify("Informe o nome.", "error");
      return;
    }
    const body = {
      name,
      phone: val("fePhone").trim() || null,
      email: val("feEmail").trim() || "",
      role_title: val("feRole").trim() || null,
      sector: val("feSector"),
      pay_type: val("fePayType"),
      payment_method: val("feMethod") || null,
      daily_rate: Number(val("feDaily")) || 0,
      overtime_rate: val("feOt") === "" ? null : Number(val("feOt")) || 0,
      production_rate: Number(val("feProd")) || 0,
      schedule: {
        start_mode: val("feStartMode"),
        start_time: val("feStart") || "07:00",
        end_time: val("feEnd") || "17:00",
        lunch_minutes: Math.max(0, Math.round(Number(val("feLunch")) || 0)),
        count_early_start: $("feEarly").checked,
      },
      require_photos: $("fePhotos").checked,
      require_gps: $("feGps").checked,
      user_id: val("feUser") || null,
    };
    if ($("feActive")) body.status = $("feActive").checked ? "active" : "inactive";
    try {
      await api(id ? `/api/folha/funcionarios/${id}` : "/api/folha/funcionarios", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
      notify(id ? "Funcionário salvo." : "Funcionário cadastrado.", "success");
      closeSheet();
      st.emps = null;
      loadEmps();
      st.week = null;
    } catch (e) {
      notify(e.message, "error");
    }
  }

  // ------------------------------------------------------------ lançar dia
  async function jobsAround(date) {
    if (st.jobsCache[date]) return st.jobsCache[date];
    const from = `${addDays(date, -10)}T00:00:00`;
    const to = `${addDays(date, 10)}T23:59:59`;
    const j = await api(`/api/work-orders?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`).catch(() => ({ data: [] }));
    const list = (j.data || []).filter((w) => w.status !== "canceled").map((w) => ({ id: w.id, label: `${w.number != null ? `#${w.number} ` : ""}${w.title}` }));
    st.jobsCache[date] = list;
    return list;
  }
  async function openLogDay(prefill) {
    await ensureEmps().catch(() => null);
    const emps = (st.emps ? st.emps.employees : []).filter((e) => e.status === "active");
    const date = (prefill && prefill.date) || ymdOf(new Date());
    const fromDef = date;
    const toDef = date;
    openSheet(
      `${sheetHead("Lançar diárias", "Um dia ou vários de uma vez — mesmo horário para todos")}<div class="fo-sheet__bd">
        <div class="fo-box">
          <div class="fo-seg" id="ldMode" role="group" aria-label="Modo de lançamento" style="margin-bottom:12px">
            <button type="button" data-ld-mode="one" aria-pressed="true">Um dia</button>
            <button type="button" data-ld-mode="multi" aria-pressed="false">Vários dias</button>
          </div>
          <label class="fo-field">Funcionário<select class="fo-sel" id="ldEmp" autofocus><option value="">Escolha…</option>${emps.map((e) => `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(SECTORS[e.sector || "installation"])}</option>`).join("")}</select></label>
          <div class="fo-grid3" id="ldSingleRow" style="margin-top:10px">
            <label class="fo-field">Data<input type="date" class="fo-in" id="ldDate" value="${esc(date)}" max="${ymdOf(new Date())}" /></label>
            <label class="fo-field">Entrada<input type="time" class="fo-in" id="ldIn" value="07:00" /></label>
            <label class="fo-field">Saída<input type="time" class="fo-in" id="ldOut" value="17:00" /></label>
          </div>
          <div id="ldMultiRow" hidden style="margin-top:10px">
            <div class="fo-grid3">
              <label class="fo-field">De<input type="date" class="fo-in" id="ldFrom" value="${esc(fromDef)}" max="${ymdOf(new Date())}" /></label>
              <label class="fo-field">Até<input type="date" class="fo-in" id="ldTo" value="${esc(toDef)}" max="${ymdOf(new Date())}" /></label>
              <label class="fo-field">Entrada<input type="time" class="fo-in" id="ldInMulti" value="07:00" /></label>
            </div>
            <div class="fo-grid3" style="margin-top:8px">
              <label class="fo-field">Saída<input type="time" class="fo-in" id="ldOutMulti" value="17:00" /></label>
              <label class="fo-check" style="align-self:end;padding-bottom:8px"><input type="checkbox" id="ldSkipWe" checked /> <span>Só dias úteis</span></label>
              <p class="fo-muted" id="ldMultiHint" style="margin:0;align-self:end;padding-bottom:10px;font-size:13px;font-weight:700">1 dia</p>
            </div>
          </div>
          <div style="margin-top:12px">
            <div class="fo-field"><span>Diária (por dia)</span></div>
            <div class="fo-chiprow" id="ldDaysRow" role="group" aria-label="Quantidade de diárias">
              <button type="button" class="fo-chip" data-ld-days="0.5" aria-pressed="false">½ dia</button>
              <button type="button" class="fo-chip" data-ld-days="1" aria-pressed="true">1 diária</button>
              <button type="button" class="fo-chip" data-ld-days="2" aria-pressed="false" title="Duas diárias no mesmo dia">Double</button>
            </div>
            <input type="hidden" id="ldDays" value="1" />
          </div>
          <div style="margin-top:12px">
            <div class="fo-field"><span>Hora extra</span><small id="ldOtLabel">Nenhuma — ou calcula pelo horário</small></div>
            <div class="fo-chiprow" role="group" aria-label="Adicionar hora extra">
              <button type="button" class="fo-chip" data-ld-ot="30">+½ h</button>
              <button type="button" class="fo-chip" data-ld-ot="60">+1 h</button>
              <button type="button" class="fo-chip" data-ld-ot-clear hidden>Limpar</button>
            </div>
            <input type="hidden" id="ldOt" value="" />
          </div>
        </div>
        <div class="fo-box"><h3>Jobs do dia <small>opcional · igual em todos os dias</small></h3><div class="fo-jobpick" id="ldJobs"></div><button type="button" class="fo-btn fo-btn--sm" data-ld-addjob style="margin-top:8px">+ Job</button></div>
        <div class="fo-box"><label class="fo-field">Nota<textarea class="fo-ta" id="ldNote" maxlength="500" placeholder="Ex.: esqueceu o celular; confirmado com o líder."></textarea></label></div>
        <p class="fo-muted" style="margin:0;font-size:13px;font-weight:600">Entra aprovado na folha, marcado como lançado pelo escritório. Sem hora extra manual, o sistema calcula pelo horário padrão do funcionário.</p>
      </div>
      <footer class="fo-sheet__ft"><button type="button" class="fo-btn fo-btn--ghost" data-close>Cancelar</button><button type="button" class="fo-btn fo-btn--pri" data-ld-go id="ldGoBtn">Lançar</button></footer>`,
    );
    if (prefill && prefill.employee) $("ldEmp").value = prefill.employee;
    ldSyncMultiHint();
  }

  function ldMode() {
    const btn = document.querySelector("#ldMode [aria-pressed='true']");
    return btn?.getAttribute("data-ld-mode") === "multi" ? "multi" : "one";
  }

  function ldSetMode(mode) {
    const multi = mode === "multi";
    document.querySelectorAll("#ldMode [data-ld-mode]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-ld-mode") === (multi ? "multi" : "one")));
    });
    const single = $("ldSingleRow");
    const multiRow = $("ldMultiRow");
    if (single) single.hidden = multi;
    if (multiRow) multiRow.hidden = !multi;
    if (multi) {
      // Keep times in sync when switching
      if ($("ldInMulti") && $("ldIn")) $("ldInMulti").value = $("ldIn").value || "07:00";
      if ($("ldOutMulti") && $("ldOut")) $("ldOutMulti").value = $("ldOut").value || "17:00";
      if ($("ldFrom") && $("ldDate")) $("ldFrom").value = $("ldDate").value;
      if ($("ldTo") && !$("ldTo").value) $("ldTo").value = $("ldFrom")?.value || ymdOf(new Date());
    } else if ($("ldDate") && $("ldFrom")) {
      $("ldDate").value = $("ldFrom").value || $("ldDate").value;
      if ($("ldIn") && $("ldInMulti")) $("ldIn").value = $("ldInMulti").value || $("ldIn").value;
      if ($("ldOut") && $("ldOutMulti")) $("ldOut").value = $("ldOutMulti").value || $("ldOut").value;
    }
    ldSyncMultiHint();
  }

  function ldExpandDates(fromYmd, toYmd, skipWeekends) {
    const out = [];
    if (!fromYmd || !toYmd) return out;
    let a = fromYmd;
    let b = toYmd;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    const cur = new Date(`${a}T12:00:00`);
    const end = new Date(`${b}T12:00:00`);
    const today = ymdOf(new Date());
    while (cur.getTime() <= end.getTime()) {
      const y = ymdOf(cur);
      if (y > today) break;
      const dow = cur.getDay();
      if (!(skipWeekends && (dow === 0 || dow === 6))) out.push(y);
      cur.setDate(cur.getDate() + 1);
      if (out.length >= 31) break;
    }
    return out;
  }

  function ldSyncMultiHint() {
    const hint = $("ldMultiHint");
    const go = $("ldGoBtn");
    if (ldMode() !== "multi") {
      if (go) go.textContent = "Lançar";
      return;
    }
    const dates = ldExpandDates($("ldFrom")?.value, $("ldTo")?.value, !!$("ldSkipWe")?.checked);
    if (hint) {
      hint.textContent =
        dates.length === 0
          ? "Nenhuma data"
          : dates.length === 1
            ? "1 dia"
            : `${dates.length} dias`;
    }
    if (go) go.textContent = dates.length > 1 ? `Lançar ${dates.length} dias` : "Lançar";
  }
  function ldSyncOtLabel() {
    const raw = $("ldOt")?.value;
    const lab = $("ldOtLabel");
    const clear = document.querySelector("[data-ld-ot-clear]");
    if (!lab) return;
    if (raw === "" || raw == null) {
      lab.textContent = "Nenhuma — ou calcula pelo horário";
      if (clear) clear.hidden = true;
      return;
    }
    const min = Math.max(0, Math.round(Number(raw) || 0));
    lab.textContent = min ? `+${hm(min)}` : "0 min";
    if (clear) clear.hidden = false;
  }
  function ldSetDays(v) {
    const n = Number(v);
    const days = n === 0.5 || n === 2 ? n : 1;
    if ($("ldDays")) $("ldDays").value = String(days);
    document.querySelectorAll("[data-ld-days]").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-ld-days")) === days));
    });
  }
  function ldAddOt(addMin) {
    const el = $("ldOt");
    if (!el) return;
    const cur = el.value === "" ? 0 : Math.max(0, Math.round(Number(el.value) || 0));
    el.value = String(Math.min(16 * 60, cur + Math.max(0, Math.round(Number(addMin) || 0))));
    ldSyncOtLabel();
  }
  function ldClearOt() {
    if ($("ldOt")) $("ldOt").value = "";
    ldSyncOtLabel();
  }
  async function ldAddJob() {
    const date =
      (ldMode() === "multi" ? $("ldFrom")?.value : $("ldDate")?.value) || ymdOf(new Date());
    const jobs = await jobsAround(date);
    const row = document.createElement("div");
    row.className = "fo-jobpick__row";
    row.innerHTML = `<select class="fo-sel" data-ld-job><option value="">Job…</option>${jobs.map((j) => `<option value="${esc(j.id)}">${esc(j.label)}</option>`).join("")}</select><input type="number" class="fo-in" data-ld-sqft min="0" step="1" placeholder="sq ft" /><button type="button" class="fo-ic" data-ld-rm aria-label="Remover">×</button>`;
    $("ldJobs").appendChild(row);
  }
  async function ldGo(btn) {
    const multi = ldMode() === "multi";
    const otRaw = $("ldOt")?.value;
    const start = multi ? $("ldInMulti")?.value : $("ldIn")?.value;
    const end = multi ? $("ldOutMulti")?.value : $("ldOut")?.value;
    const body = {
      employee_id: $("ldEmp").value,
      start,
      end,
      days_worked: Number($("ldDays").value),
      jobs: [...document.querySelectorAll("#ldJobs .fo-jobpick__row")]
        .map((r) => ({ work_order_id: r.querySelector("[data-ld-job]").value, sqft: Number(r.querySelector("[data-ld-sqft]").value) || 0 }))
        .filter((j) => j.work_order_id),
      note: $("ldNote").value.trim() || null,
    };
    if (otRaw !== "" && otRaw != null) body.overtime_minutes = Math.max(0, Math.round(Number(otRaw) || 0));
    if (!body.employee_id || !body.start || !body.end) {
      notify("Escolha o funcionário, a data, a entrada e a saída.", "error");
      return;
    }
    btn.disabled = true;
    try {
      if (multi) {
        const dates = ldExpandDates($("ldFrom")?.value, $("ldTo")?.value, !!$("ldSkipWe")?.checked);
        if (!dates.length) {
          btn.disabled = false;
          notify("Escolha um período com pelo menos um dia válido.", "error");
          return;
        }
        const j = await api("/api/folha/dias/lote", { method: "POST", body: JSON.stringify({ ...body, dates }) });
        const created = j.data?.created || 0;
        const skipped = (j.data?.results || []).filter((r) => !r.ok);
        const exists = skipped.filter((r) => r.code === "DAY_EXISTS").length;
        const other = skipped.length - exists;
        let msg = created === 1 ? "1 dia lançado e aprovado." : `${created} dias lançados e aprovados.`;
        if (exists) msg += ` ${exists} já existiam.`;
        if (other) msg += ` ${other} falharam.`;
        notify(msg, created ? "success" : "error");
        if (!created) {
          btn.disabled = false;
          return;
        }
        closeSheet();
        st.weekRef = dates[0];
      } else {
        body.date = $("ldDate").value;
        if (!body.date) {
          btn.disabled = false;
          notify("Escolha o funcionário, a data, a entrada e a saída.", "error");
          return;
        }
        await api("/api/folha/dias", { method: "POST", body: JSON.stringify(body) });
        notify("Dia lançado e aprovado.", "success");
        closeSheet();
        st.weekRef = body.date;
      }
      if (st.tab !== "semana") setTab("semana");
      else loadWeek();
    } catch (e) {
      btn.disabled = false;
      notify(e.message, "error");
    }
  }

  // ------------------------------------------------------------ events
  function onClick(e) {
    const t = e.target;
    const el = (sel) => t.closest(sel);
    let b;
    if ((b = el("#foTabs [data-tab]"))) return setTab(b.getAttribute("data-tab"));
    if (el("[data-close]") || t.id === "foScrim") return closeSheet();
    if ((b = el("[data-goto]"))) return setTab(b.getAttribute("data-goto"));
    if ((b = el("[data-week]"))) {
      const v = b.getAttribute("data-week");
      if (v === "today") st.weekRef = null;
      else if (v === "prev") st.weekRef = st.week?.week?.prev || addDays(st.week.week.start, -1);
      else if (v === "next") st.weekRef = st.week?.week?.next || addDays(st.week.week.end, 1);
      else st.weekRef = addDays(st.week.week.start, Number(v));
      st.open.clear();
      st.selected.clear();
      return loadWeek();
    }
    if ((b = el("[data-sector]"))) {
      st.sector = b.getAttribute("data-sector");
      st.selected.clear();
      renderWeek();
      return writeHash();
    }
    if ((b = el("[data-day]"))) {
      if (b.getAttribute("data-kind") === "line") return notify("Lançado direto na grade da semana (sem dia de trabalho). Ajuste na grade antiga ou lance o dia de novo.", "info");
      return openDay(b.getAttribute("data-day"));
    }
    if ((b = el("[data-sel]"))) {
      const id = b.getAttribute("data-sel");
      if (b.checked) st.selected.add(id);
      else st.selected.delete(id);
      return renderWeek();
    }
    if ((b = el("[data-selall]"))) {
      const rows = weekRows().filter(canPay);
      if (b.checked) rows.forEach((r) => st.selected.add(r.id));
      else rows.forEach((r) => st.selected.delete(r.id));
      return renderWeek();
    }
    if (el("[data-clearsel]")) {
      st.selected.clear();
      return renderWeek();
    }
    if (el("[data-paysel]")) return openPay([...st.selected]);
    if ((b = el("[data-pay]"))) return openPay([b.getAttribute("data-pay")]);
    if ((b = el("[data-pay-go]"))) return payGo(b);
    if ((b = el("#foPayMethods [data-method]"))) {
      const on = b.getAttribute("aria-pressed") !== "true";
      document.querySelectorAll("#foPayMethods [data-method]").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", String(on));
      return;
    }
    if ((b = el("[data-adjust]"))) return openAdjust(b.getAttribute("data-adjust"));
    if ((b = el("[data-adj-go]"))) return adjustGo(b.getAttribute("data-adj-go"));
    if ((b = el("[data-exp-add]"))) return openAddExpense(b.getAttribute("data-exp-add"));
    if ((b = el("[data-exp-kind]"))) {
      const kind = b.getAttribute("data-exp-kind");
      if ($("foExpKind")) $("foExpKind").value = kind;
      document.querySelectorAll("[data-exp-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x.getAttribute("data-exp-kind") === kind)));
      return;
    }
    if ((b = el("[data-exp-go]"))) return expGo(b.getAttribute("data-exp-go"), b);
    if ((b = el("[data-exp-ok]"))) {
      return api(`/api/folha/despesas/${b.getAttribute("data-exp-ok")}/aprovar`, { method: "POST", body: "{}" })
        .then(() => {
          notify("Reembolso/desconto aprovado.", "success");
          const id = $("foSheet").dataset.dayId;
          refreshAfterChange();
          if (id) return openDay(id);
        })
        .catch((e) => notify(e.message, "error"));
    }
    if ((b = el("[data-exp-no]"))) {
      return api(`/api/folha/despesas/${b.getAttribute("data-exp-no")}/recusar`, { method: "POST", body: JSON.stringify({ reason: "Recusado pelo escritório" }) })
        .then(() => {
          notify("Lançamento recusado.", "success");
          const id = $("foSheet").dataset.dayId;
          refreshAfterChange();
          if (id) return openDay(id);
        })
        .catch((e) => notify(e.message, "error"));
    }
    if ((b = el("[data-receipt]"))) return openReceipt(b.getAttribute("data-receipt"));
    if ((b = el("[data-void]"))) return voidPay(b.getAttribute("data-void"));
    if (el("[data-print]")) return window.print();
    if ((b = el("[data-toggle]"))) {
      const id = b.getAttribute("data-toggle");
      st.open.has(id) ? st.open.delete(id) : st.open.add(id);
      return renderWeek();
    }
    if ((b = el("[data-day-mode]"))) return renderDay($("foSheet")._day, b.getAttribute("data-day-mode") === "view" ? undefined : b.getAttribute("data-day-mode"));
    if (el("[data-day-approve]")) return dayApprove();
    if (el("[data-day-return-go]")) return dayReturn();
    if (el("[data-day-save]")) return daySave();
    if ((b = el("[data-psel]"))) {
      const id = b.getAttribute("data-psel");
      b.checked ? st.pendSel.add(id) : st.pendSel.delete(id);
      return renderPend();
    }
    if (el("[data-pselall]")) {
      const all = st.pend.pending.every((d) => st.pendSel.has(d.id));
      st.pend.pending.forEach((d) => (all ? st.pendSel.delete(d.id) : st.pendSel.add(d.id)));
      return renderPend();
    }
    if ((b = el("[data-papprove]"))) return approveMany([b.getAttribute("data-papprove")]);
    if (el("[data-papprove-sel]")) return approveMany([...st.pendSel]);
    if ((b = el("[data-paypreset]"))) {
      st.payPreset = b.getAttribute("data-paypreset");
      return loadPays();
    }
    if ((b = el("[data-gotoweek]"))) {
      st.weekRef = b.getAttribute("data-gotoweek");
      return setTab("semana");
    }
    if ((b = el("[data-preset]"))) {
      st.rep.preset = b.getAttribute("data-preset");
      return loadReport();
    }
    if ((b = el("[data-repemp]"))) {
      st.rep.employee = st.rep.employee === b.getAttribute("data-repemp") ? "" : b.getAttribute("data-repemp");
      return loadReport();
    }
    if (el("[data-emp-new]")) return openEmp(null);
    if ((b = el("[data-emp-edit]"))) return openEmp(b.getAttribute("data-emp-edit"));
    if ((b = el("[data-emp-save]"))) return saveEmp(b.getAttribute("data-emp-save") || null);
    if (el("#foLogDay")) return openLogDay();
    if ((b = el("[data-ld-mode]"))) return ldSetMode(b.getAttribute("data-ld-mode"));
    if ((b = el("[data-ld-days]"))) return ldSetDays(b.getAttribute("data-ld-days"));
    if ((b = el("[data-ld-ot]"))) return ldAddOt(b.getAttribute("data-ld-ot"));
    if (el("[data-ld-ot-clear]")) return ldClearOt();
    if ((b = el("[data-ed-ot]"))) {
      const elOt = $("foEdOt");
      if (!elOt) return;
      const cur = elOt.value === "" ? 0 : Math.max(0, Math.round(Number(elOt.value) || 0));
      elOt.value = String(Math.min(16 * 60, cur + Math.max(0, Math.round(Number(b.getAttribute("data-ed-ot")) || 0))));
      return;
    }
    if ((b = el("[data-ed-days]"))) {
      const days = Number(b.getAttribute("data-ed-days"));
      const v = days === 0.5 || days === 2 ? days : 1;
      if ($("foEdDays")) $("foEdDays").value = String(v);
      document.querySelectorAll("[data-ed-days]").forEach((x) => {
        x.setAttribute("aria-pressed", String(Number(x.getAttribute("data-ed-days")) === v));
      });
      return;
    }
    if (el("[data-ld-addjob]")) return ldAddJob();
    if ((b = el("[data-ld-rm]"))) return b.closest(".fo-jobpick__row").remove();
    if ((b = el("[data-ld-go]"))) return ldGo(b);
    // Clicking the employee row (not a control) opens / closes its days.
    if ((b = el("tr[data-emp]")) && !el("button, input, a, select")) {
      const id = b.getAttribute("data-emp");
      st.open.has(id) ? st.open.delete(id) : st.open.add(id);
      return renderWeek();
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === "ldFrom" || t.id === "ldTo" || t.id === "ldSkipWe") return ldSyncMultiHint();
    if (t.id === "foRepEmp") {
      st.rep.employee = t.value;
      return loadReport();
    }
    if (t.id === "foRepSector") {
      st.rep.sector = t.value;
      return loadReport();
    }
    if (t.id === "foRepFrom" || t.id === "foRepTo") {
      st.rep.preset = "custom";
      st.rep.from = $("foRepFrom").value || st.rep.from;
      st.rep.to = $("foRepTo").value || st.rep.to;
      return loadReport();
    }
    if (t.id === "feStartMode") {
      const lbl = $("feStart").closest("label");
      lbl.firstChild.textContent = t.value === "job" ? "Se não tiver job agendado" : "Começa às";
    }
    if (t.id === "ldDate") document.querySelectorAll("#ldJobs .fo-jobpick__row").forEach((r) => r.remove());
  }
  function onKey(e) {
    if (e.key === "Escape" && !$("foSheet").hidden) return closeSheet();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-day][role=button]")) {
      e.preventDefault();
      e.target.click();
    }
  }

  // ------------------------------------------------------------ init
  async function init() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      if (!(role === "admin" || perms.includes("payroll.view"))) {
        location.replace(perms.includes("payroll.self") ? "/campo/horas.html" : "/pipeline-lab.html");
        return;
      }
      st.manage = role === "admin" || perms.includes("payroll.manage");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      const sn = $("sidebarUserName");
      if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
    } catch (_) {
      /* the shell redirects to login */
    }
    await loadPayMethods();
    if (!st.manage) document.querySelectorAll("[data-manage]").forEach((el) => (el.hidden = true));
    // Overlays live on <body>: inside the main column they sit under the app's bottom nav.
    ["foScrim", "foSheet", "foPayBar"].forEach((id) => document.body.appendChild($(id)));
    readHash();
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", () => {
      const before = `${st.tab}|${st.weekRef}|${st.sector}`;
      readHash();
      if (`${st.tab}|${st.weekRef}|${st.sector}` !== before) setTab(st.tab);
    });
    setTab(st.tab);
    if (st.tab !== "semana") api("/api/folha/pendencias").then((j) => { st.pend = j.data; refreshPendCount(); }).catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
