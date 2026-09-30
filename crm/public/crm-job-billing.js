/**
 * Job billing (Faturamento) — shared by job-detail (desktop card), the mobile job overlay
 * and the Jobs list. Jobs for Builders / Contractors / Lojas are billed straight from their
 * service lines (Tabela de Valores): no quote.
 *
 * window.JobBilling = { chip(billing), money(n), mountCard(el, opts), openDialog(opts), load(jobId) }
 */
(function () {
  if (window.JobBilling) return;

  const INV_STATUS = {
    draft: "Rascunho",
    sent: "Enviada",
    viewed: "Vista",
    partially_paid: "Parcial",
    overdue: "Vencida",
    paid: "Paga",
    void: "Anulada",
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }

  function ensureCss() {
    if (document.querySelector('link[href*="crm-job-billing.css"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "crm-job-billing.css?v=20261001-jobinv1";
    document.head.appendChild(l);
  }

  function chip(billing) {
    if (!billing || !billing.billing_status) return "";
    return `<span class="jb-chip jb-chip--${esc(billing.billing_status)}">${esc(billing.billing_status_label || billing.billing_status)}</span>`;
  }

  async function load(jobId) {
    return api(`/api/work-orders/${encodeURIComponent(jobId)}/invoices`);
  }

  function cardHtml(state, opts) {
    const b = state.billing;
    const invoices = state.invoices || [];
    if (!b) return '<p class="jb-empty">Sem acesso ao faturamento.</p>';
    const total = Number(b.services_total) || 0;
    const paidPct = total > 0 ? Math.min(100, (Number(b.paid_total) / total) * 100) : 0;
    const openPct = total > 0 ? Math.min(100 - paidPct, (Number(b.open_balance) / total) * 100) : 0;
    const canInvoice = opts.canManage && b.remaining_to_invoice > 0.004 && opts.jobStatus !== "canceled";
    const rows = invoices.length
      ? `<ul class="jb-list">${invoices
          .map((inv) => {
            const st = inv.display_status || inv.status;
            const chipCls =
              st === "paid" ? "paid" : st === "draft" || st === "void" ? "no_value" : st === "partially_paid" ? "partially_invoiced" : "awaiting_payment";
            const due =
              st === "overdue" && inv.days_overdue
                ? `vencida há ${inv.days_overdue} dia(s)`
                : inv.due_date
                  ? `vence ${new Date(inv.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : "";
            return `<li><a class="jb-inv" href="${esc(inv.url)}">
              <span class="jb-inv__main">
                <span class="jb-inv__num">${esc(inv.invoice_number || "Fatura")}</span>
                <span class="jb-inv__sub">${esc([inv.invoice_type_label, due].filter(Boolean).join(" · "))}</span>
              </span>
              <span class="jb-chip jb-chip--${chipCls}">${esc(INV_STATUS[st] || st)}</span>
              <span class="jb-inv__amt">${esc(money(inv.amount))}${
                inv.remaining_amount > 0.004 && st !== "draft" && st !== "void"
                  ? `<small>falta ${esc(money(inv.remaining_amount))}</small>`
                  : ""
              }</span>
            </a></li>`;
          })
          .join("")}</ul>`
      : `<p class="jb-empty">${
          total > 0
            ? "Nenhuma fatura ainda. Os serviços do job, com os preços da Tabela de Valores, viram a fatura — sem orçamento."
            : "Adicione os serviços do job (Tabela de Valores) para poder faturar."
        }</p>`;
    return `
      <div class="jb-stats">
        <div class="jb-stat"><span class="jb-stat__k">Total do job</span><span class="jb-stat__v">${esc(money(b.services_total))}</span></div>
        <div class="jb-stat"><span class="jb-stat__k">Faturado</span><span class="jb-stat__v">${esc(money(b.invoiced_total))}</span></div>
        <div class="jb-stat"><span class="jb-stat__k">Recebido</span><span class="jb-stat__v">${esc(money(b.paid_total))}</span></div>
        <div class="jb-stat jb-stat--accent"><span class="jb-stat__k">A faturar</span><span class="jb-stat__v">${esc(money(b.remaining_to_invoice))}</span></div>
      </div>
      ${total > 0 ? `<div class="jb-bar" aria-hidden="true"><span class="jb-bar__paid" style="width:${paidPct.toFixed(1)}%"></span><span class="jb-bar__open" style="width:${openPct.toFixed(1)}%"></span></div>` : ""}
      ${rows}
      ${
        canInvoice
          ? `<div class="jb-actions"><button type="button" class="btn btn-primary btn-sm" data-jb-action="invoice">${
              b.invoiced_total > 0 ? "Faturar saldo" : "Faturar job"
            }</button></div>`
          : ""
      }`;
  }

  /** Mount the Faturamento block. opts: { jobId, jobStatus, canManage, onChange(billing) } */
  function mountCard(el, opts) {
    ensureCss();
    const state = { billing: null, invoices: [] };
    async function refresh() {
      try {
        const j = await load(opts.jobId);
        state.billing = j.billing;
        state.invoices = j.data || [];
      } catch (e) {
        if (e.status === 403) {
          el.innerHTML = '<p class="jb-empty">Sem permissão para ver faturas.</p>';
          return state;
        }
        throw e;
      }
      el.innerHTML = cardHtml(state, opts);
      if (typeof opts.onChange === "function") opts.onChange(state.billing);
      return state;
    }
    el.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-jb-action="invoice"]');
      if (!btn) return;
      openDialog({ jobId: opts.jobId, billing: state.billing, jobStatus: opts.jobStatus });
    });
    el.innerHTML = '<p class="jb-empty">A carregar…</p>';
    refresh().catch((e) => {
      el.innerHTML = `<p class="jb-empty">${esc(e.message || "Erro ao carregar faturas")}</p>`;
    });
    return { refresh, setJobStatus: (s) => { opts.jobStatus = s; if (state.billing) el.innerHTML = cardHtml(state, opts); } };
  }

  function ensureDialog() {
    let dlg = document.getElementById("jbDialog");
    if (dlg) return dlg;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="jb-backdrop" id="jbBackdrop"></div>
      <div class="jb-dialog" id="jbDialog" role="dialog" aria-modal="true" aria-labelledby="jbTitle">
        <h2 id="jbTitle">Faturar job</h2>
        <p class="jb-dialog__sub" id="jbSub"></p>
        <form id="jbForm">
          <div class="jb-opts" id="jbOpts"></div>
          <label class="jb-field">Vencimento
            <input type="date" id="jbDue" />
          </label>
          <p class="jb-err" id="jbErr" hidden></p>
          <div class="jb-dialog__foot">
            <button type="button" class="btn btn-secondary" id="jbCancel">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="jbSubmit">Criar fatura</button>
          </div>
        </form>
      </div>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    dlg = document.getElementById("jbDialog");
    const close = () => {
      dlg.classList.remove("is-open");
      document.getElementById("jbBackdrop").classList.remove("is-open");
    };
    document.getElementById("jbCancel").addEventListener("click", close);
    document.getElementById("jbBackdrop").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dlg.classList.contains("is-open")) close();
    });
    dlg._close = close;
    return dlg;
  }

  /** opts: { jobId, billing, jobStatus } — creates the invoice and opens it. */
  function openDialog(opts) {
    ensureCss();
    const dlg = ensureDialog();
    const b = opts.billing || {};
    const remaining = Number(b.remaining_to_invoice) || 0;
    const total = Number(b.services_total) || 0;
    const first = !(Number(b.invoiced_total) > 0);
    document.getElementById("jbTitle").textContent = first ? "Faturar job" : "Faturar saldo do job";
    document.getElementById("jbSub").textContent = first
      ? `Os serviços do job (${money(total)}) entram na fatura com quantidade e preço da tabela.`
      : `Já faturado ${money(b.invoiced_total)} de ${money(total)}. Falta faturar ${money(remaining)}.`;
    const mainKind = first ? "full" : "final";
    const mainLabel = first ? "Valor total" : "Saldo restante";
    const mainDesc = first ? "Todos os serviços do job" : "Serviços do job menos o que já foi faturado";
    document.getElementById("jbOpts").innerHTML = `
      <label class="jb-opt"><input type="radio" name="jbKind" value="${mainKind}" checked />
        <span class="jb-opt__t">${mainLabel}<span class="jb-opt__d">${mainDesc}</span></span>
        <span class="jb-opt__v">${esc(money(remaining))}</span></label>
      ${
        first
          ? `<label class="jb-opt"><input type="radio" name="jbKind" value="deposit" />
        <span class="jb-opt__t">Depósito<span class="jb-opt__d">Percentual do total do job</span></span>
        <span><input class="jb-opt__inp" type="number" id="jbPct" min="1" max="100" step="1" value="50" aria-label="Percentual" /> %</span></label>`
          : ""
      }
      <label class="jb-opt"><input type="radio" name="jbKind" value="custom" />
        <span class="jb-opt__t">Outro valor<span class="jb-opt__d">Parcela livre (até ${esc(money(remaining))})</span></span>
        <span>$ <input class="jb-opt__inp" type="number" id="jbAmt" min="0.01" step="0.01" max="${remaining.toFixed(2)}" placeholder="0.00" aria-label="Valor" /></span></label>`;
    const due = new Date(Date.now() + 14 * 86400000);
    document.getElementById("jbDue").value = due.toISOString().slice(0, 10);
    const err = document.getElementById("jbErr");
    err.hidden = true;

    // Typing in an option's input selects that option.
    ["jbPct", "jbAmt"].forEach((id) => {
      const inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener("focus", () => {
        const radio = inp.closest(".jb-opt")?.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      });
    });

    const form = document.getElementById("jbForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const kind = form.querySelector('input[name="jbKind"]:checked')?.value || mainKind;
      const body = { invoice_type: kind, due_date: document.getElementById("jbDue").value || null };
      if (kind === "deposit") body.deposit_pct = Number(document.getElementById("jbPct")?.value) || 0;
      if (kind === "custom") body.custom_amount = Number(document.getElementById("jbAmt")?.value) || 0;
      const btn = document.getElementById("jbSubmit");
      btn.disabled = true;
      err.hidden = true;
      try {
        const j = await api(`/api/work-orders/${encodeURIComponent(opts.jobId)}/invoices`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        notify(`Fatura ${j.data?.invoice_number || ""} criada.`, "success");
        window.location.href = j.redirect || `invoice.html?id=${encodeURIComponent(j.data.id)}`;
      } catch (ex) {
        err.textContent = ex.message || "Erro ao criar fatura";
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };
    dlg.classList.add("is-open");
    document.getElementById("jbBackdrop").classList.add("is-open");
  }

  window.JobBilling = { chip, money, mountCard, openDialog, load };
})();
