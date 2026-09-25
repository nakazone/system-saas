/**
 * Financeiro — cash flow, receivables, payroll abatement, costs + scan.
 */
(function () {
  const money = (n) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);

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

  async function loadSummary() {
    const j = await api(`/api/finance/summary${qs()}`);
    const d = j.data || {};
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
      if (count) count.textContent = `(${lines.length})`;
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
      body.innerHTML = `<tr><td colspan="4" class="fin-empty">${escapeHtml(e.message || "Erro")}</td></tr>`;
    }
  }

  async function loadReceivables() {
    const body = document.getElementById("recvBody");
    const count = document.getElementById("recvCount");
    try {
      const j = await api("/api/finance/receivables");
      const rows = j.data || [];
      if (count) count.textContent = `(${rows.length})`;
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
      body.innerHTML = `<tr><td colspan="6" class="fin-empty">${escapeHtml(e.message || "Erro")}</td></tr>`;
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
      if (count) count.textContent = `(${rows.length})`;
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
      body.innerHTML = `<tr><td colspan="6" class="fin-empty">${escapeHtml(e.message || "Erro")}</td></tr>`;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function refreshAll() {
    await Promise.all([loadSummary(), loadCashflow(), loadReceivables(), loadPayroll(), loadCosts()]);
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

    document.getElementById("costsBody")?.addEventListener("click", async (e) => {
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
