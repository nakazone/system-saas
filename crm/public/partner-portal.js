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
    /** Builder account session (GET /api/builder/me); null for older company-created portal users. */
    builder: null,
    /** Company picked in the builder portal ({ id, status: active|invited, company_name, … }). */
    company: null,
    perms: null,
    priceList: null,
    /** Builder accounts: everything from every connected company, before the company filter. */
    all: { jobs: [], projects: [], invoices: [], requests: [], documents: [] },
    /** Company filter on the list pages ('' = all companies). */
    coFilter: '',
    /** Company of the job being shown or of the send form (texts like "a equipe de X"). */
    ctx: null,
    priceLists: {},
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
    const opts = { ...(options || {}) };
    if (opts.co) opts.headers = { ...(opts.headers || {}), 'X-Builder-Company': opts.co };
    delete opts.co;
    const response = await fetch(url, { credentials: 'include', ...opts });
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
  function postJson(url, payload, co) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), co });
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
    if (state.builder) {
      if (state.ctx) return state.ctx.company_name;
      const filtered = state.coFilter && coById(state.coFilter);
      if (filtered) return filtered.company_name;
      const act = activeCompanies();
      return act.length === 1 ? act[0].company_name : 'Todas as empresas';
    }
    const user = state.user || {};
    const p = state.providers.find((x) => x.slug === user.workspace);
    return (p && p.name) || 'Seu fornecedor';
  }
  /** Builder team permissions (jobs.view, jobs.send, jobs.edit, money.view, companies.manage, team.manage). */
  function canDo(permission) {
    return !state.perms || state.perms.includes(permission);
  }
  /** Builders: at least one connected company to show data from. */
  function companyActive() {
    return !state.builder || activeCompanies().length > 0;
  }
  function activeCompanies() {
    return state.builder ? (state.builder.companies || []).filter((c) => c.status === 'active') : [];
  }
  function coById(id) {
    return (state.builder && (state.builder.companies || []).find((c) => c.id === id)) || null;
  }
  function multiCo() {
    return activeCompanies().length > 1;
  }
  /** Same portal call on every connected company; failures of one company don't hide the others. */
  async function fetchEach(url) {
    const parts = await Promise.all(activeCompanies().map((c) => api(url, { co: c.id }).then((r) => ({ c, data: r.data })).catch(() => null)));
    return parts.filter(Boolean);
  }
  function tagCo(rows, c) {
    return (Array.isArray(rows) ? rows : []).map((x) => ({ ...x, _co: c.id, _coName: c.company_name }));
  }
  function applyCoFilter() {
    if (!state.builder) return;
    if (state.coFilter && !activeCompanies().some((c) => c.id === state.coFilter)) state.coFilter = '';
    const f = state.coFilter;
    ['jobs', 'projects', 'invoices', 'requests', 'documents'].forEach((k) => {
      state[k] = f ? state.all[k].filter((x) => x._co === f) : state.all[k].slice();
    });
  }
  /** Small company line on rows when the builder works with more than one company. */
  function coLine(item) {
    return state.builder && multiCo() && item && item._coName ? `<span class="pp-row-co">${esc(item._coName)}</span>` : '';
  }
  function coBarHtml() {
    if (!state.builder || !multiCo()) return '';
    const btn = (id, label) => `<button type="button" data-cofilter="${esc(id)}" aria-pressed="${state.coFilter === id}">${esc(label)}</button>`;
    return `<div class="pp-cobar pp-filter" role="group" aria-label="Filtrar por empresa">${btn('', 'Todas as empresas')}${activeCompanies().map((c) => btn(c.id, c.company_name)).join('')}</div>`;
  }
  function companyInvited() {
    const c = sendCo();
    return Boolean(state.builder && c && c.status === 'invited');
  }
  /** Company the job being sent goes to: the one picked in the send form, else the last one used. */
  function sendCo() {
    if (!state.builder) return null;
    return (state.send && state.send.co && coById(state.send.co)) || state.company || activeCompanies()[0] || (state.builder.companies || [])[0] || null;
  }

  /* ─────────────────────────── loading ─────────────────────────── */

  async function loadInvoices(force) {
    if (state.loaded.invoices && !force) return;
    if (!canDo('money.view') || !companyActive()) { state.invoices = []; state.loaded.invoices = true; return; }
    if (state.builder) {
      state.all.invoices = (await fetchEach('/api/partner-portal/invoices')).flatMap((p) => tagCo(p.data, p.c));
      applyCoFilter();
      state.loaded.invoices = true;
      return;
    }
    const r = await api('/api/partner-portal/invoices');
    state.invoices = r.data || [];
    state.loaded.invoices = true;
  }
  async function loadRequests(force) {
    if (state.loaded.requests && !force) return;
    if (!companyActive()) { state.requests = []; state.loaded.requests = true; return; }
    if (state.builder) {
      state.all.requests = (await fetchEach('/api/partner-portal/requests')).flatMap((p) => tagCo(p.data, p.c));
      applyCoFilter();
      state.loaded.requests = true;
      return;
    }
    const r = await api('/api/partner-portal/requests');
    state.requests = r.data || [];
    state.loaded.requests = true;
  }
  async function loadDocuments(force) {
    if (state.loaded.documents && !force) return;
    if (!companyActive()) { state.documents = []; state.loaded.documents = true; return; }
    if (state.builder) {
      state.all.documents = (await fetchEach('/api/partner-portal/documents')).flatMap((p) => tagCo(p.data, p.c));
      applyCoFilter();
      state.loaded.documents = true;
      return;
    }
    const r = await api('/api/partner-portal/documents');
    state.documents = r.data || [];
    state.loaded.documents = true;
  }
  async function loadJob(id, force) {
    if (state.jobDetail.has(id) && !force) return state.jobDetail.get(id);
    const url = `/api/partner-portal/jobs/${encodeURIComponent(id)}`;
    if (state.builder) {
      const known = state.all.jobs.find((j) => j.id === id);
      const tries = known ? [coById(known._co)].filter(Boolean) : activeCompanies();
      for (const c of tries) {
        try {
          const r = await api(url, { co: c.id });
          r.data._co = c.id;
          state.jobDetail.set(id, r.data);
          return r.data;
        } catch (err) {
          if (known) throw err;
        }
      }
      throw new Error('Job não encontrado.');
    }
    const r = await api(url);
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
      const on = nav === key || (nav === 'mais' && ['documentos', 'enviar', 'mais', 'empresas', 'equipe', 'medicoes'].includes(key) && el.classList.contains('pp-tab'));
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }
  let renderToken = 0;
  /** Company filter under the page title on list pages (builders with 2+ companies). */
  function paintCoBar(r) {
    if (!['inicio', 'jobs', 'invoices', 'calendario', 'documentos'].includes(r.name)) return;
    if (r.id && window.matchMedia('(max-width: 1023px)').matches) return;
    const html = coBarHtml();
    if (!html) return;
    const head = view.querySelector('.pp-head');
    if (head) head.insertAdjacentHTML('afterend', html);
    else view.insertAdjacentHTML('afterbegin', html);
    view.querySelectorAll('[data-cofilter]').forEach((b) => b.addEventListener('click', () => {
      state.coFilter = b.getAttribute('data-cofilter');
      applyCoFilter();
      render();
    }));
  }
  async function render() {
    if (!state.user || state.user.must_change_password) return;
    const token = ++renderToken;
    const r = route();
    setNav(r.name);
    document.body.classList.remove('pp-focus');
    state.ctx = null;
    try {
      if (state.builder && r.name === 'empresas') { await renderCompanies(token); updateCounts(); return; }
      if (state.builder && r.name === 'equipe') { await renderTeam(token); updateCounts(); return; }
      if (state.builder && r.name === 'medicoes') {
        if (!canDo('measure')) { view.innerHTML = '<div class="pp-card pp-empty"><strong>Seu papel não faz medições</strong>Peça ao admin da equipe.</div>'; return; }
        await renderMeasurements(r.id, token); updateCounts(); return;
      }
      if (state.meas && state.meas.dirty) measSaveNow();
      if (state.builder && !companyActive() && !['enviar', 'mais'].includes(r.name)) { await renderNoCompany(token); updateCounts(); return; }
      if (r.name === 'jobs') await renderJobs(r.id, token);
      else if (r.name === 'invoices') await renderInvoices(r.id, token);
      else if (r.name === 'calendario') renderCalendar();
      else if (r.name === 'enviar') await renderSend(token);
      else if (r.name === 'documentos') await renderDocuments(token);
      else if (r.name === 'mais') renderMore();
      else await renderHome(token);
      if (token === renderToken) paintCoBar(r);
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
          <div style="font-size:14px">${state.builder && multiCo() && !state.coFilter ? `em ${activeCompanies().length} empresas` : `com ${esc(providerName())}`}</div>
          <div class="pp-inbox-grid">
            <div class="pp-inbox"><span style="font-size:12px">Aguardando agenda</span><b>${waiting}</b></div>
            <div class="pp-inbox"><span style="font-size:12px">Agendados</span><b>${scheduled}</b></div>
            <div class="pp-inbox"><span style="font-size:12px">Na obra</span><b>${onSite}</b></div>
          </div>
          <a class="pp-tile-link" href="#jobs">Ver jobs →</a>
        </section>

        ${canDo('money.view') ? `<section class="pp-tile pp-tile--dark" style="grid-column: span 4; grid-row: span 2" aria-label="Invoices em aberto">
          <div class="pp-lbl">Invoices em aberto</div>
          <div class="pp-big">${money(openSum)}</div>
          <div class="pp-meter" aria-hidden="true"><i style="width:${openSum ? Math.round((overdueSum / openSum) * 100) : 0}%"></i></div>
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:13px" class="pp-sub"><span>${money(overdueSum)} vencido</span><span>${money(soonSum)} vence em 7 dias</span></div>
          <a class="pp-tile-link" href="#invoices">Ver invoices →</a>
        </section>` : `<section class="pp-tile pp-tile--dark" style="grid-column: span 4; grid-row: span 2" aria-label="Fotos e docs">
          <div class="pp-lbl">Fotos e documentos</div>
          <div class="pp-big">${esc(providerName())}</div>
          <div style="font-size:13px" class="pp-sub">Fotos de antes, durante e depois, relatórios e arquivos que a equipe libera.</div>
          <a class="pp-tile-link" href="#documentos">Ver fotos e docs →</a>
        </section>`}

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
    const selectedId = id || (window.matchMedia('(max-width: 1023px)').matches ? '' : (groups[0] && groups[0][1][0] && groups[0][1][0].id) || '');
    const late = all.filter((j) => jobLate(j)).length;
    await loadInvoices().catch(() => {});
    if (token !== renderToken) return;
    const openSum = state.invoices.filter((inv) => invoiceState(inv).key !== 'paid').reduce((s, inv) => s + Number(inv.balance || 0), 0);
    const done30 = all.filter((j) => !jobIsActive(j) && daysBetween(toDate(j.updatedAt) || now, now) <= 30).length;

    const stage = (key, label) => `<button type="button" data-stage="${key}" aria-pressed="${state.jobStage === key}">${esc(label)} · ${counts[key]}</button>`;
    const row = (j) => `<button type="button" class="pp-row" data-job="${esc(j.id)}" aria-current="${j.id === selectedId}">
        <span class="pp-row-main">
          ${coLine(j)}
          <span class="pp-row-top"><strong>${esc(j.title || 'Job')}</strong><span>${j.number ? `#${esc(j.number)}` : ''}</span></span>
          <span class="pp-row-sub">${esc(j.address || 'Sem endereço')}</span>
          <span class="pp-row-next pp-row-split"><span>${jobWhen(j)}</span>${j.total ? `<b>${moneyShort(j.total)}</b>` : ''}</span>
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
        ${canDo('money.view') ? `<div class="pp-card pp-num pp-hide-phone"><span class="pp-lbl">Invoices em aberto</span><b>${moneyShort(openSum)}</b></div>` : ''}
      </div>
      <div class="pp-split pp-split--list ${id ? 'is-open' : ''}">
        <aside class="pp-card pp-side" aria-label="Lista de jobs">
          <div class="pp-side-search"><label>${icon('search')}<span class="pp-sr">Buscar jobs</span><input id="ppJobSearch" type="search" placeholder="Endereço, título ou nº" value="${esc(state.q)}" /></label></div>
          <div class="pp-filter pp-side-filter" role="group" aria-label="Etapa">${stage('all', 'Todos')}${stage('obra', 'Na obra')}${stage('agendado', 'Agendados')}${stage('recebido', 'Aguardando agenda')}${stage('concluido', 'Concluídos')}</div>
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
      document.body.classList.add('pp-focus');
      const data = await loadJob(selectedId).catch((err) => ({ error: err.message }));
      if (token !== renderToken) return;
      state.ctx = (data && data._co && coById(data._co)) || null;
      $('ppJobPane').innerHTML = data.error ? `<p class="pp-error">${esc(data.error)}</p>` : jobDetailHtml(data);
      bindJobDetail(data);
    }
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

  const ICON = {
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  };

  function photoGrid(photos) {
    const label = { before: 'Antes', during: 'Durante', after: 'Depois' };
    return `<div class="tk-photos">${photos.slice(0, 9).map((p) => p.type === 'video'
      ? `<a href="${esc(p.file_url)}" target="_blank" rel="noopener" class="tk-ph tk-ph--video"><span>Vídeo</span>${p.stage && label[p.stage] ? `<b>${label[p.stage]}</b>` : ''}</a>`
      : `<a href="${esc(p.file_url)}" target="_blank" rel="noopener" class="tk-ph"><img src="${esc(p.file_url)}" alt="${esc(p.caption || 'Foto da obra')}" loading="lazy" />${p.stage && label[p.stage] ? `<b>${label[p.stage]}</b>` : ''}${p.caption ? `<i>${esc(p.caption)}</i>` : ''}</a>`).join('')}</div>`;
  }

  function jobDetailHtml(data) {
    const job = data.job;
    const t = data.ticket || { services: [], checklist: [], team: [] };
    const i = jobStepIndex(job);
    const when = t.when;
    const next = jobNextStep(job, data.invoices || []);
    const services = t.services || [];
    const checklist = t.checklist || [];
    const pct = checklist.length ? Math.round((t.checklist_done / checklist.length) * 100) : 0;
    const docs = data.documents || [];
    const invoices = data.invoices || [];
    const requests = data.requests || [];
    const photos = data.photos || [];
    const pillTone = i === 3 ? 'done' : i === 2 ? 'accent' : 'info';
    const office = t.office;

    const work = `
      <section class="tk-hero" aria-labelledby="tkTitle">
        <div class="tk-hero-top">
          <button type="button" class="pp-back" data-back="#jobs">${icon('back')}Jobs</button>
          <div class="tk-meta">
            ${state.builder && state.ctx ? `<span class="tk-num">${esc(state.ctx.company_name)} ·</span>` : ''}
            ${job.number ? `<span class="tk-num">JOB #${esc(job.number)}</span>` : ''}
            <span class="tk-pill tk-pill--${pillTone}">${esc(t.status || 'Agendado')}</span>
            ${job.external_ref ? `<span class="tk-num">· SEU Nº ${esc(job.external_ref)}</span>` : ''}
          </div>
          ${job.can_edit ? '<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-edit-job>Editar</button>' : ''}
          <button type="button" class="tk-iconbtn" data-print-ticket aria-label="Imprimir ticket">${ICON.print}</button>
        </div>
        <h2 id="tkTitle">${esc(job.title || 'Job')}</h2>
        ${t.sector ? `<p class="tk-sub">${esc(t.sector)}</p>` : ''}
        ${t.total ? `<div class="tk-value"><span>Valor do job</span><b>${money(t.total)}</b></div>` : ''}
        ${when
          ? `<div class="tk-when"><div><div class="tk-time">${t.all_day ? 'Dia todo' : esc(when.start)}${!t.all_day && when.zone ? `<span>${esc(when.zone)}</span>` : ''}</div><div class="tk-day">${esc(when.day)}</div>${when.until ? `<div class="tk-until">${esc(when.until)}</div>` : ''}</div><span class="tk-rel">${esc(when.relative)}</span></div>`
          : '<div class="tk-when tk-when--none">Data ainda não definida. A equipe vai agendar.</div>'}
        <div class="tk-steps">${barsWithLabels(i, JOB_STEPS, i === 3)}</div>
      </section>

      ${t.attention ? `<section class="tk-attn" role="note"><span aria-hidden="true">!</span><div><b>Atenção</b><p>${esc(t.attention)}</p></div></section>` : ''}

      <section class="tk-sec">
        <h3>Local</h3>
        <p class="tk-addr">${esc(job.address || 'Sem endereço')}</p>
        ${t.maps ? `<div class="tk-two"><a class="tk-btn tk-btn--accent" href="${esc(t.maps.apple)}" target="_blank" rel="noopener">${ICON.pin}Apple Maps</a><a class="tk-btn" href="${esc(t.maps.google)}" target="_blank" rel="noopener">Google Maps</a></div>` : ''}
        ${t.lockbox ? `<div class="tk-lock"><span>${ICON.lock}</span><div><small>Código da lockbox</small><b>${esc(t.lockbox)}</b></div></div>` : ''}
      </section>

      ${t.notes ? `<section class="tk-sec"><h3>Instruções</h3><p class="tk-notes">${esc(t.notes)}</p></section>` : ''}

      <section class="tk-sec">
        <h3>Serviços${services.length ? ` <small>${services.length}</small>` : ''}</h3>
        ${services.length
          ? `<ul class="tk-list tk-svc">${services.map((sv) => `<li><span>${esc(sv.name)}${sv.notes ? `<small>${esc(sv.notes)}</small>` : ''}</span><span class="tk-amt">${sv.total ? `<b>${money(sv.total)}</b>` : ''}${sv.qty ? `<small>${esc(sv.qty)}${sv.unit_price ? ` × ${money(sv.unit_price)}` : ''}</small>` : ''}</span></li>`).join('')}${t.total ? `<li class="tk-total"><span>Total</span><b>${money(t.total)}</b></li>` : ''}</ul>`
          : '<p class="tk-empty">A equipe ainda não lançou os serviços deste job.</p>'}
      </section>

      ${checklist.length ? `<section class="tk-sec">
        <h3>Checklist <small>${t.checklist_done} de ${checklist.length} feito${t.checklist_done === 1 ? '' : 's'}</small></h3>
        <div class="tk-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <ul class="tk-list tk-ck">${checklist.map((c) => `<li class="${c.done ? 'on' : ''}"><span class="tk-box" aria-label="${c.done ? 'Feito' : 'Pendente'}">${c.done ? ICON.check : ''}</span><span>${esc(c.text)}</span></li>`).join('')}</ul>
      </section>` : ''}`;

    const side = `
      <section class="tk-next">
        <small>Próximo passo</small>
        <strong>${esc(next.title)}</strong>
        <p>${esc(next.text)}</p>
        ${job.can_edit ? '<button type="button" class="tk-btn tk-btn--light" data-edit-job>Editar job</button>' : canDo('jobs.send') ? '<button type="button" class="tk-btn tk-btn--light" data-update-job>Enviar atualização</button>' : ''}
      </section>

      <section class="tk-sec" id="ppPhotos">
        <h3>Fotos${photos.length ? ` <small>${photos.length}</small>` : ''}</h3>
        ${photos.length ? photoGrid(photos) : '<p class="tk-empty">Nenhuma foto liberada ainda. As fotos de antes, durante e depois aparecem aqui.</p>'}
        ${photos.length > 9 ? '<a class="pp-link" href="#documentos" style="font-size:14px">Ver todas</a>' : ''}
      </section>

      ${canDo('money.view') ? `<section class="tk-sec">
        <h3>Invoices</h3>
        ${invoices.length ? `<ul class="tk-list">${invoices.map((inv) => { const st = invoiceState(inv); return `<li><a href="#invoices/${encodeURIComponent(inv.id)}" class="tk-row"><span>${esc(inv.number || 'Invoice')}<small class="${['overdue', 'soon'].includes(st.key) ? 'pp-late' : ''}">${esc(st.label)}</small></span><b>${money(st.key === 'paid' ? inv.amount : inv.balance)}</b></a></li>`; }).join('')}</ul>` : '<p class="tk-empty">Nenhuma invoice deste job ainda.</p>'}
      </section>` : ''}

      ${docs.length ? `<section class="tk-sec"><h3>Documentos</h3><ul class="tk-list">${docs.map((d) => `<li><a href="${esc(d.file_url)}" target="_blank" rel="noopener" class="tk-row"><span>${esc(d.title)}<small>${d.type === 'report' ? 'Relatório' : d.type === 'sent' ? 'Você enviou' : 'Arquivo'}</small></span><b>Abrir</b></a></li>`).join('')}</ul></section>` : ''}

      ${requests.length ? `<section class="tk-sec"><h3>Seus pedidos</h3>${requests.map((r) => `<div class="pp-req" style="padding:8px 0"><div class="pp-req-top"><strong>${esc(r.title)}</strong>${requestStatus(r)}</div><p>${esc(fmtDay(r.created_at))}</p>${r.review_note ? `<p class="pp-reply">${esc(r.review_note)}</p>` : ''}</div>`).join('')}</section>` : ''}

      ${office ? `<section class="tk-sec"><h3>Dúvidas? Fale com ${esc(office.name)}</h3><p class="tk-sub" style="margin:0 0 10px">${esc(office.phone)}</p><div class="tk-two"><a class="tk-btn" href="tel:+${esc(office.digits)}">${ICON.phone}Ligar</a><a class="tk-btn" href="https://wa.me/${esc(office.digits)}?text=${encodeURIComponent(`Olá, sobre o job${job.number ? ` #${job.number}` : ''} (${job.title || ''}): `)}" target="_blank" rel="noopener">WhatsApp</a></div></section>` : ''}`;

    return `<div class="tk" id="ppTicket">
        <div class="tk-print-head">${esc(providerName())} · Ticket do job${job.number ? ` #${esc(job.number)}` : ''}</div>
        <div class="tk-col">${work}</div>
        <div class="tk-col tk-col--side">${side}</div>
      </div>
      <div class="pp-fixbar">${job.can_edit ? '<button type="button" class="pp-btn pp-btn--sec" data-edit-job>Editar job</button>' : '<a class="pp-btn pp-btn--sec" href="#ppPhotos">Fotos</a>'}${canDo('jobs.send') ? '<button type="button" class="pp-btn pp-btn--pri" data-update-job>Enviar atualização</button>' : '<a class="pp-btn pp-btn--sec" href="#documentos">Fotos e docs</a>'}</div>`;
  }

  function bindJobDetail(data) {
    if (!data || data.error) return;
    view.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { location.hash = b.getAttribute('data-back'); }));
    view.querySelectorAll('[data-print-ticket]').forEach((b) => b.addEventListener('click', () => {
      document.body.classList.add('pp-printing');
      window.print();
      setTimeout(() => document.body.classList.remove('pp-printing'), 500);
    }));
    view.querySelectorAll('[data-edit-job]').forEach((b) => b.addEventListener('click', () => openJobEditor(data)));
    view.querySelectorAll('[data-update-job]').forEach((b) => b.addEventListener('click', () => {
      state.send = newSend();
      state.send.presetJob = { id: data.job.id, number: data.job.number, title: data.job.title, address: data.job.address };
      if (data._co) state.send.co = data._co;
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
    const selectedId = id || (window.matchMedia('(max-width: 1023px)').matches ? '' : firstId || '');
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
          ${groups.length ? groups.map(([label, rows]) => `<div class="pp-group">${esc(label)} · ${rows.length}</div>${rows.map((x) => `<button type="button" class="pp-row" data-inv="${esc(x.inv.id)}" aria-current="${x.inv.id === selectedId}"><span class="pp-row-main">${coLine(x.inv)}<span class="pp-row-top"><strong>${esc(invoiceRef(x.inv))}</strong><span style="color:var(--pp-ink);font-weight:600">${money(x.st.key === 'paid' ? x.inv.amount : x.inv.balance)}</span></span><span class="pp-row-sub">${esc(x.inv.number || 'Invoice')}${x.inv.job && x.inv.job.number ? ` · Job #${esc(x.inv.job.number)}` : ''}</span><span class="pp-row-next ${['overdue', 'soon'].includes(x.st.key) ? 'pp-late' : ''}">${esc(x.st.label)}</span></span></button>`).join('')}`).join('') : `<div class="pp-empty"><strong>${all.length ? 'Nada nesta lista' : 'Nenhuma invoice ainda'}</strong>${all.length ? 'Troque o filtro ou a busca.' : 'As invoices emitidas pelo fornecedor aparecem aqui.'}</div>`}
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
          ${sel.map((j) => `<button type="button" class="pp-row" data-job="${esc(j.id)}"><span class="pp-row-main">${coLine(j)}<span class="pp-row-top"><strong>${esc(j.title || 'Job')}</strong><span>${j.allDay ? 'Dia todo' : esc(fmtTime(j.scheduledStart))}</span></span><span class="pp-row-sub">${esc(j.address || '')}</span><span class="pp-row-next">${jobChip(j)}</span></span></button>`).join('')}
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
    external_ref: 'Seu nº do job / PO', service_type: 'Serviço', preferred_date: 'Data do job', square_feet: 'Área (sq ft)',
    material: 'Material', contact_name: 'Contato no local', contact_phone: 'Telefone', contact_email: 'E-mail', notes: 'Observações para a equipe',
  };
  const FIELD_ORDER = ['address', 'title', 'community', 'lot', 'plan', 'external_ref', 'service_type', 'preferred_date', 'pickup', 'square_feet', 'material', 'contact_name', 'contact_phone', 'contact_email', 'notes'];
  FIELD_LABELS.pickup = 'Pickup do material (onde retirar)';

  function newSend() {
    return { phase: 'pick', files: [], text: '', showPaste: false, fields: null, items: [], laborTotal: null, check: [], warnings: [], match: null, mode: 'new', ai: false, model: '', error: '', presetJob: null, sent: null };
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
      const r = await postJson(companyInvited() ? '/api/builder/read' : '/api/partner-portal/requests/read', { text: s.text, files: s.files.map((f) => ({ name: f.name, data_url: f.dataUrl })) }, state.builder && !companyInvited() ? sendCo().id : undefined);
      const data = r.data || {};
      if (!data.ai_available) {
        s.fields = emptyFields();
        s.ai = false;
        s.warnings = ['A leitura automática não está ligada nesta empresa. Preencha os campos abaixo.'];
      } else {
        s.fields = Object.assign(emptyFields(), data.fields || {});
        s.items = (data.items || []).map((it) => ({ ...it, create_service: true, remove: false }));
        s.catalog = data.catalog || [];
        s.measurement = data.measurement || null;
        s.useMeasurement = Boolean(s.measurement && s.measurement.status !== 'used');
        s.laborTotal = data.labor_total == null ? null : Number(data.labor_total);
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
    const target = sendCo();
    state.ctx = target;
    const allCos = (state.builder && state.builder.companies) || [];
    const picker = state.builder && allCos.length > 1 && !state.send.presetJob
      ? `<label class="pp-sendto"><span>Enviar para</span><select id="ppSendCo">${allCos.map((c) => `<option value="${esc(c.id)}" ${target && target.id === c.id ? 'selected' : ''}>${esc(c.company_name)}${c.status === 'invited' ? ' (convidada)' : ''}</option>`).join('')}</select></label>`
      : `<p class="pp-eyebrow">${state.builder ? 'Para ' : ''}${esc(providerName())}</p>`;
    view.innerHTML = `
      <div class="pp-head">
        <div>${picker}<h1>Enviar trabalho</h1></div>
        <ol class="pp-steps" id="ppSteps" aria-label="Etapas"></ol>
      </div>
      <div class="pp-split pp-split--stack">
        <section class="pp-main" id="ppSendBody"></section>
        <aside class="pp-card pp-side" aria-labelledby="ppReqTitle" id="ppReqs"></aside>
      </div>`;
    const pick = $('ppSendCo');
    if (pick) pick.addEventListener('change', () => {
      state.send.co = pick.value;
      postJson('/api/builder/select', { company_id: pick.value }).catch(() => {});
      renderSend(renderToken);
    });
    renderSendBody();
    renderRequestsList();
  }

  function renderRequestsList() {
    const box = $('ppReqs');
    if (!box) return;
    if (companyInvited()) {
      api(`/api/builder/companies/${encodeURIComponent(sendCo().id)}/jobs`).then((r) => {
        const rows = r.data || [];
        box.innerHTML = `<div style="padding:16px 16px 8px"><h2 id="ppReqTitle" style="margin:0;font-size:17px">Guardados para ${esc(providerName())}</h2><p class="pp-muted" style="margin:2px 0 0;font-size:13px">Entram no sistema dela quando ela criar a conta.</p></div>
          ${rows.length ? rows.map((j) => `<div class="pp-req"><div class="pp-req-top"><strong>${esc(j.title)}</strong>${j.delivered_at ? '<span class="pp-chip pp-chip--ok">Entregue</span>' : '<span class="pp-chip">Guardado</span>'}</div><p>${esc(j.address)}</p><p>Guardado ${esc(fmtDay(j.created_at))}${j.files ? ` · ${plural(j.files, 'arquivo', 'arquivos')}` : ''}</p></div>`).join('') : '<div class="pp-empty" style="padding:20px 16px">Nenhum job guardado ainda.</div>'}`;
      }).catch(() => { box.innerHTML = ''; });
      return;
    }
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
      box.innerHTML = `<div class="pp-card pp-reading pp-reading--mate" role="status">
        <img class="pp-mate-art" src="/assets/img/mascot/mate-reading.webp?v=20261027-m2" alt="" height="96" decoding="async">
        <div style="display:flex;gap:12px;align-items:center"><span class="pp-doc-ico" style="width:44px;height:44px">${s.files[0] && s.files[0].type === 'application/pdf' ? 'PDF' : s.files.length ? 'IMG' : 'TXT'}</span><div><strong>${esc(s.files.length ? s.files.map((f) => f.name).join(', ') : 'Texto colado')}</strong><div class="pp-muted" style="font-size:13px">Lendo endereço, nº do job, data e as linhas de serviço…</div></div></div>
        <div class="pp-progress"><i></i></div>
        <p class="pp-muted" style="margin:0;font-size:14px">Leva alguns segundos. Nada é enviado antes de você conferir.</p>
      </div>`;
      return;
    }

    if (s.phase === 'done') {
      const sent = s.sent || {};
      const updated = sent.update;
      const title = sent.kept ? 'Job guardado' : sent.direct ? (updated ? 'Job atualizado' : 'Job criado') : (updated ? 'Atualização enviada' : 'Pedido enviado');
      const text = sent.kept
        ? `${esc(providerName())} ainda não entrou no ObraMate. O job fica guardado e entra no sistema dela assim que ela criar a conta pelo seu convite.`
        : sent.direct
          ? `${updated ? 'A alteração já está' : 'O job já está'} no sistema de ${esc(providerName())}, e o escritório foi avisado.`
          : `A equipe de ${esc(providerName())} confere e responde aqui. ${updated ? 'O job continua o mesmo, com as fotos e invoices juntos.' : 'Quando aceitarem, o job aparece em Jobs.'}`;
      box.innerHTML = `<div class="pp-card pp-reading">
        <img class="pp-mate-art" src="/assets/img/mascot/mate-thumbs.webp?v=20261027-m2" alt="" height="96" decoding="async">
        <h2 style="margin:0;font-size:24px">${title}</h2>
        <p class="pp-muted" style="margin:0">${text}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="pp-btn pp-btn--pri" id="ppSendAnother">Enviar outro</button>${sent.jobId ? `<a class="pp-btn pp-btn--sec" href="#jobs/${encodeURIComponent(sent.jobId)}">Abrir job</a>` : sent.kept ? '<a class="pp-btn pp-btn--sec" href="#empresas">Ver empresas</a>' : '<a class="pp-btn pp-btn--sec" href="#jobs">Ver jobs</a>'}</div>
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
    if (state.builder && !sendCo()) {
      box.innerHTML = '<div class="pp-card pp-empty"><strong>Escolha uma empresa</strong>Conecte ou convide a empresa de piso para enviar jobs.<div style="margin-top:12px"><a class="pp-btn pp-btn--pri" href="#empresas">Empresas</a></div></div>';
      return;
    }
    if (!canDo('jobs.send')) {
      box.innerHTML = '<div class="pp-card pp-empty"><strong>Seu papel não envia jobs</strong>Peça a alguém do escritório ou ao admin da sua equipe.</div>';
      return;
    }
    box.innerHTML = `
      ${companyInvited() ? `<div class="pp-match"><strong>${esc(providerName())} ainda não está no ObraMate</strong><span class="pp-muted" style="font-size:14px">O job fica guardado e entra no sistema dela assim que ela criar a conta pelo seu convite.</span></div>` : ''}
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
        <button type="button" class="pp-source" id="ppManual">${icon('pen')}<span>Preencher à mão<small>Com ou sem arquivo</small></span></button>
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
        <div style="display:flex;gap:10px;align-items:center">${s.ai ? `<span class="pp-mateface" aria-hidden="true"><img src="/assets/img/mascot/mate-head-neutral.webp?v=20261027-m2" alt="" width="36" height="36"></span>` : ''}<div><strong style="font-size:17px">${s.ai ? 'Confira o que lemos' : 'Dados do pedido'}</strong><div class="pp-muted" style="font-size:14px">${s.ai ? `${plural(filled, 'campo preenchido', 'campos preenchidos')}${checked ? ` · <span class="pp-late">${plural(checked, 'para conferir', 'para conferir')}</span>` : ''} · nada é enviado antes de você confirmar` : 'Preencha o que souber. Endereço e título são obrigatórios.'}</div></div></div>
        <button type="button" class="pp-link" id="ppRestart">${s.files.length || s.ai ? 'Trocar arquivo' : 'Começar de novo'}</button>
      </div>
      <div class="pp-cols">
        ${originalHtml(s)}
        <form class="pp-card pp-form" id="ppReqForm" novalidate>
          ${matchHtml}
          ${s.warnings.map((w) => `<p class="pp-warn">${esc(w)}</p>`).join('')}
          ${filesEditor(s)}
          <div class="pp-fields">
            ${field('address', { required: true, wide: true, max: 300, auto: 'street-address' })}
            ${field('title', { required: true, wide: true, max: 160 })}
            ${field('service_type', { max: 100 })}
            ${field('preferred_date', { type: 'date' })}
            ${field('pickup', { wide: true, max: 200 })}
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
        </form>
      </div>
      ${measurementBanner(s)}
      <div class="pp-card pp-q-card">${itemsEditor(s)}</div>
      <div class="pp-card pp-q-send">
        <p class="pp-error" id="ppReqError" role="alert" hidden></p>
        <div class="pp-q-send-row">
          <span class="pp-muted">${s.mode === 'update' && match ? 'Os serviços entram nas notas do job atual.' : `Chega em ${esc(providerName())} como job${f.preferred_date ? ' agendado' : ''}, com os serviços acima.`}</span>
          <div class="pp-form-actions" style="border:0;padding:0;margin:0">
            <button type="button" class="pp-btn pp-btn--sec" id="ppDiscard">Descartar</button>
            <button type="button" class="pp-btn pp-btn--pri" id="ppSubmit" data-submit>${s.mode === 'update' && match ? 'Enviar atualização' : 'Enviar pedido'}</button>
          </div>
        </div>
      </div>
      <div class="pp-fixbar"><button type="button" class="pp-btn pp-btn--sec" data-discard>Descartar</button><button type="button" class="pp-btn pp-btn--pri" data-submit>${s.mode === 'update' && match ? 'Enviar atualização' : 'Enviar pedido'}</button></div>`;
  }

  const UOMS = ['SF', 'LF', 'EA', 'STEP', 'SY', 'HR'];
  const UOM_FROM_UNIT = { sq_ft: 'SF', sqft: 'SF', square_feet: 'SF', linear_ft: 'LF', linear_feet: 'LF', lf: 'LF', unit: 'EA', units: 'EA', each: 'EA', piece: 'EA', fixed: 'EA', step: 'STEP', steps: 'STEP', sq_yd: 'SY', hour: 'HR' };
  function uomForUnit(unit) {
    return UOM_FROM_UNIT[String(unit || 'sq_ft').trim().toLowerCase().replace(/\s+/g, '_')] || 'EA';
  }
  const UOM_LABEL = { SF: 'sq ft', LF: 'lin ft', EA: 'un', STEP: 'degrau', SY: 'sq yd', HR: 'hora' };
  function itemTotal(it) {
    if (it.rate != null && it.rate !== '' && !Number.isNaN(Number(it.rate))) return Math.round(Number(it.rate) * Number(it.quantity || 0) * 100) / 100;
    return it.total == null ? null : Number(it.total);
  }
  function itemMode(it) {
    return it.pricing_item_id ? 'linked' : it.create_service === false ? 'none' : 'new';
  }
  function itemTitle(s, it) {
    const cat = it.pricing_item_id && (s.catalog || []).find((c) => c.id === it.pricing_item_id);
    if (cat) return cat.name;
    return String(it.service_name || it.description || it.detail || 'Serviço').trim();
  }
  /** Order wording under the service name (what the builder's paper says). */
  function itemSub(it) {
    return [it.description, it.detail].map((x) => String(x || '').trim()).filter(Boolean).join(' · ');
  }
  const MODE_BADGE = {
    linked: '<span class="pp-q-badge pp-q-badge--ok">cadastro</span>',
    new: '<span class="pp-q-badge pp-q-badge--new">novo no cadastro</span>',
    none: '<span class="pp-q-badge">só neste job</span>',
  };

  /** The builder's own measurement for this address, sent with the job (PDF, photos, sizes). */
  function measurementBanner(s) {
    const m = s.measurement;
    if (!state.builder || !m) return '';
    const lines = (m.summary || []).slice(0, 8);
    return `<section class="pp-card pp-meas-hit ${s.useMeasurement ? 'is-on' : ''}" aria-labelledby="ppMeasHitT">
      <div class="pp-meas-hit-head">
        <div><span class="pp-lbl">Medição encontrada para este endereço</span><h3 id="ppMeasHitT">${esc(m.address)}</h3>
          <p class="pp-muted">${esc(countsText(m.counts || {}))} · medido por ${esc(m.measured_by || '—')} em ${esc(fmtDay(m.measured_at))}${m.status === 'used' ? ' · <span class="pp-late">já enviada em outro job</span>' : m.status === 'draft' ? ' · ainda em andamento' : ''}</p></div>
        <a class="pp-btn pp-btn--sec pp-btn--sm" href="#medicoes/${esc(m.id)}" target="_blank" rel="noopener">Ver medição</a>
      </div>
      ${lines.length ? `<ul class="pp-meas-sum pp-meas-sum--compact">${lines.map((l) => `<li><span>${esc(l.text)}</span><em>${esc(l.qty)} ${esc(l.uom)}</em></li>`).join('')}${(m.summary || []).length > lines.length ? `<li class="pp-muted">+ ${(m.summary || []).length - lines.length} itens</li>` : ''}</ul>` : ''}
      <label class="pp-meas-use"><input type="checkbox" id="ppUseMeas" ${s.useMeasurement ? 'checked' : ''} /> <span>Enviar a medição com este job — PDF, fotos e as medidas nas linhas de treads, risers, nosings e vents</span></label>
    </section>`;
  }

  /** Services of the order, laid out like the quote's items: name, qty, unit, price, total. */
  function itemsEditor(s) {
    const items = s.items || [];
    const live = items.filter((it) => !it.remove);
    const sum = Math.round(live.reduce((acc, it) => acc + (itemTotal(it) || 0), 0) * 100) / 100;
    const off = s.laborTotal != null && Math.abs(sum - s.laborTotal) > 0.5;
    const counts = { linked: 0, new: 0, none: 0 };
    live.forEach((it) => { counts[itemMode(it)] += 1; });
    const row = (it, i) => {
      const t = itemTotal(it);
      const open = s.editItem === i;
      return `<article class="pp-q-row ${it.remove ? 'is-off' : ''} ${open ? 'is-editing' : ''}" role="listitem">
        <div class="pp-q-name" role="button" tabindex="0" data-it-edit="${i}" title="Editar serviço">
          <b>${esc(itemTitle(s, it))}</b>${it.remove ? '<span class="pp-q-badge">fora do job</span>' : MODE_BADGE[itemMode(it)]}
          ${itemSub(it) ? `<small>${esc(itemSub(it))}</small>` : ''}
          ${it.area ? `<small class="pp-q-area">${esc(it.area)}</small>` : ''}
        </div>
        <label class="pp-q-qty"><span class="pp-q-lbl">Qtd</span><input type="text" inputmode="decimal" data-it="${i}" data-k="quantity" value="${esc(it.quantity)}" aria-label="Quantidade de ${esc(itemTitle(s, it))}" ${it.remove ? 'disabled' : ''} /></label>
        <label class="pp-q-unit"><span class="pp-q-lbl">Un.</span><select data-it="${i}" data-k="uom" aria-label="Unidade" ${it.remove ? 'disabled' : ''}>${UOMS.concat(UOMS.includes(it.uom) ? [] : [it.uom]).map((u) => `<option value="${esc(u)}" ${u === it.uom ? 'selected' : ''}>${esc(UOM_LABEL[u] || u)}</option>`).join('')}</select></label>
        <label class="pp-q-rate"><span class="pp-q-lbl">Preço</span><span class="pp-q-cur">$</span><input type="text" inputmode="decimal" data-it="${i}" data-k="rate" value="${it.rate == null ? '' : esc(Number(it.rate).toFixed(2))}" placeholder="—" aria-label="Preço de ${esc(itemTitle(s, it))}" ${it.remove ? 'disabled' : ''} /></label>
        <span class="pp-q-total" data-it-total="${i}">${t == null ? '—' : money(t)}</span>
        <div class="pp-q-act">
          <button type="button" class="pp-q-ic" data-it-edit="${i}" aria-label="Editar ${esc(itemTitle(s, it))}" title="Editar">✎</button>
          <button type="button" class="pp-q-ic pp-q-ic--del" data-it-rm="${i}" aria-label="${it.remove ? 'Voltar' : 'Tirar'} ${esc(itemTitle(s, it))}" title="${it.remove ? 'Voltar para o job' : 'Tirar do job'}">${it.remove ? '↺' : '×'}</button>
        </div>
        ${open ? itemPanel(s, it, i) : ''}
      </article>`;
    };
    return `<section class="pp-q pp-field--wide" aria-labelledby="ppItemsTitle">
      <div class="pp-q-head">
        <h3 id="ppItemsTitle">Itens · ${live.length}</h3>
        <span class="pp-muted">${live.length ? [counts.linked ? `${counts.linked} do cadastro` : '', counts.new ? `${counts.new} ${counts.new === 1 ? 'novo' : 'novos'}` : '', counts.none ? `${counts.none} só no job` : ''].filter(Boolean).join(' · ') : 'Os serviços viram as linhas do job.'}</span>
      </div>
      ${items.length ? `<div class="pp-q-cols" aria-hidden="true"><span>Serviço</span><span class="r">Qtd</span><span>Un.</span><span class="r">Preço</span><span class="r">Total</span><span></span></div>
      <div class="pp-q-list" role="list">${items.map(row).join('')}</div>` : '<p class="pp-q-empty">Nenhum serviço lido nesta ordem.</p>'}
      <button type="button" class="pp-q-add" id="ppItemAdd">+ Adicionar serviço</button>
      ${s.pickCatalog ? catalogSheet(s) : ''}
      <div class="pp-q-sum">
        <div><span>Subtotal</span><b id="ppItemsSum">${money(sum)}</b></div>
        ${s.laborTotal != null ? `<div class="${off ? 'pp-late' : ''}" id="ppItemsCheckRow"><span>Total na ordem</span><b id="ppItemsCheck">${money(s.laborTotal)} ${off ? '· confira' : '✓'}</b></div>` : ''}
      </div>
    </section>`;
  }

  /** Inline editor under a line (like the quote's item editor): which service, name, wording. */
  function itemPanel(s, it, i) {
    const mode = itemMode(it);
    const value = it.pricing_item_id || (mode === 'none' ? '__none' : '__new');
    return `<div class="pp-q-panel">
      <div class="pp-q-field pp-q-field--wide"><label for="ppItCat-${i}">Serviço no cadastro de ${esc(providerName())}</label>
        <select id="ppItCat-${i}" data-it="${i}" data-k="catalog">
          <option value="__new" ${value === '__new' ? 'selected' : ''}>+ Criar serviço novo no cadastro</option>
          ${(s.catalog || []).map((c) => `<option value="${esc(c.id)}" ${c.id === value ? 'selected' : ''}>${esc(c.name)} · ${esc(unitLabel(c.unit))}</option>`).join('')}
          <option value="__none" ${value === '__none' ? 'selected' : ''}>Não cadastrar (fica só neste job)</option>
        </select>
        <span class="pp-q-help">${mode === 'linked' ? 'O job usa este serviço com o preço da ordem.' : mode === 'new' ? 'Entra no cadastro da empresa com a unidade e o preço desta linha.' : 'A linha vai para o job sem virar serviço do cadastro.'}</span>
      </div>
      ${mode === 'new' ? `<div class="pp-q-field pp-q-field--wide"><label for="ppItName-${i}">Nome do serviço novo</label><input id="ppItName-${i}" data-it="${i}" data-k="service_name" value="${esc(it.service_name || it.description || '')}" maxlength="120" /></div>` : ''}
      <div class="pp-q-field"><label for="ppItDesc-${i}">Produto / descrição da ordem</label><input id="ppItDesc-${i}" data-it="${i}" data-k="description" value="${esc(it.description)}" maxlength="200" /></div>
      <div class="pp-q-field"><label for="ppItDet-${i}">Detalhe da instalação</label><input id="ppItDet-${i}" data-it="${i}" data-k="detail" value="${esc(it.detail)}" maxlength="200" /></div>
      <div class="pp-q-field pp-q-field--wide"><label for="ppItArea-${i}">Ambientes</label><input id="ppItArea-${i}" data-it="${i}" data-k="area" value="${esc(it.area)}" maxlength="200" /></div>
      <div class="pp-q-panel-actions"><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-it-done>Pronto</button></div>
    </div>`;
  }

  /** Catalog list to add a service (like the quote's "Adicionar serviço"). */
  function catalogSheet(s) {
    const q = String(s.catalogQuery || '').trim().toLowerCase();
    const list = (s.catalog || []).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 60);
    return `<div class="pp-q-sheet" role="dialog" aria-label="Adicionar serviço">
      <div class="pp-q-sheet-head"><input id="ppCatSearch" type="search" placeholder="Buscar no cadastro de ${esc(providerName())}" value="${esc(s.catalogQuery || '')}" autocomplete="off" /><button type="button" class="pp-q-ic" id="ppCatClose" aria-label="Fechar">×</button></div>
      <div class="pp-q-sheet-list">
        ${list.map((c) => `<button type="button" class="pp-q-opt" data-cat-add="${esc(c.id)}"><span><b>${esc(c.name)}</b><small>${esc(unitLabel(c.unit))}${c.category ? ` · ${esc(({ installation: 'Instalação', sand_finish: 'Lixa e acabamento', supply: 'Material', custom: 'Outros' })[c.category] || c.category.replace(/_/g, ' '))}` : ''}</small></span>${c.price != null ? `<em>${money(c.price)}</em>` : ''}</button>`).join('') || '<p class="pp-q-empty">Nada com esse nome no cadastro.</p>'}
      </div>
      <button type="button" class="pp-q-opt pp-q-opt--free" id="ppCatFree"><span><b>+ Linha livre</b><small>Serviço que não está no cadastro</small></span></button>
    </div>`;
  }

  function bindItems() {
    const s = state.send;
    const refreshSum = () => {
      const live = s.items.filter((it) => !it.remove);
      const sum = Math.round(live.reduce((acc, it) => acc + (itemTotal(it) || 0), 0) * 100) / 100;
      const el = $('ppItemsSum');
      if (el) el.textContent = money(sum);
      const chk = $('ppItemsCheck');
      if (chk && s.laborTotal != null) {
        const off = Math.abs(sum - s.laborTotal) > 0.5;
        $('ppItemsCheckRow').className = off ? 'pp-late' : '';
        chk.textContent = `${money(s.laborTotal)} ${off ? '· confira' : '✓'}`;
      }
    };
    const rerender = (focusSel) => {
      renderSendBody();
      if (focusSel) { const el = view.querySelector(focusSel); if (el) el.focus(); }
    };
    view.querySelectorAll('[data-it]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const i = Number(el.getAttribute('data-it'));
      const it = s.items[i];
      const k = el.getAttribute('data-k');
      if (k === 'quantity') it.quantity = Number(String(el.value).replace(/,/g, '')) || 0;
      else if (k === 'rate') it.rate = el.value === '' ? null : Number(String(el.value).replace(/[$,]/g, '')) || 0;
      else if (k === 'catalog') {
        it.pricing_item_id = el.value.startsWith('__') ? null : el.value;
        it.create_service = el.value !== '__none';
        if (it.pricing_item_id) {
          const c = (s.catalog || []).find((x) => x.id === it.pricing_item_id);
          if (c && it.rate == null && c.price != null) it.rate = c.price;
        }
        return rerender(`#ppItCat-${i}`);
      } else it[k] = el.value;
      if (k === 'quantity' || k === 'rate') {
        if (it.rate == null && k === 'quantity') it.total = null;
        const t = view.querySelector(`[data-it-total="${i}"]`);
        if (t) t.textContent = itemTotal(it) == null ? '—' : money(itemTotal(it));
        refreshSum();
      }
    }));
    view.querySelectorAll('.pp-q-row input[data-k="quantity"], .pp-q-row input[data-k="rate"]').forEach((el) => el.addEventListener('focus', () => el.select()));
    view.querySelectorAll('[data-it-edit]').forEach((el) => {
      const open = () => { const i = Number(el.getAttribute('data-it-edit')); s.editItem = s.editItem === i ? null : i; rerender(s.editItem != null ? `#ppItCat-${i}` : ''); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    view.querySelectorAll('[data-it-done]').forEach((b) => b.addEventListener('click', () => { s.editItem = null; rerender(); }));
    view.querySelectorAll('[data-it-rm]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.getAttribute('data-it-rm'));
      const it = s.items[i];
      if (!it.description && !it.detail && !it.service_name && !it.pricing_item_id && !it.quantity) { s.items.splice(i, 1); s.editItem = null; }
      else it.remove = !it.remove;
      rerender();
    }));
    const add = $('ppItemAdd');
    if (add) add.addEventListener('click', () => {
      if (!(s.catalog || []).length) return addFree();
      s.pickCatalog = !s.pickCatalog;
      rerender(s.pickCatalog ? '#ppCatSearch' : '');
    });
    function addFree() {
      s.items.push({ area: '', description: '', detail: '', quantity: 0, uom: 'SF', rate: null, total: null, pricing_item_id: null, service_name: '', create_service: true, remove: false });
      s.pickCatalog = false;
      s.editItem = s.items.length - 1;
      rerender(`#ppItName-${s.editItem}`);
    }
    const search = $('ppCatSearch');
    if (search) search.addEventListener('input', () => {
      s.catalogQuery = search.value;
      const pos = search.selectionStart;
      rerender('#ppCatSearch');
      const again = $('ppCatSearch');
      if (again) again.setSelectionRange(pos, pos);
    });
    const closeCat = $('ppCatClose');
    if (closeCat) closeCat.addEventListener('click', () => { s.pickCatalog = false; rerender(); });
    const free = $('ppCatFree');
    if (free) free.addEventListener('click', addFree);
    view.querySelectorAll('[data-cat-add]').forEach((b) => b.addEventListener('click', () => {
      const c = (s.catalog || []).find((x) => x.id === b.getAttribute('data-cat-add'));
      if (!c) return;
      s.items.push({ area: '', description: '', detail: '', quantity: 0, uom: uomForUnit(c.unit), rate: c.price, total: null, pricing_item_id: c.id, service_name: c.name, create_service: true, remove: false });
      s.pickCatalog = false;
      s.catalogQuery = '';
      rerender(`[data-it="${s.items.length - 1}"][data-k="quantity"]`);
    }));
  }
  /** Lines as sent to the server (removed and empty ones left out). */
  function itemsPayload(s) {
    return (s.items || [])
      .filter((it) => !it.remove && (String(it.description || '').trim() || String(it.detail || '').trim() || String(it.service_name || '').trim() || it.pricing_item_id))
      .map((it) => ({
        area: String(it.area || '').slice(0, 200),
        description: String(it.description || it.service_name || '').trim().slice(0, 200),
        detail: String(it.detail || '').trim().slice(0, 200),
        quantity: Math.max(0, Number(it.quantity) || 0),
        uom: String(it.uom || 'SF').slice(0, 12),
        rate: it.rate == null || it.rate === '' ? null : Math.max(0, Number(it.rate) || 0),
        total: itemTotal(it),
        pricing_item_id: it.pricing_item_id || null,
        service_name: String(it.service_name || '').trim().slice(0, 120),
        create_service: it.create_service !== false,
      }))
      .slice(0, 40);
  }

  function filesEditor(s) {
    const chips = s.files.length
      ? `<div class="pp-files">${s.files.map((f, i) => `<span class="pp-file">${esc(f.name)} · ${fileSize(f.size)}<button type="button" data-remove="${i}" aria-label="Tirar ${esc(f.name)}">×</button></span>`).join('')}</div>`
      : '<span class="pp-muted" style="font-size:14px">Nenhum arquivo ainda. PDF, JPG, PNG ou WebP.</span>';
    return `<div class="pp-field pp-field--wide" id="ppFileBox">
      <span style="font-size:13px;color:var(--pp-muted);font-weight:500">Arquivos</span>
      ${chips}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" id="ppAddFiles">Adicionar arquivos</button>
        <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" id="ppAddCamera">Tirar foto</button>
      </div>
    </div>`;
  }

  function bindReview() {
    const s = state.send;
    view.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', () => {
      s.fields[el.getAttribute('data-field')] = el.value;
      el.closest('.pp-field').classList.remove('is-check');
    }));
    const addFilesBtn = $('ppAddFiles');
    if (addFilesBtn) addFilesBtn.addEventListener('click', () => $('ppFileInput').click());
    const addCam = $('ppAddCamera');
    if (addCam) addCam.addEventListener('click', () => $('ppCameraInput').click());
    bindDrop($('ppFileBox'), async (fl) => { await addFiles(fl); renderSendBody(); });
    view.querySelectorAll('#ppFileBox [data-remove]').forEach((b) => b.addEventListener('click', () => {
      const f = s.files.splice(Number(b.getAttribute('data-remove')), 1)[0];
      if (f && f.url) URL.revokeObjectURL(f.url);
      renderSendBody();
    }));
    view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { s.mode = b.getAttribute('data-mode'); renderSendBody(); }));
    $('ppRestart').addEventListener('click', () => { const preset = s.presetJob; const co = s.co; state.send = newSend(); state.send.presetJob = preset; state.send.co = co; renderSendBody(); });
    const discard = () => { state.send = newSend(); renderSendBody(); };
    $('ppDiscard').addEventListener('click', discard);
    view.querySelectorAll('[data-discard]').forEach((b) => b.addEventListener('click', discard));
    bindItems();
    const use = $('ppUseMeas');
    if (use) use.addEventListener('change', () => { s.useMeasurement = use.checked; use.closest('.pp-meas-hit').classList.toggle('is-on', use.checked); });
    const addrEl = $('ppF-address');
    if (addrEl && state.builder) addrEl.addEventListener('blur', async () => {
      const a = addrEl.value.trim();
      if (a.length < 6 || a === s.measuredLookup) return;
      s.measuredLookup = a;
      try {
        const r = await api(`/api/builder/measurements/match?address=${encodeURIComponent(a)}`);
        const found = r.data;
        if (found && (!s.measurement || s.measurement.id !== found.id)) {
          s.measurement = found;
          s.useMeasurement = found.status !== 'used';
          renderSendBody();
        }
      } catch (_) { /* no measurement lookup */ }
    });
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
      if (companyInvited()) {
        await postJson(`/api/builder/companies/${encodeURIComponent(sendCo().id)}/jobs`, {
          title: f.title.trim().slice(0, 160),
          address: f.address.trim().slice(0, 300),
          contact_name: f.contact_name.trim(),
          contact_email: f.contact_email.trim(),
          contact_phone: f.contact_phone.trim(),
          service_type: f.service_type.trim().slice(0, 100),
          preferred_date: /^\d{4}-\d{2}-\d{2}$/.test(f.preferred_date) ? f.preferred_date : '',
          notes: notes.slice(0, 5000),
          external_ref: f.external_ref.trim().slice(0, 60),
          files: s.files.map((x) => ({ name: x.name, data_url: x.dataUrl })),
          items: itemsPayload(s),
          pickup: (f.pickup || '').trim().slice(0, 200),
          measurement_id: s.measurement && s.useMeasurement ? s.measurement.id : '',
        });
        s.files.forEach((x) => x.url && URL.revokeObjectURL(x.url));
        s.sent = { kept: true };
        s.phase = 'done';
        renderSendBody();
        renderRequestsList();
        return;
      }
      const sent = await postJson('/api/partner-portal/requests', {
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
        intake: { source: s.ai ? 'ai' : 'manual', fields_checked: s.check, ...(s.model ? { model: s.model.slice(0, 80) } : {}), items: itemsPayload(s), labor_total: s.laborTotal, pickup: (f.pickup || '').trim().slice(0, 200), ...(s.measurement && s.useMeasurement ? { measurement_id: s.measurement.id } : {}) },
      }, state.builder ? sendCo().id : undefined);
      s.files.forEach((x) => x.url && URL.revokeObjectURL(x.url));
      s.sent = { update: Boolean(update), jobId: sent.data && sent.data.job_id, direct: Boolean(sent.data && sent.data.status === 'accepted') };
      if (s.sent.direct) { state.jobDetail.clear(); refreshOverview().catch(() => {}); }
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
      <div class="pp-head"><div><p class="pp-eyebrow">${state.builder && multiCo() && !state.coFilter ? 'Liberados pelas equipes das suas empresas' : `Liberados pela equipe de ${esc(providerName())}`}</p><h1>Fotos e docs</h1></div><span class="pp-muted">${plural(list.length, 'item', 'itens')}</span></div>
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

  /* ─────────────────────────── builder account: companies, team, job edits ─────────────────────────── */

  const ROLE_PT = { admin: 'Admin', manager: 'Gerente', office: 'Escritório', field: 'Campo' };

  async function refreshOverview() {
    if (!companyActive()) {
      state.jobs = [];
      state.projects = [];
      return;
    }
    if (state.builder) {
      const parts = await fetchEach('/api/partner-portal/overview');
      state.all.jobs = parts.flatMap((p) => tagCo((p.data || {}).jobs, p.c)).filter((j) => j.status !== 'canceled');
      state.all.projects = parts.flatMap((p) => tagCo((p.data || {}).projects, p.c));
      applyCoFilter();
      return;
    }
    const overview = await api('/api/partner-portal/overview');
    const data = overview.data || {};
    state.jobs = (data.jobs || []).filter((j) => j.status !== 'canceled');
    state.projects = data.projects || [];
    if (Array.isArray(data.permissions)) state.perms = data.permissions;
  }

  async function loadMe() {
    const r = await api('/api/builder/me');
    state.builder = r.data;
    state.perms = r.data.permissions || [];
    state.company = (r.data.companies || []).find((c) => c.id === r.data.current_company_id) || null;
  }

  /** Company the next job goes to (the portal shows every company at once). */
  async function selectCompany(id) {
    await postJson('/api/builder/select', { company_id: id });
    state.send = null;
    await loadMe();
    paintShell();
  }
  /** After connecting or removing a company: reload everything. */
  async function reloadAllCompanies() {
    state.loaded = { invoices: false, requests: false, documents: false };
    state.jobDetail.clear();
    await loadMe();
    paintShell();
    await refreshOverview();
    loadInvoices().then(updateCounts).catch(() => {});
    loadRequests().then(updateCounts).catch(() => {});
  }

  function companyStatusChip(c) {
    if (c.status === 'active') return '<span class="pp-chip pp-chip--ok">Conectada</span>';
    if (c.status === 'invited') return '<span class="pp-chip pp-chip--late">Convite enviado</span>';
    return '<span class="pp-chip">Indisponível</span>';
  }

  function smsHref(phone, text) {
    const digits = String(phone || '').replace(/[^\d+]/g, '');
    const sep = /iPhone|iPad|Mac/i.test(navigator.userAgent) ? '&' : '?';
    return `sms:${digits}${sep}body=${encodeURIComponent(text)}`;
  }

  async function renderNoCompany(token) {
    const companies = (state.builder && state.builder.companies) || [];
    if (token !== renderToken) return;
    const invited = companies.filter((c) => c.status === 'invited');
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>${companies.length ? 'Escolha uma empresa' : 'Bem-vindo ao ObraMate'}</h1></div></div>
      <div class="pp-card pp-block" style="max-width:720px">
        <h3 style="font-size:18px">${companies.length ? 'Nenhuma empresa conectada ainda' : 'Conecte sua primeira empresa de piso'}</h3>
        <p class="pp-muted" style="margin:0">Já usa ObraMate? Conecte pelo e-mail do admin dela e os jobs que você enviar entram direto no sistema dela. Ainda não usa? Convide por e-mail ou mensagem — os jobs que você mandar ficam guardados até ela entrar.</p>
        ${canDo('companies.manage') ? '<div><a class="pp-btn pp-btn--pri" href="#empresas">Adicionar empresa</a></div>' : '<p class="pp-muted" style="margin:0">Peça ao admin ou gerente da sua equipe para conectar uma empresa.</p>'}
      </div>
      ${invited.length ? `<div class="pp-card" style="overflow:hidden;max-width:720px"><div class="pp-group">Convidadas · ${invited.length}</div>${invited.map((c) => `<button type="button" class="pp-row" data-pick="${esc(c.id)}"><span class="pp-row-main"><span class="pp-row-top"><strong>${esc(c.company_name)}</strong>${companyStatusChip(c)}</span><span class="pp-row-sub">${esc(c.contact_email || '')}${c.pending_jobs ? ` · ${plural(c.pending_jobs, 'job guardado', 'jobs guardados')}` : ''}</span></span></button>`).join('')}</div>` : ''}`;
    view.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => { await selectCompany(b.getAttribute('data-pick')); location.hash = '#enviar'; render(); }));
  }

  async function renderCompanies(token) {
    await loadMe();
    if (token !== renderToken) return;
    const companies = state.builder.companies || [];
    const manage = canDo('companies.manage');
    const row = (c) => `<div class="pp-req" style="padding:14px 18px">
        <div class="pp-req-top"><strong style="font-size:16px">${esc(c.company_name)}</strong>${companyStatusChip(c)}</div>
        <p>${esc([c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · '))}</p>
        <p>${c.status === 'active' ? `Conectada ${esc(fmtDay(c.activated_at))}` : `Convite enviado ${esc(fmtDay(c.invited_at))}`}${c.pending_jobs ? ` · ${plural(c.pending_jobs, 'job guardado', 'jobs guardados')}` : ''}</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
          ${canDo('jobs.send') && c.status !== 'unavailable' ? `<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-send-to="${esc(c.id)}">Enviar job</button>` : ''}
          ${c.status === 'active' ? `<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-see-jobs="${esc(c.id)}">Ver jobs</button>` : ''}
          ${manage && c.status === 'invited' ? `<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-resend="${esc(c.id)}">Reenviar convite</button>` : ''}
          ${manage ? `<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-remove-co="${esc(c.id)}">Remover</button>` : ''}
        </div>
        <div data-invite-out="${esc(c.id)}"></div>
      </div>`;
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>Empresas</h1></div></div>
      <div class="pp-split pp-split--stack">
        <section class="pp-main">
          <div class="pp-card" style="overflow:hidden">
            ${companies.length ? companies.map(row).join('') : '<div class="pp-empty"><strong>Nenhuma empresa ainda</strong>Adicione a empresa de piso que faz seus jobs.</div>'}
          </div>
        </section>
        ${manage ? `<aside class="pp-card pp-side pp-block" aria-labelledby="ppAddCo">
          <h3 id="ppAddCo" style="font-size:17px">Adicionar empresa</h3>
          <p class="pp-muted" style="margin:0;font-size:14px">Informe o e-mail do admin da empresa de piso. Se ela já usa ObraMate, conecta na hora. Se não, mandamos o convite com o preço de indicação.</p>
          <form id="ppCoForm" class="pp-fields" style="grid-template-columns:1fr" novalidate>
            <div class="pp-field"><label for="ppCoEmail">E-mail do admin *</label><input id="ppCoEmail" type="email" maxlength="200" autocomplete="off" required /></div>
            <div class="pp-field"><label for="ppCoName">Nome da empresa</label><input id="ppCoName" maxlength="120" placeholder="Só se ela ainda não usa ObraMate" /></div>
            <div class="pp-field"><label for="ppCoContact">Contato</label><input id="ppCoContact" maxlength="120" /></div>
            <div class="pp-field"><label for="ppCoPhone">Celular (para o convite por mensagem)</label><input id="ppCoPhone" type="tel" maxlength="40" /></div>
            <p class="pp-error" id="ppCoError" role="alert" hidden></p>
            <div id="ppCoResult"></div>
            <div><button type="submit" class="pp-btn pp-btn--pri" id="ppCoSave">Conectar ou convidar</button></div>
          </form>
        </aside>` : ''}
      </div>`;
    view.querySelectorAll('[data-send-to]').forEach((b) => b.addEventListener('click', () => {
      state.send = newSend();
      state.send.co = b.getAttribute('data-send-to');
      postJson('/api/builder/select', { company_id: state.send.co }).catch(() => {});
      location.hash = '#enviar';
    }));
    view.querySelectorAll('[data-see-jobs]').forEach((b) => b.addEventListener('click', () => {
      state.coFilter = b.getAttribute('data-see-jobs');
      applyCoFilter();
      location.hash = '#jobs';
    }));
    const inviteActions = (out, data, phone) => {
      if (!out) return;
      out.innerHTML = `<div class="pp-success" style="margin-top:10px">Convite enviado por e-mail${data.offer ? ` · oferta: ${esc(data.offer)}` : ''}.</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
          <a class="pp-btn pp-btn--pri pp-btn--sm" href="${esc(smsHref(phone, data.sms_text))}">Enviar por mensagem</a>
          <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-copy="${esc(data.invite_url)}">Copiar link</button>
        </div>`;
      out.querySelectorAll('[data-copy]').forEach((c) => c.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(c.getAttribute('data-copy')); c.textContent = 'Copiado'; } catch (_) { window.prompt('Copie o link', c.getAttribute('data-copy')); }
      }));
    };
    view.querySelectorAll('[data-resend]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-resend');
      b.disabled = true;
      b.textContent = 'Enviando…';
      try {
        const r = await postJson(`/api/builder/companies/${encodeURIComponent(id)}/resend`, {});
        const c = companies.find((x) => x.id === id) || {};
        inviteActions(view.querySelector(`[data-invite-out="${CSS.escape(id)}"]`), r.data, c.contact_phone);
        b.textContent = 'Reenviado';
      } catch (e) {
        b.disabled = false;
        b.textContent = 'Reenviar convite';
        window.alert(e.message);
      }
    }));
    view.querySelectorAll('[data-remove-co]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmar remoção'; return; }
      b.disabled = true;
      try {
        await api(`/api/builder/companies/${encodeURIComponent(b.getAttribute('data-remove-co'))}`, { method: 'DELETE' });
        await reloadAllCompanies();
        render();
      } catch (e) {
        b.disabled = false;
        window.alert(e.message);
      }
    }));
    const form = $('ppCoForm');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ppCoError');
      const btn = $('ppCoSave');
      err.hidden = true;
      $('ppCoResult').innerHTML = '';
      btn.disabled = true;
      btn.textContent = 'Procurando…';
      const phone = $('ppCoPhone').value.trim();
      try {
        const r = await postJson('/api/builder/companies', {
          email: $('ppCoEmail').value.trim(),
          company_name: $('ppCoName').value.trim(),
          contact_name: $('ppCoContact').value.trim(),
          phone,
        });
        const data = r.data;
        await reloadAllCompanies();
        if (data.kind === 'linked') {
          $('ppCoResult').innerHTML = `<div class="pp-success">${esc(data.company_name)} já usa ObraMate e está conectada. Os jobs que você enviar entram direto no sistema dela.</div><div style="margin-top:8px"><a class="pp-btn pp-btn--pri pp-btn--sm" href="#enviar">Enviar um job</a></div>`;
        } else {
          inviteActions($('ppCoResult'), data, phone);
        }
        form.reset();
        const list = view.querySelector('.pp-main .pp-card');
        if (list) list.innerHTML = (state.builder.companies || []).map(row).join('');
      } catch (ex) {
        err.textContent = ex.message || 'Não foi possível adicionar.';
        err.hidden = false;
        if (/nome/i.test(ex.message || '')) $('ppCoName').focus();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Conectar ou convidar';
      }
    });
  }

  async function renderTeam(token) {
    const r = await api('/api/builder/team');
    if (token !== renderToken) return;
    const rows = r.data || [];
    const manage = canDo('team.manage');
    const roles = state.builder.roles || [];
    const me = state.builder.member.id;
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>Equipe</h1></div></div>
      <div class="pp-split pp-split--stack">
        <section class="pp-main">
          <div class="pp-card" style="overflow:hidden">
            ${rows.map((m) => `<div class="pp-req" style="padding:14px 18px">
              <div class="pp-req-top"><strong style="font-size:16px">${esc(m.name)}${m.id === me ? ' <span class="pp-muted" style="font-weight:500">(você)</span>' : ''}</strong>${m.status === 'invited' ? '<span class="pp-chip pp-chip--late">Convite enviado</span>' : `<span class="pp-chip">${esc(ROLE_PT[m.role] || m.role)}</span>`}</div>
              <p>${esc(m.email)}${m.phone ? ` · ${esc(m.phone)}` : ''}${m.last_login_at ? ` · entrou ${esc(fmtDay(m.last_login_at))}` : ''}</p>
              ${manage && m.id !== me ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center">
                <label class="pp-sr" for="ppRole-${esc(m.id)}">Papel de ${esc(m.name)}</label>
                <select id="ppRole-${esc(m.id)}" data-role="${esc(m.id)}" style="min-height:38px;border:1px solid var(--pp-border);border-radius:10px;padding:0 10px;background:#fff">${roles.map((ro) => `<option value="${ro.key}" ${ro.key === m.role ? 'selected' : ''}>${esc(ro.label)}</option>`).join('')}</select>
                <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-disable="${esc(m.id)}">Remover acesso</button>
              </div>` : ''}
            </div>`).join('')}
          </div>
          <div class="pp-card pp-block">
            <h3>O que cada papel faz</h3>
            <ul class="tk-list">${roles.map((ro) => `<li><span><b>${esc(ro.label)}</b><small>${esc(ro.hint)}</small></span></li>`).join('')}</ul>
          </div>
        </section>
        ${manage ? `<aside class="pp-card pp-side pp-block">
          <h3 style="font-size:17px">Convidar pessoa</h3>
          <form id="ppTeamForm" class="pp-fields" style="grid-template-columns:1fr" novalidate>
            <div class="pp-field"><label for="ppTmName">Nome *</label><input id="ppTmName" maxlength="120" required /></div>
            <div class="pp-field"><label for="ppTmEmail">E-mail *</label><input id="ppTmEmail" type="email" maxlength="200" required /></div>
            <div class="pp-field"><label for="ppTmPhone">Celular</label><input id="ppTmPhone" type="tel" maxlength="40" /></div>
            <div class="pp-field"><label for="ppTmRole">Papel</label><select id="ppTmRole">${roles.map((ro) => `<option value="${ro.key}" ${ro.key === 'office' ? 'selected' : ''}>${esc(ro.label)} — ${esc(ro.hint)}</option>`).join('')}</select></div>
            <p class="pp-error" id="ppTmError" role="alert" hidden></p>
            <div id="ppTmResult"></div>
            <div><button type="submit" class="pp-btn pp-btn--pri" id="ppTmSave">Enviar convite</button></div>
          </form>
        </aside>` : ''}
      </div>`;
    view.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await api(`/api/builder/team/${encodeURIComponent(sel.getAttribute('data-role'))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: sel.value }) }); render(); } catch (e) { window.alert(e.message); render(); }
    }));
    view.querySelectorAll('[data-disable]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmar'; return; }
      try { await api(`/api/builder/team/${encodeURIComponent(b.getAttribute('data-disable'))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: true }) }); render(); } catch (e) { window.alert(e.message); }
    }));
    const form = $('ppTeamForm');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ppTmError');
      const btn = $('ppTmSave');
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Enviando…';
      try {
        const res = await postJson('/api/builder/team', { name: $('ppTmName').value.trim(), email: $('ppTmEmail').value.trim(), phone: $('ppTmPhone').value.trim(), role: $('ppTmRole').value });
        await render();
        const out = $('ppTmResult');
        if (out) out.innerHTML = `<div class="pp-success">Convite enviado por e-mail.${res.data && res.data.devLink ? ` <a href="${esc(res.data.devLink)}">Link (teste)</a>` : ''}</div>`;
      } catch (ex) {
        err.textContent = ex.message || 'Não foi possível convidar.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Enviar convite';
      }
    });
  }

  function unitLabel(unit) {
    return ({ sq_ft: 'sq ft', linear_ft: 'linear ft', step: 'degrau', unit: 'unidade', hour: 'hora', each: 'unidade' })[unit] || String(unit || '').replace(/_/g, ' ');
  }

  /** Date and time of a job in the company's time zone (what the edit form sends back). */
  function zonedParts(iso, tz) {
    const d = toDate(iso);
    if (!d) return { date: '', time: '' };
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
    } catch (_) {
      return { date: dateKey(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
    }
  }

  async function openJobEditor(data) {
    const job = data.job;
    const t = data.ticket || {};
    const pane = $('ppJobPane') || view;
    const start = zonedParts(job.scheduled_start, job.timezone);
    const end = zonedParts(job.scheduled_end, job.timezone);
    const services = (t.services || []).map((sv) => ({ id: sv.id, name: sv.name, quantity: sv.quantity, unit: sv.unit, notes: sv.notes || '', remove: false, unit_price: sv.unit_price }));
    const added = [];
    const co = data._co || undefined;
    if (state.builder) state.ctx = coById(co) || state.ctx;
    const plKey = co || '_';
    if (!state.priceLists[plKey]) {
      try { state.priceLists[plKey] = (await api('/api/partner-portal/price-list', { co })).data || []; } catch (_) { state.priceLists[plKey] = []; }
    }
    state.priceList = state.priceLists[plKey];
    const lockbox = t.lockbox || '';
    const instructions = t.notes || '';
    const draw = () => {
      const svcRow = (sv, i, kind) => `<li class="${sv.remove ? 'pp-ed-off' : ''}">
          <div class="pp-ed-svc">
            <span><b>${esc(sv.name)}</b>${sv.unit_price != null ? `<small>${money(sv.unit_price)} / ${esc(unitLabel(sv.unit))}</small>` : ''}</span>
            <label class="pp-sr" for="ppEdQ-${kind}-${i}">Quantidade de ${esc(sv.name)}</label>
            <input id="ppEdQ-${kind}-${i}" type="number" min="0" step="0.01" value="${esc(sv.quantity)}" data-q="${kind}:${i}" ${sv.remove ? 'disabled' : ''} />
            <span class="pp-muted">${esc(unitLabel(sv.unit))}</span>
            <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-rm="${kind}:${i}">${sv.remove ? 'Desfazer' : 'Remover'}</button>
          </div>
          <input type="text" placeholder="Nota do serviço (opcional)" maxlength="500" value="${esc(sv.notes)}" data-n="${kind}:${i}" ${sv.remove ? 'disabled' : ''} />
        </li>`;
      pane.innerHTML = `
        <div class="tk tk--edit">
          <section class="tk-hero">
            <div class="tk-hero-top"><button type="button" class="pp-back" data-ed-cancel style="display:inline-flex">${icon('back')}Voltar</button><div class="tk-meta"><span class="tk-num">EDITAR JOB${job.number ? ` #${esc(job.number)}` : ''}</span></div></div>
            <p class="pp-muted" style="margin:0 0 4px">As mudanças valem na hora no sistema de ${esc(providerName())} e o escritório é avisado.</p>
          </section>
          <section class="tk-sec pp-fields" style="grid-template-columns:1fr 1fr">
            <div class="pp-field pp-field--wide"><label for="ppEdTitle">Título</label><input id="ppEdTitle" maxlength="160" value="${esc(job.title || '')}" /></div>
            <div class="pp-field pp-field--wide"><label for="ppEdAddr">Endereço</label><input id="ppEdAddr" maxlength="300" value="${esc(job.address || '')}" data-om-address-autocomplete /></div>
            <div class="pp-field"><label for="ppEdDate">Data</label><input id="ppEdDate" type="date" value="${esc(start.date)}" /></div>
            <div class="pp-field"><label for="ppEdTime">Horário <span>(vazio = dia todo)</span></label><input id="ppEdTime" type="time" value="${job.all_day ? '' : esc(start.time)}" /></div>
            <div class="pp-field"><label for="ppEdEnd">Termina em</label><input id="ppEdEnd" type="date" value="${esc(end.date)}" /></div>
            <div class="pp-field"><label for="ppEdLock">Código da lockbox</label><input id="ppEdLock" maxlength="40" value="${esc(lockbox)}" /></div>
            <div class="pp-field pp-field--wide"><label for="ppEdAttn">Atenção (aparece em destaque para a equipe)</label><input id="ppEdAttn" maxlength="2000" value="${esc(t.attention || '')}" /></div>
            <div class="pp-field pp-field--wide"><label for="ppEdNotes">Instruções</label><textarea id="ppEdNotes" maxlength="5000">${esc(instructions)}</textarea></div>
          </section>
          <section class="tk-sec">
            <h3>Serviços</h3>
            <ul class="tk-list pp-ed-list">${services.map((sv, i) => svcRow(sv, i, 'e')).join('')}${added.map((sv, i) => svcRow(sv, i, 'a')).join('')}</ul>
            ${state.priceList.length ? `<div class="pp-field" style="margin-top:12px"><label for="ppEdAdd">Adicionar serviço da tabela de ${esc(providerName())}</label><select id="ppEdAdd"><option value="">Escolher serviço…</option>${state.priceList.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}${it.price != null ? ` · ${money(it.price)} / ${esc(unitLabel(it.unit))}` : ''}</option>`).join('')}</select></div>` : '<p class="tk-empty" style="margin-top:10px">A empresa não liberou a tabela de serviços no portal. Descreva novos serviços nas instruções.</p>'}
          </section>
          <p class="pp-error" id="ppEdError" role="alert" hidden></p>
          <div class="pp-form-actions" style="border:0"><button type="button" class="pp-btn pp-btn--sec" data-ed-cancel>Cancelar</button><button type="button" class="pp-btn pp-btn--pri" id="ppEdSave">Salvar alterações</button></div>
        </div>
        <div class="pp-fixbar"><button type="button" class="pp-btn pp-btn--sec" data-ed-cancel>Cancelar</button><button type="button" class="pp-btn pp-btn--pri" data-ed-save>Salvar</button></div>`;
      document.body.classList.add('pp-focus');
      if (typeof window.sfBootCrmAddressAutocomplete === 'function') window.sfBootCrmAddressAutocomplete();
      pane.querySelectorAll('[data-ed-cancel]').forEach((b) => b.addEventListener('click', () => render()));
      pane.querySelectorAll('[data-q]').forEach((el) => el.addEventListener('input', () => { const [k, i] = el.getAttribute('data-q').split(':'); (k === 'e' ? services : added)[Number(i)].quantity = Number(el.value) || 0; }));
      pane.querySelectorAll('[data-n]').forEach((el) => el.addEventListener('input', () => { const [k, i] = el.getAttribute('data-n').split(':'); (k === 'e' ? services : added)[Number(i)].notes = el.value; }));
      pane.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        const [k, i] = b.getAttribute('data-rm').split(':');
        if (k === 'a') added.splice(Number(i), 1); else services[Number(i)].remove = !services[Number(i)].remove;
        keep();
        draw();
      }));
      const add = $('ppEdAdd');
      if (add) add.addEventListener('change', () => {
        const it = state.priceList.find((x) => x.id === add.value);
        if (!it) return;
        keep();
        added.push({ pricing_item_id: it.id, name: it.name, unit: it.unit, quantity: 0, notes: '', unit_price: it.price });
        draw();
        const q = pane.querySelector(`[data-q="a:${added.length - 1}"]`);
        if (q) q.focus();
      });
      pane.querySelectorAll('#ppEdSave, [data-ed-save]').forEach((b) => b.addEventListener('click', save));
      restore();
    };
    // Keep what was typed in the plain fields across redraws.
    const fields = {};
    const keep = () => {
      ['ppEdTitle', 'ppEdAddr', 'ppEdDate', 'ppEdTime', 'ppEdEnd', 'ppEdLock', 'ppEdAttn', 'ppEdNotes'].forEach((id) => { const el = $(id); if (el) fields[id] = el.value; });
    };
    const restore = () => {
      Object.entries(fields).forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
    };
    async function save() {
      const err = $('ppEdError');
      err.hidden = true;
      const val = (id) => ($(id) ? $(id).value : '');
      const payload = {};
      if (val('ppEdTitle').trim() !== (job.title || '')) payload.title = val('ppEdTitle').trim();
      if (val('ppEdAddr').trim() !== (job.address || '')) payload.address = val('ppEdAddr').trim();
      const timeOrig = job.all_day ? '' : start.time;
      if (val('ppEdDate') !== start.date || val('ppEdTime') !== timeOrig || val('ppEdEnd') !== end.date) {
        payload.start_date = val('ppEdDate');
        payload.start_time = val('ppEdTime');
        payload.end_date = val('ppEdEnd');
      }
      if (val('ppEdLock').trim() !== lockbox) payload.lockbox = val('ppEdLock').trim();
      if (val('ppEdNotes') !== instructions) payload.instructions = val('ppEdNotes');
      if (val('ppEdAttn').trim() !== (t.attention || '').trim()) payload.attention = val('ppEdAttn');
      const svc = [
        ...services.filter((sv, i) => sv.remove || sv.quantity !== (t.services[i] || {}).quantity || (sv.notes || '') !== ((t.services[i] || {}).notes || '')).map((sv) => ({ id: sv.id, quantity: sv.quantity, notes: sv.notes, remove: sv.remove })),
        ...added.filter((sv) => sv.quantity > 0).map((sv) => ({ pricing_item_id: sv.pricing_item_id, quantity: sv.quantity, notes: sv.notes })),
      ];
      if (added.some((sv) => !(sv.quantity > 0))) { err.textContent = 'Informe a quantidade dos serviços adicionados.'; err.hidden = false; return; }
      if (svc.length) payload.services = svc;
      if (!Object.keys(payload).length) { render(); return; }
      const btns = pane.querySelectorAll('#ppEdSave, [data-ed-save]');
      btns.forEach((b) => { b.disabled = true; b.textContent = 'Salvando…'; });
      try {
        await api(`/api/partner-portal/jobs/${encodeURIComponent(job.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), co });
        state.jobDetail.delete(job.id);
        await refreshOverview();
        await render();
      } catch (e) {
        err.textContent = e.message || 'Não foi possível salvar.';
        err.hidden = false;
        btns.forEach((b) => { b.disabled = false; b.textContent = 'Salvar alterações'; });
      }
    }
    draw();
  }

  /** Company switcher and builder-only navigation. */
  function paintShell() {
    if (!state.builder) return;
    // The brand is the builder's own account; the selected flooring company is the subtitle.
    $('ppProvider').textContent = state.builder.account.name;
    const nAct = activeCompanies().length;
    $('ppBrandSub').textContent = nAct ? `${nAct} ${nAct === 1 ? 'empresa conectada' : 'empresas conectadas'}` : 'Portal do builder';
    $('ppMark').textContent = initials(state.builder.account.name);
    document.title = `${state.builder.account.name} · Portal do builder`;
    const tools = $('ppProviderTools');
    const companies = state.builder.companies || [];
    tools.hidden = false;
    tools.innerHTML = `<label>${companies.length ? `Empresas · ${companies.length}` : 'Empresas'}</label><a class="pp-menu-item" href="#empresas" style="text-decoration:none">${canDo('companies.manage') ? 'Conectar ou convidar empresa' : 'Ver empresas'}</a><a class="pp-menu-item" href="#equipe" style="text-decoration:none">Equipe</a>`;
    document.querySelectorAll('[data-builder-only]').forEach((el) => { el.hidden = false; });
    document.querySelectorAll('[data-nav="invoices"]').forEach((el) => { el.hidden = !canDo('money.view'); });
    document.querySelectorAll('[data-nav="medicoes"]').forEach((el) => { el.hidden = !canDo('measure'); });
  }

  /* ─────────────────────────── measurements (stairs & vents) ─────────────────────────── */

  const SPECIES = ['White Oak', 'Red Oak', 'Hickory', 'Maple', 'Walnut', 'Ash', 'Brazilian Cherry'];
  const FINISHES = ['Unfinished (acabamento no local)', 'Prefinished', 'Primed'];
  const VENT_SIZES = ['2x10', '2x12', '3x10', '3x12', '4x10', '4x12', '4x14', '6x10', '6x12'];
  const OPEN_OPTS = [['none', 'Fechado'], ['left', 'Esq. aberto'], ['right', 'Dir. aberto'], ['both', 'Ambos abertos']];
  const RET_OPTS = [['45', '45° (mitered)'], ['flat', 'Flat'], ['bullnose', 'Bullnose']];
  const VENT_TYPES = [['flush', 'Flush mount'], ['self_rimming', 'Self-rimming (drop-in)'], ['return_air', 'Return air']];
  const RISER_OPTS = [['same', 'Mesma madeira'], ['primed', 'Primed'], ['paint_grade', 'Paint grade'], ['none', 'Sem riser']];
  const FRAC = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  /** "11 1/4", "11¼", "11-1/4", "11.25" → 11.25 (same rules as the server). */
  function parseIn(raw) {
    let s = String(raw || '').trim().replace(/["”″]|in\b|pol\b/gi, '').replace(/,/g, '.').trim();
    if (!s) return null;
    let extra = 0;
    Object.entries(FRAC).forEach(([ch, v]) => { if (s.includes(ch)) { extra += v; s = s.replace(ch, ' '); } });
    const m = /^(\d+(?:\.\d+)?)?(?:[\s-]+)?(?:(\d+)\/(\d+))?\s*$/.exec(s.trim());
    if (!m || (!m[1] && !m[2] && !extra)) return null;
    const n = (m[1] ? Number(m[1]) : 0) + (m[2] && m[3] && Number(m[3]) ? Number(m[2]) / Number(m[3]) : 0) + extra;
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  }
  function fmtIn(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const v = Number(n);
    const whole = Math.floor(v + 1e-9);
    const rest = Math.round((v - whole) * 1000) / 1000;
    if (!rest) return String(whole);
    const g = Object.entries(FRAC).find(([, f]) => Math.abs(f - rest) < 0.002);
    return g ? `${whole || ''}${g[0]}` : String(Math.round(v * 100) / 100);
  }
  function openText(open, ret) {
    if (open === 'none') return 'fechado';
    const side = { left: 'esq. aberto', right: 'dir. aberto', both: 'dois lados abertos' }[open] || open;
    return `${side} · ${{ '45': '45°', flat: 'flat', bullnose: 'bullnose' }[ret] || ret}`;
  }
  /** Same grouping the PDF uses: equal pieces counted together. */
  function measSummary(data) {
    const out = [];
    (data.stairs || []).forEach((s) => {
      const wood = [s.species, s.finish, s.color].filter(Boolean).join(' · ');
      const label = s.name || 'Escada';
      const tr = new Map();
      const ri = new Map();
      (s.steps || []).forEach((st) => {
        if (st.tread_w || st.tread_d) { const k = `${fmtIn(st.tread_w) || '?'}" × ${fmtIn(st.tread_d) || '?'}" · ${openText(st.open, st.ret)}`; tr.set(k, (tr.get(k) || 0) + 1); }
        if (!st.no_riser && s.riser_material !== 'none' && (st.riser_w || st.riser_h)) { const k = `${fmtIn(st.riser_w) || '?'}" × ${fmtIn(st.riser_h) || '?'}"`; ri.set(k, (ri.get(k) || 0) + 1); }
      });
      tr.forEach((n, k) => out.push({ kind: 'Tread', group: label, text: `${wood ? `${wood} · ` : ''}${k}`, qty: n }));
      const rw = s.riser_material === 'primed' ? 'Primed' : s.riser_material === 'paint_grade' ? 'Paint grade' : wood;
      ri.forEach((n, k) => out.push({ kind: 'Riser', group: label, text: `${rw ? `${rw} · ` : ''}${k}`, qty: n }));
      (s.nosings || []).forEach((ns) => { if (ns.length) out.push({ kind: 'Nosing', group: label, text: `${fmtIn(ns.length)}" · ${{ flush: 'flush', overlap: 'overlap', stair_nose: 'stair nose' }[ns.type] || ns.type}`, qty: ns.qty || 1 }); });
    });
    const vm = new Map();
    (data.vents || []).forEach((v) => {
      const k = `${v.size || '?'} · ${(VENT_TYPES.find((t) => t[0] === v.type) || [0, v.type])[1]}${[v.species, v.finish, v.color].filter(Boolean).length ? ` · ${[v.species, v.finish, v.color].filter(Boolean).join(' · ')}` : ''}`;
      vm.set(k, (vm.get(k) || 0) + (v.qty || 1));
    });
    vm.forEach((n, k) => out.push({ kind: 'Vent', group: 'Vents', text: k, qty: n }));
    return out;
  }
  function measCounts(data) {
    let treads = 0; let risers = 0; let nosings = 0;
    (data.stairs || []).forEach((s) => {
      (s.steps || []).forEach((st) => { if (st.tread_w || st.tread_d) treads += 1; if (!st.no_riser && s.riser_material !== 'none' && (st.riser_w || st.riser_h)) risers += 1; });
      (s.nosings || []).forEach((n) => { if (n.length) nosings += n.qty || 1; });
    });
    const vents = (data.vents || []).reduce((a, v) => a + (v.qty || 1), 0);
    return { stairs: (data.stairs || []).length, treads, risers, nosings, vents };
  }
  function countsText(c) {
    return [c.stairs ? plural(c.stairs, 'escada', 'escadas') : '', c.treads ? `${c.treads} treads` : '', c.risers ? `${c.risers} risers` : '', c.nosings ? plural(c.nosings, 'nosing', 'nosings') : '', c.vents ? plural(c.vents, 'vent', 'vents') : ''].filter(Boolean).join(' · ') || 'Nada medido ainda';
  }
  function measStatusChip(m) {
    if (m.status === 'used') return '<span class="pp-chip pp-chip--dark">Enviada no job</span>';
    if (m.status === 'done') return '<span class="pp-chip pp-chip--ok">Concluída</span>';
    return '<span class="pp-chip pp-chip--late">Em andamento</span>';
  }
  function newStair(n) {
    return { id: uid(), name: n ? `Escada ${n}` : 'Escada principal', species: 'White Oak', finish: FINISHES[0], color: '', riser_material: 'same', steps: [], nosings: [], photos: [], note: '' };
  }
  function newStep(prev) {
    return prev
      ? { ...prev, id: uid(), note: '' }
      : { id: uid(), tread_w: null, tread_d: null, riser_w: null, riser_h: null, open: 'none', ret: '45', no_riser: false, note: '' };
  }
  function newVent(prev) {
    return prev ? { ...prev, id: uid(), room: '', photos: [], note: '' } : { id: uid(), room: '', size: '4x10', type: 'flush', species: 'White Oak', finish: FINISHES[0], color: '', qty: 1, photos: [], note: '' };
  }

  async function renderMeasurements(id, token) {
    if (id) return renderMeasurement(id, token);
    const r = await api('/api/builder/measurements');
    if (token !== renderToken) return;
    const rows = r.data || [];
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>Medições</h1></div><div class="pp-head-actions"><button type="button" class="pp-btn pp-btn--pri" id="ppMeasNewBtn">Nova medição</button></div></div>
      <p class="pp-muted pp-meas-intro">Meça escadas (treads, risers e nosings) e vents na obra. A medição fica salva pelo endereço e vai junto quando você enviar a Work Order dessa casa.</p>
      <form class="pp-card pp-block pp-meas-new" id="ppMeasNew" ${rows.length ? 'hidden' : ''} novalidate>
        <h3>Nova medição</h3>
        <div class="pp-fields">
          <div class="pp-field pp-field--wide"><label for="ppMnAddr">Endereço da obra *</label><input id="ppMnAddr" maxlength="300" autocomplete="street-address" data-om-address-autocomplete required placeholder="Ex.: 322 Lower Ranch View Rd, Granby, CO" /></div>
          <div class="pp-field"><label for="ppMnCom">Comunidade</label><input id="ppMnCom" maxlength="120" /></div>
          <div class="pp-field"><label for="ppMnLot">Lote</label><input id="ppMnLot" maxlength="20" /></div>
        </div>
        <p class="pp-error" id="ppMnErr" role="alert" hidden></p>
        <div><button type="submit" class="pp-btn pp-btn--pri" id="ppMnSave">Começar a medir</button></div>
      </form>
      <div class="pp-card" style="overflow:hidden">
        ${rows.length ? rows.map((m) => `<a class="pp-row pp-meas-row" href="#medicoes/${esc(m.id)}" style="text-decoration:none">
            <span class="pp-row-main">
              <span class="pp-row-top"><strong>${esc(m.address)}</strong>${measStatusChip(m)}</span>
              <span class="pp-row-sub">${esc([m.community, m.lot ? `Lote ${m.lot}` : ''].filter(Boolean).join(' · '))}${m.community || m.lot ? ' · ' : ''}${esc(countsText(m.counts))}</span>
              <span class="pp-row-next">${esc(m.completed_by || m.updated_by || m.created_by || '')} · ${esc(fmtDay(m.completed_at || m.updated_at))}</span>
            </span>
          </a>`).join('') : '<div class="pp-empty"><strong>Nenhuma medição ainda</strong>Comece pelo endereço da casa.</div>'}
      </div>`;
    if (typeof window.sfBootCrmAddressAutocomplete === 'function') window.sfBootCrmAddressAutocomplete();
    $('ppMeasNewBtn').addEventListener('click', () => { const f = $('ppMeasNew'); f.hidden = false; $('ppMnAddr').focus(); });
    $('ppMeasNew').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ppMnErr');
      err.hidden = true;
      const btn = $('ppMnSave');
      btn.disabled = true;
      try {
        const res = await postJson('/api/builder/measurements', { address: $('ppMnAddr').value.trim(), community: $('ppMnCom').value.trim(), lot: $('ppMnLot').value.trim() });
        location.hash = `#medicoes/${res.data.id}`;
      } catch (ex) {
        err.textContent = ex.message || 'Não foi possível criar.';
        err.hidden = false;
        btn.disabled = false;
      }
    });
  }

  let measSaveTimer = null;
  function measSaveSoon() {
    const m = state.meas;
    if (!m) return;
    m.dirty = true;
    paintMeasSaved();
    clearTimeout(measSaveTimer);
    measSaveTimer = setTimeout(measSaveNow, 700);
  }
  async function measSaveNow() {
    const m = state.meas;
    if (!m || !m.dirty || m.status === 'used') return;
    clearTimeout(measSaveTimer);
    m.dirty = false;
    m.saving = true;
    paintMeasSaved();
    try {
      const r = await api(`/api/builder/measurements/${encodeURIComponent(m.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: m.data, notes: m.notes || '', community: m.community || '', lot: m.lot || '' }) });
      m.updated_at = r.data.updated_at;
      m.log = r.data.log;
      m.saveError = '';
    } catch (e) {
      m.dirty = true;
      m.saveError = e.message || 'Não salvou.';
    }
    m.saving = false;
    paintMeasSaved();
  }
  function paintMeasSaved() {
    const el = $('ppMeasSaved');
    const m = state.meas;
    if (!el || !m) return;
    el.textContent = m.saveError ? `Não salvou · ${m.saveError}` : m.saving ? 'Salvando…' : m.dirty ? 'Alterações…' : 'Salvo';
    el.classList.toggle('pp-late', Boolean(m.saveError));
  }
  window.addEventListener('beforeunload', () => { if (state.meas && state.meas.dirty) measSaveNow(); });

  async function renderMeasurement(id, token) {
    if (!state.meas || state.meas.id !== id) {
      if (state.meas && state.meas.dirty) await measSaveNow();
      const r = await api(`/api/builder/measurements/${encodeURIComponent(id)}`);
      if (token !== renderToken) return;
      state.meas = { ...r.data, tab: 'stairs', dirty: false };
    }
    paintMeasurement();
  }

  function sel(opts, value, attrs) {
    return `<select ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }
  function selFree(list, value, attrs, otherLabel) {
    const has = !value || list.includes(value);
    return `<select ${attrs}>${list.map((v) => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}<option value="__other" ${has ? '' : 'selected'}>${esc(otherLabel || 'Outro…')}</option></select>${has ? '' : ''}`;
  }
  function photoStrip(m, list, path) {
    const locked = m.status === 'used';
    return `<div class="pp-meas-photos">${(list || []).map((k, i) => `<span class="pp-meas-ph"><img src="/api/builder/measurements/${encodeURIComponent(m.id)}/photo?key=${encodeURIComponent(k)}" alt="Foto ${i + 1}" loading="lazy" />${locked ? '' : `<button type="button" data-ph-rm="${esc(path)}" data-ph-i="${i}" aria-label="Tirar foto ${i + 1}">×</button>`}</span>`).join('')}${locked ? '' : `<label class="pp-meas-addph"><input type="file" accept="image/*" capture="environment" data-ph-add="${esc(path)}" hidden />${icon('camera')}<span>Foto</span></label>`}</div>`;
  }
  function inch(path, value, label, locked) {
    return `<input class="pp-in" inputmode="decimal" data-in="${esc(path)}" value="${esc(fmtIn(value))}" placeholder="—" aria-label="${esc(label)}" ${locked ? 'disabled' : ''} />`;
  }

  /* ─────────────────────────── measurement visuals (SVG drawn from the numbers) ─────────────────────────── */

  const WOOD = {
    'white oak': '#D6B488', 'red oak': '#C8936E', hickory: '#CDA06C', maple: '#E9D3AA', walnut: '#6E4B34',
    ash: '#DEC79F', 'brazilian cherry': '#8E3B22',
  };
  const STAINS = {
    natural: null, jacobean: '#43301F', 'special walnut': '#5C3D27', provincial: '#6B4B32', ebony: '#2B1E17',
    'golden oak': '#B47E40', 'early american': '#6F4B2F', 'classic gray': '#8D867B', 'weathered oak': '#AA9C86',
    driftwood: '#9E907B', 'red mahogany': '#5C2B1F', 'dark walnut': '#402B1E', coffee: '#3C2B21', 'english chestnut': '#6A3C25',
    'fisherman': '#8F8577', 'pier': '#8F8577', gray: '#8D867B', white: '#EDE8E0',
  };
  let vizSeq = 0;

  function hexMix(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  /** Colour of the piece: species, then the stain name if it is one we know. */
  function woodTone(species, color, paint) {
    if (paint) return { base: '#F3F1EC', paint: true };
    let base = WOOD[String(species || '').trim().toLowerCase()] || '#D6B488';
    const c = String(color || '').toLowerCase();
    const stain = Object.keys(STAINS).find((k) => k && c.includes(k));
    if (stain && STAINS[stain]) base = hexMix(base, STAINS[stain], 0.78);
    return { base, paint: false };
  }
  /** Grain pattern + light sheen (prefinished looks a bit glossier). */
  function woodDefs(id, tone, glossy, vertical) {
    if (tone.paint) return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${tone.base}"/></pattern>`;
    const dark = hexMix(tone.base, '#2A1C12', 0.22);
    const light = hexMix(tone.base, '#FFFFFF', 0.18);
    const rot = vertical ? ' patternTransform="rotate(90)"' : '';
    return `<pattern id="${id}" width="24" height="3.2" patternUnits="userSpaceOnUse"${rot}>
        <rect width="24" height="3.2" fill="${tone.base}"/>
        <path d="M0 .7 C6 .2 10 1.3 16 .8 S22 .4 24 .9" stroke="${dark}" stroke-width=".16" fill="none" opacity=".55"/>
        <path d="M0 2.2 C5 2.7 9 1.8 15 2.4 S21 2.9 24 2.3" stroke="${light}" stroke-width=".22" fill="none" opacity=".7"/>
        <path d="M3 1.5 C8 1.3 12 1.9 20 1.5" stroke="${dark}" stroke-width=".08" fill="none" opacity=".4"/>
      </pattern>${glossy ? `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>` : ''}`;
  }
  function isGlossy(finish) {
    return /prefinish/i.test(String(finish || ''));
  }
  /** Dimension line with ticks and a label in the middle. */
  function dimLine(x1, y1, x2, y2, label, side) {
    const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
    const tk = 0.9;
    const ticks = horizontal
      ? `<path d="M${x1} ${y1 - tk}V${y1 + tk}M${x2} ${y2 - tk}V${y2 + tk}"/>`
      : `<path d="M${x1 - tk} ${y1}H${x1 + tk}M${x2 - tk} ${y2}H${x2 + tk}"/>`;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const text = horizontal
      ? `<text x="${mx}" y="${my - 1.1}" text-anchor="middle">${esc(label)}</text>`
      : `<text x="${mx + (side === 'left' ? -1.2 : 1.2)}" y="${my}" text-anchor="${side === 'left' ? 'end' : 'start'}" dominant-baseline="middle">${esc(label)}</text>`;
    return `<g class="pp-viz-dim"><path d="M${x1} ${y1}L${x2} ${y2}"/>${ticks}${text}</g>`;
  }

  /** Top view of one tread: nose at the front, open ends with their return, walls hatched. */
  function treadSvg(stair, st, idx, interactive) {
    const W = Number(st.tread_w) || 36;
    const D = Number(st.tread_d) || 11.25;
    const id = `pv${(vizSeq += 1)}`;
    const tone = woodTone(stair.species, stair.color, false);
    const leftOpen = st.open === 'left' || st.open === 'both';
    const rightOpen = st.open === 'right' || st.open === 'both';
    const nose = Math.min(1.25, D / 6);
    const R = 1.7;
    const capFill = hexMix(tone.base, '#2A1C12', 0.3);
    const end = (x, dir, open) => {
      if (!open) return `<rect x="${dir < 0 ? x - 2.2 : x}" y="-1" width="2.2" height="${D + 1}" fill="url(#${id}h)" stroke="#98A2B3" stroke-width=".12"/>`;
      const x2 = x + dir * R;
      const xa = Math.min(x, x2);
      if (st.ret === 'bullnose') return `<path d="M${x} 0 H${x2} Q${x2 + dir * 1.1} ${D / 2} ${x2} ${D} H${x} Z" fill="${capFill}" stroke="#3E2C1E" stroke-width=".14"/>`;
      const strip = `<rect x="${xa}" y="0" width="${R}" height="${D}" fill="${capFill}" stroke="#3E2C1E" stroke-width=".14"/>`;
      const joint = st.ret === 'flat'
        ? `<path d="M${xa} ${D - nose}H${xa + R}" stroke="#3E2C1E" stroke-width=".14"/>`
        : `<path d="M${x} ${D - nose}L${x2} ${D}" stroke="#3E2C1E" stroke-width=".14"/>`;
      return strip + joint;
    };
    const click = (side, x) => (interactive ? `<rect class="pp-viz-hit" data-viz-side="${side}" x="${x}" y="-2" width="7" height="${D + 4}" rx="1"><title>Tocar para abrir/fechar o lado ${side === 'left' ? 'esquerdo' : 'direito'}</title></rect>` : '');
    const pad = 9;
    return `<svg class="pp-viz-svg" viewBox="${-pad} -9 ${W + pad * 2} ${D + 17}" role="img" aria-label="Tread ${idx + 1}: ${fmtIn(W)} por ${fmtIn(D)} polegadas, ${openText(st.open, st.ret)}">
      <defs>${woodDefs(`${id}w`, tone, isGlossy(stair.finish))}
        <pattern id="${id}h" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="1.2" fill="#F2F4F7"/><path d="M0 0V1.2" stroke="#C0C6CF" stroke-width=".3"/></pattern></defs>
      ${end(0, -1, leftOpen)}${end(W, 1, rightOpen)}
      <rect x="0" y="0" width="${W}" height="${D}" fill="url(#${id}w)" stroke="#5B4632" stroke-width=".14"/>
      ${isGlossy(stair.finish) ? `<rect x="0" y="0" width="${W}" height="${D}" fill="url(#${id}wg)"/>` : ''}
      <rect x="0" y="${D - nose}" width="${W}" height="${nose}" fill="#000" opacity=".07"/>
      <path d="M0 ${D}H${W}" stroke="#3E2C1E" stroke-width=".22"/>
      ${dimLine(0, -4.2, W, -4.2, `${fmtIn(W)}"`)}
      ${dimLine(W + (rightOpen ? 3.2 : 4.4), 0, W + (rightOpen ? 3.2 : 4.4), D, `${fmtIn(D)}"`)}
      <text class="pp-viz-note" x="${W / 2}" y="${D + 3.6}" text-anchor="middle">frente · nose</text>
      <text class="pp-viz-note ${leftOpen ? 'is-open' : ''}" x="-1" y="${D + 3.6}" text-anchor="middle">${leftOpen ? `aberto · ${{ '45': '45°', flat: 'flat', bullnose: 'bullnose' }[st.ret] || ''}` : 'parede'}</text>
      <text class="pp-viz-note ${rightOpen ? 'is-open' : ''}" x="${W + 1}" y="${D + 3.6}" text-anchor="middle">${rightOpen ? `aberto · ${{ '45': '45°', flat: 'flat', bullnose: 'bullnose' }[st.ret] || ''}` : 'parede'}</text>
      ${click('left', -6)}${click('right', W - 1)}
    </svg>`;
  }

  /** Front view of the riser under that tread. */
  function riserSvg(stair, st, idx) {
    if (stair.riser_material === 'none' || st.no_riser) return '<p class="pp-muted pp-viz-empty">Sem riser neste degrau.</p>';
    const W = Number(st.riser_w) || Number(st.tread_w) || 36;
    const H = Number(st.riser_h) || 7.5;
    const id = `pv${(vizSeq += 1)}`;
    const paint = stair.riser_material === 'primed' || stair.riser_material === 'paint_grade';
    const tone = woodTone(stair.species, stair.color, paint);
    const pad = 9;
    return `<svg class="pp-viz-svg" viewBox="${-pad} -7 ${W + pad * 2} ${H + 12}" role="img" aria-label="Riser ${idx + 1}: ${fmtIn(W)} por ${fmtIn(H)} polegadas">
      <defs>${woodDefs(id, tone, !paint && isGlossy(stair.finish))}</defs>
      <rect x="-1.2" y="-1.6" width="${W + 2.4}" height="1.6" rx=".6" fill="#000" opacity=".12"/>
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id})" stroke="#5B4632" stroke-width=".14"/>
      ${!paint && isGlossy(stair.finish) ? `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id}g)"/>` : ''}
      ${dimLine(0, -3.6, W, -3.6, `${fmtIn(W)}"`)}
      ${dimLine(W + 3.4, 0, W + 3.4, H, `${fmtIn(H)}"`)}
      <text class="pp-viz-note" x="${W / 2}" y="${H + 3}" text-anchor="middle">${paint ? (stair.riser_material === 'primed' ? 'primed' : 'paint grade') : 'riser'}</text>
    </svg>`;
  }

  /** The whole stair in 3D (isometric), built from each step's own numbers. */
  function stairSvg(stair, sel, mirror) {
    const steps = (stair.steps || []).filter((st) => st.tread_w || st.tread_d || st.riser_h);
    if (!steps.length) return '<p class="pp-muted pp-viz-empty">A escada aparece aqui conforme você mede os degraus.</p>';
    const id = `pv${(vizSeq += 1)}`;
    const tone = woodTone(stair.species, stair.color, false);
    const paint = stair.riser_material === 'primed' || stair.riser_material === 'paint_grade';
    const rTone = woodTone(stair.species, stair.color, paint);
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    const P = (x, y, z) => { const xx = mirror ? -x : x; return [(xx + y) * cos, (xx - y) * sin - z]; };
    const pts = (arr) => arr.map((p) => P(...p).map((v) => v.toFixed(2)).join(',')).join(' ');
    const shapes = [];
    const all = [];
    let z = 0;
    let y = 0;
    const geo = steps.map((st) => {
      const W = Number(st.tread_w) || 36;
      const D = Number(st.tread_d) || 11.25;
      const H = Number(st.riser_h) || 7.5;
      const g = { st, W, D, H, y0: y, z0: z };
      y += D - 1.25;
      z += H;
      return g;
    });
    const nose = 1.25;
    const T = 1;
    // Back to front so nearer steps cover farther ones.
    for (let k = geo.length - 1; k >= 0; k -= 1) {
      const g = geo[k];
      const { st, W, D, H, y0, z0 } = g;
      const top = z0 + H;
      const yf = y0 - nose;
      const isSel = stair.steps.indexOf(st) === sel;
      const leftOpen = st.open === 'left' || st.open === 'both';
      const rightOpen = st.open === 'right' || st.open === 'both';
      const sideOpen = mirror ? leftOpen : rightOpen;
      const sideX = mirror ? 0 : W;
      // riser (front face)
      const riser = [[0, y0, z0], [W, y0, z0], [W, y0, top - T], [0, y0, top - T]];
      if (!(stair.riser_material === 'none' || st.no_riser)) shapes.push(`<polygon points="${pts(riser)}" fill="url(#${id}r)" stroke="#5B4632" stroke-width=".25"/>`);
      // visible end: open = return caps in wood, closed = skirt/wall
      const side = [[sideX, y0, z0], [sideX, y0 + D, z0], [sideX, y0 + D, top], [sideX, yf, top], [sideX, yf, top - T], [sideX, y0, top - T]];
      shapes.push(sideOpen
        ? `<polygon points="${pts(side)}" fill="${hexMix(tone.base, '#2A1C12', 0.28)}" stroke="#4A3726" stroke-width=".25"/>`
        : `<polygon points="${pts(side)}" fill="#E4E7EC" stroke="#C0C6CF" stroke-width=".25"/>`);
      // tread nose front edge
      const front = [[0, yf, top - T], [W, yf, top - T], [W, yf, top], [0, yf, top]];
      shapes.push(`<polygon points="${pts(front)}" fill="${hexMix(tone.base, '#2A1C12', 0.18)}" stroke="#4A3726" stroke-width=".25"/>`);
      // tread top
      const tread = [[0, yf, top], [W, yf, top], [W, y0 + D, top], [0, y0 + D, top]];
      shapes.push(`<polygon points="${pts(tread)}" fill="url(#${id}t)" stroke="${isSel ? '#E7792C' : '#4A3726'}" stroke-width="${isSel ? '.9' : '.25'}" data-viz-step="${stair.steps.indexOf(st)}" class="pp-viz-tread"><title>Degrau ${stair.steps.indexOf(st) + 1}: ${fmtIn(W)}" × ${fmtIn(D)}" · ${openText(st.open, st.ret)}</title></polygon>`);
      if (isGlossy(stair.finish)) shapes.push(`<polygon points="${pts(tread)}" fill="url(#${id}tg)" pointer-events="none"/>`);
      if (sideOpen && st.ret !== 'bullnose') {
        const a = P(sideX, yf, top);
        const b = P(sideX, yf + (st.ret === 'flat' ? 0 : nose), top - (st.ret === 'flat' ? T : 0));
        shapes.push(`<path d="M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}" stroke="#2A1C12" stroke-width=".35"/>`);
      }
      [riser, side, front, tread].forEach((poly) => poly.forEach((p) => all.push(P(...p))));
      if (isSel) {
        const c = P(W / 2, y0 + D / 2, top);
        shapes.push(`<g class="pp-viz-pin"><circle cx="${c[0].toFixed(2)}" cy="${c[1].toFixed(2)}" r="3.4"/><text x="${c[0].toFixed(2)}" y="${c[1].toFixed(2)}" text-anchor="middle" dominant-baseline="central">${stair.steps.indexOf(st) + 1}</text></g>`);
      }
    }
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const pad = 6;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    return `<svg class="pp-viz-svg pp-viz-stair" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="Escada montada com ${steps.length} degraus">
      <defs>${woodDefs(`${id}t`, tone, isGlossy(stair.finish))}${woodDefs(`${id}r`, rTone, !paint && isGlossy(stair.finish), true)}</defs>
      ${shapes.join('')}
    </svg>`;
  }

  /** Front view of a floor vent: frame (flush or self-rimming lip) and louvers. */
  function ventSvg(v) {
    const m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i.exec(String(v.size || '').trim());
    const A = m ? Number(m[1]) : 4;
    const B = m ? Number(m[2]) : 10;
    const w = Math.max(A, B);
    const h = Math.min(A, B);
    const id = `pv${(vizSeq += 1)}`;
    const tone = woodTone(v.species, v.color, false);
    const lip = v.type === 'self_rimming' ? 0.9 : 0.55;
    const slots = Math.max(3, Math.round(w / 1.1));
    const louvers = Array.from({ length: slots }, (_, i) => {
      const x = lip + 0.35 + (i * (w - 2 * lip - 0.7)) / slots;
      return `<rect x="${x.toFixed(2)}" y="${lip + 0.35}" width="${((w - 2 * lip - 0.7) / slots - 0.25).toFixed(2)}" height="${(h - 2 * lip - 0.7).toFixed(2)}" rx=".12" fill="#2A1C12" opacity=".78"/>`;
    }).join('');
    const pad = 4.5;
    return `<svg class="pp-viz-svg" viewBox="${-pad} -4.5 ${w + pad * 2} ${h + 8}" role="img" aria-label="Vent ${esc(v.size || '')}">
      <defs>${woodDefs(id, tone, isGlossy(v.finish))}</defs>
      ${v.type === 'self_rimming' ? `<rect x="-.35" y="-.2" width="${w + 0.7}" height="${h + 0.7}" rx=".5" fill="#000" opacity=".16"/>` : ''}
      <rect x="0" y="0" width="${w}" height="${h}" rx="${v.type === 'self_rimming' ? 0.45 : 0.12}" fill="url(#${id})" stroke="#4A3726" stroke-width=".1"/>
      ${louvers}
      ${dimLine(0, -2.2, w, -2.2, `${fmtIn(w)}"`)}
      ${dimLine(w + 1.8, 0, w + 1.8, h, `${fmtIn(h)}"`)}
      <text class="pp-viz-note" x="${w / 2}" y="${h + 2.6}" text-anchor="middle">${v.type === 'self_rimming' ? 'self-rimming (com aba)' : v.type === 'return_air' ? 'return air' : 'flush mount'}</text>
    </svg>`;
  }

  function stairVizHtml(m, s, si) {
    const sel = Math.min(Math.max(0, (m.vizSel && m.vizSel[si]) || 0), Math.max(0, (s.steps || []).length - 1));
    const st = (s.steps || [])[sel];
    const mirror = Boolean(m.vizMirror && m.vizMirror[si]);
    const locked = m.status === 'used';
    return `<div class="pp-viz" data-viz-stair="${si}">
      <div class="pp-viz-3d">
        <div class="pp-viz-bar"><span class="pp-step-lbl pp-viz-lbl">Escada montada</span><button type="button" class="pp-link" data-viz-mirror="${si}">${mirror ? 'Ver do lado direito' : 'Ver do lado esquerdo'}</button></div>
        <div class="pp-viz-box" data-viz-box="3d">${stairSvg(s, sel, mirror)}</div>
        <p class="pp-viz-hint">Toque num degrau para ver e mudar a medida dele.</p>
      </div>
      <div class="pp-viz-step">
        ${st ? `<div class="pp-viz-bar"><span class="pp-step-lbl pp-viz-lbl">Degrau ${sel + 1} de ${s.steps.length}</span><span class="pp-viz-nav"><button type="button" class="pp-q-ic" data-viz-prev="${si}" aria-label="Degrau anterior" ${sel === 0 ? 'disabled' : ''}>‹</button><button type="button" class="pp-q-ic" data-viz-next="${si}" aria-label="Próximo degrau" ${sel >= s.steps.length - 1 ? 'disabled' : ''}>›</button></span></div>
        <div class="pp-viz-box" data-viz-box="tread"><span class="pp-viz-cap">Tread · vista de cima</span>${treadSvg(s, st, sel, !locked)}</div>
        ${locked ? '' : `<div class="pp-viz-chips" role="group" aria-label="Retorno">${RET_OPTS.map(([v, l]) => `<button type="button" data-viz-ret="${v}" aria-pressed="${st.ret === v}" ${st.open === 'none' ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>`}
        <div class="pp-viz-box" data-viz-box="riser"><span class="pp-viz-cap">Riser · vista de frente</span>${riserSvg(s, st, sel)}</div>` : '<p class="pp-muted pp-viz-empty">Adicione um degrau.</p>'}
      </div>
    </div>`;
  }

  function stairHtml(m, s, si) {
    const locked = m.status === 'used';
    const p = `stairs.${si}`;
    const selStep = (m.vizSel && m.vizSel[si]) || 0;
    const steps = (s.steps || []).map((st, i) => `<div class="pp-step ${st.open !== 'none' ? 'is-open' : ''} ${i === selStep ? 'is-sel' : ''}" role="listitem" data-step-row="${si}:${i}">
        <span class="pp-step-n">${i + 1}</span>
        <div class="pp-step-dim"><span class="pp-step-lbl">Tread</span>${inch(`${p}.steps.${i}.tread_w`, st.tread_w, `Tread ${i + 1} largura`, locked)}<em>×</em>${inch(`${p}.steps.${i}.tread_d`, st.tread_d, `Tread ${i + 1} profundidade`, locked)}</div>
        <div class="pp-step-dim ${s.riser_material === 'none' || st.no_riser ? 'is-off' : ''}"><span class="pp-step-lbl">Riser</span>${inch(`${p}.steps.${i}.riser_w`, st.riser_w, `Riser ${i + 1} largura`, locked || s.riser_material === 'none' || st.no_riser)}<em>×</em>${inch(`${p}.steps.${i}.riser_h`, st.riser_h, `Riser ${i + 1} altura`, locked || s.riser_material === 'none' || st.no_riser)}</div>
        <div class="pp-step-side"><span class="pp-step-lbl">Lado</span>${sel(OPEN_OPTS, st.open, `data-set="${p}.steps.${i}.open" aria-label="Lado aberto do degrau ${i + 1}" ${locked ? 'disabled' : ''}`)}</div>
        <div class="pp-step-ret"><span class="pp-step-lbl">Retorno</span>${sel(RET_OPTS, st.ret, `data-set="${p}.steps.${i}.ret" aria-label="Retorno do degrau ${i + 1}" ${locked || st.open === 'none' ? 'disabled' : ''}`)}</div>
        ${locked ? '' : `<div class="pp-step-act"><button type="button" class="pp-q-ic" data-step-down="${si}:${i}" title="Copiar para os degraus de baixo" aria-label="Copiar o degrau ${i + 1} para os de baixo">⇣</button><button type="button" class="pp-q-ic pp-q-ic--del" data-step-rm="${si}:${i}" aria-label="Tirar degrau ${i + 1}">×</button></div>`}
      </div>`).join('');
    const nos = (s.nosings || []).map((n, i) => `<div class="pp-nos">
        <label><span class="pp-step-lbl">Comprimento</span>${inch(`${p}.nosings.${i}.length`, n.length, `Nosing ${i + 1} comprimento`, locked)}</label>
        <label><span class="pp-step-lbl">Qtd</span><input type="number" min="1" max="500" data-num="${p}.nosings.${i}.qty" value="${esc(n.qty || 1)}" ${locked ? 'disabled' : ''} /></label>
        <label><span class="pp-step-lbl">Tipo</span>${sel([['flush', 'Flush'], ['overlap', 'Overlap'], ['stair_nose', 'Stair nose']], n.type, `data-set="${p}.nosings.${i}.type" ${locked ? 'disabled' : ''}`)}</label>
        <label class="pp-nos-note"><span class="pp-step-lbl">Onde</span><input data-txt="${p}.nosings.${i}.note" value="${esc(n.note)}" maxlength="200" placeholder="Ex.: topo da escada, landing" ${locked ? 'disabled' : ''} /></label>
        ${locked ? '' : `<button type="button" class="pp-q-ic pp-q-ic--del" data-nos-rm="${si}:${i}" aria-label="Tirar nosing ${i + 1}">×</button>`}
      </div>`).join('');
    return `<section class="pp-card pp-stair" aria-label="${esc(s.name || 'Escada')}">
      <div class="pp-stair-head">
        <input class="pp-stair-name" data-txt="${p}.name" value="${esc(s.name)}" maxlength="80" aria-label="Nome da escada" ${locked ? 'disabled' : ''} />
        <span class="pp-muted">${(s.steps || []).length} degraus</span>
        ${locked ? '' : `<button type="button" class="pp-q-ic pp-q-ic--del" data-stair-rm="${si}" aria-label="Tirar ${esc(s.name || 'escada')}">×</button>`}
      </div>
      <div class="pp-stair-spec">
        <label><span>Madeira</span>${selFree(SPECIES, s.species, `data-free="${p}.species" ${locked ? 'disabled' : ''}`)}${SPECIES.includes(s.species) || !s.species ? '' : `<input data-txt="${p}.species" value="${esc(s.species)}" maxlength="60" ${locked ? 'disabled' : ''} />`}</label>
        <label><span>Acabamento</span>${selFree(FINISHES, s.finish, `data-free="${p}.finish" ${locked ? 'disabled' : ''}`)}${FINISHES.includes(s.finish) || !s.finish ? '' : `<input data-txt="${p}.finish" value="${esc(s.finish)}" maxlength="60" ${locked ? 'disabled' : ''} />`}</label>
        <label><span>Cor / stain</span><input data-txt="${p}.color" value="${esc(s.color)}" maxlength="80" placeholder="Ex.: Natural, Jacobean" ${locked ? 'disabled' : ''} /></label>
        <label><span>Risers</span>${sel(RISER_OPTS, s.riser_material, `data-set="${p}.riser_material" ${locked ? 'disabled' : ''}`)}</label>
      </div>
      ${stairVizHtml(m, s, si)}
      <div class="pp-stair-cols" aria-hidden="true"><span>#</span><span>Tread (larg. × prof.)</span><span>Riser (larg. × alt.)</span><span>Lado aberto</span><span>Retorno</span><span></span></div>
      <div class="pp-stair-steps" role="list">${steps || '<p class="pp-q-empty">Adicione o primeiro degrau. Medidas em polegadas: 48, 11 1/4, 11¼ ou 11.25.</p>'}</div>
      ${locked ? '' : `<div class="pp-stair-add">
        <button type="button" class="pp-q-add" data-step-add="${si}">+ Degrau${(s.steps || []).length ? ' (igual ao último)' : ''}</button>
        ${(s.steps || []).length ? `<span class="pp-stair-many"><label for="ppMany-${si}">Mais</label><input id="ppMany-${si}" type="number" min="1" max="40" value="5" /><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-step-many="${si}">degraus iguais</button></span>` : ''}
      </div>`}
      <div class="pp-stair-sub"><h4>Nosings</h4>${nos || '<p class="pp-muted" style="margin:0;font-size:13px">Nenhum nosing (landing / topo).</p>'}${locked ? '' : `<button type="button" class="pp-link" data-nos-add="${si}">+ Nosing</button>`}</div>
      <div class="pp-stair-sub"><h4>Fotos</h4>${photoStrip(m, s.photos, `${p}.photos`)}</div>
      <div class="pp-stair-sub"><h4>Observações</h4><textarea data-txt="${p}.note" maxlength="500" placeholder="Ex.: parede torta no lado direito, skirt board existente" ${locked ? 'disabled' : ''}>${esc(s.note)}</textarea></div>
    </section>`;
  }

  function ventsHtml(m) {
    const locked = m.status === 'used';
    const rows = (m.data.vents || []).map((v, i) => {
      const p = `vents.${i}`;
      const knownSize = VENT_SIZES.includes(v.size);
      return `<section class="pp-card pp-vent" aria-label="Vent ${i + 1}">
        <div class="pp-vent-viz">${ventSvg(v)}</div>
        <div class="pp-vent-grid">
          <label><span>Ambiente</span><input data-txt="${p}.room" value="${esc(v.room)}" maxlength="80" placeholder="Ex.: Master bedroom" ${locked ? 'disabled' : ''} /></label>
          <label><span>Tamanho</span><select data-vsize="${p}" ${locked ? 'disabled' : ''}>${VENT_SIZES.map((sz) => `<option ${sz === v.size ? 'selected' : ''}>${sz}</option>`).join('')}<option value="__other" ${knownSize ? '' : 'selected'}>Outro…</option></select>${knownSize ? '' : `<input data-txt="${p}.size" value="${esc(v.size)}" maxlength="20" placeholder="Ex.: 4x16" ${locked ? 'disabled' : ''} />`}</label>
          <label><span>Tipo</span>${sel(VENT_TYPES, v.type, `data-set="${p}.type" ${locked ? 'disabled' : ''}`)}</label>
          <label><span>Qtd</span><input type="number" min="1" max="500" data-num="${p}.qty" value="${esc(v.qty || 1)}" ${locked ? 'disabled' : ''} /></label>
          <label><span>Madeira</span>${selFree(SPECIES, v.species, `data-free="${p}.species" ${locked ? 'disabled' : ''}`)}${SPECIES.includes(v.species) || !v.species ? '' : `<input data-txt="${p}.species" value="${esc(v.species)}" maxlength="60" ${locked ? 'disabled' : ''} />`}</label>
          <label><span>Acabamento</span>${selFree(FINISHES, v.finish, `data-free="${p}.finish" ${locked ? 'disabled' : ''}`)}${FINISHES.includes(v.finish) || !v.finish ? '' : `<input data-txt="${p}.finish" value="${esc(v.finish)}" maxlength="60" ${locked ? 'disabled' : ''} />`}</label>
          <label><span>Cor / stain</span><input data-txt="${p}.color" value="${esc(v.color)}" maxlength="80" ${locked ? 'disabled' : ''} /></label>
          <label class="pp-vent-note"><span>Observação</span><input data-txt="${p}.note" value="${esc(v.note)}" maxlength="300" ${locked ? 'disabled' : ''} /></label>
        </div>
        <div class="pp-vent-foot">${photoStrip(m, v.photos, `${p}.photos`)}${locked ? '' : `<button type="button" class="pp-q-ic pp-q-ic--del" data-vent-rm="${i}" aria-label="Tirar vent ${i + 1}">×</button>`}</div>
      </section>`;
    }).join('');
    return `${rows || '<div class="pp-card pp-empty"><strong>Nenhum vent medido</strong>Adicione cada vent com tamanho, tipo e acabamento.</div>'}${locked ? '' : '<button type="button" class="pp-q-add pp-q-add--block" id="ppVentAdd">+ Vent (igual ao último)</button>'}`;
  }

  function measSummaryHtml(m) {
    const lines = measSummary(m.data);
    return `<h3>Resumo</h3>${lines.length ? `<ul class="pp-meas-sum">${lines.map((l) => `<li><span><b>${esc(l.kind)}</b> ${esc(l.text)}<small>${esc(l.group)}</small></span><em>${l.qty} EA</em></li>`).join('')}</ul>` : '<p class="pp-muted" style="margin:0">As peças aparecem aqui agrupadas por medida, como na Work Order.</p>'}`;
  }

  function paintMeasurement() {
    const m = state.meas;
    const locked = m.status === 'used';
    const c = measCounts(m.data);
    const log = (m.log || []).slice(-6).reverse();
    view.innerHTML = `
      <div class="pp-head">
        <div><a class="pp-back" href="#medicoes" style="display:inline-flex">${icon('back')}Medições</a><h1 class="pp-meas-title">${esc(m.address)}</h1>
          <p class="pp-muted" style="margin:4px 0 0">${measStatusChip(m)} <span id="ppMeasSaved" class="pp-meas-saved">Salvo</span></p></div>
        <div class="pp-head-actions">
          <a class="pp-btn pp-btn--sec" href="/api/builder/measurements/${encodeURIComponent(m.id)}/pdf" target="_blank" rel="noopener">PDF</a>
          ${locked ? '' : m.status === 'done' ? '<button type="button" class="pp-btn pp-btn--sec" id="ppMeasReopen">Reabrir</button>' : '<button type="button" class="pp-btn pp-btn--pri" id="ppMeasDone">Concluir medição</button>'}
        </div>
      </div>
      ${locked ? `<div class="pp-match"><strong>Esta medição já foi enviada com a Work Order</strong><span class="pp-muted" style="font-size:14px">${m.work_order_id ? `<a class="pp-link" href="#jobs/${encodeURIComponent(m.work_order_id)}">Abrir o job</a> · ` : ''}Para medir de novo, crie uma nova medição para este endereço.</span></div>` : ''}
      <div class="pp-meas-layout">
        <div class="pp-meas-main">
          <div class="pp-card pp-meas-info">
            <label><span>Comunidade</span><input data-head="community" value="${esc(m.community || '')}" maxlength="120" ${locked ? 'disabled' : ''} /></label>
            <label><span>Lote</span><input data-head="lot" value="${esc(m.lot || '')}" maxlength="20" ${locked ? 'disabled' : ''} /></label>
            <label class="pp-meas-info-wide"><span>Observações gerais</span><input data-head="notes" value="${esc(m.notes || '')}" maxlength="2000" placeholder="Ex.: acesso pela garagem, piso de concreto" ${locked ? 'disabled' : ''} /></label>
          </div>
          <div class="pp-seg pp-meas-tabs" role="tablist">
            <button type="button" role="tab" data-mtab="stairs" aria-selected="${m.tab === 'stairs'}" aria-pressed="${m.tab === 'stairs'}">Escadas · ${c.treads} treads</button>
            <button type="button" role="tab" data-mtab="vents" aria-selected="${m.tab === 'vents'}" aria-pressed="${m.tab === 'vents'}">Vents · ${c.vents}</button>
          </div>
          ${m.tab === 'stairs'
            ? `${(m.data.stairs || []).map((s, i) => stairHtml(m, s, i)).join('') || '<div class="pp-card pp-empty"><strong>Nenhuma escada ainda</strong>Adicione a escada e meça degrau por degrau.</div>'}${locked ? '' : '<button type="button" class="pp-q-add pp-q-add--block" id="ppStairAdd">+ Escada</button>'}`
            : ventsHtml(m)}
        </div>
        <aside class="pp-meas-side">
          <div class="pp-card pp-block" id="ppMeasSum">${measSummaryHtml(m)}</div>
          <div class="pp-card pp-block">
            <h3>Quem mediu</h3>
            <ul class="pp-meas-log">${log.map((l) => `<li><b>${esc(l.name || '')}</b> ${esc(l.action || '')}<small>${esc(fmtDay(l.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</small></li>`).join('') || '<li class="pp-muted">—</li>'}</ul>
          </div>
          ${locked ? '' : '<button type="button" class="pp-link pp-late" id="ppMeasDel" style="justify-self:start">Apagar medição</button>'}
        </aside>
      </div>`;
    paintMeasSaved();
    bindMeasurement();
  }

  function measAt(path) {
    const parts = path.split('.');
    let obj = state.meas.data;
    for (let i = 0; i < parts.length - 1; i += 1) obj = obj[parts[i]];
    return { obj, key: parts[parts.length - 1] };
  }
  function measRefreshSide() {
    const box = $('ppMeasSum');
    if (box) box.innerHTML = measSummaryHtml(state.meas);
  }

  /** Redraws only the drawings of one stair (keeps focus in the inputs). */
  function repaintViz(si) {
    const m = state.meas;
    const box = view.querySelector(`[data-viz-stair="${si}"]`);
    const s = m && m.data.stairs[si];
    if (!box || !s) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = stairVizHtml(m, s, si);
    box.innerHTML = tmp.firstElementChild.innerHTML;
    const sel = (m.vizSel && m.vizSel[si]) || 0;
    view.querySelectorAll(`[data-step-row^="${si}:"]`).forEach((row) => row.classList.toggle('is-sel', row.getAttribute('data-step-row') === `${si}:${sel}`));
  }
  function repaintVent(i) {
    const m = state.meas;
    const card = view.querySelectorAll('.pp-vent')[i];
    const box = card && card.querySelector('.pp-vent-viz');
    if (box && m.data.vents[i]) box.innerHTML = ventSvg(m.data.vents[i]);
  }

  function bindMeasurement() {
    const m = state.meas;
    const redraw = () => { const y = window.scrollY; paintMeasurement(); window.scrollTo(0, y); };
    m.vizSel = m.vizSel || {};
    m.vizMirror = m.vizMirror || {};
    view.querySelectorAll('[data-step-row]').forEach((row) => row.addEventListener('focusin', () => {
      const [si, i] = row.getAttribute('data-step-row').split(':').map(Number);
      if (m.vizSel[si] === i) return;
      m.vizSel[si] = i;
      repaintViz(si);
    }));
    view.querySelectorAll('[data-viz-stair]').forEach((box) => box.addEventListener('click', (e) => {
      const si = Number(box.getAttribute('data-viz-stair'));
      const s = m.data.stairs[si];
      const sel = m.vizSel[si] || 0;
      const st = s.steps[sel];
      const t = e.target.closest('[data-viz-step],[data-viz-side],[data-viz-ret],[data-viz-prev],[data-viz-next],[data-viz-mirror]');
      if (!t) return;
      if (t.hasAttribute('data-viz-step')) { m.vizSel[si] = Number(t.getAttribute('data-viz-step')); repaintViz(si); return; }
      if (t.hasAttribute('data-viz-prev')) { m.vizSel[si] = Math.max(0, sel - 1); repaintViz(si); return; }
      if (t.hasAttribute('data-viz-next')) { m.vizSel[si] = Math.min(s.steps.length - 1, sel + 1); repaintViz(si); return; }
      if (t.hasAttribute('data-viz-mirror')) { m.vizMirror[si] = !m.vizMirror[si]; repaintViz(si); return; }
      if (!st || m.status === 'used') return;
      if (t.hasAttribute('data-viz-side')) {
        const side = t.getAttribute('data-viz-side');
        const L = st.open === 'left' || st.open === 'both';
        const Rr = st.open === 'right' || st.open === 'both';
        const nl = side === 'left' ? !L : L;
        const nr = side === 'right' ? !Rr : Rr;
        st.open = nl && nr ? 'both' : nl ? 'left' : nr ? 'right' : 'none';
      } else if (t.hasAttribute('data-viz-ret')) {
        st.ret = t.getAttribute('data-viz-ret');
      }
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => { m.tab = b.getAttribute('data-mtab'); redraw(); }));
    view.querySelectorAll('[data-head]').forEach((el) => el.addEventListener('input', () => { m[el.getAttribute('data-head')] = el.value; measSaveSoon(); }));
    view.querySelectorAll('[data-in]').forEach((el) => {
      el.addEventListener('input', () => {
        const path = el.getAttribute('data-in');
        const { obj, key } = measAt(path);
        obj[key] = parseIn(el.value);
        measSaveSoon();
        const mm = /^stairs\.(\d+)\./.exec(path);
        if (mm) repaintViz(Number(mm[1]));
      });
      el.addEventListener('blur', () => {
        const { obj, key } = measAt(el.getAttribute('data-in'));
        const bad = el.value.trim() && obj[key] == null;
        el.classList.toggle('is-bad', Boolean(bad));
        if (!bad) el.value = fmtIn(obj[key]);
        measRefreshSide();
      });
      el.addEventListener('focus', () => el.select());
      // Enter jumps to the next measure, like a spreadsheet.
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const all = [...view.querySelectorAll('[data-in]:not([disabled])')];
        const next = all[all.indexOf(el) + 1];
        if (next) next.focus();
      });
    });
    view.querySelectorAll('[data-txt]').forEach((el) => el.addEventListener('input', () => {
      const path = el.getAttribute('data-txt');
      const { obj, key } = measAt(path);
      obj[key] = el.value;
      measSaveSoon();
      const ms = /^stairs\.(\d+)\.color$/.exec(path);
      if (ms) repaintViz(Number(ms[1]));
      const mv = /^vents\.(\d+)\.(size|color)$/.exec(path);
      if (mv) repaintVent(Number(mv[1]));
    }));
    view.querySelectorAll('[data-txt]').forEach((el) => el.addEventListener('blur', measRefreshSide));
    view.querySelectorAll('[data-num]').forEach((el) => el.addEventListener('input', () => { const { obj, key } = measAt(el.getAttribute('data-num')); obj[key] = Math.max(1, Math.round(Number(el.value) || 1)); measSaveSoon(); measRefreshSide(); }));
    view.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => { const { obj, key } = measAt(el.getAttribute('data-set')); obj[key] = el.value; measSaveSoon(); redraw(); }));
    view.querySelectorAll('[data-free]').forEach((el) => el.addEventListener('change', () => {
      const { obj, key } = measAt(el.getAttribute('data-free'));
      obj[key] = el.value === '__other' ? ' ' : el.value;
      measSaveSoon();
      redraw();
      if (el.value === '__other') { const inp = view.querySelector(`[data-txt="${el.getAttribute('data-free')}"]`); if (inp) { inp.value = ''; inp.focus(); } }
    }));
    view.querySelectorAll('[data-vsize]').forEach((el) => el.addEventListener('change', () => {
      const p = el.getAttribute('data-vsize');
      const { obj } = measAt(`${p}.size`);
      obj.size = el.value === '__other' ? ' ' : el.value;
      measSaveSoon();
      redraw();
      if (el.value === '__other') { const inp = view.querySelector(`[data-txt="${p}.size"]`); if (inp) { inp.value = ''; inp.focus(); } }
    }));
    const stairAdd = $('ppStairAdd');
    if (stairAdd) stairAdd.addEventListener('click', () => {
      const prev = m.data.stairs[m.data.stairs.length - 1];
      const s = newStair(m.data.stairs.length ? m.data.stairs.length + 1 : 0);
      if (prev) Object.assign(s, { species: prev.species, finish: prev.finish, color: prev.color, riser_material: prev.riser_material });
      s.steps.push(newStep());
      m.data.stairs.push(s);
      measSaveSoon();
      redraw();
      const ins = view.querySelectorAll(`[data-in^="stairs.${m.data.stairs.length - 1}.steps.0"]`);
      if (ins[0]) ins[0].focus();
    });
    view.querySelectorAll('[data-stair-rm]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tirar?'; b.classList.add('is-armed'); return; }
      m.data.stairs.splice(Number(b.getAttribute('data-stair-rm')), 1);
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-step-add]').forEach((b) => b.addEventListener('click', () => {
      const s = m.data.stairs[Number(b.getAttribute('data-step-add'))];
      s.steps.push(newStep(s.steps[s.steps.length - 1]));
      measSaveSoon();
      redraw();
      const si = Number(b.getAttribute('data-step-add'));
      const el = view.querySelector(`[data-in="stairs.${si}.steps.${s.steps.length - 1}.tread_w"]`);
      if (el) el.focus();
    }));
    view.querySelectorAll('[data-step-many]').forEach((b) => b.addEventListener('click', () => {
      const si = Number(b.getAttribute('data-step-many'));
      const s = m.data.stairs[si];
      const n = Math.min(40, Math.max(1, Number(($(`ppMany-${si}`) || {}).value) || 1));
      for (let i = 0; i < n && s.steps.length < 60; i += 1) s.steps.push(newStep(s.steps[s.steps.length - 1]));
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-step-down]').forEach((b) => b.addEventListener('click', () => {
      const [si, i] = b.getAttribute('data-step-down').split(':').map(Number);
      const s = m.data.stairs[si];
      const src = s.steps[i];
      for (let j = i + 1; j < s.steps.length; j += 1) s.steps[j] = { ...src, id: s.steps[j].id, note: s.steps[j].note };
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-step-rm]').forEach((b) => b.addEventListener('click', () => {
      const [si, i] = b.getAttribute('data-step-rm').split(':').map(Number);
      m.data.stairs[si].steps.splice(i, 1);
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-nos-add]').forEach((b) => b.addEventListener('click', () => {
      const s = m.data.stairs[Number(b.getAttribute('data-nos-add'))];
      const last = s.steps[s.steps.length - 1];
      s.nosings.push({ id: uid(), length: last ? last.tread_w : null, qty: 1, type: 'flush', note: '' });
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-nos-rm]').forEach((b) => b.addEventListener('click', () => {
      const [si, i] = b.getAttribute('data-nos-rm').split(':').map(Number);
      m.data.stairs[si].nosings.splice(i, 1);
      measSaveSoon();
      redraw();
    }));
    const ventAdd = $('ppVentAdd');
    if (ventAdd) ventAdd.addEventListener('click', () => {
      m.data.vents.push(newVent(m.data.vents[m.data.vents.length - 1]));
      measSaveSoon();
      redraw();
      const inp = view.querySelector(`[data-txt="vents.${m.data.vents.length - 1}.room"]`);
      if (inp) inp.focus();
    });
    view.querySelectorAll('[data-vent-rm]').forEach((b) => b.addEventListener('click', () => {
      m.data.vents.splice(Number(b.getAttribute('data-vent-rm')), 1);
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-ph-add]').forEach((inp) => inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const label = inp.closest('.pp-meas-addph');
      if (label) label.classList.add('is-busy');
      try {
        const dataUrl = (await compressImage(file)) || (await readAsDataUrl(file));
        const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/photos`, { data_url: dataUrl });
        const { obj, key } = measAt(inp.getAttribute('data-ph-add'));
        obj[key] = (obj[key] || []).concat(r.data.key);
        measSaveSoon();
        await measSaveNow();
        redraw();
      } catch (e) {
        window.alert(e.message || 'Não foi possível enviar a foto.');
        if (label) label.classList.remove('is-busy');
      }
    }));
    view.querySelectorAll('[data-ph-rm]').forEach((b) => b.addEventListener('click', () => {
      const { obj, key } = measAt(b.getAttribute('data-ph-rm'));
      obj[key].splice(Number(b.getAttribute('data-ph-i')), 1);
      measSaveSoon();
      redraw();
    }));
    const done = $('ppMeasDone');
    if (done) done.addEventListener('click', async () => {
      done.disabled = true;
      try {
        await measSaveNow();
        const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/complete`, { done: true });
        state.meas = { ...r.data, tab: m.tab, dirty: false };
        paintMeasurement();
      } catch (e) {
        done.disabled = false;
        window.alert(e.message);
      }
    });
    const reopen = $('ppMeasReopen');
    if (reopen) reopen.addEventListener('click', async () => {
      const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/complete`, { done: false });
      state.meas = { ...r.data, tab: m.tab, dirty: false };
      paintMeasurement();
    });
    const del = $('ppMeasDel');
    if (del) del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Confirmar: apagar medição'; return; }
      await api(`/api/builder/measurements/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      state.meas = null;
      location.hash = '#medicoes';
    });
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
      ${state.builder ? `<div class="pp-card" style="overflow:hidden">
        ${item('#empresas', 'Empresas', activeCompanies().length ? `${activeCompanies().length} conectadas` : 'Conecte ou convide empresas de piso')}
        ${canDo('measure') ? item('#medicoes', 'Medições', 'Escadas e vents medidos na obra') : ''}
        ${item('#equipe', 'Equipe', `${state.builder.account.name} · ${state.builder.member.role_label}`)}
      </div>` : ''}
      <div class="pp-card" style="overflow:hidden">
        <div style="padding:14px 16px"><strong>${esc(state.user.name || '')}</strong><div class="pp-muted" style="font-size:13px">${esc(state.user.email || '')}${state.user.company_name ? ` · ${esc(state.user.company_name)}` : ''}</div></div>
        ${!state.builder && state.providers.length > 1 ? `<button type="button" class="pp-row" id="ppMoreSwitch"><span class="pp-row-main"><strong style="font-size:15px">Trocar de fornecedor</strong><span class="pp-row-sub">Agora: ${esc(providerName())}</span></span></button>` : ''}
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
    try { await api(state.builder ? '/api/builder/logout' : '/api/partner-auth/logout', { method: 'POST' }); } catch (_) { /* sign out locally anyway */ }
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
    window.addEventListener('resize', (() => { let mobile = window.matchMedia('(max-width: 1023px)').matches; return () => { const now = window.matchMedia('(max-width: 1023px)').matches; if (now !== mobile) { mobile = now; if (['jobs', 'invoices'].includes(route().name)) render(); } }; })());
  }

  async function boot() {
    const session = await api('/api/partner-auth/session');
    if (!session.authenticated) { location.replace('partner-login.html'); return; }
    state.user = session.data || {};
    if (state.user.builder_account) {
      await loadMe();
      $('ppAvatar').textContent = initials(state.user.name || state.user.email);
      $('ppAvatar').setAttribute('aria-label', `Conta: ${state.user.name || state.user.email || ''}`);
      $('ppUserName').textContent = state.user.name || '';
      $('ppUserEmail').textContent = [state.user.email, `${state.builder.account.name} · ${state.builder.member.role_label}`].join(' · ');
      paintShell();
      if (typeof window.sfBootCrmAddressAutocomplete === 'function') window.sfBootCrmAddressAutocomplete();
      $('ppDock').hidden = false;
      $('ppTabs').hidden = false;
      $('ppSearchFab').hidden = false;
      if (!location.hash && !activeCompanies().length) location.hash = '#empresas';
      await refreshOverview().catch(() => {});
      loadInvoices().then(updateCounts).catch(() => {});
      loadRequests().then(updateCounts).catch(() => {});
      await render();
      return;
    }
    state.providers = state.user.providers || [];
    const prov = providerName();
    const builderName = state.user.company_name || state.user.name || prov;
    $('ppProvider').textContent = builderName;
    $('ppBrandSub').textContent = `Empresa: ${prov}`;
    $('ppMark').textContent = initials(builderName);
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
    if (typeof window.sfBootCrmAddressAutocomplete === 'function') window.sfBootCrmAddressAutocomplete();
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
