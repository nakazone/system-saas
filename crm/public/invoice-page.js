/* Fatura — detail page (invoice.html?id=…). Payments, receipts, send, PAID stamp. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const invoiceId = params.get('id');
  let inv = null;
  let busy = false;

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
    void: { label: 'Anulada', cls: 'is-void' },
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
    // Receive payment only after the invoice left draft — sending ≠ paid.
    const canPay = inv.can.record_payment && open && !isDraft;
    const canSend = inv.can.manage && inv.status !== 'void';
    $('btnReceive').hidden = !canPay;
    $('btnReceiveMobile').hidden = !canPay;
    $('btnAddPayment').hidden = !canPay;
    $('btnSend').hidden = !canSend;
    $('btnSendMobile').hidden = !canSend;
    $('btnSendLabel').textContent = isDraft ? 'Enviar' : 'Reenviar';
    $('btnSendMobile').textContent = isDraft ? 'Enviar' : 'Reenviar';
    // Draft: Enviar is the primary action. After send: Receber pagamento is primary.
    $('btnSend').className = isDraft ? 'inv-btn inv-btn--primary' : 'inv-btn inv-btn--secondary';
    $('btnReceive').className = isDraft ? 'inv-btn inv-btn--secondary' : 'inv-btn inv-btn--primary';
    $('btnSendMobile').className = isDraft ? 'inv-btn inv-btn--primary' : 'inv-btn inv-btn--secondary';
    $('btnReceiveMobile').className = isDraft ? 'inv-btn inv-btn--secondary' : 'inv-btn inv-btn--primary';
    $('invMobileBar').hidden = !canPay && !canSend;

    const menu = $('moreMenu');
    const show = (act, on) => {
      const el = menu.querySelector(`[data-act="${act}"]`);
      if (el) el.hidden = !on;
    };
    show('edit', inv.can.manage && inv.status !== 'void');
    show('copy-link', inv.can.manage && inv.status !== 'void');
    show('mark-sent', inv.can.manage && inv.status === 'draft');
    show('void', inv.can.manage && inv.status !== 'void' && inv.payments.length === 0 && inv.status !== 'draft');
    show('delete', inv.can.manage && (inv.status === 'draft' || inv.status === 'void') && inv.payments.length === 0);
    const ql = $('menuQuoteLink');
    ql.hidden = !inv.quote;
    if (inv.quote) ql.href = `quote-builder.html?id=${encodeURIComponent(inv.quote.id)}`;

    renderSteps();
    renderBanner();
    renderPaper();
    renderSummary();
    renderPayments();
    renderQuote();
    renderActivity();
    $('invPage').setAttribute('aria-busy', 'false');
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
      $('invSteps').innerHTML = `<li class="inv-step is-void"><span class="inv-step__dot"></span><span><b>Anulada</b><small>${esc(fdate(inv.voided_at))}</small></span></li>`;
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
    if (inv.status === 'void') html = '<b>Fatura anulada.</b> Não é mais cobrada e o link do cliente foi desativado.';
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
    if (inv.status === 'void') return '<div class="inv-stamp inv-stamp--void" aria-label="Anulada"><b>ANULADA</b></div>';
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
          ${c.phone ? `<p class="inv-paper__muted">${esc(c.phone)}</p>` : ''}
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
        <div><span>Total</span><span>${money(inv.amount)}</span></div>
        ${inv.payments
          .map(
            (p) => `<div class="inv-totals__pay"><span>Pagamento ${esc(fdate(p.paid_at, { year: undefined }))} · ${esc(p.method_label)}</span><span>–${money(p.amount)}</span></div>`,
          )
          .join('')}
        <div class="inv-totals__due"><span>Saldo devedor</span><span>${money(inv.remaining_amount)}</span></div>
      </div>
      </div>
      ${inv.payment_instructions && inv.remaining_amount > 0 ? `<div class="inv-paper__block"><p class="inv-label">Como pagar</p><p>${esc(inv.payment_instructions)}</p></div>` : ''}
      ${inv.notes ? `<div class="inv-paper__block"><p class="inv-label">Nota</p><p>${esc(inv.notes)}</p></div>` : ''}
    `;
  }

  function renderSummary() {
    const due = dateObj(inv.due_date);
    let dueTxt = '';
    if (inv.status === 'void') dueTxt = 'Anulada';
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
      ${inv.can.record_payment && inv.remaining_amount > 0.004 && inv.status !== 'void' && inv.status !== 'draft' ? `
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
    $('invQuote').innerHTML = `
      <a class="inv-quote-link" href="${esc(href)}">
        <span><b>${esc(q.number || 'Orçamento')}</b><small>${esc(q.title || '')}</small></span>
        <span>${money(q.total)}</span>
      </a>
      <div class="inv-progress inv-progress--thin"><span style="width:${pct}%"></span></div>
      <p class="inv-muted">Faturado ${money(q.invoiced_total)} de ${money(q.total)}${q.remaining_to_invoice > 0 ? ` · falta faturar ${money(q.remaining_to_invoice)}` : ' · totalmente faturado'}</p>
      ${inv.sibling_invoices.length ? `<ul class="inv-siblings">${inv.sibling_invoices
        .map(
          (s) => `<li><a href="invoice.html?id=${encodeURIComponent(s.id)}">${esc(s.invoice_number || 'Fatura')}</a><span>${esc(s.invoice_type_label)}</span><span>${money(s.amount)}</span><span class="inv-dot ${esc((STATUS[s.status] || STATUS.sent).cls)}" title="${esc((STATUS[s.status] || STATUS.sent).label)}"></span></li>`,
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
  function payAmount() {
    if (payMode() === 'full') return inv.remaining_amount;
    return Math.round((parseFloat($('payAmount').value) || 0) * 100) / 100;
  }
  function syncPay() {
    const full = payMode() === 'full';
    $('payFullBox').hidden = !full;
    $('payPartialBox').hidden = full;
    const amt = payAmount();
    const bal = inv.remaining_amount;
    const after = Math.max(0, Math.round((bal - amt) * 100) / 100);
    const settles = amt > 0 && Math.abs(bal - amt) < 0.005;
    if (!full) {
      const over = amt > bal + 0.004;
      $('payAfter').className = 'inv-after' + (over ? ' is-error' : settles ? ' is-settle' : '');
      $('payAfter').textContent = !amt
        ? `Saldo atual ${money(bal)}.`
        : over
          ? `Valor acima do saldo em aberto (${money(bal)}).`
          : settles
            ? 'Este valor quita a fatura — ela será carimbada como PAGA.'
            : `Saldo após este pagamento: ${money(after)}.`;
    }
    $('paySubmit').textContent = !amt
      ? 'Registrar pagamento'
      : settles || full
        ? `Receber ${money(amt)} e marcar como paga`
        : `Dar baixa de ${money(amt)}`;
    $('paySubmit').disabled = !amt || amt > bal + 0.004;
  }
  function openPay(mode) {
    if (!inv || inv.remaining_amount <= 0) return;
    if (inv.status === 'draft') {
      toast('Envie a fatura ao cliente antes de registrar o pagamento.', 'info');
      openSend();
      return;
    }
    showErr('payError', '');
    $('payMeta').textContent = `${inv.invoice_number} · total ${money(inv.amount)} · pago ${money(inv.paid_amount)} · saldo ${money(inv.remaining_amount)}`;
    $('payFullAmount').textContent = money(inv.remaining_amount);
    document.querySelector(`input[name="payMode"][value="${mode === 'partial' ? 'partial' : 'full'}"]`).checked = true;
    $('payAmount').value = '';
    $('payDate').value = todayLocal();
    $('payDate').max = todayLocal();
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
    const bal = inv.remaining_amount;
    const quick = [
      { label: '25%', v: bal * 0.25 },
      { label: '50%', v: bal * 0.5 },
      { label: 'Saldo total', v: bal },
    ];
    $('payQuick').innerHTML = quick
      .map((q) => `<button type="button" class="inv-chip-btn" data-v="${(Math.round(q.v * 100) / 100).toFixed(2)}">${q.label} <small>${money(q.v)}</small></button>`)
      .join('');
    $('payQuick').querySelectorAll('[data-v]').forEach((b) =>
      b.addEventListener('click', () => {
        $('payAmount').value = b.dataset.v;
        syncPay();
      }),
    );
    syncPay();
    openModal('payModal');
    if (mode === 'partial') setTimeout(() => $('payAmount').focus(), 80);
  }
  document.querySelectorAll('input[name="payMode"]').forEach((r) =>
    r.addEventListener('change', () => {
      syncPay();
      if (payMode() === 'partial') $('payAmount').focus();
    }),
  );
  $('payAmount').addEventListener('input', syncPay);

  let pendingPayBody = null;

  function buildPayBody(emailTo) {
    const method = (document.querySelector('input[name="payMethod"]:checked') || {}).value || 'other';
    const body = {
      mode: payMode(),
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
        mode: payMode(),
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
        mode: payMode(),
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
  function openSend() {
    showErr('sendError', '');
    $('sendTo').value = (inv.client && inv.client.email) || inv.sent_to || '';
    $('sendMsg').value = '';
    $('sendLink').value = inv.public_url || '';
    $('btnMarkSent').hidden = inv.status !== 'draft';
    $('sendSubmit').textContent = inv.status === 'draft' ? 'Enviar e-mail' : 'Reenviar e-mail';
    updateSms();
    openModal('sendModal');
  }
  function updateSms() {
    const link = $('sendLink').value;
    const phone = (inv.client && inv.client.phone) || '';
    const body = `${inv.invoice_number}: ${money(inv.remaining_amount)} due ${fdate(inv.due_date)}. ${link}`;
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
      title: `Anular ${inv.invoice_number}?`,
      text: 'A fatura deixa de ser cobrada, sai dos totais em aberto e o link do cliente é desativado. O número fica reservado no histórico.',
      ok: 'Anular fatura',
      extraHtml: '<label class="inv-field"><span>Motivo <em>opcional</em></span><input type="text" id="voidReason" maxlength="300" /></label>',
    });
    if (!c) return;
    try {
      await api(`/api/quote-invoices/${invoiceId}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: (document.getElementById('voidReason') || {}).value || '' }),
      });
      toast('Fatura anulada.');
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
      location.href = 'invoices.html';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---- More menu
  function closeMenu() {
    $('moreMenu').hidden = true;
    $('btnMore').setAttribute('aria-expanded', 'false');
  }
  $('btnMore').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = $('moreMenu');
    m.hidden = !m.hidden;
    $('btnMore').setAttribute('aria-expanded', String(!m.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.inv-more')) closeMenu();
  });
  $('moreMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeMenu();
    const act = b.dataset.act;
    if (act === 'edit') openEdit();
    else if (act === 'copy-link') {
      try {
        const url = await ensureLink();
        await navigator.clipboard.writeText(url);
        toast('Link do cliente copiado.');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (act === 'mark-sent') markSent();
    else if (act === 'void') voidInvoice();
    else if (act === 'delete') deleteInvoice();
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
  $('btnReceive').addEventListener('click', () => openPay('full'));
  $('btnReceiveMobile').addEventListener('click', () => openPay('full'));
  $('btnAddPayment').addEventListener('click', () => openPay('partial'));
  $('btnSend').addEventListener('click', openSend);
  $('btnSendMobile').addEventListener('click', openSend);

  // ---------------------------------------------------------------- boot
  async function load() {
    const r = await api(`/api/quote-invoices/${encodeURIComponent(invoiceId)}`);
    inv = r.data;
    render();
  }

  async function boot() {
    if (!invoiceId) {
      location.replace('invoices.html');
      return;
    }
    try {
      await load();
      const act = params.get('action');
      if (act === 'pay' && inv.can.record_payment) openPay(params.get('mode') === 'partial' ? 'partial' : 'full');
      else if (act === 'send' && inv.can.manage) openSend();
      if (params.get('new') === '1') toast(`${inv.invoice_number} criada. Envie ao cliente quando estiver pronta.`, 'info');
      if (act || params.get('new')) history.replaceState(null, '', `invoice.html?id=${encodeURIComponent(invoiceId)}`);
    } catch (err) {
      $('invPage').setAttribute('aria-busy', 'false');
      $('invPaper').innerHTML = `<div class="inv-empty inv-empty--big"><b>Não foi possível abrir a fatura.</b><p>${esc(err.message)}</p><a class="inv-btn inv-btn--secondary" href="invoices.html">Voltar para Faturas</a></div>`;
      $('invSummary').innerHTML = '';
      $('invActions').hidden = true;
      $('invMobileBar').hidden = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
