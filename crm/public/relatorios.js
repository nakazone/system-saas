/**
 * Relatórios — resumo em mosaico (resultado, para agir, dinheiro, vendas, jobs, equipe)
 * + abas de detalhe (Vendas, Operação, Dinheiro, Equipe, Lucro) + IRSS (módulo extra).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const TABS = ["resumo", "vendas", "jobs", "dinheiro", "folha", "lucro", "irss"];
  const LEGACY_TABS = { receber: "dinheiro", caixa: "dinheiro" };
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  let hubData = null;
  let irssData = null;
  let activeTab = "resumo";
  let preset = "90";
  let irssFilters = { sector: "", employee_id: "" };

  // ---------- formatação ----------
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const n0 = (v) => Number(v) || 0;
  function money(v) {
    return n0(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  function money2(v) {
    return n0(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  function moneyShort(v) {
    const x = n0(v);
    if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
    if (Math.abs(x) >= 1e4) return `$${(x / 1e3).toFixed(1)}k`;
    return money(x);
  }
  const num = (v) => n0(v).toLocaleString("en-US", { maximumFractionDigits: 1 });
  const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`);
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function parseYmd(s) {
    const [y, m, d] = String(s || "").split("-").map(Number);
    return y ? new Date(y, (m || 1) - 1, d || 1) : null;
  }
  function shortDate(s, withYear) {
    const d = parseYmd(s);
    if (!d) return "—";
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
  }
  function rangeLabel(from, to) {
    const a = parseYmd(from);
    const b = parseYmd(to);
    if (!a || !b) return "—";
    const sameYear = a.getFullYear() === b.getFullYear();
    const thisYear = b.getFullYear() === new Date().getFullYear();
    return `${shortDate(from, !sameYear)} – ${shortDate(to, !thisYear || !sameYear)}`;
  }
  function monthLabel(key) {
    if (key === "none") return "Sem data";
    const [y, m] = String(key).split("-").map(Number);
    if (!y || !m) return key;
    return `${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${String(y).slice(2)}` : ""}`;
  }

  const ICON = {
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  };
  const svg = (name, size, w) =>
    `<svg viewBox="0 0 24 24" width="${size || 14}" height="${size || 14}" fill="none" stroke="currentColor" stroke-width="${w || 2.2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  /** Variação contra o período anterior (só quando o anterior tem valor). */
  function delta(cur, prev, opts) {
    const c = Number(cur);
    const p = Number(prev);
    if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return "";
    const d = ((c - p) / Math.abs(p)) * 100;
    if (Math.abs(d) < 0.5) return `<span class="rx-delta is-flat">igual ao anterior</span>`;
    const good = opts && opts.lowerIsBetter ? d < 0 : d > 0;
    return `<span class="rx-delta ${good ? "is-good" : "is-bad"}">${svg(d > 0 ? "up" : "down", 11, 2.6)}${Math.abs(Math.round(d))}%${
      opts && opts.long ? " vs anterior" : ""
    }</span>`;
  }

  // ---------- período ----------
  function periodState() {
    return { from: $("rptFrom")?.value || "", to: $("rptTo")?.value || "" };
  }

  function setPreset(kind) {
    const to = new Date();
    const from = new Date();
    if (kind === "30") from.setDate(to.getDate() - 30);
    else if (kind === "month") from.setDate(1);
    else if (kind === "ytd") from.setMonth(0, 1);
    else if (kind === "lastyear") {
      const y = to.getFullYear() - 1;
      from.setFullYear(y, 0, 1);
      to.setFullYear(y, 11, 31);
    } else from.setDate(to.getDate() - 90);
    preset = kind;
    if ($("rptFrom")) $("rptFrom").value = ymd(from);
    if ($("rptTo")) $("rptTo").value = ymd(to);
    syncPeriodUi();
  }

  function syncPeriodUi() {
    document.querySelectorAll("#rxPresets [data-preset]").forEach((b) => {
      b.classList.toggle("is-on", b.getAttribute("data-preset") === preset);
    });
    const { from, to } = periodState();
    if ($("rxRangeLabel")) $("rxRangeLabel").textContent = rangeLabel(from, to);
    const cmp = hubData?.compare?.period;
    if ($("rxCompareLabel")) $("rxCompareLabel").textContent = cmp ? `vs ${rangeLabel(cmp.from, cmp.to)}` : "";
  }

  // ---------- dados ----------
  async function api(url) {
    const r = await fetch(url, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function csvUrl(kind, extra) {
    const { from, to } = periodState();
    const q = new URLSearchParams({ format: "csv", from, to, ...(extra || {}) });
    return `/api/reports/${encodeURIComponent(kind)}?${q}`;
  }

  /** Números derivados que vários blocos usam. */
  function derive(d) {
    const cf = d.cashflow;
    const prevCf = d.compare?.cashflow;
    const folha = d.folha;
    const t = folha?.totals || {};
    const earned = n0(t.earned);
    const payrollDue = Math.max(0, n0(t.net) - n0(t.paid));
    const src = Array.isArray(d.sales?.conversion_source) ? d.sales.conversion_source : [];
    const best = src
      .filter((r) => n0(r.won) > 0)
      .sort((a, b) => n0(b.conversionRate) - n0(a.conversionRate) || n0(b.won) - n0(a.won))[0];
    const mostLeads = [...src].sort((a, b) => n0(b.total) - n0(a.total))[0];
    const loss = Array.isArray(d.sales?.loss_reasons) ? d.sales.loss_reasons : [];
    const topLoss = [...loss].sort((a, b) => n0(b.count) - n0(a.count))[0];
    return {
      cf,
      prevCf,
      margin: cf && n0(cf.inflow) > 0 ? (n0(cf.net) / n0(cf.inflow)) * 100 : null,
      earned,
      payrollDue,
      costPerDay: n0(t.days) > 0 ? earned / n0(t.days) : null,
      costPerSqft: n0(t.sqft) > 0 && folha ? n0(folha.jobs_cost_total) / n0(t.sqft) : null,
      payrollShare: cf && n0(cf.inflow) > 0 && folha ? (earned / n0(cf.inflow)) * 100 : null,
      pipelineOpen: d.executive?.overview_kpis?.pipeline_open?.value,
      best,
      mostLeads,
      topLoss,
    };
  }

  // ---------- peças ----------
  function card(cls, title, link, body) {
    return `<section class="rx-card ${cls || ""}">
      <h3 class="rx-card__h">${title}${link || ""}</h3>
      ${body}
    </section>`;
  }
  const lnk = (href, label) => `<a class="rx-link" href="${esc(href)}">${esc(label)}</a>`;
  function stack(parts) {
    const total = parts.reduce((s, p) => s + Math.max(0, n0(p.v)), 0);
    if (total <= 0) return `<div class="rx-stack is-empty"><i style="flex:1"></i></div>`;
    return `<div class="rx-stack">${parts
      .filter((p) => n0(p.v) > 0)
      .map((p) => `<i class="${p.c}" style="flex:${n0(p.v)}"></i>`)
      .join("")}</div>`;
  }
  function legend(parts, list) {
    return `<div class="rx-leg${list ? " rx-leg--list" : ""}">${parts
      .map((p) => `<span><i class="${p.c}"></i>${esc(p.l)}<b>${p.t}</b></span>`)
      .join("")}</div>`;
  }
  function stat(label, value, extra) {
    return `<div class="rx-stat"><span>${esc(label)}</span><b>${value}</b>${extra || ""}</div>`;
  }
  function hbars(rows, opts) {
    const max = Math.max(1, ...rows.map((r) => n0(r.v)));
    if (!rows.length) return `<p class="rx-empty">Sem dados neste período.</p>`;
    return `<div class="rx-hbars">${rows
      .map(
        (r) => `<div class="rx-hbar">
          <span class="rx-hbar__l" title="${esc(r.l)}">${esc(r.l)}</span>
          <span class="rx-hbar__t"><i class="${r.c || ""}" style="width:${n0(r.v) > 0 ? Math.max(2, (n0(r.v) / max) * 100) : 0}%"></i>${
            r.v2 != null ? `<i class="rx-hbar__in ${r.c2 || "is-or"}" style="width:${Math.max(0, (n0(r.v2) / max) * 100)}%"></i>` : ""
          }</span>
          <em>${r.t}</em>
        </div>`,
      )
      .join("")}${opts && opts.legend ? legend(opts.legend) : ""}</div>`;
  }
  function cols(items) {
    const max = Math.max(1, ...items.map((i) => n0(i.v)));
    return `<div class="rx-cols">${items
      .map(
        (i) => `<div><b>${i.t}</b><i class="${i.c || ""}" style="height:${Math.max(4, (n0(i.v) / max) * 100)}%"></i><span>${esc(
          i.l,
        )}</span></div>`,
      )
      .join("")}</div>`;
  }
  function kpiStrip(items) {
    return `<div class="rx-strip">${items
      .filter(Boolean)
      .map(
        (k) => `<div class="rx-kpi${k.hot ? " is-hot" : ""}"><span>${esc(k.l)}</span><b>${k.v}</b>${k.d || ""}${
          k.n ? `<small>${k.n}</small>` : ""
        }</div>`,
      )
      .join("")}</div>`;
  }
  function table(headers, rows) {
    if (!rows.length) return '<p class="rx-empty">Sem dados neste período.</p>';
    return `<div class="rx-table-wrap"><table class="rx-table"><thead><tr>${headers
      .map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.label)}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c, i) => `<td class="${headers[i]?.num ? "num" : ""}" data-label="${esc(headers[i]?.label || "")}">${c}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`;
  }
  const noAccess = (what) => `<div class="rx-card rx-span-12"><p class="rx-empty">Sem permissão para ver ${esc(what)}.</p></div>`;

  // ---------- Resumo (mosaico) ----------
  function todoRows(d, x) {
    const rows = [];
    const jobs = d.jobs;
    const mi = d.money_in;
    if (jobs && n0(jobs.to_invoice) > 0) {
      rows.push({ n: jobs.to_invoice, hot: true, t: "Jobs para faturar", s: "Concluídos sem fatura", v: money(jobs.to_invoice_value), href: "jobs.html" });
    }
    if (mi && n0(mi.draft_count) > 0) {
      rows.push({ n: mi.draft_count, t: mi.draft_count > 1 ? "Faturas em rascunho" : "Fatura em rascunho", s: "Falta enviar ao cliente", v: money(mi.drafts), href: "invoices.html" });
    }
    if (mi && n0(mi.overdue_count) > 0) {
      rows.push({
        n: mi.overdue_count,
        hot: true,
        t: mi.overdue_count > 1 ? "Faturas vencidas" : "Fatura vencida",
        s: `Até ${mi.overdue_max_days} ${mi.overdue_max_days === 1 ? "dia" : "dias"} de atraso`,
        v: money(mi.overdue),
        href: "invoices.html",
      });
    }
    if (mi) {
      const waitingCount = n0(mi.open_count) - n0(mi.overdue_count);
      if (waitingCount > 0) {
        rows.push({ n: waitingCount, t: "Aguardando pagamento", s: "Faturas enviadas no prazo", v: money(n0(mi.open) - n0(mi.overdue)), href: "invoices.html" });
      }
    }
    if (d.folha && x.payrollDue > 0.004) {
      const people = (d.folha.employees || []).filter((e) => n0(e.net) - n0(e.paid) > 0.004).length;
      rows.push({ n: people || "", t: "Folha a pagar", s: "Ganho no período menos o pago", v: money(x.payrollDue), href: "folha.html" });
    }
    const attn = n0(d.executive?.attention_count);
    if (attn > 0) rows.push({ n: attn, t: "Precisa da sua atenção", s: "Lista no Início", v: "", href: "/dashboard" });
    return rows;
  }

  function cardTodo(d, x) {
    const rows = todoRows(d, x);
    const body = rows.length
      ? `<div class="rx-todo">${rows
          .slice(0, 5)
          .map(
            (r) => `<a class="rx-todo__row" href="${esc(r.href)}">
              <span class="rx-todo__n${r.hot ? " is-hot" : ""}">${esc(r.n)}</span>
              <span class="rx-todo__tx"><b>${esc(r.t)}</b><span>${esc(r.s)}</span></span>
              <span class="rx-todo__v">${r.v}</span>
              <span class="rx-todo__go">${svg("chev", 14)}</span>
            </a>`,
          )
          .join("")}</div>`
      : `<div class="rx-allclear"><span>${svg("check", 18, 2.4)}</span><p><b>Nada pendente</b>Sem jobs para faturar, faturas vencidas ou folha em aberto.</p></div>`;
    return card("rx-c-todo", "Para agir", "", body);
  }

  function cardResult(d, x) {
    const cf = d.cashflow;
    if (!cf) return "";
    const max = Math.max(n0(cf.inflow), n0(cf.outflow), 1);
    const bar = (l, v, c) =>
      `<div class="rx-b2"><span>${l}</span><i class="${c}" style="width:${Math.max(1, (n0(v) / max) * 100)}%"></i><em>${money(v)}</em></div>`;
    return card(
      "rx-c-result rx-card--dark",
      "Resultado",
      delta(cf.net, x.prevCf?.net, { long: true }),
      `<div class="rx-big">${money(cf.net)}${x.margin != null ? `<small>margem ${pct(x.margin)}</small>` : ""}</div>
       <p class="rx-note">Entrou ${money(cf.inflow)} · saiu ${money(cf.outflow)}</p>
       <div class="rx-b2s">
         ${bar("Entradas", cf.inflow, "is-white")}
         ${bar("Custos", cf.costs, "is-grey")}
         ${bar("Folha paga", cf.payroll_paid, "is-or")}
       </div>
       <div class="rx-row3">
         ${stat("Recebimentos", num(cf.receipt_count))}
         ${stat("Folha pendente", money(cf.payroll_pending))}
         ${stat("Período anterior", x.prevCf ? money(x.prevCf.net) : "—")}
       </div>`,
    );
  }

  function cardRecv(d) {
    const mi = d.money_in;
    if (!mi) return "";
    const note =
      n0(mi.open_count) > 0
        ? `${mi.open_count} ${mi.open_count === 1 ? "fatura enviada" : "faturas enviadas"}`
        : n0(mi.drafts) > 0
          ? `Nada enviado em aberto · ${money(mi.drafts)} em rascunho`
          : "Nenhuma fatura em aberto";
    const parts = [
      { v: mi.on_time, c: "is-ink", l: "No prazo", t: money(mi.on_time) },
      { v: mi.due_7_days, c: "is-grey", l: "Vence em 7 dias", t: money(mi.due_7_days) },
      { v: mi.overdue, c: "is-deep", l: "Vencido", t: money(mi.overdue) },
    ];
    return card(
      "rx-c-recv rx-ph-mini",
      "A receber",
      lnk("invoices.html", "Invoices"),
      `<div class="rx-big rx-big--md">${money(mi.open)}</div>
       <p class="rx-note">${esc(note)}</p>
       <p class="rx-ph-note">${n0(mi.overdue) > 0 ? `${money(mi.overdue)} vencido` : esc(note)}</p>
       <div class="rx-detail">${stack(parts)}${legend(parts, true)}</div>`,
    );
  }

  function cardSales(d, x) {
    const ss = d.sales_summary;
    if (!ss) return "";
    const prev = d.compare?.sales;
    const rate = ss.conversion_rate;
    const ringDeg = Math.max(0, Math.min(100, n0(rate))) * 3.6;
    const facts = [];
    if (x.best) facts.push(`<span>Melhor origem<b>${esc(x.best.source)} · ${pct(x.best.conversionRate)}</b></span>`);
    else if (x.mostLeads && n0(x.mostLeads.total) > 0)
      facts.push(`<span>Mais leads<b>${esc(x.mostLeads.source)} (${num(x.mostLeads.total)})</b></span>`);
    if (x.topLoss) facts.push(`<span>Mais perdas<b>${esc(x.topLoss.reason)} (${num(x.topLoss.count)})</b></span>`);
    return card(
      "rx-c-sales rx-ph-mini",
      "Vendas",
      `<button type="button" class="rx-link" data-go="vendas">Detalhe</button>`,
      `<div class="rx-hl">
         <div class="rx-hl__main">
           <div class="rx-big rx-big--md">${money(ss.won_value)}</div>
           <p class="rx-note">ganhos em ${num(ss.won_count)} ${ss.won_count === 1 ? "orçamento" : "orçamentos"} ${delta(ss.won_value, prev?.won_value)}</p>
           <p class="rx-ph-note">${rate != null ? `${pct(rate)} de conversão` : `${num(ss.leads)} leads`}</p>
         </div>
         <div class="rx-ringw rx-detail" title="Conversão: orçamentos ganhos ÷ enviados"><div class="rx-ring" style="--deg:${ringDeg}deg"><span>${pct(rate)}</span></div><small>conversão</small></div>
       </div>
       <div class="rx-row3 rx-detail">
         ${stat("Leads", num(ss.leads), delta(ss.leads, prev?.leads))}
         ${stat("Ticket médio", ss.avg_ticket != null ? money(ss.avg_ticket) : "—")}
         ${stat("Pipeline aberto", x.pipelineOpen != null ? money(x.pipelineOpen) : "—")}
       </div>
       ${facts.length ? `<div class="rx-facts rx-detail">${facts.join("")}</div>` : ""}`,
    );
  }

  function cardJobs(d) {
    const j = d.jobs;
    if (!j) return "";
    const bs = j.by_status || {};
    const parts = [
      { v: bs.in_progress, c: "is-or", l: "Em campo", t: num(bs.in_progress) },
      { v: bs.scheduled, c: "is-ink", l: "Agendados", t: num(bs.scheduled) },
      { v: j.completed_in_period, c: "is-light", l: "Concluídos no período", t: num(j.completed_in_period) },
    ];
    return card(
      "rx-c-jobs rx-ph-mini",
      "Jobs",
      `<button type="button" class="rx-link" data-go="jobs">Detalhe</button>`,
      `<div class="rx-big rx-big--md">${num(j.active)}<small>ativos</small></div>
       <p class="rx-ph-note">${num(bs.in_progress)} em campo</p>
       <div class="rx-detail">${stack(parts)}${legend(parts, true)}</div>`,
    );
  }

  function cardTeam(d, x) {
    const f = d.folha;
    if (!f) return "";
    const t = f.totals || {};
    const parts = [
      { v: t.paid, c: "is-ink", l: "Pago", t: money(t.paid) },
      { v: x.payrollDue, c: "is-or", l: "A pagar", t: money(x.payrollDue) },
    ];
    return card(
      "rx-c-team rx-ph-mini",
      "Equipe",
      `<button type="button" class="rx-link" data-go="folha">Detalhe</button>`,
      `<div class="rx-big rx-big--md">${money(x.earned)}<small>no período</small></div>
       <p class="rx-ph-note">${x.payrollDue > 0.004 ? `${money(x.payrollDue)} a pagar` : "Tudo pago"}</p>
       <div class="rx-detail">${stack(parts)}${legend(parts)}</div>
       <div class="rx-row3 rx-detail">
         ${stat("Custo por dia", x.costPerDay != null ? money(x.costPerDay) : "—")}
         ${stat("Custo por sq ft", x.costPerSqft != null ? money2(x.costPerSqft) : "—")}
         ${stat("% das entradas", pct(x.payrollShare))}
       </div>`,
    );
  }

  function forecastItems(d) {
    const mi = d.money_in;
    const items = [];
    if (mi) {
      if (n0(mi.overdue) > 0) items.push({ l: "Vencido", v: mi.overdue, t: moneyShort(mi.overdue), c: "is-deep" });
      const months = (mi.by_month || []).filter((m) => m.month !== "none");
      const none = (mi.by_month || []).find((m) => m.month === "none");
      months.slice(0, 3).forEach((m, i) => items.push({ l: monthLabel(m.month), v: m.amount, t: moneyShort(m.amount), c: i === 0 ? "is-ink" : i === 1 ? "is-slate" : "is-grey" }));
      const later = months.slice(3).reduce((s, m) => s + n0(m.amount), 0) + n0(none?.amount);
      if (later > 0) items.push({ l: "Depois", v: later, t: moneyShort(later), c: "is-grey" });
      if (n0(mi.drafts) > 0) items.push({ l: "Rascunhos", v: mi.drafts, t: moneyShort(mi.drafts), c: "is-light" });
    }
    if (d.jobs && n0(d.jobs.to_invoice_value) > 0) items.push({ l: "A faturar", v: d.jobs.to_invoice_value, t: moneyShort(d.jobs.to_invoice_value), c: "is-or" });
    return items;
  }

  function cardForecast(d) {
    if (!d.money_in && !d.jobs) return "";
    const items = forecastItems(d);
    const total = items.reduce((s, i) => s + n0(i.v), 0);
    return card(
      "rx-c-fore",
      "Vai entrar",
      lnk("invoices.html", "Invoices"),
      items.length
        ? `<p class="rx-note rx-note--top">${money(total)} entre faturas abertas, rascunhos e jobs prontos para faturar</p>${cols(items)}`
        : `<p class="rx-empty">Nada a receber nem a faturar.</p>`,
    );
  }

  function cardProfitOrSources(d) {
    const floors = d.profitability?.byFlooringType || [];
    if (floors.length) {
      const rows = floors
        .slice()
        .sort((a, b) => n0(b.revenue) - n0(a.revenue))
        .slice(0, 5)
        .map((r) => {
          const rev = n0(r.revenue);
          const m = rev > 0 ? (n0(r.margin) / rev) * 100 : null;
          return { l: r.flooringType, v: rev, v2: Math.max(0, n0(r.margin)), c: "is-ink", t: pct(m) };
        });
      return card(
        "rx-c-side",
        "Lucro por tipo de piso",
        `<button type="button" class="rx-link" data-go="lucro">Detalhe</button>`,
        hbars(rows.map((r) => ({ ...r, v2: r.v2, c2: "is-or" })), {
          legend: [
            { c: "is-ink", l: "Receita", t: "" },
            { c: "is-or", l: "Lucro", t: "" },
          ],
        }),
      );
    }
    const src = Array.isArray(d.sales?.conversion_source) ? d.sales.conversion_source : [];
    if (!src.length) return "";
    const rows = src
      .slice()
      .sort((a, b) => n0(b.total) - n0(a.total))
      .slice(0, 5)
      .map((r) => ({ l: r.source, v: r.total, v2: r.won, c: "is-light", t: `${num(r.total)} · ${pct(r.conversionRate)}` }));
    return card(
      "rx-c-side",
      "Leads por origem",
      `<button type="button" class="rx-link" data-go="vendas">Detalhe</button>`,
      hbars(rows, {
        legend: [
          { c: "is-light", l: "Leads", t: "" },
          { c: "is-or", l: "Ganhos", t: "" },
        ],
      }),
    );
  }

  function renderResumo(d) {
    const x = derive(d);
    const blocks = [cardResult(d, x), cardTodo(d, x), cardRecv(d), cardSales(d, x), cardJobs(d), cardTeam(d, x), cardForecast(d), cardProfitOrSources(d)].filter(Boolean);
    if (!blocks.length) return `<div class="rx-card"><p class="rx-empty">Sem dados neste período.</p></div>`;
    const cls = ["rx-bento", !d.cashflow ? "no-result" : "", !d.money_in ? "no-recv" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}">${blocks.join("")}</div>`;
  }

  // ---------- Vendas ----------
  function renderVendas(d) {
    const ss = d.sales_summary;
    const sales = d.sales || {};
    if (!ss && !sales.conversion_source && !sales.conversion_salesperson) return noAccess("vendas");
    const prev = d.compare?.sales || {};
    const x = derive(d);
    const src = Array.isArray(sales.conversion_source) ? sales.conversion_source : [];
    const sp = Array.isArray(sales.conversion_salesperson) ? sales.conversion_salesperson : [];
    const loss = Array.isArray(sales.loss_reasons) ? sales.loss_reasons : [];
    return `${
      ss
        ? kpiStrip([
            { l: "Receita ganha", v: money(ss.won_value), d: delta(ss.won_value, prev.won_value) },
            { l: "Orçamentos ganhos", v: num(ss.won_count), n: `de ${num(ss.quotes_sent)} enviados` },
            { l: "Conversão", v: pct(ss.conversion_rate), n: "ganhos ÷ enviados" },
            { l: "Ticket médio", v: ss.avg_ticket != null ? money(ss.avg_ticket) : "—", d: delta(ss.avg_ticket, prev.avg_ticket) },
            { l: "Leads", v: num(ss.leads), d: delta(ss.leads, prev.leads) },
            x.pipelineOpen != null ? { l: "Pipeline aberto", v: money(x.pipelineOpen), n: "orçamentos esperando o cliente" } : null,
          ])
        : ""
    }
    <div class="rx-grid2">
      ${card(
        "",
        "Leads por origem",
        "",
        hbars(
          src
            .slice()
            .sort((a, b) => n0(b.total) - n0(a.total))
            .map((r) => ({ l: r.source, v: r.total, v2: r.won, c: "is-light", t: `${num(r.total)} · ${pct(r.conversionRate)}` })),
          { legend: [{ c: "is-light", l: "Leads", t: "" }, { c: "is-or", l: "Ganhos", t: "" }] },
        ),
      )}
      ${card(
        "",
        "Motivos de perda",
        lnk("/dashboard", "Pipeline"),
        hbars(
          loss
            .slice()
            .sort((a, b) => n0(b.count) - n0(a.count))
            .map((r) => ({ l: r.reason, v: r.count, c: "is-deep", t: num(r.count) })),
        ),
      )}
    </div>
    ${card(
      "",
      "Por vendedor",
      lnk("quotes.html", "Quotes"),
      table(
        [{ label: "Vendedor" }, { label: "Orçamentos", num: true }, { label: "Ganhos", num: true }, { label: "Valor orçado", num: true }, { label: "Valor ganho", num: true }, { label: "Conversão", num: true }],
        sp
          .slice()
          .sort((a, b) => n0(b.wonValue) - n0(a.wonValue) || n0(b.value) - n0(a.value))
          .map((r) => [esc(r.name === "Unassigned" ? "Sem vendedor" : r.name), num(r.quotes), num(r.won), money(r.value), money(r.wonValue), pct(r.conversionRate)]),
      ),
    )}`;
  }

  // ---------- Operação ----------
  const STATUS_PT = { draft: "Rascunho", scheduled: "Agendado", in_progress: "Em campo", completed: "Concluído", canceled: "Cancelado" };
  const STATUS_C = { draft: "is-light", scheduled: "is-ink", in_progress: "is-or", completed: "is-grey", canceled: "is-light" };

  function renderJobs(d) {
    const j = d.jobs;
    if (!j) return noAccess("jobs");
    const bs = j.by_status || {};
    return `${kpiStrip([
      { l: "Ativos", v: num(j.active), n: "agendados + em campo" },
      { l: "Em campo", v: num(bs.in_progress) },
      { l: "Agendados no período", v: num(j.scheduled_in_period) },
      { l: "Concluídos no período", v: num(j.completed_in_period) },
      { l: "A faturar", v: money(j.to_invoice_value), n: `${num(j.to_invoice)} ${j.to_invoice === 1 ? "job concluído" : "jobs concluídos"}`, hot: n0(j.to_invoice) > 0 },
    ])}
    <div class="rx-grid2">
      ${card(
        "",
        "Jobs por status",
        lnk("jobs.html", "Jobs"),
        hbars(
          ["in_progress", "scheduled", "completed", "draft"]
            .filter((k) => bs[k] != null)
            .map((k) => ({ l: STATUS_PT[k], v: bs[k], c: STATUS_C[k], t: num(bs[k]) })),
        ),
      )}
      ${card(
        "",
        "Cobrança dos jobs",
        lnk("invoices.html", "Invoices"),
        `<div class="rx-pairs">
          ${stat("Concluídos sem fatura", `${num(j.to_invoice)} · ${money(j.to_invoice_value)}`)}
          ${stat("Faturados aguardando pagamento", `${num(j.awaiting_payment)} · ${money(j.awaiting_payment_value)}`)}
          ${stat("Em aberto (não concluídos)", num(j.total_open))}
        </div>
        <p class="rx-note rx-note--top">${lnk("schedule.html", "Ver na Calendar")}</p>`,
      )}
    </div>`;
  }

  // ---------- Dinheiro ----------
  function renderDinheiro(d) {
    const cf = d.cashflow;
    const mi = d.money_in;
    const aging = d.receivables?.ar_aging;
    if (!cf && !mi) return noAccess("o financeiro");
    const prev = d.compare?.cashflow || {};
    const x = derive(d);
    const items = forecastItems(d);
    const flowRows = cf
      ? [
          { l: "Entradas", v: cf.inflow, c: "is-ink", t: money(cf.inflow) },
          { l: "Custos", v: cf.costs, c: "is-grey", t: money(cf.costs) },
          { l: "Folha paga", v: cf.payroll_paid, c: "is-or", t: money(cf.payroll_paid) },
          { l: "Folha pendente", v: cf.payroll_pending, c: "is-light", t: money(cf.payroll_pending) },
        ]
      : [];
    return `${kpiStrip([
      cf ? { l: "Entradas", v: money(cf.inflow), d: delta(cf.inflow, prev.inflow), n: `${num(cf.receipt_count)} recebimentos` } : null,
      cf ? { l: "Saídas", v: money(cf.outflow), d: delta(cf.outflow, prev.outflow, { lowerIsBetter: true }) } : null,
      cf ? { l: "Resultado", v: money(cf.net), d: delta(cf.net, prev.net), n: x.margin != null ? `margem ${pct(x.margin)}` : "" } : null,
      mi ? { l: "A receber", v: money(mi.open), n: `${num(mi.open_count)} faturas enviadas` } : null,
      mi ? { l: "Vencido", v: money(mi.overdue), n: n0(mi.overdue_count) ? `${num(mi.overdue_count)} · até ${mi.overdue_max_days} dias` : "nada vencido", hot: n0(mi.overdue) > 0 } : null,
    ])}
    <div class="rx-grid2">
      ${cf ? card("", "Entradas e saídas", lnk("finance.html", "Fluxo de caixa"), hbars(flowRows)) : ""}
      ${card("", "Vai entrar", lnk("invoices.html", "Invoices"), items.length ? cols(items) : `<p class="rx-empty">Nada a receber nem a faturar.</p>`)}
    </div>
    ${
      aging
        ? card(
            "",
            "Faturas abertas por tempo desde a emissão",
            "",
            hbars(Object.entries(aging.buckets || {}).map(([b, v]) => ({ l: `${b} dias`, v, c: b === "0-30" ? "is-ink" : "is-deep", t: money(v) }))),
          )
        : ""
    }`;
  }

  // ---------- Equipe ----------
  const SECTOR_PT = { installation: "Instalação", sand_finish: "Lixa e acabamento" };

  function renderFolha(d) {
    const f = d.folha;
    if (!f) return noAccess("a folha");
    const t = f.totals || {};
    const x = derive(d);
    const irss = hubData?.modules?.irss;
    return `${kpiStrip([
      { l: "Folha no período", v: money(x.earned), n: `${num(f.employee_count || t.employees)} pessoas` },
      { l: "Pago", v: money(t.paid) },
      { l: "A pagar", v: money(x.payrollDue), hot: x.payrollDue > 0.004 },
      { l: "Dias trabalhados", v: num(t.days), n: n0(t.overtime_hours) ? `${num(t.overtime_hours)} h extra` : "" },
      { l: "Custo por dia", v: x.costPerDay != null ? money(x.costPerDay) : "—" },
      { l: "Custo por sq ft", v: x.costPerSqft != null ? money2(x.costPerSqft) : "—", n: n0(t.sqft) ? `${num(t.sqft)} sq ft lançados` : "" },
    ])}
    ${card(
      "",
      "Por funcionário",
      `<span class="rx-card__acts">${irss ? `<button type="button" class="rx-btn rx-btn--sm" data-go="irss">Relatório IRSS</button>` : ""}${lnk("folha.html", "Folha")}</span>`,
      table(
        [{ label: "Funcionário" }, { label: "Setor" }, { label: "Dias", num: true }, { label: "Ganho", num: true }, { label: "Pago", num: true }, { label: "A pagar", num: true }],
        (f.employees || []).map((e) => {
          const due = Math.max(0, n0(e.net) - n0(e.paid));
          return [esc(e.name), esc(SECTOR_PT[e.sector] || e.sector || "—"), num(e.days), money2(e.earned), money2(e.paid), due > 0.004 ? `<b>${money2(due)}</b>` : "—"];
        }),
      ),
    )}`;
  }

  // ---------- Lucro ----------
  function renderLucro(d) {
    const gp = d.executive?.overview_kpis?.gross_profit;
    const floors = d.profitability?.byFlooringType || [];
    if (!d.access?.pricing) return noAccess("lucratividade (precisa da permissão de preços)");
    const gpMargin = gp && n0(gp.revenue) > 0 ? (n0(gp.value) / n0(gp.revenue)) * 100 : null;
    return `${
      gp
        ? kpiStrip([
            { l: "Lucro bruto · mês atual", v: money(gp.value), d: delta(gp.value, gp.previous_value), n: `${num(gp.count)} orçamentos fechados` },
            { l: "Receita", v: money(gp.revenue) },
            { l: "Custo", v: money(gp.cost) },
            { l: "Margem", v: pct(gpMargin) },
          ])
        : ""
    }
    ${card(
      "",
      "Por tipo de piso",
      "",
      floors.length
        ? hbars(
            floors
              .slice()
              .sort((a, b) => n0(b.revenue) - n0(a.revenue))
              .map((r) => ({ l: r.flooringType, v: r.revenue, v2: Math.max(0, n0(r.margin)), c: "is-ink", t: pct(n0(r.revenue) > 0 ? (n0(r.margin) / n0(r.revenue)) * 100 : null) })),
            { legend: [{ c: "is-ink", l: "Receita", t: "" }, { c: "is-or", l: "Lucro", t: "" }] },
          ) +
            table(
              [{ label: "Tipo" }, { label: "Projetos", num: true }, { label: "Receita", num: true }, { label: "Custo", num: true }, { label: "Lucro", num: true }],
              floors.map((r) => [esc(r.flooringType), num(r.count), money(r.revenue), money(r.actual), money(r.margin)]),
            )
        : `<p class="rx-empty">Aparece quando houver projetos com custos reais lançados.</p>`,
    )}`;
  }

  // ---------- IRSS (módulo extra) ----------
  const METHOD_PT = { cash: "Cash", zelle: "Zelle", check: "Check", ach: "ACH", other: "Outro" };

  function renderIrss(data) {
    if (!data) return `<div class="rx-card"><p class="rx-empty">Carregando IRSS…</p></div>`;
    const s = data.summary || {};
    const opts = data.employee_options || [];
    const sectors = [...new Set(opts.map((e) => e.sector).filter(Boolean))].sort();
    const months = data.by_month || [];
    const methods = data.by_method || [];
    return `<div class="rx-sub">
      <button type="button" class="rx-btn rx-btn--sm" data-go="folha">‹ Equipe</button>
      <div><h2>IRSS · relatório avançado <span class="rx-tag">Extra</span></h2><p>Ganhos e pagamentos da folha para conferência fiscal / 1099.</p></div>
    </div>
    <div class="rx-card rx-filters">
      <label><span>Ano</span><select id="irssYearPreset"><option value="">Período atual</option><option value="ytd">Ano corrente</option><option value="lastyear">Ano anterior</option></select></label>
      <label><span>Setor</span><select id="irssSector"><option value="">Todos</option>${sectors
        .map((sec) => `<option value="${esc(sec)}"${irssFilters.sector === sec ? " selected" : ""}>${esc(SECTOR_PT[sec] || sec)}</option>`)
        .join("")}</select></label>
      <label><span>Funcionário</span><select id="irssEmployee"><option value="">Todos</option>${opts
        .map((e) => `<option value="${esc(e.id)}"${irssFilters.employee_id === e.id ? " selected" : ""}>${esc(e.name)}</option>`)
        .join("")}</select></label>
      <button type="button" class="rx-btn rx-btn--pri" id="irssApply">Aplicar filtros</button>
    </div>
    ${kpiStrip([
      { l: "Pessoas", v: num(s.employees) },
      { l: "Ganho", v: money2(s.earned) },
      { l: "Líquido", v: money2(s.net) },
      { l: "Pago", v: money2(s.paid) },
      { l: "Em aberto", v: money2(s.unpaid), hot: n0(s.unpaid) > 0 },
      { l: "Dias", v: num(s.days), n: n0(s.overtime_hours) ? `${num(s.overtime_hours)} h extra` : "" },
    ])}
    <div class="rx-grid2">
      ${card(
        "",
        "Mês a mês",
        "",
        hbars(
          months.map((m) => ({ l: monthLabel(m.month), v: Math.max(n0(m.earned), n0(m.paid)), v2: m.paid, c: "is-light", t: `${money(m.earned)} · ${money(m.paid)}` })),
          { legend: [{ c: "is-light", l: "Ganho", t: "" }, { c: "is-or", l: "Pago", t: "" }] },
        ),
      )}
      ${card("", "Por método de pagamento", "", hbars(methods.map((m) => ({ l: METHOD_PT[m.method] || m.method, v: m.amount, c: "is-ink", t: `${money(m.amount)} · ${num(m.count)}` }))))}
    </div>
    ${card(
      "",
      "Por setor",
      "",
      table(
        [{ label: "Setor" }, { label: "Pessoas", num: true }, { label: "Ganho", num: true }, { label: "Pago", num: true }, { label: "Em aberto", num: true }],
        (data.by_sector || []).map((r) => [esc(SECTOR_PT[r.sector] || r.sector), num(r.employees), money2(r.earned), money2(r.paid), money2(r.unpaid)]),
      ),
    )}
    ${card(
      "",
      "Por funcionário",
      "",
      table(
        [{ label: "Nome" }, { label: "Setor" }, { label: "Dias", num: true }, { label: "Ganho", num: true }, { label: "Líquido", num: true }, { label: "Pago", num: true }, { label: "Em aberto", num: true }, { label: "Método" }],
        (data.employees || []).map((e) => [
          esc(e.name),
          esc(SECTOR_PT[e.sector] || e.sector),
          num(e.days),
          money2(e.earned),
          money2(e.net),
          money2(e.paid),
          money2(e.unpaid),
          esc(METHOD_PT[e.payment_method] || e.payment_method || "—"),
        ]),
      ),
    )}
    ${card(
      "",
      "Pagamentos no período",
      "",
      table(
        [{ label: "Data" }, { label: "Nome" }, { label: "Método" }, { label: "Ref." }, { label: "Valor", num: true }],
        (data.payments || []).map((p) => [esc(shortDate(p.paid_on, true)), esc(p.name), esc(METHOD_PT[p.method] || p.method), esc(p.reference || "—"), money2(p.amount)]),
      ),
    )}
    ${card(
      "",
      "Custo alocado em jobs",
      "",
      table(
        [{ label: "Job" }, { label: "Título" }, { label: "Pessoas", num: true }, { label: "Sq ft", num: true }, { label: "Custo", num: true }],
        (data.jobs || []).map((j) => [esc(j.number != null ? `#${j.number}` : "—"), esc(j.title), num(j.people), num(j.sqft), money2(j.cost)]),
      ),
    )}`;
  }

  // ---------- exportar ----------
  const EXPORTS = {
    resumo: [["executive", "Resumo"]],
    vendas: [["conversion-source", "Leads por origem"], ["conversion-salesperson", "Por vendedor"], ["loss-reasons", "Motivos de perda"]],
    jobs: [["jobs-ops", "Jobs por status"]],
    dinheiro: [["cashflow", "Fluxo de caixa"], ["ar-aging", "Faturas abertas por tempo"], ["projected-revenue", "Receita prevista"]],
    folha: [["folha", "Folha por funcionário"]],
    lucro: [["profitability", "Lucro por tipo de piso"]],
    irss: [["irss", "IRSS por funcionário"]],
  };

  function renderExportMenu() {
    const menu = $("rxExportMenu");
    if (!menu) return;
    const extra = activeTab === "irss" ? { ...(irssFilters.sector ? { sector: irssFilters.sector } : {}), ...(irssFilters.employee_id ? { employee_id: irssFilters.employee_id } : {}) } : null;
    menu.innerHTML = `<p>CSV do período</p>${(EXPORTS[activeTab] || [])
      .map(([kind, label]) => `<a href="${esc(csvUrl(kind, extra))}" download>${esc(label)}</a>`)
      .join("")}`;
  }

  // ---------- abas ----------
  function syncTabsUi() {
    const shown = activeTab === "irss" ? "folha" : activeTab;
    document.querySelectorAll("#rptTabs [data-tab]").forEach((btn) => {
      const on = btn.getAttribute("data-tab") === shown;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (activeTab === "irss" && hubData && !hubData.modules?.irss) activeTab = "folha";
  }

  function bindIrssTools() {
    $("irssApply")?.addEventListener("click", async () => {
      const year = $("irssYearPreset")?.value || "";
      if (year === "ytd" || year === "lastyear") setPreset(year);
      irssFilters.sector = $("irssSector")?.value || "";
      irssFilters.employee_id = $("irssEmployee")?.value || "";
      irssData = null;
      await loadIrss(true);
      renderActive();
    });
  }

  async function loadIrss(force) {
    if (!hubData?.modules?.irss) return;
    if (irssData && !force) return;
    const { from, to } = periodState();
    const q = new URLSearchParams({ from, to });
    if (irssFilters.sector) q.set("sector", irssFilters.sector);
    if (irssFilters.employee_id) q.set("employee_id", irssFilters.employee_id);
    const j = await api(`/api/reports/irss?${q}`);
    irssData = j.data?.result || j.data || null;
  }

  function renderActive() {
    const root = $("rptRoot");
    if (!root) return;
    const d = hubData || {};
    const view = {
      resumo: renderResumo,
      vendas: renderVendas,
      jobs: renderJobs,
      dinheiro: renderDinheiro,
      folha: renderFolha,
      lucro: renderLucro,
      irss: () => renderIrss(irssData),
    }[activeTab] || renderResumo;
    root.innerHTML = `<div class="rx-view rx-view--${activeTab}">${view(d)}</div>`;
    if (activeTab === "irss") bindIrssTools();
    renderExportMenu();
  }

  async function setTab(tab) {
    tab = LEGACY_TABS[tab] || tab;
    if (!TABS.includes(tab)) tab = "resumo";
    activeTab = tab;
    syncTabsUi();
    try {
      history.replaceState(null, "", `#${activeTab}`);
    } catch (_) {}
    if (activeTab === "irss") {
      const status = $("rptStatus");
      if (status && !irssData) {
        status.hidden = false;
        status.textContent = "Carregando IRSS…";
      }
      try {
        await loadIrss(false);
      } catch (e) {
        window.crmToast?.error?.(e.message || "Erro no IRSS");
      }
      if (status) status.hidden = true;
    }
    renderActive();
    if (window.scrollY > 200) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function load() {
    const status = $("rptStatus");
    const err = $("rptError");
    const root = $("rptRoot");
    if (root) root.classList.add("is-loading");
    if (status && !hubData) {
      status.hidden = false;
      status.textContent = "Carregando relatórios…";
    }
    if (err) err.hidden = true;
    try {
      const { from, to } = periodState();
      const j = await api(`/api/reports/hub?${new URLSearchParams({ from, to })}`);
      hubData = j.data || {};
      irssData = null;
      syncTabsUi();
      syncPeriodUi();
      if (activeTab === "irss" && hubData.modules?.irss) await loadIrss(true);
      renderActive();
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e.message || "Erro ao carregar relatórios";
      }
      window.crmToast?.error?.(e.message || "Erro");
    } finally {
      if (status) status.hidden = true;
      if (root) root.classList.remove("is-loading");
    }
  }

  function closeRange() {
    const pop = $("rxRangePop");
    if (pop) pop.hidden = true;
    $("rxRangeBtn")?.setAttribute("aria-expanded", "false");
  }

  function bind() {
    setPreset("90");
    document.querySelectorAll("#rxPresets [data-preset]").forEach((b) => {
      b.addEventListener("click", () => {
        setPreset(b.getAttribute("data-preset"));
        closeRange();
        load();
      });
    });
    $("rxRangeBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = $("rxRangePop");
      if (!pop) return;
      pop.hidden = !pop.hidden;
      $("rxRangeBtn").setAttribute("aria-expanded", pop.hidden ? "false" : "true");
    });
    $("rxRangePop")?.addEventListener("click", (e) => e.stopPropagation());
    $("rptApply")?.addEventListener("click", () => {
      const { from, to } = periodState();
      if (!from || !to || from > to) {
        window.crmToast?.error?.("Confira as datas: o início precisa vir antes do fim.");
        return;
      }
      preset = "custom";
      syncPeriodUi();
      closeRange();
      load();
    });
    document.addEventListener("click", (e) => {
      closeRange();
      const ex = $("rxExport");
      if (ex && ex.open && !ex.contains(e.target)) ex.open = false;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeRange();
        const ex = $("rxExport");
        if (ex) ex.open = false;
      }
    });
    $("rptTabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      setTab(btn.getAttribute("data-tab"));
    });
    $("rptRoot")?.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (!go) return;
      e.preventDefault();
      setTab(go.getAttribute("data-go"));
    });
    $("logoutBtn")?.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch (_) {}
      location.href = "/login.html";
    });
    const hash = (location.hash || "").replace(/^#/, "");
    const mapped = LEGACY_TABS[hash] || hash;
    if (TABS.includes(mapped)) activeTab = mapped;
    syncTabsUi();
  }

  async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const role = String(s.user?.role || "").toLowerCase();
      const perms = s.user?.permissions || [];
      if (!(role === "admin" || perms.includes("reports.view"))) {
        $("rptError").hidden = false;
        $("rptError").textContent = "Sem permissão para ver relatórios.";
        return;
      }
      bind();
      await load();
    } catch (_) {
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
