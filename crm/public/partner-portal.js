(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const view = $('ppView');
  const MAX_FILES = 5;
  const MAX_BYTES = 10 * 1024 * 1024;

  const state = {
    user: null,
    providers: [],
    jobs: [],
    projects: [],
    invoices: [],
    requests: [],
    documents: [],
    loaded: { invoices: false, requests: false, documents: false },
    jobDetail: new Map(),
    q: '',
    jobStage: 'all',
    invoiceFilter: 'open',
    docFilter: 'all',
    docQuery: '',
    calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calDay: dateKey(new Date()),
    send: null,
  };

  /* ─────────────────────────── helpers ─────────────────────────── */

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
  }
  function moneyShort(value) {
    const n = Number(value) || 0;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);
  }
  function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function dateKey(value) {
    const d = value instanceof Date ? value : toDate(value);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /** Dates saved at 12:00 UTC (date-only fields) are read in UTC so they don't slip a day. */
  function dateOnly(value) {
    const d = toDate(value);
    if (!d) return null;
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function fmtDay(value, opts) {
    const d = value instanceof Date ? value : toDate(value);
    if (!d) return '';
    return new Intl.DateTimeFormat('pt-BR', opts || { day: 'numeric', month: 'short' }).format(d).replace('.', '');
  }
  function fmtWeekday(value) {
    const d = value instanceof Date ? value : toDate(value);
    if (!d) return '';
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\./g, '');
  }
  function fmtTime(value) {
    const d = toDate(value);
    if (!d) return '';
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
  }
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function daysBetween(a, b) {
    return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
  }
  function initials(text) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || ''))).toUpperCase();
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }
  function fileSize(size) {
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  function icon(name) {
    const paths = {
      back: '<path d="M15 18l-6-6 6-6"/>',
      upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
      camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
      text: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>',
      pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
      chev: '<path d="M9 6l6 6-6 6"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  async function api(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace('partner-login.html');
      throw new Error('Entre novamente.');
    }
    if (!response.ok) {
      const err = new Error(body.error || 'Não foi possível carregar os dados.');
      err.status = response.status;
      err.code = body.code;
      throw err;
    }
    return body;
  }
  function postJson(url, payload) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }

  /* ─────────────────────────── domain ─────────────────────────── */

  const JOB_STEPS = ['Recebido', 'Agendado', 'Na obra', 'Concluído'];
  function jobStepIndex(job) {
    if (job.status === 'completed' || job.status === 'needs_invoicing') return 3;
    if (job.status === 'in_progress') return 2;
    if (job.status === 'scheduled') return 1;
    return 0;
  }
  function jobStageKey(job) {
    return ['recebido', 'agendado', 'obra', 'concluido'][jobStepIndex(job)];
  }
  function jobIsActive(job) {
    return jobStepIndex(job) < 3;
  }
  function jobLate(job) {
    if (!jobIsActive(job)) return 0;
    const end = toDate(job.scheduledEnd || job.scheduledStart);
    if (!end || job.status === 'draft') return 0;
    const d = daysBetween(end, new Date());
    return d > 0 ? d : 0;
  }
  function jobChip(job) {
    const i = jobStepIndex(job);
    if (i === 3) return '<span class="pp-chip pp-chip--ok">Concluído</span>';
    if (i === 2) return '<span class="pp-chip pp-chip--dark">Na obra</span>';
    if (i === 1) return '<span class="pp-chip">Agendado</span>';
    return '<span class="pp-chip">Aguardando agenda</span>';
  }
  function jobWhen(job) {
    const start = toDate(job.scheduledStart);
    const i = jobStepIndex(job);
    if (i === 3) return `Concluído · ${fmtDay(job.updatedAt)}`;
    if (!start) return 'A equipe ainda vai agendar';
    const late = jobLate(job);
    if (late && i === 1) return `<span class="pp-late">Não iniciado · data passou há ${plural(late, 'dia', 'dias')}</span>`;
    if (i === 2) {
      const end = toDate(job.scheduledEnd);
      return end ? `Na obra · até ${fmtWeekday(end)}` : 'Na obra';
    }
    const d = daysBetween(new Date(), start);
    if (d === 0) return `Hoje${job.allDay ? '' : ` · ${fmtTime(start)}`}`;
    if (d === 1) return `Amanhã${job.allDay ? '' : ` · ${fmtTime(start)}`}`;
    return fmtWeekday(start);
  }
  function bars(index, steps, done) {
    const n = steps.length;
    const cells = steps.map((_, i) => `<i class="${done || i < index ? 'done' : i === index ? 'now' : ''}"></i>`).join('');
    return `<div class="pp-bars" style="--n:${n}" aria-hidden="true">${cells}</div>`;
  }
  function barsWithLabels(index, steps, done, extra) {
    const labels = steps.map((label, i) => `<span class="${!done && i === index ? 'now' : ''}">${esc(label)}${extra && extra[i] ? ` · ${esc(extra[i])}` : ''}</span>`).join('');
    return `${bars(index, steps, done)}<div class="pp-bar-labels" style="--n:${steps.length}">${labels}</div>`;
  }
  function jobsInDay(key) {
    return state.jobs.filter((job) => {
      const start = toDate(job.scheduledStart);
      if (!start) return false;
      const end = toDate(job.scheduledEnd) || start;
      const k0 = dateKey(start);
      const k1 = dateKey(end);
      return key >= k0 && key <= k1;
    });
  }

  function invoiceState(inv) {
    const paid = inv.status === 'paid' || Number(inv.balance) <= 0;
    const due = dateOnly(inv.due_date);
    const today = startOfDay(new Date());
    if (paid) return { key: 'paid', label: 'Paga', chip: '<span class="pp-chip pp-chip--ok">Paga</span>', days: 0 };
    if (due && due < today) {
      const days = daysBetween(due, today);
      return { key: 'overdue', label: `Venceu há ${plural(days, 'dia', 'dias')}`, chip: `<span class="pp-chip pp-chip--late">Venceu há ${plural(days, 'dia', 'dias')}</span>`, days };
    }
    if (due) {
      const days = daysBetween(today, due);
      if (days <= 7) return { key: 'soon', label: days === 0 ? 'Vence hoje' : `Vence em ${plural(days, 'dia', 'dias')}`, chip: `<span class="pp-chip pp-chip--late">${days === 0 ? 'Vence hoje' : `Vence em ${plural(days, 'dia', 'dias')}`}</span>`, days };
      return { key: 'open', label: `Vence ${fmtDay(due)}`, chip: '<span class="pp-chip">Em aberto</span>', days };
    }
    return { key: 'open', label: 'Em aberto', chip: '<span class="pp-chip">Em aberto</span>', days: 0 };
  }
  function invoiceRef(inv) {
    const job = inv.job || {};
    return job.title || job.address || (inv.quote && inv.quote.title) || 'Invoice';
  }

  function requestStatus(req) {
    if (req.status === 'accepted') return '<span class="pp-chip pp-chip--ok">Aceito</span>';
    if (req.status === 'declined') return '<span class="pp-chip pp-chip--late">Não aprovado</span>';
    return '<span class="pp-chip">Aguardando a equipe</span>';
  }

  function providerName() {
    const user = state.user || {};
    const p = state.providers.find((x) => x.slug === user.workspace);
    return (p && p.name) || 'Seu fornecedor';
  }

  /* ─────────────────────────── loading ─────────────────────────── */

  async function loadInvoices(force) {
    if (state.loaded.invoices && !force) return;
    const r = await api('/api/partner-portal/invoices');
    state.invoices = r.data || [];
    state.loaded.invoices = true;
  }
  async function loadRequests(force) {
    if (state.loaded.requests && !force) return;
    const r = await api('/api/partner-portal/requests');
    state.requests = r.data || [];
    state.loaded.requests = true;
  }
  async function loadDocuments(force) {
    if (state.loaded.documents && !force) return;
    const r = await api('/api/partner-portal/documents');
    state.documents = r.data || [];
    state.loaded.documents = true;
  }
  async function loadJob(id, force) {
    if (state.jobDetail.has(id) && !force) return state.jobDetail.get(id);
    const r = await api(`/api/partner-portal/jobs/${encodeURIComponent(id)}`);
    state.jobDetail.set(id, r.data);
    return r.data;
  }

  function updateCounts() {
    const due = state.invoices.filter((inv) => ['overdue', 'soon'].includes(invoiceState(inv).key)).length;
    const declined = state.requests.filter((r) => r.status === 'declined' && daysBetween(toDate(r.created_at) || new Date(), new Date()) <= 30).length;
    document.querySelectorAll('[data-count="invoices"]').forEach((el) => { el.textContent = String(due); el.hidden = !due; });
    document.querySelectorAll('[data-count="pedidos"]').forEach((el) => { el.textContent = String(declined); el.hidden = !declined; });
  }

  /* ─────────────────────────── router ─────────────────────────── */

  function route() {
    const hash = (location.hash || '#inicio').slice(1);
    const [name, id] = hash.split('/');
    return { name: name || 'inicio', id: id ? decodeURIComponent(id) : '' };
  }
  function setNav(name) {
    const map = { 'job': 'jobs', 'invoice': 'invoices', 'pedidos': 'enviar' };
    const key = map[name] || name;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const nav = el.getAttribute('data-nav');
      const on = nav === key || (nav === 'mais' && ['documentos', 'enviar', 'mais'].includes(key) && el.classList.contains('pp-tab'));
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }
  let renderToken = 0;
  async function render() {
    if (!state.user || state.user.must_change_password) return;
    const token = ++renderToken;
    const r = route();
    setNav(r.name);
    document.body.classList.remove('pp-focus');
    try {
      if (r.name === 'jobs') await renderJobs(r.id, token);
      else if (r.name === 'invoices') await renderInvoices(r.id, token);
      else if (r.name === 'calendario') renderCalendar();
      else if (r.name === 'enviar') await renderSend(token);
      else if (r.name === 'documentos') await renderDocuments(token);
      else if (r.name === 'mais') renderMore();
      else await renderHome(token);
    } catch (err) {
      if (token !== renderToken) return;
      view.innerHTML = `<p class="pp-error" role="alert">${esc(err.message || 'Não foi possível carregar.')}</p>`;
    }
    updateCounts();
  }

  /* ─────────────────────────── home ─────────────────────────── */

  async function renderHome(token) {
    await Promise.all([loadInvoices(), loadRequests()]);
    if (token !== renderToken) return;
    const user = state.user;
    const now = new Date();
    const hour = now.getHours();
    const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const first = String(user.name || '').split(/\s+/)[0] || '';
    const active = state.jobs.filter(jobIsActive);
    const waiting = active.filter((j) => j.status === 'draft').length;
    const scheduled = active.filter((j) => j.status === 'scheduled').length;
    const onSite = active.filter((j) => j.status === 'in_progress').length;
    const done30 = state.jobs.filter((j) => !jobIsActive(j) && daysBetween(toDate(j.updatedAt) || now, now) <= 30).length;
    const open = state.invoices.filter((inv) => invoiceState(inv).key !== 'paid');
    const openSum = open.reduce((s, inv) => s + Number(inv.balance || 0), 0);
    const overdue = open.filter((inv) => invoiceState(inv).key === 'overdue');
    const overdueSum = overdue.reduce((s, inv) => s + Number(inv.balance || 0), 0);
    const soonSum = open.filter((inv) => invoiceState(inv).key === 'soon').reduce((s, inv) => s + Number(inv.balance || 0), 0);
    const pending = state.requests.filter((r) => r.status === 'pending').length;

    const upcoming = state.jobs
      .filter((j) => jobIsActive(j) && toDate(j.scheduledStart) && (toDate(j.scheduledEnd || j.scheduledStart) >= startOfDay(now)))
      .sort((a, b) => toDate(a.scheduledStart) - toDate(b.scheduledStart))
      .slice(0, 3);

    const attention = [];
    overdue.concat(open.filter((inv) => invoiceState(inv).key === 'soon')).forEach((inv) => {
      const st = invoiceState(inv);
      attention.push(`<div class="pp-att"><div class="pp-att-main"><strong>${esc(inv.number ? `Invoice ${inv.number}` : 'Invoice')} · ${money(inv.balance)}</strong><span class="${st.key === 'overdue' ? 'pp-late' : ''}">${esc(invoiceRef(inv))} · ${esc(st.label)}</span></div><a class="pp-btn pp-btn--dark pp-btn--sm" href="#invoices/${encodeURIComponent(inv.id)}">Ver invoice</a></div>`);
    });
    state.requests.filter((r) => r.status === 'declined' && daysBetween(toDate(r.created_at) || now, now) <= 30).forEach((r) => {
      attention.push(`<div class="pp-att"><div class="pp-att-main"><strong>Pedido não aprovado · ${esc(r.title)}</strong><span>${esc(r.review_note || 'A equipe não aprovou este pedido.')}</span></div><a class="pp-btn pp-btn--sec pp-btn--sm" href="#enviar">Ver pedido</a></div>`);
    });

    const forecast = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      forecast.push({ d, n: jobsInDay(dateKey(d)).length });
    }
    const maxN = Math.max(1, ...forecast.map((f) => f.n));
    const forecastLabel = forecast.map((f) => `${fmtDay(f.d)}: ${f.n}`).join(', ');

    view.innerHTML = `
      <div class="pp-bento">
        <div class="pp-head" style="grid-column: span 12">
          <div><p class="pp-eyebrow">${esc(user.company_name || '')}${user.company_name ? ' · ' : ''}${esc(fmtDay(now, { weekday: 'long', day: 'numeric', month: 'long' }))}</p><h1>${esc(hello)}${first ? `, ${esc(first)}` : ''}</h1></div>
          <div class="pp-head-actions"><a class="pp-btn pp-btn--sec" href="#calendario">Calendário</a><a class="pp-btn pp-btn--sec" href="#documentos">Fotos e docs</a><a class="pp-btn pp-btn--pri" href="#enviar">Enviar trabalho</a></div>
        </div>

        <section class="pp-tile pp-tile--orange" style="grid-column: span 4; grid-row: span 3" aria-label="Jobs ativos">
          <div style="font-size:14px;font-weight:500">Jobs ativos</div>
          <div class="pp-big" style="font-size:52px">${active.length}</div>
          <div style="font-size:14px">com ${esc(providerName())}</div>
          <div class="pp-inbox-grid">
            <div class="pp-inbox"><span style="font-size:12px">Aguardando agenda</span><b>${waiting}</b></div>
            <div class="pp-inbox"><span style="font-size:12px">Agendados</span><b>${scheduled}</b></div>
            <div class="pp-inbox"><span style="font-size:12px">Na obra</span><b>${onSite}</b></div>
          </div>
          <a class="pp-tile-link" href="#jobs">Ver jobs →</a>
        </section>

        <section class="pp-tile pp-tile--dark" style="grid-column: span 4; grid-row: span 2" aria-label="Invoices em aberto">
          <div class="pp-lbl">Invoices em aberto</div>
          <div class="pp-big">${money(openSum)}</div>
          <div class="pp-meter" aria-hidden="true"><i style="width:${openSum ? Math.round((overdueSum / openSum) * 100) : 0}%"></i></div>
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:13px" class="pp-sub"><span>${money(overdueSum)} vencido</span><span>${money(soonSum)} vence em 7 dias</span></div>
          <a class="pp-tile-link" href="#invoices">Ver invoices →</a>
        </section>

        <section class="pp-tile" style="grid-column: span 4; grid-row: span 3" aria-labelledby="ppNext">
          <div class="pp-tile-head"><h2 id="ppNext">Próximos na obra</h2><a class="pp-link" href="#calendario" style="font-size:13px">Calendário</a></div>
          ${upcoming.length ? upcoming.map((j) => `<a class="pp-inbox" href="#jobs/${encodeURIComponent(j.id)}" style="text-decoration:none"><span class="pp-lbl">${jobWhen(j)}</span><strong style="font-size:15px">${esc(j.title || 'Job')}</strong><span class="pp-muted" style="font-size:13px">${esc(j.address || '')}</span></a>`).join('') : '<div class="pp-empty" style="padding:16px 8px"><strong>Nada agendado</strong>Quando a equipe agendar um job, ele aparece aqui.</div>'}
        </section>

        <section class="pp-tile pp-hide-phone" style="grid-column: span 2" aria-label="Concluídos"><div class="pp-lbl">Concluídos · 30 dias</div><div class="pp-big" style="font-size:28px">${done30}</div></section>
        <section class="pp-tile pp-hide-phone" style="grid-column: span 2" aria-label="Pedidos"><div class="pp-lbl">Pedidos aguardando</div><div class="pp-big" style="font-size:28px">${pending}</div></section>

        <section class="pp-tile" style="grid-column: span 6; grid-row: span 3; gap: 4px" aria-labelledby="ppAtt">
          <h2 id="ppAtt" style="margin-bottom:8px">Para você ${attention.length ? `<span class="pp-badge">${attention.length}</span>` : ''}</h2>
          ${attention.length ? attention.slice(0, 5).join('') : '<div class="pp-empty" style="padding:16px 8px"><strong>Nada pendente com você</strong>Invoices a vencer e respostas da equipe aparecem aqui.</div>'}
        </section>

        <section class="pp-tile pp-hide-phone" style="grid-column: span 6; grid-row: span 2" aria-labelledby="ppFc">
          <div class="pp-tile-head"><h2 id="ppFc">Previsão de obra</h2><span class="pp-lbl">Próximos 14 dias</span></div>
          <div class="pp-forecast" role="img" aria-label="Jobs por dia: ${esc(forecastLabel)}">${forecast.map((f, i) => `<i class="${i === 0 ? 'today' : f.n ? '' : 'zero'}" style="height:${f.n ? Math.max(14, Math.round((f.n / maxN) * 100)) : 8}%"></i>`).join('')}</div>
          <div class="pp-forecast-labels" aria-hidden="true">${forecast.map((f, i) => `<span class="${i === 0 ? 'today' : ''}">${esc(fmtDay(f.d, { day: 'numeric' }))}</span>`).join('')}</div>
        </section>

        <button type="button" class="pp-drop" id="ppHomeDrop" style="grid-column: span 6">
          <span class="pp-drop-icon">${icon('upload')}</span>
          <span><strong>Solte aqui uma ordem de serviço, PO ou agenda</strong><span>PDF, print, foto ou e-mail. A gente lê e você confere antes de enviar.</span></span>
        </button>
      </div>`;
    bindDrop($('ppHomeDrop'), (files) => startSendWithFiles(files));
    $('ppHomeDrop').addEventListener('click', () => { location.hash = '#enviar'; });
  }

  /* ─────────────────────────── jobs ─────────────────────────── */

  function jobMatchesQuery(job, q) {
    if (!q) return true;
    return [job.title, job.address, job.number].filter((x) => x != null).join(' ').toLowerCase().includes(q);
  }

  async function renderJobs(id, token) {
    const q = state.q.trim().toLowerCase();
    const now = new Date();
    const all = state.jobs;
    const counts = {
      all: all.length,
      recebido: all.filter((j) => jobStageKey(j) === 'recebido').length,
      agendado: all.filter((j) => jobStageKey(j) === 'agendado').length,
      obra: all.filter((j) => jobStageKey(j) === 'obra').length,
      concluido: all.filter((j) => jobStageKey(j) === 'concluido').length,
    };
    const list = all.filter((j) => (state.jobStage === 'all' || jobStageKey(j) === state.jobStage) && jobMatchesQuery(j, q));
    const groups = [
      ['Na obra', list.filter((j) => jobStageKey(j) === 'obra')],
      ['Agendados', list.filter((j) => jobStageKey(j) === 'agendado').sort((a, b) => toDate(a.scheduledStart) - toDate(b.scheduledStart))],
      ['Aguardando agenda', list.filter((j) => jobStageKey(j) === 'recebido')],
      ['Concluídos', list.filter((j) => jobStageKey(j) === 'concluido')],
    ].filter(([, rows]) => rows.length);
    const selectedId = id || (window.matchMedia('(max-width: 767px)').matches ? '' : (groups[0] && groups[0][1][0] && groups[0][1][0].id) || '');
    const late = all.filter((j) => jobLate(j)).length;
    await loadInvoices().catch(() => {});
    if (token !== renderToken) return;
    const openSum = state.invoices.filter((inv) => invoiceState(inv).key !== 'paid').reduce((s, inv) => s + Number(inv.balance || 0), 0);
    const done30 = all.filter((j) => !jobIsActive(j) && daysBetween(toDate(j.updatedAt) || now, now) <= 30).length;

    const stage = (key, label) => `<button type="button" class="pp-stage" data-stage="${key}" aria-pressed="${state.jobStage === key}">${esc(label)}<b>${counts[key]}</b></button>`;
    const row = (j) => `<button type="button" class="pp-row" data-job="${esc(j.id)}" aria-current="${j.id === selectedId}">
        <span class="pp-row-main">
          <span class="pp-row-top"><strong>${esc(j.title || 'Job')}</strong><span>${j.number ? `#${esc(j.number)}` : ''}</span></span>
          <span class="pp-row-sub">${esc(j.address || 'Sem endereço')}</span>
          <span class="pp-row-next">${jobWhen(j)}</span>
          ${bars(jobStepIndex(j), JOB_STEPS, jobStepIndex(j) === 3)}
        </span>
      </button>`;

    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(providerName())}</p><h1>Jobs</h1></div><div class="pp-head-actions"><a class="pp-btn pp-btn--pri" href="#enviar">Enviar trabalho</a></div></div>
      <div class="pp-nums">
        <div class="pp-card pp-num"><span class="pp-lbl">Ativos</span><b>${all.filter(jobIsActive).length}</b></div>
        <div class="pp-card pp-num"><span class="pp-lbl">Na obra</span><b>${counts.obra}</b></div>
        <div class="pp-card pp-num"><span class="pp-lbl">Data passou</span><b class="${late ? 'pp-late' : ''}">${late}</b></div>
        <div class="pp-card pp-num pp-hide-phone"><span class="pp-lbl">Concluídos · 30 dias</span><b>${done30}</b></div>
        <div class="pp-card pp-num pp-hide-phone"><span class="pp-lbl">Invoices em aberto</span><b>${moneyShort(openSum)}</b></div>
      </div>
      <div class="pp-stages" role="group" aria-label="Etapa">${stage('all', 'Todos')}${stage('recebido', 'Aguardando agenda')}${stage('agendado', 'Agendados')}${stage('obra', 'Na obra')}${stage('concluido', 'Concluídos')}</div>
      <div class="pp-split pp-split--list ${id ? 'is-open' : ''}">
        <aside class="pp-card pp-side" aria-label="Lista de jobs">
          <div class="pp-side-search"><label>${icon('search')}<span class="pp-sr">Buscar jobs</span><input id="ppJobSearch" type="search" placeholder="Endereço, título ou nº" value="${esc(state.q)}" /></label></div>
          ${groups.length ? groups.map(([label, rows]) => `<div class="pp-group">${esc(label)} · ${rows.length}</div>${rows.map(row).join('')}`).join('') : `<div class="pp-empty"><strong>${q ? 'Nada encontrado' : 'Nenhum job ainda'}</strong>${q ? 'Tente outra busca.' : 'Envie um trabalho e ele aparece aqui quando a equipe aceitar.'}</div>`}
          ${state.projects.length ? `<div class="pp-group">Projetos · ${state.projects.length}</div>${state.projects.map((p) => `<div class="pp-row" style="cursor:default"><span class="pp-row-main"><span class="pp-row-top"><strong>${esc(p.name || 'Projeto')}</strong><span>${p.number ? `nº ${esc(p.number)}` : ''}</span></span><span class="pp-row-sub">${esc(p.address || '')}</span></span></div>`).join('')}` : ''}
        </aside>
        <section class="pp-main" id="ppJobPane" aria-label="Job">${selectedId ? '<div class="pp-card pp-empty">Carregando o job…</div>' : '<div class="pp-card pp-empty"><strong>Escolha um job</strong>Os detalhes aparecem aqui.</div>'}</section>
      </div>`;

    view.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => { state.jobStage = b.getAttribute('data-stage'); render(); }));
    view.querySelectorAll('[data-job]').forEach((b) => b.addEventListener('click', () => { location.hash = `#jobs/${encodeURIComponent(b.getAttribute('data-job'))}`; }));
    const search = $('ppJobSearch');
    search.addEventListener('input', () => {
      state.q = search.value;
      $('ppSearch').value = state.q;
      const pos = search.selectionStart;
      render().then(() => { const s = $('ppJobSearch'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } });
    });
    if (selectedId) {
      if (id) document.body.classList.add('pp-focus');
      const data = await loadJob(selectedId).catch((err) => ({ error: err.message }));
      if (token !== renderToken) return;
      $('ppJobPane').innerHTML = data.error ? `<p class="pp-error">${esc(data.error)}</p>` : jobDetailHtml(data);
      bindJobDetail(data);
    }
  }

  function photoColumns(photos) {
    const cols = [['before', 'Antes'], ['during', 'Durante'], ['after', 'Depois']];
    const general = photos.filter((p) => !['before', 'during', 'after'].includes(p.stage));
    const thumb = (p) => p.type === 'video'
      ? `<a class="pp-thumb pp-thumb-empty" href="${esc(p.file_url)}" target="_blank" rel="noopener">Vídeo${p.caption ? ` · ${esc(p.caption)}` : ''}</a>`
      : `<a class="pp-thumb" href="${esc(p.file_url)}" target="_blank" rel="noopener"><img src="${esc(p.file_url)}" alt="${esc(p.caption || 'Foto da obra')}" loading="lazy" /></a>`;
    const html = cols.map(([key, label]) => {
      const list = photos.filter((p) => p.stage === key);
      return `<div class="pp-photo-col"><span class="pp-lbl">${label} · ${list.length}</span>${list.length ? list.slice(0, 4).map(thumb).join('') : '<div class="pp-thumb-empty">Sem fotos ainda</div>'}</div>`;
    }).join('');
    const extra = general.length ? `<div><span class="pp-lbl">Geral · ${general.length}</span><div class="pp-photos" style="margin-top:8px">${general.slice(0, 6).map(thumb).join('')}</div></div>` : '';
    return `<div class="pp-photos">${html}</div>${extra}`;
  }

  function jobNextStep(job, invoices) {
    const i = jobStepIndex(job);
    const start = toDate(job.scheduled_start);
    const end = toDate(job.scheduled_end);
    const open = invoices.filter((inv) => invoiceState(inv).key !== 'paid');
    if (i === 3) {
      if (open.length) {
        const inv = open[0];
        return { title: `Invoice ${inv.number || ''} · ${money(inv.balance)}`, text: invoiceState(inv).label, action: `<a class="pp-btn pp-btn--light" href="#invoices/${encodeURIComponent(inv.id)}">Ver invoice</a>` };
      }
      return { title: 'Job concluído', text: 'Fotos e relatórios liberados pela equipe ficam nesta página.', action: '' };
    }
    if (i === 2) return { title: end ? `Equipe na obra até ${fmtWeekday(end)}` : 'Equipe na obra', text: 'As fotos do dia aparecem aqui quando a equipe libera.', action: '' };
    if (i === 1 && start) {
      const late = jobLate({ ...job, scheduledStart: job.scheduled_start, scheduledEnd: job.scheduled_end });
      if (late) return { title: `A data passou há ${plural(late, 'dia', 'dias')}`, text: 'Mande uma mensagem pela atualização se algo mudou na obra.', action: `<button type="button" class="pp-btn pp-btn--light" data-update-job>Enviar atualização</button>` };
      return { title: `Na obra ${fmtWeekday(start)}${job.all_day ? '' : `, ${fmtTime(start)}`}`, text: 'Garanta o acesso ao imóvel nesse dia.', action: `<button type="button" class="pp-btn pp-btn--light" data-update-job>Enviar atualização</button>` };
    }
    return { title: 'A equipe vai agendar', text: 'Você recebe a data aqui assim que o job for agendado.', action: `<button type="button" class="pp-btn pp-btn--light" data-update-job>Enviar atualização</button>` };
  }

  function jobDetailHtml(data) {
    const job = data.job;
    const i = jobStepIndex(job);
    const dates = [
      job.created_at ? fmtDay(job.created_at) : '',
      job.scheduled_start ? fmtDay(job.scheduled_start) : '',
      job.scheduled_start && i >= 2 ? fmtDay(job.scheduled_start) : '',
      i === 3 ? fmtDay(job.updated_at) : '',
    ];
    const next = jobNextStep(job, data.invoices || []);
    const chips = [
      jobChip(job),
      job.number ? `<span class="pp-chip">Job #${esc(job.number)}</span>` : '',
      job.external_ref ? `<span class="pp-chip">Seu nº ${esc(job.external_ref)}</span>` : '',
    ].join('');
    const docs = data.documents || [];
    const invoices = data.invoices || [];
    const requests = data.requests || [];
    return `
      <div class="pp-card pp-detail-head">
        <button type="button" class="pp-back" data-back="#jobs">${icon('back')}Jobs</button>
        <div class="pp-chips">${chips}</div>
        <div class="pp-detail-title">
          <div><h2>${esc(job.title || 'Job')}</h2><p>${esc(job.address || 'Sem endereço')}</p></div>
          <div class="pp-head-actions"><button type="button" class="pp-btn pp-btn--sec" data-update-job>Enviar atualização</button></div>
        </div>
        <div>${barsWithLabels(i, JOB_STEPS, i === 3, dates)}</div>
      </div>
      <div class="pp-cols">
        <div class="pp-col-main">
          <div class="pp-facts">
            <div class="pp-card pp-fact"><span class="pp-lbl">Início</span><b>${job.scheduled_start ? esc(fmtWeekday(job.scheduled_start)) : '—'}</b></div>
            <div class="pp-card pp-fact"><span class="pp-lbl">Término</span><b>${job.scheduled_end ? esc(fmtWeekday(job.scheduled_end)) : '—'}</b></div>
            <div class="pp-card pp-fact"><span class="pp-lbl">Equipe</span><b>${esc(job.crew || '—')}</b></div>
          </div>
          <div class="pp-card pp-block" id="ppPhotos">
            <div class="pp-block-head"><h3>Fotos · ${data.photos.length}</h3><a class="pp-link" href="#documentos" style="font-size:13px">Todas as fotos</a></div>
            ${photoColumns(data.photos)}
          </div>
        </div>
        <div class="pp-col-side">
          <div class="pp-card pp-block pp-next"><span class="pp-lbl">Próximo passo</span><strong>${esc(next.title)}</strong><p>${esc(next.text)}</p>${next.action ? `<div>${next.action}</div>` : ''}</div>
          <div class="pp-card pp-block">
            <h3>Documentos</h3>
            ${docs.length ? docs.map((d) => `<a class="pp-doc" href="${esc(d.file_url)}" target="_blank" rel="noopener"><span class="pp-doc-ico">${d.type === 'report' ? 'PDF' : d.type === 'sent' ? 'SEU' : 'ARQ'}</span><span>${esc(d.title)}</span></a>`).join('') : '<p class="pp-muted" style="margin:0;font-size:14px">Relatórios e arquivos liberados pela equipe aparecem aqui.</p>'}
          </div>
          <div class="pp-card pp-block">
            <h3>Invoices</h3>
            ${invoices.length ? invoices.map((inv) => `<a class="pp-doc" href="#invoices/${encodeURIComponent(inv.id)}"><span class="pp-doc-ico">INV</span><span>${esc(inv.number || 'Invoice')} · ${money(inv.amount)} · ${esc(invoiceState(inv).label)}</span></a>`).join('') : '<p class="pp-muted" style="margin:0;font-size:14px">Nenhuma invoice deste job ainda.</p>'}
          </div>
          ${requests.length ? `<div class="pp-card pp-block"><h3>Seus pedidos</h3>${requests.map((r) => `<div class="pp-req" style="padding:8px 0"><div class="pp-req-top"><strong>${esc(r.title)}</strong>${requestStatus(r)}</div><p>${esc(fmtDay(r.created_at))}${r.notes ? ` · ${esc(r.notes)}` : ''}</p>${r.review_note ? `<p class="pp-reply">${esc(r.review_note)}</p>` : ''}</div>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="pp-fixbar"><a class="pp-btn pp-btn--sec" href="#ppPhotos">Fotos</a><button type="button" class="pp-btn pp-btn--pri" data-update-job>Enviar atualização</button></div>`;
  }

  function bindJobDetail(data) {
    if (!data || data.error) return;
    view.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { location.hash = b.getAttribute('data-back'); }));
    view.querySelectorAll('[data-update-job]').forEach((b) => b.addEventListener('click', () => {
      state.send = newSend();
      state.send.presetJob = { id: data.job.id, number: data.job.number, title: data.job.title, address: data.job.address };
      location.hash = '#enviar';
    }));
  }

  /* ─────────────────────────── invoices ─────────────────────────── */

  async function renderInvoices(id, token) {
    await loadInvoices();
    if (token !== renderToken) return;
    const q = state.q.trim().toLowerCase();
    const all = state.invoices;
    const withState = all.map((inv) => ({ inv, st: invoiceState(inv) }));
    const open = withState.filter((x) => x.st.key !== 'paid');
    const sum = (rows) => rows.reduce((s, x) => s + Number(x.inv.balance || 0), 0);
    const overdue = open.filter((x) => x.st.key === 'overdue');
    const soon = open.filter((x) => x.st.key === 'soon');
    const paid30 = withState.filter((x) => x.st.key === 'paid' && x.inv.paid_at && daysBetween(toDate(x.inv.paid_at), new Date()) <= 30);
    const filters = {
      open: (x) => x.st.key !== 'paid',
      overdue: (x) => x.st.key === 'overdue',
      paid: (x) => x.st.key === 'paid',
      all: () => true,
    };
    const matches = (x) => !q || [x.inv.number, invoiceRef(x.inv), x.inv.job && x.inv.job.address, x.inv.job && x.inv.job.number].filter((v) => v != null).join(' ').toLowerCase().includes(q);
    const list = withState.filter(filters[state.invoiceFilter] || filters.open).filter(matches);
    const groups = [
      ['Vencidas', list.filter((x) => x.st.key === 'overdue')],
      ['Vencem em 7 dias', list.filter((x) => x.st.key === 'soon')],
      ['Em aberto', list.filter((x) => x.st.key === 'open')],
      ['Pagas', list.filter((x) => x.st.key === 'paid')],
    ].filter(([, rows]) => rows.length);
    const firstId = groups[0] && groups[0][1][0] && groups[0][1][0].inv.id;
    const selectedId = id || (window.matchMedia('(max-width: 767px)').matches ? '' : firstId || '');
    const selected = withState.find((x) => x.inv.id === selectedId);
    const filterBtn = (key, label, rows) => `<button type="button" class="pp-stage" data-inv-filter="${key}" aria-pressed="${state.invoiceFilter === key}">${esc(label)} · ${rows.length}<b>${moneyShort(sum(rows.map ? rows : []))}</b></button>`;
    const totalOf = (rows) => rows.reduce((s, x) => s + Number(x.inv.amount || 0), 0);

    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(providerName())}</p><h1>Invoices</h1></div></div>
      <div class="pp-nums">
        <div class="pp-card pp-num"><span class="pp-lbl">Em aberto</span><b>${money(sum(open))}</b></div>
        <div class="pp-card pp-num"><span class="pp-lbl">Vencido</span><b class="${overdue.length ? 'pp-late' : ''}">${money(sum(overdue))}</b></div>
        <div class="pp-card pp-num"><span class="pp-lbl">Vence em 7 dias</span><b>${money(sum(soon))}</b></div>
        <div class="pp-card pp-num pp-hide-phone"><span class="pp-lbl">Pago · 30 dias</span><b>${money(totalOf(paid30))}</b></div>
      </div>
      <div class="pp-stages" role="group" aria-label="Situação">
        ${filterBtn('open', 'Em aberto', open)}
        ${filterBtn('overdue', 'Vencidas', overdue)}
        <button type="button" class="pp-stage" data-inv-filter="paid" aria-pressed="${state.invoiceFilter === 'paid'}">Pagas · ${withState.filter((x) => x.st.key === 'paid').length}<b>${moneyShort(totalOf(withState.filter((x) => x.st.key === 'paid')))}</b></button>
        <button type="button" class="pp-stage" data-inv-filter="all" aria-pressed="${state.invoiceFilter === 'all'}">Todas · ${all.length}<b>${moneyShort(totalOf(withState))}</b></button>
      </div>
      <div class="pp-split pp-split--list ${id ? 'is-open' : ''}">
        <aside class="pp-card pp-side" aria-label="Lista de invoices">
          <div class="pp-side-search"><label>${icon('search')}<span class="pp-sr">Buscar invoices</span><input id="ppInvSearch" type="search" placeholder="Nº, endereço ou job" value="${esc(state.q)}" /></label></div>
          ${groups.length ? groups.map(([label, rows]) => `<div class="pp-group">${esc(label)} · ${rows.length}</div>${rows.map((x) => `<button type="button" class="pp-row" data-inv="${esc(x.inv.id)}" aria-current="${x.inv.id === selectedId}"><span class="pp-row-main"><span class="pp-row-top"><strong>${esc(invoiceRef(x.inv))}</strong><span style="color:var(--pp-ink);font-weight:600">${money(x.st.key === 'paid' ? x.inv.amount : x.inv.balance)}</span></span><span class="pp-row-sub">${esc(x.inv.number || 'Invoice')}${x.inv.job && x.inv.job.number ? ` · Job #${esc(x.inv.job.number)}` : ''}</span><span class="pp-row-next ${['overdue', 'soon'].includes(x.st.key) ? 'pp-late' : ''}">${esc(x.st.label)}</span></span></button>`).join('')}`).join('') : `<div class="pp-empty"><strong>${all.length ? 'Nada nesta lista' : 'Nenhuma invoice ainda'}</strong>${all.length ? 'Troque o filtro ou a busca.' : 'As invoices emitidas pelo fornecedor aparecem aqui.'}</div>`}
        </aside>
        <section class="pp-main" aria-label="Invoice">${selected ? invoiceDetailHtml(selected.inv, selected.st) : '<div class="pp-card pp-empty"><strong>Escolha uma invoice</strong>Os detalhes aparecem aqui.</div>'}</section>
      </div>`;
    if (id) document.body.classList.add('pp-focus');
    view.querySelectorAll('[data-inv-filter]').forEach((b) => b.addEventListener('click', () => { state.invoiceFilter = b.getAttribute('data-inv-filter'); location.hash = '#invoices'; render(); }));
    view.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', () => { location.hash = `#invoices/${encodeURIComponent(b.getAttribute('data-inv'))}`; }));
    view.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { location.hash = b.getAttribute('data-back'); }));
    const search = $('ppInvSearch');
    search.addEventListener('input', () => {
      state.q = search.value;
      $('ppSearch').value = state.q;
      const pos = search.selectionStart;
      render().then(() => { const s = $('ppInvSearch'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } });
    });
  }

  function invoiceDetailHtml(inv, st) {
    const job = inv.job || {};
    const paid = st.key === 'paid';
    const steps = ['Emitida', 'Vencimento', 'Paga'];
    const idx = paid ? 2 : 1;
    const labels = [fmtDay(inv.issued_at), inv.due_date ? fmtDay(dateOnly(inv.due_date)) : '', inv.paid_at ? fmtDay(inv.paid_at) : ''];
    const next = paid
      ? { title: `Paga${inv.paid_at ? ` em ${fmtDay(inv.paid_at)}` : ''}`, text: 'Obrigado! O recibo fica disponível na invoice.' }
      : st.key === 'overdue'
        ? { title: `Pagar ${money(inv.balance)}`, text: `${st.label}. Abra a invoice para ver as formas de pagamento.` }
        : { title: `Pagar ${money(inv.balance)}${inv.due_date ? ` até ${fmtDay(dateOnly(inv.due_date))}` : ''}`, text: 'Abra a invoice para ver as formas de pagamento.' };
    return `
      <div class="pp-card pp-detail-head">
        <button type="button" class="pp-back" data-back="#invoices">${icon('back')}Invoices</button>
        <div class="pp-chips">${st.chip}${job.number ? `<span class="pp-chip">Job #${esc(job.number)}</span>` : ''}</div>
        <div class="pp-detail-title">
          <div><h2>${esc(inv.number || 'Invoice')} · ${money(inv.amount)}</h2><p>${esc(invoiceRef(inv))}${job.address && job.address !== invoiceRef(inv) ? ` · ${esc(job.address)}` : ''}</p></div>
          <div class="pp-head-actions">${job.id ? `<a class="pp-btn pp-btn--sec" href="#jobs/${encodeURIComponent(job.id)}">Abrir job</a>` : ''}${inv.invoice_url ? `<a class="pp-btn pp-btn--pri" href="${esc(inv.invoice_url)}" target="_blank" rel="noopener">Abrir invoice</a>` : ''}</div>
        </div>
        <div>${barsWithLabels(idx, steps, paid, labels)}</div>
      </div>
      <div class="pp-cols">
        <div class="pp-col-main">
          <div class="pp-card pp-block">
            <h3>Resumo</h3>
            <dl class="pp-dl">
              <dt>Valor</dt><dd>${money(inv.amount)}</dd>
              <dt>Pago</dt><dd>${money(inv.paid_amount)}</dd>
              <dt style="color:var(--pp-ink);font-weight:600">Saldo</dt><dd style="font-weight:700">${money(inv.balance)}</dd>
              <dt>Emitida</dt><dd>${esc(fmtDay(inv.issued_at, { day: 'numeric', month: 'short', year: 'numeric' }) || '—')}</dd>
              <dt>Vencimento</dt><dd>${inv.due_date ? esc(fmtDay(dateOnly(inv.due_date), { day: 'numeric', month: 'short', year: 'numeric' })) : '—'}</dd>
            </dl>
          </div>
        </div>
        <div class="pp-col-side">
          <div class="pp-card pp-block pp-next"><span class="pp-lbl">Próximo passo</span><strong>${esc(next.title)}</strong><p>${esc(next.text)}</p>${inv.invoice_url ? `<div><a class="pp-btn pp-btn--light" href="${esc(inv.invoice_url)}" target="_blank" rel="noopener">Abrir invoice</a></div>` : ''}</div>
        </div>
      </div>
      <div class="pp-fixbar">${job.id ? `<a class="pp-btn pp-btn--sec" href="#jobs/${encodeURIComponent(job.id)}">Abrir job</a>` : '<span></span>'}${inv.invoice_url ? `<a class="pp-btn pp-btn--pri" href="${esc(inv.invoice_url)}" target="_blank" rel="noopener">Abrir invoice</a>` : ''}</div>`;
  }

  /* ─────────────────────────── calendar ─────────────────────────── */

  function renderCalendar() {
    const month = state.calMonth;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = first.getDay();
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const today = dateKey(new Date());
    const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const days = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dateKey(d);
      const jobs = jobsInDay(key);
      const cls = ['pp-cal-day', d.getMonth() !== month.getMonth() ? 'is-out' : '', key === today ? 'is-today' : '', key === state.calDay ? 'is-sel' : '', jobs.length ? 'has-ev' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-day="${key}" aria-label="${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${jobs.length ? `, ${plural(jobs.length, 'job', 'jobs')}` : ''}" aria-pressed="${key === state.calDay}"><span class="pp-cal-num">${d.getDate()}</span>${jobs.slice(0, 2).map((j) => `<span class="pp-cal-ev">${esc(j.title || 'Job')}</span>`).join('')}${jobs.length > 2 ? `<span class="pp-cal-more">+${jobs.length - 2}</span>` : ''}</button>`;
    }).join('');
    const sel = jobsInDay(state.calDay).sort((a, b) => toDate(a.scheduledStart) - toDate(b.scheduledStart));
    const selDate = new Date(`${state.calDay}T12:00:00`);
    const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(month);
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(providerName())}</p><h1>Calendário</h1></div></div>
      <div class="pp-split">
        <section class="pp-card pp-cal pp-main" aria-label="Mês">
          <div class="pp-cal-head"><strong>${esc(monthLabel)}</strong><div class="pp-cal-ctrl"><button type="button" class="pp-ibtn" data-month="prev" aria-label="Mês anterior">‹</button><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-month="today">Hoje</button><button type="button" class="pp-ibtn" data-month="next" aria-label="Próximo mês">›</button></div></div>
          <div class="pp-cal-grid">${weekdays.map((w) => `<div class="pp-cal-wd">${w}</div>`).join('')}${days}</div>
        </section>
        <aside class="pp-card pp-side" aria-label="Dia escolhido" style="max-width:420px">
          <div style="padding:16px 16px 4px"><p class="pp-eyebrow" style="text-transform:capitalize">${esc(fmtDay(selDate, { weekday: 'long' }))}</p><h2 style="margin:0;font-size:22px">${esc(fmtDay(selDate, { day: 'numeric', month: 'long' }))}</h2><p class="pp-muted" style="margin:4px 0 0;font-size:14px">${sel.length ? plural(sel.length, 'job', 'jobs') : 'Nenhum job neste dia'}</p></div>
          ${sel.map((j) => `<button type="button" class="pp-row" data-job="${esc(j.id)}"><span class="pp-row-main"><span class="pp-row-top"><strong>${esc(j.title || 'Job')}</strong><span>${j.allDay ? 'Dia todo' : esc(fmtTime(j.scheduledStart))}</span></span><span class="pp-row-sub">${esc(j.address || '')}</span><span class="pp-row-next">${jobChip(j)}</span></span></button>`).join('')}
          <div style="padding:12px 16px 16px"><a class="pp-btn pp-btn--sec pp-btn--sm" href="#enviar">Enviar trabalho</a></div>
        </aside>
      </div>`;
    view.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
      const a = b.getAttribute('data-month');
      if (a === 'prev') state.calMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
      if (a === 'next') state.calMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      if (a === 'today') { state.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); state.calDay = dateKey(new Date()); }
      renderCalendar();
    }));
    view.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { state.calDay = b.getAttribute('data-day'); renderCalendar(); }));
    view.querySelectorAll('[data-job]').forEach((b) => b.addEventListener('click', () => { location.hash = `#jobs/${encodeURIComponent(b.getAttribute('data-job'))}`; }));
  }

  /* ─────────────────────────── send work ─────────────────────────── */

  const FIELD_LABELS = {
    address: 'Endereço da obra', title: 'Título do job', community: 'Comunidade', lot: 'Lote', plan: 'Plano',
    external_ref: 'Seu nº do job / PO', service_type: 'Serviço', preferred_date: 'Data desejada', square_feet: 'Área (sq ft)',
    material: 'Material', contact_name: 'Contato no local', contact_phone: 'Telefone', contact_email: 'E-mail', notes: 'Observações para a equipe',
  };
  const FIELD_ORDER = ['address', 'title', 'community', 'lot', 'plan', 'external_ref', 'service_type', 'preferred_date', 'square_feet', 'material', 'contact_name', 'contact_phone', 'contact_email', 'notes'];

  function newSend() {
    return { phase: 'pick', files: [], text: '', showPaste: false, fields: null, check: [], warnings: [], match: null, mode: 'new', ai: false, model: '', error: '', presetJob: null, sent: null };
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }
  /** Big phone photos are shrunk to keep uploads under the 10 MB limit (and readable for the AI). */
  async function compressImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return null;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
      return { dataUrl, size, type: 'image/jpeg', name: file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg' };
    } catch (_) {
      return null;
    }
  }
  async function addFiles(fileList) {
    const s = state.send;
    s.error = '';
    for (const file of Array.from(fileList || [])) {
      if (s.files.length >= MAX_FILES) { s.error = `Envie até ${MAX_FILES} arquivos por vez.`; break; }
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) { s.error = `${file.name}: use PDF, JPG, PNG ou WebP.`; continue; }
      const small = await compressImage(file);
      const dataUrl = small ? small.dataUrl : await readAsDataUrl(file);
      const entry = { name: small ? small.name : file.name, type: small ? small.type : file.type, size: small ? small.size : file.size, dataUrl };
      entry.url = URL.createObjectURL(small ? dataUrlToBlob(dataUrl) : file);
      s.files.push(entry);
    }
    const total = s.files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_BYTES) s.error = 'Os arquivos passam de 10 MB juntos. Tire algum ou envie em partes.';
  }
  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const type = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }
  async function startSendWithFiles(files) {
    state.send = newSend();
    await addFiles(files);
    if (location.hash !== '#enviar') location.hash = '#enviar';
    else render();
    if (!state.send.error) readWithAi();
  }

  async function readWithAi() {
    const s = state.send;
    if (!s.files.length && !s.text.trim()) { s.error = 'Escolha um arquivo ou cole o texto do pedido.'; return renderSendBody(); }
    if (s.files.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) return renderSendBody();
    s.phase = 'reading';
    s.error = '';
    renderSendBody();
    try {
      const r = await postJson('/api/partner-portal/requests/read', { text: s.text, files: s.files.map((f) => ({ name: f.name, data_url: f.dataUrl })) });
      const data = r.data || {};
      if (!data.ai_available) {
        s.fields = emptyFields();
        s.ai = false;
        s.warnings = ['A leitura automática não está ligada nesta empresa. Preencha os campos abaixo.'];
      } else {
        s.fields = Object.assign(emptyFields(), data.fields || {});
        s.check = data.check || [];
        s.warnings = data.warnings || [];
        s.ai = true;
        s.model = data.model || '';
        s.match = data.match || null;
        s.mode = s.presetJob || s.match ? 'update' : 'new';
      }
      if (s.presetJob) s.match = s.presetJob;
      s.phase = 'review';
    } catch (err) {
      s.phase = 'review';
      s.fields = emptyFields();
      s.ai = false;
      if (s.presetJob) { s.match = s.presetJob; s.mode = 'update'; }
      s.warnings = [`${err.message || 'Não consegui ler o arquivo.'} Preencha os campos abaixo — o arquivo vai junto do pedido.`];
    }
    renderSendBody();
  }
  function emptyFields() {
    return FIELD_ORDER.reduce((o, k) => { o[k] = ''; return o; }, {});
  }
  function manualEntry() {
    const s = state.send;
    s.fields = emptyFields();
    s.ai = false;
    s.check = [];
    s.warnings = [];
    if (s.presetJob) {
      s.match = s.presetJob;
      s.mode = 'update';
      s.fields.address = s.presetJob.address || '';
      s.fields.title = `Atualização · ${s.presetJob.title || ''}`.slice(0, 160);
    }
    s.phase = 'review';
    renderSendBody();
  }

  async function renderSend(token) {
    if (!state.send) state.send = newSend();
    await loadRequests().catch(() => {});
    if (token !== renderToken) return;
    view.innerHTML = `
      <div class="pp-head">
        <div><p class="pp-eyebrow">${esc(providerName())}</p><h1>Enviar trabalho</h1></div>
        <ol class="pp-steps" id="ppSteps" aria-label="Etapas"></ol>
      </div>
      <div class="pp-split" style="align-items:flex-start">
        <section class="pp-main" id="ppSendBody"></section>
        <aside class="pp-card pp-side" aria-labelledby="ppReqTitle" id="ppReqs"></aside>
      </div>`;
    renderSendBody();
    renderRequestsList();
  }

  function renderRequestsList() {
    const box = $('ppReqs');
    if (!box) return;
    const rows = state.requests;
    box.innerHTML = `<div style="padding:16px 16px 8px"><h2 id="ppReqTitle" style="margin:0;font-size:17px">Seus pedidos</h2><p class="pp-muted" style="margin:2px 0 0;font-size:13px">${rows.filter((r) => r.status === 'pending').length} aguardando a equipe</p></div>
      ${rows.length ? rows.slice(0, 30).map((r) => `<div class="pp-req">
        <div class="pp-req-top"><strong>${esc(r.title)}</strong>${requestStatus(r)}</div>
        <p>${esc(r.address)}${r.external_ref ? ` · seu nº ${esc(r.external_ref)}` : ''}</p>
        <p>Enviado ${esc(fmtDay(r.created_at))}${r.preferred_date ? ` · para ${esc(fmtDay(dateOnly(r.preferred_date)))}` : ''}${r.read_by_ai ? ' · lido pela IA' : ''}${r.target_job_id ? ' · atualização de job' : ''}</p>
        ${r.review_note ? `<p class="pp-reply">${esc(r.review_note)}</p>` : ''}
        ${r.job_id ? `<p><a class="pp-link" href="#jobs/${encodeURIComponent(r.job_id)}">Abrir job</a></p>` : ''}
      </div>`).join('') : '<div class="pp-empty" style="padding:20px 16px">Você ainda não enviou pedidos.</div>'}`;
  }

  function stepsHtml(phase) {
    const idx = phase === 'pick' ? 0 : phase === 'done' ? 2 : 1;
    return ['1 · Arquivo', '2 · Conferir', '3 · Enviado'].map((label, i) => `<li class="${i === idx ? 'on' : ''}">${label}</li>`).join('');
  }

  function renderSendBody() {
    const box = $('ppSendBody');
    if (!box) return;
    const s = state.send;
    const steps = $('ppSteps');
    if (steps) steps.innerHTML = stepsHtml(s.phase);
    document.body.classList.toggle('pp-focus', s.phase === 'review');

    if (s.phase === 'reading') {
      box.innerHTML = `<div class="pp-card pp-reading" role="status">
        <div style="display:flex;gap:12px;align-items:center"><span class="pp-doc-ico" style="width:44px;height:44px">${s.files[0] && s.files[0].type === 'application/pdf' ? 'PDF' : s.files.length ? 'IMG' : 'TXT'}</span><div><strong>${esc(s.files.length ? s.files.map((f) => f.name).join(', ') : 'Texto colado')}</strong><div class="pp-muted" style="font-size:13px">Lendo endereço, nº do job, data e serviço…</div></div></div>
        <div class="pp-progress"><i></i></div>
        <p class="pp-muted" style="margin:0;font-size:14px">Leva alguns segundos. Nada é enviado antes de você conferir.</p>
      </div>`;
      return;
    }

    if (s.phase === 'done') {
      const updated = s.sent && s.sent.update;
      box.innerHTML = `<div class="pp-card pp-reading">
        <h2 style="margin:0;font-size:24px">${updated ? 'Atualização enviada' : 'Pedido enviado'}</h2>
        <p class="pp-muted" style="margin:0">A equipe de ${esc(providerName())} confere e responde aqui. ${updated ? 'O job continua o mesmo, com as fotos e invoices juntos.' : 'Quando aceitarem, o job aparece em Jobs.'}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="pp-btn pp-btn--pri" id="ppSendAnother">Enviar outro</button><a class="pp-btn pp-btn--sec" href="#jobs">Ver jobs</a></div>
      </div>`;
      $('ppSendAnother').addEventListener('click', () => { state.send = newSend(); renderSendBody(); });
      return;
    }

    if (s.phase === 'review') {
      box.innerHTML = reviewHtml(s);
      bindReview();
      return;
    }

    const files = s.files.map((f, i) => `<span class="pp-file">${esc(f.name)} · ${fileSize(f.size)}<button type="button" data-remove="${i}" aria-label="Tirar ${esc(f.name)}">×</button></span>`).join('');
    box.innerHTML = `
      ${s.presetJob ? `<div class="pp-match"><strong>Atualização de ${esc(s.presetJob.title || 'job')}</strong><span class="pp-muted" style="font-size:14px">${esc(s.presetJob.address || '')} · envie a nova ordem, foto ou texto. Ela vai junto desse job.</span></div>` : ''}
      <button type="button" class="pp-bigdrop" id="ppBigDrop">
        ${icon('upload')}
        <strong>Solte os arquivos aqui ou clique para escolher</strong>
        <span>Ordem de serviço, PO, agenda, planta · PDF, JPG, PNG ou WebP · até 5 arquivos, 10 MB</span>
      </button>
      ${files ? `<div class="pp-files">${files}</div>` : ''}
      ${s.showPaste ? `<div class="pp-paste pp-field"><label for="ppPaste">Cole o texto do e-mail ou do sistema</label><textarea id="ppPaste" maxlength="20000" placeholder="Ex.: Job# 172369 · 109 Evergreen Dr · Install - Hardwood · Monday, October 26th…">${esc(s.text)}</textarea></div>` : ''}
      ${s.error ? `<p class="pp-error" role="alert">${esc(s.error)}</p>` : ''}
      ${s.files.length || (s.showPaste && s.text.trim()) ? `<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end"><button type="button" class="pp-btn pp-btn--sec" id="ppManual2">Preencher à mão</button><button type="button" class="pp-btn pp-btn--pri" id="ppRead">Ler e preencher</button></div>` : ''}
      <div class="pp-sources">
        <button type="button" class="pp-source" id="ppCam">${icon('camera')}<span>Tirar foto<small>Papel ou tela do seu sistema</small></span></button>
        <button type="button" class="pp-source" id="ppPasteBtn">${icon('text')}<span>Colar texto<small>E-mail ou aviso do sistema</small></span></button>
        <button type="button" class="pp-source" id="ppManual">${icon('pen')}<span>Preencher à mão<small>Sem arquivo</small></span></button>
      </div>`;
    const drop = $('ppBigDrop');
    drop.addEventListener('click', () => $('ppFileInput').click());
    bindDrop(drop, async (fl) => { await addFiles(fl); renderSendBody(); });
    box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const f = s.files.splice(Number(b.getAttribute('data-remove')), 1)[0];
      if (f && f.url) URL.revokeObjectURL(f.url);
      s.error = '';
      renderSendBody();
    }));
    $('ppCam').addEventListener('click', () => $('ppCameraInput').click());
    $('ppPasteBtn').addEventListener('click', () => { s.showPaste = true; renderSendBody(); const t = $('ppPaste'); if (t) t.focus(); });
    $('ppManual').addEventListener('click', manualEntry);
    const paste = $('ppPaste');
    if (paste) paste.addEventListener('input', () => {
      const had = Boolean(s.text.trim());
      s.text = paste.value;
      if (had !== Boolean(s.text.trim())) { renderSendBody(); const t = $('ppPaste'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
    });
    const read = $('ppRead');
    if (read) read.addEventListener('click', readWithAi);
    const m2 = $('ppManual2');
    if (m2) m2.addEventListener('click', manualEntry);
  }

  function originalHtml(s) {
    if (!s.files.length && !s.text.trim()) return '';
    const parts = s.files.map((f) => f.type === 'application/pdf'
      ? `<iframe src="${esc(f.url)}" title="${esc(f.name)}"></iframe>`
      : `<img src="${esc(f.url)}" alt="${esc(f.name)}" />`).join('');
    const text = s.text.trim() ? `<pre>${esc(s.text)}</pre>` : '';
    return `<section class="pp-card pp-original" aria-label="Original"><span class="pp-lbl">Original${s.files.length ? ` · ${esc(s.files.map((f) => f.name).join(', '))}` : ''}</span>${parts}${text}</section>`;
  }

  function reviewHtml(s) {
    const f = s.fields || emptyFields();
    const checked = s.check.length;
    const filled = FIELD_ORDER.filter((k) => f[k]).length;
    const field = (key, opts) => {
      const o = opts || {};
      const isCheck = s.ai && s.check.includes(key);
      const tag = s.ai && f[key] ? (isCheck ? '<span class="pp-tag-check">Confira</span>' : '<span class="pp-tag-ok">Certo</span>') : (isCheck ? '<span class="pp-tag-check">Confira</span>' : '');
      const req = o.required ? ' *' : '';
      const input = o.area
        ? `<textarea id="ppF-${key}" data-field="${key}" maxlength="${o.max || 5000}">${esc(f[key])}</textarea>`
        : `<input id="ppF-${key}" data-field="${key}" type="${o.type || 'text'}" ${o.required ? 'required' : ''} maxlength="${o.max || 200}" value="${esc(f[key])}" ${o.auto ? `autocomplete="${o.auto}"` : ''} />`;
      return `<div class="pp-field ${o.wide ? 'pp-field--wide' : ''} ${isCheck ? 'is-check' : ''}"><label for="ppF-${key}">${esc(FIELD_LABELS[key])}${req} ${tag}</label>${input}</div>`;
    };
    const match = s.match;
    const matchHtml = match ? `<div class="pp-match">
        <strong>${s.presetJob ? 'Atualização deste job' : match.reason === 'ref' ? `Você já enviou o nº ${esc(f.external_ref)}` : 'Você já tem um job neste endereço'}</strong>
        <span class="pp-muted" style="font-size:14px">${esc(match.title || 'Job')}${match.number ? ` · Job #${esc(match.number)}` : ''}${match.address && !String(match.title || '').toLowerCase().includes(String(match.address).toLowerCase()) ? ` · ${esc(match.address)}` : ''}. Atualizar mantém fotos, mensagens e invoices juntos.</span>
        <div class="pp-seg" role="group" aria-label="O que fazer">
          <button type="button" data-mode="update" aria-pressed="${s.mode === 'update'}">Atualizar esse job</button>
          <button type="button" data-mode="new" aria-pressed="${s.mode === 'new'}">Criar um job novo</button>
        </div>
      </div>` : '';
    return `
      <div class="pp-card" style="padding:16px 20px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center">
        <div><strong style="font-size:17px">${s.ai ? 'Confira o que lemos' : 'Dados do pedido'}</strong><div class="pp-muted" style="font-size:14px">${s.ai ? `${plural(filled, 'campo preenchido', 'campos preenchidos')}${checked ? ` · <span class="pp-late">${plural(checked, 'para conferir', 'para conferir')}</span>` : ''} · nada é enviado antes de você confirmar` : 'Preencha o que souber. Endereço e título são obrigatórios.'}</div></div>
        <button type="button" class="pp-link" id="ppRestart">Trocar arquivo</button>
      </div>
      <div class="pp-cols">
        ${originalHtml(s)}
        <form class="pp-card pp-form" id="ppReqForm" novalidate>
          ${matchHtml}
          ${s.warnings.map((w) => `<p class="pp-warn">${esc(w)}</p>`).join('')}
          <div class="pp-fields">
            ${field('address', { required: true, wide: true, max: 300, auto: 'street-address' })}
            ${field('title', { required: true, wide: true, max: 160 })}
            ${field('service_type', { max: 100 })}
            ${field('preferred_date', { type: 'date' })}
            ${field('external_ref', { max: 60 })}
            ${field('community', { max: 120 })}
            ${field('lot', { max: 20 })}
            ${field('plan', { max: 80 })}
            ${field('square_feet', { type: 'number' })}
            ${field('material', { max: 120 })}
            ${field('contact_name', { max: 120, auto: 'name' })}
            ${field('contact_phone', { type: 'tel', max: 40, auto: 'tel' })}
            ${field('contact_email', { type: 'email', max: 254, auto: 'email' })}
            ${field('notes', { wide: true, area: true, max: 4000 })}
          </div>
          <p class="pp-error" id="ppReqError" role="alert" hidden></p>
          <div class="pp-form-actions">
            <button type="button" class="pp-btn pp-btn--sec" id="ppDiscard">Descartar</button>
            <button type="submit" class="pp-btn pp-btn--pri" id="ppSubmit">${s.mode === 'update' && match ? 'Enviar atualização' : 'Enviar pedido'}</button>
          </div>
        </form>
      </div>
      <div class="pp-fixbar"><button type="button" class="pp-btn pp-btn--sec" data-discard>Descartar</button><button type="button" class="pp-btn pp-btn--pri" data-submit>${s.mode === 'update' && match ? 'Enviar atualização' : 'Enviar pedido'}</button></div>`;
  }

  function bindReview() {
    const s = state.send;
    view.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', () => {
      s.fields[el.getAttribute('data-field')] = el.value;
      el.closest('.pp-field').classList.remove('is-check');
    }));
    view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { s.mode = b.getAttribute('data-mode'); renderSendBody(); }));
    $('ppRestart').addEventListener('click', () => { const preset = s.presetJob; state.send = newSend(); state.send.presetJob = preset; renderSendBody(); });
    const discard = () => { state.send = newSend(); renderSendBody(); };
    $('ppDiscard').addEventListener('click', discard);
    view.querySelectorAll('[data-discard]').forEach((b) => b.addEventListener('click', discard));
    $('ppReqForm').addEventListener('submit', (e) => { e.preventDefault(); submitRequest(); });
    view.querySelectorAll('[data-submit]').forEach((b) => b.addEventListener('click', submitRequest));
  }

  async function submitRequest() {
    const s = state.send;
    const f = s.fields;
    const err = $('ppReqError');
    err.hidden = true;
    if (!f.address.trim() || f.address.trim().length < 4) { err.textContent = 'Informe o endereço da obra.'; err.hidden = false; $('ppF-address').focus(); return; }
    if (!f.title.trim()) f.title = [f.service_type, f.address].filter(Boolean).join(' · ').slice(0, 160);
    if (f.title.trim().length < 3) { err.textContent = 'Dê um título ao job.'; err.hidden = false; $('ppF-title').focus(); return; }
    if (f.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact_email)) { err.textContent = 'Confira o e-mail de contato.'; err.hidden = false; return; }
    const extra = [
      f.community ? `Comunidade: ${f.community}` : '',
      f.lot ? `Lote: ${f.lot}` : '',
      f.plan ? `Plano: ${f.plan}` : '',
      f.square_feet ? `Área: ${f.square_feet} sq ft` : '',
      f.material ? `Material: ${f.material}` : '',
    ].filter(Boolean).join(' · ');
    const notes = [f.notes.trim(), extra].filter(Boolean).join('\n');
    const update = s.mode === 'update' && s.match;
    const buttons = view.querySelectorAll('#ppSubmit, [data-submit]');
    buttons.forEach((b) => { b.disabled = true; b.textContent = 'Enviando…'; });
    try {
      await postJson('/api/partner-portal/requests', {
        title: f.title.trim().slice(0, 160),
        address: f.address.trim().slice(0, 300),
        contact_name: f.contact_name.trim(),
        contact_email: f.contact_email.trim(),
        contact_phone: f.contact_phone.trim(),
        service_type: f.service_type.trim().slice(0, 100),
        preferred_date: /^\d{4}-\d{2}-\d{2}$/.test(f.preferred_date) ? f.preferred_date : '',
        notes: notes.slice(0, 5000),
        external_ref: f.external_ref.trim().slice(0, 60),
        target_job_id: update ? s.match.id : '',
        files: s.files.map((x) => ({ name: x.name, data_url: x.dataUrl })),
        intake: { source: s.ai ? 'ai' : 'manual', fields_checked: s.check, ...(s.model ? { model: s.model.slice(0, 80) } : {}) },
      });
      s.files.forEach((x) => x.url && URL.revokeObjectURL(x.url));
      s.sent = { update: Boolean(update) };
      s.phase = 'done';
      await loadRequests(true).catch(() => {});
      renderSendBody();
      renderRequestsList();
      updateCounts();
    } catch (e) {
      err.textContent = e.message || 'Não foi possível enviar.';
      err.hidden = false;
      buttons.forEach((b) => { b.disabled = false; b.textContent = update ? 'Enviar atualização' : 'Enviar pedido'; });
    }
  }

  function bindDrop(el, onFiles) {
    if (!el) return;
    ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (e) => { e.preventDefault(); el.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => el.addEventListener(t, () => el.classList.remove('is-over')));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });
  }

  /* ─────────────────────────── documents ─────────────────────────── */

  async function renderDocuments(token) {
    if (!state.loaded.documents) view.innerHTML = '<div class="pp-card pp-empty">Carregando fotos e documentos…</div>';
    await loadDocuments();
    if (token !== renderToken) return;
    const q = state.docQuery.trim().toLowerCase();
    const list = state.documents.filter((d) => {
      const type = state.docFilter === 'all' || (state.docFilter === 'photo' ? ['photo', 'video'].includes(d.type) : d.type === state.docFilter);
      const text = [d.title, d.summary, d.job && d.job.title, d.job && d.job.number, d.job && d.job.address].filter(Boolean).join(' ').toLowerCase();
      return type && (!q || text.includes(q));
    });
    const btn = (key, label) => `<button type="button" data-doc-filter="${key}" aria-pressed="${state.docFilter === key}">${label}</button>`;
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">Liberados pela equipe de ${esc(providerName())}</p><h1>Fotos e docs</h1></div><span class="pp-muted">${plural(list.length, 'item', 'itens')}</span></div>
      <div class="pp-tools">
        <div class="pp-side-search"><label>${icon('search')}<span class="pp-sr">Buscar documentos</span><input id="ppDocSearch" type="search" placeholder="Obra ou documento" value="${esc(state.docQuery)}" /></label></div>
        <div class="pp-filter" role="group" aria-label="Tipo">${btn('all', 'Tudo')}${btn('photo', 'Fotos e vídeos')}${btn('report', 'Relatórios')}${btn('file', 'Arquivos')}</div>
      </div>
      ${list.length ? `<div class="pp-doc-grid">${list.map((d) => {
        const job = d.job || {};
        const prev = d.type === 'photo'
          ? `<a class="pp-doc-prev" href="${esc(d.file_url)}" target="_blank" rel="noopener"><img src="${esc(d.file_url)}" alt="${esc(d.title)}" loading="lazy" /></a>`
          : `<div class="pp-doc-prev" aria-hidden="true">${d.type === 'report' ? 'PDF' : d.type === 'video' ? 'VÍDEO' : 'ARQUIVO'}</div>`;
        return `<article class="pp-card pp-doc-card">${prev}<div class="pp-doc-body"><span class="pp-lbl">${d.type === 'photo' ? 'Foto' : d.type === 'video' ? 'Vídeo' : d.type === 'report' ? 'Relatório' : 'Arquivo'}${d.created_at ? ` · ${esc(fmtDay(d.created_at))}` : ''}</span><h3>${esc(d.title || 'Documento')}</h3><p>${job.id ? `<a class="pp-link" href="#jobs/${encodeURIComponent(job.id)}">${esc(job.title || 'Job')}${job.number ? ` · #${esc(job.number)}` : ''}</a>` : ''}</p>${job.address ? `<p>${esc(job.address)}</p>` : ''}<div class="pp-doc-actions"><a class="pp-btn pp-btn--sec pp-btn--sm" href="${esc(d.file_url)}" target="_blank" rel="noopener">Ver</a><a class="pp-btn pp-btn--sec pp-btn--sm" href="${esc(d.file_url)}?download=1">Baixar</a></div></div></article>`;
      }).join('')}</div>` : `<div class="pp-card pp-empty"><strong>${state.documents.length ? 'Nada encontrado' : 'Nada liberado ainda'}</strong>${state.documents.length ? 'Troque a busca ou o filtro.' : 'Quando a equipe liberar fotos, relatórios ou arquivos de uma obra, eles aparecem aqui.'}</div>`}`;
    view.querySelectorAll('[data-doc-filter]').forEach((b) => b.addEventListener('click', () => { state.docFilter = b.getAttribute('data-doc-filter'); render(); }));
    const s = $('ppDocSearch');
    s.addEventListener('input', () => { state.docQuery = s.value; const pos = s.selectionStart; render().then(() => { const x = $('ppDocSearch'); if (x) { x.focus(); x.setSelectionRange(pos, pos); } }); });
  }

  /* ─────────────────────────── more (phone) ─────────────────────────── */

  function renderMore() {
    const declined = state.requests.filter((r) => r.status === 'declined').length;
    const item = (href, label, sub, extra) => `<a class="pp-row" href="${href}" style="text-decoration:none;align-items:center"><span class="pp-row-main"><strong style="font-size:15px">${esc(label)}</strong>${sub ? `<span class="pp-row-sub">${esc(sub)}</span>` : ''}</span>${extra || ''}${icon('chev').replace('<svg', '<svg style="width:16px;height:16px;fill:none;stroke:#98A2B3;stroke-width:2.2"')}</a>`;
    view.innerHTML = `
      <div class="pp-head"><h1>Mais</h1></div>
      <div class="pp-card" style="overflow:hidden">
        ${item('#enviar', 'Enviar trabalho', 'PDF, foto ou texto')}
        ${item('#enviar', 'Seus pedidos', `${state.requests.filter((r) => r.status === 'pending').length} aguardando a equipe`, declined ? `<span class="pp-badge">${declined}</span>` : '')}
        ${item('#documentos', 'Fotos e docs', 'Liberados pela equipe')}
      </div>
      <div class="pp-card" style="overflow:hidden">
        <div style="padding:14px 16px"><strong>${esc(state.user.name || '')}</strong><div class="pp-muted" style="font-size:13px">${esc(state.user.email || '')}${state.user.company_name ? ` · ${esc(state.user.company_name)}` : ''}</div></div>
        ${state.providers.length > 1 ? `<button type="button" class="pp-row" id="ppMoreSwitch"><span class="pp-row-main"><strong style="font-size:15px">Trocar de fornecedor</strong><span class="pp-row-sub">Agora: ${esc(providerName())}</span></span></button>` : ''}
        <button type="button" class="pp-row" id="ppMoreLogout"><span class="pp-row-main"><strong style="font-size:15px" class="pp-late">Sair</strong></span></button>
      </div>`;
    const sw = $('ppMoreSwitch');
    if (sw) sw.addEventListener('click', () => { openMenu(true); });
    $('ppMoreLogout').addEventListener('click', logout);
  }

  /* ─────────────────────────── shell ─────────────────────────── */

  function openMenu(open) {
    const menu = $('ppMenu');
    menu.hidden = !open;
    $('ppAvatar').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) window.scrollTo({ top: 0 });
  }
  async function logout() {
    try { await api('/api/partner-auth/logout', { method: 'POST' }); } catch (_) { /* sign out locally anyway */ }
    location.replace('partner-login.html');
  }

  function renderPassword() {
    $('ppDock').hidden = true;
    $('ppTabs').hidden = true;
    $('ppSearchFab').hidden = true;
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">Primeiro acesso</p><h1>Crie sua senha</h1></div></div>
      <form class="pp-card pp-password" id="ppPwForm">
        <p class="pp-muted" style="margin:0">Por segurança, troque a senha temporária antes de abrir seus jobs.</p>
        <div class="pp-field"><label for="ppPw1">Nova senha (mínimo 10 caracteres)</label><input id="ppPw1" type="password" minlength="10" autocomplete="new-password" required /></div>
        <div class="pp-field"><label for="ppPw2">Repita a nova senha</label><input id="ppPw2" type="password" minlength="10" autocomplete="new-password" required /></div>
        <p class="pp-error" id="ppPwError" role="alert" hidden></p>
        <div><button class="pp-btn pp-btn--pri" id="ppPwSave" type="submit">Salvar senha</button></div>
      </form>`;
    $('ppPwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ppPwError');
      const btn = $('ppPwSave');
      err.hidden = true;
      const pw = $('ppPw1').value;
      if (pw.length < 10) { err.textContent = 'Use pelo menos 10 caracteres.'; err.hidden = false; return; }
      if (pw !== $('ppPw2').value) { err.textContent = 'As senhas não são iguais.'; err.hidden = false; return; }
      btn.disabled = true;
      btn.textContent = 'Salvando…';
      try {
        await postJson('/api/partner-auth/change-password', { password: pw });
        await boot();
      } catch (ex) {
        err.textContent = ex.message || 'Não foi possível salvar a senha.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Salvar senha';
      }
    });
  }

  function renderSearchResults() {
    const q = $('ppSearchMobile').value.trim().toLowerCase();
    const box = $('ppSearchResults');
    if (!q) { box.innerHTML = '<div class="pp-empty">Digite um endereço, título ou número.</div>'; return; }
    const jobs = state.jobs.filter((j) => jobMatchesQuery(j, q)).slice(0, 8);
    const invs = state.invoices.filter((inv) => [inv.number, invoiceRef(inv), inv.job && inv.job.address].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
    box.innerHTML = (jobs.length || invs.length)
      ? `${jobs.length ? '<div class="pp-group">Jobs</div>' : ''}${jobs.map((j) => `<a class="pp-row" href="#jobs/${encodeURIComponent(j.id)}" style="text-decoration:none"><span class="pp-row-main"><strong style="font-size:15px">${esc(j.title || 'Job')}</strong><span class="pp-row-sub">${esc(j.address || '')}</span></span></a>`).join('')}${invs.length ? '<div class="pp-group">Invoices</div>' : ''}${invs.map((inv) => `<a class="pp-row" href="#invoices/${encodeURIComponent(inv.id)}" style="text-decoration:none"><span class="pp-row-main"><strong style="font-size:15px">${esc(inv.number || 'Invoice')} · ${money(inv.amount)}</strong><span class="pp-row-sub">${esc(invoiceRef(inv))}</span></span></a>`).join('')}`
      : '<div class="pp-empty">Nada encontrado.</div>';
    box.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { $('ppSearchSheet').hidden = true; }));
  }

  function bindShell() {
    $('ppAvatar').addEventListener('click', (e) => { e.stopPropagation(); openMenu($('ppMenu').hidden); });
    document.addEventListener('click', (e) => { if (!$('ppMenu').hidden && !e.target.closest('#ppMenu')) openMenu(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { openMenu(false); $('ppSearchSheet').hidden = true; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('ppSearch').focus(); }
    });
    $('ppLogout').addEventListener('click', logout);
    $('ppProviderSwitch').addEventListener('click', async () => {
      const btn = $('ppProviderSwitch');
      const workspace = $('ppProviderSelect').value;
      if (!workspace) return;
      btn.disabled = true;
      btn.textContent = 'Trocando…';
      try {
        const r = await postJson('/api/partner-auth/switch', { workspace });
        location.replace((r.data && r.data.redirect_url) || 'partner-portal.html');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Trocar de fornecedor';
        window.alert(err.message || 'Não foi possível trocar de fornecedor.');
      }
    });
    const search = $('ppSearch');
    search.addEventListener('input', () => {
      state.q = search.value;
      const r = route();
      if (r.name === 'invoices') { location.hash = '#invoices'; render().then(() => search.focus()); }
      else if (r.name !== 'jobs' || r.id) { location.hash = '#jobs'; }
      else render().then(() => search.focus());
    });
    $('ppSearchFab').addEventListener('click', () => { $('ppSearchSheet').hidden = false; renderSearchResults(); $('ppSearchMobile').focus(); });
    $('ppSearchClose').addEventListener('click', () => { $('ppSearchSheet').hidden = true; });
    $('ppSearchMobile').addEventListener('input', renderSearchResults);
    $('ppFileInput').addEventListener('change', async (e) => {
      if (!state.send) state.send = newSend();
      await addFiles(e.target.files);
      e.target.value = '';
      if (route().name !== 'enviar') location.hash = '#enviar'; else renderSendBody();
    });
    $('ppCameraInput').addEventListener('change', async (e) => {
      if (!state.send) state.send = newSend();
      await addFiles(e.target.files);
      e.target.value = '';
      if (route().name !== 'enviar') location.hash = '#enviar'; else renderSendBody();
    });
    window.addEventListener('hashchange', () => { window.scrollTo({ top: 0 }); render(); });
    window.addEventListener('resize', (() => { let mobile = window.matchMedia('(max-width: 767px)').matches; return () => { const now = window.matchMedia('(max-width: 767px)').matches; if (now !== mobile) { mobile = now; if (['jobs', 'invoices'].includes(route().name)) render(); } }; })());
  }

  async function boot() {
    const session = await api('/api/partner-auth/session');
    if (!session.authenticated) { location.replace('partner-login.html'); return; }
    state.user = session.data || {};
    state.providers = state.user.providers || [];
    const prov = providerName();
    $('ppProvider').textContent = prov;
    $('ppMark').textContent = initials(prov);
    $('ppAvatar').textContent = initials(state.user.name || state.user.email);
    $('ppAvatar').setAttribute('aria-label', `Conta: ${state.user.name || state.user.email || ''}`);
    $('ppUserName').textContent = state.user.name || '';
    $('ppUserEmail').textContent = [state.user.email, state.user.company_name].filter(Boolean).join(' · ');
    $('ppProviderTools').hidden = state.providers.length < 2;
    if (state.providers.length > 1) {
      $('ppProviderSelect').innerHTML = state.providers.map((p) => `<option value="${esc(p.slug)}">${esc(p.name || p.company_name)}</option>`).join('');
      $('ppProviderSelect').value = state.user.workspace || '';
    }
    document.title = `${prov} · Portal do builder`;
    if (state.user.must_change_password) { renderPassword(); return; }
    $('ppDock').hidden = false;
    $('ppTabs').hidden = false;
    $('ppSearchFab').hidden = false;
    const overview = await api('/api/partner-portal/overview');
    const data = overview.data || {};
    state.jobs = (data.jobs || []).filter((j) => j.status !== 'canceled');
    state.projects = data.projects || [];
    loadInvoices().then(updateCounts).catch(() => {});
    loadRequests().then(updateCounts).catch(() => {});
    await render();
  }

  bindShell();
  boot().catch((err) => {
    view.innerHTML = `<p class="pp-error" role="alert">${esc(err.message || 'Não foi possível carregar o portal.')}</p>`;
  });
})();
