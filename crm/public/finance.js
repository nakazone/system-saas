/**
 * Financeiro — cash flow, receivables, payroll abatement, costs + scan.
 */
(function () {
  const money = (n) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);

  const moneyShort = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Math.abs(Number(n) || 0) >= 100 ? 0 : 2,
    }).format(Number(n) || 0);

  const MONTHS_PT = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  let cache = { summary: null, lines: [], receivables: [], costs: [], weeks: [], selectedWeek: 0 };
  let mobTab = "geral";

  function toast(msg, type) {
    if (typeof window.crmToastSafe === "function") window.crmToastSafe(msg, { type: type || "info" });
    else if (window.CrmToast && typeof window.CrmToast.show === "function") window.CrmToast.show(msg, type || "info");
  }

  function monthBounds() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const last = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return { from, to };
  }

  function qs() {
    const from = document.getElementById("finFrom")?.value;
    const to = document.getElementById("finTo")?.value;
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  async function api(path, opts) {
    const r = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
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

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler ficheiro"));
      reader.readAsDataURL(file);
    });
  }

  function buildWeeks(fromStr, toStr, lines) {
    const from = new Date(fromStr + "T12:00:00");
    const to = new Date(toStr + "T12:00:00");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
    const lastDay = to.getDate();
    const ranges = [
      { start: 1, end: Math.min(7, lastDay) },
      { start: 8, end: Math.min(14, lastDay) },
      { start: 15, end: Math.min(21, lastDay) },
      { start: 22, end: lastDay },
    ].filter((r) => r.start <= lastDay);
    const y = from.getFullYear();
    const m = from.getMonth();
    const mon = MONTHS_SHORT[m];
    return ranges.map((r) => {
      const startKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(r.start).padStart(2, "0")}`;
      const endKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(r.end).padStart(2, "0")}`;
      let inflow = 0;
      let outflow = 0;
      lines.forEach((l) => {
        const d = String(l.date || "").slice(0, 10);
        if (d < startKey || d > endKey) return;
        if (l.direction === "in") inflow += Number(l.amount) || 0;
        else outflow += Number(l.amount) || 0;
      });
      return {
        label: `${r.start}–${r.end} ${mon}`,
        inflow,
        outflow,
        net: inflow - outflow,
      };
    });
  }

  async function loadSummary() {
    const j = await api(`/api/finance/summary${qs()}`);
    const d = j.data || {};
    cache.summary = d;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = money(v);
    };
    set("ovInflow", d.inflow);
    set("ovOutflow", d.outflow);
    set("ovNet", d.net);
    set("ovReceivables", d.receivables);
  }

  async function loadCashflow() {
    const body = document.getElementById("cashflowBody");
    const count = document.getElementById("cashflowCount");
    try {
      const j = await api(`/api/finance/cashflow${qs()}`);
      const lines = (j.data && j.data.lines) || [];
      cache.lines = lines;
      const from = document.getElementById("finFrom")?.value || monthBounds().from;
      const to = document.getElementById("finTo")?.value || monthBounds().to;
      cache.weeks = buildWeeks(from, to, lines);
      if (cache.selectedWeek >= cache.weeks.length) {
        cache.selectedWeek = Math.max(0, cache.weeks.length - 1);
      }
      if (count) count.textContent = `(${lines.length})`;
      if (!body) return;
      if (!lines.length) {
        body.innerHTML = '<tr><td colspan="4" class="fin-empty">Sem movimentos neste período.</td></tr>';
        return;
      }
      body.innerHTML = lines
        .map((l) => {
          const cls = l.direction === "in" ? "dir-in" : "dir-out";
          const sign = l.direction === "in" ? "+" : "−";
          const kind =
            l.kind === "invoice_receipt"
              ? "Recebimento"
              : l.kind === "payroll"
                ? "Folha"
                : "Custo";
          return `<tr>
            <td>${escapeHtml(l.date)}</td>
            <td>${escapeHtml(kind)}</td>
            <td>${escapeHtml(l.label)}</td>
            <td class="num ${cls}">${sign}${money(l.amount)}</td>
          </tr>`;
        })
        .join("");
    } catch (e) {
      cache.lines = [];
      cache.weeks = [];
      if (body) body.innerHTML = `<tr><td colspan="4" class="fin-empty">${escapeHtml(e.message || "Erro")}</td></tr>`;
    }
  }

  async function loadReceivables() {
    const body = document.getElementById("recvBody");
    const count = document.getElementById("recvCount");
    try {
      const j = await api("/api/finance/receivables");
      const rows = j.data || [];
      cache.receivables = rows;
      if (count) count.textContent = `(${rows.length})`;
      if (!body) return;
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="fin-empty">Nenhum invoice em aberto.</td></tr>';
        return;
      }
      body.innerHTML = rows
        .map((r) => {
          const dueCls = r.overdue ? "is-overdue" : "";
          return `<tr>
            <td>${escapeHtml(r.invoice_number || r.id.slice(0, 8))}</td>
            <td>${escapeHtml(r.customer_name)}</td>
            <td class="${dueCls}">${escapeHtml(r.due_date || "—")}${r.overdue ? " · overdue" : ""}</td>
            <td class="num">${money(r.amount)}</td>
            <td class="num">${money(r.paid)}</td>
            <td class="num">${money(r.balance)}</td>
          </tr>`;
        })
        .join("");
    } catch (e) {
      cache.receivables = [];
      if (body) body.innerHTML = `<tr><td colspan="6" class="fin-empty">${escapeHtml(e.message || "Erro")}</td></tr>`;
    }
  }

  async function loadPayroll() {
    const body = document.getElementById("payrollBody");
    try {
      const j = await api("/api/finance/payroll");
      const periods = (j.data && j.data.periods) || [];
      if (!periods.length) {
        body.innerHTML = '<tr><td colspan="5" class="fin-empty">Sem períodos de folha. Crie em Folha de Pagamento.</td></tr>';
        return;
      }
      body.innerHTML = periods
        .map((p) => {
          const ab = p.abatement;
          const abHtml = ab
            ? `<span class="fin-badge is-paid">${money(ab.amount)} · ${escapeHtml(ab.paid_on)}</span>`
            : '<span class="fin-badge is-pending">Pendente</span>';
          const btn = ab
            ? ""
            : `<button type="button" class="btn btn-sm btn-primary" data-abate="${escapeHtml(p.id)}" data-label="${escapeHtml(p.label)}" data-amount="${p.estimated_cost}">Abater</button>`;
          return `<tr>
            <td>${escapeHtml(p.label)}<div class="fin-hint" style="margin:0">${escapeHtml(p.start_date)} → ${escapeHtml(p.end_date)}</div></td>
            <td>${escapeHtml(p.status)}</td>
            <td class="num">${money(p.estimated_cost)}</td>
            <td>${abHtml}</td>
            <td>${btn}</td>
          </tr>`;
        })
        .join("");
    } catch (e) {
      body.innerHTML = `<tr><td colspan="5" class="fin-empty">${escapeHtml(e.message || "Erro")}</td></tr>`;
    }
  }

  async function loadCosts() {
    const body = document.getElementById("costsBody");
    const count = document.getElementById("costsCount");
    try {
      const j = await api(`/api/finance/costs${qs()}${qs() ? "&" : "?"}status=all`);
      const rows = j.data || [];
      cache.costs = rows;
      if (count) count.textContent = `(${rows.length})`;
      if (!body) return;
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="fin-empty">Sem custos neste período.</td></tr>';
        return;
      }
      body.innerHTML = rows
        .map((c) => {
          const src = c.source === "scan" ? '<span class="fin-badge is-scan">Scan</span>' : "Manual";
          const st =
            c.status === "draft"
              ? '<span class="fin-badge is-draft">Rascunho</span>'
              : c.status === "void"
                ? '<span class="fin-badge">Anulado</span>'
                : '<span class="fin-badge is-posted">Lançado</span>';
          const desc = c.receipt_url
            ? `${escapeHtml(c.description)} <a href="${escapeHtml(c.receipt_url)}" target="_blank" rel="noopener">ver</a>`
            : escapeHtml(c.description);
          const action =
            c.status === "draft"
              ? ` <button type="button" class="btn btn-sm btn-primary" data-post-cost="${escapeHtml(c.id)}" data-amount="${c.amount}">Lançar</button>`
              : "";
          return `<tr>
            <td>${escapeHtml(c.incurred_on)}</td>
            <td>${desc}${action}</td>
            <td>${escapeHtml(c.vendor_name || "—")}</td>
            <td>${src}</td>
            <td class="num">${money(c.amount)}</td>
            <td>${st}</td>
          </tr>`;
        })
        .join("");
    } catch (e) {
      cache.costs = [];
      if (body) body.innerHTML = `<tr><td colspan="6" class="fin-empty">${escapeHtml(e.message || "Erro")}</td></tr>`;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setMobTab(name) {
    mobTab = name || "geral";
    document.querySelectorAll("[data-fin-mob-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-fin-mob-tab") === mobTab);
    });
    document.querySelectorAll("[data-fin-mob-pane]").forEach((pane) => {
      pane.hidden = pane.getAttribute("data-fin-mob-pane") !== mobTab;
    });
  }

  function renderMobChart() {
    const host = document.getElementById("finMobChart");
    const sum = document.getElementById("finMobWeekSum");
    if (!host) return;
    const weeks = cache.weeks || [];
    if (!weeks.length) {
      host.innerHTML = "";
      if (sum) sum.innerHTML = `<p class="fpm-empty" style="margin:0">Sem dados semanais.</p>`;
      return;
    }
    const max = Math.max(1, ...weeks.map((w) => Math.max(w.inflow, w.outflow)));
    host.innerHTML = weeks
      .map((w, i) => {
        const inH = Math.max(4, Math.round((w.inflow / max) * 92));
        const outH = Math.max(4, Math.round((w.outflow / max) * 92));
        return `<button type="button" class="fpm-chart__col${i === cache.selectedWeek ? " is-selected" : ""}" data-fin-week="${i}">
          <span class="fpm-chart__bars">
            <span class="fpm-chart__bar fpm-chart__bar--in" style="height:${inH}px"></span>
            <span class="fpm-chart__bar fpm-chart__bar--out" style="height:${outH}px"></span>
          </span>
          <span class="fpm-chart__label">${escapeHtml(w.label)}</span>
        </button>`;
      })
      .join("");
    host.querySelectorAll("[data-fin-week]").forEach((btn) => {
      btn.addEventListener("click", () => {
        cache.selectedWeek = Number(btn.getAttribute("data-fin-week")) || 0;
        renderMobChart();
      });
    });
    const w = weeks[cache.selectedWeek] || weeks[0];
    if (sum && w) {
      sum.innerHTML = `
        <p class="fpm-week-sum__title">Semana ${escapeHtml(w.label)}</p>
        <div class="fpm-week-sum__row">
          <span>Entradas ${moneyShort(w.inflow)}</span>
          <span>Saídas ${moneyShort(w.outflow)}</span>
          <span class="fpm-week-sum__net">${w.net >= 0 ? "" : "−"}${moneyShort(Math.abs(w.net))}</span>
        </div>`;
    }
  }

  function renderMobile() {
    if (!document.getElementById("finMobile")) return;
    const from = document.getElementById("finFrom")?.value || monthBounds().from;
    const d = new Date(from + "T12:00:00");
    const monthEl = document.getElementById("finMobMonth");
    if (monthEl && !Number.isNaN(d.getTime())) {
      monthEl.textContent = `${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`;
    }

    const s = cache.summary || {};
    const net = Number(s.net) || 0;
    const inflow = Number(s.inflow) || 0;
    const outflow = Number(s.outflow) || 0;
    const netEl = document.getElementById("finMobNet");
    if (netEl) netEl.textContent = `${net >= 0 ? "+" : "−"}${moneyShort(Math.abs(net))}`;
    const margin = inflow > 0 ? Math.round((net / inflow) * 100) : 0;
    const today = new Date();
    const meta = document.getElementById("finMobNetMeta");
    if (meta) {
      meta.textContent = `Margem de caixa ${margin}% · até ${today.getDate()} ${MONTHS_SHORT[today.getMonth()]}`;
    }
    const inEl = document.getElementById("finMobIn");
    if (inEl) inEl.textContent = moneyShort(inflow);
    const outEl = document.getElementById("finMobOut");
    if (outEl) outEl.textContent = moneyShort(outflow);

    renderMobChart();

    const overdue = (cache.receivables || []).filter((r) => r.overdue);
    const overdueSum = overdue.reduce((a, r) => a + (Number(r.balance) || 0), 0);
    const od = document.getElementById("finMobOverdue");
    if (od) od.textContent = moneyShort(overdueSum);
    const ods = document.getElementById("finMobOverdueSub");
    if (ods) {
      ods.textContent = `${overdue.length} fatura${overdue.length === 1 ? "" : "s"} vencida${overdue.length === 1 ? "" : "s"}`;
    }
    const recvDot = document.getElementById("finMobRecvDot");
    if (recvDot) recvDot.hidden = overdue.length === 0;

    const drafts = (cache.costs || []).filter((c) => c.status === "draft");
    const draftSum = drafts.reduce((a, c) => a + (Number(c.amount) || 0), 0);
    const dr = document.getElementById("finMobDraft");
    if (dr) dr.textContent = String(drafts.length);
    const drs = document.getElementById("finMobDraftSub");
    if (drs) drs.textContent = `${moneyShort(draftSum)} em recibos`;
    const costDot = document.getElementById("finMobCostDot");
    if (costDot) costDot.hidden = drafts.length === 0;

    const moves = document.getElementById("finMobMoves");
    if (moves) {
      const recent = (cache.lines || [])
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 8);
      if (!recent.length) {
        moves.innerHTML = `<p class="fpm-empty">Sem movimentações neste mês.</p>`;
      } else {
        moves.innerHTML = recent
          .map((l) => {
            const isIn = l.direction === "in";
            const kind =
              l.kind === "invoice_receipt" ? "Recebimento" : l.kind === "payroll" ? "Folha" : "Custo";
            return `<div class="fpm-mov__item">
              <span class="fpm-mov__ico ${isIn ? "fpm-mov__ico--in" : "fpm-mov__ico--out"}" aria-hidden="true">
                <svg viewBox="0 0 24 24">${isIn ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>' : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'}</svg>
              </span>
              <span>
                <p class="fpm-mov__title">${escapeHtml(l.label || kind)}</p>
                <p class="fpm-mov__sub">${escapeHtml(kind)} · ${escapeHtml(l.date || "")}</p>
              </span>
              <span class="fpm-mov__amt ${isIn ? "is-in" : "is-out"}">${isIn ? "+" : "−"}${moneyShort(l.amount)}</span>
            </div>`;
          })
          .join("");
      }
    }

    const recvList = document.getElementById("finMobRecvList");
    if (recvList) {
      const rows = cache.receivables || [];
      recvList.innerHTML = !rows.length
        ? `<p class="fpm-empty">Nenhum invoice em aberto.</p>`
        : rows
            .map(
              (r) => `<div class="fpm-list__row">
            <div class="fpm-list__row-top">
              <p class="fpm-list__name">${escapeHtml(r.customer_name || r.invoice_number || "Invoice")}</p>
              <p class="fpm-list__amt">${moneyShort(r.balance)}</p>
            </div>
            <p class="fpm-list__meta">${escapeHtml(r.invoice_number || "")} · venc. ${escapeHtml(r.due_date || "—")}${r.overdue ? " · vencido" : ""}</p>
          </div>`,
            )
            .join("");
    }

    const costList = document.getElementById("finMobCostList");
    if (costList) {
      const rows = cache.costs || [];
      costList.innerHTML = !rows.length
        ? `<p class="fpm-empty">Sem despesas neste período.</p>`
        : rows
            .map((c) => {
              const action =
                c.status === "draft"
                  ? ` · <button type="button" class="btn btn-sm btn-primary" data-post-cost="${escapeHtml(c.id)}" data-amount="${Number(c.amount) || 0}">Lançar</button>`
                  : ` · ${escapeHtml(c.status || "")}`;
              return `<div class="fpm-list__row">
              <div class="fpm-list__row-top">
                <p class="fpm-list__name">${escapeHtml(c.description || "Custo")}</p>
                <p class="fpm-list__amt">${moneyShort(c.amount)}</p>
              </div>
              <p class="fpm-list__meta">${escapeHtml(c.vendor_name || "—")} · ${escapeHtml(c.incurred_on || "")}${action}</p>
            </div>`;
            })
            .join("");
    }

    const jobsList = document.getElementById("finMobJobsList");
    if (jobsList) {
      jobsList.innerHTML = `<p class="fpm-empty">Custos por obra em breve. <a href="jobs.html">Ver Jobs</a></p>`;
    }
  }

  async function refreshAll() {
    await Promise.all([loadSummary(), loadCashflow(), loadReceivables(), loadPayroll(), loadCosts()]);
    renderMobile();
  }

  function switchTab(name) {
    document.querySelectorAll(".fin-tab").forEach((btn) => {
      const on = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".fin-pane").forEach((pane) => {
      const on = pane.getAttribute("data-pane") === name;
      pane.classList.toggle("is-active", on);
      pane.hidden = !on;
    });
  }

  function bind() {
    const bounds = monthBounds();
    const fromEl = document.getElementById("finFrom");
    const toEl = document.getElementById("finTo");
    if (fromEl && !fromEl.value) fromEl.value = bounds.from;
    if (toEl && !toEl.value) toEl.value = bounds.to;

    document.getElementById("btnFinApply")?.addEventListener("click", () => {
      refreshAll().catch((e) => toast(e.message, "error"));
    });

    document.querySelectorAll(".fin-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });

    document.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => closeModal(el.getAttribute("data-close")));
    });

    document.getElementById("btnFinAddCost")?.addEventListener("click", () => {
      const form = document.getElementById("costForm");
      form?.reset();
      const date = form?.querySelector('[name="incurred_on"]');
      if (date) date.value = new Date().toISOString().slice(0, 10);
      openModal("costModal");
    });

    document.getElementById("btnFinScan")?.addEventListener("click", () => {
      const form = document.getElementById("scanForm");
      form?.reset();
      const preview = document.getElementById("scanPreview");
      if (preview) {
        preview.hidden = true;
        preview.innerHTML = "";
      }
      const date = form?.querySelector('[name="incurred_on"]');
      if (date) date.value = new Date().toISOString().slice(0, 10);
      openModal("scanModal");
    });

    function openFinCreate() {
      const sheet = document.getElementById("finMobCreateSheet");
      const backdrop = document.getElementById("finMobCreateBackdrop");
      if (sheet) sheet.hidden = false;
      if (backdrop) backdrop.hidden = false;
    }
    function closeFinCreate() {
      const sheet = document.getElementById("finMobCreateSheet");
      const backdrop = document.getElementById("finMobCreateBackdrop");
      if (sheet) sheet.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }
    document.getElementById("finMobAdd")?.addEventListener("click", openFinCreate);
    document.getElementById("finMobCreateBackdrop")?.addEventListener("click", closeFinCreate);
    document.getElementById("finMobScanBtn")?.addEventListener("click", () => {
      closeFinCreate();
      document.getElementById("btnFinScan")?.click();
    });
    document.getElementById("finMobCostBtn")?.addEventListener("click", () => {
      closeFinCreate();
      document.getElementById("btnFinAddCost")?.click();
    });
    document.querySelectorAll("[data-fin-mob-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setMobTab(btn.getAttribute("data-fin-mob-tab")));
    });
    document.querySelectorAll("[data-fin-mob-tab-jump]").forEach((btn) => {
      btn.addEventListener("click", () => setMobTab(btn.getAttribute("data-fin-mob-tab-jump")));
    });

    document.getElementById("scanForm")?.querySelector('[name="receipt_file"]')?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      const preview = document.getElementById("scanPreview");
      if (!file || !preview) return;
      if (!file.type.startsWith("image/")) {
        preview.hidden = true;
        return;
      }
      const url = await fileToDataUrl(file);
      preview.innerHTML = `<img src="${url}" alt="Pré-visualização do recibo" />`;
      preview.hidden = false;
    });

    document.getElementById("costForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const payload = {
        description: fd.get("description"),
        vendor_name: fd.get("vendor_name") || null,
        amount: Number(fd.get("amount")),
        incurred_on: fd.get("incurred_on"),
        category: fd.get("category"),
        notes: fd.get("notes") || null,
      };
      const file = form.querySelector('[name="receipt_file"]')?.files?.[0];
      try {
        if (file) payload.receipt_data_url = await fileToDataUrl(file);
        await api("/api/finance/costs", { method: "POST", body: JSON.stringify(payload) });
        closeModal("costModal");
        toast("Custo guardado", "success");
        await refreshAll();
        switchTab("costs");
      } catch (err) {
        toast(err.message || "Erro ao guardar", "error");
      }
    });

    document.getElementById("scanForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const file = form.querySelector('[name="receipt_file"]')?.files?.[0];
      const submitBtn = document.getElementById("scanSubmitBtn");
      if (!file) {
        toast("Selecione uma foto do recibo", "error");
        return;
      }
      if (!file.type.startsWith("image/")) {
        toast("Use uma foto (JPG/PNG). PDF ainda não tem OCR automático.", "error");
        return;
      }
      const prevLabel = submitBtn?.textContent;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "A ler recibo…";
      }
      try {
        const payload = {
          receipt_data_url: await fileToDataUrl(file),
          vendor_name: fd.get("vendor_name") || null,
          incurred_on: fd.get("incurred_on") || null,
        };
        const amount = fd.get("amount");
        if (amount) payload.amount = Number(amount);
        if (fd.get("force_draft")) payload.post = false;
        const j = await api("/api/finance/costs/scan", { method: "POST", body: JSON.stringify(payload) });
        closeModal("scanModal");
        const d = j.data || {};
        const ocr = d.ocr || {};
        let detail = j.message || "Scan enviado";
        if (ocr.status === "extracted" && ocr.amount != null) {
          detail += ` · ${money(ocr.amount)}`;
          if (ocr.vendor_name) detail += ` · ${ocr.vendor_name}`;
        }
        toast(detail, d.auto_posted ? "success" : "info");
        await refreshAll();
        switchTab(d.auto_posted ? "cashflow" : "costs");
      } catch (err) {
        toast(err.message || "Erro no scan", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = prevLabel || "Ler e lançar";
        }
      }
    });

    document.getElementById("payrollBody")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-abate]");
      if (!btn) return;
      const form = document.getElementById("abatementForm");
      if (!form) return;
      form.reset();
      form.querySelector('[name="period_id"]').value = btn.getAttribute("data-abate");
      form.querySelector('[name="label"]').value = btn.getAttribute("data-label") || "";
      form.querySelector('[name="amount"]').value = btn.getAttribute("data-amount") || "";
      form.querySelector('[name="paid_on"]').value = new Date().toISOString().slice(0, 10);
      openModal("abatementModal");
    });

    document.getElementById("abatementForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      try {
        await api("/api/finance/payroll/abatements", {
          method: "POST",
          body: JSON.stringify({
            period_id: fd.get("period_id") || null,
            label: fd.get("label"),
            amount: Number(fd.get("amount")),
            paid_on: fd.get("paid_on"),
            method: fd.get("method"),
            notes: fd.get("notes") || null,
            status: "paid",
          }),
        });
        closeModal("abatementModal");
        toast("Abatimento registado", "success");
        await refreshAll();
      } catch (err) {
        toast(err.message || "Erro", "error");
      }
    });

    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-post-cost]");
      if (!btn) return;
      const id = btn.getAttribute("data-post-cost");
      let amount = Number(btn.getAttribute("data-amount"));
      const typed = window.prompt("Confirme o valor a lançar ($)", String(amount || ""));
      if (typed == null) return;
      amount = Number(typed);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast("Valor inválido", "error");
        return;
      }
      try {
        await api(`/api/finance/costs/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ amount, status: "posted", ocr_status: "skipped" }),
        });
        toast("Custo lançado", "success");
        await refreshAll();
      } catch (err) {
        toast(err.message || "Erro", "error");
      }
    });
  }

  function boot() {
    bind();
    api("/api/finance/ocr-status")
      .then((j) => {
        const hint = document.getElementById("scanOcrHint");
        if (!hint) return;
        if (j.data && j.data.configured) {
          hint.textContent =
            "OCR ativo: a foto será lida automaticamente (valor, fornecedor, data) e lançada no fluxo quando a confiança for boa.";
        } else {
          hint.textContent =
            "OCR ainda não configurado no servidor (falta OPENAI_API_KEY). O scan guarda o recibo; confirme o valor para lançar.";
        }
      })
      .catch(() => {});
    refreshAll().catch((e) => toast(e.message || "Erro ao carregar financeiro", "error"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
