/**
 * Job billing (Faturamento) — shared by job-detail (desktop card), the mobile job overlay
 * and the Jobs list. Jobs for Builders / Contractors / Lojas are billed straight from their
 * service lines (Tabela de Valores): no quote.
 *
 * window.JobBilling = { chip(billing), money(n), mountCard(el, opts), openDialog(opts), openPayment(opts), payNext(jobId), load(jobId) }
 *
 * Every action here keeps the person in the job: after issuing, paying or sending, the
 * "jobbilling:changed" window event ({ detail: { jobId } }) lets each screen refresh itself.
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
    else console.warn(msg);
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

  function can(perm) {
    return window.__crmUserRole === "admin" || (window.__crmPermissionKeys || []).includes(perm);
  }
  function changed(jobId) {
    window.dispatchEvent(new CustomEvent("jobbilling:changed", { detail: { jobId } }));
  }

  function ensureCss() {
    if (document.querySelector('link[href*="crm-job-billing.css"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "crm-job-billing.css?v=20261106-rail1";
    document.head.appendChild(l);
  }

  function chip(billing) {
    if (!billing || !billing.billing_status) return "";
    return `<span class="jb-chip jb-chip--${esc(billing.billing_status)}">${esc(billing.billing_status_label || billing.billing_status)}</span>`;
  }

  async function load(jobId) {
    return api(`/api/work-orders/${encodeURIComponent(jobId)}/invoices`);
  }

  const MAX_ROWS = 3;
  /** What still needs action comes first, oldest first; paid invoices fill what's left. */
  function shownInvoices(invoices) {
    const settled = (i) => ["paid", "void"].includes(i.display_status || i.status);
    return [...invoices.filter((i) => !settled(i)), ...invoices.filter(settled).reverse()].slice(0, MAX_ROWS);
  }

  function invoiceRow(inv) {
    const st = inv.display_status || inv.status;
    const chipCls =
      st === "paid" ? "paid" : st === "draft" || st === "void" ? "no_value" : st === "overdue" ? "overdue" : st === "partially_paid" ? "partially_invoiced" : "awaiting_payment";
    const due =
      st === "overdue" && inv.days_overdue
        ? `vencida há ${inv.days_overdue} dia${inv.days_overdue > 1 ? "s" : ""}`
        : inv.due_date && st !== "paid"
          ? `vence ${new Date(inv.due_date).toLocaleDateString("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/\.$/, "")}`
          : "";
    const open = st !== "paid" && st !== "void";
    const canPay = open && st !== "draft" && inv.remaining_amount > 0.004 && can("invoices.record_payment");
    const canSend = open && can("invoices.manage");
    const emailed = Boolean(inv.email_sent_at || inv.sent_to);
    const acts = [
      canPay ? `<button type="button" class="jb-act" data-jb-pay="${esc(inv.id)}">Registrar pagamento</button>` : "",
      canSend ? `<button type="button" class="jb-act" data-jb-send="${esc(inv.id)}">${emailed ? "Reenviar" : "Enviar ao cliente"}</button>` : "",
    ].join("");
    return `<li class="jb-row">
      <a class="jb-inv" href="${esc(inv.url)}">
        <span class="jb-inv__main">
          <span class="jb-inv__num">${esc(inv.invoice_number || "Fatura")}</span>
          <span class="jb-inv__sub">${esc([inv.invoice_type_label, due].filter(Boolean).join(" · "))}</span>
        </span>
        <span class="jb-chip jb-chip--${chipCls}">${esc(INV_STATUS[st] || st)}</span>
        <span class="jb-inv__amt">${esc(money(inv.amount))}${
          inv.remaining_amount > 0.004 && st !== "draft" && st !== "void" && inv.remaining_amount < inv.amount - 0.004
            ? `<small>falta ${esc(money(inv.remaining_amount))}</small>`
            : ""
        }</span>
      </a>
      ${acts ? `<div class="jb-row__acts">${acts}</div>` : ""}
    </li>`;
  }

  /** The money at a glance: what's left to receive or invoice, and the totals. */
  function summaryHtml(b) {
    const total = Number(b.services_total) || 0;
    if (!(total > 0)) return "";
    const paid = Number(b.paid_total) || 0;
    const open = Number(b.open_balance) || 0;
    const head =
      b.billing_status === "paid"
        ? ["Recebido", paid]
        : open > 0.004
          ? ["A receber", open]
          : ["A faturar", Number(b.remaining_to_invoice) || 0];
    const paidPct = Math.min(100, (paid / total) * 100);
    const openPct = Math.min(100 - paidPct, (open / total) * 100);
    return `<div class="jb-sum">
      <small>${head[0]}</small><b>${esc(money(head[1]))}</b>
      <div class="jb-bar jb-sum__bar" role="img" aria-label="${esc(`Recebido ${money(paid)} de ${money(total)}`)}"><span class="jb-bar__paid" style="width:${paidPct.toFixed(1)}%"></span><span class="jb-bar__open" style="width:${openPct.toFixed(1)}%"></span></div>
      <p>Total ${esc(money(total))} · Faturado ${esc(money(b.invoiced_total))} · Recebido ${esc(money(paid))}</p>
    </div>`;
  }

  function cardHtml(state, opts) {
    const b = state.billing;
    const invoices = state.invoices || [];
    if (!b) return '<p class="jb-empty">Sem acesso ao faturamento.</p>';
    const total = Number(b.services_total) || 0;
    const remaining = Number(b.remaining_to_invoice) || 0;
    const canInvoice = opts.canManage && remaining > 0.004 && opts.jobStatus !== "canceled";
    const rows = invoices.length
      ? `<ul class="jb-list">${shownInvoices(invoices).map(invoiceRow).join("")}</ul>${
          invoices.length > MAX_ROWS ? `<p class="jb-more">e mais ${invoices.length - MAX_ROWS} em Ver todas</p>` : ""
        }`
      : `<p class="jb-empty">${total > 0 ? "Nenhuma fatura ainda." : "Adicione os serviços do job para poder faturar."}</p>`;
    return `${summaryHtml(b)}${rows}${
      canInvoice
        ? `<div class="jb-actions"><span class="jb-actions__left">${invoices.length ? `Falta faturar ${esc(money(remaining))}` : `${esc(money(remaining))} para faturar`}</span><button type="button" class="jb-act jb-act--main" data-jb-action="invoice">Emitir Invoice</button></div>`
        : ""
    }`;
  }

  /** Mount the invoices block. opts: { jobId, jobStatus, canManage, onChange(billing) } */
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
      const invoiceBtn = e.target.closest('[data-jb-action="invoice"]');
      if (invoiceBtn) {
        openDialog({ jobId: opts.jobId, billing: state.billing, jobStatus: opts.jobStatus, stay: true });
        return;
      }
      const inv = (id) => state.invoices.find((i) => String(i.id) === String(id));
      const pay = e.target.closest("[data-jb-pay]");
      if (pay) {
        openPayment({ jobId: opts.jobId, invoice: inv(pay.getAttribute("data-jb-pay")), returnFocus: pay });
        return;
      }
      const send = e.target.closest("[data-jb-send]");
      if (send) sendInvoice(opts.jobId, inv(send.getAttribute("data-jb-send")), send);
    });
    const onChanged = (e) => {
      if (!el.isConnected) {
        window.removeEventListener("jobbilling:changed", onChanged);
        return;
      }
      if (String(e.detail?.jobId) === String(opts.jobId)) refresh().catch(() => {});
    };
    window.addEventListener("jobbilling:changed", onChanged);
    el.innerHTML = window.crmSkeleton ? window.crmSkeleton.rows(2, { avatar: false }) : '<p class="jb-empty">Carregando faturas…</p>';
    refresh().catch(() => {
      el.innerHTML = '<p class="jb-empty">Não foi possível carregar as faturas. Atualize a página para tentar de novo.</p>';
    });
    return { refresh, setJobStatus: (s) => { opts.jobStatus = s; if (state.billing) el.innerHTML = cardHtml(state, opts); } };
  }

  /** Sending reaches the client, so it always says where it's going and asks first. */
  async function sendInvoice(jobId, invoice, btn) {
    if (!invoice) return;
    const label = btn.textContent;
    btn.disabled = true;
    try {
      const j = await api(`/api/quote-invoices/${encodeURIComponent(invoice.id)}`);
      let to = j.data?.client?.email || "";
      const number = invoice.invoice_number || "esta fatura";
      if (to) {
        const ok = await window.crmConfirm({ title: `Enviar ${number}?`, text: `Vai por e-mail para ${to}, com o link para pagar.`, ok: "Enviar fatura" });
        if (!ok) return;
      } else {
        to = await window.crmPrompt({ title: `Enviar ${number}`, text: "O cliente não tem e-mail cadastrado. Para qual endereço enviar?", label: "E-mail", type: "email", placeholder: "cliente@exemplo.com", required: true, ok: "Enviar fatura" });
        if (!to) return;
        to = String(to).trim();
      }
      btn.textContent = "Enviando…";
      await api(`/api/quote-invoices/${encodeURIComponent(invoice.id)}/send-email`, { method: "POST", body: JSON.stringify({ to }) });
      notify(`${number} enviada para ${to}.`, "success");
      changed(jobId);
    } catch (e) {
      notify(e.message || "Não foi possível enviar a fatura. Tente de novo.", "error");
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }

  const PAY_METHODS = [
    ["check", "Cheque"],
    ["zelle", "Zelle"],
    ["ach", "ACH / transferência"],
    ["credit_card", "Cartão"],
    ["cash", "Dinheiro"],
    ["venmo", "Venmo"],
    ["financing", "Financiamento"],
    ["other", "Outro"],
  ];
  let paymentDateDefault = null;
  async function paymentDefaultDay(dueDate) {
    if (paymentDateDefault === null) {
      try {
        const j = await api("/api/settings/invoices");
        paymentDateDefault = j.data?.payment_date_default === "due_date" ? "due_date" : "today";
      } catch (_) {
        paymentDateDefault = "today";
      }
    }
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const due = dueDate ? String(dueDate).slice(0, 10) : "";
    return paymentDateDefault === "due_date" && due && due <= today ? due : today;
  }

  function ensurePayDialog() {
    let dlg = document.getElementById("jbPayDialog");
    if (dlg) return dlg;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="jb-backdrop" id="jbPayBackdrop"></div>
      <div class="jb-dialog" id="jbPayDialog" role="dialog" aria-modal="true" aria-labelledby="jbPayTitle">
        <h2 id="jbPayTitle">Registrar pagamento</h2>
        <p class="jb-dialog__sub" id="jbPaySub"></p>
        <form id="jbPayForm" novalidate>
          <div class="jb-opts">
            <label class="jb-opt"><input type="radio" name="jbPayKind" value="full" checked />
              <span class="jb-opt__t">Saldo inteiro</span><span class="jb-opt__v" id="jbPayFull"></span></label>
            <label class="jb-opt"><input type="radio" name="jbPayKind" value="amount" />
              <span class="jb-opt__t">Outro valor</span>
              <span>$ <input class="jb-opt__inp" type="text" inputmode="decimal" id="jbPayAmt" placeholder="0.00" aria-label="Valor recebido" /></span></label>
          </div>
          <label class="jb-field">Forma de pagamento
            <select id="jbPayMethod">${PAY_METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
          </label>
          <label class="jb-field">Data do pagamento
            <input type="date" id="jbPayDate" />
          </label>
          <label class="jb-field">Referência (opcional)
            <input type="text" id="jbPayRef" maxlength="120" placeholder="Nº do cheque ou confirmação" autocomplete="off" />
          </label>
          <label class="jb-check" id="jbPayMailWrap"><input type="checkbox" id="jbPayMail" /> <span id="jbPayMailText"></span></label>
          <p class="jb-err" id="jbPayErr" role="alert" hidden></p>
          <p class="jb-dialog__more"><a id="jbPayMore" href="#">Mais opções na fatura</a></p>
          <div class="jb-dialog__foot">
            <button type="button" class="btn btn-secondary" id="jbPayCancel">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="jbPaySubmit">Registrar pagamento</button>
          </div>
        </form>
      </div>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    dlg = document.getElementById("jbPayDialog");
    const close = () => {
      dlg.classList.remove("is-open");
      document.getElementById("jbPayBackdrop").classList.remove("is-open");
      dlg._returnFocus?.isConnected && dlg._returnFocus.focus();
    };
    document.getElementById("jbPayCancel").addEventListener("click", close);
    document.getElementById("jbPayBackdrop").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dlg.classList.contains("is-open")) close();
    });
    const amt = document.getElementById("jbPayAmt");
    const pickAmount = () => {
      document.querySelector('input[name="jbPayKind"][value="amount"]').checked = true;
    };
    amt.addEventListener("focus", pickAmount);
    amt.addEventListener("input", pickAmount);
    dlg._close = close;
    return dlg;
  }

  /** "$1,200.50", "1200,50" and "1.200,50" are all the same amount. */
  function parseAmount(raw) {
    let t = String(raw || "").replace(/[^\d.,]/g, "");
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  /** The job's next step: pay the oldest invoice that's still open, with fresh numbers. */
  async function payNext(jobId) {
    const j = await load(jobId);
    const invoice = (j.data || []).find((i) => {
      const st = i.display_status || i.status;
      return st !== "paid" && st !== "void" && st !== "draft" && i.remaining_amount > 0.004;
    });
    if (!invoice) {
      notify("Nenhuma fatura enviada com saldo em aberto.", "info");
      changed(jobId);
      return;
    }
    return openPayment({ jobId, invoice });
  }

  /** opts: { jobId, invoice, returnFocus } — records the payment here; the invoice page keeps the rarer options. */
  async function openPayment(opts) {
    ensureCss();
    const invoice = opts.invoice;
    if (!invoice) return;
    const dlg = ensurePayDialog();
    dlg._returnFocus = opts.returnFocus || null;
    const $ = (id) => document.getElementById(id);
    const balance = Number(invoice.remaining_amount) || 0;
    $("jbPaySub").textContent = `${invoice.invoice_number || "Fatura"} · falta receber ${money(balance)}`;
    $("jbPayFull").textContent = money(balance);
    document.querySelector('input[name="jbPayKind"][value="full"]').checked = true;
    $("jbPayAmt").value = "";
    $("jbPayRef").value = "";
    $("jbPayMethod").value = "check";
    $("jbPayErr").hidden = true;
    $("jbPayMore").href = invoice.url;
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $("jbPayDate").max = today;
    $("jbPayDate").value = await paymentDefaultDay(invoice.due_date);
    // The receipt goes to the address on the invoice, the same one the server will use.
    let email = "";
    try {
      const j = await api(`/api/quote-invoices/${encodeURIComponent(invoice.id)}`);
      email = j.data?.client?.email || "";
    } catch (_) {}
    $("jbPayMail").checked = Boolean(email);
    $("jbPayMail").disabled = !email;
    $("jbPayMailText").textContent = email ? `Enviar recibo para ${email}` : "Cliente sem e-mail: sem recibo por e-mail";

    $("jbPayForm").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("jbPayErr");
      const showErr = (msg, field) => {
        err.textContent = msg;
        err.hidden = false;
        field?.focus();
      };
      err.hidden = true;
      const kind = document.querySelector('input[name="jbPayKind"]:checked').value;
      const amount = kind === "full" ? balance : parseAmount($("jbPayAmt").value);
      if (!(amount > 0)) return showErr("Informe o valor recebido. Exemplo: 400.00", $("jbPayAmt"));
      if (amount - balance > 0.004) return showErr(`O valor passa do que falta receber (${money(balance)}).`, $("jbPayAmt"));
      if (!$("jbPayDate").value) return showErr("Informe a data do pagamento.", $("jbPayDate"));
      const settles = Math.abs(balance - amount) < 0.005;
      const btn = $("jbPaySubmit");
      btn.disabled = true;
      btn.textContent = "Registrando…";
      try {
        const j = await api(`/api/quote-invoices/${encodeURIComponent(invoice.id)}/receipts`, {
          method: "POST",
          body: JSON.stringify({
            mode: settles ? "full" : "partial",
            amount,
            payment_date: $("jbPayDate").value,
            payment_method: $("jbPayMethod").value,
            reference_number: $("jbPayRef").value.trim() || null,
            remainder_mode: "keep_open",
            send_email: $("jbPayMail").checked,
          }),
        });
        dlg._returnFocus = null;
        dlg._close();
        const bits = [`Pagamento de ${money(amount)} registrado.`];
        bits.push(j.invoice_paid ? `${invoice.invoice_number || "Fatura"} quitada.` : `Falta receber ${money(balance - amount)}.`);
        if (j.email?.ok && j.email.to) bits.push(`Recibo enviado para ${j.email.to}.`);
        else if (j.email && !j.email.ok) bits.push("O recibo não foi enviado; reenvie pela fatura.");
        else if (j.receipt_email_deferred) bits.push("O recibo vai por e-mail quando a fatura for quitada.");
        notify(bits.join(" "), j.email && !j.email.ok ? "info" : "success");
        changed(opts.jobId);
      } catch (ex) {
        showErr(ex.message || "Não foi possível registrar o pagamento. Tente de novo.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Registrar pagamento";
      }
    };
    dlg.classList.add("is-open");
    $("jbPayBackdrop").classList.add("is-open");
    $("jbPayMethod").focus();
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

  /** Kind radios: deposit / custom / full|final — same choices everywhere (overview + Serviços). */
  function kindOptsHtml(b, ids) {
    const pctId = ids?.pct || "jbPct";
    const amtId = ids?.amt || "jbAmt";
    const name = ids?.name || "jbKind";
    const remaining = Number(b.remaining_to_invoice) || 0;
    const total = Number(b.services_total) || 0;
    const first = !(Number(b.invoiced_total) > 0);
    const mainKind = first ? "full" : "final";
    const mainLabel = first ? "Valor total" : "Saldo restante";
    const mainDesc = first ? "Todos os serviços do job" : "O que ainda falta faturar";
    // First invoice defaults to deposit (Nova fatura); later invoices default to remaining balance.
    const deposit = first
      ? `<label class="jb-opt"><input type="radio" name="${name}" value="deposit" checked />
        <span class="jb-opt__t">Depósito<span class="jb-opt__d">Percentual do total do job (${esc(money(total))})</span></span>
        <span><input class="jb-opt__inp" type="number" id="${pctId}" min="1" max="100" step="1" value="50" aria-label="Percentual" /> %</span></label>`
      : "";
    return {
      first,
      mainKind,
      remaining,
      total,
      pctId,
      amtId,
      name,
      html: `${deposit}
      <label class="jb-opt"><input type="radio" name="${name}" value="custom" />
        <span class="jb-opt__t">Outro valor<span class="jb-opt__d">Parcela livre (até ${esc(money(remaining))})</span></span>
        <span>$ <input class="jb-opt__inp" type="number" id="${amtId}" min="0.01" step="0.01" max="${remaining.toFixed(2)}" placeholder="0.00" aria-label="Valor" /></span></label>
      <label class="jb-opt"><input type="radio" name="${name}" value="${mainKind}"${first ? "" : " checked"} />
        <span class="jb-opt__t">${mainLabel}<span class="jb-opt__d">${mainDesc}</span></span>
        <span class="jb-opt__v">${esc(money(remaining))}</span></label>`,
    };
  }

  function bindKindInputs(root, pctId, amtId) {
    const scope = root || document;
    [pctId || "jbPct", amtId || "jbAmt"].forEach((id) => {
      const el = scope.querySelector(`#${id}`);
      if (!el) return;
      const select = () => {
        const radio = el.closest(".jb-opt")?.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      };
      el.addEventListener("focus", select);
      el.addEventListener("input", select);
    });
  }

  async function submitInvoice(opts, form, errEl, defaultKind, ids) {
    const name = ids?.name || "jbKind";
    const kind = form.querySelector(`input[name="${name}"]:checked`)?.value || defaultKind;
    const dueEl = form.querySelector("[data-jb-due]") || form.querySelector('input[type="date"]');
    const body = { invoice_type: kind, due_date: dueEl?.value || null };
    if (kind === "deposit") body.deposit_pct = Number(form.querySelector(`#${ids?.pct || "jbPct"}`)?.value) || 0;
    if (kind === "custom") body.custom_amount = Number(form.querySelector(`#${ids?.amt || "jbAmt"}`)?.value) || 0;
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    if (errEl) errEl.hidden = true;
    try {
      const j = await api(`/api/work-orders/${encodeURIComponent(opts.jobId)}/invoices`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (opts.stay) {
        document.getElementById("jbDialog")?._close?.();
        notify(`Fatura ${j.data?.invoice_number || ""} criada. Falta enviar ao cliente.`, "success");
        changed(opts.jobId);
        if (btn) btn.disabled = false;
        return;
      }
      notify(`Fatura ${j.data?.invoice_number || ""} criada.`, "success");
      const invId = j.data?.id;
      window.location.href =
        j.redirect ||
        (invId
          ? `invoices.html?id=${encodeURIComponent(invId)}&new=1&period=all`
          : "invoices.html");
    } catch (ex) {
      if (errEl) {
        errEl.textContent = ex.message || "Erro ao criar fatura";
        errEl.hidden = false;
      } else {
        notify(ex.message || "Erro ao criar fatura", "error");
      }
      if (btn) btn.disabled = false;
    }
  }

  /** opts: { jobId, billing, jobStatus, stay } — creates the invoice; with `stay` the person remains in the job. */
  function openDialog(opts) {
    ensureCss();
    const dlg = ensureDialog();
    const b = opts.billing || {};
    const ids = { pct: "jbPct", amt: "jbAmt", name: "jbKind" };
    const packed = kindOptsHtml(b, ids);
    document.getElementById("jbTitle").textContent = packed.first ? "Faturar job" : "Faturar saldo do job";
    document.getElementById("jbSub").textContent = packed.first
      ? `Escolha o valor. Os serviços (${money(packed.total)}) entram na fatura com preço da tabela.`
      : `Já faturado ${money(b.invoiced_total)} de ${money(packed.total)}. Falta faturar ${money(packed.remaining)}.`;
    document.getElementById("jbOpts").innerHTML = packed.html;
    const due = new Date(Date.now() + 1 * 86400000);
    const dueInput = document.getElementById("jbDue");
    dueInput.value = due.toISOString().slice(0, 10);
    dueInput.setAttribute("data-jb-due", "1");
    const err = document.getElementById("jbErr");
    err.hidden = true;
    bindKindInputs(dlg, ids.pct, ids.amt);

    const form = document.getElementById("jbForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      await submitInvoice(opts, form, err, packed.first ? "deposit" : "final", ids);
    };
    dlg.classList.add("is-open");
    document.getElementById("jbBackdrop").classList.add("is-open");
  }

  /**
   * Inline picker for Visão geral (same options as the dialog — deposit / custom / total).
   * opts: { jobId, billing, jobStatus }
   */
  function mountPicker(el, opts) {
    if (!el) return;
    ensureCss();
    const b = opts.billing || {};
    if (!(Number(b.remaining_to_invoice) > 0.004) || opts.jobStatus === "canceled") {
      el.innerHTML = "";
      return;
    }
    const ids = { pct: "jdBillPct", amt: "jdBillAmt", name: "jdBillKind" };
    const packed = kindOptsHtml(b, ids);
    const due = new Date(Date.now() + 1 * 86400000);
    const dueVal = due.toISOString().slice(0, 10);
    el.innerHTML = `
      <form class="jb-inline" id="jdBillForm">
        <p class="jb-inline__t">Faturar — escolha o valor</p>
        <div class="jb-opts">${packed.html}</div>
        <label class="jb-field">Vencimento
          <input type="date" data-jb-due value="${dueVal}" />
        </label>
        <p class="jb-err" id="jdBillErr" hidden></p>
        <button type="submit" class="btn btn-primary btn-sm jb-inline__go">Criar fatura</button>
      </form>`;
    bindKindInputs(el, ids.pct, ids.amt);
    const form = el.querySelector("#jdBillForm");
    const err = el.querySelector("#jdBillErr");
    form.onsubmit = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await submitInvoice(opts, form, err, packed.first ? "deposit" : "final", ids);
    };
  }

  window.JobBilling = { chip, money, mountCard, openDialog, openPayment, payNext, mountPicker, load };
})();
