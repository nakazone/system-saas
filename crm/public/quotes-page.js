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
    ['all', 'Todos'],
    ['open', 'Abertos'],
    ['approved', 'Aprovados'],
    ['expired', 'Expirados'],
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
    seg: 'all',
    q: '',
    rows: [],
    archived: false,
    sel: null,
    detail: false,
    sum: null,
    paper: {},
    canDelete: false,
    canEdit: true,
    canInvoice: false,
    delArmed: null,
    /** Quote ids selected to unify into one job. */
    mergeIds: [],
    mergeBusy: false,
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
  /** A sent e-mail is not a draft, even if a later save left the status field behind. */
  function effectiveStatus(q) {
    const s = rawStatus(q);
    if (s === 'draft' && (q.email_sent_at || q.sent_at)) return 'sent';
    return s;
  }
  function groupOf(q) {
    const s = effectiveStatus(q);
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
    if (st.q) return g !== 'archived';
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
    if (p === 'builder' || p === 'contractor') return 'Builder';
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
  function groupValue(key) {
    const g = (st.sum && st.sum.groups) || {};
    return g[key] && g[key].value != null ? Number(g[key].value) : 0;
  }
  function segCount(key) {
    const g = (st.sum && st.sum.groups) || {};
    const c = (k) => (g[k] ? g[k].count : 0);
    if (key === 'open') return c('draft') + c('sent') + c('viewed');
    if (key === 'approved') return c('approved');
    if (key === 'expired') return c('expired');
    return c('all');
  }
  function openValue() {
    const s = st.sum || {};
    if (s.open_value != null) return Number(s.open_value) || 0;
    return groupValue('draft') + groupValue('sent') + groupValue('viewed');
  }
  function renderSums() {
    const el = $('qsSums');
    if (!el) return;
    const s = st.sum || {};
    const parts = [
      ['Em aberto', money(openValue()), ''],
      ['Aprovação · 90d', s.approval_rate_90 != null ? Math.round(s.approval_rate_90) + '%' : '—', ''],
      ['Vence em 7d', String(s.expiring_7 || 0), s.expiring_7 > 0 ? 'is-hot' : ''],
      ['Aprovados', money(groupValue('approved')), ''],
    ];
    el.innerHTML = parts.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${v}</dd></div>`).join('');
  }
  function renderTiles() {
    const host = $('qsTiles');
    if (!host) return;
    const html = SEGS.map(([k, label]) => {
      const n = st.sum ? segCount(k) : st.rows.filter((r) => {
        if (st.archived) return false;
        if (k === 'all') return true;
        if (k === 'open') return ['draft', 'waiting', 'changes'].includes(groupOf(r));
        if (k === 'approved') return groupOf(r) === 'approved';
        if (k === 'expired') return groupOf(r) === 'expired';
        return false;
      }).length;
      let sub = '—';
      let hot = false;
      if (k === 'all') sub = `${money(groupValue('all') || openValue() + groupValue('approved') + groupValue('expired'))} total`;
      else if (k === 'open') sub = n ? `${money(openValue())} em aberto` : 'nada pendente';
      else if (k === 'approved') sub = n ? `${money(groupValue('approved'))} aprovado` : '—';
      else if (k === 'expired') {
        sub = n ? `${n} expirado${n === 1 ? '' : 's'}` : 'nenhum';
        hot = n > 0;
      }
      const on = !st.archived && st.seg === k;
      return `<button type="button" class="qs-tile${on ? ' is-on' : ''}" data-seg="${k}" aria-pressed="${on}"><span>${label}</span><b>${n}</b><small class="${hot ? 'is-hot' : ''}">${esc(sub)}</small></button>`;
    }).join('');
    host.innerHTML = html;
    host.style.setProperty('--qs-tiles', String(host.children.length));
  }
  function renderSeg() {
    const sel = $('qsSeg');
    if (sel) {
      const labels = Object.fromEntries(SEGS);
      Array.from(sel.options).forEach((opt) => {
        const n = st.sum ? segCount(opt.value) : '';
        const name = labels[opt.value] || opt.value;
        opt.textContent = n !== '' && (opt.value === 'open' || opt.value === 'all') ? `${name} · ${n}` : name;
      });
      sel.value = st.archived ? 'all' : st.seg;
      window.OlPick?.paint(sel);
    }
    const all = $('qsAll');
    if (all) {
      const on = !st.archived && st.seg === 'all';
      all.classList.toggle('is-on', on);
      all.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    renderTiles();
  }
  function sortByClient(rows) {
    return rows.slice().sort((a, b) =>
      clientOf(a).localeCompare(clientOf(b), 'pt-BR', { sensitivity: 'base' }),
    );
  }
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function sod(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function weekSunday(d) {
    const x = sod(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }
  function weekTitle(sunday) {
    const end = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 6);
    const a = `${sunday.getDate()} ${MO[sunday.getMonth()]}`;
    const b = `${end.getDate()} ${MO[end.getMonth()]}`;
    return `${a} – ${b}`;
  }
  /** Approval date for grouping Approved quotes (signed → updated → created). */
  function approveAnchor(q) {
    const iso = q.signed_at || q.updated_at || q.created_at;
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function bandHtml(label, rows, tone) {
    return `<section class="qs-band ol-band"><div class="qs-grp ol-grp"><span>${esc(label)}</span><em>${rows.length}</em></div>${rows.map(rowHtml).join('')}</section>`;
  }
  /** Approved quotes: chronological by week (newest first), alternating colors like Jobs. */
  function approvedBandsHtml(rows, startIdx, prefix) {
    const weeks = new Map();
    const undated = [];
    rows.forEach((q) => {
      const d = approveAnchor(q);
      if (!d) {
        undated.push(q);
        return;
      }
      const key = ymd(weekSunday(d));
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(q);
    });
    const keys = [...weeks.keys()].sort((a, b) => b.localeCompare(a));
    let html = '';
    let i = startIdx;
    keys.forEach((key) => {
      const g = weeks.get(key).slice().sort((a, b) => {
        const da = approveAnchor(a)?.getTime() || 0;
        const db = approveAnchor(b)?.getTime() || 0;
        if (db !== da) return db - da;
        return clientOf(a).localeCompare(clientOf(b), 'pt-BR', { sensitivity: 'base' });
      });
      const [yy, mm, dd] = key.split('-').map(Number);
      const title = weekTitle(new Date(yy, mm - 1, dd));
      const label = prefix ? `${prefix} · ${title}` : title;
      html += bandHtml(label, g, i % 2 ? 'b' : 'a');
      i += 1;
    });
    if (undated.length) {
      html += bandHtml(prefix ? `${prefix} · Sem data` : 'Sem data', sortByClient(undated), i % 2 ? 'b' : 'a');
      i += 1;
    }
    return { html, next: i };
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
    let html = '';
    let bandIdx = 0;
    const onlyApproved = st.seg === 'approved' && !st.archived;
    GROUPS.filter(([k]) => by[k]).forEach(([k, label]) => {
      if (k === 'approved') {
        const out = approvedBandsHtml(by[k], bandIdx, onlyApproved ? '' : label);
        html += out.html;
        bandIdx = out.next;
        return;
      }
      html += bandHtml(label, sortByClient(by[k]), bandIdx % 2 ? 'b' : 'a');
      bandIdx += 1;
    });
    box.innerHTML = html + archLink();
    renderMergeBar();
  }
  function archLink() {
    return `<button type="button" class="qs-arch" data-arch>${st.archived ? '‹ Voltar aos quotes' : 'Ver arquivados'}</button>`;
  }
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  function addressOf(q) {
    const addr = String(q.job_address || q.customer_address || q.property_label || '').trim();
    if (!addr || addr === clientOf(q)) return '';
    return addr;
  }
  function listDate(q) {
    const g = groupOf(q);
    const exp = q.expiration_date ? dayDiff(q.expiration_date) : null;
    let iso = q.created_at;
    if (g === 'approved' && q.signed_at) iso = q.signed_at;
    else if (q.expiration_date) iso = q.expiration_date;
    else if (q.email_sent_at) iso = q.email_sent_at;
    const hot = g === 'expired' || (g !== 'approved' && g !== 'archived' && exp != null && exp <= 7);
    return { text: dm(iso), hot };
  }
  function listStatus(q) {
    const s = shortStatus(q);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  function canMergeQuote(q) {
    if (!q || !st.canEdit) return false;
    if (groupOf(q) !== 'approved') return false;
    const wo = String(q.work_order_status || '').toLowerCase();
    if (q.work_order_id && wo && wo !== 'draft' && wo !== 'canceled') return false;
    return true;
  }
  function sameMergeParty(a, b) {
    if (!a || !b) return false;
    if (a.customer_id && b.customer_id && String(a.customer_id) === String(b.customer_id)) return true;
    if (a.builder_id && b.builder_id && String(a.builder_id) === String(b.builder_id)) return true;
    return false;
  }
  function mergeSelectedQuotes() {
    return (st.mergeIds || [])
      .map((id) => st.rows.find((r) => String(r.id) === String(id)))
      .filter(Boolean);
  }
  function mergeBarHtml() {
    const picked = mergeSelectedQuotes();
    if (picked.length < 2) return '';
    const ok = picked.every((q) => sameMergeParty(q, picked[0]));
    const labels = picked.map((q) => q.quote_number || (q.number != null ? `#${q.number}` : 'Quote')).join(' + ');
    if (!ok) {
      return `<div class="qs-merge" id="qsMergeBar"><p>Selecione orçamentos do <b>mesmo cliente</b> ou builder para unificar.</p>
        <button type="button" class="qs-btn" data-qs-merge-clear>Limpar</button></div>`;
    }
    return `<div class="qs-merge" id="qsMergeBar">
      <p><b>Unificar ${picked.length} orçamentos</b> · ${esc(labels)} → 1 job</p>
      <span class="qs-merge__acts">
        <button type="button" class="qs-btn" data-qs-merge-clear>Limpar</button>
        <button type="button" class="qs-btn qs-btn--pri" data-qs-merge-go${st.mergeBusy ? ' disabled' : ''}>${st.mergeBusy ? 'Unificando…' : 'Unificar em 1 job'}</button>
      </span>
    </div>`;
  }
  function renderMergeBar() {
    let bar = $('qsMergeBar');
    const html = mergeBarHtml();
    if (!html) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      const host = $('qsRoot') || document.body;
      host.appendChild(bar);
    }
    bar.outerHTML = html;
  }
  async function runMergeQuotes() {
    const picked = mergeSelectedQuotes();
    if (picked.length < 2) return;
    if (!picked.every((q) => sameMergeParty(q, picked[0]))) {
      notify('Os orçamentos precisam ser do mesmo cliente ou builder.', 'error');
      return;
    }
    st.mergeBusy = true;
    renderMergeBar();
    try {
      const j = await api('/api/quotes/merge-job', {
        method: 'POST',
        body: JSON.stringify({ quote_ids: picked.map((q) => q.id) }),
      });
      const jobId = j.created_job_id || j.data?.work_order_id;
      if (!jobId) throw new Error('Não foi possível unificar.');
      st.mergeIds = [];
      notify(`${picked.length} orçamentos unificados num job.`, 'success');
      location.href = `jobs.html?id=${encodeURIComponent(jobId)}`;
    } catch (err) {
      st.mergeBusy = false;
      renderMergeBar();
      notify(err.message || 'Não foi possível unificar.', 'error');
    }
  }
  function toggleMergeId(id, checked) {
    const sid = String(id);
    const set = new Set((st.mergeIds || []).map(String));
    if (checked) {
      if (set.size >= 5) {
        notify('No máximo 5 orçamentos por unificação.', 'info');
        renderList();
        renderMergeBar();
        return;
      }
      set.add(sid);
    } else set.delete(sid);
    st.mergeIds = [...set];
    renderList();
    renderMergeBar();
  }
  function rowHtml(q) {
    const on = String(st.sel) === String(q.id);
    const when = listDate(q);
    const status = listStatus(q);
    const hot = groupOf(q) === 'changes' || groupOf(q) === 'expired';
    const addr = addressOf(q);
    const mergeOn = (st.mergeIds || []).some((id) => String(id) === String(q.id));
    const showMerge = canMergeQuote(q);
    const g = groupOf(q);
    const tone = hot ? 'hot' : g === 'approved' ? 'ok' : g === 'archived' ? 'off' : g === 'draft' ? 'wait' : 'act';
    const next = rowNext(q);
    return `<a class="qs-row ol-row${on ? ' is-on' : ''}${mergeOn ? ' is-merge' : ''}" role="listitem" href="quotes.html?id=${encodeURIComponent(q.id)}" data-id="${esc(q.id)}">
      ${
        showMerge
          ? `<label class="qs-row__merge ol-lead" title="Selecionar para unificar">
              <input type="checkbox" data-qs-merge="${esc(q.id)}"${mergeOn ? ' checked' : ''} />
            </label>`
          : ''
      }
      <b class="ol-t" title="${esc(clientOf(q))}">${esc(clientOf(q))}</b>
      <span class="ol-v">${money(q.total_amount ?? q.total)}</span>
      ${addr ? `<span class="ol-m qs-row__addr" title="${esc(addr)}">${PIN}<span>${esc(addr)}</span></span>` : ''}
      ${when.text ? `<span class="ol-d${when.hot ? ' is-hot' : ''}">${esc(when.text)}</span>` : ''}
      <span class="ol-f">${status ? `<span class="ol-st is-${tone}">${esc(status)}</span>` : ''}${next && next.text && g !== 'draft' && g !== 'archived' ? `<span class="ol-note${next.hot ? ' is-hot' : ''}">${esc(next.text)}</span>` : ''}</span>
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
        const jobCanceled = q.work_order_status === 'canceled';
        const when = i <= last && at && at !== 1 ? dm(at) : i === 4 && q.work_order_id ? (jobCanceled ? 'cancelado' : 'criado') : '';
        const name = i === 4 && q.work_order_id
          ? `<a href="jobs.html?id=${encodeURIComponent(q.work_order_id)}">${jobCanceled ? 'Job cancelado' : 'Abrir job'}</a>`
          : esc(l);
        return `<li class="${cls}"><i></i><b>${name}</b><small>${esc(when)}</small></li>`;
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
      const req = String(q.change_request_note || '').trim();
      p = req || 'Ajuste os serviços na folha e reenvie.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&services=1">Editar serviços</a>`;
      if (st.canInvoice && (Number(q.total_amount ?? q.total) || 0) > 0) {
        cta += `<a class="qs-btn qs-btn--full" href="invoices.html?new=1&quote=${id}">Faturar</a>`;
      }
    } else if (g === 'draft') {
      t = 'Enviar ou virar job';
      p = 'Mande ao cliente ou transforme em job sem passar pelas etapas de envio.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&create_job=1">Transformar em job</a><a class="qs-btn qs-btn--full" href="${b}&send=1">Enviar ao cliente</a>`;
      if (st.canInvoice && (Number(q.total_amount ?? q.total) || 0) > 0) {
        cta += `<a class="qs-btn qs-btn--full" href="invoices.html?new=1&quote=${id}">Faturar</a>`;
      }
    } else if (g === 'waiting' && isViewed(q)) {
      const at = q.viewed_at || q.pdf_viewed_at;
      const d = at ? S.daysSince(at) : null;
      t = `Lembrar ${firstName(q)}`;
      p = d != null ? `Abriu há ${plural(d, 'dia', 'dias')} e ainda não aprovou. Também pode virar job agora.` : 'Abriu e ainda não aprovou. Também pode virar job agora.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&create_job=1">Transformar em job</a><a class="qs-btn qs-btn--full" href="${b}&send=1">Reenviar</a>`;
      if (st.canInvoice && (Number(q.total_amount ?? q.total) || 0) > 0) {
        cta += `<a class="qs-btn qs-btn--full" href="invoices.html?new=1&quote=${id}">Faturar</a>`;
      }
    } else if (g === 'waiting') {
      const d = q.email_sent_at ? S.daysSince(q.email_sent_at) : null;
      t = 'Aguardando o cliente';
      p = d != null ? `Enviado há ${plural(d, 'dia', 'dias')}. Ainda não abriu — ou transforme em job direto.` : 'Ainda não abriu — ou transforme em job direto.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&create_job=1">Transformar em job</a><a class="qs-btn qs-btn--full" href="${b}&send=1">Reenviar</a>`;
      if (st.canInvoice && (Number(q.total_amount ?? q.total) || 0) > 0) {
        cta += `<a class="qs-btn qs-btn--full" href="invoices.html?new=1&quote=${id}">Faturar</a>`;
      }
    } else if (g === 'expired') {
      t = 'Venceu';
      p = 'Atualize a validade e reenvie se o cliente ainda tiver interesse.';
      cta = `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}">Abrir e renovar</a>`;
    } else if (g === 'approved' && q.work_order_id && q.work_order_status === 'canceled') {
      t = 'Job cancelado';
      p = 'O job existe, mas está cancelado e a busca não mostra. Reabra para ele voltar com o cliente e o valor deste quote.';
      cta = `<button type="button" class="qs-btn qs-btn--pri qs-btn--full" data-qs-reopen="${esc(q.id)}">Reabrir job</button><a class="qs-btn qs-btn--full" href="jobs.html?id=${encodeURIComponent(q.work_order_id)}">Abrir job</a>`;
    } else if (g === 'approved') {
      const siblings = st.rows.filter(
        (r) => String(r.id) !== String(q.id) && canMergeQuote(r) && sameMergeParty(r, q),
      );
      t = q.work_order_id ? 'Job criado' : 'Aprovado — virar job';
      p = q.work_order_id
        ? 'O job acompanha este quote. Abra-o direto, mesmo que a busca não ache o nome antigo.'
        : siblings.length
          ? 'Transforme em job sozinho, ou marque 2 orçamentos do mesmo cliente na lista para unificar.'
          : 'Transforme em job: cliente, endereço e serviços já vão preenchidos.';
      cta = q.work_order_id
        ? `<a class="qs-btn qs-btn--pri qs-btn--full" href="jobs.html?id=${encodeURIComponent(q.work_order_id)}">Abrir job</a>`
        : `<a class="qs-btn qs-btn--pri qs-btn--full" href="${b}&create_job=1">Transformar em job</a>`;
      if (siblings.length && canMergeQuote(q)) {
        const already = (st.mergeIds || []).some((x) => String(x) === String(q.id));
        cta += already
          ? `<button type="button" class="qs-btn qs-btn--full" data-qs-merge-clear>Limpar seleção</button>`
          : `<button type="button" class="qs-btn qs-btn--full" data-qs-merge-add="${esc(q.id)}">Selecionar para unificar</button>`;
      }
      if (st.canInvoice && (Number(q.total_amount ?? q.total) || 0) > 0) {
        cta += `<a class="qs-btn qs-btn--full" href="invoices.html?new=1&quote=${id}">Faturar</a>`;
      }
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
  const STATUS_OPTS = [
    ['draft', 'Rascunho'],
    ['sent', 'Enviado'],
    ['viewed', 'Visto'],
    ['approved', 'Aprovado'],
    ['changes_requested', 'Pediu alterações'],
    ['rejected', 'Recusado'],
    ['archived', 'Arquivado'],
  ];
  const promotedSent = new Set();
  const keepDraft = new Set();
  function maybePromoteSent(q) {
    if (!q || !st.canEdit || promotedSent.has(String(q.id)) || keepDraft.has(String(q.id))) return;
    if (rawStatus(q) !== 'draft' || !(q.email_sent_at || q.sent_at)) return;
    promotedSent.add(String(q.id));
    q.status = 'sent';
    void api(`/api/quotes/${encodeURIComponent(q.id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'sent' }),
    }).catch(() => {
      promotedSent.delete(String(q.id));
    });
  }
  function statusSelect(q) {
    if (!st.canEdit) return '';
    maybePromoteSent(q);
    const cur = effectiveStatus(q);
    const opts = STATUS_OPTS.slice();
    if (!opts.some(([v]) => v === cur)) opts.unshift([cur, cur]);
    return `<label class="qs-status">Status<select data-qs-status="${esc(q.id)}" aria-label="Status do quote">${opts
      .map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`)
      .join('')}</select></label>`;
  }
  async function setQuoteStatus(id, status, selectEl) {
    const q = st.rows.find((r) => String(r.id) === String(id));
    const prev = q ? rawStatus(q) : '';
    if (status === 'draft') keepDraft.add(String(id));
    else keepDraft.delete(String(id));
    try {
      const j = await api(`/api/quotes/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      if (j.data) {
        const ix = st.rows.findIndex((r) => String(r.id) === String(id));
        if (ix >= 0) st.rows[ix] = { ...st.rows[ix], ...j.data };
      }
      notify(status === 'approved' ? 'Quote aprovado.' : 'Status atualizado.', 'success');
      renderList();
      renderPane();
      void loadSummary();
    } catch (err) {
      if (selectEl) selectEl.value = prev;
      notify(err.message || 'Não foi possível mudar o status.', 'error');
    }
  }
  async function reopenJob(id) {
    const q = st.rows.find((r) => String(r.id) === String(id));
    if (!q || !q.work_order_id) return;
    await api(`/api/work-orders/${encodeURIComponent(q.work_order_id)}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'draft' }),
    });
    q.work_order_status = 'draft';
    notify('Job reaberto com o valor deste quote.', 'success');
    renderList();
    renderPane();
  }
  function openQuotePdf(id, name) {
    const url = `/api/quotes/${encodeURIComponent(id)}/invoice-pdf`;
    const title = name ? `Quote ${name}` : 'Quote';
    if (window.crmPdfViewer && window.crmPdfViewer.openFromUrl) {
      window.crmPdfViewer.openFromUrl(url, { title, filename: `${name || 'quote'}.pdf` });
      return;
    }
    window.open(url, '_blank', 'noopener');
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
    const link = q.public_token ? `${location.origin}/quote-public.html?t=${encodeURIComponent(q.public_token)}` : '';
    const paper = pd
      ? `<div class="qp">${P.render(P.fromApi(pd), { mode: 'view' })}</div>`
      : pd === null
        ? '<p class="qs-blank">Não foi possível carregar a folha.</p>'
        : '<div class="qs-paper-skel"></div>';
    const del = st.canDelete
      ? `<button type="button" class="qs-btn qs-btn--ghost qs-btn--ico${st.delArmed === q.id ? ' is-armed' : ''}" data-del="${esc(q.id)}" title="Apagar" aria-label="Apagar">${st.delArmed === q.id ? 'Apagar mesmo?' : ico('del')}</button>`
      : '';
    const g = groupOf(q);
    const showFat = st.canInvoice && g !== 'archived' && g !== 'expired' && (Number(q.total_amount ?? q.total) || 0) > 0;
    return `
      <header class="qs-head">
        <div class="qs-head__top">
          <div class="qs-head__t">
            <div class="qs-chips"><span class="qs-pill qs-pill--${tone}">${esc(label)}</span><span class="qs-chip">${esc(partyLabel(q))}</span><span class="qs-val">${esc(validityText(q))}</span>${statusSelect(q)}</div>
            <h2>${esc(q.quote_number || 'Quote')} · ${esc(name)}</h2>
            ${sub ? `<p>${esc(sub)}</p>` : ''}
          </div>
          <div class="qs-acts">
            ${del}
            <button type="button" class="qs-btn" data-qs-pdf="${esc(q.id)}" data-qs-pdf-name="${esc(q.quote_number || 'quote')}">${ico('pdf')}PDF</button>
            ${link ? `<button type="button" class="qs-btn" data-copy="${esc(link)}">${ico('link')}Link</button>` : ''}
            ${showFat ? `<a class="qs-btn" href="invoices.html?new=1&quote=${encodeURIComponent(q.id)}">${ico('doc')}Faturar</a>` : ''}
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
  // The Mate's face (fox) may load after the first render: draw the empty state again with him.
  window.addEventListener('mateface:ready', () => {
    // only when the plain empty text is on screen (never over a list or a loading state)
    if (!document.querySelector('#qsPane .qs-blank')) return;
    try {
      renderPane();
    } catch (_) {}
  });
  function blankPane() {
    if (!st.rows.length) {
      // The Mate offers to make the first one (fox mascot, only on a truly empty list)
      if (window.MateFace) return '<div class="qs-blank">' + window.MateFace.empty({ pose: 'point', title: 'Nenhum quote ainda', text: 'Crie o primeiro em “Novo” ou me diga para quem é e o que vai no piso.', ask: 'criar um quote', askLabel: 'Criar com o Mate' }) + '</div>';
      return '<div class="qs-blank"><b>Nenhum quote ainda.</b><br />Crie o primeiro em “Novo”.</div>';
    }
    return '<div class="qs-blank">Escolha um quote na lista.</div>';
  }
  function renderPane() {
    const q = current();
    $('qsPane').innerHTML = q ? paneHtml(q) : blankPane();
    const bar = $('qsMbar');
    if (q) {
      const fat =
        st.canInvoice && groupOf(q) !== 'archived' && groupOf(q) !== 'expired' && (Number(q.total_amount ?? q.total) || 0) > 0
          ? `<a class="qs-btn" href="invoices.html?new=1&quote=${encodeURIComponent(q.id)}">Faturar</a>`
          : '';
      bar.innerHTML = `<button type="button" class="qs-btn qs-btn--sq" data-qs-pdf="${esc(q.id)}" data-qs-pdf-name="${esc(q.quote_number || 'quote')}" aria-label="PDF">${ico('pdf')}</button>
        <a class="qs-btn" href="quote-builder.html?id=${encodeURIComponent(q.id)}&services=1">Serviços</a>
        ${fat}
        <a class="qs-btn qs-btn--pri" href="quote-builder.html?id=${encodeURIComponent(q.id)}">Editar</a>`;
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
    renderTiles();
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
    if (!narrow()) {
      const visible = st.rows.filter(inSeg);
      const curOk = visible.some((r) => String(r.id) === String(st.sel));
      if ((!st.sel || (st.q && !curOk)) && visible[0]) {
        st.sel = visible[0].id;
        void loadPaper(visible[0].id);
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
      if (e.target.closest('[data-qs-merge], .qs-row__merge')) {
        e.stopPropagation();
        return;
      }
      const a = e.target.closest('.qs-row');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      select(a.getAttribute('data-id'), narrow());
    });
    $('qsRows').addEventListener('change', (e) => {
      const box = e.target.closest('[data-qs-merge]');
      if (!box) return;
      toggleMergeId(box.getAttribute('data-qs-merge'), box.checked);
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-qs-merge-clear]')) {
        e.preventDefault();
        st.mergeIds = [];
        renderList();
        renderMergeBar();
        renderPane();
        return;
      }
      if (e.target.closest('[data-qs-merge-go]')) {
        e.preventDefault();
        void runMergeQuotes();
        return;
      }
      const add = e.target.closest('[data-qs-merge-add]');
      if (add) {
        e.preventDefault();
        toggleMergeId(add.getAttribute('data-qs-merge-add'), true);
        renderPane();
      }
    });
    function applySeg(next) {
      st.seg = next;
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
    }
    $('qsSeg').addEventListener('change', (e) => applySeg(e.target.value));
    document.querySelector('.qs-list')?.addEventListener('ol-all', () => {
      window.CrmList?.openAll(document.querySelector('.qs-list'));
      applySeg('all');
    });
    const tiles = $('qsTiles');
    if (tiles) {
      tiles.addEventListener('click', (e) => {
        const b = e.target.closest('[data-seg]');
        if (!b) return;
        applySeg(b.getAttribute('data-seg'));
      });
    }
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
    function onQuoteAction(e) {
      const pdf = e.target.closest('[data-qs-pdf]');
      if (pdf) {
        e.preventDefault();
        openQuotePdf(pdf.getAttribute('data-qs-pdf'), pdf.getAttribute('data-qs-pdf-name'));
        return true;
      }
      const reopen = e.target.closest('[data-qs-reopen]');
      if (reopen) {
        e.preventDefault();
        reopenJob(reopen.getAttribute('data-qs-reopen')).catch((err) => notify(err.message || 'Não foi possível reabrir o job.', 'error'));
        return true;
      }
      return false;
    }
    $('qsPane').addEventListener('click', (e) => {
      if (onQuoteAction(e)) return;
      const c = e.target.closest('[data-copy]');
      if (c) {
        const url = c.getAttribute('data-copy');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => notify('Link do cliente copiado.', 'success'));
        return;
      }
      const d = e.target.closest('[data-del]');
      if (d) void deleteQuote(d.getAttribute('data-del'));
    });
    $('qsPane').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-qs-status]');
      if (!sel) return;
      void setQuoteStatus(sel.getAttribute('data-qs-status'), sel.value, sel);
    });
    $('qsMbar').addEventListener('click', onQuoteAction);
    let t = null;
    $('filterQ').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        st.q = $('filterQ').value.trim();
        loadRows().catch(() => {});
      }, 260);
    });
    $('filterQ').addEventListener('keydown', (e) => {
      const rows = Array.from($('qsRows').querySelectorAll('.qs-row'));
      if (!rows.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter')) return;
      e.preventDefault();
      let i = rows.findIndex((r) => r.classList.contains('is-kb'));
      if (e.key === 'Enter') {
        const pick = rows[i] || rows[0];
        if (pick) select(pick.getAttribute('data-id'), narrow());
        return;
      }
      if (i < 0) i = e.key === 'ArrowDown' ? 0 : rows.length - 1;
      else i = (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows.forEach((r, n) => r.classList.toggle('is-kb', n === i));
      rows[i].scrollIntoView({ block: 'nearest' });
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
    st.canInvoice = role === 'admin' || perms.includes('invoices.manage');
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
    try {
      const bc = new BroadcastChannel('obramate-crm');
      bc.onmessage = (ev) => {
        const msg = ev && ev.data;
        if (!msg || msg.type !== 'customer-updated') return;
        void reload().then(() => {
          if (st.sel) void loadPaper(st.sel);
        });
      };
    } catch (_) {
      /* BroadcastChannel unavailable */
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
