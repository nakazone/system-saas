/**
 * Quotes — lista lateral (busca, filtros, grupos com próximo passo) e o quote aberto à direita
 * com a folha igual ao PDF, o próximo passo e o resumo.
 * Dados: /api/quotes/summary, /api/quotes?group=…, /api/quotes/:id/paper
 */
(function () {
  const S = window.omLeadSignals;
  const P = window.OmQuotePaper;
  const DAY = 86400000;
  const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  const SEGS = [
    ['open', 'Abertos'],
    ['approved', 'Aprovados'],
    ['expired', 'Expirados'],
    ['all', 'Todos'],
  ];
  const GROUPS = [
    ['changes', 'Pediu alterações'],
    ['draft', 'Rascunho'],
    ['waiting', 'Enviados · aguardando'],
    ['approved', 'Aprovados'],
    ['expired', 'Expirados'],
    ['archived', 'Arquivados'],
  ];

  const st = {
    seg: 'open',
    q: '',
    rows: [],
    archived: false,
    sel: null,
    detail: false,
    sum: null,
    paper: {},
    canDelete: false,
    canEdit: true,
    delArmed: null,
  };

  const $ = (id) => document.getElementById(id);
  function notify(msg, type) {
    if (typeof window.crmNotify === 'function') window.crmNotify(msg, type || 'info');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  function money(n) {
    return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  }
  function money2(n) {
    return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dayDiff(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return null;
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const n = new Date();
    const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    return Math.round((a - b) / DAY);
  }
  function dm(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MO[d.getMonth()]}`;
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }
  const ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    pdf: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    del: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
  };
  const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

  /* ---------- regras ---------- */
  function rawStatus(q) {
    return String(q.status || 'draft').toLowerCase();
  }
  function groupOf(q) {
    const s = rawStatus(q);
    if (s === 'approved' || s === 'accepted' || s === 'converted' || s === 'invoiced') return 'approved';
    if (s === 'archived' || s === 'rejected') return 'archived';
    if (s === 'draft') return 'draft';
    const exp = q.expiration_date ? new Date(q.expiration_date).getTime() : null;
    if (s === 'expired' || (exp != null && exp < Date.now())) return 'expired';
    if (s === 'changes_requested') return 'changes';
    return 'waiting';
  }
  function isViewed(q) {
    return rawStatus(q) === 'viewed' || Boolean(q.viewed_at);
  }
  function inSeg(q) {
    const g = groupOf(q);
    if (st.archived) return g === 'archived';
    if (st.seg === 'open') return g === 'draft' || g === 'waiting' || g === 'changes';
    if (st.seg === 'approved') return g === 'approved';
    if (st.seg === 'expired') return g === 'expired';
    return g !== 'archived';
  }
  function clientOf(q) {
    return q.builder_name || q.builder_company || q.customer_name || q.customer_company || q.lead_name || q.title || 'Sem cliente';
  }
  function firstName(q) {
    return String(clientOf(q)).split(/\s+/)[0] || 'O cliente';
  }
  function partyLabel(q) {
    const p = String(q.quote_party || (q.builder_id ? 'builder' : '')).toLowerCase();
    if (p === 'builder') return 'Builder';
    if (p === 'contractor') return 'Contractor';
    if (p === 'loja') return 'Loja';
    return 'Particular';
  }
  function statusPill(q) {
    const g = groupOf(q);
    if (g === 'changes') return ['hot', 'Pediu alterações'];
    if (g === 'draft') return ['mu', 'Rascunho'];
    if (g === 'approved') return ['ok', q.work_order_id ? 'Aprovado · job criado' : 'Aprovado'];
    if (g === 'expired') return ['hot', 'Expirado'];
    if (g === 'archived') return ['mu', 'Arquivado'];
    if (isViewed(q)) return ['or', 'Visto · não aprovou'];
    return ['dk', 'Enviado'];
  }
  function shortStatus(q) {
    const g = groupOf(q);
    return { changes: 'Alterar', draft: 'a enviar', approved: 'Aprovado', expired: 'Expirado', archived: 'Arquivado' }[g] || (isViewed(q) ? 'Visto' : 'Enviado');
  }
  /** Linha secundária do item da lista: { text, hot } */
  function rowNext(q) {
    const g = groupOf(q);
    if (g === 'changes') return { text: 'ajustar e reenviar', hot: true };
    if (g === 'draft') {
      const ref = String(q.job_address || q.property_label || '').trim();
      return { text: [partyLabel(q), ref && ref !== clientOf(q) ? ref : ''].filter(Boolean).join(' · '), hot: false };
    }
    if (g === 'approved') return { text: q.work_order_id ? 'job criado' : 'criar o job', hot: false };
    if (g === 'expired') {
      const d = q.expiration_date ? -dayDiff(q.expiration_date) : null;
      return { text: d > 0 ? `venceu há ${plural(d, 'dia', 'dias')}` : 'venceu', hot: true };
    }
    if (g === 'archived') return { text: 'arquivado', hot: false };
    if (isViewed(q)) {
      const at = q.viewed_at || q.pdf_viewed_at;
      return { text: `visto ${at ? dm(at) : ''} · não aprovou`.replace('  ', ' '), hot: true };
    }
    const d = q.email_sent_at ? S.daysSince(q.email_sent_at) : null;
    if (d != null && d >= 3) return { text: `enviado há ${d} dias · não abriu`, hot: true };
    return { text: q.email_sent_at ? `enviado ${dm(q.email_sent_at)}` : 'aguardando o cliente', hot: false };
  }
  function validityText(q) {
    const g = groupOf(q);
    if (g === 'approved') return q.signed_at ? `assinado ${dm(q.signed_at)}` : '';
    if (!q.expiration_date) return 'sem validade';
    const d = dayDiff(q.expiration_date);
    if (d < 0) return `venceu ${dm(q.expiration_date)}`;
    if (d === 0) return 'vence hoje';
    return `vale até ${dm(q.expiration_date)} (${plural(d, 'dia', 'dias')})`;
  }

  /* ---------- lista ---------- */
  function renderSums() {
    const s = st.sum;
    if (!s) return;
    const parts = [`<b>${money(s.open_value)}</b> em aberto`];
    if (s.approval_rate_90 != null) parts.push(`<b>${Math.round(s.approval_rate_90)}%</b> aprovação`);
    if (s.expiring_7) parts.push(`<b class="is-hot">${s.expiring_7}</b> vence${s.expiring_7 === 1 ? '' : 'm'} em 7d`);
    $('qsSums').innerHTML = parts.join('<i>·</i>');
  }
  function segCount(key) {
    const g = (st.sum && st.sum.groups) || {};
    const c = (k) => (g[k] ? g[k].count : 0);
    if (key === 'open') return c('draft') + c('sent') + c('viewed');
    if (key === 'approved') return c('approved');
    if (key === 'expired') return c('expired');
    return c('all');
  }
  function renderSeg() {
    $('qsSeg').innerHTML = SEGS.map(([k, l]) => {
      const on = !st.archived && st.seg === k;
      const n = st.sum ? segCount(k) : '';
      return `<button type="button" role="tab" aria-selected="${on}" class="${on ? 'is-on' : ''}" data-seg="${k}">${l}${n !== '' && (k === 'open' || k === 'all') ? ` <em>${n}</em>` : ''}</button>`;
    }).join('');
  }
  function renderList() {
    const box = $('qsRows');
    const q = st.q.toLowerCase();
    const rows = st.rows.filter(inSeg);
    if (!rows.length) {
      box.innerHTML = `<p class="qs-empty">${
        q ? 'Nenhum quote encontrado para essa busca.' : st.archived ? 'Nenhum quote arquivado.' : st.seg === 'open' ? 'Nenhum quote em aberto. Crie um em “Novo”.' : 'Nenhum quote aqui.'
      }</p>${archLink()}`;
      return;
    }
    const by = {};
    rows.forEach((r) => (by[groupOf(r)] = by[groupOf(r)] || []).push(r));
    box.innerHTML =
      GROUPS.filter(([k]) => by[k])
        .map(
          ([k, label]) => `<div class="qs-grp"><span>${label}</span><em>${by[k].length}</em></div>${by[k].map(rowHtml).join('')}`,
        )
        .join('') + archLink();
  }
  function archLink() {
    return `<button type="button" class="qs-arch" data-arch>${st.archived ? '‹ Voltar aos quotes' : 'Ver arquivados'}</button>`;
  }
  function rowHtml(q) {
    const nx = rowNext(q);
    const qn = q.quote_number || '';
    const on = String(st.sel) === String(q.id);
    return `<a class="qs-row${on ? ' is-on' : ''}" role="listitem" href="quotes.html?id=${encodeURIComponent(q.id)}" data-id="${esc(q.id)}">
      <span class="qs-row__b"><b>${esc(clientOf(q))}</b><small${nx.hot ? ' class="is-hot"' : ''}>${esc([qn, nx.text].filter(Boolean).join(' · '))}</small></span>
      <span class="qs-row__v">${money(q.total_amount ?? q.total)}<small>${esc(shortStatus(q))}</small></span>
    </a>`;
  }

  /* ---------- quote aberto ---------- */
  function current() {
    return st.sel ? st.rows.find((r) => String(r.id) === String(st.sel)) || null : null;
  }
  function stepsHtml(q) {
    const g = groupOf(q);
    const approved = g === 'approved';
    const steps = [
      ['Criado', q.created_at],
      ['Enviado', q.email_sent_at || (g !== 'draft' ? q.updated_at : null)],
      ['Visto', q.viewed_at || q.pdf_viewed_at],
      ['Aprovado', approved ? q.signed_at || q.updated_at : null],
      ['Job', q.work_order_id ? 1 : null],
    ];
    let last = -1;
    steps.forEach((s, i) => {
      if (s[1]) last = i;
    });
    if (g !== 'draft' && last < 1) last = 1;
    return `<ol class="qs-steps">${steps
      .map(([l, at], i) => {
        const cls = i <= last ? 'is-done' : i === last + 1 && g !== 'expired' && g !== 'archived' ? 'is-next' : '';
        const when = i <= last && at && at !== 1 ? dm(at) : i === 4 && q.work_order_id ? 'criado' : '';
        return `<li class="${cls}"><i></i><b>${l}</b><small>${esc(when)}</small></li>`;
      })
      .join('')}</ol>`;
  }
  function nextCard(q) {
    const g = groupOf(q);
    const id = encodeURIComponent(q.id);
    const b = `quote-builder.html?id=${id}`;
    let t = '';
    let p = '';
    let cta = '';
    if (g === 'changes') {
      t = 'Cliente pediu alterações';
      p = 'Ajuste os serviços na folha e reenvie.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&services=1">Editar serviços</a>`;
    } else if (g === 'draft') {
      t = 'Pronto para enviar';
      p = 'Confira a folha e mande o link por e-mail ou SMS.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&send=1">Enviar ao cliente</a>`;
    } else if (g === 'waiting' && isViewed(q)) {
      const at = q.viewed_at || q.pdf_viewed_at;
      const d = at ? S.daysSince(at) : null;
      t = `Lembrar ${firstName(q)}`;
      p = d != null ? `Abriu há ${plural(d, 'dia', 'dias')} e ainda não aprovou.` : 'Abriu e ainda não aprovou.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&send=1">Reenviar</a>`;
    } else if (g === 'waiting') {
      const d = q.email_sent_at ? S.daysSince(q.email_sent_at) : null;
      t = 'Aguardando o cliente';
      p = d != null ? `Enviado há ${plural(d, 'dia', 'dias')}. Ainda não abriu.` : 'Ainda não abriu.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&send=1">Reenviar</a>`;
    } else if (g === 'expired') {
      t = 'Venceu';
      p = 'Atualize a validade e reenvie se o cliente ainda tiver interesse.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}">Abrir e renovar</a>`;
    } else if (g === 'approved') {
      t = q.work_order_id ? 'Job criado' : 'Aprovado';
      p = q.work_order_id ? 'O trabalho já está em Jobs.' : 'Crie o job para agendar a obra.';
      cta = q.work_order_id
        ? `<a class="qs-btn qs-btn--pri qs-btn--full" href="job-detail.html?id=${encodeURIComponent(q.work_order_id)}">Abrir o job</a>`
        : `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}">Criar o job</a>`;
    } else {
      t = 'Arquivado';
      p = 'Este quote não aparece nos abertos.';
      cta = `<a class="qs-btn qs-btn--full" href="${b}">Abrir</a>`;
    }
    return `<div class="qs-next"><span>Próximo passo</span><b>${esc(t)}</b><p>${esc(p)}</p>${cta}</div>`;
  }
  function resumoCard(q, pd) {
    const total = Number(q.total_amount ?? q.total) || 0;
    const sub = Number(q.subtotal) || total;
    const tax = Number(q.tax_total) || 0;
    const area = Number(q.area_sqft) || (pd && Number(pd.floorAreaSqft)) || areaFromLines(pd);
    const pays = P.payments({ total, schedule: (pd && pd.schedule) || [] });
    const rows = [
      ['Subtotal', money2(sub)],
      tax ? ['Imposto', money2(tax)] : null,
      ['Total', money2(total), 1],
      area > 0 ? ['Por sq ft', money2(total / area)] : null,
      pays[0] ? [pays[0].label.replace(/^Deposit · due on approval/i, 'Depósito').replace(/^Deposit/i, 'Depósito'), money2(pays[0].amount)] : null,
    ].filter(Boolean);
    return `<div class="qs-card"><h3>Resumo</h3><dl class="qs-sum">${rows
      .map(([k, v, t]) => `<div${t ? ' class="is-t"' : ''}><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
      .join('')}</dl></div>`;
  }
  function areaFromLines(pd) {
    if (!pd || !pd.lines) return 0;
    let a = 0;
    for (const l of pd.lines) {
      if (String(l.unit || '') === 'sq_ft' && String(l.itemType || '') !== 'product') a = Math.max(a, Number(l.quantity) || 0);
    }
    return a;
  }
  function paneHtml(q) {
    const [tone, label] = statusPill(q);
    const pd = st.paper[q.id];
    const name = clientOf(q);
    const sub = [q.job_name && q.job_name !== name ? q.job_name : '', pd && pd.customerEmail].filter(Boolean).join(' · ');
    const pdfHref = `/api/quotes/${encodeURIComponent(q.id)}/invoice-pdf`;
    const link = q.public_token ? `${location.origin}/quote-public.html?t=${encodeURIComponent(q.public_token)}` : '';
    const paper = pd
      ? `<div class="qp">${P.render(P.fromApi(pd), { mode: 'view' })}</div>`
      : pd === null
        ? '<p class="qs-blank">Não foi possível carregar a folha.</p>'
        : '<div class="qs-paper-skel"></div>';
    const del = st.canDelete
      ? `<button type="button" class="qs-btn qs-btn--ghost qs-btn--ico${st.delArmed === q.id ? ' is-armed' : ''}" data-del="${esc(q.id)}" title="Apagar" aria-label="Apagar">${st.delArmed === q.id ? 'Apagar mesmo?' : ico('del')}</button>`
      : '';
    return `
      <header class="qs-head">
        <div class="qs-head__top">
          <div class="qs-head__t">
            <div class="qs-chips"><span class="qs-pill qs-pill--${tone}">${esc(label)}</span><span class="qs-chip">${esc(partyLabel(q))}</span><span class="qs-val">${esc(validityText(q))}</span></div>
            <h2>${esc(q.quote_number || 'Quote')} · ${esc(name)}</h2>
            ${sub ? `<p>${esc(sub)}</p>` : ''}
          </div>
          <div class="qs-acts">
            ${del}
            <a class="qs-btn" href="${pdfHref}" target="_blank" rel="noopener">${ico('pdf')}PDF</a>
            ${link ? `<button type="button" class="qs-btn" data-copy="${esc(link)}">${ico('link')}Link</button>` : ''}
            <a class="qs-btn qs-btn--pri" href="quote-builder.html?id=${encodeURIComponent(q.id)}" data-crm-permission="quotes.edit">Editar orçamento</a>
          </div>
        </div>
        ${stepsHtml(q)}
      </header>
      <div class="qs-grid">
        <div class="qs-paper">
          <div class="qs-paper__bar"><span>${ico('doc')}Como o cliente vê o PDF</span>${
            st.canEdit ? `<a class="qs-btn qs-btn--sm" href="quote-builder.html?id=${encodeURIComponent(q.id)}&services=1">${ico('plus')}Editar serviços</a>` : ''
          }</div>
          ${paper}
        </div>
        <div class="qs-side">${nextCard(q)}${resumoCard(q, pd)}</div>
      </div>`;
  }
  function blankPane() {
    if (!st.rows.length) return '<div class="qs-blank"><b>Nenhum quote ainda.</b><br />Crie o primeiro em “Novo”.</div>';
    return '<div class="qs-blank">Escolha um quote na lista.</div>';
  }
  function renderPane() {
    const q = current();
    $('qsPane').innerHTML = q ? paneHtml(q) : blankPane();
    const bar = $('qsMbar');
    if (q) {
      bar.innerHTML = `<a class="qs-btn qs-btn--sq" href="/api/quotes/${encodeURIComponent(q.id)}/invoice-pdf" target="_blank" rel="noopener" aria-label="PDF">${ico('pdf')}</a>
        <a class="qs-btn" href="quote-builder.html?id=${encodeURIComponent(q.id)}&services=1">Serviços</a>
        <a class="qs-btn qs-btn--pri" href="quote-builder.html?id=${encodeURIComponent(q.id)}">Editar orçamento</a>`;
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }
  const narrow = () => window.matchMedia('(max-width: 1024px)').matches;
  function sync() {
    const on = narrow() && st.detail && Boolean(current());
    $('qsSplit').classList.toggle('is-detail', on);
    document.body.classList.toggle('qs-detail-open', on);
  }
  async function loadPaper(id) {
    if (st.paper[id] !== undefined) return;
    try {
      const j = await api(`/api/quotes/${encodeURIComponent(id)}/paper`);
      st.paper[id] = j.data;
    } catch (_) {
      st.paper[id] = null;
    }
    if (String(st.sel) === String(id)) renderPane();
  }
  function select(id, push) {
    st.sel = id || null;
    st.detail = Boolean(id);
    st.delArmed = null;
    renderList();
    renderPane();
    sync();
    try {
      const u = new URL(location.href);
      if (st.sel) u.searchParams.set('id', st.sel);
      else u.searchParams.delete('id');
      history[push ? 'pushState' : 'replaceState']({ id: st.sel }, '', u.toString());
    } catch (_) {
      /* ignore */
    }
    if (st.sel) void loadPaper(st.sel);
    if (narrow()) window.scrollTo({ top: 0 });
  }

  /* ---------- dados ---------- */
  async function loadSummary() {
    try {
      const j = await api('/api/quotes/summary');
      st.sum = j.data;
    } catch (_) {
      /* opcional */
    }
    renderSums();
    renderSeg();
  }
  async function loadRows() {
    const params = new URLSearchParams({ page: '1', limit: '100' });
    if (st.q) params.set('q', st.q);
    params.set('group', st.archived ? 'archived' : 'all');
    const j = await api(`/api/quotes?${params}`);
    st.rows = j.data || [];
    // garante o quote aberto mesmo fora da página/filtro
    if (st.sel && !st.rows.some((r) => String(r.id) === String(st.sel))) {
      try {
        const one = await api(`/api/quotes/${encodeURIComponent(st.sel)}`);
        if (one.data) st.rows.push(one.data);
      } catch (_) {
        st.sel = null;
      }
    }
    renderList();
    if (!st.sel && !narrow()) {
      const first = st.rows.find(inSeg);
      if (first) {
        st.sel = first.id;
        void loadPaper(first.id);
        renderList();
      }
    }
    renderPane();
    sync();
  }
  function reload() {
    st.paper = {};
    return Promise.all([loadRows(), loadSummary()]).catch((e) => notify(e.message, 'error'));
  }

  async function deleteQuote(id) {
    if (st.delArmed !== id) {
      st.delArmed = id;
      renderPane();
      setTimeout(() => {
        if (st.delArmed === id) {
          st.delArmed = null;
          renderPane();
        }
      }, 3500);
      return;
    }
    try {
      await api(`/api/quotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Quote apagado.', 'success');
      st.sel = null;
      st.detail = false;
      await reload();
    } catch (err) {
      notify(err.message || 'Não foi possível apagar o quote.', 'error');
    }
  }

  function bind() {
    $('qsRows').addEventListener('click', (e) => {
      if (e.target.closest('[data-arch]')) {
        st.archived = !st.archived;
        st.sel = null;
        st.detail = false;
        renderSeg();
        loadRows().catch((err) => notify(err.message, 'error'));
        return;
      }
      const a = e.target.closest('.qs-row');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      select(a.getAttribute('data-id'), narrow());
    });
    $('qsSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-seg]');
      if (!b) return;
      st.seg = b.getAttribute('data-seg');
      st.archived = false;
      renderSeg();
      if (!st.rows.length || st.rows.some((r) => groupOf(r) === 'archived')) {
        loadRows().catch((err) => notify(err.message, 'error'));
        return;
      }
      renderList();
      const cur = current();
      if (!narrow() && (!cur || !inSeg(cur))) {
        const first = st.rows.find(inSeg);
        select(first ? first.id : null);
      }
    });
    $('qsBack').addEventListener('click', (e) => {
      e.preventDefault();
      st.detail = false;
      sync();
      try {
        const u = new URL(location.href);
        u.searchParams.delete('id');
        history.replaceState(null, '', u.toString());
      } catch (_) {
        /* ignore */
      }
    });
    $('qsPane').addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) {
        const url = c.getAttribute('data-copy');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => notify('Link do cliente copiado.', 'success'));
        return;
      }
      const d = e.target.closest('[data-del]');
      if (d) void deleteQuote(d.getAttribute('data-del'));
    });
    let t = null;
    $('filterQ').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        st.q = $('filterQ').value.trim();
        loadRows().catch(() => {});
      }, 260);
    });
    window.addEventListener('popstate', () => {
      const id = new URLSearchParams(location.search).get('id');
      st.sel = id;
      st.detail = Boolean(id);
      renderList();
      renderPane();
      sync();
      if (id) void loadPaper(id);
    });
    window.addEventListener('resize', sync);
  }

  async function boot() {
    let s;
    try {
      s = await api('/api/auth/session');
    } catch (_) {
      location.href = '/login.html';
      return;
    }
    if (!s.authenticated) {
      location.href = '/login.html';
      return;
    }
    const perms = s.user?.permissions || [];
    const role = s.user?.role || '';
    st.canDelete = role === 'admin' || perms.includes('quotes.delete');
    st.canEdit = role === 'admin' || perms.includes('quotes.edit') || !perms.length;
    window.__crmPermissionKeys = perms;
    window.__crmUserRole = role;
    const sn = $('sidebarUserName');
    if (sn) sn.textContent = s.user?.name || s.user?.email || '—';
    const sr = $('sidebarUserRole');
    if (sr) sr.textContent = role || '';
    const params = new URLSearchParams(location.search);
    const g = params.get('group');
    if (g === 'approved' || g === 'expired') st.seg = g;
    else if (g === 'all') st.seg = 'all';
    else if (g === 'archived') st.archived = true;
    const id = params.get('id');
    if (id) {
      st.sel = id;
      st.detail = true;
      void loadPaper(id);
    }
    document.body.appendChild($('qsMbar'));
    bind();
    renderSeg();
    await reload();
    if (window.OmGestures) {
      window.OmGestures.initPullToRefresh({ key: 'quotes', indicator: '#quotesPtr', refresh: () => reload() });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
