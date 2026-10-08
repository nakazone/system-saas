/**
 * Relatórios hub — tabs + Resumo (cards) + IRSS módulo extra.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const charts = {};
  const TABS = ["resumo", "vendas", "jobs", "receber", "caixa", "folha", "lucro", "irss"];

  let hubData = null;
  let irssData = null;
  let activeTab = "resumo";
  let irssFilters = { sector: "", employee_id: "" };

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function ymd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function money(n) {
    return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  function num(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function periodState() {
    const from = $("rptFrom")?.value || "";
    const to = $("rptTo")?.value || "";
    return { from, to };
  }

  function setPreset(kind) {
    const to = new Date();
    const from = new Date();
    if (kind === "30") from.setDate(to.getDate() - 30);
    else if (kind === "month") from.setDate(1);
    else if (kind === "ytd") {
      from.setMonth(0, 1);
    } else if (kind === "lastyear") {
      const y = to.getFullYear() - 1;
      from.setFullYear(y, 0, 1);
      to.setFullYear(y, 11, 31);
    } else {
      from.setDate(to.getDate() - 90);
    }
    if ($("rptFrom")) $("rptFrom").value = ymd(from);
    if ($("rptTo")) $("rptTo").value = ymd(to);
    document.querySelectorAll(".rpt-preset").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-preset") === kind);
    });
  }

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

  function destroyCharts() {
    Object.keys(charts).forEach((k) => {
      try {
        charts[k].destroy();
      } catch (_) {}
      delete charts[k];
    });
  }

  function makeChart(canvasId, config) {
    if (!window.Chart || !$(canvasId)) return;
    if (charts[canvasId]) {
      try {
        charts[canvasId].destroy();
      } catch (_) {}
    }
    charts[canvasId] = new window.Chart($(canvasId), config);
  }

  function kpi(label, value, mod) {
    return `<div class="rpt-kpi${mod ? ` rpt-kpi--${mod}` : ""}"><p class="rpt-kpi__label">${esc(label)}</p><p class="rpt-kpi__value">${value}</p></div>`;
  }

  function secHead(title, actionsHtml) {
    return `<div class="rpt-sec__head"><h2 class="rpt-sec__title">${esc(title)}</h2><div class="rpt-sec__actions">${actionsHtml || ""}</div></div>`;
  }

  function exportBtn(kind, label, extra) {
    return `<a href="${esc(csvUrl(kind, extra))}" download>Exportar CSV${label ? ` · ${esc(label)}` : ""}</a>`;
  }

  function link(href, label) {
    return `<a href="${esc(href)}">${esc(label)}</a>`;
  }

  function table(headers, rows) {
    if (!rows.length) return '<p class="rpt-empty">Sem dados neste período.</p>';
    return `<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>${headers
      .map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.label)}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr>${r
            .map((c, i) => `<td class="${headers[i]?.num ? "num" : ""}">${c}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`;
  }

  const STATUS_PT = {
    draft: "Rascunho",
    scheduled: "Agendado",
    in_progress: "Em campo",
    completed: "Concluído",
    canceled: "Cancelado",
  };

  const METHOD_PT = {
    cash: "Cash",
    zelle: "Zelle",
    check: "Check",
    ach: "ACH",
    other: "Outro",
  };

  /** Resumo: only KPI cards (no charts / tables). */
  function renderExecutive(data) {
    const ex = data?.executive;
    const jobs = data?.jobs;
    const cf = data?.cashflow;
    const folha = data?.folha;
    if (!ex && !jobs && !cf && !folha) {
      return `<section class="rpt-sec">${secHead("Resumo", "")}<p class="rpt-empty">Sem dados neste período.</p></section>`;
    }
    const cards = [];
    if (ex) {
      cards.push(
        kpi("Leads no período", num(ex.leads_created)),
        kpi("Orçamentos ganhos", num(ex.quotes_won_count)),
        kpi("Receita ganha", money(ex.quotes_won_revenue)),
        kpi("A receber (aberto)", money(ex.receivables_open)),
        kpi("Atenção", num(ex.attention_count), Number(ex.attention_count) > 0 ? "warn" : null),
      );
    }
    if (jobs) {
      cards.push(
        kpi("Jobs ativos", num(jobs.active)),
        kpi("A faturar", num(jobs.to_invoice), Number(jobs.to_invoice) > 0 ? "warn" : null),
        kpi("Aguardando pagamento", num(jobs.awaiting_payment)),
        kpi("Concluídos no período", num(jobs.completed_in_period)),
      );
    }
    if (cf) {
      cards.push(
        kpi("Entradas", money(cf.inflow), "ok"),
        kpi("Saídas", money(cf.outflow)),
        kpi("Resultado", money(cf.net), Number(cf.net) >= 0 ? "ok" : "warn"),
        kpi("Folha paga", money(cf.payroll_paid)),
      );
    }
    if (folha?.totals) {
      cards.push(
        kpi("Funcionários (folha)", num(folha.employee_count || folha.totals.employees)),
        kpi("Folha líquida", money(folha.totals.net)),
        kpi("Folha paga (detalhe)", money(folha.totals.paid)),
      );
    }
    return `<section class="rpt-sec" id="panel-resumo">
      ${secHead("Resumo", `${exportBtn("executive")}${link("/dashboard", "Início")}`)}
      <div class="rpt-kpis">${cards.join("")}</div>
    </section>`;
  }

  function renderSales(sales) {
    if (!sales) return `<section class="rpt-sec"><p class="rpt-empty">Sem permissão ou dados de vendas.</p></section>`;
    const src = Array.isArray(sales.conversion_source) ? sales.conversion_source : [];
    const sp = Array.isArray(sales.conversion_salesperson) ? sales.conversion_salesperson : [];
    const loss = Array.isArray(sales.loss_reasons) ? sales.loss_reasons : [];
    return `<section class="rpt-sec" id="panel-vendas">
      ${secHead(
        "Vendas",
        `${exportBtn("conversion-source", "origem")}${exportBtn("conversion-salesperson", "vendedor")}${exportBtn("loss-reasons", "perdas")}${link("quotes.html", "Orçamentos")}`,
      )}
      <div class="rpt-grid-2">
        <div>
          <p class="rpt-muted">Conversão por origem</p>
          <div class="rpt-chart-wrap"><canvas id="chartSource"></canvas></div>
          ${table(
            [
              { label: "Origem" },
              { label: "Total", num: true },
              { label: "Ganhos", num: true },
              { label: "Perdidos", num: true },
              { label: "%", num: true },
            ],
            src.map((r) => [esc(r.source), num(r.total), num(r.won), num(r.lost), `${r.conversionRate}%`]),
          )}
        </div>
        <div>
          <p class="rpt-muted">Conversão por vendedor</p>
          <div class="rpt-chart-wrap"><canvas id="chartSales"></canvas></div>
          ${table(
            [
              { label: "Vendedor" },
              { label: "Orç.", num: true },
              { label: "Ganhos", num: true },
              { label: "Valor", num: true },
              { label: "%", num: true },
            ],
            sp.map((r) => [esc(r.name), num(r.quotes), num(r.won), money(r.wonValue), `${r.conversionRate}%`]),
          )}
        </div>
      </div>
      <p class="rpt-muted" style="margin-top:1rem">Motivos de perda</p>
      ${table(
        [
          { label: "Motivo" },
          { label: "Qtd", num: true },
        ],
        loss.map((r) => [esc(r.reason), num(r.count)]),
      )}
    </section>`;
  }

  function renderJobs(jobs) {
    if (!jobs) return `<section class="rpt-sec"><p class="rpt-empty">Sem permissão ou dados de jobs.</p></section>`;
    const statuses = Object.entries(jobs.by_status || {});
    return `<section class="rpt-sec" id="panel-jobs">
      ${secHead("Jobs / operação", `${exportBtn("jobs-ops")}${link("jobs.html", "Jobs")}${link("schedule.html", "Agenda")}`)}
      <div class="rpt-kpis">
        ${kpi("Ativos", num(jobs.active))}
        ${kpi("A faturar", num(jobs.to_invoice))}
        ${kpi("Aguardando pagamento", num(jobs.awaiting_payment))}
        ${kpi("Agendados no período", num(jobs.scheduled_in_period))}
        ${kpi("Concluídos no período", num(jobs.completed_in_period))}
      </div>
      <div class="rpt-chart-wrap" style="margin-top:1rem"><canvas id="chartJobs"></canvas></div>
      ${table(
        [
          { label: "Status" },
          { label: "Qtd", num: true },
        ],
        statuses.map(([k, v]) => [esc(STATUS_PT[k] || k), num(v)]),
      )}
    </section>`;
  }

  function renderReceivables(recv) {
    if (!recv || (!recv.ar_aging && !recv.projected_revenue)) {
      return `<section class="rpt-sec"><p class="rpt-empty">Sem permissão ou dados de recebíveis.</p></section>`;
    }
    const aging = recv.ar_aging;
    const proj = recv.projected_revenue;
    return `<section class="rpt-sec" id="panel-receber">
      ${secHead(
        "Recebíveis",
        `${exportBtn("ar-aging", "aging")}${exportBtn("projected-revenue", "projetada")}${link("invoices.html", "Faturas")}`,
      )}
      <div class="rpt-grid-2">
        <div>
          <p class="rpt-muted">Aging (aberto)</p>
          ${
            aging
              ? `<div class="rpt-kpis">${kpi("Total", money(aging.total))}${Object.entries(aging.buckets || {})
                  .map(([b, v]) => kpi(b + " dias", money(v)))
                  .join("")}</div><div class="rpt-chart-wrap"><canvas id="chartAging"></canvas></div>`
              : '<p class="rpt-empty">Sem permissão ou dados.</p>'
          }
        </div>
        <div>
          <p class="rpt-muted">Receita projetada por mês</p>
          ${
            proj
              ? `<p class="rpt-kpi__value" style="font-size:1.4rem">${money(proj.total)}</p>
                 <div class="rpt-chart-wrap"><canvas id="chartProjected"></canvas></div>`
              : '<p class="rpt-empty">Sem permissão ou dados.</p>'
          }
        </div>
      </div>
    </section>`;
  }

  function renderCashflow(cf) {
    if (!cf) return `<section class="rpt-sec"><p class="rpt-empty">Sem permissão ou dados de fluxo.</p></section>`;
    return `<section class="rpt-sec" id="panel-caixa">
      ${secHead("Fluxo de caixa", `${exportBtn("cashflow")}${link("finance.html", "Financeiro")}`)}
      <div class="rpt-kpis">
        ${kpi("Entradas", money(cf.inflow))}
        ${kpi("Saídas", money(cf.outflow))}
        ${kpi("Resultado", money(cf.net))}
        ${kpi("Custos", money(cf.costs))}
        ${kpi("Folha paga", money(cf.payroll_paid))}
        ${kpi("Folha pendente", money(cf.payroll_pending))}
        ${kpi("A receber", money(cf.receivables))}
      </div>
    </section>`;
  }

  function renderFolha(folha) {
    if (!folha) return `<section class="rpt-sec"><p class="rpt-empty">Sem permissão ou dados de folha.</p></section>`;
    return `<section class="rpt-sec" id="panel-folha">
      ${secHead("Folha", `${exportBtn("folha")}${link("folha.html", "Abrir Folha")}`)}
      <div class="rpt-kpis">
        ${kpi("Funcionários", num(folha.employee_count || folha.totals?.employees))}
        ${kpi("Ganho", money(folha.totals?.earned))}
        ${kpi("Líquido", money(folha.totals?.net))}
        ${kpi("Pago", money(folha.totals?.paid))}
        ${kpi("Custo em jobs", money(folha.jobs_cost_total))}
      </div>
      ${table(
        [
          { label: "Funcionário" },
          { label: "Setor" },
          { label: "Dias", num: true },
          { label: "Líquido", num: true },
          { label: "Pago", num: true },
        ],
        (folha.employees || []).map((e) => [esc(e.name), esc(e.sector), num(e.days), money(e.net), money(e.paid)]),
      )}
    </section>`;
  }

  function renderProfit(profit) {
    if (!profit) {
      return `<section class="rpt-sec" id="panel-lucro">
        ${secHead("Lucratividade", "")}
        <p class="rpt-empty">Disponível para quem tem permissão de preços (pricing.view).</p>
      </section>`;
    }
    const floors = Array.isArray(profit.byFlooringType) ? profit.byFlooringType : [];
    return `<section class="rpt-sec" id="panel-lucro">
      ${secHead("Lucratividade", `${exportBtn("profitability")}`)}
      <div class="rpt-chart-wrap"><canvas id="chartProfit"></canvas></div>
      ${table(
        [
          { label: "Tipo" },
          { label: "Projetos", num: true },
          { label: "Receita", num: true },
          { label: "Custo", num: true },
          { label: "Margem", num: true },
        ],
        floors.map((r) => [
          esc(r.flooringType),
          num(r.count),
          money(r.revenue),
          money(r.actual),
          money(r.margin),
        ]),
      )}
    </section>`;
  }

  function renderIrss(data) {
    if (!data) {
      return `<section class="rpt-sec"><p class="rpt-empty">A carregar IRSS…</p></section>`;
    }
    const s = data.summary || {};
    const opts = data.employee_options || [];
    const sectors = [...new Set(opts.map((e) => e.sector).filter(Boolean))].sort();
    const extra = {};
    if (irssFilters.sector) extra.sector = irssFilters.sector;
    if (irssFilters.employee_id) extra.employee_id = irssFilters.employee_id;

    return `<section class="rpt-sec" id="panel-irss">
      ${secHead(
        "IRSS — relatório avançado",
        `${exportBtn("irss", "funcionários", extra)}${link("folha.html", "Folha")}`,
      )}
      <p class="rpt-irss-note">Módulo extra: consolidado de ganhos e pagamentos da folha para conferência fiscal / 1099. Filtre por setor ou pessoa e exporte CSV.</p>
      <div class="rpt-irss-tools">
        <label>
          <span>Ano rápido</span>
          <select id="irssYearPreset">
            <option value="">Período atual</option>
            <option value="ytd">Ano corrente (YTD)</option>
            <option value="lastyear">Ano anterior</option>
          </select>
        </label>
        <label>
          <span>Setor</span>
          <select id="irssSector">
            <option value="">Todos</option>
            ${sectors.map((sec) => `<option value="${esc(sec)}"${irssFilters.sector === sec ? " selected" : ""}>${esc(sec)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Funcionário</span>
          <select id="irssEmployee">
            <option value="">Todos</option>
            ${opts
              .map(
                (e) =>
                  `<option value="${esc(e.id)}"${irssFilters.employee_id === e.id ? " selected" : ""}>${esc(e.name)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <button type="button" class="btn btn-primary" id="irssApply">Aplicar filtros</button>
      </div>
      <div class="rpt-kpis">
        ${kpi("Pessoas", num(s.employees))}
        ${kpi("Ganho", money(s.earned))}
        ${kpi("Líquido", money(s.net))}
        ${kpi("Pago", money(s.paid), "ok")}
        ${kpi("Em aberto", money(s.unpaid), Number(s.unpaid) > 0 ? "warn" : null)}
        ${kpi("Dias", num(s.days))}
        ${kpi("Horas extra", num(s.overtime_hours))}
        ${kpi("Custo em jobs", money(s.jobs_cost))}
      </div>
      <div class="rpt-grid-2" style="margin-top:1rem">
        <div>
          <p class="rpt-muted">Mensal (ganho × pago)</p>
          <div class="rpt-chart-wrap"><canvas id="chartIrssMonth"></canvas></div>
        </div>
        <div>
          <p class="rpt-muted">Por método de pagamento</p>
          <div class="rpt-chart-wrap"><canvas id="chartIrssMethod"></canvas></div>
          ${table(
            [
              { label: "Método" },
              { label: "Pagamentos", num: true },
              { label: "Total", num: true },
            ],
            (data.by_method || []).map((r) => [
              esc(METHOD_PT[r.method] || r.method),
              num(r.count),
              money(r.amount),
            ]),
          )}
        </div>
      </div>
      <p class="rpt-muted" style="margin-top:1rem">Por setor</p>
      ${table(
        [
          { label: "Setor" },
          { label: "Pessoas", num: true },
          { label: "Ganho", num: true },
          { label: "Pago", num: true },
          { label: "Em aberto", num: true },
        ],
        (data.by_sector || []).map((r) => [
          esc(r.sector),
          num(r.employees),
          money(r.earned),
          money(r.paid),
          money(r.unpaid),
        ]),
      )}
      <p class="rpt-muted" style="margin-top:1rem">Por funcionário</p>
      ${table(
        [
          { label: "Nome" },
          { label: "Setor" },
          { label: "Dias", num: true },
          { label: "Ganho", num: true },
          { label: "Líquido", num: true },
          { label: "Pago", num: true },
          { label: "Em aberto", num: true },
          { label: "Método" },
        ],
        (data.employees || []).map((e) => [
          esc(e.name),
          esc(e.sector),
          num(e.days),
          money(e.earned),
          money(e.net),
          money(e.paid),
          money(e.unpaid),
          esc(METHOD_PT[e.payment_method] || e.payment_method || "—"),
        ]),
      )}
      <p class="rpt-muted" style="margin-top:1rem">Pagamentos no período</p>
      ${table(
        [
          { label: "Data" },
          { label: "Nome" },
          { label: "Método" },
          { label: "Ref." },
          { label: "Valor", num: true },
        ],
        (data.payments || []).map((p) => [
          esc(p.paid_on),
          esc(p.name),
          esc(METHOD_PT[p.method] || p.method),
          esc(p.reference || "—"),
          money(p.amount),
        ]),
      )}
      <p class="rpt-muted" style="margin-top:1rem">Custo alocado em jobs</p>
      ${table(
        [
          { label: "Job" },
          { label: "Título" },
          { label: "Pessoas", num: true },
          { label: "Sqft", num: true },
          { label: "Custo", num: true },
        ],
        (data.jobs || []).map((j) => [
          esc(j.number != null ? `#${j.number}` : "—"),
          esc(j.title),
          num(j.people),
          num(j.sqft),
          money(j.cost),
        ]),
      )}
    </section>`;
  }

  function paintChartsForTab(tab, data) {
    if (tab === "vendas") {
      const src = data.sales?.conversion_source || [];
      if (src.length) {
        makeChart("chartSource", {
          type: "doughnut",
          data: {
            labels: src.map((r) => r.source),
            datasets: [
              {
                data: src.map((r) => r.total),
                backgroundColor: ["#e8792c", "#1c1917", "#a8a29e", "#fbbf24", "#3b82f6", "#10b981", "#ef4444"],
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
        });
      }
      const sp = data.sales?.conversion_salesperson || [];
      if (sp.length) {
        makeChart("chartSales", {
          type: "bar",
          data: {
            labels: sp.map((r) => r.name),
            datasets: [
              { label: "Orçamentos", data: sp.map((r) => r.quotes), backgroundColor: "#a8a29e" },
              { label: "Ganhos", data: sp.map((r) => r.won), backgroundColor: "#e8792c" },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: { legend: { position: "bottom" } },
          },
        });
      }
    }
    if (tab === "jobs") {
      const jobs = data.jobs?.by_status || {};
      const jobEntries = Object.entries(jobs).filter(([, v]) => v > 0);
      if (jobEntries.length) {
        makeChart("chartJobs", {
          type: "bar",
          data: {
            labels: jobEntries.map(([k]) => STATUS_PT[k] || k),
            datasets: [{ label: "Jobs", data: jobEntries.map(([, v]) => v), backgroundColor: "#e8792c" }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: { legend: { display: false } },
          },
        });
      }
    }
    if (tab === "receber") {
      const aging = data.receivables?.ar_aging?.buckets;
      if (aging) {
        makeChart("chartAging", {
          type: "bar",
          data: {
            labels: Object.keys(aging),
            datasets: [{ label: "USD", data: Object.values(aging), backgroundColor: "#1c1917" }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } },
          },
        });
      }
      const proj = data.receivables?.projected_revenue?.byMonth || [];
      if (proj.length) {
        makeChart("chartProjected", {
          type: "line",
          data: {
            labels: proj.map((r) => r.month),
            datasets: [
              {
                label: "Projetado",
                data: proj.map((r) => r.amount),
                borderColor: "#e8792c",
                backgroundColor: "rgba(232,121,44,0.15)",
                fill: true,
                tension: 0.3,
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
      }
    }
    if (tab === "lucro") {
      const floors = data.profitability?.byFlooringType || [];
      if (floors.length) {
        makeChart("chartProfit", {
          type: "bar",
          data: {
            labels: floors.map((r) => r.flooringType),
            datasets: [
              { label: "Receita", data: floors.map((r) => r.revenue), backgroundColor: "#e8792c" },
              { label: "Custo", data: floors.map((r) => r.actual), backgroundColor: "#a8a29e" },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { position: "bottom" } },
          },
        });
      }
    }
    if (tab === "irss" && irssData) {
      const months = irssData.by_month || [];
      if (months.length) {
        makeChart("chartIrssMonth", {
          type: "bar",
          data: {
            labels: months.map((m) => m.month),
            datasets: [
              { label: "Ganho", data: months.map((m) => m.earned), backgroundColor: "#a8a29e" },
              { label: "Pago", data: months.map((m) => m.paid), backgroundColor: "#e8792c" },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { position: "bottom" } },
          },
        });
      }
      const methods = irssData.by_method || [];
      if (methods.length) {
        makeChart("chartIrssMethod", {
          type: "doughnut",
          data: {
            labels: methods.map((m) => METHOD_PT[m.method] || m.method),
            datasets: [
              {
                data: methods.map((m) => m.amount),
                backgroundColor: ["#e8792c", "#1c1917", "#a8a29e", "#3b82f6", "#10b981"],
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
        });
      }
    }
  }

  function syncTabsUi() {
    document.querySelectorAll("#rptTabs .rpt-tab").forEach((btn) => {
      const id = btn.getAttribute("data-tab");
      const on = id === activeTab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const irssBtn = document.querySelector('#rptTabs [data-tab="irss"]');
    if (irssBtn) {
      const show = Boolean(hubData?.modules?.irss);
      irssBtn.hidden = !show;
      if (!show && activeTab === "irss") activeTab = "resumo";
    }
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
    destroyCharts();
    const root = $("rptRoot");
    if (!root) return;
    const data = hubData || {};
    let html = "";
    switch (activeTab) {
      case "resumo":
        html = renderExecutive(data);
        break;
      case "vendas":
        html = renderSales(data.sales);
        break;
      case "jobs":
        html = renderJobs(data.jobs);
        break;
      case "receber":
        html = renderReceivables(data.receivables);
        break;
      case "caixa":
        html = renderCashflow(data.cashflow);
        break;
      case "folha":
        html = renderFolha(data.folha);
        break;
      case "lucro":
        html = renderProfit(data.profitability);
        break;
      case "irss":
        html = renderIrss(irssData);
        break;
      default:
        html = renderExecutive(data);
    }
    root.innerHTML = html;
    if (activeTab === "irss") bindIrssTools();
    requestAnimationFrame(() => paintChartsForTab(activeTab, data));
  }

  async function setTab(tab) {
    if (!TABS.includes(tab)) tab = "resumo";
    activeTab = tab;
    syncTabsUi();
    try {
      history.replaceState(null, "", `#${tab}`);
    } catch (_) {}
    if (tab === "irss") {
      const status = $("rptStatus");
      if (status && !irssData) {
        status.hidden = false;
        status.textContent = "A carregar IRSS…";
      }
      try {
        await loadIrss(false);
      } catch (e) {
        window.crmToast?.error?.(e.message || "Erro IRSS");
      }
      if (status) status.hidden = true;
    }
    renderActive();
  }

  async function load() {
    const status = $("rptStatus");
    const err = $("rptError");
    if (status) {
      status.hidden = false;
      status.textContent = "A carregar relatórios…";
    }
    if (err) err.hidden = true;
    try {
      const { from, to } = periodState();
      const q = new URLSearchParams({ from, to });
      const j = await api(`/api/reports/hub?${q}`);
      hubData = j.data || {};
      irssData = null;
      syncTabsUi();
      if (activeTab === "irss" && hubData.modules?.irss) await loadIrss(true);
      renderActive();
      if (status) status.hidden = true;
    } catch (e) {
      if (status) status.hidden = true;
      if (err) {
        err.hidden = false;
        err.textContent = e.message || "Erro ao carregar relatórios";
      }
      window.crmToast?.error?.(e.message || "Erro");
    }
  }

  function bind() {
    setPreset("90");
    document.querySelectorAll(".rpt-preset").forEach((b) => {
      b.addEventListener("click", () => {
        setPreset(b.getAttribute("data-preset"));
        load();
      });
    });
    $("rptApply")?.addEventListener("click", () => load());
    $("rptTabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn || btn.hidden) return;
      setTab(btn.getAttribute("data-tab"));
    });
    $("logoutBtn")?.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch (_) {}
      location.href = "/login.html";
    });
    const hash = (location.hash || "").replace(/^#/, "");
    if (TABS.includes(hash)) activeTab = hash;
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
      const ok = role === "admin" || perms.includes("reports.view");
      if (!ok) {
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
