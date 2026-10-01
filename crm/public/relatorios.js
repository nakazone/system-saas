/**
 * Relatórios hub — loads /api/reports/hub and renders all sections.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const charts = {};

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
    else if (kind === "month") {
      from.setDate(1);
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

  function csvUrl(kind) {
    const { from, to } = periodState();
    const q = new URLSearchParams({ format: "csv", from, to });
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

  function kpi(label, value) {
    return `<div class="rpt-kpi"><p class="rpt-kpi__label">${esc(label)}</p><p class="rpt-kpi__value">${value}</p></div>`;
  }

  function secHead(title, actionsHtml) {
    return `<div class="rpt-sec__head"><h2 class="rpt-sec__title">${esc(title)}</h2><div class="rpt-sec__actions">${actionsHtml || ""}</div></div>`;
  }

  function exportBtn(kind, label) {
    return `<a href="${esc(csvUrl(kind))}" download>Exportar CSV${label ? ` · ${esc(label)}` : ""}</a>`;
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

  function renderExecutive(ex) {
    if (!ex) return "";
    return `<section class="rpt-sec" id="sec-resumo">
      ${secHead("Resumo executivo", `${exportBtn("executive")}${link("pipeline-lab.html", "Início")}${link("leads.html", "Leads")}`)}
      <div class="rpt-kpis">
        ${kpi("Leads no período", num(ex.leads_created))}
        ${kpi("Orçamentos ganhos", num(ex.quotes_won_count))}
        ${kpi("Receita ganha", money(ex.quotes_won_revenue))}
        ${kpi("A receber (aberto)", money(ex.receivables_open))}
        ${kpi("Atenção", num(ex.attention_count))}
      </div>
    </section>`;
  }

  function renderSales(sales) {
    if (!sales) return "";
    const src = Array.isArray(sales.conversion_source) ? sales.conversion_source : [];
    const sp = Array.isArray(sales.conversion_salesperson) ? sales.conversion_salesperson : [];
    const loss = Array.isArray(sales.loss_reasons) ? sales.loss_reasons : [];
    return `<section class="rpt-sec" id="sec-vendas">
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
    if (!jobs) return "";
    const statuses = Object.entries(jobs.by_status || {});
    return `<section class="rpt-sec" id="sec-jobs">
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
    if (!recv || (!recv.ar_aging && !recv.projected_revenue)) return "";
    const aging = recv.ar_aging;
    const proj = recv.projected_revenue;
    return `<section class="rpt-sec" id="sec-receber">
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
    if (!cf) return "";
    return `<section class="rpt-sec" id="sec-caixa">
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
    if (!folha) return "";
    return `<section class="rpt-sec" id="sec-folha">
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
      return `<section class="rpt-sec" id="sec-lucro">
        ${secHead("Lucratividade", "")}
        <p class="rpt-empty">Disponível para quem tem permissão de preços (pricing.view).</p>
      </section>`;
    }
    const floors = Array.isArray(profit.byFlooringType) ? profit.byFlooringType : [];
    return `<section class="rpt-sec" id="sec-lucro">
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

  function paintCharts(data) {
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

  function render(data) {
    destroyCharts();
    const root = $("rptRoot");
    if (!root) return;
    root.innerHTML =
      renderExecutive(data.executive) +
      renderSales(data.sales) +
      renderJobs(data.jobs) +
      renderReceivables(data.receivables) +
      renderCashflow(data.cashflow) +
      renderFolha(data.folha) +
      renderProfit(data.profitability);
    requestAnimationFrame(() => paintCharts(data));
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
      render(j.data || {});
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
    $("logoutBtn")?.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch (_) {}
      location.href = "/login.html";
    });
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
