/**
 * Fluxo de caixa — Opção A (painel do mês) com a lista lateral da B.
 * Lista à esquerda: Resumo + movimentos por dia (entradas, custos, folha e recibos a classificar).
 * Direita: o Resumo (números, semanas, para resolver, categorias, a receber) ou o movimento aberto.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmt2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const fmt0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money = (n) => fmt2.format(Number(n) || 0);
  const short = (n) => {
    const v = Number(n) || 0;
    return Math.abs(v) >= 1000 || Number.isInteger(v) ? fmt0.format(v) : fmt2.format(v);
  };
  const signed = (n, f) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${(f || short)(Math.abs(n))}`;

  const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const CATS = [
    ["materials", "Materiais"],
    ["services", "Serviços"],
    ["equipment", "Equipamento"],
    ["travel", "Deslocamento"],
    ["utilities", "Utilidades"],
    ["taxes", "Impostos"],
    ["other", "Outro"],
  ];
  const catLabel = (c) => (CATS.find((x) => x[0] === c) || [null, c ? String(c) : "Outro"])[1];
  const METHODS = {
    check: "Cheque", cash: "Dinheiro", ach: "ACH", zelle: "Zelle", card: "Cartão", credit_card: "Cartão",
    venmo: "Venmo", financing: "Financiamento", bank_transfer: "Transferência", wire: "Transferência", other: "Outro",
  };
  const methodLabel = (m) => (m ? METHODS[m] || m : "");

  const ICO = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
  };

  const S = {
    range: "month",
    anchor: new Date(),
    from: "",
    to: "",
    filter: "all",
    q: "",
    sel: "res",
    summary: null,
    prev: null,
    lines: [],
    costs: [],
    receivables: [],
    periods: [],
    canManage: true,
  };

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => new Date(String(s).slice(0, 10) + "T12:00:00");
  const todayIso = () => iso(new Date());
  const dayLabel = (s) => {
    const d = parse(s);
    return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
  };
  const dShort = (s) => {
    const d = parse(s);
    return `${d.getDate()} ${MON[d.getMonth()]}`;
  };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  function toast(msg, type) {
    if (typeof window.crmToastSafe === "function") window.crmToastSafe(msg, { type: type || "info" });
    else if (window.CrmToast && typeof window.CrmToast.show === "function") window.CrmToast.show(msg, type || "info");
  }

  async function api(path, opts) {
    const r = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...((opts && opts.headers) || {}) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const err = new Error(j.error || r.statusText || "Erro");
      err.status = r.status;
      throw err;
    }
    return j;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- período */
  function computeRange() {
    const a = S.anchor;
    if (S.range === "month") {
      S.from = iso(new Date(a.getFullYear(), a.getMonth(), 1));
      S.to = iso(new Date(a.getFullYear(), a.getMonth() + 1, 0));
    } else if (S.range === "year") {
      S.from = `${a.getFullYear()}-01-01`;
      S.to = `${a.getFullYear()}-12-31`;
    } else if (S.range === "30") {
      const t = new Date();
      const f = new Date(t);
      f.setDate(f.getDate() - 29);
      S.from = iso(f);
      S.to = iso(t);
    } else {
      S.from = $("finFrom").value || S.from;
      S.to = $("finTo").value || S.to;
      if (S.from > S.to) [S.from, S.to] = [S.to, S.from];
    }
    $("finFrom").value = S.from;
    $("finTo").value = S.to;
  }
  function prevRange() {
    const a = S.anchor;
    if (S.range === "month") {
      return { from: iso(new Date(a.getFullYear(), a.getMonth() - 1, 1)), to: iso(new Date(a.getFullYear(), a.getMonth(), 0)) };
    }
    if (S.range === "year") return { from: `${a.getFullYear() - 1}-01-01`, to: `${a.getFullYear() - 1}-12-31` };
    const len = daysBetween(S.from, S.to) + 1;
    const t = parse(S.from);
    t.setDate(t.getDate() - 1);
    const f = new Date(t);
    f.setDate(f.getDate() - (len - 1));
    return { from: iso(f), to: iso(t) };
  }
  function perLabel() {
    if (S.range === "month") {
      const m = MONTHS[S.anchor.getMonth()];
      return `${m.charAt(0).toUpperCase() + m.slice(1)} ${S.anchor.getFullYear()}`;
    }
    if (S.range === "year") return String(S.anchor.getFullYear());
    if (S.range === "30") return "Últimos 30 dias";
    return `${dShort(S.from)} – ${dShort(S.to)}`;
  }
  function perName() {
    if (S.range === "month") return MONTHS[S.anchor.getMonth()];
    if (S.range === "year") return String(S.anchor.getFullYear());
    return "o período";
  }
  function prevName() {
    if (S.range === "month") return MONTHS[(S.anchor.getMonth() + 11) % 12];
    if (S.range === "year") return String(S.anchor.getFullYear() - 1);
    return "período anterior";
  }
  const qs = (f, t) => `?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;

  /* ---------------- dados */
  async function load() {
    computeRange();
    renderPeriod();
    const pr = prevRange();
    const res = await Promise.allSettled([
      api(`/api/finance/summary${qs(S.from, S.to)}`),
      api(`/api/finance/cashflow${qs(S.from, S.to)}`),
      api(`/api/finance/costs${qs(S.from, S.to)}&status=all`),
      api("/api/finance/receivables"),
      api("/api/finance/payroll"),
      api(`/api/finance/summary${qs(pr.from, pr.to)}`),
    ]);
    const val = (i, d) => (res[i].status === "fulfilled" ? res[i].value.data : d);
    if (res[0].status === "rejected") {
      $("fxRows").innerHTML = `<p class="fx-empty">${esc(res[0].reason && res[0].reason.message)}</p>`;
      if (res[0].reason && res[0].reason.status === 403) S.canManage = false;
    }
    S.summary = val(0, {}) || {};
    S.lines = (val(1, {}) || {}).lines || [];
    S.costs = val(2, []) || [];
    S.receivables = val(3, []) || [];
    S.periods = (val(4, {}) || {}).periods || [];
    S.prev = val(5, null);
    render();
  }

  function moves() {
    const costById = new Map(S.costs.map((c) => [c.id, c]));
    const out = S.lines.map((l) => {
      const m = l.meta || {};
      if (l.kind === "cost") {
        const c = costById.get(m.cost_id) || {};
        return {
          id: `cost:${m.cost_id}`, kind: "cost", dir: "out", date: l.date, amount: l.amount,
          title: c.description || l.label, vendor: c.vendor_name || "", category: c.category || m.category,
          cost: c, sub: [c.vendor_name, catLabel(c.category || m.category)].filter(Boolean).join(" · "),
        };
      }
      if (l.kind === "payroll") {
        const lab = String(m.payroll_label || l.label.replace(/^Folha · /, ""));
        const who = lab.split(" · ")[0];
        return {
          id: `pay:${l.id}`, kind: "payroll", dir: "out", date: l.date, amount: l.amount, line: l,
          title: `Folha · ${who}`, sub: ["Folha", methodLabel(m.method)].filter(Boolean).join(" · "), category: "payroll",
        };
      }
      return {
        id: `rcp:${l.id}`, kind: "receipt", dir: "in", date: l.date, amount: l.amount, line: l,
        title: m.customer_name || "Recebimento",
        sub: ["Recebimento", m.invoice_number, methodLabel(m.method)].filter(Boolean).join(" · "),
      };
    });
    S.costs
      .filter((c) => c.status === "draft")
      .forEach((c) => {
        const unread = Number(c.amount) <= 0.01;
        out.push({
          id: `cost:${c.id}`, kind: "cost", dir: "draft", date: c.incurred_on, amount: unread ? null : c.amount,
          title: unread && /scan/i.test(c.description || "") ? "Recibo sem leitura" : c.description,
          vendor: c.vendor_name || "", category: c.category, cost: c,
          sub: `a classificar · ${c.vendor_name || (c.source === "scan" ? "Scan" : "Manual")}`,
        });
      });
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.dir === "draft" ? -1 : 0));
    return out;
  }

  /* ---------------- lista */
  function renderPeriod() {
    $("fxPerLabel").textContent = perLabel();
    const arrows = S.range === "month" || S.range === "year";
    $("fxPrev").hidden = !arrows;
    $("fxNext").hidden = !arrows;
    $("fxDates").hidden = S.range !== "custom";
    document.querySelectorAll("#fxRange [data-range]").forEach((b) => b.classList.toggle("is-on", b.dataset.range === S.range));
  }

  function filtered(all) {
    const q = S.q.trim().toLowerCase();
    return all.filter((m) => {
      if (S.filter === "in" && m.dir !== "in") return false;
      if (S.filter === "out" && m.dir !== "out") return false;
      if (S.filter === "draft" && m.dir !== "draft") return false;
      if (!q) return true;
      return [m.title, m.sub, m.vendor, m.cost && m.cost.notes, m.line && m.line.label].join(" ").toLowerCase().includes(q);
    });
  }

  function rowHtml(m) {
    const ico = m.dir === "in" ? ICO.up : m.dir === "draft" ? ICO.receipt : ICO.down;
    const amt = m.dir === "draft" ? (m.amount == null ? "—" : short(m.amount)) : `${m.dir === "in" ? "+" : "−"}${money(m.amount)}`;
    return `<a class="fx-row${S.sel === m.id ? " is-on" : ""}" href="#" data-id="${esc(m.id)}">
      <span class="fx-ico is-${m.dir}">${ico}</span>
      <span class="fx-row__b"><b>${esc(m.title)}</b><small class="${m.dir === "draft" ? "is-hot" : ""}">${esc(m.sub)}</small></span>
      <span class="fx-amt is-${m.dir}">${amt}</span></a>`;
  }

  function renderList() {
    const all = moves();
    const n = { all: all.length, in: 0, out: 0, draft: 0 };
    all.forEach((m) => n[m.dir]++);
    document.querySelectorAll("#fxSeg [data-f]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.f === S.filter);
      const em = b.querySelector("em");
      if (em) em.textContent = n[b.dataset.f] ? String(n[b.dataset.f]) : "";
    });
    const s = S.summary || {};
    $("fxSums").innerHTML = `<div><dt>Entradas</dt><dd>${short(s.inflow)}</dd></div><div><dt>Saídas</dt><dd>${short(s.outflow)}</dd></div><div><dt>Resultado</dt><dd class="${(s.net || 0) < 0 ? "is-hot" : ""}">${signed(Number(s.net) || 0)}</dd></div>`;
    renderPhero(n.draft);

    const list = filtered(all);
    let h = `<a class="fx-res${S.sel === "res" ? " is-on" : ""}" href="#" data-id="res"><span class="fx-res__ico">${ICO.chart}</span><span class="fx-res__b"><b>Resumo de ${esc(perName())}</b><small>Resultado ${signed(Number(s.net) || 0)}${todoCount() ? ` · ${todoCount()} para resolver` : ""}</small></span></a>`;
    if (!list.length) {
      h += `<p class="fx-empty">${S.q || S.filter !== "all" ? "Nenhum movimento com esse filtro." : "Sem movimentos neste período."}</p>`;
    } else {
      let day = "";
      let buf = "";
      let tot = 0;
      let drafts = 0;
      const flush = () => {
        if (!day) return;
        const t = tot ? `${tot > 0 ? "+" : "−"}${money(Math.abs(tot))}` : drafts ? `${drafts} a classificar` : "";
        h += `<div class="fx-day"><span>${esc(dayLabel(day))}</span><em>${t}</em></div>${buf}`;
      };
      list.forEach((m) => {
        if (m.date !== day) {
          flush();
          day = m.date;
          buf = "";
          tot = 0;
          drafts = 0;
        }
        if (m.dir === "in") tot += Number(m.amount) || 0;
        else if (m.dir === "out") tot -= Number(m.amount) || 0;
        else drafts++;
        buf += rowHtml(m);
      });
      flush();
    }
    $("fxRows").innerHTML = h;
  }

  /* ---------------- números do celular/iPad em pé */
  function overdue() {
    return S.receivables.filter((r) => r.overdue);
  }
  function payrollDue() {
    const lim = new Date();
    lim.setDate(lim.getDate() - 42);
    const limIso = iso(lim);
    return S.periods
      .filter((p) => p.end_date >= limIso && p.start_date <= todayIso())
      .map((p) => {
        const paid = p.abatement ? Number(p.abatement.amount) || 0 : 0;
        const full = p.abatement && p.abatement.status !== "partial";
        return { ...p, due: full ? 0 : Math.max(0, (Number(p.estimated_cost) || 0) - paid), paid };
      })
      .filter((p) => p.due > 0.004);
  }
  function drafts() {
    return S.costs.filter((c) => c.status === "draft");
  }
  function todoCount() {
    return (drafts().length ? 1 : 0) + Math.min(2, overdue().length) + Math.min(2, payrollDue().length);
  }

  function renderPhero(nDraft) {
    const s = S.summary || {};
    const net = Number(s.net) || 0;
    const rec = S.receivables.reduce((a, r) => a + (Number(r.balance) || 0), 0);
    const od = overdue();
    const odSum = od.reduce((a, r) => a + (Number(r.balance) || 0), 0);
    const odDays = od.reduce((m, r) => Math.max(m, r.due_date ? daysBetween(r.due_date, todayIso()) : 0), 0);
    const dr = drafts();
    const drSum = dr.reduce((a, c) => a + (Number(c.amount) > 0.01 ? Number(c.amount) : 0), 0);
    const pd = payrollDue();
    const pdSum = pd.reduce((a, p) => a + p.due, 0);
    const prev = S.prev ? Number(S.prev.net) || 0 : null;
    $("fxPhero").innerHTML = `<div class="fx-hero"><span>Resultado ${S.range === "month" ? "do mês" : "do período"}</span><b>${signed(net)}</b>
      <small>${S.from <= todayIso() && S.to >= todayIso() ? `até ${dShort(todayIso())}` : `${dShort(S.from)} – ${dShort(S.to)}`}${prev != null ? ` · ${esc(prevName())} ${signed(prev)}` : ""}</small>
      <div class="fx-hero__sp"><div><span>Entradas</span><b>${short(s.inflow)}</b></div><div><span>Saídas</span><b>${short(s.outflow)}</b></div></div></div>
      <div class="fx-g22">
        <a href="invoices.html"><span>A receber</span><b>${short(rec)}</b><small>${S.receivables.length} fatura${S.receivables.length === 1 ? "" : "s"}</small></a>
        <a href="${od.length === 1 ? `invoices.html?id=${encodeURIComponent(od[0].id)}` : "invoices.html"}"><span>Vencido</span><b class="${odSum ? "is-hot" : ""}">${short(odSum)}</b><small>${od.length ? `há ${odDays} dia${odDays === 1 ? "" : "s"}` : "nada vencido"}</small></a>
        <a href="#" data-fx-filter="draft"><span>A classificar</span><b>${nDraft}</b><small>${dr.length ? `${short(drSum)} em recibos` : "tudo lançado"}</small></a>
        <a href="${pd.length ? `folha.html#semana=${esc(pd[0].start_date)}` : "folha.html"}"><span>Folha a pagar</span><b>${short(pdSum)}</b><small>${pd.length ? `${pd.length} semana${pd.length === 1 ? "" : "s"}` : "em dia"}</small></a>
      </div>
      <a class="fx-res fx-res--ph" href="#" data-id="res"><span class="fx-res__ico">${ICO.chart}</span><span class="fx-res__b"><b>Resumo ${S.range === "month" ? "do mês" : "do período"}</b><small>semanas, categorias, a receber, folha</small></span>${ICO.chev}</a>`;
  }

  /* ---------------- Resumo (Opção A) */
  function buckets() {
    const span = daysBetween(S.from, S.to) + 1;
    const out = [];
    if (span > 62) {
      let d = parse(S.from);
      d = new Date(d.getFullYear(), d.getMonth(), 1);
      while (iso(d) <= S.to) {
        const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        out.push({ from: iso(d) < S.from ? S.from : iso(d), to: iso(e) > S.to ? S.to : iso(e), label: MON[d.getMonth()] });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
      return { title: "Meses", list: out };
    }
    if (S.range === "month") {
      const a = parse(S.from);
      const last = parse(S.to).getDate();
      [[1, 7], [8, 14], [15, 21], [22, last]].forEach(([x, y]) => {
        const f = new Date(a.getFullYear(), a.getMonth(), x);
        const t = new Date(a.getFullYear(), a.getMonth(), y);
        out.push({ from: iso(f), to: iso(t), label: `${x}–${y} ${MON[a.getMonth()]}` });
      });
      return { title: "Semanas", list: out };
    }
    let d = parse(S.from);
    while (iso(d) <= S.to) {
      const e = new Date(d);
      e.setDate(e.getDate() + 6);
      const t = iso(e) > S.to ? S.to : iso(e);
      out.push({ from: iso(d), to: t, label: `${d.getDate()} ${MON[d.getMonth()]}` });
      d = new Date(e);
      d.setDate(d.getDate() + 1);
    }
    return { title: "Semanas", list: out };
  }

  function chartHtml() {
    const b = buckets();
    b.list.forEach((w) => {
      w.inflow = 0;
      w.outflow = 0;
      S.lines.forEach((l) => {
        if (l.date < w.from || l.date > w.to) return;
        if (l.direction === "in") w.inflow += Number(l.amount) || 0;
        else w.outflow += Number(l.amount) || 0;
      });
    });
    const max = Math.max(1, ...b.list.map((w) => Math.max(w.inflow, w.outflow)));
    const t = todayIso();
    let cur = b.list.findIndex((w) => t >= w.from && t <= w.to);
    if (cur < 0) {
      for (let i = b.list.length - 1; i >= 0; i--) if (b.list[i].inflow || b.list[i].outflow) { cur = i; break; }
    }
    const cols = b.list
      .map((w, i) => {
        const net = w.inflow - w.outflow;
        const h1 = Math.max(4, Math.round((w.inflow / max) * 96));
        const h2 = Math.max(4, Math.round((w.outflow / max) * 96));
        return `<div class="fx-wk__c${i === cur ? " is-on" : ""}" title="Entradas ${money(w.inflow)} · Saídas ${money(w.outflow)}"><div class="fx-wk__bb"><i style="height:${h1}px"></i><i class="o" style="height:${h2}px"></i></div><small>${esc(w.label)}</small><b>${w.inflow || w.outflow ? signed(net) : "—"}</b></div>`;
      })
      .join("");
    return `<div class="fx-card"><h3>${b.title}<span class="fx-lgd"><span><i></i>Entradas</span><span><i class="o"></i>Saídas</span></span></h3><div class="fx-wk" style="--n:${b.list.length}">${cols}</div></div>`;
  }

  function todoHtml() {
    const items = [];
    const dr = drafts();
    if (dr.length) {
      const sum = dr.reduce((a, c) => a + (Number(c.amount) > 0.01 ? Number(c.amount) : 0), 0);
      const unread = dr.filter((c) => Number(c.amount) <= 0.01).length;
      items.push(`<div class="fx-todo"><i></i><div><b>${dr.length} recibo${dr.length === 1 ? "" : "s"} a classificar</b><small>${[sum ? short(sum) : "", unread ? `${unread} sem valor` : ""].filter(Boolean).join(" + ")} · não entra${dr.length === 1 ? "" : "m"} no caixa</small></div><a href="#" data-id="cost:${esc(dr[0].id)}">Revisar</a></div>`);
    }
    overdue()
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 2)
      .forEach((r) => {
        const d = r.due_date ? daysBetween(r.due_date, todayIso()) : 0;
        items.push(`<div class="fx-todo"><i></i><div><b>Fatura vencida · ${esc(r.customer_name)}</b><small>${esc(r.invoice_number || "")} · ${short(r.balance)} · há ${d} dia${d === 1 ? "" : "s"}</small></div><a href="invoices.html?id=${encodeURIComponent(r.id)}">Cobrar</a></div>`);
      });
    payrollDue()
      .slice(0, 2)
      .forEach((p) => {
        items.push(`<div class="fx-todo"><i class="k"></i><div><b>Folha · semana ${esc(dShort(p.start_date))}</b><small>${p.paid ? `${money(p.due)} de ${money(p.estimated_cost)} a pagar` : `${money(p.due)} a pagar`}</small></div><a href="folha.html#semana=${esc(p.start_date)}">Pagar na Folha</a></div>`);
      });
    return `<div class="fx-card"><h3>Para resolver <em>${items.length || ""}</em></h3>${items.join("") || '<p class="fx-mute">Nada pendente. Recibos lançados, faturas em dia e folha paga.</p>'}</div>`;
  }

  function catsHtml() {
    const map = new Map();
    S.costs
      .filter((c) => c.status === "posted")
      .forEach((c) => map.set(c.category || "other", (map.get(c.category || "other") || 0) + (Number(c.amount) || 0)));
    const rows = [...map.entries()].map(([k, v]) => [catLabel(k), v]);
    const pay = Number((S.summary || {}).payroll_paid) || 0;
    if (pay) rows.push(["Folha", pay]);
    rows.sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    const tot = rows.reduce((a, r) => a + r[1], 0);
    return `<div class="fx-card"><h3>Saídas por categoria <em>${short(tot)}</em></h3>${rows.length ? rows.map(([l, v]) => `<div class="fx-cat"><span>${esc(l)}</span><i><em style="width:${Math.max(2, (v / max) * 100).toFixed(0)}%"></em></i><b>${short(v)}</b></div>`).join("") : '<p class="fx-mute">Nenhuma saída no período.</p>'}</div>`;
  }

  function recvHtml() {
    const rows = S.receivables.slice().sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || String(a.due_date || "").localeCompare(String(b.due_date || "")));
    const sum = rows.reduce((a, r) => a + (Number(r.balance) || 0), 0);
    const li = rows.slice(0, 4).map((r) => {
      const d = r.due_date ? daysBetween(r.due_date, todayIso()) : null;
      const due = !r.due_date ? "sem vencimento" : r.overdue ? `venceu há ${d} dia${d === 1 ? "" : "s"}` : `vence ${dShort(r.due_date)}`;
      return `<a class="fx-rcv" href="invoices.html?id=${encodeURIComponent(r.id)}"><span><b>${esc(r.customer_name)}</b><small class="${r.overdue ? "is-hot" : ""}">${esc(r.invoice_number || "")} · ${due}</small></span><b>${short(r.balance)}</b></a>`;
    });
    return `<div class="fx-card"><h3>A receber <em>${short(sum)}</em><a class="fx-lnk" href="invoices.html">Invoices</a></h3>${li.join("") || '<p class="fx-mute">Nenhuma fatura em aberto.</p>'}${rows.length > 4 ? `<a class="fx-more" href="invoices.html">Ver todas (${rows.length})</a>` : ""}</div>`;
  }

  function resumoHtml() {
    const s = S.summary || {};
    const net = Number(s.net) || 0;
    const inflow = Number(s.inflow) || 0;
    const outflow = Number(s.outflow) || 0;
    const mx = Math.max(1, inflow, outflow);
    const prev = S.prev ? Number(S.prev.net) || 0 : null;
    const nIn = S.lines.filter((l) => l.direction === "in").length;
    const rec = S.receivables.reduce((a, r) => a + (Number(r.balance) || 0), 0);
    const odSum = overdue().reduce((a, r) => a + (Number(r.balance) || 0), 0);
    const live = S.from <= todayIso() && S.to >= todayIso();
    const sub = `${dShort(S.from)} – ${dShort(S.to)} ${parse(S.to).getFullYear()}${live ? " · até hoje" : ""}`;
    const title = S.range === "month" ? `Resumo de ${perName()}` : S.range === "year" ? `Resumo de ${perName()}` : "Resumo do período";
    const prevTxt = prev == null ? "" : ` · ${esc(prevName())} ${S.range === "month" || S.range === "year" ? "fechou em " : ""}${signed(prev)}`;
    return `<div class="fx-res-pane">
      <div class="fx-phead"><div><p>${esc(sub)}</p><h2>${esc(title)}</h2></div>
        <div class="fx-phead__acts"><button type="button" class="fx-btn" data-fx-new="manual" data-crm-permission="finance.manage">${ICO.plus}<span>Novo custo</span></button><button type="button" class="fx-btn fx-btn--pri" data-fx-new="scan" data-crm-permission="finance.manage">${ICO.cam}<span>Scan recibo</span></button></div></div>
      <div class="fx-mz">
        <div class="fx-mz__c is-dk"><span>Resultado</span><b>${signed(net)}</b><small>Entradas − saídas${live ? ` · até ${dShort(todayIso())}` : ""}${prevTxt}</small>
          <div class="fx-vs"><span>Entradas</span><i><em style="width:${((inflow / mx) * 100).toFixed(0)}%"></em></i><u>${short(inflow)}</u></div>
          <div class="fx-vs"><span>Saídas</span><i><em class="o" style="width:${((outflow / mx) * 100).toFixed(0)}%"></em></i><u>${short(outflow)}</u></div></div>
        <div class="fx-mz__c"><span>Entradas</span><b>${short(inflow)}</b><small>${nIn} recebimento${nIn === 1 ? "" : "s"} de faturas</small></div>
        <div class="fx-mz__c"><span>Saídas</span><b>${short(outflow)}</b><small>Custos ${short(s.costs)} · Folha ${short(s.payroll_paid)}</small></div>
        <a class="fx-mz__c" href="invoices.html"><span>A receber</span><b>${short(rec)}</b><small class="${odSum ? "is-hot" : ""}">${odSum ? `${short(odSum)} vencido` : "nada vencido"}</small></a>
      </div>
      <div class="fx-two"><div class="fx-col">${chartHtml()}${catsHtml()}</div><div class="fx-col">${todoHtml()}${recvHtml()}</div></div>
    </div>`;
  }

  /* ---------------- movimento aberto */
  function catChips(cur, name) {
    return `<div class="fx-cats" data-cat-picker>${CATS.map(([k, l]) => `<button type="button" data-cat="${k}" class="${(cur || "other") === k ? "is-on" : ""}">${l}</button>`).join("")}<input type="hidden" name="${name || "category"}" value="${esc(cur || "other")}" /></div>`;
  }

  function receiptBox(c) {
    const url = c.receipt_url;
    if (!url) return `<div class="fx-rbox is-empty"><span>${ICO.doc}</span><p>Sem recibo anexado</p></div>`;
    if (/\.pdf($|\?)/i.test(url)) return `<div class="fx-rbox is-empty"><span>${ICO.doc}</span><p>Recibo em PDF</p><a class="fx-lnk" href="${esc(url)}" target="_blank" rel="noopener">Abrir PDF</a></div>`;
    return `<a class="fx-rbox" href="${esc(url)}" target="_blank" rel="noopener" title="Abrir recibo"><img src="${esc(url)}" alt="Recibo" loading="lazy" onerror="this.parentNode.classList.add('is-empty');this.outerHTML='<p>Não foi possível mostrar o recibo</p>'" /></a>`;
  }

  function costHtml(m) {
    const c = m.cost || {};
    const draft = c.status === "draft";
    const voided = c.status === "void";
    const unread = Number(c.amount) <= 0.01;
    const chip = draft ? '<span class="fx-chip is-hot">A classificar</span>' : voided ? '<span class="fx-chip">Anulado</span>' : '<span class="fx-chip is-ok">Lançado</span>';
    const src = `<span class="fx-chip">${c.source === "scan" ? "Scan" : "Manual"}</span>`;
    const ocr =
      c.ocr_status === "extracted" && (c.ocr_vendor || c.ocr_amount)
        ? `<div class="fx-ocr">${ICO.check}<span>Lido do recibo: <b>${esc([c.ocr_vendor, c.ocr_amount != null ? money(c.ocr_amount) : ""].filter(Boolean).join(" · "))}</b></span></div>`
        : draft && (c.ocr_status === "pending" || c.ocr_status === "failed")
          ? `<div class="fx-ocr is-warn"><span>A leitura automática não achou o valor. Confira a foto e preencha.</span></div>`
          : "";
    const meta = draft ? "ainda não entrou no fluxo de caixa" : voided ? "fora do fluxo de caixa" : "no fluxo de caixa";
    const lancar = draft ? `<button type="button" class="fx-btn fx-btn--pri" data-act="post">Lançar${unread ? "" : ` ${money(c.amount)}`}</button>` : "";
    return `<form class="fx-mv" id="fxCostForm" data-cost="${esc(c.id)}">
      <div class="fx-mvh"><div class="fx-mvh__b"><div class="fx-chips">${chip}${src}</div><h2>${esc(m.title)}</h2><p>${esc([c.vendor_name, dayLabel(c.incurred_on)].filter(Boolean).join(" · "))} · ${meta}</p></div>
        ${S.canManage && !voided ? `<div class="fx-mvh__acts"><button type="button" class="fx-btn fx-btn--warn" data-act="void">Anular</button><button type="button" class="fx-btn" data-act="save">Salvar</button>${lancar}</div>` : ""}</div>
      <div class="fx-mvg"><div>${receiptBox(c)}</div><div class="fx-mvf">${ocr}
        <label class="fx-field">Descrição<input name="description" value="${esc(unread && /scan/i.test(c.description || "") ? "" : c.description)}" placeholder="O que foi comprado" maxlength="200" /></label>
        <div class="fx-row2"><label class="fx-field">Fornecedor<input name="vendor_name" value="${esc(c.vendor_name || "")}" maxlength="120" /></label>
        <label class="fx-field">Valor ($)<input name="amount" type="number" step="0.01" min="0.01" value="${unread ? "" : (Number(c.amount) || 0).toFixed(2)}" placeholder="0.00" /></label></div>
        <label class="fx-field">Data<input name="incurred_on" type="date" value="${esc(c.incurred_on)}" /></label>
        <div class="fx-field">Categoria${catChips(c.category)}</div>
        <label class="fx-field"><span>Notas <span class="fx-opt">opcional</span></span><textarea name="notes" rows="2" data-crm-rich="off" placeholder="Só a equipe vê">${esc(c.notes || "")}</textarea></label>
      </div></div></form>`;
  }

  function receiptHtml(m) {
    const x = m.line.meta || {};
    const bal = x.invoice_amount != null ? Math.max(0, x.invoice_amount - (x.invoice_paid || 0)) : null;
    const kp = x.invoice_amount != null
      ? `<div class="fx-kpis"><div><span>Fatura</span><b>${short(x.invoice_amount)}</b></div><div><span>Recebido</span><b>${short(x.invoice_paid)}</b></div><div><span>Saldo</span><b>${short(bal)}</b></div><div><span>${bal ? "Vence" : "Status"}</span><b>${bal ? (x.invoice_due ? dShort(x.invoice_due) : "—") : "Paga"}</b></div></div>`
      : "";
    return `<div class="fx-mv"><div class="fx-mvh"><div class="fx-mvh__b"><div class="fx-chips"><span class="fx-chip is-ok">Recebimento</span>${x.method ? `<span class="fx-chip">${esc(methodLabel(x.method))}</span>` : ""}</div>
      <h2>+${money(m.amount)} · ${esc(m.title)}</h2><p>${esc([dayLabel(m.date), x.invoice_number, x.job_number ? `Job #${x.job_number}` : ""].filter(Boolean).join(" · "))}</p></div>
      ${x.invoice_id ? `<div class="fx-mvh__acts"><a class="fx-btn" href="invoices.html?id=${encodeURIComponent(x.invoice_id)}">Abrir fatura</a></div>` : ""}</div>${kp}
      <p class="fx-note">Recebimentos entram aqui quando o pagamento é registrado na fatura. Para corrigir, abra a fatura.</p></div>`;
  }

  function payrollHtml(m) {
    const x = m.line.meta || {};
    const p = S.periods.find((q) => q.id === x.period_id);
    const lab = String(x.payroll_label || m.line.label || "");
    const kp = p
      ? `<div class="fx-kpis"><div><span>Semana</span><b>${esc(dShort(p.start_date))} – ${esc(dShort(p.end_date))}</b></div><div><span>Custo da semana</span><b>${short(p.estimated_cost)}</b></div><div><span>Pago</span><b>${short(p.abatement ? p.abatement.amount : 0)}</b></div><div><span>A pagar</span><b>${short(Math.max(0, (p.estimated_cost || 0) - (p.abatement ? p.abatement.amount : 0)))}</b></div></div>`
      : "";
    return `<div class="fx-mv"><div class="fx-mvh"><div class="fx-mvh__b"><div class="fx-chips"><span class="fx-chip is-dk">Folha</span>${x.method ? `<span class="fx-chip">${esc(methodLabel(x.method))}</span>` : ""}</div>
      <h2>−${money(m.amount)} · ${esc(m.title.replace(/^Folha · /, ""))}</h2><p>${esc([dayLabel(m.date), lab.split(" · ").slice(1).join(" · ")].filter(Boolean).join(" · "))}</p></div>
      <div class="fx-mvh__acts"><a class="fx-btn" href="folha.html${p ? `#semana=${esc(p.start_date)}` : ""}">Abrir na Folha</a></div></div>${kp}
      ${x.notes ? `<p class="fx-note">${esc(x.notes)}</p>` : ""}<p class="fx-note">Pagamentos da folha entram aqui quando são pagos em Folha de Pagamento.</p></div>`;
  }

  /* ---------------- seleção */
  function current() {
    return S.sel === "res" ? null : moves().find((m) => m.id === S.sel) || null;
  }

  function renderPane() {
    const m = current();
    if (S.sel !== "res" && !m) S.sel = "res";
    const pane = $("fxPane");
    pane.innerHTML = !m ? resumoHtml() : m.kind === "cost" ? costHtml(m) : m.kind === "receipt" ? receiptHtml(m) : payrollHtml(m);
    renderMbar(m);
    if (typeof window.crmApplyPermissions === "function") {
      try { window.crmApplyPermissions(pane); } catch (e) { /* ignore */ }
    }
  }

  function renderMbar(m) {
    const bar = $("fxMbar");
    if (!m) { bar.hidden = true; bar.innerHTML = ""; return; }
    let h = "";
    if (m.kind === "cost") {
      const c = m.cost || {};
      if (c.status === "draft" && S.canManage) h = `<button type="button" class="fx-btn fx-btn--sq fx-btn--warn" data-act="void" aria-label="Anular">${ICO.x}</button><button type="button" class="fx-btn fx-btn--pri" data-act="post">Lançar${Number(c.amount) > 0.01 ? ` ${money(c.amount)}` : ""}</button>`;
      else if (c.status !== "void" && S.canManage) h = `<button type="button" class="fx-btn fx-btn--pri" data-act="save">Salvar</button>`;
    } else if (m.kind === "receipt" && m.line.meta && m.line.meta.invoice_id) {
      h = `<a class="fx-btn fx-btn--pri" href="invoices.html?id=${encodeURIComponent(m.line.meta.invoice_id)}">Abrir fatura</a>`;
    } else if (m.kind === "payroll") {
      const p = S.periods.find((q) => q.id === (m.line.meta || {}).period_id);
      h = `<a class="fx-btn fx-btn--pri" href="folha.html${p ? `#semana=${esc(p.start_date)}` : ""}">Abrir na Folha</a>`;
    }
    bar.innerHTML = h;
    bar.hidden = !h;
  }

  function render() {
    renderList();
    renderPane();
    syncDetail();
  }

  const narrow = () => window.matchMedia("(max-width: 1024px)").matches;
  function syncDetail() {
    const open = narrow() && S.detailOpen;
    $("fxSplit").classList.toggle("is-detail", !!open);
    document.body.classList.toggle("fx-detail-open", !!open);
  }

  function select(id, fromUser) {
    S.sel = id || "res";
    if (fromUser) S.detailOpen = true;
    document.querySelectorAll("#fxRows [data-id], #fxPhero [data-id]").forEach((a) => a.classList.toggle("is-on", a.dataset.id === S.sel));
    renderPane();
    syncDetail();
    try {
      const u = new URL(location.href);
      if (S.sel === "res") u.searchParams.delete("mov");
      else u.searchParams.set("mov", S.sel);
      history.replaceState(null, "", u.toString());
    } catch (e) { /* ignore */ }
    if (fromUser && narrow()) window.scrollTo({ top: 0 });
    else if (fromUser) {
      const r = $("fxMain").getBoundingClientRect();
      if (r.top < 0) window.scrollTo({ top: window.scrollY + r.top - 70, behavior: "smooth" });
    }
  }

  function back() {
    S.detailOpen = false;
    syncDetail();
  }

  /* ---------------- ações do custo */
  function formData() {
    const f = $("fxCostForm");
    if (!f) return null;
    const g = (n) => (f.querySelector(`[name="${n}"]`) || {}).value;
    return {
      description: String(g("description") || "").trim(),
      vendor_name: String(g("vendor_name") || "").trim() || null,
      amount: g("amount") === "" ? null : Number(g("amount")),
      incurred_on: g("incurred_on"),
      category: g("category") || "other",
      notes: String(g("notes") || "").trim() || null,
    };
  }

  async function costAction(act, btn) {
    const f = $("fxCostForm");
    if (!f) return;
    const id = f.dataset.cost;
    const d = formData();
    if (act === "void") {
      const b = btn;
      if (!b.dataset.confirm) {
        document.querySelectorAll('[data-act="void"]').forEach((x) => {
          x.dataset.confirm = "1";
          if (!x.classList.contains("fx-btn--sq")) x.textContent = "Confirmar anular";
          else x.classList.add("is-armed");
        });
        setTimeout(() => document.querySelectorAll('[data-act="void"]').forEach((x) => {
          delete x.dataset.confirm;
          x.classList.remove("is-armed");
          if (!x.classList.contains("fx-btn--sq")) x.textContent = "Anular";
        }), 4000);
        return;
      }
      try {
        await api(`/api/finance/costs/${id}`, { method: "PATCH", body: JSON.stringify({ status: "void" }) });
        toast("Custo anulado", "success");
        S.sel = "res";
        S.detailOpen = false;
        await load();
      } catch (e) {
        toast(e.message || "Erro", "error");
      }
      return;
    }
    if (!d.description) return toast("Preencha a descrição", "error");
    if (d.amount == null || !Number.isFinite(d.amount) || d.amount <= 0) {
      if (act === "post" || d.amount != null) return toast("Informe o valor", "error");
    }
    const body = { description: d.description, vendor_name: d.vendor_name, incurred_on: d.incurred_on, category: d.category, notes: d.notes || "" };
    if (d.amount != null && d.amount > 0) body.amount = d.amount;
    if (act === "post") {
      body.status = "posted";
      body.ocr_status = "skipped";
    }
    const all = document.querySelectorAll(`[data-act="${act}"]`);
    all.forEach((x) => (x.disabled = true));
    try {
      await api(`/api/finance/costs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(act === "post" ? "Custo lançado no fluxo de caixa" : "Custo salvo", "success");
      await load();
    } catch (e) {
      toast(e.message || "Erro ao salvar", "error");
    } finally {
      all.forEach((x) => (x.disabled = false));
    }
  }

  /* ---------------- Novo custo */
  function setMode(mode) {
    document.querySelectorAll("#fxNewMode [data-mode]").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === mode));
    document.querySelectorAll("#fxNewModal [data-mode-pane]").forEach((p) => (p.hidden = p.dataset.modePane !== mode));
  }
  function openNew(mode) {
    const today = todayIso();
    const sf = $("scanForm");
    const cf = $("costForm");
    sf.reset();
    cf.reset();
    $("scanPreview").hidden = true;
    $("scanPreview").innerHTML = "";
    $("fxDropIn").hidden = false;
    sf.querySelector('[name="incurred_on"]').value = today;
    cf.querySelector('[name="incurred_on"]').value = today;
    const holder = cf.querySelector("[data-cat-picker]");
    holder.outerHTML = catChips("other");
    const t = parse(today);
    $("fxNewSub").textContent = `Entra no fluxo de caixa de ${MONTHS[t.getMonth()]}`;
    setMode(mode || "scan");
    $("fxNewModal").hidden = false;
    document.body.classList.add("fx-modal-open");
  }
  function closeNew() {
    $("fxNewModal").hidden = true;
    document.body.classList.remove("fx-modal-open");
  }

  async function submitScan(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const file = form.querySelector('[name="receipt_file"]').files[0];
    if (!file) return toast("Escolha a foto do recibo", "error");
    if (!file.type.startsWith("image/")) return toast("Use uma foto (JPG/PNG). PDF ainda não tem leitura automática.", "error");
    const btn = $("scanSubmitBtn");
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Lendo recibo…";
    try {
      const payload = {
        receipt_data_url: await fileToDataUrl(file),
        vendor_name: fd.get("vendor_name") || null,
        incurred_on: fd.get("incurred_on") || null,
      };
      if (fd.get("amount")) payload.amount = Number(fd.get("amount"));
      if (fd.get("force_draft")) payload.post = false;
      const j = await api("/api/finance/costs/scan", { method: "POST", body: JSON.stringify(payload) });
      closeNew();
      const d = j.data || {};
      toast(j.message || "Recibo enviado", d.auto_posted ? "success" : "info");
      S.sel = d.id ? `cost:${d.id}` : "res";
      S.detailOpen = !!d.id;
      await load();
    } catch (err) {
      toast(err.message || "Erro no scan", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  async function submitCost(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const payload = {
      description: fd.get("description"),
      vendor_name: fd.get("vendor_name") || null,
      amount: Number(fd.get("amount")),
      incurred_on: fd.get("incurred_on"),
      category: fd.get("category") || "other",
      notes: fd.get("notes") || null,
    };
    const file = form.querySelector('[name="receipt_file"]').files[0];
    try {
      if (file) payload.receipt_data_url = await fileToDataUrl(file);
      const j = await api("/api/finance/costs", { method: "POST", body: JSON.stringify(payload) });
      closeNew();
      toast("Custo salvo", "success");
      S.sel = j.data && j.data.id ? `cost:${j.data.id}` : "res";
      await load();
    } catch (err) {
      toast(err.message || "Erro ao salvar", "error");
    }
  }

  /* ---------------- eventos */
  function bind() {
    $("fxPrev").addEventListener("click", () => {
      const a = S.anchor;
      S.anchor = S.range === "year" ? new Date(a.getFullYear() - 1, a.getMonth(), 1) : new Date(a.getFullYear(), a.getMonth() - 1, 1);
      S.sel = "res";
      load();
    });
    $("fxNext").addEventListener("click", () => {
      const a = S.anchor;
      S.anchor = S.range === "year" ? new Date(a.getFullYear() + 1, a.getMonth(), 1) : new Date(a.getFullYear(), a.getMonth() + 1, 1);
      S.sel = "res";
      load();
    });
    $("fxRange").addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]");
      if (!b) return;
      S.range = b.dataset.range;
      if (S.range !== "custom") S.anchor = new Date();
      S.sel = "res";
      load();
    });
    ["finFrom", "finTo"].forEach((id) => $(id).addEventListener("change", () => { if (S.range === "custom") load(); }));
    $("fxSeg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-f]");
      if (!b) return;
      S.filter = b.dataset.f;
      renderList();
    });
    let qT;
    $("fxQ").addEventListener("input", (e) => {
      clearTimeout(qT);
      qT = setTimeout(() => { S.q = e.target.value; renderList(); }, 120);
    });
    document.addEventListener("click", (e) => {
      const f = e.target.closest("[data-fx-filter]");
      if (f) {
        e.preventDefault();
        S.filter = f.dataset.fxFilter;
        renderList();
        $("fxSeg").scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const a = e.target.closest("a[data-id]");
      if (a && (a.closest("#fxRows") || a.closest("#fxPhero") || a.closest("#fxPane"))) {
        e.preventDefault();
        select(a.dataset.id, true);
        return;
      }
      const nb = e.target.closest("[data-fx-new]");
      if (nb) return openNew(nb.dataset.fxNew);
      const cat = e.target.closest("[data-cat]");
      if (cat) {
        const box = cat.closest("[data-cat-picker]");
        box.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("is-on", x === cat));
        box.querySelector('input[type="hidden"]').value = cat.dataset.cat;
        return;
      }
      const act = e.target.closest("[data-act]");
      if (act && (act.closest("#fxPane") || act.closest("#fxMbar"))) {
        e.preventDefault();
        costAction(act.dataset.act, act);
        return;
      }
      if (e.target.closest("[data-fx-close]")) closeNew();
    });
    $("fxBack").addEventListener("click", (e) => { e.preventDefault(); back(); });
    $("fxScanBtn").addEventListener("click", () => openNew("scan"));
    $("fxNewBtn").addEventListener("click", () => openNew("manual"));
    $("fxNewMode").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (b) setMode(b.dataset.mode);
    });
    $("scanForm").querySelector('[name="receipt_file"]').addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      const pv = $("scanPreview");
      if (!file || !file.type.startsWith("image/")) { pv.hidden = true; $("fxDropIn").hidden = false; return; }
      pv.innerHTML = `<img src="${await fileToDataUrl(file)}" alt="Prévia do recibo" /><small>${esc(file.name)} · trocar</small>`;
      pv.hidden = false;
      $("fxDropIn").hidden = true;
    });
    $("scanForm").addEventListener("submit", submitScan);
    $("costForm").addEventListener("submit", submitCost);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("fxNewModal").hidden) closeNew();
    });
    window.addEventListener("resize", syncDetail);
    // a barra fixa do celular não pode ficar presa dentro do main (transform)
    document.body.appendChild($("fxMbar"));
    document.body.appendChild($("fxNewModal"));
  }

  function boot() {
    try {
      const u = new URL(location.href);
      const mov = u.searchParams.get("mov");
      if (mov) { S.sel = mov; S.detailOpen = true; }
      if (location.hash === "#scan" || u.searchParams.get("new") === "scan") setTimeout(() => openNew("scan"), 300);
      if (u.searchParams.get("new") === "cost") setTimeout(() => openNew("manual"), 300);
    } catch (e) { /* ignore */ }
    bind();
    api("/api/finance/ocr-status")
      .then((j) => {
        if (!(j.data && j.data.configured)) $("scanOcrHint").textContent = "Leitura automática desligada: o recibo fica salvo para você conferir o valor.";
      })
      .catch(() => {});
    load().catch((e) => toast(e.message || "Erro ao carregar o fluxo de caixa", "error"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
