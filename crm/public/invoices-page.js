/* Faturas — list page (invoices.html). Opens each invoice in invoice.html. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LIMIT = 25;
  const url = new URLSearchParams(location.search);
  let page = 1;
  let tab = url.get('status') || 'all';
  let perms = [];
  let isAdmin = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n, dec) {
    const d = dec == null ? 2 : dec;
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fdate(d) {
    if (!d) return '—';
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return '—';
    return x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function toast(msg, type) {
    if (window.crmToast) window.crmToast[type === 'error' ? 'error' : 'success'](msg);
  }
  async function api(u, opts) {
    const r = await fetch(u, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      location.href = '/login.html';
      throw new Error('Sessão expirada');
    }
    if (!r.ok || j.success === false) throw new Error(j.error || `Erro ${r.status}`);
    return j;
  }
  const can = (p) => isAdmin || perms.includes(p);

  const STATUS = {
    draft: ['Rascunho', 'is-draft'],
    sent: ['Enviada', 'is-sent'],
    viewed: ['Vista', 'is-viewed'],
    partially_paid: ['Parcial', 'is-partial'],
    overdue: ['Vencida', 'is-overdue'],
    paid: ['Paga', 'is-paid'],
    void: ['Anulada', 'is-void'],
  };

  // ---------------------------------------------------------------- list
  function setTab(t) {
    tab = t;
    page = 1;
    document.querySelectorAll('.inv-tab').forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.inv-kpi').forEach((k) => k.classList.toggle('is-active', k.dataset.tab === t));
    const u = new URL(location.href);
    if (t === 'all') u.searchParams.delete('status');
    else u.searchParams.set('status', t);
    history.replaceState(null, '', u);
    load();
  }

  function renderSummary(s) {
    if (!s) return;
    $('kpiOutstanding').textContent = money(s.outstanding, 0);
    $('kpiOutstandingN').textContent = `${s.count.unpaid} ${s.count.unpaid === 1 ? 'fatura' : 'faturas'}`;
    $('kpiOverdue').textContent = money(s.overdue_amount, 0);
    $('kpiOverdueN').textContent = s.count.overdue ? `${s.count.overdue} ${s.count.overdue === 1 ? 'vencida' : 'vencidas'}` : 'nenhuma vencida';
    $('kpiReceived').textContent = money(s.received_30d, 0);
    $('kpiDraft').textContent = String(s.count.draft);
    $('kpiDraftN').textContent = s.count.draft ? `${money(s.draft_amount, 0)} a enviar` : 'nada pendente';
    document.querySelectorAll('[data-count]').forEach((el) => {
      const n = s.count[el.dataset.count];
      el.textContent = n ? String(n) : '';
      el.hidden = !n;
    });
    $('invListSub').textContent = s.count.all
      ? `${s.count.all} ${s.count.all === 1 ? 'fatura' : 'faturas'} · ${money(s.outstanding)} a receber`
      : 'Cobranças emitidas a partir dos orçamentos aprovados.';
  }

  function dueCell(inv) {
    if (inv.display_status === 'paid') return `<span class="inv-trow__due">Paga ${esc(fdate(inv.paid_at))}</span>`;
    if (inv.display_status === 'void') return '<span class="inv-trow__due">—</span>';
    if (inv.display_status === 'overdue')
      return `<span class="inv-trow__due is-overdue">${esc(fdate(inv.due_date))}<br><small>há ${inv.days_overdue} ${inv.days_overdue === 1 ? 'dia' : 'dias'}</small></span>`;
    return `<span class="inv-trow__due">${esc(fdate(inv.due_date))}</span>`;
  }

  function renderRows(rows) {
    const host = $('invRows');
    if (!rows.length) {
      const q = $('filterQ').value.trim();
      host.innerHTML = `<div class="inv-table-empty"><b>${q ? 'Nada encontrado' : tab === 'all' ? 'Nenhuma fatura ainda' : 'Nenhuma fatura neste filtro'}</b>${
        q ? 'Tente outro termo.' : tab === 'all' ? 'Emita a primeira a partir de um orçamento aprovado.' : ''
      }</div>`;
      return;
    }
    host.innerHTML = rows
      .map((inv) => {
        const [label, cls] = STATUS[inv.display_status] || STATUS.sent;
        const open = inv.display_status !== 'paid' && inv.display_status !== 'void';
        return `<a class="inv-trow" role="row" href="invoice.html?id=${encodeURIComponent(inv.id)}">
          <span class="inv-trow__who" role="cell"><b>${esc(inv.customer_name || inv.quote_title || inv.job_title || '—')}</b><small>${esc(inv.quote_title || inv.job_title || '')}</small></span>
          <span class="inv-trow__num" role="cell">${esc(inv.invoice_number || '—')}<small>${esc(inv.invoice_type_label)}${inv.source_ref ? ` · ${esc(inv.source_ref)}` : ''}</small></span>
          <span class="inv-trow__pay" role="cell">${money(inv.paid_amount)} de ${money(inv.amount)}<div class="inv-progress"><span style="width:${inv.percent_paid}%"></span></div></span>
          ${dueCell(inv)}
          <span class="inv-trow__st" role="cell"><span class="inv-chip ${cls}">${esc(label)}</span></span>
          <span class="inv-trow__amt" role="cell"><b>${money(open ? inv.remaining_amount : inv.amount)}</b><small>${open && inv.paid_amount > 0 ? `de ${money(inv.amount)}` : open ? 'a receber' : inv.display_status === 'paid' ? 'recebido' : ''}</small></span>
        </a>`;
      })
      .join('');
  }

  let reqSeq = 0;
  async function load() {
    const seq = ++reqSeq;
    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT), status: tab });
    const q = $('filterQ').value.trim();
    if (q) p.set('q', q);
    try {
      const j = await api(`/api/invoices?${p}`);
      if (seq !== reqSeq) return;
      renderRows(j.data || []);
      renderSummary(j.summary);
      const pages = Math.max(1, Math.ceil((j.total || 0) / LIMIT));
      $('pageInfo').textContent = j.total ? `Página ${page} de ${pages} · ${j.total} ${j.total === 1 ? 'fatura' : 'faturas'}` : '';
      $('btnPrevPage').disabled = page <= 1;
      $('btnNextPage').disabled = page >= pages;
      $('btnPrevPage').parentElement.hidden = pages <= 1;
    } catch (err) {
      $('invRows').innerHTML = `<div class="inv-table-empty"><b>Não foi possível carregar</b>${esc(err.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------- new invoice
  let picked = null;
  let billable = [];
  function openNew() {
    picked = null;
    $('newQ').value = '';
    $('newKindBox').hidden = true;
    $('newSubmit').disabled = true;
    $('newError').hidden = true;
    const d = new Date(Date.now() + 14 * 86400000);
    $('newDue').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const m = $('newModal');
    m.hidden = false;
    document.body.classList.add('inv-modal-open');
    requestAnimationFrame(() => m.classList.add('is-open'));
    setTimeout(() => $('newQ').focus(), 60);
    loadBillable();
  }
  function closeNew() {
    const m = $('newModal');
    m.classList.remove('is-open');
    m.hidden = true;
    document.body.classList.remove('inv-modal-open');
  }
  $('newModal').querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeNew));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('newModal').hidden) closeNew();
  });

  async function loadBillable() {
    const q = $('newQ').value.trim();
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      // Jobs (fixed table prices, no quote) first — that is the day-to-day billing for builders/lojas.
      const [jobs, quotes] = await Promise.all([
        api(`/api/invoices/billable-jobs${qs}`).catch(() => ({ data: [] })),
        api(`/api/invoices/billable-quotes${qs}`),
      ]);
      billable = [
        ...(jobs.data || []).map((j) => ({
          ...j,
          kind: 'job',
          key: `job:${j.id}`,
          ref: j.number != null ? `Job #${j.number}` : 'Job',
        })),
        ...(quotes.data || []).map((x) => ({ ...x, kind: 'quote', key: `quote:${x.id}`, ref: x.number || '' })),
      ];
      renderPick();
    } catch (err) {
      $('newPick').innerHTML = `<p class="inv-empty">${esc(err.message)}</p>`;
    }
  }
  function renderPick() {
    if (!billable.length) {
      $('newPick').innerHTML =
        '<p class="inv-empty">Nada para faturar. Adicione os serviços a um job em <a href="jobs.html">Jobs</a> ou aprove um orçamento em <a href="quotes.html">Orçamentos</a>.</p>';
      return;
    }
    const item = (q) => `<button type="button" data-id="${esc(q.key)}" class="${picked && picked.key === q.key ? 'is-selected' : ''}">
          <b>${esc(q.customer_name || q.title)}</b><span class="r"><b>${money(q.remaining_to_invoice)}</b></span>
          <small>${esc(q.ref)} · ${esc(q.title)}${q.kind === 'job' && q.status === 'completed' ? ' · concluído' : ''}</small><small class="r">${q.invoiced_total > 0 ? `de ${money(q.total)}` : 'a faturar'}</small>
        </button>`;
    const jobs = billable.filter((x) => x.kind === 'job');
    const quotes = billable.filter((x) => x.kind === 'quote');
    $('newPick').innerHTML =
      (jobs.length ? `<p class="inv-pick__group">Jobs · tabela de valores</p>${jobs.map(item).join('')}` : '') +
      (quotes.length ? `<p class="inv-pick__group">Orçamentos aprovados</p>${quotes.map(item).join('')}` : '');
    $('newPick').querySelectorAll('[data-id]').forEach((b) =>
      b.addEventListener('click', () => {
        picked = billable.find((x) => x.key === b.dataset.id);
        renderPick();
        const partial = picked.invoiced_total > 0.004;
        $('newFullOpt').hidden = partial;
        $('newRemainingHint').textContent = money(picked.remaining_to_invoice);
        document.querySelector(`input[name="newKind"][value="${partial ? 'final' : 'deposit'}"]`).checked = true;
        $('newKindBox').hidden = false;
        syncNew();
      }),
    );
  }
  let qTimer = null;
  $('newQ').addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(loadBillable, 250);
  });
  function newKind() {
    return (document.querySelector('input[name="newKind"]:checked') || {}).value || 'deposit';
  }
  function newAmount() {
    if (!picked) return 0;
    const k = newKind();
    if (k === 'deposit') return Math.round(picked.total * (parseFloat($('newPct').value) || 0)) / 100;
    if (k === 'final') return picked.remaining_to_invoice;
    if (k === 'full') return picked.total;
    return Math.round((parseFloat($('newAmt').value) || 0) * 100) / 100;
  }
  function syncNew() {
    const k = newKind();
    $('newPctWrap').hidden = k !== 'deposit';
    $('newAmtWrap').hidden = k !== 'progress';
    const a = newAmount();
    const over = picked && a > picked.remaining_to_invoice + 0.004;
    $('newPreview').className = 'inv-after' + (over ? ' is-error' : '');
    $('newPreview').textContent = !picked
      ? ''
      : over
        ? `Acima do que falta faturar (${money(picked.remaining_to_invoice)}).`
        : a > 0
          ? `Fatura de ${money(a)} · depois disso faltará ${money(Math.max(0, picked.remaining_to_invoice - a))} a faturar.`
          : '';
    $('newSubmit').disabled = !picked || !(a > 0) || over;
  }
  document.querySelectorAll('input[name="newKind"]').forEach((r) => r.addEventListener('change', syncNew));
  $('newPct').addEventListener('input', syncNew);
  $('newAmt').addEventListener('input', syncNew);

  $('newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!picked) return;
    const btn = $('newSubmit');
    btn.disabled = true;
    btn.textContent = 'Criando…';
    try {
      const k = newKind();
      const target =
        picked.kind === 'job' ? `/api/work-orders/${picked.id}/invoices` : `/api/quotes/${picked.id}/invoices`;
      const r = await api(target, {
        method: 'POST',
        body: JSON.stringify({
          invoice_type: k,
          deposit_pct: k === 'deposit' ? parseFloat($('newPct').value) : undefined,
          custom_amount: k === 'progress' ? parseFloat($('newAmt').value) : undefined,
          due_date: $('newDue').value || null,
        }),
      });
      location.href = `invoice.html?id=${encodeURIComponent(r.data.id)}&new=1`;
    } catch (err) {
      $('newError').textContent = err.message;
      $('newError').hidden = false;
      btn.disabled = false;
      btn.textContent = 'Criar fatura';
    }
  });

  // ---------------------------------------------------------------- boot
  async function boot() {
    try {
      const s = await api('/api/auth/session');
      if (!s.authenticated) {
        location.href = '/login.html';
        return;
      }
      perms = (s.user && s.user.permissions) || [];
      isAdmin = (s.user && (s.user.role === 'admin' || s.user.roleKey === 'admin')) || false;
    } catch (_) {
      /* api() already redirects on 401 */
    }
    if (url.get('q') && $('filterQ')) $('filterQ').value = url.get('q');
    $('btnNewInvoice').hidden = !can('invoices.manage');
    $('btnNewInvoice').addEventListener('click', openNew);
    document.querySelectorAll('.inv-tab, .inv-kpi').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('btnPrevPage').addEventListener('click', () => {
      if (page > 1) {
        page -= 1;
        load();
      }
    });
    $('btnNextPage').addEventListener('click', () => {
      page += 1;
      load();
    });
    let t = null;
    $('filterQ').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        page = 1;
        load();
      }, 280);
    });
    setTab(tab);
    if (url.get('new') === '1' && can('invoices.manage')) openNew();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
