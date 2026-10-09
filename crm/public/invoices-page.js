/* Invoices — números no topo, status como filtros, lista lateral agrupada e a fatura aberta ao lado
   (Opção A com a lista lateral da B). A fatura em si é desenhada por invoice-page.js (window.InvoicePage). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const url = new URLSearchParams(location.search);
  let tab = url.get('status') || 'all';
  let perms = [];
  let isAdmin = false;
  let all = [];
  let summary = null;
  let billableTotal = null;
  let selId = url.get('id') || null;
  let q = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n, dec) {
    const d = dec == null ? 2 : dec;
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function dshort(d) {
    if (!d) return '';
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return '';
    return `${x.getUTCDate()} ${MO[x.getUTCMonth()]}`;
  }
  function fdate(d) {
    if (!d) return '—';
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return '—';
    return x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function daysUntil(d) {
    if (!d) return null;
    const x = new Date(d);
    const t = new Date();
    return Math.round((Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  }
  function plural(n, a, b) {
    return `${n} ${n === 1 ? a : b}`;
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
  const isWide = () => window.matchMedia('(min-width: 1025px)').matches;

  const STATUS = {
    draft: ['Rascunho', 'is-draft'],
    sent: ['Enviada', 'is-sent'],
    viewed: ['Vista', 'is-viewed'],
    partially_paid: ['Parcial', 'is-partial'],
    overdue: ['Vencida', 'is-overdue'],
    paid: ['Paga', 'is-paid'],
    void: ['Anulada', 'is-void'],
  };
  const isOpen = (i) => i.display_status !== 'paid' && i.display_status !== 'void' && i.display_status !== 'draft';

  // ---------------------------------------------------------------- derivados
  function dueInfo(i) {
    if (i.display_status === 'paid') return { main: `Paga ${dshort(i.paid_at)}`, sub: '', hot: false };
    if (i.display_status === 'void') return { main: 'Anulada', sub: '', hot: false };
    if (i.display_status === 'overdue') return { main: dshort(i.due_date), sub: `vencida há ${plural(i.days_overdue, 'dia', 'dias')}`, hot: true };
    const d = daysUntil(i.due_date);
    return { main: dshort(i.due_date) || 'Sem vencimento', sub: d == null ? '' : d === 0 ? 'vence hoje' : d > 0 ? `em ${plural(d, 'dia', 'dias')}` : '', hot: false };
  }
  /** Próximo passo curto para a linha (a fatura aberta mostra o cartão completo). */
  function nextStep(i) {
    const sent = i.email_sent_at || i.issued_at;
    switch (i.display_status) {
      case 'draft':
        return { t: 'Enviar ao cliente', hot: false };
      case 'overdue':
        return { t: `Cobrar · ${i.viewed_at ? `vista ${dshort(i.viewed_at)}` : sent ? `enviada ${dshort(sent)}, não abriu` : 'não abriu'}`, hot: true };
      case 'paid':
        return { t: `${money(i.amount, 0)} recebido`, hot: false };
      case 'void':
        return { t: 'Anulada', hot: false };
      default:
        if (i.paid_amount > 0) return { t: `Receber saldo ${money(i.remaining_amount, 0)}`, hot: false };
        if (i.viewed_at) return { t: `Vista ${dshort(i.viewed_at)} · aguardando`, hot: false };
        return { t: sent ? `Enviada ${dshort(sent)} · não abriu` : 'Aguardando pagamento', hot: false };
    }
  }

  // ---------------------------------------------------------------- filtros
  const TILES = [
    ['all', 'Todas'],
    ['draft', 'Rascunho'],
    ['sent', 'Enviadas'],
    ['viewed', 'Vistas'],
    ['overdue', 'Vencidas'],
    ['partially_paid', 'Parciais'],
    ['paid', 'Pagas'],
    ['void', 'Anuladas'],
  ];
  function inTab(i, t) {
    if (t === 'all') return i.display_status !== 'void';
    if (t === 'unpaid') return isOpen(i);
    return i.display_status === t;
  }
  function hit(i) {
    if (!q) return true;
    const hay = [i.invoice_number, i.customer_name, i.customer_email, i.source_ref, i.job_title, i.quote_title, i.reference_note, i.invoice_type_label].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  function renderSum() {
    const s = summary || {};
    const parts = [
      ['Em aberto', money(s.outstanding, 0), ''],
      ['Vencido', money(s.overdue_amount, 0), s.overdue_amount > 0 ? 'is-hot' : ''],
      ['Recebido · 30 dias', money(s.received_30d, 0), ''],
      ['Rascunhos', money(s.draft_amount, 0), ''],
    ];
    if (billableTotal != null) parts.push(['Jobs a faturar', money(billableTotal, 0), '']);
    $('ixSum').innerHTML = parts.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${v}</dd></div>`).join('');
  }

  function renderTiles() {
    const sum = (rows, f) => rows.reduce((a, i) => a + (Number(f(i)) || 0), 0);
    const html = TILES.filter(([k]) => k !== 'void' || all.some((i) => i.display_status === 'void'))
      .map(([k, label]) => {
        const rows = all.filter((i) => inTab(i, k));
        let sub = '';
        let hot = false;
        if (k === 'all') sub = `${money(sum(rows, (i) => i.amount), 0)} faturado`;
        else if (k === 'draft') sub = rows.length ? `${money(sum(rows, (i) => i.amount), 0)} a enviar` : 'nada pendente';
        else if (k === 'sent' || k === 'viewed') sub = rows.length ? `${money(sum(rows, (i) => i.remaining_amount), 0)} a receber` : '—';
        else if (k === 'overdue') {
          sub = rows.length ? `${money(sum(rows, (i) => i.remaining_amount), 0)} · ${Math.max(...rows.map((i) => i.days_overdue || 0))} dias` : 'nenhuma';
          hot = rows.length > 0;
        } else if (k === 'partially_paid') sub = rows.length ? `${money(sum(rows, (i) => i.paid_amount), 0)} recebido` : '—';
        else if (k === 'paid') sub = rows.length ? `${money(sum(rows, (i) => i.amount), 0)} recebido` : '—';
        else if (k === 'void') sub = 'fora dos totais';
        return `<button type="button" class="ix-tile${tab === k ? ' is-on' : ''}" data-tab="${k}" aria-pressed="${tab === k}"${!rows.length && k !== 'all' && tab !== k ? ' data-zero' : ''}><span>${label}</span><b>${rows.length}</b><small class="${hot ? 'is-hot' : ''}">${esc(sub)}</small></button>`;
      })
      .join('');
    $('ixTiles').innerHTML = html;
    $('ixTiles').style.setProperty('--ix-tiles', String($('ixTiles').children.length));
  }

  function rowHtml(i) {
    const d = dueInfo(i);
    const n = nextStep(i);
    const [label, cls] = STATUS[i.display_status] || STATUS.sent;
    const open = i.display_status !== 'paid' && i.display_status !== 'void';
    const pct = Math.max(0, Math.min(100, Number(i.percent_paid) || 0));
    return `<a class="ix-row${String(i.id) === String(selId) ? ' is-on' : ''}" href="invoices.html?id=${encodeURIComponent(i.id)}" data-inv-id="${esc(i.id)}">
      <span class="ix-row__l1"><b>${esc(i.customer_name || '—')}</b><em>${money(open ? i.remaining_amount : i.amount, 0)}</em></span>
      <span class="ix-row__l2"><span>${esc(i.invoice_number || '—')} · ${esc(i.source_ref || i.invoice_type_label || '')}</span><em class="${d.hot ? 'is-hot' : ''}">${esc(d.sub || d.main)}</em></span>
      <span class="ix-row__l3"><span class="ix-next${n.hot ? ' is-hot' : ''}">${esc(n.t)}</span><span class="inv-chip ${cls}">${esc(label)}</span></span>
      ${pct > 0 && pct < 100 ? `<span class="ix-prog"><i style="width:${pct}%"></i></span>` : ''}
    </a>`;
  }

  const GROUPS = [
    ['Vencidas', (i) => i.display_status === 'overdue'],
    ['A receber', (i) => ['sent', 'viewed', 'partially_paid'].includes(i.display_status)],
    ['Rascunhos', (i) => i.display_status === 'draft'],
    ['Pagas', (i) => i.display_status === 'paid'],
    ['Anuladas', (i) => i.display_status === 'void'],
  ];

  function visible() {
    return all.filter((i) => inTab(i, tab) && hit(i));
  }

  function renderList() {
    const rows = visible();
    $('ixCount').textContent = `${rows.length} ${rows.length === 1 ? 'fatura' : 'faturas'}`;
    if (!rows.length) {
      $('invRows').innerHTML = `<p class="ix-empty">${q ? 'Nada encontrado. Tente outro termo.' : !all.length ? 'Nenhuma fatura ainda. Crie a primeira a partir de um job ou orçamento.' : 'Nenhuma fatura neste filtro.'}</p>`;
      return;
    }
    const byDate = (a, b) => new Date(b.created_at) - new Date(a.created_at);
    $('invRows').innerHTML = GROUPS.map(([label, fn]) => {
      const g = rows.filter(fn).sort(label === 'Vencidas' ? (a, b) => (b.days_overdue || 0) - (a.days_overdue || 0) : byDate);
      if (!g.length) return '';
      const tot = g.reduce((a, i) => a + Number(label === 'Pagas' || label === 'Anuladas' ? i.amount : i.remaining_amount) || 0, 0);
      return `<p class="ix-grp"><span>${label}</span><em>${g.length} · ${money(tot, 0)}</em></p>${g.map(rowHtml).join('')}`;
    }).join('');
    if (window.OmGestures && !isWide()) window.OmGestures.bindSwipeRow?.($('invRows'));
  }

  function renderAll() {
    renderSum();
    renderTiles();
    renderList();
  }

  // ---------------------------------------------------------------- abrir fatura
  function select(id, push) {
    selId = id;
    $('invRows').querySelectorAll('[data-inv-id]').forEach((a) => a.classList.toggle('is-on', a.getAttribute('data-inv-id') === String(id)));
    const narrow = !isWide();
    $('invSplit').classList.toggle('is-detail', narrow && !!id);
    document.body.classList.toggle('ix-detail-open', narrow && !!id);
    $('ixBlank').hidden = !!id;
    $('invPage').hidden = !id;
    if (id) window.InvoicePage?.open(id);
    if (push) {
      try {
        const u = new URL(location.href);
        if (id) u.searchParams.set('id', id);
        else u.searchParams.delete('id');
        u.searchParams.delete('action');
        u.searchParams.delete('mode');
        u.searchParams.delete('new');
        history.replaceState(null, '', u);
      } catch (_) {}
    }
    if (narrow) window.scrollTo(0, 0);
  }

  function back() {
    selId = null;
    $('invSplit').classList.remove('is-detail');
    document.body.classList.remove('ix-detail-open');
    $('invPage').hidden = true;
    $('ixBlank').hidden = false;
    renderList();
    try {
      const u = new URL(location.href);
      u.searchParams.delete('id');
      history.replaceState(null, '', u);
    } catch (_) {}
  }

  async function fetchAll() {
    const out = [];
    let page = 1;
    let total = Infinity;
    let sum = null;
    while (out.length < total && page <= 20) {
      const j = await api(`/api/invoices?status=all&limit=100&page=${page}`);
      out.push(...(j.data || []));
      total = j.total || out.length;
      sum = sum || j.summary;
      if (!(j.data || []).length) break;
      page += 1;
    }
    // "all" pode não trazer as anuladas: busca à parte.
    if (!out.some((i) => i.display_status === 'void')) {
      try {
        const v = await api('/api/invoices?status=void&limit=100');
        (v.data || []).forEach((i) => {
          if (!out.some((x) => x.id === i.id)) out.push(i);
        });
      } catch (_) {}
    }
    return { rows: out, summary: sum };
  }

  let loading = null;
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const r = await fetchAll();
        all = r.rows;
        summary = r.summary;
        renderAll();
      } catch (err) {
        $('invRows').innerHTML = `<p class="ix-empty"><b>Não foi possível carregar</b><br>${esc(err.message)}</p>`;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function loadBillableTotal() {
    try {
      const j = await api('/api/invoices/billable-jobs');
      billableTotal = (j.data || []).reduce((a, x) => a + (Number(x.remaining_to_invoice) || 0), 0);
      renderSum();
    } catch (_) {
      billableTotal = null;
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
    const d = new Date(Date.now() + 1 * 86400000);
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
      closeNew();
      btn.disabled = false;
      btn.textContent = 'Criar fatura';
      toast(`${r.data.invoice_number || 'Fatura'} criada. Envie ao cliente quando estiver pronta.`);
      await load();
      select(r.data.id, true);
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
    if (url.get('q')) {
      $('filterQ').value = url.get('q');
      q = url.get('q').toLowerCase();
    }
    if (tab === 'unpaid') tab = 'all';
    const bar = $('invMobileBar');
    if (bar && bar.parentElement !== document.body) document.body.appendChild(bar);
    $('btnNewInvoice').hidden = !can('invoices.manage');
    $('btnNewInvoice').addEventListener('click', openNew);
    $('ixTiles').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      tab = b.dataset.tab;
      try {
        const u = new URL(location.href);
        if (tab === 'all') u.searchParams.delete('status');
        else u.searchParams.set('status', tab);
        history.replaceState(null, '', u);
      } catch (_) {}
      renderTiles();
      renderList();
      if (isWide() && !visible().some((i) => String(i.id) === String(selId))) {
        const first = $('invRows').querySelector('[data-inv-id]');
        if (first) select(first.getAttribute('data-inv-id'), true);
      }
    });
    $('invRows').addEventListener('click', (e) => {
      const a = e.target.closest('[data-inv-id]');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      select(a.getAttribute('data-inv-id'), true);
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-inv-open]');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      select(a.getAttribute('data-inv-open'), true);
    });
    $('ixBack').addEventListener('click', (e) => {
      e.preventDefault();
      back();
    });
    let t = null;
    $('filterQ').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        q = $('filterQ').value.trim().toLowerCase();
        renderList();
      }, 160);
    });
    let rt = null;
    window.addEventListener('invoice:changed', (e) => {
      const d = e.detail;
      const i = d && all.findIndex((x) => x.id === d.id);
      if (i >= 0 && d) {
        // mantém a linha em dia na hora; os totais vêm do servidor logo depois
        Object.assign(all[i], {
          display_status: d.display_status,
          status: d.status,
          paid_amount: d.paid_amount,
          remaining_amount: d.remaining_amount,
          percent_paid: d.percent_paid,
          days_overdue: d.days_overdue,
          viewed_at: d.viewed_at,
          issued_at: d.issued_at,
          amount: d.amount,
          due_date: d.due_date,
        });
        renderList();
      }
      clearTimeout(rt);
      rt = setTimeout(() => load(), 600);
    });
    window.addEventListener('invoice:deleted', () => {
      load().then(() => {
        if (isWide()) {
          const first = $('invRows').querySelector('[data-inv-id]');
          select(first ? first.getAttribute('data-inv-id') : null, true);
        } else back();
      });
    });
    window.addEventListener('resize', () => {
      if (isWide()) {
        $('invSplit').classList.remove('is-detail');
        document.body.classList.remove('ix-detail-open');
      }
    });

    await load();
    loadBillableTotal();
    if (selId && all.some((i) => String(i.id) === String(selId))) {
      const inv = all.find((i) => String(i.id) === String(selId));
      if (!inTab(inv, tab)) tab = 'all';
      renderTiles();
      renderList();
      // invoice-page.js já abre a fatura do ?id= (com ?action=pay|send); aqui só arruma a tela
      const narrow = !isWide();
      $('invSplit').classList.toggle('is-detail', narrow);
      document.body.classList.toggle('ix-detail-open', narrow);
      $('ixBlank').hidden = true;
      $('invPage').hidden = false;
      $('invRows').querySelectorAll('[data-inv-id]').forEach((a) => a.classList.toggle('is-on', a.getAttribute('data-inv-id') === String(selId)));
    } else if (isWide()) {
      const first = $('invRows').querySelector('[data-inv-id]');
      if (first) select(first.getAttribute('data-inv-id'), true);
    }
    if (window.OmGestures) {
      window.OmGestures.initPullToRefresh({ key: 'invoices', indicator: '#invPtr', refresh: () => load() });
      window.OmGestures.ensureDockPadding('.ix-list, .inv-page');
    }
    if (url.get('new') === '1' && !selId && can('invoices.manage')) openNew();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
