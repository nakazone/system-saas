/* Fatura — aberta dentro de Invoices (invoices.html?id=…), ao lado da lista. Payments, receipts, send, PAID stamp.
   window.InvoicePage = { open(id), current() }; avisa a lista com o evento 'invoice:changed' / 'invoice:deleted'. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let invoiceId = params.get('id');
  let inv = null;
  let busy = false;
  const EMBED = !!document.getElementById('invSplit');

  // ---------------------------------------------------------------- utils
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(n) {
    return (Number(n) < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dateObj(d) {
    if (!d) return null;
    const s = String(d);
    const x = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00Z') : new Date(s);
    return Number.isNaN(x.getTime()) ? null : x;
  }
  function fdate(d, opts) {
    const x = dateObj(d);
    if (!x) return '—';
    return x.toLocaleDateString('pt-BR', Object.assign({ day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }, opts || {}));
  }
  function fdatetime(d) {
    const x = dateObj(d);
    if (!x) return '';
    return x.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function isoDay(d) {
    const x = dateObj(d) || new Date();
    return x.toISOString().slice(0, 10);
  }
  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function dayLocal(d) {
    if (d == null || d === '') return null;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    const x = dateObj(d);
    if (!x) return null;
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  let paymentDateDefault = 'today';
  let paymentDateSettingsLoaded = false;
  async function ensurePaymentDateSettings() {
    if (paymentDateSettingsLoaded) return paymentDateDefault;
    paymentDateSettingsLoaded = true;
    try {
      const j = await api('/api/settings/invoices');
      paymentDateDefault = j.data && j.data.payment_date_default === 'due_date' ? 'due_date' : 'today';
    } catch (_) {
      paymentDateDefault = 'today';
    }
    return paymentDateDefault;
  }

  function setPayDateValue(day) {
    const el = $('payDate');
    if (!el || !day) return;
    el.value = day;
    // Allow due date even if it is after "today" (rare); otherwise keep past/today free.
    const today = todayLocal();
    el.max = day > today ? day : today;
  }

  function renderPayDateQuick() {
    const host = $('payDateQuick');
    if (!host) return;
    const today = todayLocal();
    const due = dayLocal(inv && inv.due_date);
    const chips = [{ key: 'today', label: 'Hoje', day: today }];
    if (due) chips.push({ key: 'due', label: 'Vencimento', day: due });
    host.innerHTML = chips
      .map(
        (c) =>
          `<button type="button" class="inv-chip-btn" data-pay-day="${c.day}" data-pay-day-key="${c.key}">${c.label}${
            c.key === 'due' ? ` <small>${fdate(c.day)}</small>` : ''
          }</button>`,
      )
      .join('');
    host.querySelectorAll('[data-pay-day]').forEach((b) =>
      b.addEventListener('click', () => {
        setPayDateValue(b.getAttribute('data-pay-day'));
        syncPay();
      }),
    );
  }
  function toast(msg, type) {
    if (window.crmToast) window.crmToast[type === 'error' ? 'error' : type === 'info' ? 'info' : 'success'](msg);
    else alert(msg);
  }
  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      location.href = '/login.html';
      throw new Error('Sessão expirada');
    }
    if (!r.ok || j.success === false) throw new Error(j.error || `Erro ${r.status}`);
    return j;
  }

  const STATUS = {
    draft: { label: 'Rascunho', cls: 'is-draft' },
    sent: { label: 'Enviada', cls: 'is-sent' },
    viewed: { label: 'Vista pelo cliente', cls: 'is-viewed' },
    partially_paid: { label: 'Parcialmente paga', cls: 'is-partial' },
    overdue: { label: 'Vencida', cls: 'is-overdue' },
    paid: { label: 'Paga', cls: 'is-paid' },
    void: { label: 'Cancelada', cls: 'is-void' },
  };

  // ---------------------------------------------------------------- render
  function render() {
    const st = STATUS[inv.display_status] || STATUS.sent;
    document.title = `${inv.invoice_number || 'Fatura'} | ObraMate`;
    $('invCrumbNumber').textContent = inv.invoice_number || 'Fatura';
    $('invTitle').textContent = inv.invoice_number || 'Fatura';
    const chip = $('invStatusChip');
    chip.className = `inv-chip ${st.cls}`;
    chip.textContent = inv.display_status === 'overdue' ? `Vencida há ${inv.days_overdue} ${inv.days_overdue === 1 ? 'dia' : 'dias'}` : st.label;
    $('invSubtitle').innerHTML = [
      inv.client && inv.client.name ? `<b>${esc(inv.client.name)}</b>` : '',
      esc(inv.invoice_type_label),
      inv.quote ? `Orçamento <a href="quote-builder.html?id=${encodeURIComponent(inv.quote.id)}">${esc(inv.quote.number || '')}</a>` : '',
      !inv.quote && inv.job
        ? `<a href="${esc(inv.job.url)}">Job ${inv.job.number != null ? `#${esc(inv.job.number)}` : ''}</a>`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const open = inv.remaining_amount > 0.004 && inv.status !== 'void';
    const isDraft = inv.status === 'draft';
    // Job invoices are issued as "sent" without e-mail — only sent_to / email_sent_at means mailed.
    const emailSent = Boolean(inv.sent_to || inv.email_sent_at);
    // Receive payment only after the invoice left draft — sending ≠ paid.
    const canPay = inv.can.record_payment && open && !isDraft;
    const canSend = inv.can.manage && inv.status !== 'void';
    $('btnReceiveMobile').hidden = !canPay;
    $('btnAddPayment').hidden = !canPay;
    $('btnSendMobile').hidden = !canSend;
    $('btnSendMobile').textContent = emailSent ? 'Reenviar' : 'Enviar';
    const sendPrimary = canSend && !emailSent;
    $('btnSendMobile').className = sendPrimary ? 'inv-btn inv-btn--primary' : 'inv-btn inv-btn--secondary';
    $('btnReceiveMobile').className = !sendPrimary && canPay ? 'inv-btn inv-btn--primary' : 'inv-btn inv-btn--secondary';
    $('invMobileBar').hidden = !canPay && !canSend;
    const canEdit = inv.can.manage && inv.status !== 'void';
    const canDelete = inv.can.manage && (inv.status === 'draft' || inv.status === 'void') && inv.payments.length === 0;
    const canCancel = inv.can.manage && inv.status !== 'void' && inv.status !== 'draft' && inv.payments.length === 0;
    if ($('btnEdit')) $('btnEdit').hidden = !canEdit;
    if ($('btnDeleteInvoice')) {
      $('btnDeleteInvoice').hidden = !canDelete && !canCancel;
      $('btnDeleteInvoice').dataset.mode = canDelete ? 'delete' : 'cancel';
      $('btnDeleteInvoice').title = 'Excluir';
      $('btnDeleteInvoice').setAttribute('aria-label', 'Excluir');
    }

    renderSteps();
    renderNext();
    renderBanner();
    renderPaper();
    renderSummary();
    renderPayments();
    renderQuote();
    renderActivity();
    $('invPage').setAttribute('aria-busy', 'false');
    window.dispatchEvent(new CustomEvent('invoice:changed', { detail: inv }));
  }

  // ---------------------------------------------------------------- próximo passo
  function daysUntil(d) {
    const x = dateObj(d);
    if (!x) return null;
    const t = new Date();
    return Math.round((Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  }
  function plural(n, a, b) {
    return `${n} ${n === 1 ? a : b}`;
  }
  /** Um passo óbvio por fatura, com as datas que já existem (envio, visualização, vencimento, pagamentos). */
  function renderNext() {
    const box = $('invNext');
    if (!box) return;
    const c = inv.client || {};
    const who = c.name || 'o cliente';
    const phone = c.phone ? String(c.phone).replace(/[^\d+]/g, '') : '';
    const emailSent = Boolean(inv.sent_to || inv.email_sent_at);
    const sentAt = inv.email_sent_at || (emailSent ? inv.issued_at : null);
    const sentTxt = emailSent
      ? `Enviada por e-mail ${fdate(sentAt, { year: undefined })}`
      : 'Ainda não enviada por e-mail';
    const seen = inv.viewed_at ? `vista ${fdate(inv.viewed_at, { year: undefined })}` : 'ainda não aberta';
    let title = '';
    let text = '';
    const btns = [];
    if (inv.status === 'void' || inv.display_status === 'paid') {
      box.hidden = true;
      return;
    }
    if (inv.status === 'draft' || !emailSent) {
      title = 'Enviar ao cliente';
      text =
        inv.status === 'draft'
          ? `Rascunho de ${money(inv.amount)}. ${who} ainda não recebeu esta fatura.`
          : `Fatura de ${money(inv.amount)} emitida, mas o e-mail ainda não foi enviado a ${who}.`;
      if (inv.can.manage) btns.push(['send', 'Enviar fatura', true]);
      if (inv.can.record_payment && inv.status !== 'draft' && inv.remaining_amount > 0.004) {
        btns.push(['pay', 'Receber pagamento', false]);
      }
    } else if (inv.display_status === 'overdue') {
      title = `Cobrar ${who}`;
      text = `Venceu há ${plural(inv.days_overdue, 'dia', 'dias')}. ${sentTxt}, ${seen}.`;
      if (inv.can.manage) btns.push(['send', 'Reenviar', true]);
      if (phone) btns.push(['call', 'Ligar', false]);
      else if (inv.can.record_payment) btns.push(['pay', 'Receber', false]);
    } else {
      const d = daysUntil(inv.due_date);
      title = `Receber ${money(inv.remaining_amount)}`;
      const dueTxt = d == null ? '' : d === 0 ? 'Vence hoje' : d > 0 ? `Vence em ${plural(d, 'dia', 'dias')}` : '';
      text = [inv.paid_amount > 0 ? `${money(inv.paid_amount)} já recebido` : '', dueTxt, `${sentTxt}, ${seen}`].filter(Boolean).join(' · ') + '.';
      if (inv.can.record_payment) btns.push(['pay', 'Receber pagamento', true], ['partial', 'Baixa parcial', false]);
    }
    box.hidden = false;
    box.innerHTML = `<h3>Próximo passo</h3><b>${esc(title)}</b><p>${esc(text)}</p>${
      btns.length
        ? `<div class="inv-next__row">${btns
            .map(([k, l, pri]) =>
              k === 'call'
                ? `<a class="inv-btn ${pri ? 'inv-btn--primary' : 'inv-next__ghost'}" href="tel:${esc(phone)}">${esc(l)}</a>`
                : `<button type="button" class="inv-btn ${pri ? 'inv-btn--primary' : 'inv-next__ghost'}" data-next="${k}">${esc(l)}</button>`,
            )
            .join('')}</div>`
        : ''
    }`;
    box.querySelectorAll('[data-next]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.next;
        if (k === 'send') openSend();
        else if (k === 'pay') openPay('full');
        else if (k === 'partial') openPay('partial');
      }),
    );
  }

  function renderSteps() {
    const steps = [
      { key: 'created', label: 'Criada', at: inv.created_at, done: true },
      { key: 'sent', label: 'Enviada', at: inv.issued_at, done: Boolean(inv.issued_at) || inv.status !== 'draft' },
      { key: 'viewed', label: 'Vista', at: inv.viewed_at, done: Boolean(inv.viewed_at) },
      {
        key: 'paid',
        label: inv.display_status === 'paid' ? 'Paga' : inv.paid_amount > 0 ? `Paga ${inv.percent_paid}%` : 'Paga',
        at: inv.paid_at,
        done: inv.display_status === 'paid',
        partial: inv.display_status !== 'paid' && inv.paid_amount > 0,
      },
    ];
    if (inv.status === 'void') {
      $('invSteps').innerHTML = `<li class="inv-step is-void"><span class="inv-step__dot"></span><span><b>Cancelada</b><small>${esc(fdate(inv.voided_at))}</small></span></li>`;
      return;
    }
    $('invSteps').innerHTML = steps
      .map(
        (s) => `<li class="inv-step ${s.done ? 'is-done' : ''} ${s.partial ? 'is-partial' : ''}">
          <span class="inv-step__dot" aria-hidden="true">${s.done ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' : ''}</span>
          <span><b>${esc(s.label)}</b><small>${s.at && (s.done || s.partial) ? esc(fdate(s.at, { year: undefined })) : s.partial ? '' : '—'}</small></span>
        </li>`,
      )
      .join('');
  }

  function renderBanner() {
    const b = $('invBanner');
    let html = '';
    if (inv.status === 'void') html = '<b>Fatura cancelada.</b> Não é mais cobrada e o link do cliente foi desativado.';
    else if (inv.display_status === 'overdue')
      html = `<b>Vencida há ${inv.days_overdue} ${inv.days_overdue === 1 ? 'dia' : 'dias'}.</b> Saldo de ${money(inv.remaining_amount)} em aberto desde ${esc(fdate(inv.due_date))}.`;
    else if (inv.status === 'draft')
      html = '<b>Rascunho.</b> Envie ao cliente primeiro. Só use <em>Receber pagamento</em> quando o dinheiro entrar — enviar não marca como paga.';
    else if (inv.display_status !== 'paid' && inv.remaining_amount > 0.004)
      html = `<b>Aguardando pagamento.</b> Saldo de ${money(inv.remaining_amount)} em aberto${inv.due_date ? ` · vence ${esc(fdate(inv.due_date))}` : ''}. Dê baixa só quando receber.`;
    b.hidden = !html;
    b.className = `inv-banner ${
      inv.status === 'void'
        ? 'is-void'
        : inv.display_status === 'overdue'
          ? 'is-overdue'
          : inv.status === 'draft'
            ? 'is-draft'
            : 'is-awaiting'
    }`;
    b.innerHTML = html;
  }

  function stampHtml() {
    if (inv.display_status === 'paid') {
      return `<div class="inv-stamp" id="invStamp" aria-label="Pago"><b>PAGO</b><small>${esc(fdate(inv.paid_at).toUpperCase())}</small></div>`;
    }
    if (inv.paid_amount > 0.004 && inv.status !== 'void') {
      return `<div class="inv-stamp inv-stamp--partial" id="invStamp" aria-label="Parcialmente pago"><b>PARCIAL</b><small>${esc(money(inv.paid_amount))} RECEBIDO</small></div>`;
    }
    if (inv.status === 'void') return '<div class="inv-stamp inv-stamp--void" aria-label="Cancelada"><b>CANCELADA</b></div>';
    return '';
  }

  function formatInvLineDesc(desc) {
    const raw = String(desc == null ? "" : desc);
    const nl = raw.indexOf("\n");
    const dash = nl < 0 ? raw.search(/\s+—\s+/) : -1;
    let name = raw;
    let note = "";
    if (nl >= 0) {
      name = raw.slice(0, nl).trim();
      note = raw.slice(nl + 1).trim();
    } else if (dash >= 0) {
      name = raw.slice(0, dash).trim();
      note = raw.slice(dash).replace(/^\s+—\s+/, "").trim();
    }
    if (!note) return esc(name);
    return `<span class="inv-line__name">${esc(name)}</span><span class="inv-line__note">${esc(note)}</span>`;
  }

  function renderPaper() {
    const c = inv.client || {};
    const lines = inv.line_items.length
      ? inv.line_items
      : [{ description: inv.invoice_type_label, quantity: 1, unit_price: inv.amount, amount: inv.amount }];
    const org = inv.organization || {};
    const orgName = org.name || '';
    const initials = orgName.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || 'OM';
    $('invPaper').innerHTML = `
      <header class="inv-paper__brand">
        ${org.logo_url ? `<img src="${esc(org.logo_url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'inv-paper__mono',textContent:'${esc(initials)}'}))" />` : `<span class="inv-paper__mono">${esc(initials)}</span>`}
        <div>
          <b>${esc(orgName)}</b>
          ${[org.address, org.contact, org.license].filter(Boolean).map((l) => `<small>${esc(l)}</small>`).join('')}
        </div>
      </header>
      <div class="inv-paper__top">
        <div>
          <p class="inv-label">Cobrar de</p>
          <p class="inv-paper__client">${esc(c.name || 'Cliente')}</p>
          ${c.address ? `<p class="inv-paper__muted">${esc(c.address)}</p>` : ''}
          ${c.email ? `<p class="inv-paper__muted">${esc(c.email)}</p>` : ''}
          ${c.phone ? `<p class="inv-paper__muted">${esc(typeof window.sfFormatPhone === 'function' ? window.sfFormatPhone(c.phone) || c.phone : c.phone)}</p>` : ''}
        </div>
        <div class="inv-paper__doc">
          <p class="inv-paper__kind">INVOICE</p>
          <p class="inv-paper__num">${esc(inv.invoice_number || '')}</p>
          <dl>
            <dt>Emissão</dt><dd>${esc(fdate(inv.issued_at || inv.created_at))}</dd>
            <dt>Vencimento</dt><dd>${esc(fdate(inv.due_date))}</dd>
            ${inv.quote ? `<dt>Orçamento</dt><dd>${esc(inv.quote.number || '')}</dd>` : ''}
          </dl>
        </div>
      </div>
      <table class="inv-lines">
        <thead><tr><th>Descrição</th><th class="r">Qtd</th><th class="r">Valor</th></tr></thead>
        <tbody>
          ${lines
            .map(
              (l) => `<tr><td>${formatInvLineDesc(l.description)}</td><td class="r">${Number(l.quantity || 1).toLocaleString('en-US')}</td><td class="r">${money(l.amount)}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="inv-totals-row">
      ${stampHtml() || '<span></span>'}
      <div class="inv-totals">
        <div><span>Total Services</span><span>${money(inv.services_total != null ? inv.services_total : lines.reduce((s, l) => s + Number(l.amount || 0), 0))}</span></div>
        ${inv.payments
          .map(
            (p) => `<div class="inv-totals__pay"><span>Pagamento ${esc(fdate(p.paid_at, { year: undefined }))} · ${esc(p.method_label)}</span><span>–${money(p.amount)}</span></div>`,
          )
          .join('')}
        <div class="inv-totals__due"><span>Balance Due on this invoice</span><span>${money(inv.remaining_amount)}</span></div>
        ${Number(inv.remaining_after_this_invoice) > 0.004
          ? `<div class="inv-totals__after"><span>Balance Due after this invoice</span><span>${money(inv.remaining_after_this_invoice)}</span></div>`
          : ""}
      </div>
      </div>
      ${inv.payment_instructions && inv.remaining_amount > 0 ? `<div class="inv-paper__block"><p class="inv-label">Como pagar</p><p>${esc(inv.payment_instructions)}</p></div>` : ''}
      ${inv.notes ? `<div class="inv-paper__block"><p class="inv-label">Nota</p><p>${esc(inv.notes)}</p></div>` : ''}
    `;
  }

  function renderSummary() {
    const due = dateObj(inv.due_date);
    let dueTxt = '';
    if (inv.status === 'void') dueTxt = 'Cancelada';
    else if (inv.display_status === 'paid') dueTxt = `Quitada em ${fdate(inv.paid_at)}`;
    else if (due) {
      const days = Math.round((Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);
      dueTxt = days < 0 ? `Venceu há ${-days} ${days === -1 ? 'dia' : 'dias'}` : days === 0 ? 'Vence hoje' : `Vence em ${days} ${days === 1 ? 'dia' : 'dias'} · ${fdate(inv.due_date)}`;
    }
    $('invSummary').innerHTML = `
      <div class="inv-summary__balance">
        <span>${inv.display_status === 'paid' ? 'Recebido' : 'Saldo em aberto'}</span>
        <strong>${money(inv.display_status === 'paid' ? inv.paid_amount : inv.remaining_amount)}</strong>
        <small class="${inv.display_status === 'overdue' ? 'is-overdue' : ''}">${esc(dueTxt)}</small>
      </div>
      <div class="inv-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${inv.percent_paid}" aria-label="Percentual pago">
        <span style="width:${inv.percent_paid}%"></span>
      </div>
      <dl class="inv-summary__rows">
        <div><dt>Total da fatura</dt><dd>${money(inv.amount)}</dd></div>
        <div><dt>Pago</dt><dd>${money(inv.paid_amount)} <small>(${inv.percent_paid}%)</small></dd></div>
        <div><dt>Saldo</dt><dd><b>${money(inv.remaining_amount)}</b></dd></div>
      </dl>
      ${false ? `
        <div class="inv-summary__quick">
          <button type="button" class="inv-btn inv-btn--primary inv-btn--block" data-pay="full">Pagamento integral · ${money(inv.remaining_amount)}</button>
          <button type="button" class="inv-btn inv-btn--secondary inv-btn--block" data-pay="partial">Dar baixa parcial</button>
        </div>` : inv.status === 'draft' && inv.can.manage ? `
        <div class="inv-summary__quick">
          <button type="button" class="inv-btn inv-btn--primary inv-btn--block" id="btnSummarySend">Enviar fatura ao cliente</button>
          <p class="inv-hint">Depois que o pagamento entrar, use <b>Receber pagamento</b> para dar baixa.</p>
        </div>` : ''}
    `;
    $('invSummary').querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openPay(b.dataset.pay)));
    $('btnSummarySend')?.addEventListener('click', openSend);
  }

  function renderPayments() {
    const host = $('invPayments');
    if (!inv.payments.length) {
      host.innerHTML = `<p class="inv-empty">${
        inv.status === 'draft'
          ? 'Nenhum pagamento ainda. Envie a fatura ao cliente; só registre o pagamento quando o dinheiro entrar.'
          : inv.can.record_payment && inv.remaining_amount > 0 && inv.status !== 'void'
            ? 'Nenhum pagamento registrado. Use <b>Receber pagamento</b> quando o cliente pagar.'
            : 'Nenhum pagamento registrado.'
      }</p>`;
      return;
    }
    host.innerHTML = inv.payments
      .slice()
      .reverse()
      .map(
        (p) => `<div class="inv-pay" data-id="${esc(p.id)}">
          <div class="inv-pay__main">
            <div class="inv-pay__amt">${money(p.amount)}</div>
            <div class="inv-pay__meta">${esc(fdate(p.paid_at))} · ${esc(p.method_label)}${p.reference_number ? ` · ${esc(p.reference_number)}` : ''}</div>
            <div class="inv-pay__rcpt">
              <span class="inv-rcpt-no">${esc(p.receipt_number || 'Recibo')}</span>
              ${p.sent_at ? `<span class="inv-sent" title="${esc(p.sent_to || '')}">Recibo enviado ${esc(fdate(p.sent_at, { year: undefined }))}</span>` : '<span class="inv-unsent">Recibo não enviado</span>'}
            </div>
            ${p.notes ? `<div class="inv-pay__note">${esc(p.notes)}</div>` : ''}
          </div>
          <div class="inv-pay__actions">
            <button type="button" class="inv-mini" data-rcpt-pdf="${esc(p.id)}" title="Ver recibo">Recibo</button>
            ${inv.can.record_payment ? `<button type="button" class="inv-mini" data-rcpt-send="${esc(p.id)}">${p.sent_at ? 'Reenviar' : 'Enviar'}</button>` : ''}
            ${inv.can.record_payment && !p.online ? `<button type="button" class="inv-mini inv-mini--danger" data-rcpt-del="${esc(p.id)}" title="Remover pagamento">Desfazer</button>` : ''}
          </div>
        </div>`,
      )
      .join('');
    host.querySelectorAll('[data-rcpt-pdf]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = inv.payments.find((x) => x.id === b.dataset.rcptPdf);
        openPdf(`/api/invoice-receipts/${b.dataset.rcptPdf}/pdf`, p && p.receipt_number ? `Recibo ${p.receipt_number}` : 'Recibo', `${(p && p.receipt_number) || 'recibo'}.pdf`);
      }),
    );
    host.querySelectorAll('[data-rcpt-send]').forEach((b) => b.addEventListener('click', () => sendReceipt(b.dataset.rcptSend, b)));
    host.querySelectorAll('[data-rcpt-del]').forEach((b) => b.addEventListener('click', () => removePayment(b.dataset.rcptDel)));
  }

  function renderQuote() {
    const card = $('invQuoteCard');
    if (!inv.quote && !inv.job) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const isJob = !inv.quote;
    $('invQuoteCardTitle').textContent = isJob ? 'Job' : 'Orçamento';
    const q = isJob
      ? {
          ...inv.job,
          number: inv.job.number != null ? `Job #${inv.job.number}` : 'Job',
          title: [inv.job.title, inv.job.address].filter(Boolean).join(' · '),
        }
      : inv.quote;
    const href = isJob ? q.url : `quote-builder.html?id=${encodeURIComponent(q.id)}`;
    const pct = q.total > 0 ? Math.min(100, Math.round((q.invoiced_total / q.total) * 100)) : 0;
    const quoteNote = !isJob ? String(q.reference_note || '').trim() : '';
    $('invQuote').innerHTML = `
      <a class="inv-quote-link" href="${esc(href)}">
        <span><b>${esc(q.number || 'Orçamento')}</b><small>${esc(quoteNote || (isJob ? q.title || '' : ''))}</small></span>
        <span>${money(q.total)}</span>
      </a>
      <div class="inv-progress inv-progress--thin"><span style="width:${pct}%"></span></div>
      <p class="inv-muted">Faturado ${money(q.invoiced_total)} de ${money(q.total)}${q.remaining_to_invoice > 0 ? ` · falta faturar ${money(q.remaining_to_invoice)}` : ' · totalmente faturado'}</p>
      ${inv.sibling_invoices.length ? `<ul class="inv-siblings">${inv.sibling_invoices
        .map(
          (s) => `<li><a href="invoices.html?id=${encodeURIComponent(s.id)}" data-inv-open="${esc(s.id)}">${esc(s.invoice_number || 'Fatura')}</a><span>${esc(s.invoice_type_label)}</span><span>${money(s.amount)}</span><span class="inv-dot ${esc((STATUS[s.status] || STATUS.sent).cls)}" title="${esc((STATUS[s.status] || STATUS.sent).label)}"></span></li>`,
        )
        .join('')}</ul>` : ''}
    `;
  }

  const ACTIVITY = {
    created: 'Fatura criada',
    updated: 'Fatura editada',
    sent: 'Enviada por e-mail',
    marked_sent: 'Marcada como enviada',
    link_shared: 'Link compartilhado',
    viewed: 'Cliente abriu a fatura',
    payment_recorded: 'Pagamento registrado',
    payment_removed: 'Pagamento removido',
    receipt_sent: 'Recibo enviado',
    voided: 'Fatura anulada',
    status_changed: 'Status alterado',
  };

  function activityDetail(e) {
    const ch = e.changes || {};
    const to = (k) => (ch[k] && ch[k].to != null ? ch[k].to : null);
    const from = (k) => (ch[k] && ch[k].from != null ? ch[k].from : null);
    switch (e.action) {
      case 'payment_recorded':
        return `${money(to('amount'))}${to('receipt') ? ` · ${to('receipt')}` : ''}`;
      case 'payment_removed':
        return `${money(from('amount'))}${from('receipt') ? ` · ${from('receipt')}` : ''}`;
      case 'sent':
      case 'receipt_sent':
        return [to('receipt'), to('to')].filter(Boolean).join(' → ');
      case 'created':
        return to('amount') != null ? money(to('amount')) : '';
      case 'voided':
        return to('reason') || '';
      default:
        return '';
    }
  }

  function renderActivity() {
    const host = $('invActivity');
    if (!inv.activity.length) {
      host.innerHTML = '<li class="inv-empty">Sem atividade.</li>';
      return;
    }
    host.innerHTML = inv.activity
      .map((e) => {
        const who = e.actor_type === 'customer' ? 'Cliente' : e.actor_name || (e.actor_type === 'system' ? 'Sistema' : '');
        const det = activityDetail(e);
        return `<li class="inv-act inv-act--${esc(e.action)}">
          <span class="inv-act__dot" aria-hidden="true"></span>
          <div><b>${esc(ACTIVITY[e.action] || e.action)}</b>${det ? `<span class="inv-act__det">${esc(det)}</span>` : ''}
          <small>${esc(fdatetime(e.created_at))}${who ? ` · ${esc(who)}` : ''}</small></div>
        </li>`;
      })
      .join('');
  }

  // ---------------------------------------------------------------- modals
  let lastFocus = null;
  function openModal(id) {
    lastFocus = document.activeElement;
    const m = $(id);
    m.hidden = false;
    document.body.classList.add('inv-modal-open');
    requestAnimationFrame(() => m.classList.add('is-open'));
    const f = m.querySelector('input:not([type=hidden]):not([type=radio]):not([readonly]), textarea, button[type=submit]');
    setTimeout(() => f && f.focus(), 60);
  }
  function closeModal(id) {
    const m = $(id);
    m.classList.remove('is-open');
    m.hidden = true;
    if (!document.querySelector('.inv-modal:not([hidden])')) document.body.classList.remove('inv-modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.querySelectorAll('.inv-modal').forEach((m) => {
    m.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => closeModal(m.id)));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = Array.from(document.querySelectorAll('.inv-modal:not([hidden])')).pop();
    if (open) closeModal(open.id);
    else closeMenu();
  });
  function showErr(id, msg) {
    const el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  // ---- Receber pagamento
  function payMode() {
    const r = document.querySelector('input[name="payMode"]:checked');
    return r ? r.value : 'full';
  }
  function payCents(n) {
    const x = Number(n);
    return Number.isFinite(x) ? Math.round(x * 100) : 0;
  }
  function payAmount() {
    const bal = payCents(inv && inv.remaining_amount) / 100;
    const mode = payMode();
    if (mode === 'full') return bal;
    if (mode === 'partial') {
      const pct = Number($('payPct') && $('payPct').value) || 0;
      if (!(pct > 0) || pct > 100) return 0;
      const totalC = payCents(inv && inv.amount);
      const raw = Math.round((totalC * pct) / 100);
      return Math.min(bal, raw / 100);
    }
    return payCents(parseFloat($('payAmount').value) || 0) / 100;
  }
  function payApiMode() {
    const bal = Number(inv && inv.remaining_amount) || 0;
    const amt = payAmount();
    return amt > 0 && Math.abs(bal - amt) < 0.005 ? 'full' : 'partial';
  }
  function syncPay() {
    const mode = payMode();
    const amt = payAmount();
    const total = Number(inv.amount) || 0;
    const paid = Number(inv.paid_amount) || 0;
    const bal = Number(inv.remaining_amount) || 0;
    const after = Math.max(0, Math.round((bal - amt) * 100) / 100);
    const settles = amt > 0 && Math.abs(bal - amt) < 0.005;
    const over = amt > bal + 0.004;
    const partialPreview = (() => {
      const pct = Number($('payPct') && $('payPct').value) || 0;
      if (!(pct > 0) || pct > 100) return 0;
      return Math.min(bal, Math.round((payCents(total) * pct) / 100) / 100);
    })();
    if ($('payFullAmount')) $('payFullAmount').textContent = money(bal);
    if ($('payPartialAmount')) $('payPartialAmount').textContent = money(partialPreview);
    if ($('payAmountHint')) $('payAmountHint').textContent = `Parcela livre, até ${money(bal)}`;
    if ($('payMathTotal')) $('payMathTotal').textContent = money(total);
    if ($('payMathPaid')) $('payMathPaid').textContent = money(paid);
    if ($('payMathNow')) $('payMathNow').textContent = money(amt);
    if ($('payMathAfter')) $('payMathAfter').textContent = money(over ? bal : after);
    const note = $('payMathNote');
    if (note) {
      note.className = 'inv-pay-math__note' + (over ? ' is-error' : '');
      note.textContent =
        mode === 'full'
          ? `Recebe ${money(bal)} e quita a fatura.`
          : !amt
            ? 'Escolha parcial, outro valor ou o pagamento total.'
            : over
              ? `Valor acima do saldo em aberto (${money(bal)}).`
              : settles
                ? 'Este valor quita a fatura — ela será marcada como paga.'
                : `Depois deste pagamento ainda ficam ${money(after)}.`;
    }
    if ($('payAfter')) $('payAfter').hidden = true;
    $('paySubmit').textContent = !amt
      ? 'Registrar pagamento'
      : settles || mode === 'full'
        ? `Receber ${money(amt)} e marcar como paga`
        : `Dar baixa de ${money(amt)}`;
    $('paySubmit').disabled = !amt || amt > bal + 0.004;
  }
  async function syncCashbackPayMethod() {
    const wrap = $('payMethodCashback');
    if (!wrap) return;
    wrap.hidden = true;
    const check = document.querySelector('input[name="payMethod"][value="check"]');
    if (check) check.checked = true;
    const clientId = inv && inv.client && inv.client.id;
    if (!clientId) return;
    try {
      const j = await api(`/api/customers/${encodeURIComponent(clientId)}/referral-balance`);
      const credit = Number(j.data && j.data.balance) || 0;
      if (!(credit > 0.004)) return;
      wrap.hidden = false;
      const span = wrap.querySelector('span');
      if (span) span.textContent = `Cashback indicação (${money(credit)})`;
      const radio = wrap.querySelector('input');
      if (radio) {
        radio.onchange = () => {
          if (!radio.checked) return;
          const use = Math.min(credit, inv.remaining_amount);
          const amountMode = document.querySelector('input[name="payMode"][value="amount"]');
          if (amountMode) amountMode.checked = true;
          $('payAmount').value = (Math.round(use * 100) / 100).toFixed(2);
          syncPay();
        };
      }
    } catch (_) {
      /* ignore — cashback optional */
    }
  }

  async function openPay(mode) {
    if (!inv || inv.remaining_amount <= 0) return;
    if (inv.status === 'draft') {
      toast('Envie a fatura ao cliente antes de registrar o pagamento.', 'info');
      openSend();
      return;
    }
    showErr('payError', '');
    $('payMeta').textContent = inv.invoice_number || '';
    $('payFullAmount').textContent = money(inv.remaining_amount);
    const picked = mode === 'partial' ? 'partial' : mode === 'amount' ? 'amount' : 'full';
    const pickedEl = document.querySelector(`input[name="payMode"][value="${picked}"]`);
    if (pickedEl) pickedEl.checked = true;
    $('payAmount').value = '';
    if ($('payPct') && !$('payPct').value) $('payPct').value = '50';
    $('payRef').value = '';
    $('payNotes').value = '';
    const email = inv.client && inv.client.email;
    $('paySendReceipt').checked = Boolean(email);
    $('paySendReceipt').disabled = !email;
    $('payReceiptTo').textContent = email ? `para ${email}` : '(cliente sem e-mail)';
    const previewBtn = $('btnPayPreviewEmail');
    if (previewBtn) {
      previewBtn.hidden = !email;
      previewBtn.disabled = !email;
    }
    await ensurePaymentDateSettings();
    const dueDay = dayLocal(inv.due_date);
    const preferDue = paymentDateDefault === 'due_date' && dueDay;
    setPayDateValue(preferDue ? dueDay : todayLocal());
    renderPayDateQuick();
    await syncCashbackPayMethod();
    syncPay();
    openModal('payModal');
    if (picked === 'amount') setTimeout(() => $('payAmount').focus(), 80);
  }
  document.querySelectorAll('input[name="payMode"]').forEach((r) =>
    r.addEventListener('change', () => {
      syncPay();
      if (payMode() === 'amount') $('payAmount').focus();
      if (payMode() === 'partial') $('payPct').focus();
    }),
  );
  ['payAmount', 'payPct'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const select = () => {
      const radio = el.closest('.inv-pay-opt')?.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      syncPay();
    };
    el.addEventListener('focus', select);
    el.addEventListener('input', select);
  });

  let pendingPayBody = null;

  function buildPayBody(emailTo) {
    const method = (document.querySelector('input[name="payMethod"]:checked') || {}).value || 'other';
    const body = {
      mode: payApiMode(),
      amount: payAmount(),
      payment_date: $('payDate').value,
      payment_method: method,
      reference_number: $('payRef').value.trim() || null,
      notes: $('payNotes').value.trim() || null,
      send_email: true,
    };
    if (emailTo) body.email_to = emailTo;
    return body;
  }

  async function fetchReceiptEmailPreview() {
    const amt = payAmount();
    if (!(amt > 0)) throw new Error('Informe o valor recebido.');
    if (!$('payDate').value) throw new Error('Informe a data do pagamento.');
    const method = (document.querySelector('input[name="payMethod"]:checked') || {}).value || 'other';
    return api(`/api/quote-invoices/${invoiceId}/receipt-email-preview`, {
      method: 'POST',
      body: JSON.stringify({
        mode: payApiMode(),
        amount: amt,
        payment_date: $('payDate').value,
        payment_method: method,
        email_to: (inv.client && inv.client.email) || null,
      }),
    });
  }

  function openReceiptEmailPreview(preview, payBody) {
    pendingPayBody = payBody;
    showErr('receiptEmailPreviewError', '');
    const meta = $('receiptEmailPreviewMeta');
    if (meta) {
      meta.innerHTML =
        `<div><strong>Cliente:</strong> ${esc(preview.client_name || '—')}</div>` +
        `<div><strong>Fatura:</strong> ${esc(preview.invoice_number || '')}</div>` +
        `<div><strong>Valor do recibo:</strong> ${money(preview.amount)}` +
        (preview.method_label ? ` · ${esc(preview.method_label)}` : '') +
        `</div>` +
        `<div><strong>Saldo após pagamento:</strong> ${money(preview.balance_after)}</div>`;
    }
    if ($('receiptEmailPreviewTo')) $('receiptEmailPreviewTo').value = preview.to || '';
    if ($('receiptEmailPreviewSubject')) $('receiptEmailPreviewSubject').value = preview.subject || '';
    const frame = $('receiptEmailPreviewFrame');
    if (frame) frame.srcdoc = preview.html || '<p>Sem pré-visualização.</p>';
    if ($('receiptEmailPreviewNote')) {
      $('receiptEmailPreviewNote').textContent =
        preview.note || 'O PDF do recibo será anexado no envio real.';
    }
    openModal('receiptEmailPreviewModal');
  }

  async function submitPayment(body) {
    const wasPaid = inv.display_status === 'paid';
    busy = true;
    const btn = $('paySubmit');
    const confirmBtn = $('btnReceiptEmailConfirm');
    const prev = btn.textContent;
    const prevConfirm = confirmBtn ? confirmBtn.textContent : '';
    btn.disabled = true;
    btn.textContent = 'Registrando…';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Registrando…';
    }
    try {
      const r = await api(`/api/quote-invoices/${invoiceId}/receipts`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      closeModal('receiptEmailPreviewModal');
      closeModal('payModal');
      pendingPayBody = null;
      inv = r.invoice;
      render();
      const parts = [`${r.data.receipt_number || 'Recibo'} · ${money(r.data.amount)} registrado.`];
      if (r.invoice_paid) parts.push('Fatura quitada.');
      if (r.email && r.email.ok) parts.push('Recibo enviado ao cliente.');
      toast(parts.join(' '));
      if (r.email && r.email.ok === false) toast(`Recibo criado, mas o e-mail falhou: ${r.email.error || 'erro'}`, 'error');
      if (r.invoice_paid && !wasPaid) {
        const s = $('invStamp');
        if (s) s.classList.add('is-landing');
      }
    } catch (err) {
      throw err;
    } finally {
      busy = false;
      btn.textContent = prev;
      syncPay();
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = prevConfirm || 'Registrar e enviar';
      }
    }
  }

  $('btnPayPreviewEmail')?.addEventListener('click', async () => {
    if (busy) return;
    showErr('payError', '');
    try {
      const preview = await fetchReceiptEmailPreview();
      openReceiptEmailPreview(preview, buildPayBody(preview.to));
    } catch (err) {
      showErr('payError', err.message);
    }
  });

  $('paySendReceipt')?.addEventListener('change', () => {
    const btn = $('btnPayPreviewEmail');
    if (!btn) return;
    const email = inv && inv.client && inv.client.email;
    btn.hidden = !email || !$('paySendReceipt').checked;
  });

  $('btnReceiptEmailConfirm')?.addEventListener('click', async () => {
    if (busy || !pendingPayBody) return;
    showErr('receiptEmailPreviewError', '');
    const to = String($('receiptEmailPreviewTo')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      showErr('receiptEmailPreviewError', 'Informe um e-mail válido.');
      return;
    }
    try {
      await submitPayment({ ...pendingPayBody, send_email: true, email_to: to });
    } catch (err) {
      showErr('receiptEmailPreviewError', err.message);
    }
  });

  $('payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const amt = payAmount();
    if (!(amt > 0)) return showErr('payError', 'Informe o valor recebido.');
    if (!$('payDate').value) return showErr('payError', 'Informe a data do pagamento.');
    showErr('payError', '');

    const send = !!$('paySendReceipt')?.checked;
    if (send) {
      try {
        const preview = await fetchReceiptEmailPreview();
        openReceiptEmailPreview(preview, buildPayBody(preview.to));
      } catch (err) {
        showErr('payError', err.message);
      }
      return;
    }

    try {
      const method = (document.querySelector('input[name="payMethod"]:checked') || {}).value || 'other';
      await submitPayment({
        mode: payApiMode(),
        amount: amt,
        payment_date: $('payDate').value,
        payment_method: method,
        reference_number: $('payRef').value.trim() || null,
        notes: $('payNotes').value.trim() || null,
        send_email: false,
      });
    } catch (err) {
      showErr('payError', err.message);
    }
  });

  async function sendReceipt(receiptId, btn) {
    const p = inv.payments.find((x) => x.id === receiptId);
    const to = inv.client && inv.client.email;
    if (!to) {
      toast('O cliente não tem e-mail cadastrado. Baixe o recibo e envie manualmente.', 'error');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando…';
    }
    try {
      await api(`/api/invoice-receipts/${receiptId}/send`, { method: 'POST', body: '{}' });
      toast(`${(p && p.receipt_number) || 'Recibo'} enviado para ${to}.`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Enviar';
      }
    }
  }

  function confirmBox({ title, text, ok, danger, extraHtml }) {
    return new Promise((resolve) => {
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text || '';
      $('confirmExtra').innerHTML = extraHtml || '';
      $('confirmExtra').hidden = !extraHtml;
      const okBtn = $('confirmOk');
      okBtn.textContent = ok || 'Confirmar';
      okBtn.className = `inv-btn ${danger === false ? 'inv-btn--primary' : 'inv-btn--danger'}`;
      const modal = $('confirmModal');
      const done = (v) => {
        okBtn.removeEventListener('click', onOk);
        modal.querySelectorAll('[data-close]').forEach((el) => el.removeEventListener('click', onCancel));
        closeModal('confirmModal');
        resolve(v);
      };
      const onOk = () => done({ ok: true, extra: $('confirmExtra') });
      const onCancel = () => done(null);
      okBtn.addEventListener('click', onOk);
      modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', onCancel));
      openModal('confirmModal');
    });
  }

  async function removePayment(receiptId) {
    const p = inv.payments.find((x) => x.id === receiptId);
    if (!p) return;
    const c = await confirmBox({
      title: `Remover pagamento de ${money(p.amount)}?`,
      text: `${p.receipt_number || 'O recibo'} deixa de valer e o saldo volta para ${money(inv.remaining_amount + p.amount)}. Use quando o pagamento foi lançado por engano ou o cheque voltou.`,
      ok: 'Remover pagamento',
    });
    if (!c) return;
    try {
      const r = await api(`/api/quote-invoices/${invoiceId}/receipts/${receiptId}`, { method: 'DELETE' });
      inv = r.invoice;
      render();
      toast('Pagamento removido.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---- Enviar
  async function ensureLink() {
    if (inv.public_url) return inv.public_url;
    const r = await api(`/api/quote-invoices/${invoiceId}/public-link`, { method: 'POST', body: '{}' });
    return r.public_url;
  }
  const INV_EMAIL_DEFAULTS = {
    partial:
      'Here is invoice [invoice_number] for a partial payment of [balance].\n\nDue: [due_date]\n\nView and pay:\n[link]',
    balance:
      'Here is invoice [invoice_number] for the remaining balance of [balance].\n\nDue: [due_date]\n\nView and pay:\n[link]',
    full: 'Here is invoice [invoice_number] for [amount].\n\nBalance due: [balance]\nDue: [due_date]\n\nView and pay:\n[link]',
  };

  function sendTemplateRaw() {
    const saved = (inv && inv.share_email) || {};
    const t = String((inv && inv.invoice_type) || '').toLowerCase();
    if (t === 'final') return saved.balance || INV_EMAIL_DEFAULTS.balance;
    if (t === 'deposit' || t === 'progress' || t === 'custom' || t === 'other') return saved.partial || INV_EMAIL_DEFAULTS.partial;
    return saved.full || INV_EMAIL_DEFAULTS.full;
  }

  function fillSendMessage(link) {
    const org = (inv && inv.organization) || {};
    $('sendMsg').value = applyInvoiceShareTemplate(sendTemplateRaw(), {
      name: clientFirstName(),
      company: org.name || '',
      invoice_number: inv.invoice_number || '',
      amount: money(inv.amount),
      balance: money(inv.remaining_amount),
      paid: money(inv.paid_amount),
      due_date: fdate(inv.due_date) === '—' ? '' : fdate(inv.due_date),
      link: link || '',
    });
  }

  function setSendLinkStatus(text) {
    const el = $('sendLinkStatus');
    if (el) el.textContent = text;
  }

  function openSend() {
    showErr('sendError', '');
    $('sendTo').value = (inv.client && inv.client.email) || inv.sent_to || '';
    $('sendLink').value = inv.public_url || '';
    $('sendLink').placeholder = inv.public_url ? '' : 'Gerando link…';
    setSendLinkStatus(inv.public_url ? 'Link pronto.' : 'Gerando link…');
    fillSendMessage(inv.public_url || '');
    $('btnMarkSent').hidden = inv.status !== 'draft';
    $('sendSubmit').textContent = inv.sent_to || inv.email_sent_at ? 'Reenviar e-mail' : 'Enviar e-mail';
    updateSms();
    openModal('sendModal');
    ensureLink()
      .then((url) => {
        $('sendLink').value = url;
        $('sendLink').placeholder = '';
        if (inv) inv.public_url = url;
        setSendLinkStatus('Link pronto.');
        fillSendMessage(url);
        updateSms();
      })
      .catch((err) => {
        setSendLinkStatus('Não foi possível gerar o link.');
        showErr('sendError', err.message || 'Não foi possível gerar o link.');
      });
  }
  const INV_SMS_DEFAULT =
    'Hi [name], your invoice [invoice_number] is ready.\n\nBalance due: [balance]\nDue: [due_date]\n\nView & pay here:\n[link]\n\nThank you!';

  function applyInvoiceShareTemplate(tpl, vars) {
    let out = String(tpl || '');
    const map = {
      name: String(vars.name || '').trim() || 'there',
      company: String(vars.company || '').trim(),
      invoice_number: String(vars.invoice_number || '').trim(),
      amount: String(vars.amount || '').trim(),
      balance: String(vars.balance || '').trim(),
      paid: String(vars.paid || '').trim(),
      due_date: String(vars.due_date || '').trim(),
      link: String(vars.link || '').trim(),
    };
    out = out.replace(/\[name\]/gi, map.name);
    out = out.replace(/\[company\]/gi, map.company);
    out = out.replace(/\[invoice_number\]/gi, map.invoice_number);
    out = out.replace(/\[amount\]/gi, map.amount);
    out = out.replace(/\[balance\]/gi, map.balance);
    out = out.replace(/\[paid\]/gi, map.paid);
    out = out.replace(/\[due_date\]/gi, map.due_date);
    out = out.replace(/\[link\]/gi, map.link);
    out = out.replace(/\(\s*\)/g, '');
    out = out.replace(/[ \t]{2,}/g, ' ');
    out = out.replace(/[ \t]+\n/g, '\n');
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.trim();
  }

  function clientFirstName() {
    const full = (inv.client && inv.client.name) || '';
    const first = String(full).trim().split(/\s+/)[0];
    return first || '';
  }

  function buildInvoiceSmsBody(link) {
    const tpl = (inv && inv.share_sms_body) || INV_SMS_DEFAULT;
    const org = (inv && inv.organization) || {};
    return applyInvoiceShareTemplate(tpl, {
      name: clientFirstName(),
      company: org.name || '',
      invoice_number: inv.invoice_number || '',
      amount: money(inv.amount),
      balance: money(inv.remaining_amount),
      due_date: fdate(inv.due_date),
      link: link || '',
    });
  }

  function updateSms() {
    const link = $('sendLink').value;
    const phone = (inv.client && inv.client.phone) || '';
    const body = buildInvoiceSmsBody(link);
    $('btnSms').href = link ? `sms:${phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}` : '#';
    $('btnSms').classList.toggle('is-disabled', !link);
  }
  $('btnCopyLink').addEventListener('click', async () => {
    try {
      const url = await ensureLink();
      $('sendLink').value = url;
      updateSms();
      await navigator.clipboard.writeText(url).catch(() => {
        $('sendLink').select();
        document.execCommand('copy');
      });
      toast('Link copiado.');
      await load();
    } catch (err) {
      showErr('sendError', err.message);
    }
  });
  $('btnSms').addEventListener('click', async (e) => {
    if ($('sendLink').value) return;
    e.preventDefault();
    try {
      $('sendLink').value = await ensureLink();
      updateSms();
      location.href = $('btnSms').href;
      load();
    } catch (err) {
      showErr('sendError', err.message);
    }
  });
  $('sendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = $('sendTo').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return showErr('sendError', 'Informe um e-mail válido.');
    const btn = $('sendSubmit');
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const r = await api(`/api/quote-invoices/${invoiceId}/send-email`, {
        method: 'POST',
        body: JSON.stringify({ to, message: $('sendMsg').value.trim() || null }),
      });
      inv = r.data;
      render();
      closeModal('sendModal');
      toast(`Fatura enviada para ${to}. Quando o pagamento entrar, use Receber pagamento para dar baixa.`);
    } catch (err) {
      showErr('sendError', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
  async function markSent() {
    try {
      const r = await api(`/api/quote-invoices/${invoiceId}/send-email`, { method: 'POST', body: JSON.stringify({ mark_only: true }) });
      inv = r.data;
      render();
      closeModal('sendModal');
      toast('Marcada como enviada. Quando o pagamento entrar, use Receber pagamento para dar baixa.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  $('btnMarkSent').addEventListener('click', markSent);

  // ---- Editar
  function openEdit() {
    showErr('editError', '');
    $('editDue').value = inv.due_date ? isoDay(inv.due_date) : '';
    $('editAmount').value = Number(inv.amount).toFixed(2);
    const locked = inv.payments.length > 0;
    const src = inv.quote || inv.job;
    const max = src ? src.remaining_to_invoice + inv.amount : null;
    // Job invoices listing every service are changed through the job's services.
    const itemizedJob = !inv.quote && inv.job && inv.line_items.length > 1;
    $('editAmount').disabled = locked || itemizedJob;
    $('editAmountHint').textContent = locked
      ? 'Valor bloqueado: a fatura já tem pagamentos.'
      : itemizedJob
        ? 'Valor vem dos serviços do job — ajuste os serviços no job.'
        : max != null
          ? `Máximo ${money(max)} (o que falta faturar do ${inv.quote ? 'orçamento' : 'job'}).`
          : '';
    const single = inv.line_items.length === 1;
    $('editLine').value = single ? inv.line_items[0].description : '';
    $('editLine').closest('.inv-field').hidden = !single;
    $('editInstructions').value = inv.payment_instructions || '';
    $('editNotes').value = inv.notes || '';
    openModal('editModal');
  }
  $('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      due_date: $('editDue').value || null,
      payment_instructions: $('editInstructions').value,
      notes: $('editNotes').value,
    };
    if (!$('editAmount').disabled) {
      const a = parseFloat($('editAmount').value);
      if (!(a > 0)) return showErr('editError', 'Valor inválido.');
      body.amount = a;
    }
    if (!$('editLine').closest('.inv-field').hidden) body.line_description = $('editLine').value;
    const btn = $('editSubmit');
    btn.disabled = true;
    try {
      const r = await api(`/api/quote-invoices/${invoiceId}`, { method: 'PATCH', body: JSON.stringify(body) });
      inv = r.data;
      render();
      closeModal('editModal');
      toast('Fatura atualizada.');
    } catch (err) {
      showErr('editError', err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Anular / apagar
  async function voidInvoice() {
    const c = await confirmBox({
      title: `Cancel Invoice ${inv.invoice_number}?`,
      text: 'A fatura deixa de ser cobrada, sai dos totais em aberto e o link do cliente é desativado. O número fica reservado no histórico.',
      ok: 'Cancel Invoice',
      extraHtml: '<label class="inv-field"><span>Motivo <em>opcional</em></span><input type="text" id="voidReason" maxlength="300" /></label>',
    });
    if (!c) return;
    try {
      await api(`/api/quote-invoices/${invoiceId}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: (document.getElementById('voidReason') || {}).value || '' }),
      });
      toast('Invoice cancelada.');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function deleteInvoice() {
    const c = await confirmBox({
      title: `Apagar ${inv.invoice_number}?`,
      text: 'O rascunho será removido definitivamente. O valor volta a ficar disponível para faturar no orçamento.',
      ok: 'Apagar',
    });
    if (!c) return;
    try {
      const r = await api(`/api/quote-invoices/${invoiceId}`, { method: 'DELETE' });
      toast('Fatura apagada.');
      if (EMBED) {
        window.dispatchEvent(new CustomEvent('invoice:deleted', { detail: { id: invoiceId } }));
        invoiceId = null;
        inv = null;
      } else location.href = 'invoices.html';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function closeMenu() {}
  $('btnEdit')?.addEventListener('click', () => openEdit());
  $('btnDeleteInvoice')?.addEventListener('click', () => {
    if ($('btnDeleteInvoice').dataset.mode === 'delete') deleteInvoice();
    else voidInvoice();
  });

  // ---- PDF
  function openPdf(url, title, filename) {
    if (window.crmPdfViewer && window.crmPdfViewer.openFromUrl) {
      window.crmPdfViewer.openFromUrl(url, { title, filename }).catch(() => window.open(url, '_blank', 'noopener'));
    } else window.open(url, '_blank', 'noopener');
  }
  $('btnPdf').addEventListener('click', () =>
    openPdf(`/api/quote-invoices/${invoiceId}/pdf`, inv ? `Fatura ${inv.invoice_number}` : 'Fatura', `${(inv && inv.invoice_number) || 'invoice'}.pdf`),
  );
  $('btnReceiveMobile').addEventListener('click', () => openPay('full'));
  $('btnAddPayment').addEventListener('click', () => openPay('partial'));
  $('btnSendMobile').addEventListener('click', openSend);

  // ---------------------------------------------------------------- boot
  async function load() {
    const r = await api(`/api/quote-invoices/${encodeURIComponent(invoiceId)}`);
    inv = r.data;
    render();
  }

  function showLoading() {
    $('invPage').setAttribute('aria-busy', 'true');
    $('invPaper').innerHTML = '<div class="inv-skel" style="height:420px"></div>';
    $('invSummary').innerHTML = '<div class="inv-skel" style="height:150px"></div>';
    $('invActions').hidden = false;
  }
  function showError(err) {
    $('invPage').setAttribute('aria-busy', 'false');
    $('invPaper').innerHTML = `<div class="inv-empty inv-empty--big"><b>Não foi possível abrir a fatura.</b><p>${esc(err.message)}</p></div>`;
    $('invSummary').innerHTML = '';
    $('invActions').hidden = true;
    $('invMobileBar').hidden = true;
  }
  let openSeq = 0;
  async function open(id) {
    const seq = ++openSeq;
    invoiceId = id;
    inv = null;
    showLoading();
    try {
      const r = await api(`/api/quote-invoices/${encodeURIComponent(id)}`);
      if (seq !== openSeq) return;
      inv = r.data;
      render();
    } catch (err) {
      if (seq === openSeq) showError(err);
    }
  }
  window.InvoicePage = { open, current: () => inv };

  async function boot() {
    if (!invoiceId) {
      if (!EMBED) location.replace('invoices.html');
      return;
    }
    try {
      await load();
      const act = params.get('action');
      if (act === 'pay' && inv.can.record_payment) openPay(params.get('mode') === 'partial' ? 'partial' : 'full');
      else if (act === 'send' && inv.can.manage) openSend();
      if (params.get('new') === '1') {
        const justIssued = inv.status === 'sent' || inv.display_status === 'sent';
        toast(
          justIssued
            ? `${inv.invoice_number} faturada. Pode enviar o e-mail ao cliente ou receber pagamento.`
            : `${inv.invoice_number} criada. Envie ao cliente quando estiver pronta.`,
          'info',
        );
      }
      if (act || params.get('new')) history.replaceState(null, '', `${EMBED ? 'invoices' : 'invoice'}.html?id=${encodeURIComponent(invoiceId)}`);
    } catch (err) {
      showError(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
