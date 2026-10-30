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
    return new Intl.DateTimeFormat('en-US', opts || { month: 'short', day: 'numeric' }).format(d);
  }
  function fmtWeekday(value) {
    const d = value instanceof Date ? value : toDate(value);
    if (!d) return '';
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
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
  /** Mate, the ObraMate mascot, in empty states and helpers. */
  const MATE_NEW = { measure: 1, snap: 1, delivery: 1, handshake: 1 };
  function mateSrc(pose) {
    return `/assets/img/mascot/mate-${pose}.webp?v=${MATE_NEW[pose] ? '20261028-ob3' : '20261027-m2'}`;
  }
  function mate(pose, size) {
    const h = size || 72;
    return `<img class="pp-mate" src="${mateSrc(pose)}" alt="" height="${h}" style="height:${h}px" decoding="async" loading="lazy">`;
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
      pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
      mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
      download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
      home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
      trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
      chat: '<path d="M4 5h16v11H9l-5 4z"/>',
      send: '<path d="M4 12l16-8-6 16-2-6z"/>',
      ruler: '<path d="M3 17 17 3l4 4L7 21H3z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
      cal: '<path d="M4 6h16v14H4z"/><path d="M8 3v5M16 3v5M4 11h16"/>',
      phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
      mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
      locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
      check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
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
      throw new Error('Please sign in again.');
    }
    if (!response.ok) {
      const err = new Error(body.error || 'Could not load the data.');
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

  const JOB_STEPS = ['Received', 'Scheduled', 'On site', 'Completed'];
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
    if (i === 3) return '<span class="pp-chip pp-chip--ok">Completed</span>';
    if (i === 2) return '<span class="pp-chip pp-chip--dark">On site</span>';
    if (i === 1) return '<span class="pp-chip">Scheduled</span>';
    return '<span class="pp-chip">Awaiting schedule</span>';
  }
  function jobWhen(job) {
    const start = toDate(job.scheduledStart);
    const i = jobStepIndex(job);
    if (i === 3) return `Completed · ${fmtDay(job.updatedAt)}`;
    if (!start) return 'Not scheduled yet';
    const late = jobLate(job);
    if (late && i === 1) return `<span class="pp-late">Not started · ${plural(late, 'day', 'days')} past the date</span>`;
    if (i === 2) {
      const end = toDate(job.scheduledEnd);
      return end ? `On site · until ${fmtWeekday(end)}` : 'On site';
    }
    const d = daysBetween(new Date(), start);
    if (d === 0) return `Today${job.allDay ? '' : ` · ${fmtTime(start)}`}`;
    if (d === 1) return `Tomorrow${job.allDay ? '' : ` · ${fmtTime(start)}`}`;
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
    if (paid) return { key: 'paid', label: 'Paid', chip: '<span class="pp-chip pp-chip--ok">Paid</span>', days: 0 };
    if (due && due < today) {
      const days = daysBetween(due, today);
      return { key: 'overdue', label: `${plural(days, 'day', 'days')} overdue`, chip: `<span class="pp-chip pp-chip--late">${plural(days, 'day', 'days')} overdue</span>`, days };
    }
    if (due) {
      const days = daysBetween(today, due);
      if (days <= 7) return { key: 'soon', label: days === 0 ? 'Due today' : `Due in ${plural(days, 'day', 'days')}`, chip: `<span class="pp-chip pp-chip--late">${days === 0 ? 'Due today' : `Due in ${plural(days, 'day', 'days')}`}</span>`, days };
      return { key: 'open', label: `Due ${fmtDay(due)}`, chip: '<span class="pp-chip">Open</span>', days };
    }
    return { key: 'open', label: 'Open', chip: '<span class="pp-chip">Open</span>', days: 0 };
  }
  function invoiceRef(inv) {
    const job = inv.job || {};
    return job.title || job.address || (inv.quote && inv.quote.title) || 'Invoice';
  }

  function requestStatus(req) {
    if (req.status === 'accepted') return '<span class="pp-chip pp-chip--ok">Accepted</span>';
    if (req.status === 'declined') return '<span class="pp-chip pp-chip--late">Not approved</span>';
    return '<span class="pp-chip">Waiting for the company</span>';
  }

  function providerName() {
    if (state.builder) {
      if (state.ctx) return state.ctx.company_name;
      const filtered = state.coFilter && coById(state.coFilter);
      if (filtered) return filtered.company_name;
      const act = activeCompanies();
      return act.length === 1 ? act[0].company_name : 'All companies';
    }
    const user = state.user || {};
    const p = state.providers.find((x) => x.slug === user.workspace);
    return (p && p.name) || 'Your installer';
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
    return `<div class="pp-cobar pp-filter" role="group" aria-label="Filter by company">${btn('', 'All companies')}${activeCompanies().map((c) => btn(c.id, c.company_name)).join('')}</div>`;
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
      throw new Error('Job not found.');
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

  const ROUTE_ALIAS = { home: 'inicio', calendar: 'calendario', send: 'enviar', documents: 'documentos', more: 'mais', companies: 'empresas', team: 'equipe' };
  function route() {
    const hash = (location.hash || '#home').slice(1);
    const [name, id] = hash.split('/');
    // English URLs (#home, #send…) map to the internal page keys.
    return { name: ROUTE_ALIAS[name] || name || 'inicio', id: id ? decodeURIComponent(id) : '' };
  }
  function setNav(name) {
    const map = { 'job': 'jobs', 'invoice': 'invoices', 'pedidos': 'enviar' };
    const key = map[name] || name;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const nav = el.getAttribute('data-nav');
      const compactPhone = window.matchMedia('(max-width: 767px)').matches;
      const tuckedInMore = ['documentos', 'enviar', 'mais', 'empresas', 'equipe', 'settings'].includes(key)
        || (key === 'measurements' && !el.classList.contains('pp-tab'))
        || (key === 'calendario' && compactPhone && state.builder && canDo('measure'));
      const on = nav === key || (nav === 'mais' && tuckedInMore);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }
  let renderToken = 0;
  let lastScreen = '';
  // The entry animation plays once; later redraws of the same screen stay still.
  view.addEventListener('animationend', (e) => { if (e.target.parentNode === view && Array.prototype.indexOf.call(view.children, e.target) >= Math.min(3, view.children.length - 1)) view.classList.remove('pp-enter'); });
  /** Company filter under the page title on list pages (builders with 2+ companies). */
  function paintCoBar(r) {
    if (!['jobs', 'invoices', 'documentos'].includes(r.name)) return;
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
    // Entering a new screen settles in once; re-renders of the same screen (search, filters) don't animate.
    const screenKey = `${r.name}/${r.id}`;
    if (screenKey !== lastScreen) {
      lastScreen = screenKey;
      view.classList.remove('pp-enter');
      void view.offsetWidth;
      view.classList.add('pp-enter');
    }
    document.body.classList.remove('pp-focus');
    state.ctx = null;
    if (r.name !== 'settings') state.pickupEdit = null;
    try {
      if (state.builder && r.name === 'empresas') { await renderCompanies(r.id, token); updateCounts(); return; }
      if (state.builder && r.name === 'equipe') { await renderTeam(token); updateCounts(); return; }
      if (state.builder && r.name === 'settings') { await renderSettings(r.id, token); updateCounts(); return; }
      if (state.builder && r.name === 'notifications') { await renderNotifications(token); updateCounts(); return; }
      if (state.builder && r.name === 'measurements') {
        if (!canDo('measure')) { view.innerHTML = '<div class="pp-card pp-empty"><strong>Your role can’t take measurements</strong>Ask your team admin.</div>'; return; }
        await renderMeasurements(r.id, token); updateCounts(); return;
      }
      if (state.meas && state.meas.dirty) measSaveNow();
      if (state.builder && !companyActive() && !['enviar', 'mais'].includes(r.name)) { await renderNoCompany(token); updateCounts(); return; }
      if (state.builder && ['inicio', 'calendario'].includes(r.name) && state.coFilter) { state.coFilter = ''; applyCoFilter(); }
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
      view.innerHTML = `<p class="pp-error" role="alert">${esc(err.message || 'Could not load.')}</p>`;
    }
    updateCounts();
  }

  /* ─────────────────────────── home ─────────────────────────── */

  async function renderHome(token) {
    await Promise.all([
      loadInvoices(),
      loadRequests(),
      state.builder && canDo('measure') ? api('/api/builder/measurements').then((r) => { state.homeMeas = r.data || []; }).catch(() => {}) : null,
      state.builder ? ensurePickups() : null,
      state.builder && state.teamCount == null ? api('/api/builder/team').then((r) => { state.teamCount = (r.data || []).length; }).catch(() => {}) : null,
    ]);
    if (token !== renderToken) return;
    const user = state.user;
    const now = new Date();
    const hour = now.getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
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
      attention.push(`<div class="pp-att"><div class="pp-att-main"><strong>${esc(inv.number ? `Invoice ${inv.number}` : 'Invoice')} · ${money(inv.balance)}</strong><span class="${st.key === 'overdue' ? 'pp-late' : ''}">${esc(invoiceRef(inv))} · ${esc(st.label)}</span></div><a class="pp-btn pp-btn--dark pp-btn--sm" href="#invoices/${encodeURIComponent(inv.id)}">View invoice</a></div>`);
    });
    state.requests.filter((r) => r.status === 'declined' && daysBetween(toDate(r.created_at) || now, now) <= 30).forEach((r) => {
      attention.push(`<div class="pp-att"><div class="pp-att-main"><strong>Request not approved · ${esc(r.title)}</strong><span>${esc(r.review_note || 'The company did not approve this request.')}</span></div><a class="pp-btn pp-btn--sec pp-btn--sm" href="#send">View request</a></div>`);
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
          <div><p class="pp-eyebrow">${esc(fmtDay(now, { weekday: 'long', month: 'long', day: 'numeric' }))}</p><h1>${esc(hello)}${first ? `, ${esc(first)}` : ''}</h1></div>
          ${state.builder ? '' : '<div class="pp-head-actions"><a class="pp-btn pp-btn--sec" href="#calendar">Calendar</a><a class="pp-btn pp-btn--sec" href="#documents">Photos & docs</a><a class="pp-btn pp-btn--pri" href="#send">Send work</a></div>'}
        </div>
        ${installBannerHtml() ? `<div style="grid-column: span 12">${installBannerHtml()}</div>` : ''}
        ${state.builder ? homeQuickHtml(now, setupCardHtml()) : ''}

        <section class="pp-tile pp-tile--orange" style="grid-column: span 4; grid-row: span 3" aria-label="Active jobs">
          <div style="font-size:14px;font-weight:500">Active jobs</div>
          <div class="pp-big" style="font-size:52px">${active.length}</div>
          <div style="font-size:14px">${state.builder ? `${plural(done30, 'completed', 'completed')} in the last 30 days` : `with ${esc(providerName())}`}</div>
          <div class="pp-inbox-grid">
            <div class="pp-inbox"><span style="font-size:12px">Awaiting schedule</span><b>${waiting}</b></div>
            <div class="pp-inbox"><span style="font-size:12px">Scheduled</span><b>${scheduled}</b></div>
            <div class="pp-inbox"><span style="font-size:12px">On site</span><b>${onSite}</b></div>
          </div>
          <a class="pp-tile-link" href="#jobs">View jobs →</a>
        </section>

        ${canDo('money.view') ? `<section class="pp-tile pp-tile--dark" style="grid-column: span 4; grid-row: span 2" aria-label="Open invoices">
          <div class="pp-lbl">Open invoices</div>
          <div class="pp-big">${money(openSum)}</div>
          <div class="pp-meter" aria-hidden="true"><i style="width:${openSum ? Math.round((overdueSum / openSum) * 100) : 0}%"></i></div>
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:13px" class="pp-sub"><span>${money(overdueSum)} overdue</span><span>${money(soonSum)} due in 7 days</span></div>
          <a class="pp-tile-link" href="#invoices">View invoices →</a>
        </section>` : `<section class="pp-tile pp-tile--dark" style="grid-column: span 4; grid-row: span 2" aria-label="Photos & docs">
          <div class="pp-lbl">Photos & documents</div>
          <div class="pp-big">${esc(providerName())}</div>
          <div style="font-size:13px" class="pp-sub">Before, during and after photos, reports and files the company shares.</div>
          <a class="pp-tile-link" href="#documents">View photos & docs →</a>
        </section>`}

        <section class="pp-tile" style="grid-column: span 4; grid-row: span 3" aria-labelledby="ppNext">
          <div class="pp-tile-head"><h2 id="ppNext">Coming up on site</h2><a class="pp-link" href="#calendar" style="font-size:13px">Calendar</a></div>
          ${upcoming.length ? upcoming.map((j) => `<a class="pp-inbox" href="#jobs/${encodeURIComponent(j.id)}" style="text-decoration:none"><span class="pp-lbl">${jobWhen(j)}</span><strong style="font-size:15px">${esc(j.title || 'Job')}</strong><span class="pp-muted" style="font-size:13px">${esc(j.address || '')}</span></a>`).join('') : '<div class="pp-empty" style="padding:16px 8px"><strong>Nothing scheduled</strong>When the company schedules a job, it shows up here.</div>'}
        </section>

        <section class="pp-tile pp-hide-phone" style="grid-column: span 2" aria-label="Completed"><div class="pp-lbl">Completed · 30 days</div><div class="pp-big" style="font-size:28px">${done30}</div></section>
        <section class="pp-tile pp-hide-phone" style="grid-column: span 2" aria-label="Requests"><div class="pp-lbl">Requests waiting</div><div class="pp-big" style="font-size:28px">${pending}</div></section>

        <section class="pp-tile" style="grid-column: span 6; grid-row: span 3; gap: 4px" aria-labelledby="ppAtt">
          <h2 id="ppAtt" style="margin-bottom:8px">For you ${attention.length ? `<span class="pp-badge">${attention.length}</span>` : ''}</h2>
          ${attention.length ? attention.slice(0, 5).join('') : '<div class="pp-empty" style="padding:16px 8px"><strong>Nothing waiting on you</strong>Invoices coming due and replies from the company show up here.</div>'}
        </section>

        <section class="pp-tile pp-hide-phone" style="grid-column: span 6; grid-row: span 2" aria-labelledby="ppFc">
          <div class="pp-tile-head"><h2 id="ppFc">On-site forecast</h2><span class="pp-lbl">Next 14 days</span></div>
          <div class="pp-forecast" role="img" aria-label="Jobs per day: ${esc(forecastLabel)}">${forecast.map((f, i) => `<i class="${i === 0 ? 'today' : f.n ? '' : 'zero'}" style="height:${f.n ? Math.max(14, Math.round((f.n / maxN) * 100)) : 8}%"></i>`).join('')}</div>
          <div class="pp-forecast-labels" aria-hidden="true">${forecast.map((f, i) => `<span class="${i === 0 ? 'today' : ''}">${esc(fmtDay(f.d, { day: 'numeric' }))}</span>`).join('')}</div>
        </section>

        <button type="button" class="pp-drop" id="ppHomeDrop" style="grid-column: span 6">
          <span class="pp-drop-icon">${icon('upload')}</span>
          <span><strong>Drop a work order, PO or schedule here</strong><span>PDF, screenshot, photo or e-mail. We read it and you check before sending.</span></span>
        </button>
      </div>`;
    bindDrop($('ppHomeDrop'), (files) => startSendWithFiles(files));
    view.querySelectorAll('[data-qa-camera]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $('ppCameraInput').click(); }));
    view.querySelectorAll('[data-setup-hide]').forEach((b) => b.addEventListener('click', () => {
      try { localStorage.setItem(`ob_setup_hidden_${state.builder.account.id}`, '1'); } catch (_) { /* private mode */ }
      const card = b.closest('.pp-setup2');
      if (card) card.remove();
    }));
    $('ppHomeDrop').addEventListener('click', () => { location.hash = '#send'; });
  }

  /** Builder home: big actions for the phone, today's jobs and measurements in progress. */
  function homeQuickHtml(now, setupHtml) {
    const today = jobsInDay(dateKey(now)).sort((a, b) => toDate(a.scheduledStart) - toDate(b.scheduledStart));
    const act = (href, ic, label, sub, attrs) => `<a class="pp-qa" href="${href}" ${attrs || ''}><span class="pp-qa-ic">${icon(ic)}</span><span><strong>${esc(label)}</strong><small>${esc(sub)}</small></span></a>`;
    const meas = (state.homeMeas || []).filter((m) => m.status === 'draft').slice(0, 3);
    return `<section class="pp-qa-grid" style="grid-column: span 12" aria-label="Quick actions">
        ${canDo('jobs.send') ? act('#send', 'upload', 'Send work order', 'PDF, photo or text') : ''}
        ${canDo('measure') ? act('#measurements/new', 'ruler', 'Measure', 'Stairs & vents on site') : ''}
        ${canDo('jobs.send') ? act('#send', 'camera', 'Snap a work order', 'Use the camera', 'data-qa-camera') : ''}
        ${act('#calendar', 'cal', 'Calendar', today.length ? `${plural(today.length, 'job', 'jobs')} today` : 'Nothing today')}
      </section>
      ${setupHtml || ''}
      ${today.length ? `<section class="pp-tile pp-today" style="grid-column: span 12" aria-labelledby="ppToday"><div class="pp-tile-head"><h2 id="ppToday">Today on site</h2><span class="pp-lbl">${today.length}</span></div>
        <div class="pp-today-list">${today.map((j) => `<a class="pp-today-item" href="#jobs/${encodeURIComponent(j.id)}"><span class="pp-today-time">${j.allDay ? 'All day' : esc(fmtTime(j.scheduledStart))}</span><span class="pp-today-main"><strong>${esc(j.title || 'Job')}</strong><small>${esc(j.address || '')}</small></span>${jobChip(j)}</a>`).join('')}</div></section>` : ''}
      ${meas.length ? `<section class="pp-tile" style="grid-column: span 12" aria-labelledby="ppMeasHome"><div class="pp-tile-head"><h2 id="ppMeasHome">Measurements in progress</h2><a class="pp-link" href="#measurements" style="font-size:13px">All</a></div>
        ${meas.map((m) => `<a class="pp-today-item" href="#measurements/${esc(m.id)}"><span class="pp-today-time">${icon('ruler')}</span><span class="pp-today-main"><strong>${esc(m.address)}</strong><small>${esc(countsText(m.counts))}</small></span><span class="pp-chip pp-chip--late">In progress</span></a>`).join('')}</section>` : ''}`;
  }

  /* ─────────────────────────── notifications (bell + push) ─────────────────────────── */

  const NOTE_IC = { accepted: 'check', declined: 'back', scheduled: 'cal', rescheduled: 'cal', started: 'pin', photos: 'camera', report: 'text', completed: 'check' };
  async function loadNotes(fresh) {
    if (!state.builder) return null;
    try {
      const r = await api(`/api/builder/notifications${fresh ? '?fresh=1' : ''}`);
      state.notes = r;
      paintBell();
      return r;
    } catch (_) { return null; }
  }
  function paintBell() {
    const bell = $('ppBell'); const n = $('ppBellN');
    if (!bell) return;
    bell.hidden = !state.builder;
    const u = (state.notes && state.notes.unread) || 0;
    n.hidden = !u;
    n.textContent = u > 9 ? '9+' : String(u);
    bell.setAttribute('aria-label', u ? `Notifications, ${u} new` : 'Notifications');
  }
  function noteAgo(at) {
    const d = toDate(at); if (!d) return '';
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min} min ago`;
    if (min < 60 * 24) return `${Math.round(min / 60)} h ago`;
    return fmtDayEn(at, { month: 'short', day: 'numeric' });
  }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  async function pushState() {
    if (!pushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const reg = await navigator.serviceWorker.getRegistration('/partner');
      const sub = reg && await reg.pushManager.getSubscription();
      return sub ? 'on' : 'off';
    } catch (_) { return 'off'; }
  }
  function urlB64(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser settings.');
    const reg = (await navigator.serviceWorker.getRegistration('/partner')) || (await navigator.serviceWorker.register('/obrabuilder-sw.js', { scope: '/partner' }));
    await navigator.serviceWorker.ready;
    const k = await api('/api/builder/push/key');
    if (!k.data || !k.data.key) throw new Error('Push is not set up on the server yet.');
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(k.data.key) }));
    await postJson('/api/builder/push/subscribe', { subscription: sub.toJSON() });
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration('/partner');
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await postJson('/api/builder/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  }
  async function renderNotifications(token) {
    const r = (await loadNotes(true)) || { data: [], unread: 0 };
    if (token !== renderToken) return;
    const ps = await pushState();
    const rows = r.data || [];
    const today = dateKey(new Date());
    const groups = [];
    rows.forEach((n) => { const k = dateKey(n.at) === today ? 'Today' : fmtDayEn(n.at, { weekday: 'long', month: 'short', day: 'numeric' }); let g = groups.find((x) => x[0] === k); if (!g) { g = [k, []]; groups.push(g); } g[1].push(n); });
    const pushCard = ps === 'unsupported' ? '' : `<section class="pp-card pp-npush ${ps === 'on' ? 'is-on' : ''}">
        <span class="pp-npush-ic" aria-hidden="true">${mate(ps === 'on' ? 'head-happy' : 'head-curious', 44)}</span>
        <div><strong>${ps === 'on' ? 'Push is on for this device' : ps === 'denied' ? 'Notifications are blocked' : 'Get a push on this phone'}</strong><small>${ps === 'on' ? 'You get a heads-up when a company accepts, schedules, starts, shares photos or finishes.' : ps === 'denied' ? 'Allow notifications for ObraBuilder in the browser settings, then come back.' : isStandaloneApp() || !/iPhone|iPad/.test(navigator.userAgent) ? 'Know right away when a company accepts and schedules your work.' : 'On iPhone, add ObraBuilder to the Home Screen first (Share › Add to Home Screen).'}</small></div>
        ${ps === 'on' ? '<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-push-test>Send a test</button><button type="button" class="pp-link" data-push-off>Turn off</button>' : ps === 'denied' ? '' : '<button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-push-on>Turn on</button>'}
      </section>`;
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>Notifications</h1></div></div>
      ${pushCard}
      ${rows.length ? groups.map(([k, list]) => `<div class="pp-ngroup">${esc(k)}</div><section class="pp-card pp-nlist">${list.map((n) => `<a class="pp-nrow ${n.unread ? 'is-new' : ''} is-${esc(n.kind)}" href="${esc(n.url || '#jobs')}"><span class="pp-nic" aria-hidden="true">${icon(NOTE_IC[n.kind] || 'chat')}</span><span class="pp-nmain"><strong>${esc(n.title)}</strong>${n.body ? `<small>${esc(n.body)}</small>` : ''}<em>${esc([n.company, noteAgo(n.at)].filter(Boolean).join(' · '))}</em></span>${n.unread ? '<i class="pp-ndot" aria-label="New"></i>' : ''}</a>`).join('')}</section>`).join('')
        : `<div class="pp-card pp-empty">${mate('sleeping', 90)}<strong>No notifications yet</strong>When a company accepts and schedules your work, shares photos or finishes a job, it shows up here.</div>`}`;
    const on = view.querySelector('[data-push-on]');
    if (on) on.addEventListener('click', async () => { on.disabled = true; try { await enablePush(); mateToast('head-happy', 'Push is on', 'You’ll get a heads-up on this device.'); render(); } catch (e) { on.disabled = false; mateToast('head-sorry', 'Couldn’t turn it on', e.message); } });
    const off = view.querySelector('[data-push-off]');
    if (off) off.addEventListener('click', async () => { await disablePush().catch(() => {}); render(); });
    const test = view.querySelector('[data-push-test]');
    if (test) test.addEventListener('click', async () => { test.disabled = true; await postJson('/api/builder/push/test', {}).catch(() => {}); setTimeout(() => { test.disabled = false; }, 3000); });
    if (r.unread) { postJson('/api/builder/notifications/seen', {}).catch(() => {}); if (state.notes) { state.notes.unread = 0; paintBell(); } }
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
      ['On site', list.filter((j) => jobStageKey(j) === 'obra')],
      ['Scheduled', list.filter((j) => jobStageKey(j) === 'agendado').sort((a, b) => toDate(a.scheduledStart) - toDate(b.scheduledStart))],
      ['Awaiting schedule', list.filter((j) => jobStageKey(j) === 'recebido')],
      ['Completed', list.filter((j) => jobStageKey(j) === 'concluido')],
    ].filter(([, rows]) => rows.length);
    const selectedId = id || (window.matchMedia('(max-width: 1023px)').matches ? '' : (groups[0] && groups[0][1][0] && groups[0][1][0].id) || '');
    const late = all.filter((j) => jobLate(j)).length;
    await loadInvoices().catch(() => {});
    if (token !== renderToken) return;
    const openSum = state.invoices.filter((inv) => invoiceState(inv).key !== 'paid').reduce((s, inv) => s + Number(inv.balance || 0), 0);
    const done30 = all.filter((j) => !jobIsActive(j) && daysBetween(toDate(j.updatedAt) || now, now) <= 30).length;

    const stage = (key, label) => `<button type="button" data-stage="${key}" aria-pressed="${state.jobStage === key}">${esc(label)}<span class="pp-jtab-n">${counts[key]}</span></button>`;
    const STAT = [['Awaiting schedule', 'wait'], ['Scheduled', 'sched'], ['On site', 'site'], ['Completed', 'done']];
    const shortTitle = (j) => {
      // titles often end with the address, which the row already shows
      const t = String(j.title || 'Job'); const a = String(j.address || '').trim();
      const k = a ? t.toLowerCase().lastIndexOf(a.split(',')[0].toLowerCase()) : -1;
      const cut = k > 0 ? t.slice(0, k).replace(/[\s·\-–,]+$/, '') : t;
      return cut || t;
    };
    const row = (j) => {
      const i = jobStepIndex(j);
      const d = toDate(i === 3 ? j.updatedAt : j.scheduledStart);
      const late = jobLate(j);
      const today = d && daysBetween(new Date(), d) === 0 && i < 3;
      const [stLabel, stKey] = late && i === 1 ? ['Past date', 'late'] : STAT[i];
      return `<button type="button" class="pp-row pp-jrow" data-job="${esc(j.id)}" aria-current="${j.id === selectedId}">
        <span class="pp-jdate ${late ? 'is-late' : today ? 'is-today' : i === 3 ? 'is-done' : ''} ${d ? '' : 'is-none'}" aria-hidden="true">${d ? `<small>${esc(d.toLocaleDateString('en-US', { month: 'short' }))}</small><b>${d.getDate()}</b><small>${esc(d.toLocaleDateString('en-US', { weekday: 'short' }))}</small>` : '<b>—</b><small>No date</small>'}</span>
        <span class="pp-row-main">
          <span class="pp-row-top"><strong>${esc(shortTitle(j))}</strong><span>${j.number ? `#${esc(j.number)}` : ''}</span></span>
          <span class="pp-row-sub">${esc(j.address || 'No address')}${state.builder && multiCo() && j._coName && !state.coFilter ? ` · ${esc(j._coName)}` : ''}</span>
          <span class="pp-jmeta"><span class="pp-jstat pp-jstat--${stKey}">${stLabel}</span><span class="pp-jwhen">${jobWhen(j).replace(/^(On site · |Completed · )/, '')}</span>${j.total && canDo('money.view') ? `<b>${moneyShort(j.total)}</b>` : ''}</span>
        </span>
      </button>`;
    };

    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder ? (state.coFilter && coById(state.coFilter) ? coById(state.coFilter).company_name : state.builder.account.name) : providerName())}</p><h1>Jobs</h1></div><div class="pp-head-actions"><a class="pp-btn pp-btn--pri" href="#send">Send work</a></div></div>
      <div class="pp-nums">
        <div class="pp-card pp-num"><span class="pp-lbl">Active</span><b>${all.filter(jobIsActive).length}</b></div>
        <div class="pp-card pp-num"><span class="pp-lbl">On site</span><b>${counts.obra}</b></div>
        <div class="pp-card pp-num"><span class="pp-lbl">Past date</span><b class="${late ? 'pp-late' : ''}">${late}</b></div>
        <div class="pp-card pp-num pp-hide-phone"><span class="pp-lbl">Completed · 30 days</span><b>${done30}</b></div>
        ${canDo('money.view') ? `<div class="pp-card pp-num pp-hide-phone"><span class="pp-lbl">Open invoices</span><b>${moneyShort(openSum)}</b></div>` : ''}
      </div>
      <div class="pp-split pp-split--list ${id ? 'is-open' : ''}">
        <aside class="pp-card pp-side" aria-label="Job list">
          <div class="pp-side-search"><label>${icon('search')}<span class="pp-sr">Search jobs</span><input id="ppJobSearch" type="search" placeholder="Address, title or #" value="${esc(state.q)}" /></label></div>
          <div class="pp-jtabs" role="group" aria-label="Stage">${stage('all', 'All')}${stage('obra', 'On site')}${stage('agendado', 'Scheduled')}${stage('recebido', 'To schedule')}${stage('concluido', 'Done')}</div>
          ${groups.length ? groups.map(([label, rows]) => `<div class="pp-group pp-jgroup"><span>${esc(label)}</span><span>${rows.length}</span></div>${rows.map(row).join('')}`).join('') : `<div class="pp-empty">${mate(q ? 'head-curious' : 'sleeping')}<strong>${q ? 'Nothing found' : 'No jobs yet'}</strong>${q ? 'Try another search.' : 'Send work and it shows up here once the company accepts it.'}</div>`}
          ${state.projects.length ? `<div class="pp-group">Projects · ${state.projects.length}</div>${state.projects.map((p) => `<div class="pp-row" style="cursor:default"><span class="pp-row-main"><span class="pp-row-top"><strong>${esc(p.name || 'Project')}</strong><span>${p.number ? `#${esc(p.number)}` : ''}</span></span><span class="pp-row-sub">${esc(p.address || '')}</span></span></div>`).join('')}` : ''}
        </aside>
        <section class="pp-main" id="ppJobPane" aria-label="Job">${selectedId ? '<div class="pp-card pp-empty">Loading the job…</div>' : '<div class="pp-card pp-empty"><strong>Pick a job</strong>Its details show up here.</div>'}</section>
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
        return { title: `Invoice ${inv.number || ''} · ${money(inv.balance)}`, text: invoiceState(inv).label, action: `<a class="pp-btn pp-btn--light" href="#invoices/${encodeURIComponent(inv.id)}">View invoice</a>` };
      }
      return { title: 'Job completed', text: 'Photos and reports the company shares stay on this page.', action: '' };
    }
    if (i === 2) return { title: end ? `Crew on site until ${fmtWeekday(end)}` : 'Crew on site', text: 'Photos of the day show up here when the company shares them.', action: '' };
    if (i === 1 && start) {
      const late = jobLate({ ...job, scheduledStart: job.scheduled_start, scheduledEnd: job.scheduled_end });
      if (late) return { title: `${plural(late, 'day', 'days')} past the date`, text: 'Send an update if something changed on site.', action: `<button type="button" class="pp-btn pp-btn--light" data-update-job>Send update</button>` };
      return { title: `On site ${fmtWeekday(start)}${job.all_day ? '' : `, ${fmtTime(start)}`}`, text: 'Make sure the house is open that day.', action: `<button type="button" class="pp-btn pp-btn--light" data-update-job>Send update</button>` };
    }
    return { title: 'Waiting to be scheduled', text: 'You get the date here as soon as the job is scheduled.', action: `<button type="button" class="pp-btn pp-btn--light" data-update-job>Send update</button>` };
  }

  const ICON = {
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  };

  function photoGrid(photos) {
    const label = { before: 'Before', during: 'During', after: 'After' };
    return `<div class="tk-photos">${photos.slice(0, 9).map((p) => p.type === 'video'
      ? `<a href="${esc(p.file_url)}" target="_blank" rel="noopener" class="tk-ph tk-ph--video"><span>Video</span>${p.stage && label[p.stage] ? `<b>${label[p.stage]}</b>` : ''}</a>`
      : `<a href="${esc(p.file_url)}" target="_blank" rel="noopener" class="tk-ph"><img src="${esc(p.file_url)}" alt="${esc(p.caption || 'Job photo')}" loading="lazy" />${p.stage && label[p.stage] ? `<b>${label[p.stage]}</b>` : ''}${p.caption ? `<i>${esc(p.caption)}</i>` : ''}</a>`).join('')}</div>`;
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
            <span class="tk-pill tk-pill--${pillTone}">${esc(t.status || 'Scheduled')}</span>
            ${job.external_ref ? `<span class="tk-num">· YOUR # ${esc(job.external_ref)}</span>` : ''}
          </div>
          ${job.can_edit ? '<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-edit-job>Edit</button>' : ''}
          <button type="button" class="tk-iconbtn" data-print-ticket aria-label="Print ticket">${ICON.print}</button>
        </div>
        <h2 id="tkTitle">${esc(job.title || 'Job')}</h2>
        ${t.sector ? `<p class="tk-sub">${esc(t.sector)}</p>` : ''}
        ${t.total ? `<div class="tk-value"><span>Job value</span><b>${money(t.total)}</b></div>` : ''}
        ${when
          ? `<div class="tk-when"><div><div class="tk-time">${t.all_day ? 'All day' : esc(when.start)}${!t.all_day && when.zone ? `<span>${esc(when.zone)}</span>` : ''}</div><div class="tk-day">${esc(when.day)}</div>${when.until ? `<div class="tk-until">${esc(when.until)}</div>` : ''}</div><span class="tk-rel">${esc(when.relative)}</span></div>`
          : '<div class="tk-when tk-when--none">No date yet. The company will schedule it.</div>'}
        <div class="tk-steps">${barsWithLabels(i, JOB_STEPS, i === 3)}</div>
        <div class="tk-facts">
          ${(() => { const openInv = invoices.filter((inv) => invoiceState(inv).key !== 'paid'); const due = openInv.reduce((a, inv) => a + Number(inv.balance || 0), 0); return [
            t.total && canDo('money.view') ? `<div class="tk-fact"><small>Job value</small><b>${money(t.total)}</b></div>` : '',
            canDo('money.view') ? `<button type="button" class="tk-fact" data-tk-go="tkInv"><small>Invoices</small><b class="${openInv.some((inv) => invoiceState(inv).key === 'overdue') ? 'pp-late' : ''}">${invoices.length ? (due ? `${money(due)} open` : 'Paid') : '—'}</b></button>` : '',
            `<button type="button" class="tk-fact" data-tk-go="ppPhotos"><small>Photos</small><b>${photos.length || '—'}</b></button>`,
            `<button type="button" class="tk-fact" data-tk-go="tkDocs"><small>Documents</small><b>${docs.length || '—'}</b></button>`,
          ].join(''); })()}
        </div>
        ${canDo('jobs.send') && i < 3 ? `<div class="tk-hero-acts"><button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-update-job>${icon('send')}Send update</button>${office ? `<a class="pp-btn pp-btn--sec pp-btn--sm" href="tel:+${esc(office.digits)}">Call ${esc(office.name)}</a>` : ''}</div>` : ''}
      </section>

      ${t.attention ? `<section class="tk-attn" role="note"><span aria-hidden="true">!</span><div><b>Attention</b><p>${esc(t.attention)}</p></div></section>` : ''}

      <section class="tk-sec">
        <h3>Location</h3>
        <p class="tk-addr">${esc(job.address || 'No address')}</p>
        ${t.maps ? `<div class="tk-two"><a class="tk-btn tk-btn--accent" href="${esc(t.maps.apple)}" target="_blank" rel="noopener">${ICON.pin}Apple Maps</a><a class="tk-btn" href="${esc(t.maps.google)}" target="_blank" rel="noopener">Google Maps</a></div>` : ''}
        ${t.lockbox ? `<div class="tk-lock"><span>${ICON.lock}</span><div><small>Lockbox code</small><b>${esc(t.lockbox)}</b></div></div>` : ''}
      </section>

      ${t.notes ? `<section class="tk-sec"><h3>Instructions</h3><p class="tk-notes">${esc(t.notes)}</p></section>` : ''}

      <section class="tk-sec">
        <h3>Services${services.length ? ` <small>${services.length}</small>` : ''}</h3>
        ${services.length
          ? `<ul class="tk-list tk-svc">${services.map((sv) => `<li><span>${esc(sv.name)}${sv.notes ? `<small>${esc(sv.notes)}</small>` : ''}</span><span class="tk-amt">${sv.total ? `<b>${money(sv.total)}</b>` : ''}${sv.qty ? `<small>${esc(sv.qty)}${sv.unit_price ? ` × ${money(sv.unit_price)}` : ''}</small>` : ''}</span></li>`).join('')}${t.total ? `<li class="tk-total"><span>Total</span><b>${money(t.total)}</b></li>` : ''}</ul>`
          : `<p class="tk-empty">The company hasn’t added services to this job yet.${canDo('jobs.send') && i < 3 ? ' <button type="button" class="pp-link" data-update-job>Send the services</button>' : ''}</p>`}
      </section>

      ${checklist.length ? `<section class="tk-sec">
        <h3>Checklist <small>${t.checklist_done} of ${checklist.length} done</small></h3>
        <div class="tk-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <ul class="tk-list tk-ck">${checklist.map((c) => `<li class="${c.done ? 'on' : ''}"><span class="tk-box" aria-label="${c.done ? 'Done' : 'Pending'}">${c.done ? ICON.check : ''}</span><span>${esc(c.text)}</span></li>`).join('')}</ul>
      </section>` : ''}`;

    const side = `
      <section class="tk-next">
        <small>Next step</small>
        <strong>${esc(next.title)}</strong>
        <p>${esc(next.text)}</p>
        ${job.can_edit ? '<button type="button" class="tk-btn tk-btn--light" data-edit-job>Edit job</button>' : canDo('jobs.send') ? '<button type="button" class="tk-btn tk-btn--light" data-update-job>Send update</button>' : ''}
      </section>

      <section class="tk-sec" id="ppPhotos">
        <h3>Photos${photos.length ? ` <small>${photos.length}</small>` : ''}</h3>
        ${photos.length ? photoGrid(photos) : '<p class="tk-empty">No photos shared yet. Before, during and after photos show up here.</p>'}
        ${photos.length > 9 ? '<a class="pp-link" href="#documents" style="font-size:14px">See all</a>' : ''}
      </section>

      ${canDo('money.view') ? `<section class="tk-sec" id="tkInv">
        <h3>Invoices</h3>
        ${invoices.length ? `<ul class="tk-list">${invoices.map((inv) => { const st = invoiceState(inv); return `<li><a href="#invoices/${encodeURIComponent(inv.id)}" class="tk-row"><span>${esc(inv.number || 'Invoice')}<small class="${['overdue', 'soon'].includes(st.key) ? 'pp-late' : ''}">${esc(st.label)}</small></span><b>${money(st.key === 'paid' ? inv.amount : inv.balance)}</b></a></li>`; }).join('')}</ul>` : '<p class="tk-empty">No invoices for this job yet.</p>'}
      </section>` : ''}

      ${docs.length ? `<section class="tk-sec" id="tkDocs"><h3>Documents</h3><ul class="tk-list">${docs.map((d) => `<li><a href="${esc(d.file_url)}" target="_blank" rel="noopener" class="tk-row"><span>${esc(d.title)}<small>${d.type === 'report' ? 'Report' : d.type === 'sent' ? 'You sent' : 'File'}</small></span><b>Open</b></a></li>`).join('')}</ul></section>` : ''}

      ${requests.length ? `<section class="tk-sec"><h3>Your requests</h3>${requests.map((r) => `<div class="pp-req" style="padding:8px 0"><div class="pp-req-top"><strong>${esc(r.title)}</strong>${requestStatus(r)}</div><p>${esc(fmtDay(r.created_at))}</p>${r.review_note ? `<p class="pp-reply">${esc(r.review_note)}</p>` : ''}</div>`).join('')}</section>` : ''}

      ${office ? `<section class="tk-sec"><h3>Questions? Contact ${esc(office.name)}</h3><p class="tk-sub" style="margin:0 0 10px">${esc(office.phone)}</p><div class="tk-two"><a class="tk-btn" href="tel:+${esc(office.digits)}">${ICON.phone}Call</a><a class="tk-btn" href="https://wa.me/${esc(office.digits)}?text=${encodeURIComponent(`Hi, about job${job.number ? ` #${job.number}` : ''} (${job.title || ''}): `)}" target="_blank" rel="noopener">WhatsApp</a></div></section>` : ''}`;

    return `<div class="tk" id="ppTicket">
        <div class="tk-print-head">${esc(providerName())} · Job ticket${job.number ? ` #${esc(job.number)}` : ''}</div>
        <div class="tk-col">${work}</div>
        <div class="tk-col tk-col--side">${side}</div>
      </div>
      <div class="pp-fixbar">${job.can_edit ? '<button type="button" class="pp-btn pp-btn--sec" data-edit-job>Edit job</button>' : '<a class="pp-btn pp-btn--sec" href="#ppPhotos">Photos</a>'}${canDo('jobs.send') ? '<button type="button" class="pp-btn pp-btn--pri" data-update-job>Send update</button>' : '<a class="pp-btn pp-btn--sec" href="#documents">Photos & docs</a>'}</div>`;
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
    view.querySelectorAll('[data-tk-go]').forEach((b) => b.addEventListener('click', () => { const el = document.getElementById(b.getAttribute('data-tk-go')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else b.disabled = true; }));
    view.querySelectorAll('[data-update-job]').forEach((b) => b.addEventListener('click', () => {
      state.send = newSend();
      state.send.presetJob = { id: data.job.id, number: data.job.number, title: data.job.title, address: data.job.address };
      if (data._co) state.send.co = data._co;
      location.hash = '#send';
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
      ['Overdue', list.filter((x) => x.st.key === 'overdue')],
      ['Due in 7 days', list.filter((x) => x.st.key === 'soon')],
      ['Open', list.filter((x) => x.st.key === 'open')],
      ['Paid', list.filter((x) => x.st.key === 'paid')],
    ].filter(([, rows]) => rows.length);
    const firstId = groups[0] && groups[0][1][0] && groups[0][1][0].inv.id;
    const selectedId = id || (window.matchMedia('(max-width: 1023px)').matches ? '' : firstId || '');
    const selected = withState.find((x) => x.inv.id === selectedId);
    const filterBtn = (key, label, rows) => `<button type="button" class="pp-stage" data-inv-filter="${key}" aria-pressed="${state.invoiceFilter === key}">${esc(label)} · ${rows.length}<b>${moneyShort(sum(rows.map ? rows : []))}</b></button>`;
    const totalOf = (rows) => rows.reduce((s, x) => s + Number(x.inv.amount || 0), 0);

    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder ? (state.coFilter && coById(state.coFilter) ? coById(state.coFilter).company_name : state.builder.account.name) : providerName())}</p><h1>Invoices</h1></div></div>
      <div class="pp-stages" role="group" aria-label="Status">
        ${filterBtn('open', 'Open', open)}
        ${filterBtn('overdue', 'Overdue', overdue)}
        <button type="button" class="pp-stage" data-inv-filter="paid" aria-pressed="${state.invoiceFilter === 'paid'}">Paid · ${withState.filter((x) => x.st.key === 'paid').length}<b>${moneyShort(totalOf(withState.filter((x) => x.st.key === 'paid')))}</b></button>
        <button type="button" class="pp-stage" data-inv-filter="all" aria-pressed="${state.invoiceFilter === 'all'}">All · ${all.length}<b>${moneyShort(totalOf(withState))}</b></button>
      </div>
      <div class="pp-split pp-split--list ${id ? 'is-open' : ''}">
        <aside class="pp-card pp-side" aria-label="Invoice list">
          <div class="pp-side-search"><label>${icon('search')}<span class="pp-sr">Search invoices</span><input id="ppInvSearch" type="search" placeholder="#, address or job" value="${esc(state.q)}" /></label></div>
          ${groups.length ? groups.map(([label, rows]) => `<div class="pp-group">${esc(label)} · ${rows.length}</div>${rows.map((x) => `<button type="button" class="pp-row" data-inv="${esc(x.inv.id)}" aria-current="${x.inv.id === selectedId}"><span class="pp-row-main">${coLine(x.inv)}<span class="pp-row-top"><strong>${esc(invoiceRef(x.inv))}</strong><span style="color:var(--pp-ink);font-weight:600">${money(x.st.key === 'paid' ? x.inv.amount : x.inv.balance)}</span></span><span class="pp-row-sub">${esc(x.inv.number || 'Invoice')}${x.inv.job && x.inv.job.number ? ` · Job #${esc(x.inv.job.number)}` : ''}</span><span class="pp-row-next ${['overdue', 'soon'].includes(x.st.key) ? 'pp-late' : ''}">${esc(x.st.label)}</span></span></button>`).join('')}`).join('') : `<div class="pp-empty"><strong>${all.length ? 'Nothing in this list' : 'No invoices yet'}</strong>${all.length ? 'Change the filter or the search.' : 'Invoices from your flooring companies show up here.'}</div>`}
        </aside>
        <section class="pp-main" aria-label="Invoice">${selected ? invoiceDetailHtml(selected.inv, selected.st) : '<div class="pp-card pp-empty"><strong>Pick an invoice</strong>Its details show up here.</div>'}</section>
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
    const steps = ['Issued', 'Due', 'Paid'];
    const idx = paid ? 2 : 1;
    const labels = [fmtDay(inv.issued_at), inv.due_date ? fmtDay(dateOnly(inv.due_date)) : '', inv.paid_at ? fmtDay(inv.paid_at) : ''];
    const next = paid
      ? { title: `Paid${inv.paid_at ? ` on ${fmtDay(inv.paid_at)}` : ''}`, text: 'Thank you! The receipt is on the invoice.' }
      : st.key === 'overdue'
        ? { title: `Pay ${money(inv.balance)}`, text: `${st.label}. Open the invoice to see how to pay.` }
        : { title: `Pay ${money(inv.balance)}${inv.due_date ? ` by ${fmtDay(dateOnly(inv.due_date))}` : ''}`, text: 'Open the invoice to see how to pay.' };
    return `
      <div class="pp-card pp-detail-head">
        <button type="button" class="pp-back" data-back="#invoices">${icon('back')}Invoices</button>
        <div class="pp-chips">${st.chip}${job.number ? `<span class="pp-chip">Job #${esc(job.number)}</span>` : ''}</div>
        <div class="pp-detail-title">
          <div><h2>${esc(inv.number || 'Invoice')} · ${money(inv.amount)}</h2><p>${esc(invoiceRef(inv))}${job.address && job.address !== invoiceRef(inv) ? ` · ${esc(job.address)}` : ''}</p></div>
          <div class="pp-head-actions">${job.id ? `<a class="pp-btn pp-btn--sec" href="#jobs/${encodeURIComponent(job.id)}">Open job</a>` : ''}${inv.invoice_url ? `<a class="pp-btn pp-btn--pri" href="${esc(inv.invoice_url)}" target="_blank" rel="noopener">Open invoice</a>` : ''}</div>
        </div>
        <div>${barsWithLabels(idx, steps, paid, labels)}</div>
      </div>
      <div class="pp-cols">
        <div class="pp-col-main">
          <div class="pp-card pp-block">
            <h3>Summary</h3>
            <dl class="pp-dl">
              <dt>Amount</dt><dd>${money(inv.amount)}</dd>
              <dt>Paid</dt><dd>${money(inv.paid_amount)}</dd>
              <dt style="color:var(--pp-ink);font-weight:600">Balance</dt><dd style="font-weight:700">${money(inv.balance)}</dd>
              <dt>Issued</dt><dd>${esc(fmtDay(inv.issued_at, { month: 'short', day: 'numeric', year: 'numeric' }) || '—')}</dd>
              <dt>Due</dt><dd>${inv.due_date ? esc(fmtDay(dateOnly(inv.due_date), { month: 'short', day: 'numeric', year: 'numeric' })) : '—'}</dd>
            </dl>
          </div>
        </div>
        <div class="pp-col-side">
          <div class="pp-card pp-block pp-next"><span class="pp-lbl">Next step</span><strong>${esc(next.title)}</strong><p>${esc(next.text)}</p>${inv.invoice_url ? `<div><a class="pp-btn pp-btn--light" href="${esc(inv.invoice_url)}" target="_blank" rel="noopener">Open invoice</a></div>` : ''}</div>
        </div>
      </div>
      <div class="pp-fixbar">${job.id ? `<a class="pp-btn pp-btn--sec" href="#jobs/${encodeURIComponent(job.id)}">Open job</a>` : '<span></span>'}${inv.invoice_url ? `<a class="pp-btn pp-btn--pri" href="${esc(inv.invoice_url)}" target="_blank" rel="noopener">Open invoice</a>` : ''}</div>`;
  }

  /* ─────────────────────────── calendar ─────────────────────────── */

  function renderCalendar() {
    const month = state.calMonth;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = first.getDay();
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const today = dateKey(new Date());
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dateKey(d);
      const jobs = jobsInDay(key);
      const cls = ['pp-cal-day', d.getMonth() !== month.getMonth() ? 'is-out' : '', key === today ? 'is-today' : '', key === state.calDay ? 'is-sel' : '', jobs.length ? 'has-ev' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-day="${key}" aria-label="${esc(fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' }))}${jobs.length ? `, ${plural(jobs.length, 'job', 'jobs')}` : ''}" aria-pressed="${key === state.calDay}"><span class="pp-cal-num">${d.getDate()}</span>${jobs.slice(0, 2).map((j) => `<span class="pp-cal-ev">${esc(j.title || 'Job')}</span>`).join('')}${jobs.length > 2 ? `<span class="pp-cal-more">+${jobs.length - 2}</span>` : ''}</button>`;
    }).join('');
    const sel = jobsInDay(state.calDay).sort((a, b) => toDate(a.scheduledStart) - toDate(b.scheduledStart));
    const selDate = new Date(`${state.calDay}T12:00:00`);
    const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month);
    const phone = window.matchMedia('(max-width: 1023px)').matches;
    const mode = state.calMode || (phone ? 'list' : 'month');
    const seg = `<div class="pp-seg pp-cal-mode" role="group" aria-label="View"><button type="button" data-calmode="list" aria-pressed="${mode === 'list'}">List</button><button type="button" data-calmode="month" aria-pressed="${mode === 'month'}">Month</button></div>`;
    const eyebrow = state.builder ? state.builder.account.name : providerName();
    if (mode === 'list') {
      // Agenda: the next 45 days that have jobs, grouped by day (phone friendly).
      const base = startOfDay(new Date());
      const groups = [];
      for (let i = -1; i < 45; i++) {
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
        const jobs = jobsInDay(dateKey(d)).sort((a, b) => toDate(a.scheduledStart) - toDate(b.scheduledStart));
        if (jobs.length) groups.push({ d, jobs, today: i === 0 });
      }
      view.innerHTML = `
        <div class="pp-head"><div><p class="pp-eyebrow">${esc(eyebrow)}</p><h1>Calendar</h1></div><div class="pp-head-actions">${seg}</div></div>
        <div class="pp-agenda">${groups.length ? groups.map((g) => `<section class="pp-agenda-day ${g.today ? 'is-today' : ''}">
            <div class="pp-agenda-date"><b>${esc(fmtDay(g.d, { day: 'numeric' }))}</b><span>${esc(g.today ? 'Today' : fmtDay(g.d, { weekday: 'short' }))}</span><small>${esc(fmtDay(g.d, { month: 'short' }))}</small></div>
            <div class="pp-card pp-agenda-jobs">${g.jobs.map((j) => `<button type="button" class="pp-row" data-job="${esc(j.id)}"><span class="pp-row-main">${coLine(j)}<span class="pp-row-top"><strong>${esc(j.title || 'Job')}</strong><span>${j.allDay ? 'All day' : esc(fmtTime(j.scheduledStart))}</span></span><span class="pp-row-sub">${esc(j.address || '')}</span><span class="pp-row-next">${jobChip(j)}</span></span></button>`).join('')}</div>
          </section>`).join('') : `<div class="pp-card pp-empty">${mate('sleeping')}<strong>Nothing scheduled</strong>Jobs show up here when the company schedules them.</div>`}</div>`;
      view.querySelectorAll('[data-calmode]').forEach((b) => b.addEventListener('click', () => { state.calMode = b.getAttribute('data-calmode'); renderCalendar(); }));
      view.querySelectorAll('[data-job]').forEach((b) => b.addEventListener('click', () => { location.hash = `#jobs/${encodeURIComponent(b.getAttribute('data-job'))}`; }));
      return;
    }
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(eyebrow)}</p><h1>Calendar</h1></div><div class="pp-head-actions">${seg}</div></div>
      <div class="pp-split">
        <section class="pp-card pp-cal pp-main" aria-label="Month">
          <div class="pp-cal-head"><strong>${esc(monthLabel)}</strong><div class="pp-cal-ctrl"><button type="button" class="pp-ibtn" data-month="prev" aria-label="Previous month">‹</button><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-month="today">Today</button><button type="button" class="pp-ibtn" data-month="next" aria-label="Next month">›</button></div></div>
          <div class="pp-cal-grid">${weekdays.map((w) => `<div class="pp-cal-wd">${w}</div>`).join('')}${days}</div>
        </section>
        <aside class="pp-card pp-side" aria-label="Selected day" style="max-width:420px">
          <div style="padding:16px 16px 4px"><p class="pp-eyebrow" style="text-transform:capitalize">${esc(fmtDay(selDate, { weekday: 'long' }))}</p><h2 style="margin:0;font-size:22px">${esc(fmtDay(selDate, { month: 'long', day: 'numeric' }))}</h2><p class="pp-muted" style="margin:4px 0 0;font-size:14px">${sel.length ? plural(sel.length, 'job', 'jobs') : 'No jobs this day'}</p></div>
          ${sel.map((j) => `<button type="button" class="pp-row" data-job="${esc(j.id)}"><span class="pp-row-main">${coLine(j)}<span class="pp-row-top"><strong>${esc(j.title || 'Job')}</strong><span>${j.allDay ? 'All day' : esc(fmtTime(j.scheduledStart))}</span></span><span class="pp-row-sub">${esc(j.address || '')}</span><span class="pp-row-next">${jobChip(j)}</span></span></button>`).join('')}
          <div style="padding:12px 16px 16px"><a class="pp-btn pp-btn--sec pp-btn--sm" href="#send">Send work</a></div>
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
    view.querySelectorAll('[data-calmode]').forEach((b) => b.addEventListener('click', () => { state.calMode = b.getAttribute('data-calmode'); renderCalendar(); }));
    view.querySelectorAll('[data-job]').forEach((b) => b.addEventListener('click', () => { location.hash = `#jobs/${encodeURIComponent(b.getAttribute('data-job'))}`; }));
  }

  /* ─────────────────────────── send work ─────────────────────────── */

  const FIELD_LABELS = {
    address: 'Job address', title: 'Job title', community: 'Community', lot: 'Lot', plan: 'Plan',
    external_ref: 'Your job # / PO', service_type: 'Service', preferred_date: 'Job date', square_feet: 'Area (sq ft)',
    material: 'Material', contact_name: 'On-site contact', contact_phone: 'Phone', contact_email: 'E-mail', notes: 'Notes for the crew',
  };
  const FIELD_ORDER = ['address', 'title', 'community', 'lot', 'plan', 'external_ref', 'service_type', 'preferred_date', 'pickup', 'square_feet', 'material', 'contact_name', 'contact_phone', 'contact_email', 'notes'];
  FIELD_LABELS.pickup = 'Material pickup (where to pick up)';

  function newSend() {
    return { phase: 'pick', files: [], text: '', showPaste: false, fields: null, items: [], laborTotal: null, check: [], warnings: [], match: null, mode: 'new', ai: false, model: '', error: '', presetJob: null, sent: null };
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
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
      if (s.files.length >= MAX_FILES) { s.error = `Send up to ${MAX_FILES} files at a time.`; break; }
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) { s.error = `${file.name}: use PDF, JPG, PNG or WebP.`; continue; }
      const small = await compressImage(file);
      const dataUrl = small ? small.dataUrl : await readAsDataUrl(file);
      const entry = { name: small ? small.name : file.name, type: small ? small.type : file.type, size: small ? small.size : file.size, dataUrl };
      entry.url = URL.createObjectURL(small ? dataUrlToBlob(dataUrl) : file);
      s.files.push(entry);
    }
    const total = s.files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_BYTES) s.error = 'The files add up to more than 10 MB. Remove one or send them in parts.';
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
    if (location.hash !== '#send') location.hash = '#send';
    else render();
    if (!state.send.error) readWithAi();
  }

  async function readWithAi(opts) {
    const s = state.send;
    if (!s.files.length && !s.text.trim()) { s.error = 'Pick a file or paste the text of the order.'; return renderSendBody(); }
    if (s.files.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) return renderSendBody();
    if (opts && opts.merge && s.fromMeas) {
      // keep the measurement's address, floor lines and prices; take what the paper adds (PO #, date, pickup, contact…)
      const btn = $('ppMergeRead'); if (btn) { btn.disabled = true; btn.textContent = 'Mate is reading…'; }
      try {
        const r = await postJson(companyInvited() ? '/api/builder/read' : '/api/partner-portal/requests/read', { text: s.text, files: s.files.map((f) => ({ name: f.name, data_url: f.dataUrl })) }, state.builder && !companyInvited() ? sendCo().id : undefined);
        const data = r.data || {};
        const got = data.fields || {};
        let n = 0;
        FIELD_ORDER.forEach((k) => {
          const v = String(got[k] || '').trim();
          if (!v || k === 'address' && s.fields.address) return;
          if (!String(s.fields[k] || '').trim() || k === 'external_ref' || k === 'preferred_date' || k === 'pickup' || k === 'title') { s.fields[k] = v; n++; }
        });
        if (data.pickup_match && data.pickup_match.text) { s.pickupMatch = data.pickup_match; s.fields.pickup = data.pickup_match.text; }
        if (!s.items.length && Array.isArray(data.items)) s.items = data.items.map((it) => ({ ...it, create_service: true, remove: false }));
        if (Array.isArray(data.catalog) && data.catalog.length) s.catalog = data.catalog;
        if (data.match && !s.match) { s.match = data.match; s.mode = 'update'; }
        s.mergedRead = true;
        s.warnings = n ? [] : ['Mate didn’t find more details in that file. It still goes with the job.'];
        mateToast('reading', n ? `Mate filled in ${plural(n, 'field', 'fields')}` : 'Nothing new in that file', n ? 'Your floor lines and prices stay as they were.' : '');
      } catch (err) {
        s.warnings = [`${err.message || 'Could not read the file.'} It still goes with the job.`];
      }
      return renderSendBody();
    }
    s.phase = 'reading';
    s.error = '';
    renderSendBody();
    try {
      const r = await postJson(companyInvited() ? '/api/builder/read' : '/api/partner-portal/requests/read', { text: s.text, files: s.files.map((f) => ({ name: f.name, data_url: f.dataUrl })) }, state.builder && !companyInvited() ? sendCo().id : undefined);
      const data = r.data || {};
      if (!data.ai_available) {
        s.fields = emptyFields();
        s.ai = false;
        s.warnings = ['Automatic reading is not turned on for this company. Fill in the fields below.'];
      } else {
        s.fields = Object.assign(emptyFields(), data.fields || {});
        s.items = (data.items || []).map((it) => ({ ...it, create_service: true, remove: false }));
        if (state.builder && canDo('money.view') && sendCo()) {
          s.agreed = await api(`/api/builder/prices?company=${encodeURIComponent(sendCo().id)}`).then((x) => x.data || []).catch(() => []);
          applyAgreed(s);
        }
        s.catalog = data.catalog || [];
        s.orderStairs = Array.isArray(data.stairs) ? data.stairs : [];
        s.stairFinish = data.stair_finish || '';
        s.measurement = data.measurement || null;
        s.useMeasurement = Boolean(s.measurement && s.measurement.status !== 'used');
        s.pickupRaw = s.fields.pickup || '';
        s.pickupMatch = data.pickup_match || null;
        if (s.pickupMatch && s.pickupMatch.text) s.fields.pickup = s.pickupMatch.text;
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
      s.step = s.presetJob ? 'details' : 'measure';
      if (s.measurement && !s.measData) loadMeasData(s);
    } catch (err) {
      s.phase = 'review';
      s.step = 'details';
      s.fields = emptyFields();
      s.ai = false;
      if (s.presetJob) { s.match = s.presetJob; s.mode = 'update'; }
      s.warnings = [`${err.message || 'Could not read the file.'} Fill in the fields below — the file goes with the request.`];
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
      s.fields.title = `Update · ${s.presetJob.title || ''}`.slice(0, 160);
    }
    s.phase = 'review';
    s.step = 'details';
    renderSendBody();
  }

  async function renderSend(token) {
    if (!state.send) state.send = newSend();
    // back from adjusting the measurement: show its latest drawing and lines
    if (state.send.phase === 'review' && state.send.measurement && state.send.measurement.id && state.send.measLeft) { state.send.measLeft = false; state.send.measData = null; loadMeasData(state.send); }
    await Promise.all([loadRequests().catch(() => {}), ensurePickups()]);
    if (token !== renderToken) return;
    const target = sendCo();
    state.ctx = target;
    const allCos = (state.builder && state.builder.companies) || [];
    const canPick = state.builder && allCos.length > 1 && !state.send.presetJob && (state.send.phase === 'pick' || state.send.phase === 'review');
    const coCards = state.builder && target ? `<div class="pp-send-to">
        <span class="pp-send-to-lbl">Send to</span>
        ${coPickBtn(target, canPick ? 'data-send-copick aria-label="Send to: change company"' : 'disabled aria-disabled="true"')}
      </div>` : `<p class="pp-eyebrow">${state.builder ? 'To ' : ''}${esc(providerName())}</p>`;
    view.innerHTML = `
      <div class="pp-head pp-send-head">
        <div><h1>Send work</h1><p class="pp-muted pp-send-sub">A work order, a measurement or the plans — ${esc(providerName())} gets it as a job.</p></div>
        <ol class="pp-steps" id="ppSteps" aria-label="Steps"></ol>
      </div>
      ${coCards}
      <div class="pp-split pp-split--stack">
        <section class="pp-main" id="ppSendBody"></section>
        <aside class="pp-card pp-side" aria-labelledby="ppReqTitle" id="ppReqs"></aside>
      </div>`;
    const cp = view.querySelector('[data-send-copick]');
    if (cp) cp.addEventListener('click', () => openCoPicker('Send to', state.send.co || (target && target.id), async (id) => {
      const snd = state.send;
      snd.co = id;
      postJson('/api/builder/select', { company_id: id }).catch(() => {});
      if (snd.phase === 'review' && snd.fromMeas) {
        // the floor lines take the new company's prices
        try { const r = await api(`/api/builder/measurements/${encodeURIComponent(snd.fromMeas.id)}`); await sendFromMeasurement({ ...r.data, dirty: false }, true, id); return; } catch (_) { /* keep what is there */ }
      }
      renderSend(renderToken);
    }));
    renderSendBody();
    renderRequestsList();
  }

  function renderRequestsList() {
    const box = $('ppReqs');
    if (!box) return;
    if (companyInvited()) {
      api(`/api/builder/companies/${encodeURIComponent(sendCo().id)}/jobs`).then((r) => {
        const rows = r.data || [];
        box.innerHTML = `<div style="padding:16px 16px 8px"><h2 id="ppReqTitle" style="margin:0;font-size:17px">Held for ${esc(providerName())}</h2><p class="pp-muted" style="margin:2px 0 0;font-size:13px">They go into their system when they create their account.</p></div>
          ${rows.length ? rows.map((j) => `<div class="pp-req"><div class="pp-req-top"><strong>${esc(j.title)}</strong>${j.delivered_at ? '<span class="pp-chip pp-chip--ok">Delivered</span>' : '<span class="pp-chip">Held</span>'}</div><p>${esc(j.address)}</p><p>Held ${esc(fmtDay(j.created_at))}${j.files ? ` · ${plural(j.files, 'file', 'files')}` : ''}</p></div>`).join('') : '<div class="pp-empty" style="padding:20px 16px">No jobs held yet.</div>'}`;
      }).catch(() => { box.innerHTML = ''; });
      return;
    }
    const rows = state.requests;
    box.innerHTML = `<div style="padding:16px 16px 8px"><h2 id="ppReqTitle" style="margin:0;font-size:17px">Your requests</h2><p class="pp-muted" style="margin:2px 0 0;font-size:13px">${rows.filter((r) => r.status === 'pending').length} waiting for the company</p></div>
      ${rows.length ? rows.slice(0, 30).map((r) => `<div class="pp-req">
        <div class="pp-req-top"><strong>${esc(r.title)}</strong>${requestStatus(r)}</div>
        <p>${esc(r.address)}${r.external_ref ? ` · your # ${esc(r.external_ref)}` : ''}</p>
        <p>Sent ${esc(fmtDay(r.created_at))}${r.preferred_date ? ` · for ${esc(fmtDay(dateOnly(r.preferred_date)))}` : ''}${r.read_by_ai ? ' · read by AI' : ''}${r.target_job_id ? ' · job update' : ''}</p>
        ${r.review_note ? `<p class="pp-reply">${esc(r.review_note)}</p>` : ''}
        ${r.job_id ? `<p><a class="pp-link" href="#jobs/${encodeURIComponent(r.job_id)}">Open job</a></p>` : ''}
      </div>`).join('') : '<div class="pp-empty" style="padding:20px 16px">You haven’t sent any requests yet.</div>'}`;
  }

  const WZ_STEPS = [['pick', 'Work order'], ['measure', 'Measure'], ['quote', 'Quote'], ['details', 'Send'], ['done', 'Track']];
  function stepsHtml(phase) {
    const s = state.send || {};
    const key = phase === 'review' ? (s.step || 'measure') : phase === 'reading' ? 'pick' : phase;
    const idx = Math.max(0, WZ_STEPS.findIndex(([k]) => k === key));
    const canJump = phase === 'review';
    return WZ_STEPS.map(([k, label], i) => {
      const cls = i === idx ? 'on' : i < idx ? 'done' : '';
      const jump = canJump && i >= 1 && i <= 3 && i !== idx;
      return `<li class="${cls}">${jump ? `<button type="button" data-wz-go="${k}">` : '<span>'}<b>${i + 1}</b>${esc(label)}${jump ? '</button>' : '</span>'}</li>`;
    }).join('');
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
        <div style="display:flex;gap:12px;align-items:center"><span class="pp-doc-ico" style="width:44px;height:44px">${s.files[0] && s.files[0].type === 'application/pdf' ? 'PDF' : s.files.length ? 'IMG' : 'TXT'}</span><div><strong>${esc(s.files.length ? s.files.map((f) => f.name).join(', ') : 'Pasted text')}</strong><div class="pp-muted" style="font-size:13px">Reading the address, job #, date and service lines…</div></div></div>
        <div class="pp-progress"><i></i></div>
        <p class="pp-muted" style="margin:0;font-size:14px">It takes a few seconds. Nothing is sent before you check it.</p>
      </div>`;
      return;
    }

    if (s.phase === 'done') {
      const sent = s.sent || {};
      const updated = sent.update;
      const title = sent.kept ? 'Job held' : sent.direct ? (updated ? 'Job updated' : 'Job created') : (updated ? 'Update sent' : 'Request sent');
      const text = sent.kept
        ? `${esc(providerName())} isn’t on ObraMate yet. The job is held and goes into their system as soon as they create their account from your invite.`
        : sent.direct
          ? `${updated ? 'The change is already' : 'The job is already'} in ${esc(providerName())}’s system, and their office was notified.`
          : `${esc(providerName())} checks it and replies here. ${updated ? 'It stays the same job, with its photos and invoices together.' : 'Once they accept it, the job shows up in Jobs.'}`;
      const track = [
        ['Sent', 'Work order, measurement and quote', 'done'],
        [sent.direct ? 'Created in their system' : 'Approved & scheduled', sent.direct ? 'They set the date next' : `${esc(providerName())} approves it and picks the date`, sent.direct ? 'done' : 'now'],
        ['On site', 'Photos of the work as the crew shares them', ''],
        ['Completed', 'Photos, report and invoice', ''],
      ];
      box.innerHTML = `<div class="pp-card pp-reading pp-track">
        <img class="pp-mate-art" src="/assets/img/mascot/mate-thumbs.webp?v=20261027-m2" alt="" height="96" decoding="async">
        <h2 style="margin:0;font-size:24px">${title}</h2>
        <p class="pp-muted" style="margin:0">${text}</p>
        ${sent.kept ? '' : `<ol class="pp-track-line">${track.map(([t, d, st]) => `<li class="${st}"><i aria-hidden="true">${st === 'done' ? icon('check') : ''}</i><div><strong>${esc(t)}</strong><small>${d}</small></div></li>`).join('')}</ol>
        <div class="pp-track-push" id="ppTrackPush"></div>`}
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="pp-btn pp-btn--pri" id="ppSendAnother">Send another</button>${sent.jobId ? `<a class="pp-btn pp-btn--sec" href="#jobs/${encodeURIComponent(sent.jobId)}">Open job</a>` : sent.kept ? '<a class="pp-btn pp-btn--sec" href="#companies">View companies</a>' : '<a class="pp-btn pp-btn--sec" href="#notifications">Notifications</a>'}</div>
      </div>`;
      $('ppSendAnother').addEventListener('click', () => { state.send = newSend(); renderSendBody(); });
      pushState().then((ps) => {
        const el = $('ppTrackPush');
        if (!el || ps === 'on' || ps === 'unsupported' || ps === 'denied') return;
        el.innerHTML = `<span>${icon('chat')}Get a push on this phone when they approve, schedule and send photos.</span><button type="button" class="pp-btn pp-btn--sec pp-btn--sm">Turn on</button>`;
        el.querySelector('button').addEventListener('click', async (e) => { e.currentTarget.disabled = true; try { await enablePush(); el.innerHTML = `<span>${icon('check')}Push is on for this device.</span>`; } catch (er) { el.innerHTML = `<span class="pp-late">${esc(er.message)}</span>`; } });
      });
      return;
    }

    if (s.phase === 'review') {
      if (!s.step) s.step = 'measure';
      box.innerHTML = reviewHtml(s);
      bindReview();
      bindWizard();
      return;
    }

    const files = s.files.map((f, i) => `<span class="pp-file">${esc(f.name)} · ${fileSize(f.size)}<button type="button" data-remove="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('');
    if (state.builder && !sendCo()) {
      box.innerHTML = '<div class="pp-card pp-empty">' + mate('wave') + '<strong>Pick a company</strong>Connect or invite your flooring company to send jobs.<div style="margin-top:12px"><a class="pp-btn pp-btn--pri" href="#companies">Companies</a></div></div>';
      return;
    }
    if (!canDo('jobs.send')) {
      box.innerHTML = '<div class="pp-card pp-empty"><strong>Your role can’t send jobs</strong>Ask someone in the office or your team admin.</div>';
      return;
    }
    const ready = state.builder && canDo('measure') ? (state.homeMeas || []).filter((m) => m.status !== 'used' && ((m.counts || {}).floor_sf || (m.counts || {}).treads || (m.counts || {}).vents)).slice(0, 4) : [];
    box.innerHTML = `
      ${companyInvited() ? `<div class="pp-match"><strong>${esc(providerName())} isn’t on ObraMate yet</strong><span class="pp-muted" style="font-size:14px">The job is held and goes into their system as soon as they create their account from your invite.</span></div>` : ''}
      ${s.presetJob ? `<div class="pp-match"><strong>Update to ${esc(s.presetJob.title || 'job')}</strong><span class="pp-muted" style="font-size:14px">${esc(s.presetJob.address || '')} · send the new order, photo or text. It goes with this job.</span></div>` : ''}
      <div class="pp-send-ways">
        <section class="pp-card pp-send-way pp-send-way--wo">
          <div class="pp-send-way-head"><span class="pp-send-way-ic">${icon('upload')}</span><div><h2>Upload the work order</h2><p>PDF, photo or screenshot of your system. ${state.builder && state.builder.ai_reader ? 'Mate reads the address, date, pickup and services.' : 'You fill in the details next.'}</p></div></div>
          <button type="button" class="pp-bigdrop" id="ppBigDrop">
            ${state.builder && state.builder.ai_reader ? mate('snap', 72) : icon('upload')}
            <strong><span class="pp-hide-phone">Drop files here or click to choose</span><span class="pp-only-phone">Choose a file</span></strong>
            <span>Work order, PO, schedule, plans · up to 5 files, 10 MB</span>
          </button>
          ${files ? `<div class="pp-files">${files}</div>` : ''}
          ${s.showPaste ? `<div class="pp-paste pp-field"><label for="ppPaste">Paste the text of the e-mail or your system</label><textarea id="ppPaste" maxlength="20000" placeholder="e.g. Job# 172369 · 109 Evergreen Dr · Install - Hardwood · Monday, October 26th…">${esc(s.text)}</textarea></div>` : ''}
          ${s.error ? `<p class="pp-error" role="alert">${esc(s.error)}</p>` : ''}
          ${s.files.length || (s.showPaste && s.text.trim()) ? `<div class="pp-send-go"><button type="button" class="pp-btn pp-btn--sec" id="ppManual2">Fill in by hand</button><button type="button" class="pp-btn pp-btn--pri" id="ppRead">${state.builder && state.builder.ai_reader ? 'Read and fill in' : 'Continue'}</button></div>` : ''}
          <div class="pp-send-alt">
            <button type="button" class="pp-source" id="ppCam">${icon('camera')}<span>Take a photo</span></button>
            <button type="button" class="pp-source" id="ppPasteBtn">${icon('text')}<span>Paste text</span></button>
            <button type="button" class="pp-source" id="ppManual">${icon('pen')}<span>Fill in by hand</span></button>
          </div>
        </section>
        ${state.builder && canDo('measure') && !s.presetJob ? `<section class="pp-card pp-send-way pp-send-way--meas">
          <div class="pp-send-way-head"><span class="pp-send-way-ic pp-send-way-ic--olive">${icon('ruler')}</span><div><h2>From a measurement</h2><p>Floors from the plans, stairs or vents you measured. The lines, totals, PDF and plans go with the job.</p></div></div>
          ${ready.length ? `<div class="pp-send-meas">${ready.map((m) => `<button type="button" class="pp-send-mrow" data-send-meas="${esc(m.id)}"><span class="pp-mcard-ic" aria-hidden="true">${icon('ruler')}</span><span><strong>${esc(m.address)}</strong><small>${esc(countsText(m.counts || {}))}</small></span><span class="pp-send-mgo">Use ${icon('chev')}</span></button>`).join('')}</div>` : `<p class="pp-muted pp-send-none">No measurements ready to send.</p>`}
          <div class="pp-send-alt"><a class="pp-source" href="#measurements">${icon('ruler')}<span>All measurements</span></a><button type="button" class="pp-source" data-send-plans>${icon('upload')}<span>Measure from plans</span></button></div>
        </section>` : ''}
      </div>`;
    box.querySelectorAll('[data-send-meas]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api(`/api/builder/measurements/${encodeURIComponent(b.getAttribute('data-send-meas'))}`); await sendFromMeasurement({ ...r.data, dirty: false }, true); } catch (ex) { b.disabled = false; mateToast('head-curious', 'Could not open it', ex.message); }
    }));
    const plansBtn = box.querySelector('[data-send-plans]');
    if (plansBtn) plansBtn.addEventListener('click', () => openPlanUpload());
    if (state.builder && canDo('measure') && !state.homeMeas && !s._measLoaded) {
      s._measLoaded = true;
      api('/api/builder/measurements').then((r) => { state.homeMeas = r.data || []; if (state.send === s && s.phase === 'pick') renderSendBody(); }).catch(() => {});
    }
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
      const tag = s.ai && f[key] ? (isCheck ? '<span class="pp-tag-check">Check</span>' : '<span class="pp-tag-ok">OK</span>') : (isCheck ? '<span class="pp-tag-check">Check</span>' : '');
      const req = o.required ? ' *' : '';
      const input = o.area
        ? `<textarea id="ppF-${key}" data-field="${key}" maxlength="${o.max || 5000}">${esc(f[key])}</textarea>`
        : `<input id="ppF-${key}" data-field="${key}" type="${o.type || 'text'}" ${key === 'address' ? 'data-om-address-autocomplete data-crm-address-autocomplete="1"' : ''} ${o.required ? 'required' : ''} maxlength="${o.max || 200}" value="${esc(f[key])}" ${o.auto ? `autocomplete="${o.auto}"` : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} />`;
      return `<div class="pp-field ${o.wide ? 'pp-field--wide' : ''} ${isCheck ? 'is-check' : ''}"><label for="ppF-${key}">${esc(FIELD_LABELS[key])}${req} ${tag}</label>${input}</div>`;
    };
    const match = s.match;
    const matchHtml = match ? `<div class="pp-match">
        <strong>${s.presetJob ? 'Update to this job' : match.reason === 'ref' ? `You already sent # ${esc(f.external_ref)}` : 'You already have a job at this address'}</strong>
        <span class="pp-muted" style="font-size:14px">${esc(match.title || 'Job')}${match.number ? ` · Job #${esc(match.number)}` : ''}${match.address && !String(match.title || '').toLowerCase().includes(String(match.address).toLowerCase()) ? ` · ${esc(match.address)}` : ''}. Updating keeps photos, messages and invoices together.</span>
        <div class="pp-seg" role="group" aria-label="What to do">
          <button type="button" data-mode="update" aria-pressed="${s.mode === 'update'}">Update this job</button>
          <button type="button" data-mode="new" aria-pressed="${s.mode === 'new'}">Create a new job</button>
        </div>
      </div>` : '';
    const top = `
      <div class="pp-card pp-wz-top">
        <div style="display:flex;gap:10px;align-items:center">${s.ai || s.fromMeas ? `<span class="pp-mateface" aria-hidden="true"><img src="/assets/img/mascot/mate-head-neutral.webp?v=20261027-m2" alt="" width="36" height="36"></span>` : ''}<div><strong style="font-size:17px">${esc(f.title || (s.fromMeas ? 'Work order from your measurement' : s.ai ? 'Work order read by Mate' : 'New work order'))}</strong><div class="pp-muted" style="font-size:14px">${esc(f.address || 'No address yet')}${f.external_ref ? ` · PO ${esc(f.external_ref)}` : ''}${s.ai && checked ? ` · <span class="pp-late">${plural(checked, 'field', 'fields')} to check</span>` : ''}</div></div></div>
        <button type="button" class="pp-link" id="ppRestart">${s.files.length || s.ai ? 'Change file' : 'Start over'}</button>
      </div>`;
    if (s.step === 'measure') return `${top}${measureStepHtml(s)}${wizardNav(s)}`;
    if (s.step === 'quote') return `${top}${quoteStepHtml(s)}${wizardNav(s)}`;
    return `${top}
      <div class="pp-cols">
        ${originalHtml(s)}
        <form class="pp-card pp-form" id="ppReqForm" novalidate>
          ${matchHtml}
          ${s.warnings.map((w) => `<p class="pp-warn">${esc(w)}</p>`).join('')}
          ${filesEditor(s)}
          <fieldset class="pp-fset"><legend>Job</legend><div class="pp-fields">
            ${field('address', { required: true, wide: true, max: 300, auto: 'street-address', ph: 'e.g. 109 Evergreen Dr, Denver, CO' })}
            ${field('title', { required: true, wide: true, max: 160, ph: 'e.g. Hardwood install · Lot 10' })}
            ${field('service_type', { max: 100, ph: 'e.g. Install – Hardwood' })}
            ${field('preferred_date', { type: 'date' })}
            ${field('external_ref', { max: 60, ph: 'Your PO or job #' })}
          </div></fieldset>
          <fieldset class="pp-fset"><legend>Site &amp; material</legend><div class="pp-fields">
            ${field('community', { max: 120 })}
            ${field('lot', { max: 20 })}
            ${field('plan', { max: 80 })}
            ${field('square_feet', { type: 'number' })}
            ${field('material', { wide: true, max: 120 })}
            ${field('pickup', { wide: true, max: 200 })}
            ${pickupRow(s)}
          </div></fieldset>
          <fieldset class="pp-fset"><legend>On-site contact</legend><div class="pp-fields">
            ${field('contact_name', { max: 120, auto: 'name' })}
            ${field('contact_phone', { type: 'tel', max: 40, auto: 'tel' })}
            ${field('contact_email', { type: 'email', max: 254, auto: 'email', wide: true })}
          </div></fieldset>
          <fieldset class="pp-fset"><legend>Notes for the crew</legend><div class="pp-fields">
            ${field('notes', { wide: true, area: true, max: 4000 })}
          </div></fieldset>
        </form>
      </div>
      ${sendSummaryHtml(s)}
      <div class="pp-card pp-q-send">
        <p class="pp-error" id="ppReqError" role="alert" hidden></p>
        <div class="pp-q-send-row">
          <button type="button" class="pp-btn pp-btn--sec" data-wz-go="quote">${icon('back')}Quote</button>
          <span class="pp-muted">${s.mode === 'update' && match ? 'The services go into the current job’s notes.' : `${esc(providerName())} approves it and picks the date — you get a notification.`}</span>
          <div class="pp-form-actions" style="border:0;padding:0;margin:0">
            <button type="button" class="pp-btn pp-btn--sec" id="ppDiscard">Discard</button>
            <button type="button" class="pp-btn pp-btn--pri" id="ppSubmit" data-submit>${icon('send')}${s.mode === 'update' && match ? 'Send update' : `Send to ${esc(providerName())}`}</button>
          </div>
        </div>
      </div>
      <div class="pp-fixbar"><button type="button" class="pp-btn pp-btn--sec" data-wz-go="quote">Back</button><button type="button" class="pp-btn pp-btn--pri" data-submit>${s.mode === 'update' && match ? 'Send update' : 'Send'}</button></div>`;
  }

  const UOMS = ['SF', 'LF', 'EA', 'STEP', 'SY', 'HR'];
  const UOM_FROM_UNIT = { sq_ft: 'SF', sqft: 'SF', square_feet: 'SF', linear_ft: 'LF', linear_feet: 'LF', lf: 'LF', unit: 'EA', units: 'EA', each: 'EA', piece: 'EA', fixed: 'EA', step: 'STEP', steps: 'STEP', sq_yd: 'SY', hour: 'HR' };
  function uomForUnit(unit) {
    return UOM_FROM_UNIT[String(unit || 'sq_ft').trim().toLowerCase().replace(/\s+/g, '_')] || 'EA';
  }
  const UOM_LABEL = { SF: 'sq ft', LF: 'lin ft', EA: 'ea', STEP: 'step', SY: 'sq yd', HR: 'hour' };
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
    return String(it.service_name || it.description || it.detail || 'Service').trim();
  }
  /** Order wording under the service name (what the builder's paper says). */
  function itemSub(it) {
    return [it.description, it.detail].map((x) => String(x || '').trim()).filter(Boolean).join(' · ');
  }
  const MODE_BADGE = {
    linked: '<span class="pp-q-badge pp-q-badge--ok">price list</span>',
    new: '<span class="pp-q-badge pp-q-badge--new">new in price list</span>',
    none: '<span class="pp-q-badge">this job only</span>',
  };

  /** The builder's own measurement for this address, sent with the job (PDF, photos, sizes). */
  function measurementBanner(s) {
    const m = s.measurement;
    if (!state.builder || !m) return '';
    const lines = (m.summary || []).slice(0, 8);
    return `<section class="pp-card pp-meas-hit ${s.useMeasurement ? 'is-on' : ''}" aria-labelledby="ppMeasHitT">
      <div class="pp-meas-hit-head">
        <div><span class="pp-lbl">Measurement found for this address</span><h3 id="ppMeasHitT">${esc(m.address)}</h3>
          <p class="pp-muted">${esc(countsText(m.counts || {}))} · measured by ${esc(m.measured_by || '—')} on ${esc(fmtDayEn(m.measured_at))}${m.status === 'used' ? ' · <span class="pp-late">already sent with another job</span>' : m.status === 'draft' ? ' · still in progress' : ''}</p></div>
        <a class="pp-btn pp-btn--sec pp-btn--sm" href="#measurements/${esc(m.id)}" target="_blank" rel="noopener">View measurement</a>
      </div>
      ${lines.length ? `<ul class="pp-meas-sum pp-meas-sum--compact">${lines.map((l) => `<li><span>${esc(l.text)}</span><em>${esc(l.qty)} ${esc(l.uom)}</em></li>`).join('')}${(m.summary || []).length > lines.length ? `<li class="pp-muted">+ ${(m.summary || []).length - lines.length} more</li>` : ''}</ul>` : ''}
      <label class="pp-meas-use"><input type="checkbox" id="ppUseMeas" ${s.useMeasurement ? 'checked' : ''} /> <span>Send this measurement with the job — PDF, photos and the sizes on the tread, riser, nosing and vent lines</span></label>
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
        <div class="pp-q-name" role="button" tabindex="0" data-it-edit="${i}" title="Edit service">
          <b>${esc(itemTitle(s, it))}</b>${it.remove ? '<span class="pp-q-badge">removed</span>' : MODE_BADGE[itemMode(it)]}
          ${itemSub(it) ? `<small>${esc(itemSub(it))}</small>` : ''}
          ${it.area ? `<small class="pp-q-area">${esc(it.area)}</small>` : ''}
          ${agreedChip(s, it)}
        </div>
        <label class="pp-q-qty"><span class="pp-q-lbl">Qty</span><input type="text" inputmode="decimal" data-it="${i}" data-k="quantity" value="${esc(it.quantity)}" aria-label="Quantity of ${esc(itemTitle(s, it))}" ${it.remove ? 'disabled' : ''} /></label>
        <label class="pp-q-unit"><span class="pp-q-lbl">Unit</span><select data-it="${i}" data-k="uom" aria-label="Unit" ${it.remove ? 'disabled' : ''}>${UOMS.concat(UOMS.includes(it.uom) ? [] : [it.uom]).map((u) => `<option value="${esc(u)}" ${u === it.uom ? 'selected' : ''}>${esc(UOM_LABEL[u] || u)}</option>`).join('')}</select></label>
        <label class="pp-q-rate"><span class="pp-q-lbl">Price</span><span class="pp-q-cur">$</span><input type="text" inputmode="decimal" data-it="${i}" data-k="rate" value="${it.rate == null ? '' : esc(Number(it.rate).toFixed(2))}" placeholder="—" aria-label="Price of ${esc(itemTitle(s, it))}" ${it.remove ? 'disabled' : ''} /></label>
        <span class="pp-q-total" data-it-total="${i}">${t == null ? '—' : money(t)}</span>
        <div class="pp-q-act">
          <button type="button" class="pp-q-ic" data-it-edit="${i}" aria-label="Edit ${esc(itemTitle(s, it))}" title="Edit">✎</button>
          <button type="button" class="pp-q-ic pp-q-ic--del" data-it-rm="${i}" aria-label="${it.remove ? 'Restore' : 'Remove'} ${esc(itemTitle(s, it))}" title="${it.remove ? 'Put back on the job' : 'Remove from the job'}">${it.remove ? '↺' : '×'}</button>
        </div>
        ${open ? itemPanel(s, it, i) : ''}
      </article>`;
    };
    return `<section class="pp-q pp-q--paper pp-field--wide" aria-labelledby="ppItemsTitle">
      <div class="pp-q-head">
        <h3 id="ppItemsTitle">Items · ${live.length}</h3>
        <span class="pp-muted">${live.length ? [counts.linked ? `${counts.linked} from price list` : '', counts.new ? `${counts.new} new` : '', counts.none ? `${counts.none} this job only` : ''].filter(Boolean).join(' · ') : 'Services become the job’s lines.'}</span>
      </div>
      ${items.length ? `<div class="pp-q-sechead"><span>Services</span><small id="ppItemsSec">Section total ${money(sum)}</small></div>
      <div class="pp-q-cols" aria-hidden="true"><span>Description</span><span class="r">Qty</span><span>Unit</span><span class="r">Rate</span><span class="r">Amount</span><span></span></div>
      <div class="pp-q-list" role="list">${items.map(row).join('')}</div>` : '<p class="pp-q-empty">No services read from this order.</p>'}
      <button type="button" class="pp-q-add" id="ppItemAdd">+ Add service</button>
      ${s.pickCatalog ? catalogSheet(s) : ''}
      <div class="pp-q-sum">
        <div><span>Subtotal</span><b id="ppItemsSum">${money(sum)}</b></div>
        ${s.laborTotal != null ? `<div class="${off ? 'pp-late' : ''}" id="ppItemsCheckRow"><span>Total on the order</span><b id="ppItemsCheck">${money(s.laborTotal)} ${off ? '· check' : '✓'}</b></div>` : ''}
        <div class="pp-q-grand"><span>Total</span><b id="ppItemsTotal">${money(sum)}</b></div>
      </div>
    </section>`;
  }

  /** The builder's agreed price for a line (Settings › Price lists), matched by service or name. */
  function agreedFor(s, it) {
    const list = s.agreed || [];
    if (!list.length) return null;
    const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (it.pricing_item_id) {
      const byId = list.find((p) => p.pricing_item_id === it.pricing_item_id);
      if (byId) return byId;
    }
    const names = [it.service_name, it.description, itemTitle(s, it)].map(norm).filter(Boolean);
    const exact = list.find((p) => names.includes(norm(p.name)));
    if (exact) return exact;
    // same kind of work in other words ("Stair refinishing" for "SITE FINISHED SAND/2 COAT TREADS")
    const text = `${it.service_name || ''} ${it.description || ''} ${it.detail || ''}`;
    const kind = serviceKindOf(text);
    if (kind === 'other') return null;
    const same = list.filter((p) => serviceKindOf(p.name) === kind);
    const wOf = (t) => Number((/\b(\d{2}(?:\.\d+)?)\s*(?:"|”|″|inch|in\b)/i.exec(String(t)) || [])[1] || 0);
    const w = wOf(text);
    return (w && same.find((p) => wOf(p.name) === w)) || (same.length === 1 ? same[0] : same.find((p) => !wOf(p.name)) || null);
  }
  function agreedChip(s, it) {
    if (it.remove) return '';
    const a = agreedFor(s, it);
    if (!a) return '';
    const rate = it.rate == null || it.rate === '' ? null : Number(it.rate);
    if (rate == null) return `<small class="pp-q-agreed">Your price ${money(a.price)} · <button type="button" class="pp-link" data-it-agreed="${s.items.indexOf(it)}">Use it</button></small>`;
    if (Math.abs(rate - a.price) < 0.005) return `<small class="pp-q-agreed is-ok">✓ Your agreed price</small>`;
    return `<small class="pp-q-agreed is-diff">Agreed ${money(a.price)}, order says ${money(rate)} · <button type="button" class="pp-link" data-it-agreed="${s.items.indexOf(it)}">Use ${money(a.price)}</button></small>`;
  }
  /** Lines without a price take the agreed one as soon as the order is read. */
  function applyAgreed(s) {
    (s.items || []).forEach((it) => {
      const a = agreedFor(s, it);
      if (a && (it.rate == null || it.rate === '' || Number(it.rate) === 0) && !it.remove) it.rate = a.price;
    });
  }

  /** Inline editor under a line (like the quote's item editor): which service, name, wording. */
  function itemPanel(s, it, i) {
    const mode = itemMode(it);
    const value = it.pricing_item_id || (mode === 'none' ? '__none' : '__new');
    return `<div class="pp-q-panel">
      <div class="pp-q-field pp-q-field--wide"><label for="ppItCat-${i}">Service in ${esc(providerName())}’s price list</label>
        <select id="ppItCat-${i}" data-it="${i}" data-k="catalog">
          <option value="__new" ${value === '__new' ? 'selected' : ''}>+ Create a new service in the price list</option>
          ${(s.catalog || []).map((c) => `<option value="${esc(c.id)}" ${c.id === value ? 'selected' : ''}>${esc(c.name)} · ${esc(unitLabel(c.unit))}</option>`).join('')}
          <option value="__none" ${value === '__none' ? 'selected' : ''}>Don’t add it (this job only)</option>
        </select>
        <span class="pp-q-help">${mode === 'linked' ? 'The job uses this service at the order’s price.' : mode === 'new' ? 'Added to the company’s price list with this line’s unit and price.' : 'The line goes on the job without becoming a price-list service.'}</span>
      </div>
      ${mode === 'new' ? `<div class="pp-q-field pp-q-field--wide"><label for="ppItName-${i}">New service name</label><input id="ppItName-${i}" data-it="${i}" data-k="service_name" value="${esc(it.service_name || it.description || '')}" maxlength="120" /></div>` : ''}
      <div class="pp-q-field"><label for="ppItDesc-${i}">Product / order description</label><input id="ppItDesc-${i}" data-it="${i}" data-k="description" value="${esc(it.description)}" maxlength="200" /></div>
      <div class="pp-q-field"><label for="ppItDet-${i}">Install detail</label><input id="ppItDet-${i}" data-it="${i}" data-k="detail" value="${esc(it.detail)}" maxlength="200" /></div>
      <div class="pp-q-field pp-q-field--wide"><label for="ppItArea-${i}">Rooms</label><input id="ppItArea-${i}" data-it="${i}" data-k="area" value="${esc(it.area)}" maxlength="200" /></div>
      <div class="pp-q-panel-actions"><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-it-done>Done</button></div>
    </div>`;
  }

  /** Catalog list to add a service (like the quote's "Adicionar serviço"). */
  function catalogSheet(s) {
    const q = String(s.catalogQuery || '').trim().toLowerCase();
    const list = (s.catalog || []).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 60);
    return `<div class="pp-q-sheet" role="dialog" aria-label="Add service">
      <div class="pp-q-sheet-head"><input id="ppCatSearch" type="search" placeholder="Search ${esc(providerName())}’s price list" value="${esc(s.catalogQuery || '')}" autocomplete="off" /><button type="button" class="pp-q-ic" id="ppCatClose" aria-label="Close">×</button></div>
      <div class="pp-q-sheet-list">
        ${list.map((c) => `<button type="button" class="pp-q-opt" data-cat-add="${esc(c.id)}"><span><b>${esc(c.name)}</b><small>${esc(unitLabel(c.unit))}${c.category ? ` · ${esc(({ installation: 'Installation', sand_finish: 'Sand & finish', supply: 'Supply', custom: 'Other' })[c.category] || c.category.replace(/_/g, ' '))}` : ''}</small></span>${c.price != null ? `<em>${money(c.price)}</em>` : ''}</button>`).join('') || '<p class="pp-q-empty">Nothing with that name in the price list.</p>'}
      </div>
      <button type="button" class="pp-q-opt pp-q-opt--free" id="ppCatFree"><span><b>+ Custom line</b><small>A service that isn’t in the price list</small></span></button>
    </div>`;
  }

  function bindItems() {
    const s = state.send;
    const refreshSum = () => {
      const live = s.items.filter((it) => !it.remove);
      const sum = Math.round(live.reduce((acc, it) => acc + (itemTotal(it) || 0), 0) * 100) / 100;
      const el = $('ppItemsSum');
      if (el) el.textContent = money(sum);
      ['ppItemsSec', 'ppItemsTotal'].forEach((k) => { const x = $(k); if (x) x.textContent = k === 'ppItemsSec' ? `Section total ${money(sum)}` : money(sum); });
      const chk = $('ppItemsCheck');
      if (chk && s.laborTotal != null) {
        const off = Math.abs(sum - s.laborTotal) > 0.5;
        $('ppItemsCheckRow').className = off ? 'pp-late' : '';
        chk.textContent = `${money(s.laborTotal)} ${off ? '· check' : '✓'}`;
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
    view.querySelectorAll('[data-it-agreed]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const it = s.items[Number(b.getAttribute('data-it-agreed'))];
      const ag = it && agreedFor(s, it);
      if (ag) { it.rate = ag.price; rerender(); }
    }));
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
      ? `<div class="pp-files">${s.files.map((f, i) => `<span class="pp-file">${esc(f.name)} · ${fileSize(f.size)}<button type="button" data-remove="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('')}</div>`
      : '<span class="pp-muted" style="font-size:14px">No files yet. PDF, JPG, PNG or WebP.</span>';
    const canRead = s.fromMeas && s.files.length && state.builder && state.builder.ai_reader && !s.mergedRead;
    return `<div class="pp-field pp-field--wide pp-attach ${s.fromMeas && !s.files.length ? 'is-invite' : ''}" id="ppFileBox">
      <span class="pp-attach-lbl">${s.fromMeas ? 'Your work order (optional)' : 'Attachments'}</span>
      ${s.fromMeas && !s.files.length ? '<span class="pp-muted" style="font-size:14px">Have the builder’s work order or PO? Add the PDF or a photo — it goes with the job, and Mate can read the PO #, date and pickup from it.</span>' : chips}
      ${s.fromMeas ? '<span class="pp-attach-auto">' + icon('check') + 'The measurement PDF' + (s.fromMeas.hasPlans ? ' and the plans' : '') + ' are attached automatically.</span>' : ''}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" id="ppAddFiles">${icon('upload')}Add files</button>
        <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" id="ppAddCamera">${icon('camera')}Take a photo</button>
        ${canRead ? `<button type="button" class="pp-btn pp-btn--pri pp-btn--sm" id="ppMergeRead">${icon('text')}Read it with Mate</button>` : ''}
      </div>
    </div>`;
  }

  /* Pickup: saved locations of the builder account, linked to the order by name/alias. */
  async function ensurePickups(force) {
    if (!state.builder) return [];
    if (state.pickups && !force) return state.pickups;
    try { state.pickups = (await api('/api/builder/pickups')).data || []; } catch (_) { state.pickups = state.pickups || []; }
    return state.pickups;
  }
  function pickupOrderNo(text) {
    const m = /\b(\d{5,12})\b/.exec(String(text || ''));
    return m ? m[1] : '';
  }
  function pickupLine(loc, order) {
    return [`${loc.name} — ${loc.address}`, order ? `Order ${order}` : '', loc.hours || '', loc.phone || ''].filter(Boolean).join(' · ').slice(0, 200);
  }
  function pickupRow(s) {
    if (!state.builder) return '';
    const list = state.pickups || [];
    const m = s.pickupMatch;
    const chip = m ? `<span class="pp-pick-chip">${icon('pin')}Linked to <b>${esc(m.location.name)}</b></span>` : '';
    const sel = list.length
      ? `<label class="pp-sr" for="ppPickLoc">Saved pickup locations</label><select id="ppPickLoc" data-pick-loc><option value="">${m ? 'Change location…' : 'Pick a saved location…'}</option>${list.map((l) => `<option value="${esc(l.id)}" ${m && m.location.id === l.id ? 'selected' : ''}>${esc(l.name)}${l.is_default ? ' (default)' : ''}</option>`).join('')}</select>`
      : (canDo('team.manage') ? '<a class="pp-link" href="#settings">Save your pickup locations</a>' : '');
    if (!chip && !sel) return '';
    return `<div class="pp-pick-row pp-field--wide">${chip}${sel}</div>`;
  }

  /* ─────────── work order wizard: Measure (3D) and Quote steps ─────────── */

  /** Stairs and vents the order asks for, read from its service lines. */
  function orderTakeoff(items) {
    const stairs = new Map(); const vents = [];
    const species = (t) => (t.match(/white oak|red oak|hickory|maple|walnut|ash|birch/i) || [''])[0].replace(/\b\w/g, (c) => c.toUpperCase());
    (items || []).filter((it) => !it.remove).forEach((it) => {
      const t = [it.description, it.detail, it.service_name, it.area].filter(Boolean).join(' ');
      const qty = Math.round(Number(String(it.quantity).replace(/[^\d.]/g, '')) || 0);
      if (!qty) return;
      if (/vent|register|grill/i.test(t)) {
        const sz = t.match(/(\d{1,2})\s*[xX×]\s*(\d{1,2})/);
        vents.push({ size: sz ? `${sz[1]}x${sz[2]}` : '4x10', type: /self.?rim|drop.?in/i.test(t) ? 'self_rimming' : /return/i.test(t) ? 'return_air' : 'flush', qty, species: species(t), color: (it.detail && !/\d\s*x\s*\d/i.test(it.detail) ? it.detail : '').slice(0, 80) });
        return;
      }
      if (/sand|finish|coat|stain|paint|demo|remov/i.test(t)) return;
      const isTread = /tread/i.test(t); const isRiser = /riser/i.test(t);
      if (!isTread && !isRiser) return;
      const wm = t.match(/(\d{2,3}(?:\.\d+)?)\s*(?:"|''|”|in\b|inch)/i) || t.match(/\b(3\d|4\d|5\d|6\d|7\d)\b/);
      const w = wm ? Number(wm[1]) : 0;
      const k = `${w || '?'}`;
      const g = stairs.get(k) || { w, treads: 0, risers: 0, open: 'none', species: '' };
      if (isTread) g.treads += qty; else g.risers += qty;
      if (/double|both/i.test(t)) g.open = 'both'; else if (/left/i.test(t) && g.open === 'none') g.open = 'left'; else if (/right/i.test(t) && g.open === 'none') g.open = 'right';
      g.species = g.species || species(t);
      stairs.set(k, g);
    });
    const fromItems = [...stairs.values()].filter((g) => g.treads || g.risers);
    const spec = (state.send && state.send.orderStairs) || [];
    const OPEN = { double: 'both', left: 'left', right: 'right', none: 'none' };
    // a flight with N treads has N + 1 risers when the order doesn't say
    const flights = (spec.length ? spec.map((f) => ({ w: Number(f.width) || 0, treads: Number(f.treads) || 0, risers: Number(f.risers) || 0, open: OPEN[f.returns] || 'none', species: f.species || '' })) : fromItems)
      .map((g) => ({ ...g, risers: g.risers || (g.treads ? g.treads + 1 : 0) }));
    const finish = (state.send && state.send.stairFinish) || ((items || []).some((it) => !it.remove && serviceKindOf(`${it.service_name} ${it.description} ${it.detail}`) === 'stair_sand_finish') ? 'site' : '');
    return { stairs: flights, vents, finish };
  }
  /** Same kinds of work as the server (src/lib/partner-intake/extract.ts › serviceKind). */
  function serviceKindOf(text) {
    const t = String(text || '').toLowerCase();
    const stair = /\b(?:stairs?|steps?|treads?|risers?|landing)\b/.test(t);
    const finish = /\b(?:sand(?:ing)?|re-?finish(?:ing)?|site\s*finish(?:ed)?|finish(?:ing)?\s*(?:on\s*)?site|\d\s*coats?|stain(?:ing)?|poly(?:urethane)?|screen\s*(?:&|and)\s*coat)\b/.test(t) || /\bsand\s*(?:&|and|\/)/.test(t);
    if (/\bvents?\b|\bregisters?\b|\bgrill(?:e|s)?\b/.test(t)) return 'vent';
    if (stair && finish) return 'stair_sand_finish';
    if (/\bnos(?:ing|e)s?\b/.test(t)) return 'nosing';
    if (/\brisers?\b/.test(t) && !/\btreads?\b/.test(t)) return 'stair_riser';
    if (stair) return 'stair_tread';
    if (finish) return 'floor_sand_finish';
    return 'other';
  }
  const OPEN_TXT = { both: 'double returns (both sides open)', left: 'left returns (left side open)', right: 'right returns (right side open)', none: 'between walls' };
  function orderStairText(det) {
    return ['From the work order (use these counts, widths and open sides exactly):', ...det.stairs.map((g, i) => `- ${det.stairs.length > 1 ? `Flight ${i + 1}: ` : ''}${g.treads} treads ${g.w || '?'}" wide, ${OPEN_TXT[g.open]}; ${g.risers} risers ${g.w || '?'}"${g.species ? `; ${g.species}` : ''}.`),
      det.finish === 'site' ? 'The treads are sanded and finished on site (finish: "Unfinished (site finished)").' : '',
      det.stairs.length > 1 ? `These are ${det.stairs.length} flights of ONE stair joined by a landing, listed lower flight first. Build them as connected flights (landing on each lower flight, starts_on_landing_of on the next). From the photos work out the landing size and which way each upper flight turns.` : 'From the photos work out landings and how the stair turns.',
      'Estimate tread depth and riser height from the photos.'].join('\n');
  }
  /** Without photos: one straight flight per width, typical depth/height to check on site. */
  function orderActions(det, base) {
    const out = [];
    const many = det.stairs.length > 1;
    const finish = det.finish === 'site' ? 'Unfinished (site finished)' : det.finish === 'prefinished' ? 'Prefinished' : '';
    det.stairs.forEach((g, i) => {
      const w = g.w || 42;
      const last = i === det.stairs.length - 1;
      out.push({
        type: 'add_stair',
        name: many ? (i === 0 ? 'Lower flight' : last ? 'Upper flight' : `Flight ${i + 1}`) : `${w}" stair`,
        ...(g.species ? { species: g.species } : {}),
        ...(finish ? { finish } : {}),
        // flights of one stair: each lower flight ends on a landing the next one starts from
        ...(many && !last ? { landing: true, landing_w: w, landing_d: w } : {}),
        ...(many && i > 0 ? { starts_on_landing_of: base + i - 1, turn: 'straight' } : {}),
      });
      if (g.treads) out.push({ type: 'add_steps', stair: base + i, count: g.treads, tread_w: w, tread_d: 11.25, riser_w: w, riser_h: 7.5, open: g.open, ret: '45' });
      const extra = g.risers - g.treads;
      if (extra > 0) out.push({ type: 'add_riser', stair: base + i, count: extra, riser_w: w, riser_h: 7.5 });
    });
    return out;
  }
  async function loadMeasData(s) {
    if (!s.measurement || !s.measurement.id || s.measData) return;
    try {
      const r = await api(`/api/builder/measurements/${encodeURIComponent(s.measurement.id)}`);
      s.measData = r.data.data;
      const c = measCounts(r.data.data || {});
      s.measurement = { ...s.measurement, status: r.data.status, counts: { ...(s.measurement.counts || {}), ...c }, summary: measSummary(r.data.data || {}).map((l) => ({ text: `${l.kind} · ${l.text}`, qty: Number(l.qty).toLocaleString('en-US'), uom: l.uom || 'EA' })) };
      if (state.send === s && s.phase === 'review' && s.step === 'measure') renderSendBody(); } catch (_) { /* summary only */ }
  }
  function measDrawingHtml(data) {
    const stairs = (data && data.stairs) || [];
    const roots = stairs.filter((st) => !st.starts_on_landing_of || !stairs.some((x) => x.id === st.starts_on_landing_of));
    if (!roots.length) return '';
    return roots.map((root) => {
      const chain = stairChainFor(data, root.id);
      const idx = chain.map((fl) => stairs.findIndex((x) => x.id === fl.id));
      const flip = chain.slice(1).some((fl) => fl.turn === 'right' || fl.turn === 'u_right');
      return `<div class="pp-wz-draw"><span class="pp-lbl">${chain.length > 1 ? `${esc(root.name || 'Stair')} · ${chain.length} flights` : esc(root.name || 'Stair')}</span>${stairSvg(chain.length > 1 ? chain : root, -1, flip, idx, {}, -1)}</div>`;
    }).join('');
  }
  function measureStepHtml(s) {
    const det = orderTakeoff(s.items);
    const m = s.measurement;
    const photos = s.measPhotos || [];
    const canMeasure = canDo('measure');
    const photoPicker = `<div class="pp-wz-photos">${photos.map((p, i) => `<span class="pp-sph-ph"><img src="${p}" alt="Stair photo ${i + 1}" /><button type="button" data-wz-ph-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></span>`).join('')}
        ${photos.length < 4 ? `<label class="pp-wz-addph">${icon('camera')}<span>${photos.length ? 'Add photo' : 'Add stair photos'}</span><input type="file" accept="image/*" multiple data-wz-ph hidden /></label>` : ''}</div>`;
    if (m) {
      const lines = (m.summary || []).slice(0, 10);
      return `<section class="pp-card pp-wz">
        <div class="pp-wz-head"><div><span class="pp-lbl">Step 2 · Measure</span><h2>${s.measBuilt ? 'Measurement built from the order' : 'Measurement for this address'}</h2><p class="pp-muted">${esc(countsText(m.counts || {}))}${m.measured_by ? ` · ${esc(m.measured_by)}` : ''}${m.status === 'used' ? ' · <span class="pp-late">already sent with another job</span>' : ''}</p></div>
          <a class="pp-btn pp-btn--sec pp-btn--sm" href="#measurements/${esc(m.id)}">${icon('pen')}Adjust</a></div>
        ${(() => {
          // a measurement saved for this address earlier may not be what this order asks for
          if (s.measBuilt || !det.stairs.length || m.status === 'used') return '';
          const want = det.stairs.reduce((a, g) => a + g.treads, 0);
          const have = (m.counts && m.counts.treads) || 0;
          const flightsHave = (m.counts && m.counts.stairs) || 0;
          if (want === have && det.stairs.length === flightsHave) return '';
          return `<div class="pp-wz-diff">${mate('head-curious', 40)}<div><strong>The work order asks for ${det.stairs.length > 1 ? `${det.stairs.length} flights` : '1 stair'} · ${want} treads</strong><small>This saved measurement has ${flightsHave} stair${flightsHave === 1 ? '' : 's'} · ${have} treads. Build a new one from the order, or keep this one.</small></div>${canMeasure ? '<button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-wz-build>Build from the order</button>' : ''}</div>`;
        })()}
        ${s.measReply ? `<div class="pp-wz-mate">${mate('head-talking', 40)}<div><p>${esc(s.measReply)}</p>${(s.measObs || []).length ? `<ul>${s.measObs.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</div></div>` : ''}
        <div class="pp-wz-grid">
          <div class="pp-wz-viz">${s.measData ? `${wzTurnHtml(s)}${measDrawingHtml(s.measData) || '<p class="pp-muted pp-viz-empty">No stairs in this measurement.</p>'}` : '<p class="pp-muted pp-viz-empty">Loading the drawing…</p>'}</div>
          <div class="pp-wz-side">
            ${lines.length ? `<ul class="pp-meas-sum pp-meas-sum--compact">${lines.map((l) => `<li><span>${esc(l.text)}</span><em>${esc(l.qty)} ${esc(l.uom)}</em></li>`).join('')}${(m.summary || []).length > lines.length ? `<li class="pp-muted">+ ${(m.summary || []).length - lines.length} more</li>` : ''}</ul>` : ''}
            <label class="pp-meas-use"><input type="checkbox" id="ppUseMeas" ${s.useMeasurement ? 'checked' : ''} ${m.status === 'used' ? 'disabled' : ''} /> <span>Send it with the job — PDF, 3D drawing, photos and the sizes on each line</span></label>
            ${canMeasure && det.stairs.length && m.status !== 'used' ? `<details class="pp-wz-redo"><summary>Rebuild from the order with photos</summary>${photoPicker}<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-wz-build>${icon('camera')}Rebuild with Mate</button></details>` : ''}
          </div>
        </div>
      </section>`;
    }
    if (det.stairs.length || det.vents.length) {
      return `<section class="pp-card pp-wz">
        <div class="pp-wz-head"><div><span class="pp-lbl">Step 2 · Measure</span><h2>${det.stairs.length > 1 ? `One stair · ${det.stairs.length} flights and a landing` : 'Build the 3D measurement'}</h2><p class="pp-muted">Mate found these in the work order${det.finish === 'site' ? ' — treads sanded &amp; finished on site' : ''}. Add photos of the stair so it joins the flights, the landing and the turn — or build it with typical sizes and adjust later.</p></div></div>
        <div class="pp-wz-grid">
          <div>
            <ul class="pp-wz-found">
              ${det.stairs.map((g, i) => `<li><span class="pp-wz-ic">${icon('ruler')}</span><span><strong>${det.stairs.length > 1 ? `${i === 0 ? 'Lower flight' : i === det.stairs.length - 1 ? 'Upper flight' : `Flight ${i + 1}`} · ` : ''}${g.w ? `${g.w}"` : 'Stair'} · ${g.treads} treads · ${g.risers} risers</strong><small>${esc(OPEN_TXT[g.open])}${g.species ? ` · ${esc(g.species)}` : ''}</small></span></li>`).join('')}
              ${det.vents.map((v) => `<li><span class="pp-wz-ic">${icon('home')}</span><span><strong>${v.qty} vent${v.qty === 1 ? '' : 's'} · ${esc(v.size.replace('x', '×'))} ${esc(VENT_TYPE_LABEL[v.type] || '')}</strong><small>${esc([v.species, v.color].filter(Boolean).join(' · ') || 'Wood and finish to confirm')}</small></span></li>`).join('')}
            </ul>
          </div>
          <div class="pp-wz-side">
            ${det.stairs.length ? `<span class="pp-flabel">Stair photos <small class="pp-muted">(optional, up to 4 — one of each flight)</small></span>${photoPicker}` : ''}
            ${canMeasure ? `<button type="button" class="pp-btn pp-btn--pri" data-wz-build>${photos.length ? `${icon('camera')}Build the 3D with Mate` : 'Build with typical sizes'}</button>` : '<p class="pp-muted">Your role can’t take measurements.</p>'}
            <p class="pp-error" id="ppWzErr" role="alert" hidden></p>
          </div>
        </div>
      </section>`;
    }
    return `<section class="pp-card pp-wz pp-wz--empty">
      ${mate('head-curious', 64)}<div><h2>Nothing to measure in this order</h2><p class="pp-muted">No stairs or vents in the lines. Go on to the quote, or take a measurement on site.</p>
      ${canMeasure ? '<a class="pp-link" href="#measurements/new">New measurement</a>' : ''}</div>
    </section>`;
  }
  /** How each upper flight leaves its landing, right on the drawing. */
  function wzTurnHtml(s) {
    const stairs = (s.measData && s.measData.stairs) || [];
    const uppers = stairs.map((st, i) => ({ st, i })).filter(({ st }) => st.starts_on_landing_of && stairs.some((x) => x.id === st.starts_on_landing_of));
    if (!uppers.length || (s.measurement && s.measurement.status === 'used')) return '';
    return uppers.map(({ st, i }) => {
      const cur = STAIR_TURNS.includes(st.turn) ? st.turn : 'straight';
      return `<div class="pp-turn pp-wz-turn" role="group" aria-label="How ${esc(st.name || 'the upper flight')} leaves the landing"><span>${uppers.length > 1 ? esc(st.name || 'Upper flight') : 'At the landing'}</span>${TURN_OPTS.map(([k, l, ic]) => `<button type="button" data-wz-turn="${i}:${k}" aria-pressed="${cur === k}" title="${esc(l)}">${ic}<span>${esc(l)}</span></button>`).join('')}</div>`;
    }).join('');
  }
  function quoteTotal(s) { return Math.round((s.items || []).filter((it) => !it.remove).reduce((a, it) => a + (itemTotal(it) || 0), 0) * 100) / 100; }
  function quoteStepHtml(s) {
    const co = sendCo();
    const live = (s.items || []).filter((it) => !it.remove);
    const noPrice = live.filter((it) => it.rate == null || it.rate === '').length;
    return `<section class="pp-card pp-wz pp-wz-q">
        <div class="pp-wz-head"><div><span class="pp-lbl">Step 3 · Quote</span><h2>Services at ${esc(co ? co.company_name : 'the company')}’s prices</h2><p class="pp-muted">${live.length ? `${plural(live.length, 'service', 'services')} from the order, priced from your agreed price list.${noPrice ? ` <span class="pp-late">${plural(noPrice, 'line has', 'lines have')} no price yet.</span>` : ''}` : 'Add the services for this job.'}</p></div>
          <div class="pp-wz-qacts">${canDo('money.view') && live.length && co && !companyInvited() ? `<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-wz-qpdf>${icon('download')}Quote PDF</button>` : ''}</div></div>
      </section>
      <div class="pp-card pp-q-card">${itemsEditor(s)}</div>`;
  }
  function sendSummaryHtml(s) {
    const m = s.measurement && s.useMeasurement ? s.measurement : null;
    const live = (s.items || []).filter((it) => !it.remove);
    return `<section class="pp-card pp-wz-sum">
      <button type="button" data-wz-go="measure"><span class="pp-lbl">Measurement</span><strong>${m ? esc(countsText(m.counts || {})) : 'Not included'}</strong><small>${m ? 'PDF, 3D drawing and photos go with the job' : 'Optional'}</small></button>
      <button type="button" data-wz-go="quote"><span class="pp-lbl">Quote</span><strong>${live.length ? money(quoteTotal(s)) : 'No services'}</strong><small>${plural(live.length, 'service', 'services')}</small></button>
      <div><span class="pp-lbl">Files</span><strong>${s.files.length ? plural(s.files.length, 'file', 'files') : 'None'}</strong><small>${s.files.length ? esc(s.files.map((x) => x.name).join(', ')).slice(0, 80) : 'The work order goes with the job'}</small></div>
    </section>`;
  }
  function wizardNav(s) {
    const order = ['measure', 'quote', 'details'];
    const i = order.indexOf(s.step);
    const next = order[i + 1]; const prev = order[i - 1];
    const label = { measure: 'Measure', quote: 'Quote', details: 'Job details & send' };
    return `<div class="pp-wz-nav">${prev ? `<button type="button" class="pp-btn pp-btn--sec" data-wz-go="${prev}">${icon('back')}${label[prev]}</button>` : '<span></span>'}
      ${next ? `<button type="button" class="pp-btn pp-btn--pri" data-wz-go="${next}">Continue · ${label[next]}${icon('chev')}</button>` : ''}</div>
      <div class="pp-fixbar">${prev ? `<button type="button" class="pp-btn pp-btn--sec" data-wz-go="${prev}">Back</button>` : '<button type="button" class="pp-btn pp-btn--sec" data-discard>Discard</button>'}${next ? `<button type="button" class="pp-btn pp-btn--pri" data-wz-go="${next}">Continue</button>` : ''}</div>`;
  }
  async function buildMeasurementFromOrder(btn) {
    const s = state.send;
    const det = orderTakeoff(s.items);
    const err = $('ppWzErr');
    if (btn) { btn.disabled = true; btn.innerHTML = `${mate('head-thinking', 22)} ${s.measPhotos && s.measPhotos.length ? 'Mate is looking at the stair…' : 'Building…'}`; }
    try {
      let m;
      if (s.measurement && s.measurement.id && s.measurement.status !== 'used' && s.measBuilt) {
        const r = await api(`/api/builder/measurements/${encodeURIComponent(s.measurement.id)}`);
        m = { ...r.data };
        m.data = { ...(m.data || {}), stairs: [], vents: [] };
      } else {
        const f = s.fields || {};
        const r = await postJson('/api/builder/measurements', { address: (f.address || '').trim().length >= 4 ? f.address.trim() : 'Work order (address to confirm)', community: f.community || '', lot: f.lot || '', notes: f.external_ref ? `From work order ${f.external_ref}` : 'From a work order' });
        m = { ...r.data };
        m.data = { stairs: [], vents: [], ...(m.data || {}) };
      }
      m.data.stairs = m.data.stairs || []; m.data.vents = m.data.vents || [];
      let actions = [];
      s.measReply = ''; s.measObs = [];
      if (det.stairs.length && s.measPhotos && s.measPhotos.length) {
        try {
          const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/stair-photos`, { photos: s.measPhotos, text: orderStairText(det), data: m.data });
          actions = (r.data && r.data.actions) || [];
          s.measReply = (r.data && r.data.reply) || '';
          s.measObs = (r.data && r.data.observations) || [];
        } catch (e) {
          s.measReply = `${e.message || 'Mate couldn’t look at the photos.'} Built with typical sizes instead.`;
        }
      }
      if (!actions.some((a) => a.type === 'add_stair')) actions = actions.concat(orderActions(det, m.data.stairs.length));
      det.vents.forEach((v) => actions.push({ type: 'add_vent', size: v.size, vent_type: v.type, qty: v.qty, ...(v.species ? { species: v.species } : {}), ...(v.color ? { color: v.color } : {}) }));
      applyVoiceActions(m, actions);
      const saved = await api(`/api/builder/measurements/${encodeURIComponent(m.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: m.data, notes: m.notes || '' }) });
      const c = measCounts(m.data);
      s.measurement = { id: m.id, address: saved.data.address || m.address, status: saved.data.status || 'draft', counts: c, summary: measSummary(m.data).map((l) => ({ text: `${l.kind} · ${l.text}`, qty: Number(l.qty).toLocaleString('en-US'), uom: l.uom || 'EA' })), measured_by: state.builder.member.name, measured_at: new Date().toISOString() };
      s.measData = m.data;
      s.useMeasurement = true;
      s.measBuilt = true;
      state.homeMeas = null;
      renderSendBody();
      mateToast('measure', 'Measurement ready', countsText(c));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
      if (err) { err.textContent = e.message || 'Could not build the measurement.'; err.hidden = false; }
    }
  }
  async function openQuotePdf(btn) {
    const s = state.send; const f = s.fields || {}; const co = sendCo();
    const live = (s.items || []).filter((it) => !it.remove);
    btn.disabled = true;
    const win = window.open('', '_blank');
    try {
      const res = await fetch('/api/builder/quote-pdf', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        company: co.id, title: f.title || '', address: (f.address || '').trim() || 'Address to confirm', ref: f.external_ref || '',
        measurement: s.measurement && s.useMeasurement ? countsText(s.measurement.counts || {}) : '',
        items: live.map((it) => ({ name: itemTitle(s, it).slice(0, 160), detail: (itemSub(it) || '').slice(0, 300), qty: Number(String(it.quantity).replace(/[^\d.]/g, '')) || 0, uom: it.uom || 'EA', rate: it.rate == null || it.rate === '' ? null : Number(it.rate) })),
      }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Could not make the PDF.'); }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
    } catch (e) {
      if (win) win.close();
      mateToast('head-sorry', 'Quote PDF', e.message);
    } finally { btn.disabled = false; }
  }
  function bindWizard() {
    const s = state.send;
    const go = (k) => { s.step = k; renderSendBody(); const top = $('ppSendBody'); if (top) window.scrollTo({ top: Math.max(0, top.getBoundingClientRect().top + window.scrollY - 140), behavior: 'smooth' }); };
    document.querySelectorAll('[data-wz-go]').forEach((b) => { if (b.dataset.wzBound) return; b.dataset.wzBound = '1'; b.addEventListener('click', () => go(b.getAttribute('data-wz-go'))); });
    view.querySelectorAll('[data-wz-ph]').forEach((inp) => inp.addEventListener('change', async () => {
      const files = [...(inp.files || [])].slice(0, 4 - (s.measPhotos || []).length);
      s.measPhotos = s.measPhotos || [];
      for (const file of files) { try { s.measPhotos.push(await shrinkPhoto(file, 1600)); } catch (_) { /* skip */ } }
      const keepOpen = Boolean(inp.closest('details'));
      renderSendBody();
      if (keepOpen) { const d = view.querySelector('.pp-wz-redo'); if (d) d.open = true; }
    }));
    view.querySelectorAll('[data-wz-ph-rm]').forEach((b) => b.addEventListener('click', () => { s.measPhotos.splice(Number(b.getAttribute('data-wz-ph-rm')), 1); renderSendBody(); }));
    view.querySelectorAll('[data-wz-build]').forEach((b) => b.addEventListener('click', () => buildMeasurementFromOrder(b)));
    view.querySelectorAll('.pp-wz-head a[href^="#measurements/"]').forEach((a) => a.addEventListener('click', () => { s.measLeft = true; }));
    view.querySelectorAll('[data-wz-qpdf]').forEach((b) => b.addEventListener('click', () => openQuotePdf(b)));
    view.querySelectorAll('[data-wz-turn]').forEach((b) => b.addEventListener('click', async () => {
      const [i, k] = b.getAttribute('data-wz-turn').split(':');
      const st = s.measData && s.measData.stairs[Number(i)];
      if (!st || !STAIR_TURNS.includes(k) || st.turn === k) return;
      st.turn = k;
      renderSendBody();
      try { await api(`/api/builder/measurements/${encodeURIComponent(s.measurement.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: s.measData }) }); } catch (e) { mateToast('head-sorry', 'Not saved', e.message); }
    }));
    const cp = view.querySelector('#ppSendBody [data-send-copick]');
    if (cp) cp.addEventListener('click', () => openCoPicker('Quote from', s.co || (sendCo() && sendCo().id), async (id) => {
      s.co = id;
      postJson('/api/builder/select', { company_id: id }).catch(() => {});
      if (canDo('money.view')) { s.agreed = await api(`/api/builder/prices?company=${encodeURIComponent(id)}`).then((x) => x.data || []).catch(() => []); applyAgreed(s); }
      renderSend(renderToken);
    }));
  }

  function bindReview() {
    const s = state.send;
    const pickSel = view.querySelector('[data-pick-loc]');
    if (pickSel) pickSel.addEventListener('change', () => {
      const loc = (state.pickups || []).find((l) => l.id === pickSel.value);
      if (!loc) return;
      const order = pickupOrderNo(s.pickupRaw || s.fields.pickup);
      s.fields.pickup = pickupLine(loc, order);
      s.pickupMatch = { location: loc, text: s.fields.pickup };
      renderSendBody();
    });
    view.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', () => {
      s.fields[el.getAttribute('data-field')] = el.value;
      el.closest('.pp-field').classList.remove('is-check');
    }));
    const addFilesBtn = $('ppAddFiles');
    if (addFilesBtn) addFilesBtn.addEventListener('click', () => $('ppFileInput').click());
    const addCam = $('ppAddCamera');
    if (addCam) addCam.addEventListener('click', () => $('ppCameraInput').click());
    const mergeRead = $('ppMergeRead');
    if (mergeRead) mergeRead.addEventListener('click', () => readWithAi({ merge: true }));
    bindDrop($('ppFileBox'), async (fl) => { await addFiles(fl); renderSendBody(); });
    view.querySelectorAll('#ppFileBox [data-remove]').forEach((b) => b.addEventListener('click', () => {
      const f = s.files.splice(Number(b.getAttribute('data-remove')), 1)[0];
      if (f && f.url) URL.revokeObjectURL(f.url);
      renderSendBody();
    }));
    view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { s.mode = b.getAttribute('data-mode'); renderSendBody(); }));
    $('ppRestart').addEventListener('click', () => { const preset = s.presetJob; const co = s.co; state.send = newSend(); state.send.presetJob = preset; state.send.co = co; renderSendBody(); });
    const discard = () => { state.send = newSend(); renderSendBody(); };
    if ($('ppDiscard')) $('ppDiscard').addEventListener('click', discard);
    view.querySelectorAll('[data-discard]').forEach((b) => b.addEventListener('click', discard));
    if ($('ppItemsTitle')) bindItems();
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
    if ($('ppReqForm')) $('ppReqForm').addEventListener('submit', (e) => { e.preventDefault(); submitRequest(); });
    view.querySelectorAll('[data-submit]').forEach((b) => b.addEventListener('click', submitRequest));
  }

  async function submitRequest() {
    const s = state.send;
    const f = s.fields;
    const err = $('ppReqError');
    err.hidden = true;
    if (!f.address.trim() || f.address.trim().length < 4) { err.textContent = 'Enter the job address.'; err.hidden = false; $('ppF-address').focus(); return; }
    if (!f.title.trim()) f.title = [f.service_type, f.address].filter(Boolean).join(' · ').slice(0, 160);
    if (f.title.trim().length < 3) { err.textContent = 'Give the job a title.'; err.hidden = false; $('ppF-title').focus(); return; }
    if (f.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact_email)) { err.textContent = 'Check the contact e-mail.'; err.hidden = false; return; }
    const extra = [
      f.community ? `Community: ${f.community}` : '',
      f.lot ? `Lot: ${f.lot}` : '',
      f.plan ? `Plan: ${f.plan}` : '',
      f.square_feet ? `Area: ${f.square_feet} sq ft` : '',
      f.material ? `Material: ${f.material}` : '',
    ].filter(Boolean).join(' · ');
    const notes = [f.notes.trim(), extra].filter(Boolean).join('\n');
    const update = s.mode === 'update' && s.match;
    const buttons = view.querySelectorAll('#ppSubmit, [data-submit]');
    buttons.forEach((b) => { b.disabled = true; b.textContent = 'Sending…'; });
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
      err.textContent = e.message || 'Could not send.';
      err.hidden = false;
      buttons.forEach((b) => { b.disabled = false; b.textContent = update ? 'Send update' : 'Send request'; });
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
    if (!state.loaded.documents) view.innerHTML = '<div class="pp-card pp-empty">Loading photos and documents…</div>';
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
      <div class="pp-head"><div><p class="pp-eyebrow">${state.builder && multiCo() && !state.coFilter ? 'Shared by your companies' : `Shared by ${esc(providerName())}`}</p><h1>Photos & docs</h1></div><span class="pp-muted">${plural(list.length, 'item', 'items')}</span></div>
      <div class="pp-tools">
        <div class="pp-side-search"><label>${icon('search')}<span class="pp-sr">Search documents</span><input id="ppDocSearch" type="search" placeholder="Job or document" value="${esc(state.docQuery)}" /></label></div>
        <div class="pp-filter" role="group" aria-label="Type">${btn('all', 'All')}${btn('photo', 'Photos & videos')}${btn('report', 'Reports')}${btn('file', 'Files')}</div>
      </div>
      ${list.length ? `<div class="pp-doc-grid">${list.map((d) => {
        const job = d.job || {};
        const prev = d.type === 'photo'
          ? `<a class="pp-doc-prev" href="${esc(d.file_url)}" target="_blank" rel="noopener"><img src="${esc(d.file_url)}" alt="${esc(d.title)}" loading="lazy" /></a>`
          : `<div class="pp-doc-prev" aria-hidden="true">${d.type === 'report' ? 'PDF' : d.type === 'video' ? 'VIDEO' : 'FILE'}</div>`;
        return `<article class="pp-card pp-doc-card">${prev}<div class="pp-doc-body"><span class="pp-lbl">${d.type === 'photo' ? 'Photo' : d.type === 'video' ? 'Video' : d.type === 'report' ? 'Report' : 'File'}${d.created_at ? ` · ${esc(fmtDay(d.created_at))}` : ''}</span><h3>${esc(d.title || 'Document')}</h3><p>${job.id ? `<a class="pp-link" href="#jobs/${encodeURIComponent(job.id)}">${esc(job.title || 'Job')}${job.number ? ` · #${esc(job.number)}` : ''}</a>` : ''}</p>${job.address ? `<p>${esc(job.address)}</p>` : ''}<div class="pp-doc-actions"><a class="pp-btn pp-btn--sec pp-btn--sm" href="${esc(d.file_url)}" target="_blank" rel="noopener">View</a><a class="pp-btn pp-btn--sec pp-btn--sm" href="${esc(d.file_url)}?download=1">Download</a></div></div></article>`;
      }).join('')}</div>` : `<div class="pp-card pp-empty">${mate(state.documents.length ? 'head-curious' : 'tablet')}<strong>${state.documents.length ? 'Nothing found' : 'Nothing shared yet'}</strong>${state.documents.length ? 'Change the search or the filter.' : 'Only photos, reports and files the company has shared with you appear here. If you expected a file, ask the company to share it.'}</div>`}`;
    view.querySelectorAll('[data-doc-filter]').forEach((b) => b.addEventListener('click', () => { state.docFilter = b.getAttribute('data-doc-filter'); render(); }));
    const s = $('ppDocSearch');
    s.addEventListener('input', () => { state.docQuery = s.value; const pos = s.selectionStart; render().then(() => { const x = $('ppDocSearch'); if (x) { x.focus(); x.setSelectionRange(pos, pos); } }); });
  }

  /* ─────────────────────────── builder account: companies, team, job edits ─────────────────────────── */

  const ROLE_PT = { admin: 'Admin', manager: 'Manager', office: 'Office', field: 'Field' };

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
    if (c.status === 'active') return '<span class="pp-chip pp-chip--ok">Connected</span>';
    if (c.status === 'invited') return '<span class="pp-chip pp-chip--late">Invite sent</span>';
    return '<span class="pp-chip">Unavailable</span>';
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
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>${companies.length ? 'Choose a company' : 'Welcome to ObraBuilder'}</h1></div></div>
      <div class="pp-card pp-block pp-mate-card" style="max-width:720px">
        ${mate('handshake', 110)}
        <h3 style="font-size:18px">${companies.length ? 'No company connected yet' : 'Connect your first flooring company'}</h3>
        <p class="pp-muted" style="margin:0">Already on ObraMate? Connect with their admin's email and the jobs you send go straight into their system. Not yet? Invite them by email or text — the jobs you send are kept until they join.</p>
        ${canDo('companies.manage') ? '<div><a class="pp-btn pp-btn--pri" href="#companies">Add company</a></div>' : '<p class="pp-muted" style="margin:0">Ask your team admin or manager to connect a company.</p>'}
      </div>
      ${invited.length ? `<div class="pp-card" style="overflow:hidden;max-width:720px"><div class="pp-group">Invited · ${invited.length}</div>${invited.map((c) => `<button type="button" class="pp-row" data-pick="${esc(c.id)}"><span class="pp-row-main"><span class="pp-row-top"><strong>${esc(c.company_name)}</strong>${companyStatusChip(c)}</span><span class="pp-row-sub">${esc(c.contact_email || '')}${c.pending_jobs ? ` · ${plural(c.pending_jobs, 'job waiting', 'jobs waiting')}` : ''}</span></span></button>`).join('')}</div>` : ''}`;
    view.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => { await selectCompany(b.getAttribute('data-pick')); location.hash = '#send'; render(); }));
  }

  /* ─────────────────────────── sheet (bottom sheet on phones, dialog on desktop) ─────────────────────────── */

  function closeSheet() {
    const old = $('ppSheet');
    if (old) old.remove();
    document.body.classList.remove('pp-sheet-open');
  }
  /** Opens a sheet with a title and body HTML; returns its root so the caller binds events. */
  function openSheet(title, body, opts) {
    closeSheet();
    const o = opts || {};
    document.body.insertAdjacentHTML('beforeend', `<div class="pp-sheet" id="ppSheet" role="dialog" aria-modal="true" aria-labelledby="ppSheetTitle">
      <div class="pp-sheet-card ${o.wide ? 'is-wide' : ''}">
        <div class="pp-sheet-grab" aria-hidden="true"></div>
        <div class="pp-sheet-head"><h2 id="ppSheetTitle">${esc(title)}</h2><button type="button" class="pp-sheet-x" data-sheet-close aria-label="Close">×</button></div>
        <div class="pp-sheet-body">${body}</div>
      </div>
    </div>`);
    document.body.classList.add('pp-sheet-open');
    const root = $('ppSheet');
    root.addEventListener('click', (e) => { if (e.target === root || e.target.closest('[data-sheet-close]')) closeSheet(); });
    if (typeof window.sfBootCrmAddressAutocomplete === 'function') window.sfBootCrmAddressAutocomplete();
    const first = root.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (first && !o.noFocus && window.matchMedia('(min-width: 1024px)').matches) first.focus();
    return root;
  }
  window.addEventListener('hashchange', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !(e.target && e.target.hasAttribute && e.target.hasAttribute('data-om-address-autocomplete'))) closeSheet(); });

  /* ─────────────────────────── companies ─────────────────────────── */

  const UNIT_OPTS = [['sq_ft', 'sq ft'], ['linear_ft', 'linear ft'], ['step', 'step'], ['each', 'each'], ['hour', 'hour'], ['fixed', 'fixed']];

  /** Company logo: its ObraMate logo, else the icon of its website, else initials. */
  /** Button that shows the chosen company and opens the company search. */
  function coPickBtn(c, attrs, hint) {
    return `<button type="button" class="pp-copick" ${attrs || ''}>${c ? coLogo(c, 32) : '<span class="pp-copick-none" aria-hidden="true">?</span>'}<span class="pp-copick-t"><strong>${c ? esc(c.company_name) : 'Choose a company'}</strong><small>${esc(hint != null ? hint : c ? (c.status === 'invited' ? 'Invited — held until they join' : 'On ObraMate') : 'Search your companies')}</small></span><span class="pp-copick-chg">${icon('search')}<span>Change</span></span></button>`;
  }
  /** Company search: type to filter, arrows + Enter to pick. */
  function openCoPicker(title, currentId, onPick) {
    const list = (state.builder && state.builder.companies) || [];
    const root = openSheet(title || 'Choose a company', `<div class="pp-cosheet">
        <label class="pp-send-search pp-cosheet-q">${icon('search')}<input type="search" data-co-q placeholder="Search by company name" autocomplete="off" aria-label="Search companies" /></label>
        <div class="pp-cosheet-list" role="listbox" aria-label="Companies">${list.map((c) => `<button type="button" role="option" class="pp-cosheet-row" data-co-pick="${esc(c.id)}" data-co-name="${esc(String(c.company_name || '').toLowerCase())}" aria-selected="${c.id === currentId}">${coLogo(c, 36)}<span><strong>${esc(c.company_name)}</strong><small>${c.status === 'invited' ? 'Invited — held until they join' : 'On ObraMate'}</small></span>${c.id === currentId ? `<i aria-hidden="true">${icon('check')}</i>` : ''}</button>`).join('')}</div>
        <p class="pp-muted pp-cosheet-none" data-co-none hidden>No company matches. <a class="pp-link" href="#companies">Add a company</a></p>
      </div>`);
    const q = root.querySelector('[data-co-q]');
    const rows = [...root.querySelectorAll('[data-co-pick]')];
    let hot = -1;
    const vis = () => rows.filter((r) => !r.hidden);
    const mark = () => { rows.forEach((r) => r.classList.remove('is-hot')); const v = vis(); if (v[hot]) { v[hot].classList.add('is-hot'); v[hot].scrollIntoView({ block: 'nearest' }); } };
    const filter = () => {
      const t = q.value.trim().toLowerCase();
      rows.forEach((r) => { r.hidden = Boolean(t) && !r.getAttribute('data-co-name').includes(t); });
      root.querySelector('[data-co-none]').hidden = vis().length > 0;
      hot = t && vis().length ? 0 : -1;
      mark();
    };
    q.addEventListener('input', filter);
    q.addEventListener('keydown', (e) => {
      const v = vis();
      if (e.key === 'ArrowDown') { e.preventDefault(); hot = Math.min(v.length - 1, hot + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hot = Math.max(0, hot - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = v[hot >= 0 ? hot : 0]; if (r) r.click(); }
    });
    rows.forEach((r) => r.addEventListener('click', () => { const id = r.getAttribute('data-co-pick'); closeSheet(); if (id !== currentId) onPick(id); }));
    setTimeout(() => q.focus(), 30);
  }
  function coLogo(c, size) {
    const p = (c && c.profile) || {};
    const s = size || 48;
    const ini = esc(initials(c.company_name || '?'));
    const bg = p.color && /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : '#221E1A';
    // Only the company's own logo; site icons from the web were too often blank or generic.
    const img = p.logo_url;
    // The site icon is small: shown on a white tile in the middle; a real logo fills the tile.
    return `<span class="pp-co-logo ${p.logo_url ? 'has-logo' : ''}" style="width:${s}px;height:${s}px;--co:${bg}">${img ? `<img class="${p.logo_url ? '' : 'is-icon'}" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()" onload="if(this.naturalWidth&lt;24&amp;&amp;this.classList.contains('is-icon'))this.remove()" />` : ''}<b>${ini}</b></span>`;
  }
  function coStats(c) {
    const jobs = (state.all.jobs || []).filter((j) => j._co === c.id);
    const active = jobs.filter(jobIsActive).length;
    const invs = (state.all.invoices || []).filter((i) => i._co === c.id && invoiceState(i).key !== 'paid');
    const open = invs.reduce((s, i) => s + Number(i.balance || 0), 0);
    const overdue = invs.filter((i) => invoiceState(i).key === 'overdue').length;
    return { active, total: jobs.length, open, overdue };
  }
  function contactButtons(p, c) {
    const phone = p.phone || c.contact_phone;
    const email = p.email || c.contact_email;
    const btn = (href, ic, label, ext) => `<a class="pp-act" href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener"' : ''}><span>${icon(ic)}</span>${esc(label)}</a>`;
    return [
      phone ? btn(`tel:${String(phone).replace(/[^\d+]/g, '')}`, 'phone', 'Call') : '',
      phone ? btn(smsHref(phone, ''), 'chat', 'Text') : '',
      email ? btn(`mailto:${email}`, 'mail', 'Email') : '',
      p.website ? btn(p.website, 'globe', 'Website', true) : '',
      p.address ? btn(`https://maps.google.com/?q=${encodeURIComponent(p.address)}`, 'pin', 'Map', true) : '',
    ].join('');
  }

  async function renderCompanies(id, token) {
    await loadMe();
    if (companyActive() && !((state.all && state.all.jobs) || []).length) await refreshOverview().catch(() => {});
    if (canDo('money.view')) await loadInvoices().catch(() => {});
    if (token !== renderToken) return;
    if (id) return renderCompany(id, token);
    const companies = state.builder.companies || [];
    const manage = canDo('companies.manage');
    const card = (c) => {
      const p = c.profile || {};
      const st = coStats(c);
      return `<a class="pp-card pp-co-card" href="#companies/${esc(c.id)}">
          <div class="pp-co-top">${coLogo(c, 52)}<div class="pp-co-name"><strong>${esc(c.company_name)}</strong><span>${esc(p.address || [c.contact_name, c.contact_email].filter(Boolean).join(' · ') || '')}</span></div>${companyStatusChip(c)}</div>
          ${c.status === 'active' ? `<div class="pp-co-stats"><span><b>${st.active}</b> active jobs</span>${canDo('money.view') ? `<span><b>${money(st.open)}</b> open${st.overdue ? ` · <em class="pp-late">${st.overdue} overdue</em>` : ''}</span>` : ''}</div>` : `<div class="pp-co-stats"><span>Invited ${esc(fmtDay(c.invited_at))}</span>${c.pending_jobs ? `<span><b>${c.pending_jobs}</b> ${c.pending_jobs === 1 ? 'job waiting' : 'jobs waiting'}</span>` : ''}</div>`}
        </a>`;
    };
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>Companies</h1></div>${manage ? '<div class="pp-head-actions"><button type="button" class="pp-btn pp-btn--pri" data-co-add>+ Add company</button></div>' : ''}</div>
      ${companies.length ? `<div class="pp-co-grid">${companies.map(card).join('')}</div>` : `<div class="pp-card pp-empty">${mate('handshake', 120)}<strong>No companies yet</strong>Add the flooring company that does your jobs.${manage ? '<div style="margin-top:12px"><button type="button" class="pp-btn pp-btn--pri" data-co-add>Add company</button></div>' : ''}</div>`}`;
    view.querySelectorAll('[data-co-add]').forEach((b) => b.addEventListener('click', openAddCompany));
  }

  function openAddCompany() {
    const root = openSheet('Add a flooring company', `
      <p class="pp-muted" style="margin:0 0 12px">Enter the email of the company's admin. If they already use ObraMate, they connect right away with their logo and contacts. If not, we send them an invite with the referral price.</p>
      <form id="ppCoForm" class="pp-fields" style="grid-template-columns:1fr" novalidate>
        <div class="pp-field"><label for="ppCoEmail">Admin email *</label><input id="ppCoEmail" type="email" inputmode="email" maxlength="200" autocomplete="off" required /></div>
        <div class="pp-field"><label for="ppCoName">Company name</label><input id="ppCoName" maxlength="120" placeholder="Only if they're not on ObraMate yet" /></div>
        <div class="pp-field"><label for="ppCoContact">Contact</label><input id="ppCoContact" maxlength="120" autocomplete="off" /></div>
        <div class="pp-field"><label for="ppCoPhone">Mobile (for the text invite)</label><input id="ppCoPhone" type="tel" inputmode="tel" maxlength="40" /></div>
        <p class="pp-error" id="ppCoError" role="alert" hidden></p>
        <div id="ppCoResult"></div>
        <div class="pp-sheet-actions"><button type="submit" class="pp-btn pp-btn--pri" id="ppCoSave">Connect or invite</button></div>
      </form>`);
    const form = root.querySelector('#ppCoForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ppCoError');
      const btn = $('ppCoSave');
      err.hidden = true;
      $('ppCoResult').innerHTML = '';
      btn.disabled = true;
      btn.textContent = 'Looking up…';
      const phone = $('ppCoPhone').value.trim();
      try {
        const r = await postJson('/api/builder/companies', { email: $('ppCoEmail').value.trim(), company_name: $('ppCoName').value.trim(), contact_name: $('ppCoContact').value.trim(), phone });
        const data = r.data;
        await reloadAllCompanies();
        if (data.kind === 'linked') {
          mateToast('handshake', `${data.company_name} connected`, 'Their logo and contacts are on the company page.');
          $('ppCoResult').innerHTML = `<div class="pp-success">${esc(data.company_name)} already uses ObraMate and is now connected.</div><div class="pp-sheet-actions"><a class="pp-btn pp-btn--pri" href="#send">Send a job</a></div>`;
        } else {
          inviteActions($('ppCoResult'), data, phone);
        }
        form.querySelectorAll('input').forEach((i) => { i.value = ''; });
        btn.hidden = true;
        if (route().name === 'empresas') render();
      } catch (ex) {
        err.textContent = ex.message || 'Could not add the company.';
        err.hidden = false;
        if (/name/i.test(ex.message || '')) $('ppCoName').focus();
        btn.disabled = false;
        btn.textContent = 'Connect or invite';
      }
    });
  }
  function inviteActions(out, data, phone) {
    if (!out) return;
    out.innerHTML = `<div class="pp-success" style="margin-top:10px">Invite sent by email${data.offer ? ` · offer: ${esc(data.offer)}` : ''}.</div>
      <div class="pp-sheet-actions">
        ${phone ? `<a class="pp-btn pp-btn--pri pp-btn--sm" href="${esc(smsHref(phone, data.sms_text))}">Send by text</a>` : ''}
        <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-copy="${esc(data.invite_url)}">Copy link</button>
      </div>`;
    out.querySelectorAll('[data-copy]').forEach((c) => c.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(c.getAttribute('data-copy')); c.textContent = 'Copied'; } catch (_) { window.prompt('Copy the link', c.getAttribute('data-copy')); }
    }));
  }

  async function renderCompany(id, token) {
    const c = coById(id);
    if (!c) { view.innerHTML = `<div class="pp-card pp-empty">${mate('head-curious')}<strong>Company not found</strong><a class="pp-link" href="#companies">Back to companies</a></div>`; return; }
    const p = c.profile || {};
    const manage = canDo('companies.manage');
    const money_ = canDo('money.view');
    const prices = money_ ? await api(`/api/builder/prices?company=${encodeURIComponent(c.id)}`).then((r) => r.data || []).catch(() => []) : [];
    if (token !== renderToken) return;
    const st = coStats(c);
    const recent = (state.all.jobs || []).filter((j) => j._co === c.id).sort((a, b) => (toDate(b.updatedAt) || 0) - (toDate(a.updatedAt) || 0)).slice(0, 5);
    const facts = [
      p.address ? ['Address', esc(p.address)] : null,
      (p.phone || c.contact_phone) ? ['Phone', esc(p.phone || c.contact_phone)] : null,
      (p.email || c.contact_email) ? ['Email', esc(p.email || c.contact_email)] : null,
      p.website ? ['Website', `<a class="pp-link" href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`] : null,
      c.contact_name ? ['Your contact', esc(c.contact_name)] : null,
      p.license ? ['License', esc(p.license)] : null,
      p.insurance ? ['Insurance', `${esc(p.insurance.carrier)}${p.insurance.expires_on ? ` · ${insuranceText(p.insurance.expires_on)}` : ''}`] : null,
      c.status === 'active' ? ['Connected', esc(fmtDay(c.activated_at))] : ['Invited', esc(fmtDay(c.invited_at))],
    ].filter(Boolean);
    view.innerHTML = `
      <div class="pp-head pp-co-head">
        <div><a class="pp-back" href="#companies" style="display:inline-flex">${icon('back')}Companies</a>
          <div class="pp-co-hero">${coLogo(c, 72)}<div><h1>${esc(c.company_name)}</h1><p class="pp-muted" style="margin:4px 0 0">${companyStatusChip(c)}</p></div></div>
        </div>
        ${canDo('jobs.send') && c.status !== 'unavailable' ? `<div class="pp-head-actions"><button type="button" class="pp-btn pp-btn--pri" data-send-to="${esc(c.id)}">Send job</button></div>` : ''}
      </div>
      <div class="pp-acts">${contactButtons(p, c)}</div>
      <div class="pp-co-layout">
        <div class="pp-co-main">
          ${c.status === 'active' ? `<div class="pp-co-kpis">
            <a class="pp-card pp-kpi" href="#jobs" data-see-jobs="${esc(c.id)}"><span class="pp-lbl">Active jobs</span><b>${st.active}</b><small>${st.total} in total</small></a>
            ${money_ ? `<a class="pp-card pp-kpi" href="#invoices" data-see-inv="${esc(c.id)}"><span class="pp-lbl">Open invoices</span><b>${money(st.open)}</b><small class="${st.overdue ? 'pp-late' : ''}">${st.overdue ? `${st.overdue} overdue` : 'Nothing overdue'}</small></a>` : ''}
          </div>` : `<div class="pp-card pp-block"><strong>Waiting for ${esc(c.company_name)} to join</strong><p class="pp-muted" style="margin:4px 0 0">${c.pending_jobs ? `${plural(c.pending_jobs, 'job is', 'jobs are')} kept until they sign up.` : 'Jobs you send are kept until they sign up.'}</p>${manage ? `<div class="pp-sheet-actions" style="justify-content:flex-start"><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-resend="${esc(c.id)}">Resend invite</button></div><div data-invite-out></div>` : ''}</div>`}
          ${money_ ? `<section class="pp-card pp-block" aria-labelledby="ppPrices">
            <div class="pp-set-head"><div><h3 id="ppPrices">Your price list</h3><p class="pp-muted">Prices you agreed with ${esc(c.company_name)}. When you send a work order, lines without a price get these, and different prices are flagged.</p></div>${manage ? '<button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-price-new>+ Price</button>' : ''}</div>
            ${prices.length ? `<div class="pp-price-list">${prices.map((pr) => `<button type="button" class="pp-price-row" data-price="${esc(pr.id)}" ${manage ? '' : 'disabled'}><span><strong>${esc(pr.name)}</strong>${pr.notes ? `<small>${esc(pr.notes)}</small>` : ''}</span><b>${money(pr.price)}<small> / ${esc(unitText(pr.unit))}</small></b></button>`).join('')}</div>` : `<div class="pp-empty" style="padding:18px 8px">${mate('head-thinking', 56)}<strong>No prices yet</strong>${manage ? 'Add the services you buy from this company and the agreed price.' : 'Ask an admin to add your agreed prices.'}</div>`}
            ${manage && prices.length && activeCompanies().length > 1 ? `<div class="pp-sheet-actions" style="justify-content:flex-start"><label class="pp-sr" for="ppCopyTo">Copy prices to</label><select id="ppCopyTo" class="pp-select"><option value="">Copy these prices to…</option>${(state.builder.companies || []).filter((x) => x.id !== c.id).map((x) => `<option value="${esc(x.id)}">${esc(x.company_name)}</option>`).join('')}</select></div>` : ''}
          </section>` : ''}
          ${recent.length ? `<section class="pp-card" style="overflow:hidden" aria-label="Recent jobs"><div class="pp-group">Recent jobs</div>${recent.map((j) => `<a class="pp-row" href="#jobs/${encodeURIComponent(j.id)}" style="text-decoration:none"><span class="pp-row-main"><span class="pp-row-top"><strong>${esc(j.title || 'Job')}</strong>${jobChip(j)}</span><span class="pp-row-sub">${esc(j.address || '')}</span></span></a>`).join('')}</section>` : ''}
        </div>
        <aside class="pp-co-side">
          <div class="pp-card pp-block"><h3>Details</h3><dl class="pp-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
            ${c.status === 'active' && !p.logo_url ? '<p class="pp-muted" style="font-size:13px;margin:8px 0 0">Logo and contacts come from the company’s ObraMate profile.</p>' : ''}
          </div>
          ${manage ? `<button type="button" class="pp-link pp-late" data-remove-co="${esc(c.id)}" style="justify-self:start">Disconnect ${esc(c.company_name)}</button>` : ''}
        </aside>
      </div>`;
    view.querySelectorAll('[data-send-to]').forEach((b) => b.addEventListener('click', () => {
      state.send = newSend();
      state.send.co = b.getAttribute('data-send-to');
      postJson('/api/builder/select', { company_id: state.send.co }).catch(() => {});
      location.hash = '#send';
    }));
    view.querySelectorAll('[data-see-jobs]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); state.coFilter = c.id; applyCoFilter(); location.hash = '#jobs'; }));
    view.querySelectorAll('[data-see-inv]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); state.coFilter = c.id; applyCoFilter(); location.hash = '#invoices'; }));
    view.querySelectorAll('[data-resend]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Sending…';
      try {
        const r = await postJson(`/api/builder/companies/${encodeURIComponent(c.id)}/resend`, {});
        inviteActions(view.querySelector('[data-invite-out]'), r.data, c.contact_phone);
        b.textContent = 'Resent';
      } catch (e) {
        b.disabled = false;
        b.textContent = 'Resend invite';
        window.alert(e.message);
      }
    }));
    view.querySelectorAll('[data-remove-co]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = `Tap again to disconnect ${c.company_name}`; return; }
      b.disabled = true;
      try {
        await api(`/api/builder/companies/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
        await reloadAllCompanies();
        location.hash = '#companies';
      } catch (e) {
        b.disabled = false;
        window.alert(e.message);
      }
    }));
    const priceSheet = (pr) => openPriceSheet(c, pr, () => render());
    view.querySelectorAll('[data-price-new]').forEach((b) => b.addEventListener('click', () => priceSheet(null)));
    view.querySelectorAll('[data-price]').forEach((b) => b.addEventListener('click', () => priceSheet(prices.find((x) => x.id === b.getAttribute('data-price')))));
    const copy = $('ppCopyTo');
    if (copy) copy.addEventListener('change', async () => {
      if (!copy.value) return;
      try {
        const r = await postJson('/api/builder/prices/copy', { from: c.id, to: copy.value });
        window.alert(r.data.copied ? `${plural(r.data.copied, 'price', 'prices')} copied.` : 'That company already has these prices.');
      } catch (e) { window.alert(e.message); }
      copy.value = '';
    });
  }
  function insuranceText(iso) {
    const d = toDate(`${iso}T12:00:00`);
    if (!d) return '';
    const days = Math.round((d - new Date()) / 86400000);
    return days < 0 ? `<span class="pp-late">expired ${esc(fmtDay(d))}</span>` : days <= 30 ? `<span class="pp-late">expires ${esc(fmtDay(d))}</span>` : `valid until ${esc(fmtDay(d))}`;
  }
  function unitText(u) {
    return (UNIT_OPTS.find((x) => x[0] === u) || [u, String(u || '').replace(/_/g, ' ')])[1];
  }
  /** Add or edit an agreed price; the company's catalog is offered when it is connected. */
  async function openPriceSheet(c, pr, done) {
    const catalog = c.status === 'active' ? await api('/api/partner-portal/price-list', { co: c.id }).then((r) => r.data || []).catch(() => []) : [];
    const x = pr || { name: '', unit: 'each', price: '', notes: '', pricing_item_id: '' };
    const root = openSheet(pr ? 'Edit price' : `New price · ${c.company_name}`, `
      <form id="ppPriceForm" class="pp-fields" novalidate>
        ${catalog.length ? `<div class="pp-field pp-field--wide"><label for="ppPrCat">Service in ${esc(c.company_name)}’s list</label><select id="ppPrCat"><option value="">— Other service —</option>${catalog.map((it) => `<option value="${esc(it.id)}" data-unit="${esc(it.unit || '')}" data-name="${esc(it.name)}" ${x.pricing_item_id === it.id ? 'selected' : ''}>${esc(it.name)}${it.price != null ? ` · their price ${money(it.price)}` : ''}</option>`).join('')}</select></div>` : ''}
        <div class="pp-field pp-field--wide"><label for="ppPrName">Service *</label><input id="ppPrName" maxlength="160" required value="${esc(x.name)}" placeholder="e.g. Stair tread install" /></div>
        <div class="pp-field"><label for="ppPrPrice">Agreed price *</label><input id="ppPrPrice" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(x.price)}" /></div>
        <div class="pp-field"><label for="ppPrUnit">Per</label><select id="ppPrUnit">${UNIT_OPTS.map(([k, l]) => `<option value="${k}" ${x.unit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="pp-field pp-field--wide"><label for="ppPrNotes">Notes</label><input id="ppPrNotes" maxlength="300" value="${esc(x.notes || '')}" placeholder="e.g. includes haul-away" /></div>
        <p class="pp-error pp-field--wide" id="ppPrErr" role="alert" hidden></p>
        <div class="pp-sheet-actions pp-field--wide">${pr ? '<button type="button" class="pp-btn pp-btn--sec" data-pr-del>Delete</button>' : ''}<button type="submit" class="pp-btn pp-btn--pri">${pr ? 'Save' : 'Add price'}</button></div>
      </form>`);
    const cat = root.querySelector('#ppPrCat');
    if (cat) cat.addEventListener('change', () => {
      const opt = cat.selectedOptions[0];
      if (!opt || !opt.value) return;
      $('ppPrName').value = opt.getAttribute('data-name');
      const u = ({ sq_ft: 'sq_ft', sqft: 'sq_ft', linear_ft: 'linear_ft', lf: 'linear_ft', step: 'step', unit: 'each', each: 'each', hour: 'hour', fixed: 'fixed', flat: 'fixed' })[opt.getAttribute('data-unit')];
      if (u) $('ppPrUnit').value = u;
      $('ppPrPrice').focus();
    });
    root.querySelector('#ppPriceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ppPrErr');
      err.hidden = true;
      const payload = { company_id: c.id, pricing_item_id: cat ? cat.value : '', name: $('ppPrName').value.trim(), unit: $('ppPrUnit').value, price: Number($('ppPrPrice').value), notes: $('ppPrNotes').value.trim() };
      if (payload.name.length < 2 || !($('ppPrPrice').value !== '' && payload.price >= 0)) { err.textContent = 'Enter the service name and the price.'; err.hidden = false; return; }
      try {
        if (pr) await api(`/api/builder/prices/${encodeURIComponent(pr.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        else await postJson('/api/builder/prices', payload);
        state.prices = null;
        closeSheet();
        done();
        mateToast('thumbs', pr ? 'Price updated' : 'Price added', `${payload.name} · ${money(payload.price)}`);
      } catch (ex) { err.textContent = ex.message || 'Could not save.'; err.hidden = false; }
    });
    const del = root.querySelector('[data-pr-del]');
    if (del) del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
      try { await api(`/api/builder/prices/${encodeURIComponent(pr.id)}`, { method: 'DELETE' }); state.prices = null; closeSheet(); done(); } catch (ex) { window.alert(ex.message); }
    });
  }

  /* ─────────────────────────── team ─────────────────────────── */

  async function renderTeam(token) {
    const manage = canDo('team.manage');
    const r = await api(`/api/builder/team${manage ? '?all=1' : ''}`);
    if (token !== renderToken) return;
    const rows = r.data || [];
    const roles = state.builder.roles || [];
    const me = state.builder.member.id;
    const active = rows.filter((m) => m.status === 'active');
    const invited = rows.filter((m) => m.status === 'invited');
    const off = rows.filter((m) => m.status === 'disabled');
    const roleLabel = (k) => ((roles.find((x) => x.key === k) || {}).label || ROLE_PT[k] || k);
    const person = (m) => `<button type="button" class="pp-row pp-person ${m.status === 'disabled' ? 'is-off' : ''}" data-person="${esc(m.id)}" ${manage || m.id === me ? '' : 'disabled'}>
        <span class="pp-avatar-sm" aria-hidden="true">${esc(initials(m.name))}</span>
        <span class="pp-row-main"><span class="pp-row-top"><strong>${esc(m.name)}${m.id === me ? ' <span class="pp-muted" style="font-weight:500">(you)</span>' : ''}</strong><span class="pp-chip">${esc(roleLabel(m.role))}</span></span>
          <span class="pp-row-sub">${esc([m.title, m.email].filter(Boolean).join(' · '))}</span>
          <span class="pp-row-next">${m.status === 'invited' ? `<span class="pp-chip pp-chip--late">Invite sent${m.invited_by ? ` by ${esc(m.invited_by)}` : ''}</span>` : m.status === 'disabled' ? '<span class="pp-chip">No access</span>' : m.last_login_at ? `Last seen ${esc(fmtDay(m.last_login_at))}` : 'Not signed in yet'}</span>
        </span></button>`;
    const group = (label, list) => list.length ? `<div class="pp-group">${label} · ${list.length}</div>${list.map(person).join('')}` : '';
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>Team</h1></div>${manage ? '<div class="pp-head-actions"><button type="button" class="pp-btn pp-btn--pri" data-invite>+ Invite</button></div>' : ''}</div>
      <div class="pp-co-layout">
        <div class="pp-co-main"><div class="pp-card" style="overflow:hidden">${group('Active', active)}${group('Invited', invited)}${group('No access', off)}</div></div>
        <aside class="pp-co-side"><div class="pp-card pp-block"><h3>What each role can do</h3><ul class="tk-list">${roles.map((ro) => `<li><span><b>${esc(ro.label)}</b><small>${esc(ro.hint)}</small></span></li>`).join('')}</ul></div></aside>
      </div>`;
    view.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => openMemberSheet(null, roles)));
    view.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => {
      const m = rows.find((x) => x.id === b.getAttribute('data-person'));
      if (m) openMemberSheet(m, roles);
    }));
  }

  /** Invite someone, or edit / resend / remove a person on the team. */
  function openMemberSheet(m, roles) {
    const me = state.builder.member.id;
    const self = m && m.id === me;
    const manage = canDo('team.manage');
    const invited = m && m.status === 'invited';
    const off = m && m.status === 'disabled';
    const root = openSheet(m ? (self ? 'Your profile' : m.name) : 'Invite someone', `
      <form id="ppMemForm" class="pp-fields" novalidate>
        <div class="pp-field pp-field--wide"><label for="ppMName">Name *</label><input id="ppMName" maxlength="120" required value="${esc(m ? m.name : '')}" autocomplete="off" /></div>
        <div class="pp-field"><label for="ppMEmail">Email ${m && !invited ? '<span>(sign-in)</span>' : '*'}</label><input id="ppMEmail" type="email" inputmode="email" maxlength="200" value="${esc(m ? m.email : '')}" ${m && !invited ? 'disabled' : ''} autocomplete="off" /></div>
        <div class="pp-field"><label for="ppMPhone">Mobile</label><input id="ppMPhone" type="tel" inputmode="tel" maxlength="40" value="${esc(m && m.phone ? m.phone : '')}" /></div>
        <div class="pp-field"><label for="ppMTitle">Job title</label><input id="ppMTitle" maxlength="80" value="${esc(m && m.title ? m.title : '')}" placeholder="e.g. Superintendent" /></div>
        <div class="pp-field"><label for="ppMRole">Role</label><select id="ppMRole" ${self || !manage ? 'disabled' : ''}>${roles.map((ro) => `<option value="${ro.key}" ${(m ? m.role : 'office') === ro.key ? 'selected' : ''}>${esc(ro.label)}</option>`).join('')}</select></div>
        <p class="pp-muted pp-field--wide" id="ppMHint" style="margin:0;font-size:13px"></p>
        <p class="pp-error pp-field--wide" id="ppMErr" role="alert" hidden></p>
        <div id="ppMOut" class="pp-field--wide"></div>
        <div class="pp-sheet-actions pp-field--wide">
          ${m && !self && manage ? (off ? '<button type="button" class="pp-btn pp-btn--sec" data-m-on>Give access back</button>' : `<button type="button" class="pp-btn pp-btn--sec pp-late" data-m-rm>${invited ? 'Cancel invite' : 'Remove access'}</button>`) : ''}
          ${invited && manage ? '<button type="button" class="pp-btn pp-btn--sec" data-m-resend>Resend invite</button>' : ''}
          <button type="submit" class="pp-btn pp-btn--pri">${m ? 'Save' : 'Send invite'}</button>
        </div>
        ${m && m.phone && !self ? `<div class="pp-acts pp-field--wide"><a class="pp-act" href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}"><span>${icon('phone')}</span>Call</a><a class="pp-act" href="${esc(smsHref(m.phone, ''))}"><span>${icon('chat')}</span>Text</a><a class="pp-act" href="mailto:${esc(m.email)}"><span>${icon('mail')}</span>Email</a></div>` : ''}
      </form>`);
    const hint = () => { const ro = roles.find((x) => x.key === $('ppMRole').value); $('ppMHint').textContent = ro ? ro.hint : ''; };
    hint();
    $('ppMRole').addEventListener('change', hint);
    const err = $('ppMErr');
    const fail = (ex) => { err.textContent = ex.message || 'Could not save.'; err.hidden = false; };
    root.querySelector('#ppMemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const body = { name: $('ppMName').value.trim(), phone: $('ppMPhone').value.trim(), title: $('ppMTitle').value.trim() };
      try {
        if (!m) {
          const res = await postJson('/api/builder/team', { ...body, email: $('ppMEmail').value.trim(), role: $('ppMRole').value });
          await render();
          mateToast('wave', 'Invite sent', `${body.name} gets an email to join.`);
          openSheet('Invite sent', `<div class="pp-success">We emailed ${esc(body.name)} a link to join ${esc(state.builder.account.name)}.${res.data && res.data.devLink ? ` <a href="${esc(res.data.devLink)}">Link (test)</a>` : ''}</div><div class="pp-sheet-actions"><button type="button" class="pp-btn pp-btn--pri" data-sheet-close>Done</button></div>`);
          return;
        }
        if (self) {
          await api('/api/builder/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          await loadMe();
        } else {
          await api(`/api/builder/team/${encodeURIComponent(m.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, role: $('ppMRole').value, ...(invited ? { email: $('ppMEmail').value.trim() } : {}) }) });
        }
        closeSheet();
        render();
      } catch (ex) { fail(ex); }
    });
    const rm = root.querySelector('[data-m-rm]');
    if (rm) rm.addEventListener('click', async () => {
      if (rm.dataset.armed !== '1') { rm.dataset.armed = '1'; rm.textContent = 'Tap again to confirm'; return; }
      try { await api(`/api/builder/team/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); closeSheet(); render(); } catch (ex) { fail(ex); }
    });
    const on = root.querySelector('[data-m-on]');
    if (on) on.addEventListener('click', async () => {
      try { await api(`/api/builder/team/${encodeURIComponent(m.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: false }) }); closeSheet(); render(); } catch (ex) { fail(ex); }
    });
    const rs = root.querySelector('[data-m-resend]');
    if (rs) rs.addEventListener('click', async () => {
      rs.disabled = true;
      try {
        const r = await postJson(`/api/builder/team/${encodeURIComponent(m.id)}/resend`, {});
        $('ppMOut').innerHTML = `<div class="pp-success">New invite sent to ${esc(m.email)}.${r.data && r.data.devLink ? ` <a href="${esc(r.data.devLink)}">Link (test)</a>` : ''}</div>`;
      } catch (ex) { rs.disabled = false; fail(ex); }
    });
  }

  /* ─────────────────────────── settings (builder admin) ─────────────────────────── */

  const SETTINGS_SECTIONS = [
    { key: 'profile', label: 'Your profile', sub: 'Name, phone and job title', ic: 'user', perm: null },
    { key: 'company', label: 'Company', sub: 'Logo, contacts, address and license', ic: 'shield', perm: 'team.manage' },
    { key: 'pickups', label: 'Pickup locations', sub: 'Supplier yards linked to work orders', ic: 'pin', perm: 'team.manage' },
    { key: 'prices', label: 'Price lists', sub: 'Agreed prices for each company', ic: 'tag', perm: 'money.view' },
    { key: 'takeoff', label: 'Takeoff & waste', sub: 'Waste % for floors measured from plans', ic: 'ruler', perm: 'team.manage' },
    { key: 'team', label: 'Team', sub: 'People, roles and invites', ic: 'user', perm: null, href: '#team' },
    { key: 'app', label: 'App', sub: 'Install ObraBuilder on your phone', ic: 'download', perm: null },
  ];

  let setOut = null;
  async function renderSettings(section, token) {
    await loadMe();
    if (token !== renderToken) return;
    const sections = SETTINGS_SECTIONS.filter((x) => !x.perm || canDo(x.perm));
    const acc = state.builder.account;
    const me = state.builder.member;
    const wide = window.matchMedia('(min-width: 900px)').matches;
    let sec = sections.find((x) => x.key === section && !x.href);
    // Desktop and tablet: list on the left, the open section on the right (no extra page hop).
    if (wide && !sec) sec = sections[0];
    const head = wide
      ? (title) => `<div class="pp-set2-title"><h2>${esc(title)}</h2></div>`
      : (title, back) => `<div class="pp-head"><div>${back ? `<a class="pp-back" href="#settings" style="display:inline-flex">${icon('back')}Settings</a>` : `<p class="pp-eyebrow">${esc(acc.name)}</p>`}<h1>${esc(title)}</h1></div></div>`;
    const meCard = `<a class="pp-card pp-set-me" href="#settings/profile">${acc.logo_url ? `<img class="pp-set-logo" src="${esc(acc.logo_url)}" alt="" />` : `<span class="pp-avatar-sm pp-avatar-lg" aria-hidden="true">${esc(initials(me.name))}</span>`}<span><strong>${esc(me.name)}</strong><small>${esc([me.role_label, acc.name].join(' · '))}</small><small>${esc(me.email)}</small></span>${icon('chev')}</a>`;
    const rows = `<div class="pp-card pp-set-list">${sections.map((x) => `<a class="pp-set-row" href="${x.href || `#settings/${x.key}`}" ${sec && sec.key === x.key ? 'aria-current="page"' : ''}><span class="pp-set-ic">${icon(x.ic)}</span><span><strong>${esc(x.label)}</strong><small>${esc(x.sub)}</small></span>${icon('chev')}</a>`).join('')}</div>`;
    const out = `<button type="button" class="pp-set-out" id="ppSetLogout">${icon('back')}Sign out</button>`;
    if (wide) {
      view.innerHTML = `<div class="pp-head"><div><p class="pp-eyebrow">${esc(acc.name)}</p><h1>Settings</h1></div></div>
        <div class="pp-set2"><nav class="pp-set2-nav" aria-label="Settings sections">${meCard}${rows}${out}</nav><div class="pp-set2-body" id="ppSetBody"></div></div>`;
      setOut = $('ppSetBody');
      $('ppSetLogout').addEventListener('click', logout);
    } else {
      setOut = view;
      if (!sec) {
        view.innerHTML = `${head('Settings')}<div class="pp-set-hub">${meCard}${rows}${out}</div>`;
        $('ppSetLogout').addEventListener('click', logout);
        return;
      }
    }
    if (sec.key === 'profile') return settingsProfile(head);
    if (sec.key === 'company') return settingsCompany(head, acc);
    if (sec.key === 'pickups') return settingsPickups(head, token);
    if (sec.key === 'prices') return settingsPrices(head, token);
    if (sec.key === 'takeoff') return settingsTakeoff(head);
    if (sec.key === 'app') return settingsApp(head);
  }

  function formError(id, ex) {
    const err = $(id);
    if (!err) return;
    err.textContent = (ex && ex.message) || 'Could not save.';
    err.hidden = false;
  }
  function savedFlash(btn) {
    const t = btn.textContent;
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = t; }, 1600);
  }

  function settingsProfile(head) {
    const me = state.builder.member;
    const p = state.builder.member_profile || {};
    setOut.innerHTML = `${head('Your profile', true)}
      <form class="pp-card pp-block pp-set-form" id="ppMeForm" novalidate>
        <div class="pp-fields">
          <div class="pp-field pp-field--wide"><label for="ppMeName">Name *</label><input id="ppMeName" maxlength="120" required value="${esc(me.name)}" autocomplete="name" /></div>
          <div class="pp-field"><label for="ppMePhone">Mobile</label><input id="ppMePhone" type="tel" inputmode="tel" maxlength="40" value="${esc(p.phone || '')}" autocomplete="tel" /></div>
          <div class="pp-field"><label for="ppMeTitle">Job title</label><input id="ppMeTitle" maxlength="80" value="${esc(p.title || '')}" placeholder="e.g. Superintendent" /></div>
          <div class="pp-field pp-field--wide"><label for="ppMeEmail">Email <span>(sign-in)</span></label><input id="ppMeEmail" value="${esc(me.email)}" disabled /></div>
          <p class="pp-muted pp-field--wide" style="margin:0;font-size:13px">Role: <b>${esc(me.role_label)}</b>. To change the email or role, ask your team admin.</p>
          <p class="pp-error pp-field--wide" id="ppMeErr" role="alert" hidden></p>
          <div class="pp-sheet-actions pp-field--wide"><a class="pp-btn pp-btn--sec" href="/builders/forgot">Change password</a><button type="submit" class="pp-btn pp-btn--pri">Save</button></div>
        </div>
      </form>`;
    $('ppMeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('ppMeErr').hidden = true;
      const btn = e.target.querySelector('[type=submit]');
      try {
        await api('/api/builder/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('ppMeName').value.trim(), phone: $('ppMePhone').value.trim(), title: $('ppMeTitle').value.trim() }) });
        await loadMe();
        paintShell();
        savedFlash(btn);
      } catch (ex) { formError('ppMeErr', ex); }
    });
  }

  function settingsCompany(head, acc) {
    const f = (id, label, val, attrs) => `<div class="pp-field ${attrs && attrs.wide ? 'pp-field--wide' : ''}"><label for="${id}">${label}</label><input id="${id}" value="${esc(val || '')}" ${attrs && attrs.extra ? attrs.extra : ''} /></div>`;
    setOut.innerHTML = `${head('Company', true)}
      <form class="pp-set-form" id="ppAccForm" novalidate>
        <section class="pp-card pp-block pp-logo-box">
          <div class="pp-logo-prev">${acc.logo_url ? `<img src="${esc(acc.logo_url)}" alt="${esc(acc.name)} logo" />` : `<b>${esc(initials(acc.name))}</b>`}</div>
          <div><strong>Logo</strong><p class="pp-muted" style="margin:2px 0 8px;font-size:13px">Shown on your account and to the companies you work with. PNG, JPG or WebP, up to 2 MB.</p>
            <label class="pp-btn pp-btn--sec pp-btn--sm"><input type="file" id="ppLogoIn" accept="image/png,image/jpeg,image/webp" hidden />${acc.logo_url ? 'Change logo' : 'Upload logo'}</label>
            ${acc.logo_url ? '<button type="button" class="pp-link" id="ppLogoRm" style="margin-left:8px">Remove</button>' : ''}</div>
        </section>
        <section class="pp-card pp-block"><h3>Company</h3><div class="pp-fields">
          ${f('ppAcName', 'Company name *', acc.name, { wide: true, extra: 'maxlength="120" required autocomplete="organization"' })}
          ${f('ppAcPhone', 'Office phone', acc.phone, { extra: 'type="tel" inputmode="tel" maxlength="40"' })}
          ${f('ppAcEmail', 'Office email', acc.email, { extra: 'type="email" inputmode="email" maxlength="200"' })}
          ${f('ppAcBill', 'Billing email for invoices', acc.billing_email, { extra: 'type="email" inputmode="email" maxlength="200"' })}
          ${f('ppAcWeb', 'Website', acc.website, { extra: 'type="url" inputmode="url" maxlength="200" placeholder="https://"' })}
          ${f('ppAcLic', 'Builder license #', acc.license_number, { extra: 'maxlength="80"' })}
        </div></section>
        <section class="pp-card pp-block"><h3>Office address</h3><div class="pp-fields">
          ${f('ppAcA1', 'Street', acc.address_line1, { wide: true, extra: 'maxlength="200" placeholder="Start typing the address" autocomplete="address-line1" data-om-address-autocomplete data-crm-address-autocomplete="1"' })}
          ${f('ppAcA2', 'Suite / unit', acc.address_line2, { extra: 'maxlength="120" autocomplete="address-line2"' })}
          ${f('ppAcCity', 'City', acc.city, { extra: 'maxlength="80" autocomplete="address-level2"' })}
          ${f('ppAcState', 'State', acc.state, { extra: 'maxlength="40" autocomplete="address-level1"' })}
          ${f('ppAcZip', 'ZIP', acc.postal_code, { extra: 'maxlength="20" inputmode="numeric" autocomplete="postal-code"' })}
        </div></section>
        <p class="pp-error" id="ppAccErr" role="alert" hidden></p>
        <div class="pp-set-save"><button type="submit" class="pp-btn pp-btn--pri">Save company</button></div>
      </form>`;
    if (typeof window.sfBootCrmAddressAutocomplete === 'function') window.sfBootCrmAddressAutocomplete();
    // Google autocomplete fills the whole address into the street box: split it.
    const a1 = $('ppAcA1');
    a1.addEventListener('change', () => {
      const parts = a1.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 3) {
        a1.value = parts[0];
        $('ppAcCity').value = parts[1];
        const m = /^([A-Z]{2})\s*(\d{5})?/.exec(parts[2]);
        if (m) { $('ppAcState').value = m[1]; if (m[2]) $('ppAcZip').value = m[2]; }
      }
    });
    $('ppAccForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('ppAccErr').hidden = true;
      const btn = e.target.querySelector('[type=submit]');
      const v = (id) => $(id).value.trim();
      try {
        await api('/api/builder/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v('ppAcName'), phone: v('ppAcPhone'), email: v('ppAcEmail'), billing_email: v('ppAcBill'), website: v('ppAcWeb'), license_number: v('ppAcLic'), address_line1: v('ppAcA1'), address_line2: v('ppAcA2'), city: v('ppAcCity'), state: v('ppAcState'), postal_code: v('ppAcZip') }) });
        await loadMe();
        paintShell();
        savedFlash(btn);
      } catch (ex) { formError('ppAccErr', ex); }
    });
    $('ppLogoIn').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const data = await readAsDataUrl(await shrinkLogo(file));
        await postJson('/api/builder/account/logo', { data_url: data });
        await loadMe();
        paintShell();
        render();
      } catch (ex) { formError('ppAccErr', ex); }
    });
    const rm = $('ppLogoRm');
    if (rm) rm.addEventListener('click', async () => { await postJson('/api/builder/account/logo', { data_url: '' }); await loadMe(); paintShell(); render(); });
  }
  /** Logos are resized to 512 px so big photos still upload. */
  async function shrinkLogo(file) {
    if (file.size < 600 * 1024 || !window.createImageBitmap) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k);
      cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      return blob ? new File([blob], 'logo.png', { type: 'image/png' }) : file;
    } catch (_) { return file; }
  }

  async function settingsPrices(head, token) {
    const all = await api('/api/builder/prices').then((r) => r.data || []).catch(() => []);
    if (token !== renderToken) return;
    const companies = state.builder.companies || [];
    setOut.innerHTML = `${head('Price lists', true)}
      <p class="pp-muted pp-meas-intro">The prices you agreed with each flooring company. When you send them a work order, lines without a price get yours, and different prices are flagged before you send.</p>
      ${companies.length ? `<div class="pp-card pp-set-list">${companies.map((c) => {
        const n = all.filter((p) => p.company_id === c.id).length;
        return `<a class="pp-set-row" href="#companies/${esc(c.id)}">${coLogo(c, 40)}<span><strong>${esc(c.company_name)}</strong><small>${n ? plural(n, 'price', 'prices') : 'No prices yet'}</small></span>${icon('chev')}</a>`;
      }).join('')}</div>` : `<div class="pp-card pp-empty">${mate('wave')}<strong>Connect a company first</strong><a class="pp-link" href="#companies">Companies</a></div>`}`;
  }

  function settingsTakeoff(head) {
    const t = state.builder.account.takeoff || { waste: {}, box_sf: {} };
    const kinds = [['hardwood', 'Hardwood'], ['lvp', 'LVP'], ['laminate', 'Laminate'], ['carpet', 'Carpet'], ['rubber', 'Rubber floor']];
    setOut.innerHTML = `${head('Takeoff & waste', true)}
      <p class="pp-muted pp-meas-intro">When you measure floors from the house plans, the material to order is the measured area plus this waste. Box coverage is optional — with it, the takeoff also shows how many boxes to order.</p>
      <form class="pp-card pp-block pp-set-form" id="ppTkForm" novalidate>
        <div class="pp-tk-grid" role="table" aria-label="Waste per floor type">
          <div class="pp-tk-row pp-tk-row--head" role="row"><span role="columnheader">Floor</span><span role="columnheader">Waste</span><span role="columnheader">Box coverage</span></div>
          ${kinds.map(([k, l]) => `<div class="pp-tk-row" role="row"><strong>${l}</strong>
            <label class="pp-tk-in"><input type="number" min="0" max="50" step="0.5" inputmode="decimal" data-tk-waste="${k}" value="${esc(t.waste && t.waste[k] != null ? t.waste[k] : 10)}" aria-label="${l} waste percent" /><span>%</span></label>
            <label class="pp-tk-in"><input type="number" min="0" max="500" step="0.01" inputmode="decimal" data-tk-box="${k}" value="${esc(t.box_sf && t.box_sf[k] ? t.box_sf[k] : '')}" placeholder="—" aria-label="${l} square feet per box" /><span>sf/box</span></label></div>`).join('')}
        </div>
        <p class="pp-error" id="ppTkErr" role="alert" hidden></p>
        <div class="pp-sheet-actions"><button type="submit" class="pp-btn pp-btn--pri" id="ppTkSave">Save</button></div>
      </form>`;
    $('ppTkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const waste = {}; const box = {};
      setOut.querySelectorAll('[data-tk-waste]').forEach((i) => { waste[i.getAttribute('data-tk-waste')] = Number(i.value) || 0; });
      setOut.querySelectorAll('[data-tk-box]').forEach((i) => { if (Number(i.value) > 0) box[i.getAttribute('data-tk-box')] = Number(i.value); });
      const btn = $('ppTkSave'); btn.disabled = true;
      try {
        const r = await api('/api/builder/account/takeoff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waste, box_sf: box }) });
        state.builder.account.takeoff = r.data;
        mateToast('measure', 'Waste saved', 'New takeoffs use these numbers.');
      } catch (ex) { formError('ppTkErr', ex); }
      btn.disabled = false;
    });
  }

  function settingsApp(head) {
    setOut.innerHTML = `${head('App', true)}
      <section class="pp-card pp-block pp-app-card">
        <img src="/assets/obrabuilder/icon-192.png?v=2" alt="" width="56" height="56" />
        <div><h3>ObraBuilder on your phone</h3><p class="pp-muted">Install the app to send work orders and measure on site from your home screen.</p></div>
        ${isStandaloneApp() ? '<span class="pp-chip pp-chip--ok">Installed</span>' : `<button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-install-app ${canInstallApp() ? '' : 'hidden'}>${icon('download')}Install</button>`}
      </section>
      ${!isStandaloneApp() && !canInstallApp() ? '<p class="pp-muted" style="max-width:880px">On iPhone, open this page in Safari and tap Share › Add to Home Screen. On Android, open it in Chrome and tap Install.</p>' : ''}
      <section class="pp-card pp-block" style="max-width:880px"><h3>Voice with Mate</h3><p class="pp-muted" style="margin:4px 0 0">In a measurement, tap Mate and say the sizes. Mate fills in treads, risers, nosings and vents, and you can undo.</p></section>`;
    paintInstall();
  }

  /* pickup hours: day chips + open/close times, saved as text like "Mon–Fri 6:30 AM – 3 PM · Sat 7 AM – 12 PM" */
  const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const HOUR_OPTS = (() => { const out = []; for (let m = 4 * 60; m <= 22 * 60; m += 30) out.push(m); return out; })();
  function fmtMin(min) { const h = Math.floor(min / 60); const mm = min % 60; const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${ap}`; }
  function parseMin(t) { const x = String(t).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?$/i); if (!x) return null; let h = Number(x[1]) % 12; if (/p/i.test(x[3])) h += 12; return h * 60 + Number(x[2] || 0); }
  function daysText(days) {
    const on = WEEK.map((_, i) => days.includes(i));
    const parts = []; let i = 0;
    while (i < 7) { if (!on[i]) { i += 1; continue; } let j = i; while (j + 1 < 7 && on[j + 1]) j += 1; parts.push(j - i >= 2 ? `${WEEK[i]}–${WEEK[j]}` : j > i ? `${WEEK[i]}, ${WEEK[j]}` : WEEK[i]); i = j + 1; }
    return parts.join(', ');
  }
  function hoursText(rows) { return rows.filter((r) => r.days.length && r.open != null && r.close != null).map((r) => `${daysText(r.days)} ${fmtMin(r.open)} – ${fmtMin(r.close)}`).join(' · ').slice(0, 120); }
  /** Reads hours typed before ("Mon–Fri 6:30 AM – 3 PM"); null when it can't be read. */
  function parseHours(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    const rows = [];
    for (const seg of t.split(/\s*[·;|]\s*|\n/)) {
      const x = seg.match(/^(.+?)\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s*(?:–|-|to)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)$/i);
      if (!x) return null;
      const days = [];
      for (const tok of x[1].split(/\s*[,&]\s*/)) {
        const r = tok.split(/\s*(?:–|-|to)\s*/).map((d) => WEEK.findIndex((w) => d.slice(0, 3).toLowerCase() === w.toLowerCase()));
        if (r.some((n) => n < 0)) return null;
        if (r.length === 2) { for (let k = r[0]; k <= r[1]; k += 1) days.push(k); } else days.push(r[0]);
      }
      const open = parseMin(x[2]); const close = parseMin(x[3]);
      if (open == null || close == null) return null;
      rows.push({ days: [...new Set(days)], open, close });
    }
    return rows;
  }
  /** Open now / opens at, from the parsed hours. */
  function hoursNow(text) {
    const rows = parseHours(text);
    if (!rows || !rows.length) return null;
    const d = new Date(); const day = (d.getDay() + 6) % 7; const min = d.getHours() * 60 + d.getMinutes();
    const today = rows.filter((r) => r.days.includes(day));
    if (today.some((r) => min >= r.open && min < r.close)) { const r = today.find((x) => min >= x.open && min < x.close); return { open: true, text: `Open · closes ${fmtMin(r.close)}` }; }
    const later = today.filter((r) => r.open > min).sort((a, b) => a.open - b.open)[0];
    if (later) return { open: false, text: `Closed · opens ${fmtMin(later.open)}` };
    for (let k = 1; k <= 7; k += 1) { const dd = (day + k) % 7; const r = rows.filter((x) => x.days.includes(dd)).sort((a, b) => a.open - b.open)[0]; if (r) return { open: false, text: `Closed · opens ${k === 1 ? 'tomorrow' : WEEK[dd]} ${fmtMin(r.open)}` }; }
    return null;
  }
  function hoursEditorHtml(rows, raw) {
    const timeSel = (v, attr) => `<select ${attr}>${HOUR_OPTS.map((m) => `<option value="${m}" ${m === v ? 'selected' : ''}>${fmtMin(m)}</option>`).join('')}</select>`;
    return `<div class="pp-hours" id="ppHours">
      ${rows === null ? `<p class="pp-hours-raw">Typed before: <b>${esc(raw)}</b><br><span class="pp-muted">Set the days and times below to replace it.</span></p>` : ''}
      ${(rows || []).map((r, i) => `<div class="pp-hours-row" data-hr="${i}">
        <div class="pp-hours-days" role="group" aria-label="Days">${WEEK.map((w, d) => `<button type="button" data-hr-day="${i}:${d}" aria-pressed="${r.days.includes(d)}">${w.slice(0, 2)}<span class="pp-sr">${w}</span></button>`).join('')}</div>
        <div class="pp-hours-time">${timeSel(r.open, `data-hr-open="${i}" aria-label="Opens"`)}<span>to</span>${timeSel(r.close, `data-hr-close="${i}" aria-label="Closes"`)}<button type="button" class="pp-q-ic pp-q-ic--del" data-hr-rm="${i}" aria-label="Remove these hours">×</button></div>
      </div>`).join('')}
      <div class="pp-hours-acts">
        ${(rows || []).length ? '<button type="button" class="pp-link" data-hr-add>+ Other days</button>' : `<button type="button" class="pp-chipbtn" data-hr-preset="weekdays">Mon–Fri 7 AM – 3 PM</button><button type="button" class="pp-chipbtn" data-hr-preset="sat">Mon–Sat</button><button type="button" class="pp-chipbtn" data-hr-preset="custom">Set hours</button>`}
      </div>
      <p class="pp-hours-out" ${(rows || []).length ? '' : 'hidden'}>${esc(hoursText(rows || []))}</p>
    </div>`;
  }
  function bindHoursEditor(root, state0) {
    const st = state0;
    const paint = () => { const box = root.querySelector('#ppHours'); box.outerHTML = hoursEditorHtml(st.rows, st.raw); bindHoursEditor(root, st); };
    const box = root.querySelector('#ppHours');
    box.querySelectorAll('[data-hr-day]').forEach((b) => b.addEventListener('click', () => {
      const [i, d] = b.getAttribute('data-hr-day').split(':').map(Number);
      const r = st.rows[i]; r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort();
      paint();
    }));
    box.querySelectorAll('[data-hr-open]').forEach((el) => el.addEventListener('change', () => { const r = st.rows[Number(el.getAttribute('data-hr-open'))]; r.open = Number(el.value); if (r.close <= r.open) r.close = Math.min(22 * 60, r.open + 8 * 60); paint(); }));
    box.querySelectorAll('[data-hr-close]').forEach((el) => el.addEventListener('change', () => { const r = st.rows[Number(el.getAttribute('data-hr-close'))]; r.close = Number(el.value); if (r.close <= r.open) r.open = Math.max(4 * 60, r.close - 60); paint(); }));
    box.querySelectorAll('[data-hr-rm]').forEach((b) => b.addEventListener('click', () => { st.rows.splice(Number(b.getAttribute('data-hr-rm')), 1); paint(); }));
    const add = box.querySelector('[data-hr-add]');
    if (add) add.addEventListener('click', () => { const used = new Set(st.rows.flatMap((r) => r.days)); const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !used.has(d)); st.rows.push({ days: free.includes(5) ? [5] : free.slice(0, 1), open: 7 * 60, close: 12 * 60 }); paint(); });
    box.querySelectorAll('[data-hr-preset]').forEach((b) => b.addEventListener('click', () => {
      const k = b.getAttribute('data-hr-preset');
      st.rows = k === 'sat' ? [{ days: [0, 1, 2, 3, 4], open: 7 * 60, close: 15 * 60 }, { days: [5], open: 7 * 60, close: 12 * 60 }] : [{ days: [0, 1, 2, 3, 4], open: 7 * 60, close: 15 * 60 }];
      if (k !== 'custom') { /* preset as is */ }
      paint();
    }));
  }

  async function settingsPickups(head, token) {
    const list = await ensurePickups(true);
    if (token !== renderToken) return;
    const open = (loc) => {
      const l = loc || { name: '', address: '', aliases: [], phone: '', hours: '', notes: '', is_default: !list.length };
      const aliases = (l.aliases || []).filter((a) => a.toLowerCase() !== String(l.name || '').toLowerCase()).join(', ');
      const root = openSheet(loc ? 'Edit pickup location' : 'New pickup location', `<form class="pp-fields" id="ppPickForm" novalidate>
          <div class="pp-field pp-field--wide"><label for="ppPkName">Name *</label><input id="ppPkName" maxlength="80" required value="${esc(l.name)}" placeholder="e.g. TriWest Henderson" /></div>
          <div class="pp-field pp-field--wide"><label for="ppPkAliases">Name on work orders <span>(comma separated)</span></label><input id="ppPkAliases" maxlength="300" value="${esc(aliases)}" placeholder="e.g. TRIWEST, TW Henderson" /></div>
          <div class="pp-field pp-field--wide"><label for="ppPkAddr">Address *</label><input id="ppPkAddr" maxlength="300" required placeholder="Start typing the address" value="${esc(l.address)}" data-om-address-autocomplete data-crm-address-autocomplete="1" /></div>
          <div class="pp-field"><label for="ppPkPhone">Phone</label><input id="ppPkPhone" type="tel" inputmode="tel" maxlength="40" value="${esc(l.phone || '')}" /></div>
          <div class="pp-field pp-field--wide"><span class="pp-flabel">Pickup hours</span>${hoursEditorHtml(parseHours(l.hours), l.hours || '')}</div>
          <div class="pp-field pp-field--wide"><label for="ppPkNotes">Notes for the crew</label><input id="ppPkNotes" maxlength="500" value="${esc(l.notes || '')}" placeholder="e.g. Will-call door on the north side" /></div>
          <label class="pp-check pp-field--wide"><input type="checkbox" id="ppPkDefault" ${l.is_default ? 'checked' : ''} /> Default pickup location</label>
          <p class="pp-error pp-field--wide" id="ppPkError" role="alert" hidden></p>
          <div class="pp-sheet-actions pp-field--wide">${loc ? '<button type="button" class="pp-btn pp-btn--sec pp-late" data-pk-del>Delete</button>' : ''}<button type="submit" class="pp-btn pp-btn--pri">${loc ? 'Save location' : 'Add location'}</button></div>
        </form>`);
      const hrs = { rows: parseHours(l.hours), raw: l.hours || '' };
      bindHoursEditor(root, hrs);
      root.querySelector('#ppPickForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('ppPkName').value.trim();
        const address = $('ppPkAddr').value.trim();
        if (name.length < 2 || address.length < 4) { formError('ppPkError', { message: 'Enter a name and the address of the pickup location.' }); return; }
        const payload = {
          name, address,
          aliases: $('ppPkAliases').value.split(/[,;\n]/).map((a) => a.trim()).filter((a) => a.length >= 2).slice(0, 11),
          phone: $('ppPkPhone').value.trim(), hours: hrs.rows === null ? hrs.raw : hoursText(hrs.rows), notes: $('ppPkNotes').value.trim(), is_default: $('ppPkDefault').checked,
        };
        try {
          if (loc) await api(`/api/builder/pickups/${encodeURIComponent(loc.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          else await postJson('/api/builder/pickups', payload);
          closeSheet();
          render();
          mateToast('delivery', 'Pickup location saved', 'Work orders that name it get the address automatically.');
        } catch (ex) { formError('ppPkError', ex); }
      });
      const del = root.querySelector('[data-pk-del]');
      if (del) del.addEventListener('click', async () => {
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
        try { await api(`/api/builder/pickups/${encodeURIComponent(loc.id)}`, { method: 'DELETE' }); closeSheet(); render(); } catch (ex) { formError('ppPkError', ex); }
      });
    };
    setOut.innerHTML = `${head('Pickup locations', true)}
      <p class="pp-muted pp-meas-intro">Supplier yards where your crews pick up delivered material. When a work order names one (like <code>TRIWEST 9176215</code>), the job gets the full address and the order number automatically.</p>
      <div class="pp-sheet-actions" style="justify-content:flex-start;max-width:880px;margin-bottom:12px"><button type="button" class="pp-btn pp-btn--pri" data-pk-new>+ Add location</button></div>
      ${list.length ? `<div class="pp-card pp-set-list">${list.map((l) => `<button type="button" class="pp-set-row" data-pk="${esc(l.id)}"><span class="pp-set-ic">${icon('pin')}</span><span><strong>${esc(l.name)}${l.is_default ? ' <span class="pp-chip pp-chip--ok">Default</span>' : ''}</strong><small>${esc(l.address)}</small>${(() => { const n = hoursNow(l.hours); return n ? `<small class="pp-hours-now ${n.open ? 'is-open' : ''}"><i aria-hidden="true"></i>${esc(n.text)}</small>` : ''; })()}${[l.hours, l.phone].filter(Boolean).length ? `<small>${esc([l.hours, l.phone].filter(Boolean).join(' · '))}</small>` : ''}<small class="pp-pick-alias">Matches: ${(l.aliases || []).map((a) => `<code>${esc(a)}</code>`).join(' ')}</small></span>${icon('chev')}</button>`).join('')}</div>` : `<div class="pp-card pp-empty">${mate('delivery', 110)}<strong>No pickup locations yet</strong>Add the yards and warehouses your suppliers use.</div>`}`;
    view.querySelectorAll('[data-pk-new]').forEach((b) => b.addEventListener('click', () => open(null)));
    view.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => open(list.find((x) => x.id === b.getAttribute('data-pk')))));
  }

  /* ─────────────────────────── install the app (PWA) ─────────────────────────── */

  let installEvt = null;
  function isStandaloneApp() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIosDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }
  function canInstallApp() {
    return !isStandaloneApp() && Boolean(installEvt || isIosDevice());
  }
  function paintInstall() {
    const ok = canInstallApp();
    document.querySelectorAll('[data-install-app]').forEach((el) => { el.hidden = !ok; });
  }
  function iosInstallSheet() {
    const old = $('ppIosSheet');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="pp-ios-sheet" id="ppIosSheet" role="dialog" aria-modal="true" aria-labelledby="ppIosTitle">
      <div class="pp-ios-card">
        <div class="pp-ios-top"><img src="/assets/obrabuilder/icon-192.png?v=2" alt="" width="52" height="52" /><div><strong id="ppIosTitle">Install ObraBuilder</strong><span>Add it to your Home Screen</span></div>${mate('thumbs', 64)}</div>
        <ol>
          <li>Tap <b>Share</b> <svg viewBox="0 0 24 24" aria-label="Share icon"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg> at the bottom of Safari.</li>
          <li>Scroll and tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b>. ObraBuilder opens like an app.</li>
        </ol>
        <button type="button" class="pp-btn pp-btn--pri" data-ios-close style="width:100%">Got it</button>
      </div>
    </div>`);
    const sheet = $('ppIosSheet');
    sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-ios-close]')) sheet.remove(); });
  }
  async function installApp() {
    if (installEvt) {
      const evt = installEvt;
      installEvt = null;
      evt.prompt();
      try { await evt.userChoice; } catch (_) { /* dismissed */ }
      paintInstall();
      return;
    }
    if (isIosDevice()) iosInstallSheet();
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; paintInstall(); });
  window.addEventListener('appinstalled', () => { installEvt = null; paintInstall(); });
  window.addEventListener('hashchange', () => { const sh = $('ppIosSheet'); if (sh) sh.remove(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-install-app]');
    if (b) { e.preventDefault(); openMenu(false); installApp(); }
    const x = e.target.closest('[data-install-dismiss]');
    if (x) { try { localStorage.setItem('ob_install_dismissed', String(Date.now())); } catch (_) { /* private mode */ } const card = x.closest('.pp-install-banner'); if (card) card.remove(); }
  });
  /** Phone-only invitation on Home to install the app (dismissible for 30 days). */
  function installBannerHtml() {
    if (!canInstallApp() || !window.matchMedia('(max-width: 1023px)').matches) return '';
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem('ob_install_dismissed') || 0); } catch (_) { dismissed = 0; }
    if (dismissed && Date.now() - dismissed < 30 * 86400000) return '';
    return `<div class="pp-card pp-install-banner"><img src="/assets/obrabuilder/icon-192.png?v=2" alt="" width="44" height="44" /><div><strong>Get the app</strong><span>ObraBuilder on your home screen — faster on site.</span></div><button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-install-app>Install</button><button type="button" class="pp-ibtn pp-install-x" data-install-dismiss aria-label="Not now">×</button></div>`;
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/obrabuilder-sw.js', { scope: '/partner' }).catch(() => {}); });
  }

  function unitLabel(unit) {
    return ({ sq_ft: 'sq ft', linear_ft: 'linear ft', step: 'step', unit: 'unit', hour: 'hour', each: 'each' })[unit] || String(unit || '').replace(/_/g, ' ');
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
            <label class="pp-sr" for="ppEdQ-${kind}-${i}">Quantity of ${esc(sv.name)}</label>
            <input id="ppEdQ-${kind}-${i}" type="number" min="0" step="0.01" value="${esc(sv.quantity)}" data-q="${kind}:${i}" ${sv.remove ? 'disabled' : ''} />
            <span class="pp-muted">${esc(unitLabel(sv.unit))}</span>
            <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-rm="${kind}:${i}">${sv.remove ? 'Undo' : 'Remove'}</button>
          </div>
          <input type="text" placeholder="Service note (optional)" maxlength="500" value="${esc(sv.notes)}" data-n="${kind}:${i}" ${sv.remove ? 'disabled' : ''} />
        </li>`;
      pane.innerHTML = `
        <div class="tk tk--edit">
          <section class="tk-hero">
            <div class="tk-hero-top"><button type="button" class="pp-back" data-ed-cancel style="display:inline-flex">${icon('back')}Back</button><div class="tk-meta"><span class="tk-num">EDIT JOB${job.number ? ` #${esc(job.number)}` : ''}</span></div></div>
            <p class="pp-muted" style="margin:0 0 4px">Changes apply right away in ${esc(providerName())}'s system and their office is notified.</p>
          </section>
          <section class="tk-sec pp-fields" style="grid-template-columns:1fr 1fr">
            <div class="pp-field pp-field--wide"><label for="ppEdTitle">Title</label><input id="ppEdTitle" maxlength="160" value="${esc(job.title || '')}" /></div>
            <div class="pp-field pp-field--wide"><label for="ppEdAddr">Address</label><input id="ppEdAddr" maxlength="300" placeholder="Start typing the address" value="${esc(job.address || '')}" data-om-address-autocomplete data-crm-address-autocomplete="1" /></div>
            <div class="pp-field"><label for="ppEdDate">Date</label><input id="ppEdDate" type="date" value="${esc(start.date)}" /></div>
            <div class="pp-field"><label for="ppEdTime">Time <span>(empty = all day)</span></label><input id="ppEdTime" type="time" value="${job.all_day ? '' : esc(start.time)}" /></div>
            <div class="pp-field"><label for="ppEdEnd">Ends on</label><input id="ppEdEnd" type="date" value="${esc(end.date)}" /></div>
            <div class="pp-field"><label for="ppEdLock">Lockbox code</label><input id="ppEdLock" maxlength="40" value="${esc(lockbox)}" /></div>
            <div class="pp-field pp-field--wide"><label for="ppEdAttn">Attention (highlighted for the crew)</label><input id="ppEdAttn" maxlength="2000" value="${esc(t.attention || '')}" /></div>
            <div class="pp-field pp-field--wide"><label for="ppEdNotes">Instructions</label><textarea id="ppEdNotes" maxlength="5000">${esc(instructions)}</textarea></div>
          </section>
          <section class="tk-sec">
            <h3>Services</h3>
            <ul class="tk-list pp-ed-list">${services.map((sv, i) => svcRow(sv, i, 'e')).join('')}${added.map((sv, i) => svcRow(sv, i, 'a')).join('')}</ul>
            ${state.priceList.length ? `<div class="pp-field" style="margin-top:12px"><label for="ppEdAdd">Add a service from ${esc(providerName())}'s price list</label><select id="ppEdAdd"><option value="">Choose a service…</option>${state.priceList.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}${it.price != null ? ` · ${money(it.price)} / ${esc(unitLabel(it.unit))}` : ''}</option>`).join('')}</select></div>` : '<p class="tk-empty" style="margin-top:10px">The company hasn’t shared its price list in the portal. Describe new services in the instructions.</p>'}
          </section>
          <p class="pp-error" id="ppEdError" role="alert" hidden></p>
          <div class="pp-form-actions" style="border:0"><button type="button" class="pp-btn pp-btn--sec" data-ed-cancel>Cancel</button><button type="button" class="pp-btn pp-btn--pri" id="ppEdSave">Save changes</button></div>
        </div>
        <div class="pp-fixbar"><button type="button" class="pp-btn pp-btn--sec" data-ed-cancel>Cancel</button><button type="button" class="pp-btn pp-btn--pri" data-ed-save>Save</button></div>`;
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
      if (added.some((sv) => !(sv.quantity > 0))) { err.textContent = 'Enter the quantity of the added services.'; err.hidden = false; return; }
      if (svc.length) payload.services = svc;
      if (!Object.keys(payload).length) { render(); return; }
      const btns = pane.querySelectorAll('#ppEdSave, [data-ed-save]');
      btns.forEach((b) => { b.disabled = true; b.textContent = 'Saving…'; });
      try {
        await api(`/api/partner-portal/jobs/${encodeURIComponent(job.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), co });
        state.jobDetail.delete(job.id);
        await refreshOverview();
        await render();
      } catch (e) {
        err.textContent = e.message || 'Could not save.';
        err.hidden = false;
        btns.forEach((b) => { b.disabled = false; b.textContent = 'Save changes'; });
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
    $('ppBrandSub').textContent = 'ObraBuilder';
    const mark = $('ppMark');
    if (state.builder.account.logo_url) { mark.innerHTML = `<img src="${esc(state.builder.account.logo_url)}" alt="" />`; mark.classList.add('has-logo'); }
    else { mark.textContent = initials(state.builder.account.name); mark.classList.remove('has-logo'); }
    document.title = `${state.builder.account.name} · ObraBuilder`;
    const tools = $('ppProviderTools');
    const companies = state.builder.companies || [];
    tools.hidden = false;
    tools.innerHTML = `<label>${companies.length ? `Companies · ${companies.length}` : 'Companies'}</label><a class="pp-menu-item" href="#companies" style="text-decoration:none">${canDo('companies.manage') ? 'Connect or invite a company' : 'View companies'}</a><a class="pp-menu-item" href="#team" style="text-decoration:none">Team</a>${canDo('team.manage') ? '<a class="pp-menu-item" href="#settings" style="text-decoration:none">Settings</a>' : ''}`;
    document.querySelectorAll('[data-builder-only]').forEach((el) => { el.hidden = false; });
    document.querySelectorAll('[data-nav="invoices"]').forEach((el) => { el.hidden = !canDo('money.view'); });
    document.querySelectorAll('[data-nav="measurements"]').forEach((el) => { el.hidden = !canDo('measure'); });
    document.querySelectorAll('[data-nav="settings"]').forEach((el) => { el.hidden = false; });
    $('ppMateBtn').hidden = !state.builder.ai_reader;
    // Phone tab bar: Measure replaces Calendar for builders who measure (Calendar moves to More).
    document.querySelectorAll('.pp-tab[data-nav="calendario"]').forEach((el) => { el.hidden = canDo('measure'); });
    paintInstall();
  }

  /* ─────────────────────────── measurements (stairs & vents) ─────────────────────────── */

  const LOG_EN = { criou: 'created it', editou: 'edited', concluiu: 'completed it', reabriu: 'reopened it', 'enviou com a work order': 'sent it with the Work Order' };
  function fmtDayEn(value, opts) {
    const d = value instanceof Date ? value : toDate(value);
    if (!d) return '';
    return new Intl.DateTimeFormat('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  }
  const SPECIES = ['White Oak', 'Red Oak', 'Hickory', 'Maple', 'Walnut', 'Ash', 'Brazilian Cherry'];
  const FINISHES = ['Unfinished (site finished)', 'Prefinished', 'Primed'];
  const VENT_SIZES = ['2x10', '2x12', '3x10', '3x12', '4x10', '4x12', '4x14', '6x10', '6x12'];
  const OPEN_OPTS = [['none', 'Closed'], ['left', 'Left open'], ['right', 'Right open'], ['both', 'Both open']];
  const RET_OPTS = [['45', '45° (mitered)'], ['flat', 'Flat'], ['bullnose', 'Bullnose']];
  const VENT_TYPES = [['flush', 'Flush mount'], ['self_rimming', 'Self-rimming (drop-in)'], ['return_air', 'Return air']];
  const RISER_OPTS = [['same', 'Same wood'], ['primed', 'Primed'], ['paint_grade', 'Paint grade'], ['none', 'No riser']];
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
    if (open === 'none') return 'closed';
    const side = { left: 'left open', right: 'right open', both: 'both sides open' }[open] || open;
    return `${side} · ${{ '45': '45°', flat: 'flat', bullnose: 'bullnose' }[ret] || ret}`;
  }
  function treadSteps(stair) {
    return (stair.steps || []).filter((step) => step.kind !== 'riser' && (step.tread_w || step.tread_d));
  }
  function nosingPositionLabel(stair, nosing) {
    if (nosing.position === 'landing' && stair.landing && stair.landing.enabled) return 'landing edge';
    const treads = treadSteps(stair);
    const index = treads.findIndex((step) => step.id === nosing.position);
    return `tread ${index >= 0 ? index + 1 : treads.length || 'at top'}`;
  }
  /** Same grouping the PDF uses: equal pieces counted together. */
  function measSummary(data) {
    const out = [];
    (data.stairs || []).forEach((s) => {
      const wood = [s.species, s.finish, s.color].filter(Boolean).join(' · ');
      const label = s.name || 'Stair';
      const tr = new Map();
      const ri = new Map();
      (s.steps || []).forEach((st) => {
        if (st.kind !== 'riser' && (st.tread_w || st.tread_d)) { const k = `${fmtIn(st.tread_w) || '?'}" × ${fmtIn(st.tread_d) || '?'}" · ${openText(st.open, st.ret)}`; tr.set(k, (tr.get(k) || 0) + 1); }
        const hasRiser = st.kind === 'riser' ? s.riser_material !== 'none' : !st.no_riser && s.riser_material !== 'none';
        if (hasRiser && (st.riser_w || st.riser_h)) { const k = `${fmtIn(st.riser_w) || '?'}" × ${fmtIn(st.riser_h) || '?'}"`; ri.set(k, (ri.get(k) || 0) + 1); }
      });
      tr.forEach((n, k) => out.push({ kind: 'Tread', group: label, text: `${wood ? `${wood} · ` : ''}${k}`, qty: n }));
      const rw = s.riser_material === 'primed' ? 'Primed' : s.riser_material === 'paint_grade' ? 'Paint grade' : wood;
      ri.forEach((n, k) => out.push({ kind: 'Riser', group: label, text: `${rw ? `${rw} · ` : ''}${k}`, qty: n }));
      (s.nosings || []).forEach((ns) => { if (ns.length) out.push({ kind: 'Nosing', group: label, text: `${fmtIn(ns.length)}" · ${{ flush: 'flush', overlap: 'overlap', stair_nose: 'stair nose' }[ns.type] || ns.type} · ${nosingPositionLabel(s, ns)}`, qty: ns.qty || 1 }); });
      if (s.landing && s.landing.enabled) out.push({ kind: 'Landing', group: label, text: `${fmtIn(s.landing.width) || '?'}" × ${fmtIn(s.landing.depth) || '?'}" · after final riser`, qty: 1 });
    });
    const vm = new Map();
    (data.vents || []).forEach((v) => {
      const k = `${v.size || '?'} · ${(VENT_TYPES.find((t) => t[0] === v.type) || [0, v.type])[1]}${[v.species, v.finish, v.color].filter(Boolean).length ? ` · ${[v.species, v.finish, v.color].filter(Boolean).join(' · ')}` : ''}`;
      vm.set(k, (vm.get(k) || 0) + (v.qty || 1));
    });
    vm.forEach((n, k) => out.push({ kind: 'Vent', group: 'Vents', text: k, qty: n }));
    planTotals(data.plan).filter((t) => t.include).forEach((t) => out.push({ kind: 'Floor', group: t.levels.map((l) => `${l.name} ${fmtSf(l.area)}`).join(' · '), text: `${t.label}${specText(t) ? ` · ${specText(t)}` : ''}${t.kind === 'hardwood' && t.sand_finish ? ' · sand & finish' : ''}`, qty: Math.round(t.area), uom: 'SF' }));
    return out;
  }
  function measCounts(data) {
    let treads = 0; let risers = 0; let nosings = 0;
    (data.stairs || []).forEach((s) => {
      (s.steps || []).forEach((st) => {
        if (st.kind !== 'riser' && (st.tread_w || st.tread_d)) treads += 1;
        const hasRiser = st.kind === 'riser' ? s.riser_material !== 'none' : !st.no_riser && s.riser_material !== 'none';
        if (hasRiser && (st.riser_w || st.riser_h)) risers += 1;
      });
      (s.nosings || []).forEach((n) => { if (n.length) nosings += n.qty || 1; });
    });
    const vents = (data.vents || []).reduce((a, v) => a + (v.qty || 1), 0);
    const landings = (data.stairs || []).filter((s) => s.landing && s.landing.enabled).length;
    return { stairs: (data.stairs || []).length, treads, risers, nosings, landings, vents };
  }
  function countsText(c) {
    return [c.stairs ? `${c.stairs} ${c.stairs === 1 ? 'stair' : 'stairs'}` : '', c.treads ? `${c.treads} treads` : '', c.risers ? `${c.risers} risers` : '', c.nosings ? `${c.nosings} ${c.nosings === 1 ? 'nosing' : 'nosings'}` : '', c.landings ? `${c.landings} ${c.landings === 1 ? 'landing' : 'landings'}` : '', c.vents ? `${c.vents} ${c.vents === 1 ? 'vent' : 'vents'}` : '', c.floor_text || ''].filter(Boolean).join(' · ') || 'Nothing measured yet';
  }
  /** Asks before deleting a measurement (photos and plans go with it). */
  function confirmMeasDelete(m, done) {
    const c = m.counts || measCounts(m.data || {});
    const what = countsText(c);
    const root = openSheet('Delete measurement?', `<div class="pp-del-sheet">
        <div class="pp-del-ic" aria-hidden="true">${icon('trash')}</div>
        <p><strong>${esc(m.address)}</strong>${what ? `<small>${esc(what)}</small>` : ''}</p>
        <p class="pp-muted">The measurement, its photos and plans are deleted. This can’t be undone.</p>
        <p class="pp-error" data-del-err role="alert" hidden></p>
        <div class="pp-sheet-actions"><button type="button" class="pp-btn pp-btn--sec" data-sheet-close>Keep it</button><button type="button" class="pp-btn pp-btn--danger" data-del-go>Delete</button></div>
      </div>`, { noFocus: true });
    root.querySelector('[data-del-go]').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = 'Deleting…';
      try {
        await api(`/api/builder/measurements/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        closeSheet();
        mateToast('head-happy', 'Measurement deleted', m.address);
        done();
      } catch (ex) {
        b.disabled = false; b.textContent = 'Delete';
        const er = root.querySelector('[data-del-err]'); er.textContent = ex.message; er.hidden = false;
      }
    });
  }
  function measStatusChip(m) {
    if (m.status === 'used') return '<span class="pp-chip pp-chip--dark">Sent with job</span>';
    if (m.status === 'done') return '<span class="pp-chip pp-chip--ok">Complete</span>';
    return '<span class="pp-chip pp-chip--late">In progress</span>';
  }
  function newStair(n) {
    return { id: uid(), name: n ? `Stair ${n}` : 'Main stair', layout: 'straight', round_diameter: null, round_center_diameter: null, round_sweep: '270', starts_on_landing_of: null, turn: 'straight', landing: { enabled: false, width: null, depth: null }, species: 'White Oak', finish: FINISHES[0], color: '', riser_material: 'same', steps: [], nosings: [], photos: [], note: '' };
  }
  function newStep(prev, kind) {
    const componentKind = kind || 'step';
    if (componentKind === 'riser') {
      return { id: uid(), kind: 'riser', tread_w: null, tread_d: null, riser_w: prev && (prev.riser_w || prev.tread_w) || null, riser_h: prev && prev.riser_h || null, open: 'none', ret: '45', no_riser: false, note: '' };
    }
    return prev
      ? { ...prev, id: uid(), kind: componentKind, note: '' }
      : { id: uid(), kind: componentKind, tread_w: null, tread_d: null, riser_w: null, riser_h: null, open: 'none', ret: '45', no_riser: false, note: '' };
  }
  function newVent(prev) {
    return prev ? { ...prev, id: uid(), room: '', photos: [], note: '' } : { id: uid(), room: '', size: '4x10', type: 'flush', species: 'White Oak', finish: FINISHES[0], color: '', qty: 1, photos: [], note: '' };
  }

  const MEAS_FILTERS = [['all', 'All'], ['draft', 'In progress'], ['done', 'Complete'], ['used', 'Sent with job']];

  async function renderMeasurements(id, token) {
    if (id && id !== 'new') return renderMeasurement(id, token);
    const r = await api('/api/builder/measurements');
    if (token !== renderToken) return;
    const rows = r.data || [];
    state.homeMeas = rows;
    const f = state.measFilter || 'all';
    const q = String(state.measQuery || '').trim().toLowerCase();
    const count = (k) => (k === 'all' ? rows.length : rows.filter((m) => m.status === k).length);
    const list = rows.filter((m) => (f === 'all' || m.status === f) && (!q || String(m.address || '').toLowerCase().includes(q)));
    const pills = (c) => [c.treads ? `<span><b>${c.treads}</b> treads</span>` : '', c.risers ? `<span><b>${c.risers}</b> risers</span>` : '', c.nosings ? `<span><b>${c.nosings}</b> nosings</span>` : '', c.vents ? `<span><b>${c.vents}</b> vents</span>` : '', c.floor_sf ? `<span><b>${Number(c.floor_sf).toLocaleString('en-US')}</b> sf floors</span>` : ''].filter(Boolean).join('') || '<span class="pp-muted">Nothing measured yet</span>';
    const card = (m) => `<div class="pp-mcard-wrap">${m.status === 'used' ? '' : `<button type="button" class="pp-mcard-del" data-meas-del="${esc(m.id)}" aria-label="Delete measurement at ${esc(m.address)}" title="Delete">${icon('trash')}</button>`}<a class="pp-card pp-mcard is-${esc(m.status)}" href="#measurements/${esc(m.id)}">
        <span class="pp-mcard-ic" aria-hidden="true">${icon('ruler')}</span>
        <span class="pp-mcard-main">
          <span class="pp-mcard-top"><strong>${esc(m.address)}</strong>${measStatusChip(m)}</span>
          <span class="pp-mcard-pills">${pills(m.counts || {})}</span>
          <small>${(() => { const t = measuredText(m); return `${t.typed ? 'Measured by ' : ''}${esc(t.who)} · ${esc(t.on)}`; })()}</small>
        </span>
        ${m.status === 'draft' ? '<span class="pp-mcard-go">Continue</span>' : icon('chev')}
      </a></div>`;
    view.innerHTML = `
      <div class="pp-head"><div><p class="pp-eyebrow">${esc(state.builder.account.name)}</p><h1>Measurements</h1></div><div class="pp-head-actions"><button type="button" class="pp-btn pp-btn--sec" id="ppMeasPlanBtn">${icon('upload')}From plans</button><button type="button" class="pp-btn pp-btn--pri" id="ppMeasNewBtn">${icon('locate')}New measurement</button></div></div>
      ${rows.length ? `<div class="pp-mlist-bar">
        <label class="pp-search pp-mlist-search" for="ppMeasQ">${icon('search')}<span class="pp-sr">Search measurements</span><input id="ppMeasQ" type="search" placeholder="Search by address" value="${esc(state.measQuery || '')}" autocomplete="off" /></label>
        <div class="pp-filter pp-side-filter" role="group" aria-label="Status">${MEAS_FILTERS.map(([k, l]) => `<button type="button" data-mfilter="${k}" aria-pressed="${f === k}">${l} · ${count(k)}</button>`).join('')}</div>
      </div>
      <div class="pp-mlist">${list.length ? list.map(card).join('') : `<div class="pp-card pp-empty">${mate('head-curious', 64)}<strong>No measurements match</strong>Change the search or the filter.</div>`}</div>`
      : `<div class="pp-card pp-empty pp-mempty">${mate('measure', 150)}<strong>Measure stairs and vents on site</strong>Stand at the house and tap <b>New measurement</b> — Mate finds the address. Each measurement goes with the Work Order for that house.<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button type="button" class="pp-btn pp-btn--pri" data-meas-new>${icon('locate')}New measurement</button><button type="button" class="pp-btn pp-btn--sec" data-meas-plan>${icon('upload')}From plans</button></div></div>`}`;
    view.querySelectorAll('#ppMeasNewBtn, [data-meas-new]').forEach((b) => b.addEventListener('click', () => openNewMeasurement(false)));
    view.querySelectorAll('#ppMeasPlanBtn, [data-meas-plan]').forEach((b) => b.addEventListener('click', () => openPlanUpload()));
    view.querySelectorAll('[data-mfilter]').forEach((b) => b.addEventListener('click', () => { state.measFilter = b.getAttribute('data-mfilter'); render(); }));
    view.querySelectorAll('[data-meas-del]').forEach((b) => b.addEventListener('click', () => {
      const m = rows.find((x) => x.id === b.getAttribute('data-meas-del'));
      if (m) confirmMeasDelete(m, () => { state.homeMeas = null; render(); });
    }));
    const qi = $('ppMeasQ');
    if (qi) qi.addEventListener('input', () => { state.measQuery = qi.value; const pos = qi.selectionStart; render().then(() => { const x = $('ppMeasQ'); if (x) { x.focus(); x.setSelectionRange(pos, pos); } }); });
    if (id === 'new') { history.replaceState(null, '', '#measurements'); openNewMeasurement(window.matchMedia('(max-width: 1023px)').matches); }
  }

  /** New measurement: address by phone location (or typed), and earlier measurements at the same house. */
  function openNewMeasurement(autoLocate) {
    const root = openSheet('New measurement', `
      <form id="ppMeasNew" novalidate>
        <button type="button" class="pp-geo-btn" id="ppMnGeo">${icon('locate')}<span><strong>Use my location</strong><small>Find the address of the house you’re at</small></span></button>
        <div id="ppMnNear"></div>
        <div class="pp-field" style="margin-top:12px"><label for="ppMnAddr">Job address *</label><input id="ppMnAddr" maxlength="300" autocomplete="street-address" data-om-address-autocomplete data-crm-address-autocomplete="1" required placeholder="e.g. 322 Lower Ranch View Rd, Granby, CO" /></div>
        <p class="pp-error" id="ppMnErr" role="alert" hidden></p>
        <div class="pp-sheet-actions"><button type="submit" class="pp-btn pp-btn--pri" id="ppMnSave">Start measuring</button></div>
      </form>`, { noFocus: true });
    let geo = null;
    const geoBtn = root.querySelector('#ppMnGeo');
    const locate = () => {
      if (!navigator.geolocation) { formError('ppMnErr', { message: 'This phone can’t share its location. Type the address.' }); return; }
      geoBtn.disabled = true;
      geoBtn.querySelector('strong').textContent = 'Finding where you are…';
      navigator.geolocation.getCurrentPosition(async (pos) => {
        geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try {
          const r = await postJson('/api/builder/geo', geo);
          const place = r.data.place;
          if (place && place.address && $('ppMnAddr')) $('ppMnAddr').value = place.address;
          geoBtn.querySelector('strong').textContent = place ? 'Address found' : 'Location found';
          geoBtn.querySelector('small').textContent = place ? 'Check it and start measuring' : 'Type the street address';
          geoBtn.classList.add('is-done');
          const near = r.data.nearby || [];
          const box = $('ppMnNear');
          if (box) box.innerHTML = near.length ? `<div class="pp-match"><strong>Already measured here</strong>${near.map((m) => `<a class="pp-today-item" href="#measurements/${esc(m.id)}"><span class="pp-today-time">${icon('ruler')}</span><span class="pp-today-main"><strong>${esc(m.address)}</strong><small>${esc(countsText(m.counts))} · ${esc(fmtDayEn(m.updated_at))}</small></span>${measStatusChip(m)}</a>`).join('')}</div>` : '';
        } catch (ex) {
          formError('ppMnErr', ex);
          geoBtn.querySelector('strong').textContent = 'Use my location';
        }
        geoBtn.disabled = false;
      }, (err) => {
        geoBtn.disabled = false;
        geoBtn.querySelector('strong').textContent = 'Use my location';
        formError('ppMnErr', { message: err && err.code === 1 ? 'Location is off for this site. Allow it in your browser settings, or type the address.' : 'Could not get your location. Type the address.' });
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    };
    geoBtn.addEventListener('click', locate);
    if (autoLocate && navigator.geolocation) locate();
    root.querySelector('#ppMeasNew').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('ppMnErr').hidden = true;
      const btn = $('ppMnSave');
      if ($('ppMnAddr').value.trim().length < 4) { formError('ppMnErr', { message: 'Enter the job address.' }); return; }
      btn.disabled = true;
      try {
        const res = await postJson('/api/builder/measurements', { address: $('ppMnAddr').value.trim(), ...(geo || {}) });
        closeSheet();
        location.hash = `#measurements/${res.data.id}`;
      } catch (ex) {
        formError('ppMnErr', ex);
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
      const r = await api(`/api/builder/measurements/${encodeURIComponent(m.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: m.data, notes: m.notes || '' }) });
      m.updated_at = r.data.updated_at;
      m.log = r.data.log;
      m.saveError = '';
    } catch (e) {
      m.dirty = true;
      m.saveError = e.message || 'Not saved.';
    }
    m.saving = false;
    paintMeasSaved();
  }
  function paintMeasSaved() {
    const el = $('ppMeasSaved');
    const m = state.meas;
    if (!el || !m) return;
    el.textContent = m.saveError ? `Not saved · ${m.saveError}` : m.saving ? 'Saving…' : m.dirty ? 'Editing…' : 'Saved';
    el.classList.toggle('pp-late', Boolean(m.saveError));
  }
  window.addEventListener('beforeunload', () => { if (state.meas && state.meas.dirty) measSaveNow(); });

  async function renderMeasurement(id, token) {
    if (!state.meas || state.meas.id !== id) {
      if (state.meas && state.meas.dirty) await measSaveNow();
      const r = await api(`/api/builder/measurements/${encodeURIComponent(id)}`);
      if (token !== renderToken) return;
      const hasPlan = r.data.data && r.data.data.plan && (r.data.data.plan.levels || []).length;
      state.meas = { ...r.data, tab: hasPlan && !measCounts(r.data.data).treads && !measCounts(r.data.data).vents ? 'floors' : 'stairs', dirty: false };
    }
    paintMeasurement();
  }

  function sel(opts, value, attrs) {
    return `<select ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }
  function selFree(list, value, attrs, otherLabel) {
    const has = !value || list.includes(value);
    return `<select ${attrs}>${list.map((v) => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}<option value="__other" ${has ? '' : 'selected'}>${esc(otherLabel || 'Other…')}</option></select>${has ? '' : ''}`;
  }
  function photoStrip(m, list, path) {
    const locked = m.status === 'used';
    return `<div class="pp-meas-photos">${(list || []).map((k, i) => `<span class="pp-meas-ph"><img src="/api/builder/measurements/${encodeURIComponent(m.id)}/photo?key=${encodeURIComponent(k)}" alt="Photo ${i + 1}" loading="lazy" />${locked ? '' : `<button type="button" data-ph-rm="${esc(path)}" data-ph-i="${i}" aria-label="Remove photo ${i + 1}">×</button>`}</span>`).join('')}${locked ? '' : `<label class="pp-meas-addph"><input type="file" accept="image/*" capture="environment" data-ph-add="${esc(path)}" hidden />${icon('camera')}<span>Photo</span></label>`}</div>`;
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
    const nosings = nosingsForTread(stair, st);
    const nosingMarks = nosings.length ? `<rect x="0" y="${D - nose}" width="${W}" height="${nose}" fill="#E7792C" opacity=".24"/><path d="M0 ${D - nose}H${W}" stroke="#B4561A" stroke-width=".55" stroke-dasharray="${nosings.some((n) => n.type === 'overlap') ? '1.4 .45' : 'none'}"><title>${esc(nosings.map((n) => `${n.qty || 1} ${n.type} nosing`).join(', '))}</title></path>` : '';
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
    const click = (side, x) => (interactive ? `<rect class="pp-viz-hit" data-viz-side="${side}" x="${x}" y="-2" width="7" height="${D + 4}" rx="1"><title>Tap to open/close the ${side} side</title></rect>` : '');
    const pad = 9;
    return `<svg class="pp-viz-svg" viewBox="${-pad} -9 ${W + pad * 2} ${D + 17}" role="img" aria-label="Tread ${idx + 1}: ${fmtIn(W)} by ${fmtIn(D)} inches, ${openText(st.open, st.ret)}">
      <defs>${woodDefs(`${id}w`, tone, isGlossy(stair.finish))}
        <pattern id="${id}h" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="1.2" fill="#F2F4F7"/><path d="M0 0V1.2" stroke="#C0C6CF" stroke-width=".3"/></pattern></defs>
      ${end(0, -1, leftOpen)}${end(W, 1, rightOpen)}
      <rect x="0" y="0" width="${W}" height="${D}" fill="url(#${id}w)" stroke="#5B4632" stroke-width=".14"/>
      ${isGlossy(stair.finish) ? `<rect x="0" y="0" width="${W}" height="${D}" fill="url(#${id}wg)"/>` : ''}
      <rect x="0" y="${D - nose}" width="${W}" height="${nose}" fill="#000" opacity=".07"/>
      ${nosingMarks}
      <path d="M0 ${D}H${W}" stroke="#3E2C1E" stroke-width=".22"/>
      ${dimLine(0, -4.2, W, -4.2, `${fmtIn(W)}"`)}
      ${dimLine(W + (rightOpen ? 3.2 : 4.4), 0, W + (rightOpen ? 3.2 : 4.4), D, `${fmtIn(D)}"`)}
      <text class="pp-viz-note" x="${W / 2}" y="${D + 3.6}" text-anchor="middle">front · nose</text>
      <text class="pp-viz-note ${leftOpen ? 'is-open' : ''}" x="-1" y="${D + 3.6}" text-anchor="middle">${leftOpen ? `open · ${{ '45': '45°', flat: 'flat', bullnose: 'bullnose' }[st.ret] || ''}` : 'wall'}</text>
      <text class="pp-viz-note ${rightOpen ? 'is-open' : ''}" x="${W + 1}" y="${D + 3.6}" text-anchor="middle">${rightOpen ? `open · ${{ '45': '45°', flat: 'flat', bullnose: 'bullnose' }[st.ret] || ''}` : 'wall'}</text>
      ${click('left', -6)}${click('right', W - 1)}
    </svg>`;
  }

  /** Front view of the riser under that tread. */
  function riserSvg(stair, st, idx) {
    if (stair.riser_material === 'none' || st.no_riser) return '<p class="pp-muted pp-viz-empty">No riser on this step.</p>';
    const W = Number(st.riser_w) || Number(st.tread_w) || 36;
    const H = Number(st.riser_h) || 7.5;
    const id = `pv${(vizSeq += 1)}`;
    const paint = stair.riser_material === 'primed' || stair.riser_material === 'paint_grade';
    const tone = woodTone(stair.species, stair.color, paint);
    const pad = 9;
    return `<svg class="pp-viz-svg" viewBox="${-pad} -7 ${W + pad * 2} ${H + 12}" role="img" aria-label="Riser ${idx + 1}: ${fmtIn(W)} by ${fmtIn(H)} inches">
      <defs>${woodDefs(id, tone, !paint && isGlossy(stair.finish))}</defs>
      <rect x="-1.2" y="-1.6" width="${W + 2.4}" height="1.6" rx=".6" fill="#000" opacity=".12"/>
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id})" stroke="#5B4632" stroke-width=".14"/>
      ${!paint && isGlossy(stair.finish) ? `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id}g)"/>` : ''}
      ${dimLine(0, -3.6, W, -3.6, `${fmtIn(W)}"`)}
      ${dimLine(W + 3.4, 0, W + 3.4, H, `${fmtIn(H)}"`)}
      <text class="pp-viz-note" x="${W / 2}" y="${H + 3}" text-anchor="middle">${paint ? (stair.riser_material === 'primed' ? 'primed' : 'paint grade') : 'riser'}</text>
    </svg>`;
  }

  function effectiveNosingPosition(stair, nosing) {
    if (nosing.position === 'landing' && stair.landing && stair.landing.enabled) return 'landing';
    const treads = treadSteps(stair);
    if (treads.some((step) => step.id === nosing.position)) return nosing.position;
    return treads.length ? treads[treads.length - 1].id : '';
  }
  function nosingsForTread(stair, step) {
    return (stair.nosings || []).filter((nosing) => nosing.length && effectiveNosingPosition(stair, nosing) === step.id);
  }
  function landingNosings(stair) {
    return (stair.nosings || []).filter((nosing) => nosing.length && effectiveNosingPosition(stair, nosing) === 'landing');
  }

  /** Plan view for curved/spiral stairs. Each measured tread becomes a radial sector. */
  function roundStairSvg(stair, selected) {
    const treads = treadSteps(stair);
    const extraRisers = (stair.steps || []).map((step, index) => ({ step, index })).filter(({ step }) => step.kind === 'riser');
    if (!treads.length && !extraRisers.length && !(stair.landing && stair.landing.enabled)) return '<p class="pp-muted pp-viz-empty">Add a tread to build the round stair plan.</p>';
    const id = `pv${(vizSeq += 1)}`;
    const tone = woodTone(stair.species, stair.color, false);
    const cx = 100; const cy = 100; const outer = 62;
    const diameter = Number(stair.round_diameter) || 60;
    const centerDiameter = Number(stair.round_center_diameter) || 6;
    const scale = outer / Math.max(diameter / 2, 1);
    const inner = Math.min(outer - 8, Math.max(8, centerDiameter / 2 * scale));
    const sweep = Number(stair.round_sweep) || 270;
    const start = -90 - sweep / 2;
    const span = treads.length ? sweep / treads.length : sweep;
    const polar = (radius, angle) => [cx + radius * Math.cos(angle * Math.PI / 180), cy + radius * Math.sin(angle * Math.PI / 180)];
    const sectorPath = (r0, r1, a0, a1) => {
      const p0 = polar(r1, a0); const p1 = polar(r1, a1);
      const q1 = polar(r0, a1); const q0 = polar(r0, a0);
      if (Math.abs(a1 - a0) >= 359.9) {
        const middle = (a0 + a1) / 2;
        const pm = polar(r1, middle); const qm = polar(r0, middle);
        const pt = (p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2);
        return 'M' + pt(p0) + ' A' + r1 + ' ' + r1 + ' 0 1 1 ' + pt(pm) + ' A' + r1 + ' ' + r1 + ' 0 1 1 ' + pt(p1)
          + ' L' + pt(q1) + ' A' + r0 + ' ' + r0 + ' 0 1 0 ' + pt(qm) + ' A' + r0 + ' ' + r0 + ' 0 1 0 ' + pt(q0) + ' Z';
      }
      const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
      return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r1} ${r1} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} L${q1[0].toFixed(2)} ${q1[1].toFixed(2)} A${r0} ${r0} 0 ${large} 0 ${q0[0].toFixed(2)} ${q0[1].toFixed(2)} Z`;
    };
    const endAngle = start + sweep;
    const riserMarks = extraRisers.map(({ step, index }, i) => {
      const angle = endAngle + (i - (extraRisers.length - 1) / 2) * 2;
      const a = polar(inner, angle); const b = polar(outer, angle);
      return '<path d="M' + a[0].toFixed(2) + ' ' + a[1].toFixed(2) + 'L' + b[0].toFixed(2) + ' ' + b[1].toFixed(2) + '" stroke="' + (index === selected ? '#E7792C' : '#B4561A') + '" stroke-width="' + (index === selected ? '3' : '1.5') + '" data-viz-step="' + index + '" class="pp-viz-tread pp-viz-riser-only"><title>Riser only ' + (i + 1) + ' · ' + fmtIn(step.riser_h) + ' inches high</title></path>';
    }).join('');
    const sectors = treads.map((step, i) => {
      const a0 = start + span * i; const a1 = start + span * (i + 1); const middle = (a0 + a1) / 2;
      const isSelected = stair.steps.indexOf(step) === selected;
      const marks = nosingsForTread(stair, step);
      const label = polar((inner + outer) / 2, middle);
      const index = stair.steps.indexOf(step);
      const nosePaths = marks.map((nosing) => `<path d="${sectorPath(outer - 2.4, outer + (nosing.type === 'overlap' ? 1.8 : 0.8), a0, a1)}" fill="#E7792C" stroke="#B4561A" stroke-width=".6" class="pp-viz-nosing"><title>${esc(`${nosing.qty || 1} ${nosing.type} nosing · ${fmtIn(nosing.length)} inches`)}</title></path>`).join('');
      return `<path d="${sectorPath(inner, outer, a0, a1)}" fill="url(#${id}t)" stroke="${isSelected ? '#E7792C' : '#4A3726'}" stroke-width="${isSelected ? '2.2' : '.8'}" data-viz-step="${index}" class="pp-viz-tread"><title>Tread ${i + 1} · ${fmtIn(step.tread_w) || '—'} × ${fmtIn(step.tread_d) || '—'} inches</title></path><text class="pp-viz-round-label" x="${label[0].toFixed(1)}" y="${label[1].toFixed(1)}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>${nosePaths}`;
    }).join('') + riserMarks;
    const landing = stair.landing && stair.landing.enabled
      ? (() => {
        const endAngle = start + sweep;
        const width = Number(stair.landing.width) || 36;
        const depth = Number(stair.landing.depth) || 18;
        const widthPx = Math.min(outer * 1.45, width * scale);
        const depthPx = Math.min(outer * 0.65, depth * scale);
        const marks = landingNosings(stair);
        return `<g transform="translate(${cx} ${cy}) rotate(${endAngle})"><rect x="${outer}" y="${-widthPx / 2}" width="${depthPx}" height="${widthPx}" rx="1.5" fill="${tone.base}" stroke="#4A3726" stroke-width="1.2" class="pp-viz-landing"/><text class="pp-viz-round-label" x="${outer + depthPx / 2}" y="0" text-anchor="middle" dominant-baseline="central">LANDING</text>${marks.map((nosing) => `<path d="M${outer + depthPx} ${-widthPx / 2}L${outer + depthPx} ${widthPx / 2}" stroke="#B4561A" stroke-width="2.8" class="pp-viz-nosing"><title>${esc(`${nosing.qty || 1} ${nosing.type} nosing · landing edge`)}</title></path>`).join('')}</g>`;
      })()
      : '';
    return `<svg class="pp-viz-svg pp-viz-stair pp-viz-round" viewBox="-10 -10 220 220" role="img" aria-label="Round stair plan: ${treads.length} treads, ${fmtIn(diameter)} inch outside diameter, ${fmtIn(centerDiameter)} inch center opening">
      <defs>${woodDefs(`${id}t`, tone, isGlossy(stair.finish))}</defs>
      <circle cx="${cx}" cy="${cy}" r="${outer}" fill="#FFF" stroke="#D0D5DD" stroke-width="1.2"/>
      ${sectors}
      <circle cx="${cx}" cy="${cy}" r="${inner}" fill="#F1F3F5" stroke="#667085" stroke-width="1" stroke-dasharray="3 2"/>
      <text class="pp-viz-round-label" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">CENTER</text>
      ${landing}
      <text class="pp-viz-round-meta" x="${cx}" y="14" text-anchor="middle">Ø ${fmtIn(stair.round_diameter) || 'Set outside diameter'}" · ${sweep}°</text>
      <text class="pp-viz-round-meta" x="${cx}" y="190" text-anchor="middle">Center opening ${fmtIn(stair.round_center_diameter) || '—'}"</text>
    </svg>`;
  }

  const STAIR_TURNS = ['straight', 'left', 'right', 'u_left', 'u_right'];
  const turnIc = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const TURN_OPTS = [
    ['straight', 'Straight', turnIc('M12 20V4M7 9l5-5 5 5')],
    ['left', 'Turn left', turnIc('M16 20v-8H5M9 8l-4 4 4 4')],
    ['right', 'Turn right', turnIc('M8 20v-8h11M15 8l4 4-4 4')],
    ['u_left', 'U-turn left', turnIc('M17 20V9a4 4 0 0 0-8 0v11M5 16l4 4 4-4')],
    ['u_right', 'U-turn right', turnIc('M7 20V9a4 4 0 0 1 8 0v11M11 16l4 4 4-4')],
  ];
  /** Whole stair drawn from component rows, including riser-only endings and optional landings. */
  function stairSvg(stairOrFlights, sel, mirror, flightIndexes, selectedByFlight, activeFlightIndex) {
    const flights = Array.isArray(stairOrFlights) ? stairOrFlights : [stairOrFlights];
    const stair = flights[0];
    if (flights.length === 1 && stair.layout === 'round') return roundStairSvg(stair, sel);
    if (flights.some((flight) => flight.layout === 'round')) return '<p class="pp-muted pp-viz-empty">Use the connected elevation below to review a stair with a round flight.</p>';
    const id = `pv${(vizSeq += 1)}`;
    const flightData = flights.map((flight, chainIndex) => {
      const paint = flight.riser_material === 'primed' || flight.riser_material === 'paint_grade';
      return {
        flight,
        flightIndex: flightIndexes && Number.isInteger(flightIndexes[chainIndex]) ? flightIndexes[chainIndex] : chainIndex,
        vizId: `${id}f${chainIndex}`,
        tone: woodTone(flight.species, flight.color, false),
        riserTone: woodTone(flight.species, flight.color, paint),
        paint,
        components: (flight.steps || []).map((step, index) => ({ step, index })).filter(({ step }) => step.kind === 'riser' ? step.riser_w || step.riser_h : step.tread_w || step.tread_d || step.riser_h),
      };
    });
    if (!flightData.some(({ components, flight }) => components.length || (flight.landing && flight.landing.enabled))) return '<p class="pp-muted pp-viz-empty">The stair builds itself here as you measure the steps.</p>';
    const cos = Math.cos(Math.PI / 6); const sin = Math.sin(Math.PI / 6);
    // World → screen (isometric). Each flight has its own frame so a flight can turn on the landing.
    const PW = (x, y, z) => { const xx = mirror ? -x : x; return [(xx + y) * cos, (xx - y) * sin - z]; };
    const shapes = []; const all = [];
    const nose = 1.25; const thickness = 1;
    const firstWidth = (flight) => { const st = (flight.steps || []).find((x) => x.kind !== 'riser' && x.tread_w) || (flight.steps || []).find((x) => x.riser_w); return Number(st && (st.tread_w || st.riser_w)) || 36; };
    let z = 0;
    // frame: world = o + x*ax + y*ay  (ax = flight's "right" direction, ay = walking direction)
    let frame = { ox: 0, oy: 0, ax: [1, 0], ay: [0, 1] };
    const geoByFlight = flightData.map(({ flight, flightIndex, components }, pos) => {
      const flightRows = [];
      let y = 0;
      let lastW = Number(flight.width) || 36; let lastD = Number(flight.depth) || 11.25;
      for (const { step, index } of components) {
        const riserOnly = step.kind === 'riser';
        const W = Number(riserOnly ? step.riser_w : step.tread_w) || Number(step.riser_w) || lastW;
        const D = Number(step.tread_d) || lastD;
        const H = Number(step.riser_h) || 7.5;
        flightRows.push({ flight, flightIndex, st: step, index, riserOnly, W, D, H, y0: y, z0: z });
        if (!riserOnly) { y += D - nose; lastW = W; lastD = D; }
        z += H;
      }
      const next = flightData[pos + 1] && flightData[pos + 1].flight;
      const turn = next && STAIR_TURNS.includes(next.turn) ? next.turn : 'straight';
      const nextW = next ? firstWidth(next) : lastW;
      let landing = null;
      const myFrame = frame;
      if (flight.landing && flight.landing.enabled) {
        const uTurn = turn === 'u_left' || turn === 'u_right';
        // a U-turn landing always spans both flights side by side
        const width = uTurn ? Math.max(Number(flight.landing.width) || 0, lastW + nextW) : Number(flight.landing.width) || lastW;
        const depth = Number(flight.landing.depth) || (turn === 'straight' ? lastD : Math.max(lastD, nextW));
        // U-turns: the landing reaches over the next flight, beside this one
        const x0 = turn === 'u_left' ? lastW - width : 0;
        landing = { flight, flightIndex, x0, width, depth, y0: y, z0: z };
        const at = (lx, ly) => [myFrame.ox + lx * myFrame.ax[0] + ly * myFrame.ay[0], myFrame.oy + lx * myFrame.ax[1] + ly * myFrame.ay[1]];
        const rot = (v, k) => (k === 'left' ? [-v[1], v[0]] : k === 'right' ? [v[1], -v[0]] : k === 'back' ? [-v[0], -v[1]] : v);
        const yEnd = y + depth;
        if (turn === 'straight') { const o = at(0, yEnd); frame = { ox: o[0], oy: o[1], ax: myFrame.ax, ay: myFrame.ay }; }
        else if (turn === 'left') { const o = at(x0, y); frame = { ox: o[0], oy: o[1], ax: myFrame.ay, ay: rot(myFrame.ay, 'left') }; }
        else if (turn === 'right') { const o = at(x0 + width, yEnd); frame = { ox: o[0], oy: o[1], ax: rot(myFrame.ay, 'back'), ay: rot(myFrame.ay, 'right') }; }
        else if (turn === 'u_left') { const o = at(0, y); frame = { ox: o[0], oy: o[1], ax: rot(myFrame.ax, 'back'), ay: rot(myFrame.ay, 'back') }; }
        else { const o = at(lastW + nextW, y); frame = { ox: o[0], oy: o[1], ax: rot(myFrame.ax, 'back'), ay: rot(myFrame.ay, 'back') }; }
      } else {
        const o = [myFrame.ox + y * myFrame.ay[0], myFrame.oy + y * myFrame.ay[1]];
        frame = { ox: o[0], oy: o[1], ax: myFrame.ax, ay: myFrame.ay };
      }
      return { rows: flightRows, landing, frame: myFrame };
    });
    // Painter's order: farther pieces first (depth = screen-forward direction).
    const groups = [];
    for (let flightPosition = geoByFlight.length - 1; flightPosition >= 0; flightPosition -= 1) {
      const { rows, landing, frame: fr } = geoByFlight[flightPosition];
      const toW = (x, y) => [fr.ox + x * fr.ax[0] + y * fr.ay[0], fr.oy + x * fr.ax[1] + y * fr.ay[1]];
      const P = (x, y, z) => { const w = toW(x, y); return PW(w[0], w[1], z); };
      const pts = (arr) => arr.map((p) => P(...p).map((v) => v.toFixed(2)).join(',')).join(' ');
      const depthOf = (x, y) => { const w = toW(x, y); return (mirror ? -w[0] : w[0]) - w[1]; };
      // which long side of this flight faces the viewer
      const rightVisible = ((mirror ? -fr.ax[0] : fr.ax[0]) - fr.ax[1]) > 0;
      const facesViewer = ((mirror ? -fr.ay[0] : fr.ay[0]) - fr.ay[1]) < 0;
      let cur = null;
      const open = (key) => { cur = { key, parts: [] }; groups.push(cur); };
      const put = (svg) => cur.parts.push(svg);
      const flightInfo = flightData[flightPosition];
      const { flight, flightIndex, vizId: flightVizId, tone: flightTone } = flightInfo;
      if (landing) {
        const { x0: lx0, width: landingWidth, depth: landingDepth, y0: landY, z0: landTop } = landing;
        const lx1 = lx0 + landingWidth;
        open(depthOf((lx0 + lx1) / 2, landY + landingDepth / 2) - 0.5);
        const sideX = rightVisible ? lx1 : lx0;
        const endY = facesViewer ? landY + landingDepth : landY;
        const sides = [
          [[sideX, landY, landTop - thickness], [sideX, landY + landingDepth, landTop - thickness], [sideX, landY + landingDepth, landTop], [sideX, landY, landTop]],
          [[lx0, endY, landTop - thickness], [lx1, endY, landTop - thickness], [lx1, endY, landTop], [lx0, endY, landTop]],
        ];
        sides.forEach((side) => put(`<polygon points="${pts(side)}" fill="${hexMix(flightTone.base, '#2A1C12', 0.22)}" stroke="#4A3726" stroke-width=".3"/>`));
        sides.forEach((side) => side.forEach((point) => all.push(P(...point))));
        const platform = [[lx0, landY, landTop], [lx1, landY, landTop], [lx1, landY + landingDepth, landTop], [lx0, landY + landingDepth, landTop]];
        put(`<polygon points="${pts(platform)}" fill="url(#${flightVizId}t)" stroke="#4A3726" stroke-width=".35" class="pp-viz-landing"><title>Landing ${fmtIn(landingWidth)}" × ${fmtIn(landingDepth)}" before ${esc(flight.name || 'next flight')}</title></polygon>`);
        platform.forEach((point) => all.push(P(...point)));
        for (const nosing of landingNosings(flight)) {
          const a = P(lx0, landY + landingDepth - 0.35, landTop + 0.08); const b = P(lx1, landY + landingDepth - 0.35, landTop + 0.08);
          put(`<path d="M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}" stroke="#B4561A" stroke-width="1.5" stroke-linecap="round" class="pp-viz-nosing"><title>${esc(`${nosing.qty || 1} ${nosing.type} nosing · landing edge`)}</title></path>`);
        }
        const label = P((lx0 + lx1) / 2, landY + landingDepth / 2, landTop + 0.1);
        put(`<text class="pp-viz-landing-label" x="${label[0].toFixed(2)}" y="${label[1].toFixed(2)}" text-anchor="middle" dominant-baseline="central">LANDING</text>`);
      }
      for (let k = rows.length - 1; k >= 0; k -= 1) {
      const g = rows[k];
      const { st, index, riserOnly, W, D, H, y0, z0 } = g;
      open(depthOf(W / 2, y0 + D / 2) + z0 * 0.002);
      const selected = selectedByFlight && selectedByFlight[flightIndex] !== undefined
        ? selectedByFlight[flightIndex]
        : flightIndex === (activeFlightIndex !== undefined ? activeFlightIndex : flightIndexes && flightIndexes[0] !== undefined ? flightIndexes[0] : 0) ? sel : -1;
      const top = z0 + H; const isSelected = index === selected;
      if (riserOnly) {
        const riser = [[0, y0, z0], [W, y0, z0], [W, y0, top], [0, y0, top]];
        put(`<polygon points="${pts(riser)}" fill="url(#${flightVizId}r)" stroke="${isSelected ? '#E7792C' : '#5B4632'}" stroke-width="${isSelected ? '1' : '.35'}" data-viz-flight="${flightIndex}" data-viz-step="${index}" class="pp-viz-tread pp-viz-riser-only"><title>${esc(flight.name || 'Stair')} · Riser only ${index + 1}: ${fmtIn(st.riser_w) || fmtIn(W)}" × ${fmtIn(H)}"</title></polygon>`);
        riser.forEach((point) => all.push(P(...point)));
        continue;
      }
      const yf = y0 - nose;
      const leftOpen = st.open === 'left' || st.open === 'both';
      const rightOpen = st.open === 'right' || st.open === 'both';
      const sideOpen = rightVisible ? rightOpen : leftOpen; const sideX = rightVisible ? W : 0;
      const riserW = Number(st.riser_w) || W;
      const riser = [[0, y0, z0], [riserW, y0, z0], [riserW, y0, top - thickness], [0, y0, top - thickness]];
      if (facesViewer && flight.riser_material !== 'none' && !st.no_riser) put(`<polygon points="${pts(riser)}" fill="url(#${flightVizId}r)" stroke="#5B4632" stroke-width=".25"/>`);
      const side = [[sideX, y0, z0], [sideX, y0 + D, z0], [sideX, y0 + D, top], [sideX, yf, top], [sideX, yf, top - thickness], [sideX, y0, top - thickness]];
      put(sideOpen
        ? `<polygon points="${pts(side)}" fill="${hexMix(flightTone.base, '#2A1C12', 0.28)}" stroke="#4A3726" stroke-width=".25"/>`
        : `<polygon points="${pts(side)}" fill="#E4E7EC" stroke="#C0C6CF" stroke-width=".25"/>`);
      // a flight coming toward the viewer shows the back of each step instead of the riser
      if (!facesViewer) {
        const back = [[0, y0 + D, z0], [W, y0 + D, z0], [W, y0 + D, top], [0, y0 + D, top]];
        put(`<polygon points="${pts(back)}" fill="${hexMix(flightTone.base, '#2A1C12', 0.35)}" stroke="#4A3726" stroke-width=".25"/>`);
      }
      const front = [[0, yf, top - thickness], [W, yf, top - thickness], [W, yf, top], [0, yf, top]];
      if (facesViewer) put(`<polygon points="${pts(front)}" fill="${hexMix(flightTone.base, '#2A1C12', 0.18)}" stroke="#4A3726" stroke-width=".25"/>`);
      const tread = [[0, yf, top], [W, yf, top], [W, y0 + D, top], [0, y0 + D, top]];
      put(`<polygon points="${pts(tread)}" fill="url(#${flightVizId}t)" stroke="${isSelected ? '#E7792C' : '#4A3726'}" stroke-width="${isSelected ? '.9' : '.25'}" data-viz-flight="${flightIndex}" data-viz-step="${index}" class="pp-viz-tread"><title>${esc(flight.name || 'Stair')} · Tread ${index + 1}: ${fmtIn(W)}" × ${fmtIn(D)}" · ${openText(st.open, st.ret)}</title></polygon>`);
      if (isGlossy(flight.finish)) put(`<polygon points="${pts(tread)}" fill="url(#${flightVizId}tg)" pointer-events="none"/>`);
      for (const [nosingIndex, nosing] of nosingsForTread(flight, st).entries()) {
        const edgeY = yf + (nosing.type === 'flush' ? 0.08 : nosing.type === 'overlap' ? -0.4 : -0.2) + nosingIndex * 0.16;
        const a = P(0, edgeY, top + 0.08); const b = P(W, edgeY, top + 0.08);
        put(`<path d="M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}" stroke="#B4561A" stroke-width="1.4" stroke-linecap="round" class="pp-viz-nosing"><title>${esc(`${nosing.qty || 1} ${nosing.type} nosing · ${fmtIn(nosing.length)} inches`)}</title></path>`);
      }
      if (sideOpen && st.ret !== 'bullnose') {
        const a = P(sideX, yf, top);
        const b = P(sideX, yf + (st.ret === 'flat' ? 0 : nose), top - (st.ret === 'flat' ? thickness : 0));
        put(`<path d="M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}" stroke="#2A1C12" stroke-width=".35"/>`);
      }
      [riser, side, front, tread].forEach((poly) => poly.forEach((point) => all.push(P(...point))));
      if (isSelected) {
        const c = P(W / 2, y0 + D / 2, top);
        put(`<g class="pp-viz-pin"><circle cx="${c[0].toFixed(2)}" cy="${c[1].toFixed(2)}" r="3.4"/><text x="${c[0].toFixed(2)}" y="${c[1].toFixed(2)}" text-anchor="middle" dominant-baseline="central">${index + 1}</text></g>`);
      }
      }
    }
    groups.map((g, n) => ({ g, n })).sort((a, b) => a.g.key - b.g.key || a.n - b.n).forEach(({ g }) => shapes.push(...g.parts));
    const xs = all.map((point) => point[0]); const ys = all.map((point) => point[1]);
    const pad = 8; const minX = Math.min(...xs) - pad; const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad; const h = Math.max(...ys) - minY + pad;
    const counts = measCounts({ stairs: flights, vents: [] });
    const flightLabel = flights.length > 1 ? ` with ${flights.length} connected flights and ${flights.filter((flight) => flight.landing && flight.landing.enabled).length} landings` : '';
    return `<svg class="pp-viz-svg pp-viz-stair" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="Complete assembled stair${flightLabel}, with ${counts.treads} treads and ${counts.risers} risers">
      <defs>${flightData.map(({ vizId, tone: flightTone, riserTone, paint: paintGrade, flight }) => woodDefs(`${vizId}t`, flightTone, isGlossy(flight.finish)) + woodDefs(`${vizId}r`, riserTone, !paintGrade && isGlossy(flight.finish), true)).join('')}</defs>
      ${shapes.join('')}
    </svg>`;
  }

  /** Follow connected flights from the lower stair whose landing starts the sequence. */
  function stairChainFor(data, stairId) {
    const stairs = data.stairs || [];
    let root = stairs.find((stair) => stair.id === stairId);
    if (!root) return [];
    const ancestors = new Set([root.id]);
    while (root.starts_on_landing_of) {
      const parent = stairs.find((stair) => stair.id === root.starts_on_landing_of);
      if (!parent || !parent.landing || !parent.landing.enabled || ancestors.has(parent.id)) break;
      ancestors.add(parent.id);
      root = parent;
    }
    const chain = [];
    const seen = new Set();
    let current = root;
    while (current && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = stairs.find((stair) => stair.starts_on_landing_of === chain[chain.length - 1].id);
    }
    return chain;
  }

  /** Side elevation that makes the lower flight, landing, and connected upper flight readable together. */
  function stairSequenceSvg(flights, activeId) {
    const components = flights.map((flight) => (flight.steps || []).filter((step) => step.kind === 'riser'
      ? step.riser_w || step.riser_h
      : step.tread_w || step.tread_d || step.riser_h));
    const totalRun = flights.reduce((sum, flight, i) => sum
      + components[i].reduce((n, step) => n + (step.kind === 'riser' ? 0 : Number(step.tread_d) || 11.25), 0)
      + (flight.landing && flight.landing.enabled ? Number(flight.landing.depth) || 18 : 0), 0);
    const totalRise = flights.reduce((sum, flight, i) => sum
      + components[i].reduce((n, step) => n + (Number(step.riser_h) || 7.5), 0), 0);
    const scale = Math.min(2, 440 / Math.max(totalRun, 1), 150 / Math.max(totalRise, 1));
    const width = Math.max(220, totalRun * scale + 32);
    const height = Math.max(100, totalRise * scale + 48);
    const baseY = 22 + totalRise * scale;
    const thickness = 3.2;
    let x = 16;
    let y = baseY;
    const shapes = ['<line x1="8" y1="' + baseY.toFixed(1) + '" x2="' + (width - 8).toFixed(1) + '" y2="' + baseY.toFixed(1) + '" stroke="#D0D5DD" stroke-width="1"/>'];

    flights.forEach((flight, fi) => {
      const tone = woodTone(flight.species, flight.color, false);
      const firstX = x;
      shapes.push('<text x="' + x.toFixed(1) + '" y="13" fill="#344054" font-size="5" font-weight="700">'
        + esc(flight.name || ('Stair ' + (fi + 1))) + (flight.layout === 'round' ? ' · ROUND / SPIRAL' : '') + '</text>');
      components[fi].forEach((step, index) => {
        const rise = Number(step.riser_h) || 7.5;
        const top = y - rise * scale;
        if (step.kind === 'riser') {
          shapes.push('<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + thickness + '" height="' + (y - top).toFixed(1) + '" fill="#E4E7EC" stroke="#98A2B3" stroke-width=".65"/>');
        } else {
          const run = (Number(step.tread_d) || 11.25) * scale;
          const path = 'M' + x.toFixed(1) + ' ' + y.toFixed(1)
            + ' L' + x.toFixed(1) + ' ' + top.toFixed(1)
            + ' L' + (x + run).toFixed(1) + ' ' + top.toFixed(1)
            + ' L' + (x + run).toFixed(1) + ' ' + (top + thickness).toFixed(1)
            + ' L' + (x + thickness).toFixed(1) + ' ' + (top + thickness).toFixed(1)
            + ' L' + (x + thickness).toFixed(1) + ' ' + y.toFixed(1) + ' Z';
          shapes.push('<path d="' + path + '" fill="' + tone.base + '" stroke="#5B4632" stroke-width=".7"/>');
          const hasNosing = (flight.nosings || []).some((nosing) => effectiveNosingPosition(flight, nosing) === step.id && nosing.length);
          if (hasNosing) shapes.push('<line x1="' + x.toFixed(1) + '" y1="' + top.toFixed(1) + '" x2="' + (x + run).toFixed(1) + '" y2="' + top.toFixed(1) + '" stroke="#E7792C" stroke-width="1.7"/>');
          shapes.push('<text x="' + (x + Math.max(2, run / 2)).toFixed(1) + '" y="' + (top - 1.2).toFixed(1) + '" text-anchor="middle" fill="#667085" font-size="3.6">' + (index + 1) + '</text>');
          x += run;
        }
        y = top;
      });
      if (flight.landing && flight.landing.enabled) {
        const depth = (Number(flight.landing.depth) || 18) * scale;
        const landingWidth = Number(flight.landing.width) || 36;
        shapes.push('<rect x="' + x.toFixed(1) + '" y="' + (y - thickness).toFixed(1) + '" width="' + depth.toFixed(1) + '" height="' + thickness + '" rx="1" fill="' + tone.base + '" stroke="#5B4632" stroke-width=".7"/>');
        shapes.push('<text x="' + (x + depth / 2).toFixed(1) + '" y="' + (y - thickness - 2).toFixed(1) + '" text-anchor="middle" fill="#344054" font-size="3.8" font-weight="700">LANDING ' + esc(fmtIn(landingWidth) || '—') + ' × ' + esc(fmtIn(flight.landing.depth) || '—') + ' in</text>');
        x += depth;
      }
      if (flight.id === activeId) shapes.push('<line x1="' + firstX.toFixed(1) + '" y1="' + (baseY + 9).toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + (baseY + 9).toFixed(1) + '" stroke="#E7792C" stroke-width="1.2"/>');
    });
    return '<svg class="pp-viz-svg pp-viz-sequence-svg" viewBox="0 0 ' + width.toFixed(1) + ' ' + height.toFixed(1) + '" role="img" aria-label="Connected stair sequence with landing and upper flight">'
      + '<rect x=".5" y=".5" width="' + (width - 1).toFixed(1) + '" height="' + (height - 1).toFixed(1) + '" rx="3" fill="#FFFFFF" stroke="#E5E7EB"/>'
      + shapes.join('') + '</svg>';
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
      <text class="pp-viz-note" x="${w / 2}" y="${h + 2.6}" text-anchor="middle">${v.type === 'self_rimming' ? 'self-rimming (with lip)' : v.type === 'return_air' ? 'return air' : 'flush mount'}</text>
    </svg>`;
  }

  function stairVizHtml(m, s, si) {
    const sel = Math.min(Math.max(0, (m.vizSel && m.vizSel[si]) || 0), Math.max(0, (s.steps || []).length - 1));
    const chain0 = stairChainFor(m.data, s.id);
    // turning right reads better seen from the other side: flip the default view
    const autoFlip = chain0.slice(1).some((flight) => flight.turn === 'right' || flight.turn === 'u_right');
    const mirror = Boolean(m.vizMirror && m.vizMirror[si]) !== autoFlip;
    const mirrorButton = s.layout === 'round' ? '' : '<button type="button" class="pp-link" data-viz-mirror="' + si + '">' + (mirror ? 'View from the right' : 'View from the left') + '</button>';
    const chain = stairChainFor(m.data, s.id);
    const connected = chain.length > 1;
    const mixedLayout = connected && chain.some((flight) => flight.layout === 'round');
    const flightIndexes = chain.map((flight) => m.data.stairs.findIndex((item) => item.id === flight.id));
    const drawing = mixedLayout
      ? stairSequenceSvg(chain, s.id)
      : stairSvg(connected ? chain : s, sel, mirror, connected ? flightIndexes : [si], m.vizSel, si);
    const drawingTitle = connected ? 'Complete stair · ' + chain.length + ' flights' : s.layout === 'round' ? 'Round stair plan' : 'Full stair drawing';
    const drawingHint = connected
      ? 'Both flights and the connecting landing stay visible. Select a tread or riser to edit it.'
      : s.layout === 'round' ? 'The plan places each tread around the selected stair sweep.' : 'Select any tread or riser to edit its measurements.';
    // how each upper flight leaves its landing (L or U stairs)
    const locked = m.status === 'used';
    const turnPick = connected && !mixedLayout ? chain.slice(1).map((flight) => {
      const fi = m.data.stairs.findIndex((x) => x.id === flight.id);
      const cur = STAIR_TURNS.includes(flight.turn) ? flight.turn : 'straight';
      return `<div class="pp-turn" role="group" aria-label="${esc(flight.name || 'Upper flight')} leaves the landing"><span>${chain.length > 2 ? esc(flight.name || 'Upper flight') : 'From the landing'}</span>${TURN_OPTS.map(([k, l, ic]) => `<button type="button" data-turn="${fi}:${k}" aria-pressed="${cur === k}" title="${esc(l)}" ${locked ? 'disabled' : ''}>${ic}<span>${esc(l)}</span></button>`).join('')}</div>`;
    }).join('') : '';
    return `<div class="pp-viz" data-viz-stair="${si}">
      <div class="pp-viz-3d">
        <div class="pp-viz-bar"><span class="pp-step-lbl pp-viz-lbl">${drawingTitle}</span>${mixedLayout ? '' : mirrorButton}</div>
        ${turnPick}
        <div class="pp-viz-box" data-viz-box="3d">${drawing}</div>
        <p class="pp-viz-hint">${drawingHint}</p>
      </div>
    </div>`;
  }

  function stairsWorkbenchHtml(m) {
    const stairs = m.data.stairs || [];
    if (!stairs.length) return '<div class="pp-card pp-empty">' + mate('head-thinking', 56) + '<strong>No stairs yet</strong>Add a stair and measure it step by step.</div>';
    let activeId = m.activeStairId;
    let activeIndex = stairs.findIndex((stair) => stair.id === activeId);
    if (activeIndex < 0) { activeIndex = 0; activeId = stairs[0].id; m.activeStairId = activeId; }
    const tabs = stairs.map((stair, index) => {
      const counts = measCounts({ stairs: [stair], vents: [] });
      const linked = Boolean(stair.starts_on_landing_of || stairs.some((flight) => flight.starts_on_landing_of === stair.id));
      const chain = stairChainFor(m.data, stair.id);
      const flightIndex = chain.findIndex((flight) => flight.id === stair.id);
      const title = chain.length > 1 ? 'Flight ' + (flightIndex + 1) : stair.name || 'Stair ' + (index + 1);
      const upperFlight = stairs.find((flight) => flight.starts_on_landing_of === stair.id);
      const landing = stair.landing && stair.landing.enabled
        ? '<span class="pp-flight-landing-chip"><small>LANDING</small><strong>' + esc(fmtIn(stair.landing.width) || '—') + ' × ' + esc(fmtIn(stair.landing.depth) || '—') + ' in</strong></span>'
        : '';
      return '<button type="button" class="pp-flight-tab' + (stair.id === activeId ? ' is-active' : '') + '" data-stair-activate="' + esc(stair.id) + '" role="tab" aria-selected="' + (stair.id === activeId) + '">'
        + '<span class="pp-flight-tab-index">' + String(index + 1).padStart(2, '0') + '</span><span class="pp-flight-tab-copy"><strong>' + esc(title) + '</strong><small>' + counts.treads + ' treads · ' + counts.risers + ' risers</small></span>'
        + (linked ? '<span class="pp-flight-tab-link" aria-label="Connected by landing">⌁</span>' : '') + '</button>' + (upperFlight ? landing : '');
    }).join('');
    return '<div class="pp-flight-switcher" role="tablist" aria-label="Stairs and flights">' + tabs + '</div>' + stairHtml(m, stairs[activeIndex], activeIndex);
  }

  function stairHtml(m, s, si) {
    const locked = m.status === 'used';
    const p = 'stairs.' + si;
    const selStep = Math.min(Math.max(0, (m.vizSel && m.vizSel[si]) || 0), Math.max(0, (s.steps || []).length - 1));
    const selectedStep = (s.steps || [])[selStep];
    const selectedTreadNo = selectedStep ? treadSteps(s).findIndex((step) => step.id === selectedStep.id) + 1 : 0;
    const selectedLabel = !selectedStep ? 'No components' : selectedStep.kind === 'riser' ? 'Riser only ' + (selStep + 1) : 'Tread ' + selectedTreadNo;
    const stepRows = (s.steps || []).map((st, i) => {
      const riserOnly = st.kind === 'riser';
      const treadIndex = treadSteps(s).findIndex((step) => step.id === st.id);
      const treadNo = treadIndex >= 0 ? treadIndex + 1 : i + 1;
      const path = p + '.steps.' + i;
      const tread = riserOnly
        ? '<div class="pp-step-riser-only-label"><strong>Riser only</strong><small>No tread on this component</small></div>'
        : '<div class="pp-step-dim pp-step-dim--tread"><span class="pp-step-lbl">Tread ' + treadNo + '</span>'
          + inch(path + '.tread_w', st.tread_w, 'Tread ' + treadNo + ' width', locked) + '<em>×</em>'
          + inch(path + '.tread_d', st.tread_d, 'Tread ' + treadNo + ' depth', locked) + '</div>';
      const riserDisabled = locked || s.riser_material === 'none' || (!riserOnly && st.no_riser);
      const riser = '<div class="pp-step-dim pp-step-dim--riser ' + (riserDisabled ? 'is-off' : '') + '"><span class="pp-step-lbl">Riser ' + (i + 1) + '</span>'
        + inch(path + '.riser_w', st.riser_w, 'Riser ' + (i + 1) + ' width', riserDisabled) + '<em>×</em>'
        + inch(path + '.riser_h', st.riser_h, 'Riser ' + (i + 1) + ' height', riserDisabled) + '</div>';
      const sides = riserOnly ? '' : '<div class="pp-step-side"><span class="pp-step-lbl">Side</span>'
        + sel(OPEN_OPTS, st.open, 'data-set="' + path + '.open" aria-label="Open side of tread ' + treadNo + '"' + (locked ? ' disabled' : '')) + '</div>'
        + '<div class="pp-step-ret"><span class="pp-step-lbl">Return</span>'
        + sel(RET_OPTS, st.ret, 'data-set="' + path + '.ret" aria-label="Return of tread ' + treadNo + '"' + (locked || st.open === 'none' ? ' disabled' : '')) + '</div>';
      const actions = locked ? '' : '<div class="pp-step-act">'
        + (riserOnly ? '' : '<button type="button" class="pp-q-ic" data-step-down="' + si + ':' + i + '" title="Copy to the steps below" aria-label="Copy tread ' + treadNo + ' to the steps below">⇣</button>')
        + '<button type="button" class="pp-q-ic pp-q-ic--del" data-step-rm="' + si + ':' + i + '" aria-label="Remove ' + (riserOnly ? 'riser' : 'tread ' + treadNo) + '">×</button></div>';
      return `<div class="pp-step ${st.open !== 'none' ? 'is-open' : ''} ${i === selStep ? 'is-sel' : ''}" role="group" aria-label="${riserOnly ? 'Riser only ' + (i + 1) : 'Tread ' + treadNo}" data-kind="${riserOnly ? 'riser' : 'step'}" data-step-row="${si}:${i}">
        <span class="pp-step-n">${i + 1}</span>${tread}${riser}${sides}${actions}
      </div>`;
    });
    const selectedRow = stepRows[selStep] || '';
    const stepOptions = (s.steps || []).map((st, i) => {
      const riserOnly = st.kind === 'riser';
      const treadIndex = treadSteps(s).findIndex((step) => step.id === st.id);
      const treadNo = treadIndex >= 0 ? treadIndex + 1 : i + 1;
      const label = riserOnly ? 'Riser only ' + (i + 1) : 'Tread ' + treadNo;
      const w = fmtIn(riserOnly ? st.riser_w : st.tread_w);
      const d = fmtIn(riserOnly ? st.riser_h : st.tread_d);
      const dims = w && d ? w + ' × ' + d + ' in' : w || d ? (w || d) + ' in' : 'No dimensions yet';
      const returns = !riserOnly && st.open !== 'none' ? ' · ' + openText(st.open, st.ret) : '';
      return '<button type="button" class="pp-step-option' + (i === selStep ? ' is-selected' : '') + '" data-step-select="' + si + ':' + i + '" aria-pressed="' + (i === selStep) + '">'
        + '<span class="pp-step-option-number">' + String(i + 1).padStart(2, '0') + '</span><span class="pp-step-option-copy"><strong>' + esc(label) + '</strong><small>' + esc(dims + returns) + '</small></span>'
        + (i === selStep ? '<span class="pp-step-option-dot" aria-hidden="true">✓</span>' : '') + '</button>';
    }).join('');
    const nosingOptions = [
      ...treadSteps(s).map((step, i) => [step.id, 'Tread ' + (i + 1)]),
      ...(s.landing && s.landing.enabled ? [['landing', 'Landing edge']] : []),
      ...(!treadSteps(s).length && !(s.landing && s.landing.enabled) ? [['', 'Top of stair']] : []),
    ];
    const nos = (s.nosings || []).map((n, i) => {
      const path = p + '.nosings.' + i;
      const position = effectiveNosingPosition(s, n);
      return `<div class="pp-nos">
        <label><span class="pp-step-lbl">Length</span>${inch(path + '.length', n.length, 'Nosing ' + (i + 1) + ' length', locked)}</label>
        <label><span class="pp-step-lbl">Qty</span><input type="number" min="1" max="500" data-num="${path}.qty" value="${esc(n.qty || 1)}" ${locked ? 'disabled' : ''} /></label>
        <label><span class="pp-step-lbl">Type</span>${sel([['flush', 'Flush'], ['overlap', 'Overlap'], ['stair_nose', 'Stair nose']], n.type, 'data-set="' + path + '.type"' + (locked ? ' disabled' : ''))}</label>
        <label><span class="pp-step-lbl">Position</span>${sel(nosingOptions, position, 'data-set="' + path + '.position"' + (locked ? ' disabled' : ''))}</label>
        <label class="pp-nos-note"><span class="pp-step-lbl">Note</span><input data-txt="${path}.note" value="${esc(n.note)}" maxlength="200" placeholder="Optional detail" ${locked ? 'disabled' : ''} /></label>
        ${locked ? '' : '<button type="button" class="pp-q-ic pp-q-ic--del" data-nos-rm="' + si + ':' + i + '" aria-label="Remove nosing ' + (i + 1) + '">×</button>'}
      </div>`;
    }).join('');
    const counts = measCounts({ stairs: [s], vents: [] });
    const expandedMeasurements = Boolean(m.stairMeasurementsExpanded && m.stairMeasurementsExpanded[s.id]);
    const upperFlight = m.data.stairs.find((flight) => flight.starts_on_landing_of === s.id);
    const lowerFlight = s.starts_on_landing_of ? m.data.stairs.find((flight) => flight.id === s.starts_on_landing_of) : null;
    const layoutOptions = [
      ['straight', 'Straight', 'One straight flight'],
      ['round', 'Round / spiral', 'Curved steps around a center opening'],
    ];
    const layoutButtons = '<div class="pp-stair-layout" role="group" aria-label="Stair shape">'
      + '<span class="pp-step-lbl">Stair shape</span>'
      + layoutOptions.map(([value, title, hint]) => '<button type="button" class="pp-layout-choice' + (s.layout === value ? ' is-selected' : '') + '" data-layout="' + p + '.layout" data-value="' + value + '" aria-pressed="' + (s.layout === value) + '"' + (locked ? ' disabled' : '') + '>'
        + (value === 'round' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v5M20 12h-5M12 20v-5M4 12h5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4v-4h4v-4h4V8h4"/></svg>')
        + '<span><strong>' + title + '</strong><small>' + hint + '</small></span></button>').join('')
      + '</div>';
    const roundFields = s.layout === 'round'
      ? `<div class="pp-stair-shape-fields">
          <label><span>Outside diameter</span>${inch(p + '.round_diameter', s.round_diameter, 'Round stair outside diameter', locked)}</label>
          <label><span>Center opening</span>${inch(p + '.round_center_diameter', s.round_center_diameter, 'Round stair center opening diameter', locked)}</label>
          <label><span>Stair sweep</span>${sel([['180', '180°'], ['270', '270°'], ['360', '360°']], s.round_sweep || '270', 'data-set="' + p + '.round_sweep"' + (locked ? ' disabled' : ''))}</label>
        </div><p class="pp-meas-help">The plan divides the selected sweep across measured treads.</p>`
      : '';
    const landingFields = s.landing && s.landing.enabled
      ? `<div class="pp-stair-shape-fields pp-stair-landing-fields">
          <label><span>Landing width</span>${inch(p + '.landing.width', s.landing.width, 'Landing width', locked)}</label>
          <label><span>Landing depth</span>${inch(p + '.landing.depth', s.landing.depth, 'Landing depth', locked)}</label>
        </div>`
      : '';
    const landingAction = s.landing && s.landing.enabled
      ? upperFlight
        ? '<div class="pp-stair-connection"><span>Upper flight: <strong>' + esc(upperFlight.name || 'Stair') + '</strong></span><button type="button" class="pp-link" data-stair-focus="' + esc(upperFlight.id) + '">Edit upper flight</button></div>'
        : '<button type="button" class="pp-btn pp-btn--sec pp-btn--sm pp-stair-add-upper" data-stair-above="' + si + '"' + (locked ? ' disabled' : '') + '>+ Add upper flight on this landing</button>'
      : '';
    const landingLocked = locked || Boolean(upperFlight);
    const setupSummary = (s.layout === 'round' ? 'Round stair' : 'Straight flight')
      + ' · ' + (s.species || 'Wood not selected')
      + (s.landing && s.landing.enabled ? ' · Landing enabled' : '');
    return `<section class="pp-card pp-stair" aria-label="${esc(s.name || 'Stair')}">
      <div class="pp-stair-head">
        <div class="pp-stair-title-group"><input class="pp-stair-name" data-txt="${p}.name" value="${esc(s.name)}" maxlength="80" aria-label="Stair name" ${locked ? 'disabled' : ''} />
        <span class="pp-muted">${counts.treads} treads · ${counts.risers} risers${lowerFlight ? ' · Starts at landing' : ''}</span></div>
        ${locked ? '' : '<button type="button" class="pp-q-ic pp-q-ic--del" data-stair-rm="' + si + '" aria-label="Remove ' + esc(s.name || 'stair') + '">×</button>'}
      </div>
      <details class="pp-stair-setup" data-stair-setup="${esc(s.id)}" ${m.stairSetupExpanded && m.stairSetupExpanded[s.id] ? 'open' : ''}>
        <summary><span>Stair setup</span><small>${esc(setupSummary)}</small><i aria-hidden="true"></i></summary>
        <div class="pp-stair-setup-body"><div class="pp-stair-spec">
          <label><span>Wood</span>${selFree(SPECIES, s.species, 'data-free="' + p + '.species"' + (locked ? ' disabled' : ''))}${SPECIES.includes(s.species) || !s.species ? '' : '<input data-txt="' + p + '.species" value="' + esc(s.species) + '" maxlength="60"' + (locked ? ' disabled' : '') + ' />'}</label>
          <label><span>Finish</span>${selFree(FINISHES, s.finish, 'data-free="' + p + '.finish"' + (locked ? ' disabled' : ''))}${FINISHES.includes(s.finish) || !s.finish ? '' : '<input data-txt="' + p + '.finish" value="' + esc(s.finish) + '" maxlength="60"' + (locked ? ' disabled' : '') + ' />'}</label>
          <label><span>Color / stain</span><input data-txt="${p}.color" value="${esc(s.color)}" maxlength="80" placeholder="e.g. Natural, Jacobean" ${locked ? 'disabled' : ''} /></label>
          <label><span>Risers</span>${sel(RISER_OPTS, s.riser_material, 'data-set="' + p + '.riser_material"' + (locked ? ' disabled' : ''))}</label>
        </div>
        <div class="pp-stair-options">${layoutButtons}${roundFields}
        <div class="pp-stair-landing">
          <label class="pp-stair-toggle"><input type="checkbox" data-bool="${p}.landing.enabled" ${s.landing && s.landing.enabled ? 'checked' : ''} ${landingLocked ? 'disabled' : ''} /><span><strong>Add a landing after the stair</strong><small>${upperFlight ? 'Remove the upper flight before removing this landing.' : 'The landing can connect to another flight above it.'}</small></span></label>
          ${landingFields}
          ${landingAction}
        </div>
        ${lowerFlight ? '<p class="pp-stair-from-landing">Starts from the landing on <strong>' + esc(lowerFlight.name || 'Stair') + '</strong>.</p>' : ''}
        </div></div>
      </details>
      <div class="pp-stair-workspace" role="group" aria-label="Stair drawing and measurements">
        <div class="pp-stair-workspace-visual">${stairVizHtml(m, s, si)}</div>
        <div class="pp-stair-workspace-measures">
          <div class="pp-stair-measure-card">
            <div class="pp-component-editor-head"><div><small>COMPONENT ${selectedStep ? String(selStep + 1).padStart(2, '0') : '—'} OF ${(s.steps || []).length}</small><strong>${esc(selectedLabel)}</strong><span>${esc(s.name || 'Stair')} · ${esc(s.species || 'Wood not selected')}${s.finish ? ' · ' + esc(s.finish) : ''}</span></div>
              <div class="pp-component-nav"><button type="button" class="pp-q-ic" data-viz-prev="${si}" aria-label="Previous component" ${(s.steps || []).length < 2 || selStep <= 0 ? 'disabled' : ''}>‹</button><button type="button" class="pp-q-ic" data-viz-next="${si}" aria-label="Next component" ${selStep >= (s.steps || []).length - 1 ? 'disabled' : ''}>›</button></div></div>
            <div class="pp-selected-editor">${selectedRow || '<p class="pp-q-empty">Add a tread or riser to start measuring this flight.</p>'}</div>
            ${locked ? '' : '<div class="pp-stair-add"><button type="button" class="pp-q-add" data-step-add="' + si + '">+ Step (tread + riser)</button><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-riser-add="' + si + '"' + (s.riser_material === 'none' ? ' disabled' : '') + '>+ Riser only</button>'
            + ((s.steps || []).length ? '<span class="pp-stair-many"><label for="ppMany-' + si + '">Add</label><input id="ppMany-' + si + '" type="number" min="1" max="40" value="5" /><button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-step-many="' + si + '">equal steps</button></span>' : '') + '</div>'}
            <details class="pp-stair-measurements" data-stair-measures="${esc(s.id)}" aria-label="${esc(s.name || 'Stair')} components" ${expandedMeasurements ? 'open' : ''}>
              <summary class="pp-stair-measures-head"><span>All measurements · ${(s.steps || []).length} components</span><i aria-hidden="true"></i></summary>
              <div class="pp-stair-step-index" role="group" aria-label="Select a stair component">${stepOptions || '<p class="pp-q-empty">No components yet.</p>'}</div>
            </details>
          </div>
        </div>
      </div>
      <details class="pp-stair-secondary" data-stair-panel="${esc(s.id)}:nosings" ${m.stairPanelExpanded && m.stairPanelExpanded[s.id + ':nosings'] ? 'open' : ''}><summary><span>Nosings</span><small>${(s.nosings || []).length}</small><i aria-hidden="true"></i></summary><div class="pp-stair-secondary-body">${nos || '<p class="pp-muted" style="margin:0;font-size:13px">Add a nosing and choose the tread or landing edge it belongs to.</p>'}${locked ? '' : '<button type="button" class="pp-link" data-nos-add="' + si + '">+ Nosing</button>'}</div></details>
      <details class="pp-stair-secondary" data-stair-panel="${esc(s.id)}:photos" ${m.stairPanelExpanded && m.stairPanelExpanded[s.id + ':photos'] ? 'open' : ''}><summary><span>Photos</span><small>${(s.photos || []).length}</small><i aria-hidden="true"></i></summary><div class="pp-stair-secondary-body">${photoStrip(m, s.photos, p + '.photos')}</div></details>
      <details class="pp-stair-secondary" data-stair-panel="${esc(s.id)}:notes" ${m.stairPanelExpanded && m.stairPanelExpanded[s.id + ':notes'] ? 'open' : ''}><summary><span>Flight notes</span><small>${s.note ? 'Added' : 'Optional'}</small><i aria-hidden="true"></i></summary><div class="pp-stair-secondary-body"><textarea data-txt="${p}.note" maxlength="500" placeholder="e.g. right wall out of square, existing skirt board" ${locked ? 'disabled' : ''}>${esc(s.note)}</textarea></div></details>
    </section>`;
  }

  const VENT_TYPE_LABEL = Object.fromEntries(VENT_TYPES);
  const roomKey = (n) => String(n || '').trim().toLowerCase();
  /** Vents of one room of the plan: list with counts, edit, and + Vent with the room filled in. */
  function openRoomVentsSheet(roomName) {
    const m = state.meas;
    const locked = m.status === 'used';
    const k = roomKey(roomName);
    const idx = [];
    (m.data.vents || []).forEach((v, i) => { if (roomKey(v.room) === k) idx.push(i); });
    const root = openSheet(`Vents · ${roomName}`, `
      <div class="pp-rvents">
        ${idx.length ? `<div class="pp-vlist" role="list">${idx.map((i) => { const v = m.data.vents[i]; return `<div class="pp-vrow" role="listitem">
          <button type="button" class="pp-vrow-main" data-rv-open="${i}"><span class="pp-vrow-thumb" aria-hidden="true">${ventSvg(v)}</span><span class="pp-vrow-text"><strong>${esc(String(v.size || '').trim().replace('x', '×') || 'Vent')} ${esc(VENT_TYPE_LABEL[v.type] || '')}</strong><small>${esc([v.species, v.finish].filter((x) => x && x.trim()).join(' · '))}</small></span></button>
          <span class="pp-stepper" role="group" aria-label="Quantity">${locked ? '' : `<button type="button" data-rv-qty="${i}:-1" aria-label="One less" ${(Number(v.qty) || 1) <= 1 ? 'disabled' : ''}>−</button>`}<b>${Number(v.qty) || 1}</b>${locked ? '' : `<button type="button" data-rv-qty="${i}:1" aria-label="One more">+</button>`}</span>
        </div>`; }).join('')}</div>` : `<p class="pp-ssec-empty">No vents in ${esc(roomName)} yet.</p>`}
        <div class="pp-sheet-actions">${locked ? '' : '<button type="button" class="pp-btn pp-btn--sec" data-rv-add>+ Vent</button>'}<button type="button" class="pp-btn pp-btn--pri" data-sheet-close>Done</button></div>
      </div>`, { noFocus: true });
    const after = () => { measSaveSoon(); const y = window.scrollY; paintMeasurement(); window.scrollTo(0, y); openRoomVentsSheet(roomName); };
    root.querySelectorAll('[data-rv-qty]').forEach((b) => b.addEventListener('click', () => {
      const [i, d] = b.getAttribute('data-rv-qty').split(':').map(Number);
      m.data.vents[i].qty = Math.max(1, (Number(m.data.vents[i].qty) || 1) + d);
      after();
    }));
    root.querySelectorAll('[data-rv-open]').forEach((b) => b.addEventListener('click', () => openVentSheet(Number(b.getAttribute('data-rv-open')), false)));
    const add = root.querySelector('[data-rv-add]');
    if (add) add.addEventListener('click', () => {
      m.data.vents = m.data.vents || [];
      const last = idx.length ? m.data.vents[idx[idx.length - 1]] : m.data.vents[m.data.vents.length - 1];
      const v = newVent(last);
      v.room = roomName;
      const at = idx.length ? idx[idx.length - 1] + 1 : m.data.vents.length;
      m.data.vents.splice(at, 0, v);
      measSaveSoon();
      openVentSheet(at, true);
    });
  }
  /** Vents grouped by room, in the order the rooms were first measured; vents without a room last. */
  function ventGroups(vents) {
    const groups = [];
    const byKey = new Map();
    vents.forEach((v, i) => {
      const name = (v.room || '').trim();
      const k = name.toLowerCase();
      if (!byKey.has(k)) { const g = { key: k, name, items: [] }; byKey.set(k, g); groups.push(g); }
      byKey.get(k).items.push(i);
    });
    return groups.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1));
  }
  function ventsHtml(m) {
    const locked = m.status === 'used';
    const vents = m.data.vents || [];
    const total = vents.reduce((n, v) => n + (Number(v.qty) || 1), 0);
    const rooms = new Set(vents.map((v) => (v.room || '').trim().toLowerCase()).filter(Boolean)).size;
    const rows = vents.map((v, i) => `<div class="pp-vrow" role="listitem">
        <button type="button" class="pp-vrow-main" data-vent-open="${i}" aria-label="Edit vent ${i + 1}${v.room ? `, ${esc(v.room)}` : ''}">
          <span class="pp-vrow-thumb" aria-hidden="true">${ventSvg(v)}</span>
          <span class="pp-vrow-text"><strong>${esc(v.room || `Vent ${i + 1}`)}</strong><small>${esc([String(v.size || '').replace('x', '×'), VENT_TYPE_LABEL[v.type] || '', [v.species, v.finish].filter((x) => x && x.trim()).join(' · ')].filter(Boolean).join(' · '))}${(v.photos || []).length ? ` · ${(v.photos || []).length} photo${(v.photos || []).length > 1 ? 's' : ''}` : ''}</small></span>
        </button>
        <span class="pp-stepper" role="group" aria-label="Quantity">
          ${locked ? '' : `<button type="button" data-vent-qty="${i}:-1" aria-label="One less" ${(Number(v.qty) || 1) <= 1 ? 'disabled' : ''}>−</button>`}
          <b aria-live="polite">${Number(v.qty) || 1}</b>
          ${locked ? '' : `<button type="button" data-vent-qty="${i}:1" aria-label="One more">+</button>`}
        </span>
      </div>`).join('');
    return `<section class="pp-card pp-vents" aria-labelledby="ppVentsT">
        <div class="pp-vents-head"><div><h3 id="ppVentsT">Vents</h3><small>${vents.length ? `${total} vent${total === 1 ? '' : 's'}${rooms ? ` in ${rooms} room${rooms === 1 ? '' : 's'}` : ''}` : 'Each size and room once — use the count for repeats'}</small></div>${locked ? '' : '<button type="button" class="pp-btn pp-btn--pri pp-btn--sm" id="ppVentAdd">+ Vent</button>'}</div>
        ${vents.length ? `<div class="pp-vlist" role="list">${rows}</div>` : `<div class="pp-empty" style="padding:22px 8px">${mate('head-thinking', 56)}<strong>No vents measured</strong>Add each vent with its size, type and finish.</div>`}
      </section>`;
  }

  /** Vent editor in a sheet: drawing on top, fields below; the list updates when it closes. */
  function openVentSheet(i, isNew) {
    const m = state.meas;
    const v = m.data.vents[i];
    if (!v) return;
    const locked = m.status === 'used';
    const p = `vents.${i}`;
    const dis = locked ? 'disabled' : '';
    const knownSize = VENT_SIZES.includes(v.size);
    const root = openSheet(isNew ? 'New vent' : (v.room || `Vent ${i + 1}`), `
      <div class="pp-vsheet">
        <div class="pp-vent-viz" id="ppVentViz">${ventSvg(v)}</div>
        <div class="pp-fields pp-vsheet-fields">
          <div class="pp-field pp-field--wide"><label for="ppVRoom">Room</label><input id="ppVRoom" data-txt="${p}.room" value="${esc(v.room)}" maxlength="80" placeholder="e.g. Master bedroom" ${dis} /></div>
          <div class="pp-field"><label for="ppVSize">Size</label><select id="ppVSize" data-vsize="${p}" ${dis}>${VENT_SIZES.map((sz) => `<option ${sz === v.size ? 'selected' : ''}>${sz}</option>`).join('')}<option value="__other" ${knownSize ? '' : 'selected'}>Other…</option></select>${knownSize ? '' : `<input data-txt="${p}.size" value="${esc(String(v.size || '').trim())}" maxlength="20" placeholder="e.g. 4x16" aria-label="Other size" ${dis} />`}</div>
          <div class="pp-field"><label for="ppVQty">How many</label><input id="ppVQty" type="number" inputmode="numeric" min="1" max="500" data-num="${p}.qty" value="${esc(v.qty || 1)}" ${dis} /></div>
          <div class="pp-field pp-field--wide"><span class="pp-flabel">Type</span><div class="pp-seg pp-seg--wrap" role="group" aria-label="Vent type">${VENT_TYPES.map(([k, l]) => `<button type="button" data-vtype="${k}" aria-pressed="${v.type === k}" ${dis}>${esc(l)}</button>`).join('')}</div></div>
          <div class="pp-field"><label for="ppVWood">Wood</label>${selFree(SPECIES, v.species, `id="ppVWood" data-free="${p}.species" ${dis}`)}${SPECIES.includes(v.species) || !v.species ? '' : `<input data-txt="${p}.species" value="${esc(v.species.trim())}" maxlength="60" aria-label="Other wood" ${dis} />`}</div>
          <div class="pp-field"><label for="ppVFinish">Finish</label>${selFree(FINISHES, v.finish, `id="ppVFinish" data-free="${p}.finish" ${dis}`)}${FINISHES.includes(v.finish) || !v.finish ? '' : `<input data-txt="${p}.finish" value="${esc(v.finish.trim())}" maxlength="60" aria-label="Other finish" ${dis} />`}</div>
          <div class="pp-field"><label for="ppVColor">Color / stain</label><input id="ppVColor" data-txt="${p}.color" value="${esc(v.color)}" maxlength="80" ${dis} /></div>
          <div class="pp-field"><label for="ppVNote">Note</label><input id="ppVNote" data-txt="${p}.note" value="${esc(v.note)}" maxlength="300" ${dis} /></div>
          <div class="pp-field pp-field--wide"><span class="pp-flabel">Photos</span>${photoStrip(m, v.photos, `${p}.photos`)}</div>
        </div>
        <div class="pp-sheet-actions">
          ${locked ? '' : `<button type="button" class="pp-btn pp-btn--sec pp-late" data-vs-rm>Remove</button><button type="button" class="pp-btn pp-btn--sec" data-vs-dup>Duplicate</button>`}
          <button type="button" class="pp-btn pp-btn--pri" data-sheet-close>Done</button>
        </div>
      </div>`, { noFocus: !isNew });
    const repaint = () => { const box = root.querySelector('#ppVentViz'); if (box) box.innerHTML = ventSvg(m.data.vents[i]); };
    const reopen = () => { closeSheet(); openVentSheet(i, isNew); };
    root.querySelectorAll('[data-txt]').forEach((el) => el.addEventListener('input', () => { const { obj, key } = measAt(el.getAttribute('data-txt')); obj[key] = el.value; measSaveSoon(); repaint(); }));
    root.querySelectorAll('[data-num]').forEach((el) => el.addEventListener('input', () => { const { obj, key } = measAt(el.getAttribute('data-num')); obj[key] = Math.max(1, Math.round(Number(el.value) || 1)); measSaveSoon(); }));
    root.querySelectorAll('[data-free]').forEach((el) => el.addEventListener('change', () => {
      const { obj, key } = measAt(el.getAttribute('data-free'));
      obj[key] = el.value === '__other' ? ' ' : el.value;
      measSaveSoon();
      reopen();
      if (el.value === '__other') { const inp = $('ppSheet') && $('ppSheet').querySelector(`[data-txt="${el.getAttribute('data-free')}"]`); if (inp) { inp.value = ''; inp.focus(); } }
    }));
    root.querySelectorAll('[data-vsize]').forEach((el) => el.addEventListener('change', () => {
      m.data.vents[i].size = el.value === '__other' ? ' ' : el.value;
      measSaveSoon();
      reopen();
      if (el.value === '__other') { const inp = $('ppSheet') && $('ppSheet').querySelector(`[data-txt="${p}.size"]`); if (inp) { inp.value = ''; inp.focus(); } }
    }));
    root.querySelectorAll('[data-vtype]').forEach((b) => b.addEventListener('click', () => {
      m.data.vents[i].type = b.getAttribute('data-vtype');
      root.querySelectorAll('[data-vtype]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      measSaveSoon();
      repaint();
    }));
    root.querySelectorAll('[data-ph-add]').forEach((inp) => inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const label = inp.closest('.pp-meas-addph');
      if (label) label.classList.add('is-busy');
      try {
        const dataUrl = (await compressImage(file)) || (await readAsDataUrl(file));
        const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/photos`, { data_url: dataUrl });
        m.data.vents[i].photos = (m.data.vents[i].photos || []).concat(r.data.key);
        measSaveSoon();
        await measSaveNow();
        reopen();
      } catch (e) {
        window.alert(e.message || 'Could not upload the photo.');
        if (label) label.classList.remove('is-busy');
      }
    }));
    root.querySelectorAll('[data-ph-rm]').forEach((b) => b.addEventListener('click', () => {
      m.data.vents[i].photos.splice(Number(b.getAttribute('data-ph-i')), 1);
      measSaveSoon();
      reopen();
    }));
    const rm = root.querySelector('[data-vs-rm]');
    if (rm) rm.addEventListener('click', () => {
      if (rm.dataset.armed !== '1') { rm.dataset.armed = '1'; rm.textContent = 'Tap again to remove'; return; }
      m.data.vents.splice(i, 1);
      measSaveSoon();
      closeSheet();
    });
    const dup = root.querySelector('[data-vs-dup]');
    if (dup) dup.addEventListener('click', () => {
      m.data.vents.splice(i + 1, 0, { ...m.data.vents[i], id: uid(), photos: [], note: '' });
      measSaveSoon();
      closeSheet();
      openVentSheet(i + 1, true);
    });
    // The list behind the sheet shows the new values once it closes.
    const obs = new MutationObserver(() => {
      if (!document.body.contains(root)) {
        obs.disconnect();
        if (state.meas === m && route().name === 'measurements') { const y = window.scrollY; paintMeasurement(); window.scrollTo(0, y); }
      }
    });
    obs.observe(document.body, { childList: true });
  }

  function measSummaryHtml(m) {
    const lines = measSummary(m.data);
    return `<h3>Summary</h3>${lines.length ? `<ul class="pp-meas-sum">${lines.map((l) => `<li><span><b>${esc(l.kind)}</b> ${esc(l.text)}<small>${esc(l.group)}</small></span><em>${Number(l.qty).toLocaleString('en-US')} ${l.uom || 'EA'}</em></li>`).join('')}</ul>` : '<p class="pp-muted" style="margin:0">Pieces show up here grouped by size, like on the Work Order.</p>'}`;
  }

  function measLogHtml(m) {
    const log = (m.log || []).slice(-8).reverse();
    return `<ul class="pp-meas-log">${log.map((l) => `<li><b>${esc(l.name || '')}</b> ${esc(LOG_EN[l.action] || l.action || '')}<small>${esc(fmtDayEn(l.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</small></li>`).join('') || '<li class="pp-muted">—</li>'}</ul>`;
  }

  /** Work Order sections on the Summary tab: floors, stairs and vents room by room, each with a way back to edit. */
  function measSummarySectionsHtml(m) {
    const locked = m.status === 'used';
    const d = m.data;
    const totals = planTotals(d.plan).filter((t) => t.include);
    const lines = measSummary(d);
    const sec = (tab, title, sub, body, empty) => `<section class="pp-card pp-ssec" aria-label="${esc(title)}">
        <div class="pp-ssec-head"><div><h3>${esc(title)}</h3>${sub ? `<small>${sub}</small>` : ''}</div><button type="button" class="pp-link" data-mtab-go="${tab}">${body ? (locked ? 'View' : 'Edit') : (locked ? 'View' : 'Add')}</button></div>
        ${body || `<p class="pp-ssec-empty">${empty}</p>`}
      </section>`;
    const row = (lead, main, sub, qty) => `<li>${lead}<span class="pp-srow-t"><b>${main}</b>${sub ? `<small>${sub}</small>` : ''}</span><em>${qty}</em></li>`;
    // floors
    const ft = totals.reduce((a, t) => a + t.area, 0);
    const floors = totals.length ? `<ul class="pp-srows">${totals.map((t) => {
      const o = orderQty(t);
      return row(`<i class="pp-swatch pp-swatch--lg" style="background:${esc(t.color || '#C9B79C')}" aria-hidden="true"></i>`, esc(t.label), esc([specText(t), t.kind === 'hardwood' && t.sand_finish ? 'sand & finish' : '', t.levels.map((l) => `${l.name} ${fmtSf(l.area)}`).join(' · ')].filter(Boolean).join(' · ')), `${fmtSf(t.area)}<small>${o.waste ? `${o.sf.toLocaleString('en-US')} SF w/ ${o.waste}% waste` : ''}</small>`);
    }).join('')}</ul>` : '';
    // stairs
    const stairs = (d.stairs || []).map((st) => {
      const ls = lines.filter((l) => l.group === (st.name || 'Stair') && l.kind !== 'Vent' && l.kind !== 'Floor');
      if (!ls.length) return '';
      const wood = [st.species, st.finish, st.color].filter(Boolean).join(' · ');
      return `<div class="pp-sgroup"><div class="pp-sgroup-h">${esc(st.name || 'Stair')}<small>${esc(wood)}</small></div><ul class="pp-srows">${ls.map((l) => row(`<span class="pp-skind">${esc(l.kind)}</span>`, esc(wood && l.text.startsWith(`${wood} · `) ? l.text.slice(wood.length + 3) : l.text), '', `${l.qty}<small>EA</small>`)).join('')}</ul></div>`;
    }).join('');
    // vents by room
    const vents = d.vents || [];
    const vg = ventGroups(vents);
    const ventBody = vents.length ? vg.map((g) => {
      const n = g.items.reduce((a, i) => a + (Number(vents[i].qty) || 1), 0);
      return `<div class="pp-sgroup"><div class="pp-sgroup-h">${esc(g.name || 'No room yet')}<small>${n} vent${n === 1 ? '' : 's'}</small></div><ul class="pp-srows">${g.items.map((i) => { const v = vents[i]; return row(`<span class="pp-sthumb" aria-hidden="true">${ventSvg(v)}</span>`, `${esc(String(v.size || '?').trim().replace('x', '×'))} ${esc(VENT_TYPE_LABEL[v.type] || '')}`, esc([v.species, v.finish, v.color].filter((x) => x && x.trim()).join(' · ')), `${Number(v.qty) || 1}<small>EA</small>`); }).join('')}</ul></div>`;
    }).join('') : '';
    const c = measCounts(d);
    return `${sec('floors', 'Floor Plan', ft ? `${fmtSf(ft)} · ${totals.length} type${totals.length === 1 ? '' : 's'}` : '', floors, 'No floors yet — upload the house plans in Floor Plan to measure every room.')}
      ${sec('stairs', 'Stairs', c.stairs ? `${c.stairs} stair${c.stairs === 1 ? '' : 's'} · ${c.treads} treads · ${c.risers} risers${c.nosings ? ` · ${c.nosings} nosings` : ''}` : '', stairs, 'No stairs measured.')}
      ${sec('vents', 'Vents', c.vents ? `${c.vents} vent${c.vents === 1 ? '' : 's'}${vg.filter((g) => g.key).length ? ` in ${vg.filter((g) => g.key).length} room${vg.filter((g) => g.key).length === 1 ? '' : 's'}` : ''}` : '', ventBody, 'No vents measured.')}`;
  }
  function measSummaryHtml(m) { return measSummarySectionsHtml(m); }

  function measLogHtml(m) {
    const log = (m.log || []).slice(-8).reverse();
    return `<ol class="pp-mtl">${log.map((l) => `<li><span class="pp-mtl-dot" aria-hidden="true"></span><div><b>${esc(l.name || 'Someone')}</b> ${esc(LOG_EN[l.action] || l.action || '')}<small>${esc(fmtDayEn(l.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</small></div></li>`).join('') || '<li class="pp-muted">No activity yet.</li>'}</ol>`;
  }

  function measuredText(m) {
    const md = (m.data && m.data.measured) || m.measured || {};
    const who = (md.names || []).join(' & ') || m.completed_by || m.updated_by || m.created_by || '';
    const on = md.on ? fmtDayEn(`${md.on}T12:00:00`, { month: 'short', day: 'numeric', year: 'numeric' }) : fmtDayEn(m.completed_at || m.updated_at || m.created_at, { month: 'short', day: 'numeric', year: 'numeric' });
    return { who, on, typed: Boolean((md.names || []).length) };
  }
  async function ensureTeam() {
    if (state.teamList) return state.teamList;
    const r = await api('/api/builder/team').catch(() => ({ data: [] }));
    state.teamList = (r.data || []).filter((x) => x.name && !x.disabled);
    return state.teamList;
  }
  /** Who measured the house and when: names from the team or typed, and the day. */
  function measuredByHtml(m) {
    const locked = m.status === 'used';
    const md = m.data.measured || (m.data.measured = { names: [], on: '' });
    const names = md.names || [];
    const team = (state.teamList || []).map((x) => x.name).filter((n) => !names.some((y) => y.toLowerCase() === n.toLowerCase()));
    const me = state.builder && state.builder.member && state.builder.member.name;
    const ideas = me && !names.length && !team.includes(me) ? [me, ...team] : team;
    return `<section class="pp-card pp-block pp-mby" id="ppMby" aria-labelledby="ppMbyT">
        <h3 id="ppMbyT">Measured by</h3>
        <div class="pp-mby-names">${names.length ? names.map((n, i) => `<span class="pp-mby-chip"><span class="pp-mby-av" aria-hidden="true">${esc(initials(n))}</span>${esc(n)}${locked ? '' : `<button type="button" data-mby-rm="${i}" aria-label="Remove ${esc(n)}">×</button>`}</span>`).join('') : `<p class="pp-muted pp-mby-none">Not set — the PDF shows ${esc(measuredText(m).who || 'who saved it')}.</p>`}</div>
        ${locked ? '' : `${ideas.length ? `<div class="pp-mby-ideas">${ideas.slice(0, 8).map((n) => `<button type="button" class="pp-chipbtn" data-mby-pick="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>` : ''}
        <form class="pp-mby-add" data-mby-form><input data-mby-in maxlength="80" placeholder="Add a name" aria-label="Add who measured" autocomplete="off" /><button type="submit" class="pp-btn pp-btn--sec pp-btn--sm">Add</button></form>`}
        <label class="pp-field pp-mby-on"><span>Date measured</span><input type="date" data-mby-on value="${esc(md.on || '')}" max="${esc(dateKey(new Date()))}" ${locked ? 'disabled' : ''} /></label>
      </section>`;
  }
  function bindMeasuredBy(m) {
    const box = $('ppMby');
    if (!box) return;
    const md = m.data.measured;
    const repaint = () => { box.outerHTML = measuredByHtml(m); bindMeasuredBy(m); paintMeasSubtitle(m); };
    const add = (n) => { const v = String(n || '').trim().slice(0, 80); if (!v || md.names.length >= 6 || md.names.some((x) => x.toLowerCase() === v.toLowerCase())) return; md.names.push(v); if (!md.on) md.on = dateKey(new Date()); measSaveSoon(); repaint(); };
    box.querySelectorAll('[data-mby-pick]').forEach((b) => b.addEventListener('click', () => add(b.getAttribute('data-mby-pick'))));
    box.querySelectorAll('[data-mby-rm]').forEach((b) => b.addEventListener('click', () => { md.names.splice(Number(b.getAttribute('data-mby-rm')), 1); measSaveSoon(); repaint(); }));
    const form = box.querySelector('[data-mby-form]');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); add(form.querySelector('[data-mby-in]').value); const i = $('ppMby') && $('ppMby').querySelector('[data-mby-in]'); if (i) i.focus(); });
    const on = box.querySelector('[data-mby-on]');
    if (on) on.addEventListener('change', () => { md.on = on.value || ''; measSaveSoon(); paintMeasSubtitle(m); });
    if (!state.teamList) ensureTeam().then(() => { if ($('ppMby') && state.meas === m) repaint(); });
  }
  function paintMeasSubtitle(m) {
    const el = $('ppMeasBy');
    if (!el) return;
    const t = measuredText(m);
    el.textContent = t.who ? `Measured by ${t.who} · ${t.on}` : '';
  }

  /** Summary tab: status and actions on top, what goes on the Work Order, notes, photos, who measured. */
  function measSummaryTabHtml(m) {
    const locked = m.status === 'used';
    const d = m.data;
    const c = measCounts(d);
    const ft = planTotals(d.plan).filter((t) => t.include).reduce((a, t) => a + t.area, 0);
    const plan = d.plan;
    const tile = (n, label, tab) => `<button type="button" class="pp-mkpi ${n ? '' : 'is-zero'}" data-mtab-go="${tab}"><b>${n}</b><span>${label}</span></button>`;
    const photos = [];
    (d.stairs || []).forEach((st) => (st.photos || []).forEach((k) => photos.push({ k, label: st.name || 'Stair', tab: 'stairs' })));
    (d.vents || []).forEach((v) => (v.photos || []).forEach((k) => photos.push({ k, label: v.room ? `Vent · ${v.room}` : 'Vent', tab: 'vents' })));
    const empty = !ft && !c.treads && !c.risers && !c.vents;
    const status = m.status === 'used' ? ['Sent with the Work Order', 'It’s part of the job now.']
      : m.status === 'done' ? ['Complete — ready to send', 'Send it with a Work Order, or reopen it to change something.']
      : empty ? ['Nothing measured yet', 'Start with Floors, Stairs or Vents — it all comes together here.']
      : ['In progress', 'Check what goes on the Work Order, then complete it.'];
    const quotePdf = plan && plan.quote_link_id && canDo('money.view') ? `/api/builder/measurements/${encodeURIComponent(m.id)}/quote-pdf?company=${encodeURIComponent(plan.quote_link_id)}` : '';
    return `<div class="pp-msum">
        <section class="pp-shero is-${esc(m.status)}${empty ? ' is-empty' : ''}">
          <div class="pp-shero-t">${mate(m.status === 'draft' ? (empty ? 'head-thinking' : 'head-happy') : 'head-talking', 52)}<div><h2>${esc(status[0])}</h2><p>${esc(status[1])}</p></div></div>
          <div class="pp-shero-acts">
            <a class="pp-btn pp-btn--sec" href="/api/builder/measurements/${encodeURIComponent(m.id)}/pdf" target="_blank" rel="noopener">${icon('download')}Measurement PDF</a>
            ${quotePdf ? `<a class="pp-btn pp-btn--sec" href="${quotePdf}" target="_blank" rel="noopener">${icon('download')}Quote PDF</a>` : ''}
            ${locked || !canDo('jobs.send') || empty ? '' : `<button type="button" class="pp-btn ${m.status === 'done' ? 'pp-btn--pri' : 'pp-btn--sec'}" data-send-wo>${icon('send')}Send work order</button>`}
            ${locked || m.status === 'done' || empty ? '' : '<button type="button" class="pp-btn pp-btn--pri" data-sum-done>Complete</button>'}
          </div>
        </section>
        <div class="pp-mkpis pp-mkpis--6">${tile(ft ? fmtSf(ft) : 0, 'Floor Plan', 'floors')}${tile(c.treads, 'Treads', 'stairs')}${tile(c.risers, 'Risers', 'stairs')}${tile(c.nosings, 'Nosings', 'stairs')}${tile(c.landings, 'Landings', 'stairs')}${tile(c.vents, 'Vents', 'vents')}</div>
        <div class="pp-msum-grid">
          <div class="pp-msum-main" id="ppMeasSum">${measSummarySectionsHtml(m)}</div>
          <div class="pp-msum-side">
            ${measuredByHtml(m)}
            <section class="pp-card pp-block"><h3>General notes</h3><textarea class="pp-mnotes" data-head="notes" maxlength="2000" rows="4" placeholder="e.g. access through the garage, concrete slab, client wants Jacobean on the treads" aria-label="General notes" ${locked ? 'disabled' : ''}>${esc(m.notes || '')}</textarea><small class="pp-muted pp-mnotes-hint">Goes on the PDF and the Work Order.</small></section>
            ${photos.length ? `<section class="pp-card pp-block"><h3>Photos <small class="pp-muted">${photos.length}</small></h3><div class="pp-sphotos">${photos.slice(0, 12).map((p) => `<a href="/api/builder/measurements/${encodeURIComponent(m.id)}/photo?key=${encodeURIComponent(p.k)}" target="_blank" rel="noopener" title="${esc(p.label)}"><img src="/api/builder/measurements/${encodeURIComponent(m.id)}/photo?key=${encodeURIComponent(p.k)}" alt="${esc(p.label)}" loading="lazy" /><span>${esc(p.label)}</span></a>`).join('')}</div></section>` : ''}
            <section class="pp-card pp-block"><h3>Activity</h3>${measLogHtml(m)}</section>
            ${locked ? '' : '<div class="pp-msum-acts"><button type="button" class="pp-link pp-late" id="ppMeasDel">Delete measurement</button></div>'}
          </div>
        </div>
      </div>`;
  }

  /* ─────────────────────────── floors from the house plans (takeoff, 3D, quote) ─────────────────────────── */

  const FLOOR_KIND_OPTS = [['hardwood', 'Hardwood'], ['lvp', 'LVP'], ['laminate', 'Laminate'], ['carpet', 'Carpet'], ['rubber', 'Rubber floor'], ['tile', 'Tile'], ['stone', 'Stone'], ['concrete', 'Polished concrete'], ['other', 'Not flooring']];
  const FLOORING_KINDS = ['hardwood', 'lvp', 'laminate', 'carpet', 'rubber'];
  const KIND_WORDS = { hardwood: /hard\s?wood|\bwood\b|engineered|oak/i, lvp: /\blvp\b|\blvt\b|vinyl/i, laminate: /laminate/i, carpet: /carpet/i, rubber: /rubber/i };
  let plan3d = null;

  /** Product details each floor type asks for; values are suggestions, anything can be typed. */
  const SPEC_FIELDS = {
    hardwood: ['species', 'construction', 'width', 'thickness', 'grade', 'finish', 'color', 'sheen', 'install', 'pattern', 'brand'],
    lvp: ['brand', 'color', 'size', 'thickness', 'wear', 'install', 'underlayment'],
    laminate: ['brand', 'color', 'size', 'thickness', 'install', 'underlayment'],
    carpet: ['brand', 'color', 'pad'],
    rubber: ['brand', 'color', 'thickness'],
    tile: ['brand', 'color', 'size'], stone: ['brand', 'color', 'size'], concrete: ['color'], other: ['brand', 'color'],
  };
  const SPEC_LABEL = { species: 'Species', construction: 'Construction', width: 'Width', thickness: 'Thickness', grade: 'Grade', finish: 'Finish', color: 'Color / stain', sheen: 'Sheen', install: 'Install', pattern: 'Pattern', brand: 'Brand / product', size: 'Plank size', wear: 'Wear layer', underlayment: 'Underlayment', pad: 'Pad' };
  const SPEC_OPTS = {
    species: ['White Oak', 'Red Oak', 'Hickory', 'Maple', 'Walnut', 'Ash', 'Birch', 'Brazilian Cherry', 'Acacia'],
    construction: ['Engineered', 'Solid'],
    width: ['2-1/4"', '3-1/4"', '4"', '5"', '6"', '6-1/2"', '7"', '7-1/2"', '8"', '9"', '10"', 'Mixed widths'],
    'thickness:hardwood': ['3/4"', '5/8"', '9/16"', '1/2"', '3/8"'],
    'thickness:lvp': ['4 mm', '5 mm', '6 mm', '8 mm'],
    'thickness:laminate': ['7 mm', '8 mm', '10 mm', '12 mm'],
    'thickness:rubber': ['1/4"', '3/8"', '8 mm'],
    grade: ['Clear', 'Select', '#1 Common', '#2 Common', 'Character', 'Rustic'],
    finish: ['Unfinished — sand & finish on site', 'Prefinished'],
    color: ['Natural', 'Jacobean', 'Special Walnut', 'Provincial', 'Ebony', 'Classic Gray', 'Weathered Oak', 'Driftwood', 'Coffee', 'Dark Walnut'],
    sheen: ['Matte', 'Satin', 'Semi-gloss', 'Gloss'],
    install: ['Nail down', 'Glue down', 'Nail & glue', 'Floating (click)'],
    pattern: ['Straight', 'Herringbone', 'Chevron', 'Diagonal'],
    size: ['7" × 48"', '7" × 60"', '9" × 60"', '9" × 72"', '12" × 24" tile', '18" × 36" tile'],
    wear: ['12 mil', '20 mil', '22 mil', '28 mil'],
    underlayment: ['Attached pad', 'Separate underlayment', 'None'],
    pad: ['6 lb 7/16"', '8 lb 7/16"', '8 lb 1/2"', '10 lb'],
  };
  function specText(m) {
    const sp = (m && m.spec) || {};
    const out = [];
    (SPEC_FIELDS[m.kind] || []).forEach((k) => {
      const v = String(sp[k] || '').trim();
      if (!v) return;
      if (k === 'thickness' && sp.width && out.length) { out[out.length - 1] = `${out[out.length - 1]} × ${v}`; return; }
      out.push(k === 'wear' ? `${v} wear layer` : k === 'pad' ? `${v} pad` : k === 'finish' ? v.replace(/ — .*/, '') : v);
    });
    return out.join(' · ');
  }

  /** Product details of one floor type (species, width, finish…), and variants of it. */
  function openSpecSheet(i) {
    const m = state.meas; const plan = m.data.plan; const x = plan.materials[i];
    if (!x) return;
    x.spec = x.spec || {};
    const fields = SPEC_FIELDS[x.kind] || SPEC_FIELDS.other;
    const used = plan.levels.some((lv) => lv.rooms.some((r) => r.material === x.key));
    const root = openSheet(`${x.label} · product`, `<form id="ppSpecForm" class="pp-fields" novalidate>
        <div class="pp-field pp-field--wide"><label for="ppSpecLabel">Name on the takeoff</label><input id="ppSpecLabel" maxlength="60" value="${esc(x.label)}" /></div>
        ${fields.map((k) => { const opts = SPEC_OPTS[`${k}:${x.kind}`] || SPEC_OPTS[k] || []; return `<div class="pp-field ${k === 'brand' || k === 'finish' ? 'pp-field--wide' : ''}"><label for="ppSp-${k}">${esc(SPEC_LABEL[k] || k)}</label><input id="ppSp-${k}" data-spec="${k}" maxlength="80" list="ppSpL-${k}" value="${esc(x.spec[k] || '')}" placeholder="${esc(opts[0] ? `e.g. ${opts[0]}` : '')}" autocomplete="off" /><datalist id="ppSpL-${k}">${opts.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist></div>`; }).join('')}
        <p class="pp-muted pp-field--wide" style="margin:0;font-size:13px">Pick from the list or type anything. These details go on the quote, the PDF and the work order lines.</p>
        <div class="pp-sheet-actions pp-field--wide">
          <button type="button" class="pp-btn pp-btn--sec" data-spec-variant>${icon('pen')}Add a variant</button>
          ${!used && plan.materials.filter((y) => y.kind === x.kind).length > 1 ? '<button type="button" class="pp-btn pp-btn--sec pp-late" data-spec-rm>Remove</button>' : ''}
          <button type="submit" class="pp-btn pp-btn--pri">Save</button>
        </div>
      </form>`, { noFocus: true });
    const collect = () => {
      x.label = $('ppSpecLabel').value.trim() || x.label;
      root.querySelectorAll('[data-spec]').forEach((inp) => { const v = inp.value.trim(); if (v) x.spec[inp.getAttribute('data-spec')] = v; else delete x.spec[inp.getAttribute('data-spec')]; });
      if (x.kind === 'hardwood' && x.spec.finish) x.sand_finish = /^unfinished/i.test(x.spec.finish);
    };
    root.querySelector('#ppSpecForm').addEventListener('submit', (e) => { e.preventDefault(); collect(); closeSheet(); measSaveSoon(); const y = window.scrollY; paintMeasurement(); window.scrollTo(0, y); });
    root.querySelector('[data-spec-variant]').addEventListener('click', () => {
      collect();
      const n = plan.materials.filter((y) => y.kind === x.kind).length + 1;
      const copy = { ...x, key: `${x.kind}-v${Date.now().toString(36)}`, label: `${x.label.replace(/ \d+$/, '')} ${n}`, spec: { ...x.spec } };
      plan.materials.splice(i + 1, 0, copy);
      closeSheet(); measSaveSoon(); paintMeasurement();
      mateToast('measure', 'Variant added', 'Pick it in the Floor column of the rooms that use it.');
    });
    const rm = root.querySelector('[data-spec-rm]');
    if (rm) rm.addEventListener('click', () => { plan.materials.splice(i, 1); closeSheet(); measSaveSoon(); paintMeasurement(); });
  }

  function fmtSf(n) { return `${Math.round(Number(n) || 0).toLocaleString('en-US')} SF`; }
  function wastePct(kind) {
    const t = (state.builder && state.builder.account && state.builder.account.takeoff) || {};
    const w = t.waste || {};
    return Number.isFinite(Number(w[kind])) ? Number(w[kind]) : 10;
  }
  function boxSf(kind) {
    const t = (state.builder && state.builder.account && state.builder.account.takeoff) || {};
    return Number((t.box_sf || {})[kind]) || 0;
  }
  /** Square feet per material over the levels that count (rooms not left out). */
  function planTotals(plan) {
    if (!plan) return [];
    const out = new Map();
    (plan.materials || []).forEach((m) => out.set(m.key, { ...m, area: 0, levels: [] }));
    (plan.levels || []).forEach((lv) => {
      if (!lv.include) return;
      (lv.rooms || []).forEach((r) => {
        if (r.exclude) return;
        const t = out.get(r.material);
        if (!t) return;
        t.area += r.area_sf;
        const l = t.levels.find((x) => x.name === lv.name);
        if (l) l.area += r.area_sf; else t.levels.push({ name: lv.name, area: r.area_sf });
      });
    });
    return [...out.values()].filter((t) => t.area > 0).sort((a, b) => Number(b.include) - Number(a.include) || b.area - a.area);
  }
  function orderQty(t) {
    const w = wastePct(t.kind);
    const sf = Math.ceil(t.area * (1 + w / 100));
    const box = boxSf(t.kind);
    return { waste: w, sf, boxes: box ? Math.ceil(sf / box) : 0 };
  }
  function guessAddress(opened) {
    const rx = /^\d{2,6}\s+[A-Z0-9][A-Z0-9 .'-]{2,40}?\s(ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|CT|COURT|LN|LANE|WAY|POINT|PT|CIR|CIRCLE|BLVD|TRL|TRAIL|PL|PLACE|PKWY|LOOP|RUN|PASS|RIDGE|VIEW|TER|TERRACE|HWY)\.?$/i;
    const seen = new Map();
    opened.sheets.forEach((sh) => sh.lines.forEach((l) => {
      const t = l.text.replace(/\s+/g, ' ').trim();
      if (rx.test(t)) seen.set(t, (seen.get(t) || 0) + 1);
    }));
    const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0].toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : '';
  }

  async function uploadPlanFile(id, file) {
    const r = await fetch(`/api/builder/measurements/${encodeURIComponent(id)}/plan-file`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/pdf', 'X-File-Name': encodeURIComponent(file.name || 'plans') }, body: file,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Could not upload the plans.');
    return body.data;
  }

  /** Progress shown while Mate reads the plans. */
  function planProgress(root, text, pct) {
    const box = root && root.querySelector('[data-plan-progress]');
    if (!box) return;
    box.hidden = false;
    box.querySelector('span').textContent = text;
    box.querySelector('i').style.width = `${Math.max(4, Math.min(100, pct || 0))}%`;
  }

  /**
   * Reads the plans into the measurement: legend colors, scale, floors per level and room,
   * previews. Asks the person for colors / scale only when the file has none to read.
   */
  async function readPlans(m, file, root, existing) {
    if (!window.ObTakeoff) throw new Error('The plan reader did not load. Refresh the page and try again.');
    planProgress(root, 'Opening the plans…', 4);
    const upload = existing ? Promise.resolve(existing) : uploadPlanFile(m.id, file);
    const opened = await window.ObTakeoff.open(file, (p) => planProgress(root, `Reading sheet ${p.page} of ${p.pages}…`, 4 + (p.page / p.pages) * 16));
    planProgress(root, 'Finding the floor legend…', 22);
    let mats = await window.ObTakeoff.legend(opened);
    if (!mats.length) {
      // no legend: the floors are highlighted and named in callouts ("6\" WHITE OAK - SITE FIN.", "TILE")
      planProgress(root, 'No legend — reading the colors and notes on the plans…', 24);
      const mk = window.ObTakeoff.markupColors ? await window.ObTakeoff.markupColors(opened) : { mats: [], unknown: [] };
      mats = await pickColors(opened, mk);
      if (!mats || !mats.length) throw new Error('No floor colors were marked, so nothing was measured.');
    }
    mats.forEach((x) => { if (x.kind === 'hardwood' && x.sand_finish == null) x.sand_finish = true; });
    // reading again keeps what the person already chose for each floor (product, counted or not)
    const before = (m.data && m.data.plan && m.data.plan.materials) || [];
    mats.forEach((x) => {
      const old = before.find((o) => o.label === x.label && o.kind === x.kind && String(o.pages || '') === String(x.pages || '')) || before.find((o) => o.color === x.color && String(o.pages || '') === String(x.pages || ''));
      if (old) { x.spec = { ...(old.spec || {}) }; x.include = old.include; x.sand_finish = old.sand_finish; x.kind = old.kind; x.label = old.label; }
    });
    const levels = []; const previews = [];
    const sheets = opened.sheets;
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i];
      let ppf = sh.ppf && sh.scaleConf >= 0.2 ? sh.ppf : null;
      if (!ppf) {
        ppf = await calibrate(sh, `Scale for ${sh.name}`);
        if (!ppf) continue;
      }
      const base = 25 + (i / sheets.length) * 65;
      const res = await window.ObTakeoff.readSheet(sh, mats, ppf, (p) => planProgress(root, `${sh.name}: ${p.step === 'floors' ? 'finding the floors' : p.step === 'rooms' ? 'splitting into rooms' : 'drawing the sheet'}…`, base + (p.f || 0) * (55 / sheets.length)));
      if (!res.level.rooms.length) continue;
      levels.push(res.level); previews.push(res.preview);
    }
    if (!levels.length) throw new Error('No colored floors were found on these plans. Check that the floors are marked with the legend colors.');
    planProgress(root, 'Saving…', 94);
    const fileRef = await upload;
    for (let i = 0; i < levels.length; i++) {
      try { const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/plan-preview`, { data_url: previews[i] }); levels[i].preview = r.data.key; } catch (_) { /* preview is optional */ }
    }
    const prev = (m.data && m.data.plan) || {};
    const companies = (state.builder.companies || []).filter((c) => c.status !== 'archived');
    m.data.plan = {
      file: { key: fileRef.key, name: fileRef.name || file.name, type: fileRef.type || file.type, pages: opened.pages || 1, size: fileRef.size || file.size || 0 },
      materials: mats,
      levels,
      analyzed_at: new Date().toISOString(),
      quote_link_id: prev.quote_link_id || (companies[0] && companies[0].id) || null,
      quote_prices: prev.quote_prices || {},
    };
    m.tab = 'floors';
    m.floorView = 'takeoff';
    m.dirty = true;
    await measSaveNow();
    planProgress(root, 'Done', 100);
  }

  /** Scans/photos: the person taps each floor color and says what it is. */
  function pickColors(opened, found) {
    return new Promise(async (resolve) => {
      const f = found || { mats: [], unknown: [] };
      // the sheet with the most color shows best what to tap
      const sh = opened.sheets.reduce((a, b) => ((b.noteBoxes || []).length > (a.noteBoxes || []).length ? b : a), opened.sheets[0]);
      const Z = Math.min(2, 1400 / sh.ptW);
      const r = await window.ObTakeoff.render(sh, Z);
      // plans printed small on a page: show only the drawing (crop the white margins)
      const crop = (() => {
        const d = r.ctx.getImageData(0, 0, r.W, r.H).data; let x0 = r.W; let y0 = r.H; let x1 = 0; let y1 = 0;
        for (let y = 0; y < r.H; y += 2) for (let x = 0; x < r.W; x += 2) { const i = (y * r.W + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 720) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
        if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: r.W, h: r.H, url: r.canvas.toDataURL('image/jpeg', 0.85) };
        const pad = 12; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(r.W, x1 + pad); y1 = Math.min(r.H, y1 + pad);
        const cv = document.createElement('canvas'); cv.width = x1 - x0; cv.height = y1 - y0;
        cv.getContext('2d').drawImage(r.canvas, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);
        return { x: x0, y: y0, w: cv.width, h: cv.height, url: cv.toDataURL('image/jpeg', 0.85) };
      })();
      const mats = [
        ...f.mats.map((x) => ({ ...x })),
        ...f.unknown.map((u, i) => ({ key: `floor-u${i}`, label: 'Not flooring', color: u.color, kind: 'other', include: false, sand_finish: false, unsure: true })),
      ];
      const intro = f.mats.length || f.unknown.length
        ? `These plans have no legend, so Mate read the colors and the notes on them${f.mats.some((x) => x.from === 'note') ? ' (like the note written on a colored box)' : ''}.${f.mats.some((x) => x.pages) ? ' The same color can mean another floor on one sheet — the notes on that sheet decide.' : ''} Check what each color is — tap the plan to add a color it missed.`
        : 'These plans have no legend Mate can read. Tap a colored floor, then say what it is. Repeat for each floor color.';
      const root = openSheet(f.mats.length ? 'Check the floor colors' : 'Mark the floor colors', `<p class="pp-muted" style="margin:0 0 10px">${esc(intro)}</p>
        <div class="pp-plan-picked" data-picked></div>
        <div class="pp-plan-pick"><img alt="Plan sheet" src="${crop.url}" /></div>
        <div class="pp-sheet-actions"><button type="button" class="pp-btn pp-btn--pri" data-picked-done>Measure these floors</button></div>`, { wide: true, noFocus: true });
      const paint = () => { root.querySelector('[data-picked]').innerHTML = mats.map((x, i) => `<div class="pp-plan-pickrow ${x.unsure ? 'is-unsure' : ''}"><span class="pp-swatch" style="background:${esc(x.color)}"></span>${sel(FLOOR_KIND_OPTS, x.kind, `data-pick-kind="${i}" aria-label="Floor type"`)}<small class="pp-muted">${x.unsure ? 'Mate couldn’t tell — choose' : x.from === 'note' ? `From the note${x.spec && Object.keys(x.spec).length ? `: ${esc(Object.values(x.spec).join(' · '))}` : ''}` : x.from === 'callout' ? 'From a callout next to it' : ''}${x.where ? `<b class="pp-plan-where">${esc(x.where)}</b>` : ''}</small><button type="button" class="pp-link pp-late" data-pick-rm="${i}">Remove</button></div>`).join('') || '<p class="pp-muted" style="margin:6px 0">No colors yet.</p>';
        root.querySelectorAll('[data-pick-kind]').forEach((s) => s.addEventListener('change', () => { const x = mats[+s.getAttribute('data-pick-kind')]; x.kind = s.value; x.label = FLOOR_KIND_OPTS.find((o) => o[0] === s.value)[1]; x.include = FLOORING_KINDS.includes(s.value); x.unsure = false; x.sand_finish = s.value === 'hardwood'; }));
        root.querySelectorAll('[data-pick-rm]').forEach((b) => b.addEventListener('click', () => { mats.splice(+b.getAttribute('data-pick-rm'), 1); paint(); }));
      };
      paint();
      root.querySelector('.pp-plan-pick img').addEventListener('click', (e) => {
        const img = e.currentTarget; const rect = img.getBoundingClientRect();
        const x = crop.x + Math.round(((e.clientX - rect.left) / rect.width) * crop.w); const y = crop.y + Math.round(((e.clientY - rect.top) / rect.height) * crop.h);
        const color = window.ObTakeoff.colorAt(r.canvas, x, y);
        if (!color) { mateToast('head-curious', 'That spot has no color', 'Tap inside a colored floor.'); return; }
        mats.push({ key: `floor-${mats.length + 1}`, label: 'Hardwood', color, kind: 'hardwood', include: true, sand_finish: true });
        paint();
      });
      let done = false;
      root.querySelector('[data-picked-done]').addEventListener('click', () => { done = true; closeSheet(); resolve(mats.map((x, i) => { const { unsure, from, ...rest } = x; void unsure; void from; return { ...rest, key: `${x.kind}-${i + 1}` }; })); });
      new MutationObserver((_, obs) => { if (!root.isConnected) { obs.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
    });
  }

  /** Scale from two taps on a known length (sheets without dimension text, or to fix the scale). */
  function calibrate(sh, title) {
    return new Promise(async (resolve) => {
      const Z = Math.min(2.5, 1600 / sh.ptW);
      const r = await window.ObTakeoff.render(sh, Z);
      const pts = [];
      const root = openSheet(title || 'Set the scale', `<p class="pp-muted" style="margin:0 0 10px">Tap both ends of a dimension you know (like the outside wall), then type its length.</p>
        <div class="pp-plan-pick" data-cal-box><img alt="Plan sheet" src="${r.canvas.toDataURL('image/jpeg', 0.85)}" /><svg class="pp-plan-cal" viewBox="0 0 ${r.W} ${r.H}" preserveAspectRatio="none" aria-hidden="true"></svg></div>
        <div class="pp-fields" style="margin-top:12px"><div class="pp-field"><label for="ppCalFt">Real length (feet and inches)</label><input id="ppCalFt" inputmode="text" placeholder="e.g. 46'-8&quot; or 46.5" /></div></div>
        <p class="pp-error" id="ppCalErr" role="alert" hidden></p>
        <div class="pp-sheet-actions"><button type="button" class="pp-btn pp-btn--pri" data-cal-ok>Use this scale</button></div>`, { wide: true, noFocus: true });
      const svg = root.querySelector('.pp-plan-cal');
      const draw = () => { svg.innerHTML = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${8 * Z}" fill="#E7792C"/>`).join('') + (pts.length === 2 ? `<line x1="${pts[0].x}" y1="${pts[0].y}" x2="${pts[1].x}" y2="${pts[1].y}" stroke="#E7792C" stroke-width="${3 * Z}"/>` : ''); };
      root.querySelector('[data-cal-box] img').addEventListener('click', (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const p = { x: ((e.clientX - rect.left) / rect.width) * r.W, y: ((e.clientY - rect.top) / rect.height) * r.H };
        if (pts.length === 2) pts.length = 0;
        pts.push(p); draw();
      });
      let done = false;
      root.querySelector('[data-cal-ok]').addEventListener('click', () => {
        const raw = $('ppCalFt').value.trim();
        const ft = window.ObTakeoff.parseDim(raw.replace(/^(\d+)$/, "$1'-0\"")) || (Number(raw) > 0 ? Number(raw) : null);
        if (pts.length !== 2) { formError('ppCalErr', { message: 'Tap both ends of the dimension first.' }); return; }
        if (!ft) { formError('ppCalErr', { message: "Type the length, like 46'-8\" or 46.5." }); return; }
        const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        done = true; closeSheet(); resolve(px / Z / ft);
      });
      new MutationObserver((_, obs) => { if (!root.isConnected) { obs.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
    });
  }

  /** Opens the stored plans again (to re-read them or fix the scale of a sheet). */
  async function storedPlanFile(m) {
    const f = m.data.plan && m.data.plan.file;
    if (!f) return null;
    const r = await fetch(`/api/builder/measurements/${encodeURIComponent(m.id)}/plan-file?key=${encodeURIComponent(f.key)}`, { credentials: 'include' });
    if (!r.ok) throw new Error('Could not open the plans.');
    const blob = await r.blob();
    return new File([blob], f.name || 'plans', { type: f.type });
  }

  /** Send work order prefilled from a measurement: address, floor lines with agreed prices, the measurement attached. */
  async function sendFromMeasurement(m, fromSendPage, coOverride) {
    if (m.dirty) await measSaveNow();
    const plan = m.data && m.data.plan;
    const s = newSend();
    const companies = (state.builder.companies || []);
    s.co = coOverride || (plan && plan.quote_link_id && companies.some((c) => c.id === plan.quote_link_id) ? plan.quote_link_id : null) || (state.send && state.send.co) || (sendCo() && sendCo().id) || null;
    const totals = planTotals(plan).filter((t) => t.include);
    const c = measCounts(m.data);
    const f = emptyFields();
    f.address = m.address || '';
    f.community = m.community || '';
    f.lot = m.lot || '';
    const kinds = [...new Set(totals.map((t) => (t.kind === 'hardwood' ? 'Hardwood' : t.kind === 'lvp' ? 'LVP' : t.label)))];
    const parts = [...kinds, c.treads ? 'stairs' : '', c.vents ? 'vents' : ''].filter(Boolean);
    f.service_type = (parts.length ? `Install – ${parts.join(', ')}` : 'Flooring').slice(0, 100);
    f.title = `${kinds.length ? `${kinds.join(' + ')} floors` : parts.length ? parts.join(' & ') : 'Work'} · ${m.address}`.slice(0, 160);
    if (totals.length) f.square_feet = String(Math.round(totals.reduce((a, t) => a + t.area, 0)));
    f.material = totals.map((t) => `${t.label}${specText(t) ? `: ${specText(t)}` : ''}`).join('; ').slice(0, 120);
    f.notes = [m.notes || '', totals.length ? `Floors measured from the plans: ${totals.map((t) => `${t.label} ${fmtSf(t.area)} (order ${fmtSf(orderQty(t).sf)} with ${orderQty(t).waste}% waste)`).join('; ')}.` : ''].filter(Boolean).join('\n').slice(0, 4000);
    s.fields = f;
    // floor lines with the company's agreed prices
    let prices = [];
    if (canDo('money.view') && s.co) prices = await api(`/api/builder/prices?company=${encodeURIComponent(s.co)}`).then((r) => (r.data || []).filter((p) => p.company_id === s.co)).catch(() => []);
    s.agreed = prices;
    if (plan) {
      const planForQuote = { ...m, data: { ...m.data, plan: { ...plan, quote_prices: plan.quote_link_id === s.co ? plan.quote_prices : {}, quote_rates: plan.quote_link_id === s.co ? plan.quote_rates || {} : {} } } };
      s.items = quoteLines(planForQuote, prices).map((l) => ({
        area: '', description: l.name, detail: l.spec || '', quantity: l.qty, uom: 'SF',
        rate: l.price ? l.price.price : null, total: null,
        pricing_item_id: l.price && l.price.pricing_item_id ? l.price.pricing_item_id : null,
        service_name: l.price && !l.price.typed ? l.price.name : l.name, create_service: true, remove: false,
      }));
    }
    s.measurement = {
      id: m.id, address: m.address, status: m.status, counts: { ...c, floor_text: totals.map((t) => `${t.label} ${fmtSf(t.area)}`).join(' · ') },
      summary: measSummary(m.data).map((l) => ({ text: `${l.kind} · ${l.text}`, qty: Number(l.qty).toLocaleString('en-US'), uom: l.uom || 'EA' })),
      measured_by: m.completed_by || m.updated_by || m.created_by, measured_at: m.completed_at || m.updated_at,
    };
    s.useMeasurement = m.status !== 'used';
    s.fromMeas = { id: m.id, hasPlans: Boolean(plan && plan.file) };
    s.ai = false; s.mode = 'new'; s.phase = 'review'; s.step = 'measure';
    s.measData = m.data;
    state.send = s;
    if (s.co) postJson('/api/builder/select', { company_id: s.co }).catch(() => {});
    if (fromSendPage && location.hash === '#send') render(); else location.hash = '#send';
  }

  /** "From plans": pick the file, confirm the address Mate read from it, then measure. */
  function openPlanUpload() {
    const root = openSheet('Measure from plans', `
      <form id="ppPlanNew" novalidate>
        <label class="pp-plan-drop">${mate('measure', 96)}<span><strong>Choose the house plans</strong><small>PDF from the architect or a photo. Floors marked with legend colors (hardwood, LVP, carpet…) are measured room by room.</small></span><input type="file" id="ppPlanFile" accept="application/pdf,image/jpeg,image/png,image/webp" hidden /><span class="pp-btn pp-btn--sec pp-btn--sm">${icon('upload')}Choose file</span></label>
        <p class="pp-muted" id="ppPlanName" hidden></p>
        <div class="pp-field" style="margin-top:12px"><label for="ppPlanAddr">Job address *</label><input id="ppPlanAddr" maxlength="300" data-om-address-autocomplete data-crm-address-autocomplete="1" required placeholder="e.g. 1083 Golf Estates Point" /></div>
        <div class="pp-plan-progress" data-plan-progress hidden><span>…</span><b><i></i></b></div>
        <p class="pp-error" id="ppPlanErr" role="alert" hidden></p>
        <div class="pp-sheet-actions"><button type="submit" class="pp-btn pp-btn--pri" id="ppPlanGo" disabled>Measure the floors</button></div>
      </form>`, { noFocus: true });
    let file = null;
    root.querySelector('#ppPlanFile').addEventListener('change', async (e) => {
      file = e.target.files && e.target.files[0];
      if (!file) return;
      const nm = $('ppPlanName'); nm.hidden = false; nm.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
      $('ppPlanGo').disabled = false;
      if (file.size > 40 * 1048576) { formError('ppPlanErr', { message: 'The plans must be under 40 MB.' }); $('ppPlanGo').disabled = true; return; }
      try {
        if (!$('ppPlanAddr').value.trim() && window.ObTakeoff && /pdf/.test(file.type)) {
          const op = await window.ObTakeoff.open(file);
          const a = guessAddress(op);
          if (a && $('ppPlanAddr') && !$('ppPlanAddr').value.trim()) $('ppPlanAddr').value = a;
        }
      } catch (_) { /* address stays empty */ }
    });
    root.querySelector('#ppPlanNew').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('ppPlanErr').hidden = true;
      if (!file) { formError('ppPlanErr', { message: 'Choose the plans first.' }); return; }
      if ($('ppPlanAddr').value.trim().length < 4) { formError('ppPlanErr', { message: 'Enter the job address.' }); return; }
      const btn = $('ppPlanGo'); btn.disabled = true;
      let created = null;
      try {
        const res = await postJson('/api/builder/measurements', { address: $('ppPlanAddr').value.trim() });
        created = res.data;
        state.meas = { ...created, tab: 'floors', dirty: false };
        await readPlans(state.meas, file, root);
        closeSheet();
        location.hash = `#measurements/${created.id}`;
        render();
        mateToast('measure', 'Floors measured', 'Check the rooms and the 3D view.');
      } catch (ex) {
        formError('ppPlanErr', ex);
        btn.disabled = false;
        if (created) { closeSheet(); location.hash = `#measurements/${created.id}`; }
      }
    });
  }

  function floorsEmptyHtml(m) {
    const locked = m.status === 'used';
    return `<section class="pp-card pp-empty pp-plan-empty">${mate('measure', 140)}<strong>Floors from the house plans</strong>
      <span>Upload the plans (PDF or photo) with the floors marked in color. Mate reads the legend and the scale, measures each room, builds the house in 3D and prices the work with your company’s price list.</span>
      ${locked ? '' : `<label class="pp-btn pp-btn--pri" style="margin-top:14px">${icon('upload')}Upload plans<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" data-plan-file hidden /></label>
      <div class="pp-plan-progress" data-plan-progress hidden><span>…</span><b><i></i></b></div>`}
    </section>`;
  }

  function floorKpisHtml(totals) {
    const inc = totals.filter((t) => t.include);
    if (!inc.length) return '';
    return `<div class="pp-plan-kpis">${inc.map((t) => { const o = orderQty(t); return `<div class="pp-plan-kpi"><span class="pp-swatch" style="background:${esc(t.color)}"></span><div><small>${esc(t.label)}${specText(t) ? ` · ${esc(specText(t))}` : ''}</small><b>${fmtSf(t.area)}</b><span>Order ${fmtSf(o.sf)}${o.boxes ? ` · ${o.boxes} boxes` : ''} · ${o.waste}% waste</span></div></div>`; }).join('')}</div>`;
  }

  function floorsTakeoffHtml(m) {
    const plan = m.data.plan; const locked = m.status === 'used';
    const totals = planTotals(plan);
    const matOpts = plan.materials.map((x) => [x.key, x.label]);
    const dis = locked ? 'disabled' : '';
    const mats = `<section class="pp-card pp-block pp-plan-mats"><div class="pp-block-head"><h3>Floors on the plans</h3><span class="pp-muted">From the legend</span></div>
      ${plan.materials.map((x, i) => { const t = totals.find((y) => y.key === x.key); return `<div class="pp-plan-mat ${x.include ? '' : 'is-off'}">
        <span class="pp-swatch" style="background:${esc(x.color)}"></span>
        <div class="pp-plan-mat-main"><strong>${esc(x.label)}</strong><small>${t ? fmtSf(t.area) : 'Not found on the plans'}${x.where ? ` · ${esc(x.where)}` : ''}</small>${x.include && t && FLOORING_KINDS.includes(x.kind) ? (specText(x) ? `<button type="button" class="pp-plan-spec" data-pmat-spec="${i}" ${dis}>${esc(specText(x))}</button>` : (locked ? '' : `<button type="button" class="pp-link pp-plan-spec-add" data-pmat-spec="${i}">+ Product details</button>`)) : ''}</div>
        ${sel(FLOOR_KIND_OPTS, x.kind, `data-pmat-kind="${i}" aria-label="Floor type for ${esc(x.label)}" ${dis}`)}
        ${x.kind === 'hardwood' ? `<label class="pp-check pp-plan-sand"><input type="checkbox" data-pmat-sand="${i}" ${x.sand_finish ? 'checked' : ''} ${dis} />Sand &amp; finish</label>` : '<span class="pp-plan-sand"></span>'}
        <label class="pp-switch" title="Count this floor"><input type="checkbox" data-pmat-inc="${i}" ${x.include ? 'checked' : ''} ${dis} /><span>${x.include ? 'In the takeoff' : 'Left out'}</span></label>
      </div>`; }).join('')}
      <p class="pp-muted pp-plan-note">Tile, shower pans and countertops stay out for now. Waste per floor type is in <a class="pp-link" href="#settings/takeoff">Settings › Takeoff</a>.</p>
    </section>`;
    const levels = plan.levels.map((lv, li) => {
      const lvTotal = lv.rooms.filter((r) => !r.exclude && (plan.materials.find((x) => x.key === r.material) || {}).include).reduce((a, r) => a + r.area_sf, 0);
      return `<section class="pp-card pp-plan-level ${lv.include ? '' : 'is-off'}">
        <div class="pp-plan-level-head">
          <div><h3>${esc(lv.name)}</h3><small>${fmtSf(lvTotal)} counted · ${lv.scale_auto ? 'Scale read from the plan dimensions' : 'Scale set by hand'}</small></div>
          <div class="pp-plan-level-acts">${locked ? '' : `<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-plv-scale="${li}">Fix scale</button>`}<label class="pp-switch"><input type="checkbox" data-plv-inc="${li}" ${lv.include ? 'checked' : ''} ${dis} /><span>${lv.include ? 'Counted' : 'Left out'}</span></label></div>
        </div>
        <div class="pp-plan-level-body">
          <div class="pp-plan-sheet" data-plv-sheet="${li}">${lv.preview ? `<img src="/api/builder/measurements/${encodeURIComponent(m.id)}/plan-file?key=${encodeURIComponent(lv.preview)}" alt="${esc(lv.name)} plan" loading="lazy" /><canvas aria-hidden="true"></canvas>` : '<p class="pp-muted">No preview</p>'}</div>
          <div class="pp-plan-rooms" role="table" aria-label="Rooms on ${esc(lv.name)}">
            <div class="pp-plan-room pp-plan-room--head" role="row"><span role="columnheader">Room</span><span role="columnheader">Floor</span><span role="columnheader">Area</span><span role="columnheader">Vents</span><span role="columnheader"><span class="pp-sr">Count</span></span></div>
            ${lv.rooms.map((r, ri) => ({ r, ri, on: !r.exclude && (plan.materials.find((x) => x.key === r.material) || {}).include })).sort((a, b) => Number(b.on) - Number(a.on)).map(({ r, ri, on }) => `<div class="pp-plan-room ${on ? '' : 'is-off'}" role="row" data-proom-hover="${li}:${ri}">
              <input class="pp-in" value="${esc(r.name)}" maxlength="60" data-proom-name="${li}:${ri}" aria-label="Room name" ${dis} />
              ${sel(matOpts, r.material, `data-proom-mat="${li}:${ri}" aria-label="Floor in ${esc(r.name)}" ${dis}`)}
              <span class="pp-plan-area">${fmtSf(r.area_sf)}</span>
              ${(() => { const n = (m.data.vents || []).filter((v) => roomKey(v.room) === roomKey(r.name)).reduce((t, v) => t + (Number(v.qty) || 1), 0); return `<button type="button" class="pp-proom-vent ${n ? 'has' : ''}" data-proom-vent="${esc(r.name)}" aria-label="Vents in ${esc(r.name)}: ${n}" ${locked && !n ? 'disabled' : ''}>${n ? `${n} vent${n === 1 ? '' : 's'}` : '+ Vent'}</button>`; })()}
              <label class="pp-check" title="Count this room"><input type="checkbox" data-proom-inc="${li}:${ri}" ${r.exclude ? '' : 'checked'} ${dis} /><span class="pp-sr">Count ${esc(r.name)}</span></label>
            </div>`).join('')}
          </div>
        </div>
      </section>`;
    }).join('');
    return `${mats}${levels}
      <div class="pp-plan-foot"><span class="pp-muted">${esc(plan.file ? plan.file.name : '')}${plan.analyzed_at ? ` · read ${esc(fmtDayEn(plan.analyzed_at))}` : ''}</span>
        ${plan.file ? `<a class="pp-link" href="/api/builder/measurements/${encodeURIComponent(m.id)}/plan-file?key=${encodeURIComponent(plan.file.key)}" target="_blank" rel="noopener">Open the plans</a>` : ''}
        ${locked ? '' : `<button type="button" class="pp-link" data-plan-reread>Read the plans again</button><label class="pp-link">Upload new plans<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" data-plan-file hidden /></label>`}
      </div>
      <div class="pp-plan-progress" data-plan-progress hidden><span>…</span><b><i></i></b></div>`;
  }

  function floors3dHtml(m) {
    const lv = (m.data.plan.levels || []).filter((l) => l.include && l.rooms.length).sort((a, b) => a.floor - b.floor);
    const on = m.plan3dLevel || 'all';
    return `<section class="pp-card pp-plan-3d">
      <div class="pp-plan-3d-bar">
        <div class="pp-filter" role="group" aria-label="Levels"><button type="button" data-p3-level="all" aria-pressed="${on === 'all'}">All levels</button>${lv.map((l) => `<button type="button" data-p3-level="${esc(l.id)}" aria-pressed="${on === l.id}">${esc(l.name)}</button>`).join('')}</div>
        <div class="pp-plan-3d-acts">
          ${lv.length > 1 ? `<label class="pp-switch" data-p3-sep-wrap ${on === 'all' ? '' : 'hidden'}><input type="checkbox" data-p3-sep ${m.plan3dSeparate ? 'checked' : ''} /><span>Separate floors</span></label>` : ''}
          <label class="pp-switch"><input type="checkbox" data-p3-walls ${m.plan3dWalls === false ? '' : 'checked'} /><span>Walls</span></label>
          <label class="pp-switch"><input type="checkbox" data-p3-labels ${m.plan3dLabels === false ? '' : 'checked'} /><span>Names</span></label>
          <button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-p3-reset>Reset view</button>
        </div>
      </div>
      <div class="pp-plan-3d-stage" id="ppPlan3d"><div class="pp-plan-3d-wait">${mate('measure', 80)}<span>Building the house…</span></div></div>
      <p class="pp-muted pp-plan-note">Drag to turn · pinch or scroll to zoom · two fingers or right-drag to move · tap a room to see its floor. Walls are drawn where the floors end or change — doors and windows are not on the model.</p>
    </section>`;
  }

  function quoteLines(m, prices) {
    const plan = m.data.plan; const lines = [];
    const pick = (key, test) => {
      const typed = plan.quote_rates && plan.quote_rates[key];
      if (typed != null && typed !== '') return { id: '', name: 'Typed on the quote', price: Number(typed), typed: true };
      const chosen = plan.quote_prices && plan.quote_prices[key];
      const byId = chosen && prices.find((p) => p.id === chosen);
      if (byId) return byId;
      const sq = prices.filter((p) => p.unit === 'sq_ft');
      return sq.find(test) || null;
    };
    planTotals(plan).filter((t) => t.include).forEach((t) => {
      const words = KIND_WORDS[t.kind] || /$^/;
      const qty = Math.ceil(t.area);
      const ins = pick(`${t.key}:install`, (p) => words.test(p.name) && /install/i.test(p.name)) || pick(`${t.key}:install`, (p) => words.test(p.name) && !/sand|refinish|finish|demo|remov/i.test(p.name));
      lines.push({ key: `${t.key}:install`, name: `${t.label} install`, spec: specText(t), qty, price: ins, color: t.color, kind: t.kind });
      if (t.kind === 'hardwood' && t.sand_finish) {
        const sf = pick(`${t.key}:sand`, (p) => /sand|refinish|finish/i.test(p.name));
        lines.push({ key: `${t.key}:sand`, name: plan.materials.filter((x) => x.kind === 'hardwood' && x.include).length > 1 ? `Sand & finish · ${t.label}` : 'Sand & finish', spec: [t.spec && t.spec.color, t.spec && t.spec.sheen].filter(Boolean).join(' · '), qty, price: sf, color: t.color, kind: 'sand' });
      }
    });
    return lines;
  }

  /** The quote laid out like an ObraMate quote (the company's logo and colors, builder as client). */
  function floorsQuoteHtml(m, prices) {
    const plan = m.data.plan; const locked = m.status === 'used';
    const companies = state.builder.companies || [];
    const money_ = canDo('money.view');
    const lines = quoteLines(m, prices);
    const sq = prices.filter((p) => p.unit === 'sq_ft');
    const total = lines.reduce((a, l) => a + (l.price ? l.price.price * l.qty : 0), 0);
    const missing = lines.filter((l) => !l.price).length;
    const totals = planTotals(plan).filter((t) => t.include);
    const co = companies.find((c) => c.id === plan.quote_link_id);
    const prof = (co && co.profile) || {};
    const primary = '#221E1A'; // ObraMate palette: ink + orange
    const acc = state.builder.account;
    const num = `M-${String(m.id).slice(0, 6).toUpperCase()}`;
    const today = new Date();
    const valid = new Date(Date.now() + 30 * 86400e3);
    const fmtD = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const secs = [['Installation', lines.filter((l) => l.kind !== 'sand')], ['Sand & finish', lines.filter((l) => l.kind === 'sand')]].filter(([, ls]) => ls.length);
    const pdfUrl = co ? `/api/builder/measurements/${encodeURIComponent(m.id)}/quote-pdf?company=${encodeURIComponent(co.id)}` : '';
    const controls = `<section class="pp-card pp-block pp-qp-ctl">
        <h3>Prices</h3>
        ${companies.length ? `<div class="pp-field"><span>Company</span>${coPickBtn(co, `data-pq-co aria-label="Quote from: ${co ? esc(co.company_name) : 'choose a company'}" ${locked ? 'disabled' : ''}`, co ? 'Prices from their list' : 'Search your companies')}</div>` : `<p class="pp-muted">Connect a flooring company to price the work. <a class="pp-link" href="#companies">Companies</a></p>`}
        ${money_ ? lines.map((l) => `<label class="pp-field"><span><i class="pp-swatch" style="background:${esc(l.color)}"></i> ${esc(l.name)} · ${fmtSf(l.qty)}</span>${sel([['', l.price && l.price.typed ? `Typed on the quote · ${money(l.price.price)}/sq ft` : sq.length ? 'Choose a price…' : 'No sq ft prices yet'], ...sq.map((p) => [p.id, `${p.name} · ${money(p.price)}/sq ft`])], l.price && !l.price.typed ? l.price.id : '', `data-pq-price="${esc(l.key)}" aria-label="Price for ${esc(l.name)}" ${locked ? 'disabled' : ''}`)}</label>`).join('') + '<p class="pp-muted pp-plan-note">Or type the price right on the quote.</p>' : '<p class="pp-muted">Your role can’t see prices.</p>'}
        ${money_ && co ? `<p class="pp-muted pp-plan-note">From your <a class="pp-link" href="#companies/${esc(co.id)}">${esc(co.company_name)} price list</a>. Missing a service? Add it there in “sq ft”.</p>` : ''}
        <div class="pp-qp-acts">
          ${pdfUrl && money_ ? `<a class="pp-btn pp-btn--sec" href="${pdfUrl}" target="_blank" rel="noopener">${icon('download')}Quote PDF</a>` : ''}
          ${locked ? '' : `<button type="button" class="pp-btn pp-btn--pri" data-send-wo>${icon('send')}Send work order</button>`}
        </div>
      </section>`;
    const paper = `<article class="pp-qp" style="--qp:${esc(primary)}" aria-label="Quote">
        <div class="pp-qp-bar"></div>
        <header class="pp-qp-head">
          <div class="pp-qp-org">${prof.logo_url ? `<img src="${esc(prof.logo_url)}" alt="" />` : `<span class="pp-qp-mark">${esc(initials(co ? co.company_name : 'Q'))}</span>`}<div><strong>${esc(co ? co.company_name : 'Flooring company')}</strong><small>${esc([prof.phone || co && co.contact_phone, prof.email || co && co.contact_email].filter(Boolean).join(' · '))}</small></div></div>
          <div class="pp-qp-num"><small>QUOTE</small><b>${esc(num)}</b><span>Issued ${esc(fmtD(today))}</span><span>Valid until ${esc(fmtD(valid))}</span></div>
        </header>
        <div class="pp-qp-parties">
          <div><small>BILL TO</small><strong>${esc(acc.name)}</strong><span>${esc(acc.email || '')}</span><span>${esc(acc.phone || '')}</span></div>
          <div><small>JOB SITE</small><strong>Flooring · ${esc(m.address)}</strong><span>${esc([m.community, m.lot ? `Lot ${m.lot}` : ''].filter(Boolean).join(' · '))}</span></div>
          <div><small>PREPARED BY</small><strong>${esc(co ? co.company_name : '—')}</strong><span>From ObraBuilder measurement</span></div>
        </div>
        ${secs.map(([title, ls]) => { const st = ls.reduce((a, l) => a + (l.price ? l.price.price * l.qty : 0), 0); return `<section class="pp-qp-sec">
          <div class="pp-qp-sechead"><span>${esc(title.toUpperCase())}</span>${money_ ? `<small>Section total ${esc(money(st))}</small>` : ''}</div>
          <div class="pp-qp-row pp-qp-row--head"><span>DESCRIPTION</span><span>QTY</span>${money_ ? '<span>RATE</span><span>AMOUNT</span>' : ''}</div>
          ${ls.map((l) => `<div class="pp-qp-row ${l.price && l.price.typed ? 'is-typed' : ''}"><span><strong>${esc(l.name)}</strong>${l.spec ? `<small>${esc(l.spec)}</small>` : ''}${l.price && l.price.typed ? `<small class="pp-qp-typed">Price typed on the quote${locked ? '' : ` · <button type="button" class="pp-link" data-pq-reset="${esc(l.key)}">use the price list</button>`}</small>` : ''}</span><span>${Math.round(l.qty).toLocaleString('en-US')} sq ft</span>${money_ ? `<span>${locked ? (l.price ? money(l.price.price) : '—') : `<label class="pp-qp-rate"><span>$</span><input inputmode="decimal" data-pq-rate="${esc(l.key)}" value="${l.price ? esc(String(Math.round(l.price.price * 100) / 100)) : ''}" placeholder="0.00" aria-label="Price per sq ft for ${esc(l.name)}" /></label>`}</span><span><b data-pq-amt="${esc(l.key)}">${l.price ? money(l.price.price * l.qty) : '—'}</b></span>` : ''}</div>`).join('')}
        </section>`; }).join('')}
        ${money_ ? `<div class="pp-qp-foot">
          <div class="pp-qp-incl"><small>WHAT’S INCLUDED</small>${lines.map((l) => `<span>${icon('check')}${esc(l.name)}${l.spec ? ` — ${esc(l.spec)}` : ''}</span>`).join('')}<span>${icon('check')}Quantities from the house plans: ${esc(totals.map((t) => `${t.label} ${fmtSf(t.area)}`).join(', '))}</span></div>
          <div class="pp-qp-tot"><div><span>Subtotal</span><b>${money(total)}</b></div><div><span>Tax</span><b>${money(0)}</b></div><div class="pp-qp-total"><span>TOTAL</span><b>${money(total)}</b></div>${missing ? `<p class="pp-late">${plural(missing, 'line', 'lines')} without a price</p>` : ''}</div>
        </div>` : ''}
        <div class="pp-qp-mat"><small>MATERIAL TO ORDER</small>${totals.map((t) => { const o = orderQty(t); return `<div><span><i class="pp-swatch" style="background:${esc(t.color)}"></i>${esc(t.label)}${specText(t) ? ` · ${esc(specText(t))}` : ''}</span><span>${fmtSf(t.area)} measured · ${o.waste}% waste</span><b>${fmtSf(o.sf)}${o.boxes ? ` · ${o.boxes} boxes` : ''}</b></div>`; }).join('')}<a class="pp-link" href="#settings/takeoff">Waste settings</a></div>
      </article>`;
    return `<div class="pp-qp-wrap">${controls}${paper}</div>`;
  }

  function floorsHtml(m) {
    const plan = m.data.plan;
    if (!plan || !plan.levels || !plan.levels.length) return floorsEmptyHtml(m);
    const v = m.floorView || 'takeoff';
    const seg = (k, l) => `<button type="button" data-fview="${k}" aria-pressed="${v === k}">${l}</button>`;
    return `${floorKpisHtml(planTotals(plan))}
      <div class="pp-filter pp-plan-seg" role="group" aria-label="Floor Plan view">${seg('takeoff', 'Rooms')}${seg('3d', '3D')}${seg('quote', 'Quote')}</div>
      <div class="pp-plan-view" data-plan-view>${v === '3d' ? floors3dHtml(m) : v === 'quote' ? '<div class="pp-card pp-empty"><span class="pp-muted">Loading prices…</span></div>' : floorsTakeoffHtml(m)}</div>`;
  }

  async function bindFloors() {
    const m = state.meas;
    const plan = m.data.plan;
    const save = () => measSaveSoon();
    const redraw = () => { const y = window.scrollY; paintMeasurement(); window.scrollTo(0, y); };
    view.querySelectorAll('[data-plan-file]').forEach((inp) => inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const box = inp.closest('.pp-mpanel');
      try { await readPlans(m, file, box); redraw(); mateToast('measure', 'Floors measured', 'Check the rooms and the 3D view.'); } catch (ex) { mateToast('head-curious', 'Could not read the plans', ex.message); redraw(); }
    }));
    if (!plan || !plan.levels || !plan.levels.length) return;
    view.querySelectorAll('[data-fview]').forEach((b) => b.addEventListener('click', () => { m.floorView = b.getAttribute('data-fview'); redraw(); }));
    const reread = view.querySelector('[data-plan-reread]');
    if (reread) reread.addEventListener('click', async () => {
      const box = view.querySelector('.pp-mpanel');
      try {
        const file = await storedPlanFile(m);
        await readPlans(m, file, box, plan.file);
        redraw();
        mateToast('measure', 'Plans read again', '');
      } catch (ex) { mateToast('head-curious', 'Could not read the plans', ex.message); }
    });
    // materials
    view.querySelectorAll('[data-pmat-kind]').forEach((s) => s.addEventListener('change', () => { const x = plan.materials[+s.getAttribute('data-pmat-kind')]; x.kind = s.value; x.include = FLOORING_KINDS.includes(s.value); if (s.value === 'hardwood') x.sand_finish = true; save(); redraw(); }));
    view.querySelectorAll('[data-pmat-spec]').forEach((b) => b.addEventListener('click', () => openSpecSheet(+b.getAttribute('data-pmat-spec'))));
    view.querySelectorAll('[data-pmat-sand]').forEach((c) => c.addEventListener('change', () => { plan.materials[+c.getAttribute('data-pmat-sand')].sand_finish = c.checked; save(); redraw(); }));
    view.querySelectorAll('[data-pmat-inc]').forEach((c) => c.addEventListener('change', () => { plan.materials[+c.getAttribute('data-pmat-inc')].include = c.checked; save(); redraw(); }));
    // levels and rooms
    view.querySelectorAll('[data-plv-inc]').forEach((c) => c.addEventListener('change', () => { plan.levels[+c.getAttribute('data-plv-inc')].include = c.checked; save(); redraw(); }));
    const room = (attr, el) => { const [li, ri] = el.getAttribute(attr).split(':').map(Number); return plan.levels[li].rooms[ri]; };
    view.querySelectorAll('[data-proom-name]').forEach((i) => i.addEventListener('input', () => {
      const r = room('data-proom-name', i);
      const was = roomKey(r.name);
      // the room's vents follow the new name
      if (was) (m.data.vents || []).forEach((v) => { if (roomKey(v.room) === was) v.room = i.value; });
      r.name = i.value;
      const vb = i.parentElement && i.parentElement.querySelector('[data-proom-vent]');
      if (vb) vb.setAttribute('data-proom-vent', i.value);
      save();
    }));
    view.querySelectorAll('[data-proom-vent]').forEach((b) => b.addEventListener('click', () => { const n = b.getAttribute('data-proom-vent').trim(); if (n) openRoomVentsSheet(n); }));
    view.querySelectorAll('[data-proom-mat]').forEach((s) => s.addEventListener('change', () => { room('data-proom-mat', s).material = s.value; save(); redraw(); }));
    view.querySelectorAll('[data-proom-inc]').forEach((c) => c.addEventListener('change', () => { room('data-proom-inc', c).exclude = !c.checked; save(); redraw(); }));
    view.querySelectorAll('[data-plv-scale]').forEach((b) => b.addEventListener('click', async () => {
      const lv = plan.levels[+b.getAttribute('data-plv-scale')];
      try {
        const file = await storedPlanFile(m);
        const op = await window.ObTakeoff.open(file);
        const sh = op.sheets.find((s) => s.page === lv.page) || op.sheets[0];
        await window.ObTakeoff.legend(op);
        const ppf = await calibrate(sh, `Scale for ${lv.name}`);
        if (!ppf) return;
        const res = await window.ObTakeoff.readSheet(sh, plan.materials, ppf);
        res.level.id = lv.id; res.level.name = lv.name; res.level.floor = lv.floor; res.level.preview = lv.preview; res.level.scale_auto = false;
        plan.levels[plan.levels.indexOf(lv)] = res.level;
        save(); redraw();
        mateToast('measure', 'Scale updated', `${lv.name} measured again.`);
      } catch (ex) { mateToast('head-curious', 'Could not change the scale', ex.message); }
    }));
    // colored overlay on each sheet preview
    view.querySelectorAll('[data-plv-sheet]').forEach((box) => {
      const lv = plan.levels[+box.getAttribute('data-plv-sheet')];
      const img = box.querySelector('img'); const cv = box.querySelector('canvas');
      if (!img || !cv || !lv.grid) return;
      const roomCells = lv.grid.rooms ? window.ObTakeoff.decodeRle(lv.grid.rooms, lv.grid.w * lv.grid.h) : null;
      const draw = (focusRoom) => {
        const w = img.naturalWidth; if (!w) return;
        cv.width = lv.grid.w; cv.height = lv.grid.h;
        const g = cv.getContext('2d'); const cells = window.ObTakeoff.decodeGrid(lv.grid);
        const id = g.createImageData(lv.grid.w, lv.grid.h);
        const cols = plan.materials.map((x) => [1, 3, 5].map((k) => parseInt(x.color.slice(k, k + 2), 16)));
        for (let i = 0; i < cells.length; i++) {
          const v = cells[i]; if (!v) continue;
          const x = plan.materials[v - 1]; if (!x || !x.include) continue;
          const c = cols[v - 1];
          const inFocus = focusRoom != null && roomCells && roomCells[i] === focusRoom + 1;
          const dim = focusRoom != null && !inFocus;
          id.data[i * 4] = inFocus ? 231 : c[0]; id.data[i * 4 + 1] = inFocus ? 121 : c[1]; id.data[i * 4 + 2] = inFocus ? 44 : c[2]; id.data[i * 4 + 3] = inFocus ? 230 : dim ? 70 : 150;
        }
        g.putImageData(id, 0, 0);
      };
      if (img.complete) draw(); else img.addEventListener('load', () => draw());
      const li = box.getAttribute('data-plv-sheet');
      view.querySelectorAll(`[data-proom-hover^="${li}:"]`).forEach((row) => {
        const ri = Number(row.getAttribute('data-proom-hover').split(':')[1]);
        const on = () => { if (roomCells) { draw(ri); row.classList.add('is-hot'); } };
        const off = () => { draw(); row.classList.remove('is-hot'); };
        row.addEventListener('mouseenter', on); row.addEventListener('mouseleave', off);
        row.addEventListener('focusin', on); row.addEventListener('focusout', off);
      });
      // hover on the sheet → the room under the pointer lights up in the list
      if (roomCells) {
        box.addEventListener('mousemove', (e) => {
          const rect = box.getBoundingClientRect();
          const gx = Math.floor(((e.clientX - rect.left) / rect.width) * lv.grid.w); const gy = Math.floor(((e.clientY - rect.top) / rect.height) * lv.grid.h);
          const rm = roomCells[gy * lv.grid.w + gx] || 0;
          if (rm === box._hot) return;
          box._hot = rm;
          view.querySelectorAll(`[data-proom-hover^="${li}:"]`).forEach((row) => row.classList.toggle('is-hot', rm > 0 && row.getAttribute('data-proom-hover') === `${li}:${rm - 1}`));
          draw(rm ? rm - 1 : undefined);
          const r = rm ? lv.rooms[rm - 1] : null;
          let t = box.querySelector('.ob3d-tip');
          if (!t) { t = document.createElement('div'); t.className = 'ob3d-tip'; box.appendChild(t); }
          t.hidden = !r;
          if (r) {
            const mt = plan.materials.find((x) => x.key === r.material) || {};
            t.innerHTML = `<strong>${esc(r.name)}</strong><span><i style="background:${esc(mt.color || '#ccc')}"></i>${esc(mt.label || '')} · ${fmtSf(r.area_sf)}</span>`;
            t.style.left = `${Math.min(rect.width - 190, e.clientX - rect.left + 14)}px`; t.style.top = `${Math.max(6, e.clientY - rect.top - 56)}px`;
          }
        });
        box.addEventListener('mouseleave', () => { box._hot = 0; draw(); const t = box.querySelector('.ob3d-tip'); if (t) t.hidden = true; view.querySelectorAll('.pp-plan-room.is-hot').forEach((x) => x.classList.remove('is-hot')); });
      }
    });
    // 3D
    const stage = $('ppPlan3d');
    if (plan3d) { try { plan3d.destroy(); } catch (_) { /* gone */ } plan3d = null; }
    if (stage && window.ObPlan3D) {
      try {
        const v3 = await window.ObPlan3D.mount(stage, plan, { separate: Boolean(m.plan3dSeparate) });
        if (!stage.isConnected) { v3.destroy(); return; }
        plan3d = v3;
        const wait = stage.querySelector('.pp-plan-3d-wait'); if (wait) wait.remove();
        // a picture of the house for the PDF (once per reading of the plans)
        if (!plan.snapshot && m.status !== 'used' && !m.snapBusy) {
          m.snapBusy = true;
          setTimeout(async () => {
            try {
              const url = v3.snapshot();
              const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/plan-preview`, { data_url: url });
              if (state.meas === m && m.data.plan === plan) { plan.snapshot = r.data.key; measSaveSoon(); }
            } catch (_) { /* the PDF goes without the picture */ }
            m.snapBusy = false;
          }, 700);
        }
        if (m.plan3dLevel && m.plan3dLevel !== 'all') v3.only(m.plan3dLevel);
        if (m.plan3dLabels === false) v3.showLabels(false);
        if (m.plan3dWalls === false) v3.walls(false);
        const sep = view.querySelector('[data-p3-sep]'); if (sep) sep.addEventListener('change', () => { m.plan3dSeparate = sep.checked; v3.separate(sep.checked); });
        const wl = view.querySelector('[data-p3-walls]'); if (wl) wl.addEventListener('change', () => { m.plan3dWalls = wl.checked; v3.walls(wl.checked); });
        view.querySelectorAll('[data-p3-level]').forEach((b) => b.addEventListener('click', () => {
          m.plan3dLevel = b.getAttribute('data-p3-level');
          view.querySelectorAll('[data-p3-level]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          v3.only(m.plan3dLevel === 'all' ? null : m.plan3dLevel);
          const sw = view.querySelector('[data-p3-sep-wrap]'); if (sw) sw.hidden = m.plan3dLevel !== 'all';
        }));
        const lab = view.querySelector('[data-p3-labels]'); if (lab) lab.addEventListener('change', () => { m.plan3dLabels = lab.checked; v3.showLabels(lab.checked); });
        const rs = view.querySelector('[data-p3-reset]'); if (rs) rs.addEventListener('click', () => v3.reset());
      } catch (ex) {
        stage.innerHTML = `<div class="pp-plan-3d-wait"><span>${esc(ex.message || '3D is not available on this device.')}</span></div>`;
      }
    }
    // quote
    const qbox = view.querySelector('[data-plan-view]');
    if (m.floorView === 'quote' && qbox) {
      const prices = canDo('money.view') && plan.quote_link_id ? await api(`/api/builder/prices?company=${encodeURIComponent(plan.quote_link_id)}`).then((r) => (r.data || []).filter((p) => p.company_id === plan.quote_link_id)).catch(() => []) : [];
      if (!qbox.isConnected || m !== state.meas || m.floorView !== 'quote') return;
      qbox.innerHTML = floorsQuoteHtml(m, prices);
      qbox.querySelectorAll('[data-send-wo]').forEach((b) => b.addEventListener('click', () => sendFromMeasurement(m)));
      const co = qbox.querySelector('[data-pq-co]');
      if (co) co.addEventListener('click', () => openCoPicker('Quote from', plan.quote_link_id, (id) => { plan.quote_link_id = id; plan.quote_prices = {}; plan.quote_rates = {}; save(); redraw(); }));
      qbox.querySelectorAll('[data-pq-price]').forEach((s) => s.addEventListener('change', () => {
        const k = s.getAttribute('data-pq-price');
        plan.quote_prices = plan.quote_prices || {};
        plan.quote_rates = plan.quote_rates || {};
        if (s.value) plan.quote_prices[k] = s.value; else delete plan.quote_prices[k];
        delete plan.quote_rates[k];
        save(); redraw();
      }));
      // prices typed straight on the quote
      qbox.querySelectorAll('[data-pq-rate]').forEach((inp) => {
        const k = inp.getAttribute('data-pq-rate');
        const line = quoteLines(m, prices).find((l) => l.key === k);
        inp.addEventListener('focus', () => inp.select());
        inp.addEventListener('input', () => {
          const v = Number(String(inp.value).replace(/[$,\s]/g, ''));
          const amt = qbox.querySelector(`[data-pq-amt="${k}"]`);
          if (amt && line) amt.textContent = inp.value.trim() && Number.isFinite(v) ? money(v * line.qty) : '—';
        });
        inp.addEventListener('change', () => {
          const raw = String(inp.value).replace(/[$,\s]/g, '');
          plan.quote_rates = plan.quote_rates || {};
          if (raw === '') delete plan.quote_rates[k];
          else if (Number.isFinite(Number(raw)) && Number(raw) >= 0) plan.quote_rates[k] = Math.round(Number(raw) * 100) / 100;
          save(); redraw();
        });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      });
      qbox.querySelectorAll('[data-pq-reset]').forEach((b) => b.addEventListener('click', () => { if (plan.quote_rates) delete plan.quote_rates[b.getAttribute('data-pq-reset')]; save(); redraw(); }));
    }
  }

  function paintMeasurement() {
    const m = state.meas;
    const locked = m.status === 'used';
    const c = measCounts(m.data);
    if (!['stairs', 'vents', 'floors', 'summary'].includes(m.tab)) m.tab = 'stairs';
    const ft = planTotals(m.data.plan).filter((t) => t.include).reduce((a, t) => a + t.area, 0);
    const tab = (k, label, n) => `<button type="button" role="tab" data-mtab="${k}" aria-selected="${m.tab === k}" aria-pressed="${m.tab === k}">${label}${n != null ? `<span class="pp-mtab-n">${n}</span>` : ''}</button>`;
    view.innerHTML = `
      <div class="pp-mhead ${m.tab === 'summary' ? 'is-summary' : ''}">
        <a class="pp-back" href="#measurements" style="display:inline-flex">${icon('back')}Measurements</a>
        <div class="pp-mhead-row">
          <div class="pp-mhead-title"><h1 class="pp-meas-title">${esc(m.address)}</h1>
            <p>${measStatusChip(m)} <span id="ppMeasSaved" class="pp-meas-saved">Saved</span> <span class="pp-meas-by" id="ppMeasBy"></span>${m.notes ? ` · <button type="button" class="pp-link" data-mtab-go="summary">Notes</button>` : ''}</p></div>
          <div class="pp-head-actions">
            <a class="pp-btn pp-btn--sec pp-hide-phone" href="/api/builder/measurements/${encodeURIComponent(m.id)}/pdf" target="_blank" rel="noopener">${icon('download')}PDF</a>
            ${locked || !canDo('jobs.send') ? '' : `<button type="button" class="pp-btn pp-btn--sec" data-send-wo>${icon('send')}<span>Send<span class="pp-hide-phone"> work order</span></span></button>`}
            ${locked ? '' : m.status === 'done' ? '<button type="button" class="pp-btn pp-btn--sec" id="ppMeasReopen">Reopen</button>' : '<button type="button" class="pp-btn pp-btn--pri" id="ppMeasDone">Complete</button>'}
            ${locked ? '' : `<button type="button" class="pp-btn pp-btn--sec pp-btn--icon" data-meas-del-head aria-label="Delete measurement" title="Delete measurement">${icon('trash')}</button>`}
          </div>
        </div>
      </div>
      ${state.send && state.send.phase === 'review' && state.send.measurement && state.send.measurement.id === m.id ? `<div class="pp-wz-back"><span>${mate('head-happy', 28)}You’re sending a work order with this measurement.</span><a class="pp-btn pp-btn--pri pp-btn--sm" href="#send">Back to the work order</a></div>` : ''}
      ${locked ? `<div class="pp-match"><strong>This measurement was already sent with the Work Order</strong><span class="pp-muted" style="font-size:14px">${m.work_order_id ? `<a class="pp-link" href="#jobs/${encodeURIComponent(m.work_order_id)}">Open the job</a> · ` : ''}To measure again, start a new measurement for this address.</span></div>` : ''}
      <div class="pp-mtabs" role="tablist" aria-label="Measurement sections">
        ${tab('stairs', 'Stairs', c.treads + c.risers ? `${c.treads}·${c.risers}` : null)}${tab('vents', 'Vents', c.vents || null)}${tab('floors', 'Floor Plan', ft ? (ft >= 1000 ? `${(Math.round(ft / 100) / 10).toLocaleString('en-US')}k sf` : `${Math.round(ft)} sf`) : null)}${tab('summary', 'Summary', null)}
      </div>
      <div class="pp-mpanel" role="tabpanel">
        ${m.tab === 'stairs'
          ? `<div class="pp-meas-layout pp-meas-layout--stairs"><div class="pp-meas-main">${stairsWorkbenchHtml(m)}${locked ? '' : `<div class="pp-stair-adds"><button type="button" class="pp-q-add pp-q-add--block" id="ppStairAdd">+ Stair</button>${state.builder && state.builder.ai_reader ? `<button type="button" class="pp-q-add pp-q-add--block pp-stair-photo-btn" id="ppStairPhotos">${icon('camera')}Stair from photos</button>` : ''}</div>`}</div></div>`
          : m.tab === 'vents' ? ventsHtml(m) : m.tab === 'floors' ? floorsHtml(m) : measSummaryTabHtml(m)}
      </div>
      ${locked || !state.builder.ai_reader ? '' : voiceFabHtml()}`;
    paintMeasSaved();
    paintMeasSubtitle(m);
    bindMeasuredBy(m);
    bindMeasurement();
    bindVoice();
    view.querySelectorAll('.pp-mhead [data-send-wo], .pp-msum [data-send-wo]').forEach((b) => b.addEventListener('click', () => sendFromMeasurement(m)));
    if (m.tab === 'floors') bindFloors();
    else if (plan3d) { try { plan3d.destroy(); } catch (_) { /* gone */ } plan3d = null; }
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
    const s = m && m.data.stairs[si];
    if (!s) return;
    const connectedIndexes = stairChainFor(m.data, s.id).map((flight) => m.data.stairs.findIndex((item) => item.id === flight.id));
    const targets = new Set([...connectedIndexes, si]);
    targets.forEach((targetSi) => {
      const targetStair = m.data.stairs[targetSi];
      const box = view.querySelector(`[data-viz-stair="${targetSi}"]`);
      if (!box || !targetStair) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = stairVizHtml(m, targetStair, targetSi);
      box.innerHTML = tmp.firstElementChild.innerHTML;
      const selected = (m.vizSel && m.vizSel[targetSi]) || 0;
      view.querySelectorAll(`[data-step-row^="${targetSi}:"]`).forEach((row) => row.classList.toggle('is-sel', row.getAttribute('data-step-row') === `${targetSi}:${selected}`));
    });
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
    m.stairMeasurementsExpanded = m.stairMeasurementsExpanded || {};
    m.stairSetupExpanded = m.stairSetupExpanded || {};
    m.stairPanelExpanded = m.stairPanelExpanded || {};
    view.querySelectorAll('[data-stair-setup]').forEach((details) => details.addEventListener('toggle', () => {
      m.stairSetupExpanded[details.getAttribute('data-stair-setup')] = details.open;
    }));
    view.querySelectorAll('[data-stair-panel]').forEach((details) => details.addEventListener('toggle', () => {
      m.stairPanelExpanded[details.getAttribute('data-stair-panel')] = details.open;
    }));
    view.querySelectorAll('[data-stair-measures]').forEach((details) => details.addEventListener('toggle', () => {
      const stairId = details.getAttribute('data-stair-measures');
      m.stairMeasurementsExpanded[stairId] = details.open;
    }));
    view.querySelectorAll('[data-step-select]').forEach((button) => button.addEventListener('click', () => {
      const [si, i] = button.getAttribute('data-step-select').split(':').map(Number);
      m.vizSel[si] = i;
      m.activeStairId = m.data.stairs[si] && m.data.stairs[si].id;
      redraw();
    }));
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
      const t = e.target.closest('[data-viz-step],[data-viz-side],[data-viz-ret],[data-viz-prev],[data-viz-next],[data-viz-mirror],[data-turn]');
      if (!t) return;
      if (t.hasAttribute('data-turn')) {
        if (m.status === 'used') return;
        const [fi, k] = t.getAttribute('data-turn').split(':');
        const fl = m.data.stairs[Number(fi)];
        if (fl && STAIR_TURNS.includes(k)) { fl.turn = k; measSaveSoon(); redraw(); }
        return;
      }
      if (t.hasAttribute('data-viz-step')) {
        const targetSi = Number(t.getAttribute('data-viz-flight'));
        const targetIndex = Number(t.getAttribute('data-viz-step'));
        const targetFlight = Number.isInteger(targetSi) ? targetSi : si;
        m.vizSel[targetFlight] = targetIndex;
        m.activeStairId = m.data.stairs[targetFlight] && m.data.stairs[targetFlight].id;
        redraw();
        return;
      }
      if (t.hasAttribute('data-viz-prev')) { m.vizSel[si] = Math.max(0, sel - 1); redraw(); return; }
      if (t.hasAttribute('data-viz-next')) { m.vizSel[si] = Math.min(s.steps.length - 1, sel + 1); redraw(); return; }
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
    view.querySelectorAll('[data-viz-prev],[data-viz-next]').forEach((button) => button.addEventListener('click', () => {
      const si = Number(button.getAttribute('data-viz-prev') || button.getAttribute('data-viz-next'));
      const s = m.data.stairs[si];
      if (!s) return;
      const current = Math.max(0, (m.vizSel && m.vizSel[si]) || 0);
      m.vizSel[si] = button.hasAttribute('data-viz-prev') ? Math.max(0, current - 1) : Math.min((s.steps || []).length - 1, current + 1);
      redraw();
    }));
    view.querySelectorAll('[data-stair-activate]').forEach((button) => button.addEventListener('click', () => {
      m.activeStairId = button.getAttribute('data-stair-activate');
      redraw();
    }));
    view.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => {
      m.tab = b.getAttribute('data-mtab');
      redraw();
      // A new tab starts at its top, under the sticky tab bar.
      const bar = view.querySelector('.pp-mtabs');
      if (bar && bar.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + bar.getBoundingClientRect().top - 72 });
    }));
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
    view.querySelectorAll('[data-layout]').forEach((button) => button.addEventListener('click', () => {
      if (button.disabled) return;
      const { obj, key } = measAt(button.getAttribute('data-layout'));
      obj[key] = button.getAttribute('data-value') === 'round' ? 'round' : 'straight';
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-bool]').forEach((el) => el.addEventListener('change', () => {
      const { obj, key } = measAt(el.getAttribute('data-bool'));
      obj[key] = el.checked;
      measSaveSoon();
      redraw();
    }));
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
    const stairPh = $('ppStairPhotos');
    if (stairPh) stairPh.addEventListener('click', openStairPhotos);
    const stairAdd = $('ppStairAdd');
    if (stairAdd) stairAdd.addEventListener('click', () => {
      const prev = m.data.stairs[m.data.stairs.length - 1];
      const s = newStair(m.data.stairs.length ? m.data.stairs.length + 1 : 0);
      if (prev) Object.assign(s, { species: prev.species, finish: prev.finish, color: prev.color, riser_material: prev.riser_material });
      s.steps.push(newStep());
      m.data.stairs.push(s);
      m.activeStairId = s.id;
      measSaveSoon();
      redraw();
      const ins = view.querySelectorAll(`[data-in^="stairs.${m.data.stairs.length - 1}.steps.0"]`);
      if (ins[0]) ins[0].focus();
    });
    view.querySelectorAll('[data-stair-above]').forEach((button) => button.addEventListener('click', () => {
      const parentIndex = Number(button.getAttribute('data-stair-above'));
      const parent = m.data.stairs[parentIndex];
      if (!parent || !parent.landing || !parent.landing.enabled || m.status === 'used') return;
      if (m.data.stairs.some((flight) => flight.starts_on_landing_of === parent.id)) return;
      const upper = newStair(m.data.stairs.length + 1);
      upper.name = (parent.name || 'Stair') + ' · Upper flight';
      upper.starts_on_landing_of = parent.id;
      upper.species = parent.species;
      upper.finish = parent.finish;
      upper.color = parent.color;
      upper.riser_material = parent.riser_material;
      upper.steps.push(newStep());
      m.data.stairs.splice(parentIndex + 1, 0, upper);
      m.activeStairId = upper.id;
      m.vizSel[m.data.stairs.indexOf(upper)] = 0;
      measSaveSoon();
      redraw();
      const upperIndex = m.data.stairs.findIndex((flight) => flight.id === upper.id);
      const firstTread = view.querySelector('[data-in="stairs.' + upperIndex + '.steps.0.tread_w"]');
      if (firstTread) firstTread.focus();
    }));
    view.querySelectorAll('[data-stair-focus]').forEach((button) => button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-stair-focus');
      if (!m.data.stairs.some((flight) => flight.id === targetId)) return;
      m.activeStairId = targetId;
      redraw();
    }));
    view.querySelectorAll('[data-stair-rm]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Remove?'; b.classList.add('is-armed'); return; }
      const removeIndex = Number(b.getAttribute('data-stair-rm'));
      const removed = m.data.stairs[removeIndex];
      if (removed) m.data.stairs.forEach((flight) => { if (flight.starts_on_landing_of === removed.id) flight.starts_on_landing_of = null; });
      m.data.stairs.splice(removeIndex, 1);
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-step-add]').forEach((b) => b.addEventListener('click', () => {
      const s = m.data.stairs[Number(b.getAttribute('data-step-add'))];
      const previousTread = [...s.steps].reverse().find((step) => step.kind !== 'riser') || null;
      s.steps.push(newStep(previousTread, 'step'));
      const si = Number(b.getAttribute('data-step-add'));
      m.vizSel[si] = s.steps.length - 1;
      measSaveSoon();
      redraw();
      const el = view.querySelector(`[data-in="stairs.${si}.steps.${s.steps.length - 1}.tread_w"]`);
      if (el) el.focus();
    }));
    view.querySelectorAll('[data-riser-add]').forEach((b) => b.addEventListener('click', () => {
      const si = Number(b.getAttribute('data-riser-add'));
      const s = m.data.stairs[si];
      const previous = [...s.steps].reverse().find((step) => step.kind === 'riser' || step.riser_h != null) || s.steps[s.steps.length - 1] || null;
      s.steps.push(newStep(previous, 'riser'));
      m.vizSel[si] = s.steps.length - 1;
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-step-many]').forEach((b) => b.addEventListener('click', () => {
      const si = Number(b.getAttribute('data-step-many'));
      const s = m.data.stairs[si];
      const n = Math.min(40, Math.max(1, Number(($(`ppMany-${si}`) || {}).value) || 1));
      for (let i = 0; i < n && s.steps.length < 60; i += 1) {
        const previousTread = [...s.steps].reverse().find((step) => step.kind !== 'riser') || null;
        s.steps.push(newStep(previousTread, 'step'));
      }
      m.vizSel[si] = Math.max(0, s.steps.length - 1);
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-step-down]').forEach((b) => b.addEventListener('click', () => {
      const [si, i] = b.getAttribute('data-step-down').split(':').map(Number);
      const s = m.data.stairs[si];
      const src = s.steps[i];
      for (let j = i + 1; j < s.steps.length; j += 1) {
        if (s.steps[j].kind === 'riser') continue;
        s.steps[j] = { ...src, id: s.steps[j].id, note: s.steps[j].note };
      }
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-step-rm]').forEach((b) => b.addEventListener('click', () => {
      const [si, i] = b.getAttribute('data-step-rm').split(':').map(Number);
      m.data.stairs[si].steps.splice(i, 1);
      m.vizSel[si] = Math.max(0, Math.min(i, m.data.stairs[si].steps.length - 1));
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-nos-add]').forEach((b) => b.addEventListener('click', () => {
      const s = m.data.stairs[Number(b.getAttribute('data-nos-add'))];
      const last = treadSteps(s).slice(-1)[0];
      const position = last ? last.id : s.landing && s.landing.enabled ? 'landing' : '';
      const length = last ? last.tread_w : s.landing && s.landing.enabled ? s.landing.width : null;
      s.nosings.push({ id: uid(), length, qty: 1, type: 'flush', position, note: '' });
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
      openVentSheet(m.data.vents.length - 1, true);
    });
    view.querySelectorAll('[data-vent-open]').forEach((b) => b.addEventListener('click', () => openVentSheet(Number(b.getAttribute('data-vent-open')), false)));
    view.querySelectorAll('[data-vent-qty]').forEach((b) => b.addEventListener('click', () => {
      const [i, d] = b.getAttribute('data-vent-qty').split(':').map(Number);
      const v = m.data.vents[i];
      if (!v) return;
      v.qty = Math.max(1, (Number(v.qty) || 1) + d);
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-mtab-go]').forEach((b) => b.addEventListener('click', () => { m.tab = b.getAttribute('data-mtab-go'); redraw(); }));
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
        window.alert(e.message || 'Could not upload the photo.');
        if (label) label.classList.remove('is-busy');
      }
    }));
    view.querySelectorAll('[data-ph-rm]').forEach((b) => b.addEventListener('click', () => {
      const { obj, key } = measAt(b.getAttribute('data-ph-rm'));
      obj[key].splice(Number(b.getAttribute('data-ph-i')), 1);
      measSaveSoon();
      redraw();
    }));
    view.querySelectorAll('[data-sum-done]').forEach((b) => b.addEventListener('click', () => { const top = $('ppMeasDone'); if (top) top.click(); }));
    const done = $('ppMeasDone');
    if (done) done.addEventListener('click', async () => {
      done.disabled = true;
      try {
        await measSaveNow();
        const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/complete`, { done: true });
        state.meas = { ...r.data, tab: m.tab, dirty: false };
        paintMeasurement();
        mateToast('celebrate', 'Measurement complete', 'It goes with the Work Order for this address.');
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
    view.querySelectorAll('#ppMeasDel, [data-meas-del-head]').forEach((b) => b.addEventListener('click', () => confirmMeasDelete(m, () => { state.meas = null; state.homeMeas = null; location.hash = '#measurements'; })));
  }

  /* ─────────────────────────── voice dictation (Mate) ─────────────────────────── */

  const voice = { rec: null, chunks: [], stream: null, timer: null, started: 0, phase: 'idle', undo: null, last: null };
  const MATE_FACE = { idle: 'head-happy', recording: 'head-listening', thinking: 'head-thinking', done: 'head-talking', error: 'head-sorry' };

  function voiceFabHtml() {
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return '';
    return `<div class="pp-voice" id="ppVoice" data-phase="idle">
      <div class="pp-voice-panel" id="ppVoicePanel" hidden></div>
      <button type="button" class="pp-voice-fab" id="ppVoiceBtn" aria-label="Dictate measurements to Mate">
        <img src="/assets/img/mascot/mate-head-happy.webp?v=20261027-m2" alt="" width="52" height="52" />
        <span class="pp-voice-mic">${icon('mic')}</span>
      </button>
    </div>`;
  }
  function voicePanel(html) {
    const p = $('ppVoicePanel');
    if (!p) return;
    p.hidden = !html;
    p.innerHTML = html ? `<button type="button" class="pp-voice-x" data-voice-close aria-label="Close">×</button>${html}` : '';
  }
  function voiceFace(phase) {
    voice.phase = phase;
    const box = $('ppVoice');
    if (!box) return;
    box.setAttribute('data-phase', phase);
    const img = box.querySelector('.pp-voice-fab img');
    if (img) img.src = `/assets/img/mascot/mate-${MATE_FACE[phase] || 'head-happy'}.webp?v=20261027-m2`;
    const btn = $('ppVoiceBtn');
    if (btn) btn.setAttribute('aria-label', phase === 'recording' ? 'Stop and send to Mate' : 'Dictate measurements to Mate');
  }
  function voiceHint() {
    voicePanel(`<strong>Talk to Mate</strong>
      <p>Tap Mate and say the sizes. For example:</p>
      <ul>
        <li>“Step one, thirty-six by eleven and a quarter, left side open, forty-five.”</li>
        <li>“Riser seven and a half. Add twelve more the same.”</li>
        <li>“Vent four by ten, flush mount, white oak, kitchen.”</li>
      </ul>
      <p class="pp-muted" style="font-size:13px">English, Português or Español — say fractions the way you say them on site (“eleven and a quarter”, “onze e um quarto”). Mate warns you when a size looks wrong.</p>
      <button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-voice-start>${icon('mic')}Start talking</button>`);
  }
  function fmtClock(ms) {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }
  async function voiceStart() {
    const m = state.meas;
    if (!m || m.status === 'used') return;
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (_) {
      voiceFace('error');
      voicePanel('<strong>Mate can’t hear you</strong><p>Allow the microphone for this site in your browser settings, then try again.</p>');
      return;
    }
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const type = types.find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) || '';
    voice.chunks = [];
    voice.rec = new window.MediaRecorder(voice.stream, type ? { mimeType: type } : undefined);
    voice.rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) voice.chunks.push(e.data); });
    voice.rec.addEventListener('stop', voiceSend);
    voice.rec.start();
    voice.started = Date.now();
    voiceFace('recording');
    const paint = () => voicePanel(`<strong>Mate is listening…</strong><p class="pp-voice-clock"><span class="pp-voice-dot"></span>${fmtClock(Date.now() - voice.started)} · tap Mate when you finish</p>`);
    paint();
    clearInterval(voice.timer);
    voice.timer = setInterval(() => {
      if (Date.now() - voice.started > 60000) { voiceStop(); return; }
      paint();
    }, 500);
  }
  function voiceStop() {
    clearInterval(voice.timer);
    if (voice.rec && voice.rec.state !== 'inactive') voice.rec.stop();
    if (voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
    voice.stream = null;
  }
  function voiceCancel() {
    if (voice.rec) voice.rec.removeEventListener('stop', voiceSend);
    voiceStop();
    voice.rec = null;
    voiceFace('idle');
    voicePanel('');
  }
  async function voiceSend() {
    const m = state.meas;
    const rec = voice.rec;
    voice.rec = null;
    if (!m || !rec) return;
    const blob = new Blob(voice.chunks, { type: rec.mimeType || 'audio/webm' });
    voice.chunks = [];
    if (blob.size < 800 || Date.now() - voice.started < 700) {
      voiceFace('idle');
      voicePanel('<strong>That was too short</strong><p>Hold on a second longer and say the sizes.</p>');
      return;
    }
    voiceFace('thinking');
    voicePanel('<strong>Mate is writing it down…</strong><p class="pp-muted">Turning what you said into sizes.</p>');
    try {
      const audio = await readAsDataUrl(blob);
      if (m.dirty) await measSaveNow();
      const si = Math.min(m.voiceStair || 0, Math.max(0, (m.data.stairs || []).length - 1));
      const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/voice`, { audio, data: m.data, stair: si, step: (m.vizSel && m.vizSel[si]) || 0 });
      const out = r.data || {};
      if (state.meas !== m) return;
      const before = JSON.stringify(m.data);
      const res = applyVoiceActions(m, out.actions || []);
      voiceFace(res.changed ? 'done' : 'error');
      if (res.changed) {
        voice.undo = { id: m.id, data: before, tab: m.tab };
        m.tab = res.tab || m.tab;
        measSaveSoon();
        const y = window.scrollY;
        paintMeasurement();
        window.scrollTo(0, y);
      }
      voicePanel(`<strong>${esc(out.reply || (res.changed ? 'Done.' : 'I didn’t catch any sizes.'))}</strong>
        ${out.unclear ? `<p class="pp-late">${esc(out.unclear)}</p>` : ''}
        ${out.transcript ? `<p class="pp-voice-heard">“${esc(out.transcript)}”</p>` : ''}
        <div class="pp-voice-acts">${res.changed ? '<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-voice-undo>Undo</button>' : ''}<button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-voice-start>${icon('mic')}Keep talking</button></div>`);
    } catch (e) {
      voiceFace('error');
      voicePanel(`<strong>Mate couldn’t do that</strong><p>${esc(e.message || 'Try again.')}</p><div class="pp-voice-acts"><button type="button" class="pp-btn pp-btn--pri pp-btn--sm" data-voice-start>${icon('mic')}Try again</button></div>`);
    }
  }
  function voiceUndo() {
    const m = state.meas;
    const u = voice.undo;
    if (!m || !u || u.id !== m.id) return;
    m.data = JSON.parse(u.data);
    m.tab = u.tab;
    voice.undo = null;
    measSaveSoon();
    const y = window.scrollY;
    paintMeasurement();
    window.scrollTo(0, y);
    voiceFace('idle');
    voicePanel('<strong>Undone</strong><p>Back to how it was.</p>');
  }
  /** Applies Mate's edit actions to the measurement (same shapes as the editor). */
  function applyVoiceActions(m, actions) {
    const d = m.data;
    d.stairs = d.stairs || [];
    d.vents = d.vents || [];
    let changed = 0;
    let tab = '';
    const STAIR_KEYS = ['name', 'species', 'finish', 'color', 'riser_material'];
    const pick = (a, keys) => keys.reduce((o, k) => { if (a[k] != null && a[k] !== '') o[k] = a[k]; return o; }, {});
    const stairAt = (i) => {
      if (!d.stairs.length) d.stairs.push(newStair(0));
      const idx = Math.min(Math.max(0, Number(i) || 0), d.stairs.length - 1);
      m.voiceStair = idx;
      return d.stairs[idx];
    };
    const dims = (st, a) => {
      if (a.tread_w != null || a.tread_d != null) st.kind = 'step';
      ['tread_w', 'tread_d', 'riser_w', 'riser_h'].forEach((k) => { if (a[k] != null) st[k] = Number(a[k]); });
      if (a.riser_h != null && a.riser_w == null && st.riser_w == null && st.tread_w != null) st.riser_w = st.tread_w;
      if (a.open) st.open = a.open;
      if (a.ret) st.ret = a.ret;
      if (typeof a.no_riser === 'boolean') st.no_riser = a.no_riser;
    };
    for (const a of actions) {
      if (!a || !a.type) continue;
      const landing = (s) => { if (a.landing === true || a.landing_w != null || a.landing_d != null) s.landing = { enabled: true, width: a.landing_w != null ? Number(a.landing_w) : (s.landing && s.landing.width) || null, depth: a.landing_d != null ? Number(a.landing_d) : (s.landing && s.landing.depth) || null }; };
      // an upper flight starts from the lower flight's landing
      const linkTo = (s) => {
        if (a.starts_on_landing_of == null) return;
        const lower = d.stairs[Number(a.starts_on_landing_of)];
        if (!lower || lower === s || d.stairs.some((f) => f !== s && f.starts_on_landing_of === lower.id)) return;
        lower.landing = { enabled: true, width: (lower.landing && lower.landing.width) || null, depth: (lower.landing && lower.landing.depth) || null };
        s.starts_on_landing_of = lower.id;
      };
      const turnOf = (s) => { if (STAIR_TURNS.includes(a.turn)) s.turn = a.turn; };
      if (a.type === 'add_stair') {
        d.stairs.push({ ...newStair(d.stairs.length + 1), ...pick(a, STAIR_KEYS) });
        m.voiceStair = d.stairs.length - 1;
        landing(d.stairs[d.stairs.length - 1]);
        linkTo(d.stairs[d.stairs.length - 1]);
        turnOf(d.stairs[d.stairs.length - 1]);
        tab = 'stairs';
      } else if (a.type === 'set_stair') {
        const st = stairAt(a.stair);
        Object.assign(st, pick(a, STAIR_KEYS));
        landing(st);
        linkTo(st);
        turnOf(st);
        tab = 'stairs';
      } else if (a.type === 'set_steps') {
        const s = stairAt(a.stair);
        const from = Math.max(1, a.from);
        const to = Math.max(from, a.to || from);
        while (s.steps.length < to) s.steps.push(newStep(null, 'step'));
        for (let i = from - 1; i < to; i += 1) dims(s.steps[i], a);
        m.vizSel = m.vizSel || {};
        m.vizSel[m.voiceStair] = to - 1;
        tab = 'stairs';
      } else if (a.type === 'add_steps') {
        const s = stairAt(a.stair);
        for (let n = 0; n < a.count; n += 1) {
          const previousTread = [...s.steps].reverse().find((step) => step.kind !== 'riser') || null;
          const st = newStep(previousTread, 'step');
          dims(st, a);
          s.steps.push(st);
        }
        m.vizSel = m.vizSel || {};
        m.vizSel[m.voiceStair] = s.steps.length - 1;
        tab = 'stairs';
      } else if (a.type === 'remove_steps') {
        const s = stairAt(a.stair);
        const from = Math.max(1, a.from);
        const to = Math.max(from, a.to || from);
        s.steps.splice(from - 1, to - from + 1);
        tab = 'stairs';
      } else if (a.type === 'add_riser') {
        const s = stairAt(a.stair);
        for (let n = 0; n < a.count; n += 1) {
          const previous = [...s.steps].reverse().find((step) => step.kind === 'riser' || step.riser_h != null) || s.steps[s.steps.length - 1] || null;
          const st = newStep(previous, 'riser');
          dims(st, a);
          s.steps.push(st);
        }
        m.vizSel = m.vizSel || {};
        m.vizSel[m.voiceStair] = s.steps.length - 1;
        tab = 'stairs';
      } else if (a.type === 'add_nosing') {
        const s = stairAt(a.stair);
        const last = treadSteps(s).slice(-1)[0];
        const position = last ? last.id : s.landing && s.landing.enabled ? 'landing' : '';
        s.nosings.push({ id: uid(), length: Number(a.length) || null, qty: a.qty || 1, type: a.nosing_type || 'flush', position, note: a.note || '' });
        tab = 'stairs';
      } else if (a.type === 'add_vent') {
        d.vents.push({ ...newVent(null), size: String(a.size || '4x10').replace(/\s+/g, ''), type: a.vent_type || 'flush', qty: a.qty || 1, room: a.room || '', ...pick(a, ['species', 'finish', 'color']) });
        tab = 'vents';
      } else continue;
      changed += 1;
    }
    if (changed && d.stairs[m.voiceStair]) m.activeStairId = d.stairs[m.voiceStair].id;
    return { changed, tab };
  }
  /** Photo → JPEG data URL no bigger than `max` px (what Mate looks at and what is stored). */
  function shrinkPhoto(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, (max || 1600) / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not open ${file.name}.`)); };
      img.src = url;
    });
  }

  /** Stair from photos: the builder snaps the stair, says or types the sizes, Mate builds it (with undo). */
  function openStairPhotos() {
    const m = state.meas;
    if (!m || m.status === 'used') return;
    const st = { photos: [], text: '', audio: null, rec: null, chunks: [], recording: false };
    const canMic = Boolean(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const root = openSheet('Stair from photos', `<div class="pp-sph" id="ppSph">
        <div class="pp-sph-tip">${mate('snap', 72)}<p>Take 1–4 photos of the stair: one from the bottom looking up and one from the side. <b>Two flights with a landing?</b> Take one photo of each flight — Mate builds both and joins them at the landing. Then say or type the sizes you measured.</p></div>
        <div class="pp-sph-photos" id="ppSphPhotos"></div>
        <div class="pp-sph-add"><label class="pp-btn pp-btn--sec pp-btn--sm">${icon('camera')}Take photo<input type="file" accept="image/*" capture="environment" data-sph-add hidden /></label><label class="pp-btn pp-btn--sec pp-btn--sm">${icon('upload')}Choose photos<input type="file" accept="image/*" multiple data-sph-add hidden /></label></div>
        <div class="pp-field"><label for="ppSphText">Sizes and notes <span>(optional)</span></label><textarea id="ppSphText" rows="3" maxlength="1500" placeholder="e.g. 2 flights with a landing: 8 steps up to the landing, 9 to the top, 42 wide, 11 1/4 deep, risers 7 1/2, landing 42 x 42"></textarea></div>
        ${canMic ? `<button type="button" class="pp-btn pp-btn--sec pp-sph-mic" data-sph-mic>${icon('mic')}<span>Say the sizes</span></button>` : ''}
        <p class="pp-error" id="ppSphErr" role="alert" hidden></p>
        <div class="pp-plan-progress" data-sph-wait hidden><span>Mate is looking at the stair…</span><b><i style="width:60%"></i></b></div>
        <div class="pp-sheet-actions"><button type="button" class="pp-btn pp-btn--pri" data-sph-go disabled>Build the stair</button></div>
      </div>`, { noFocus: true });
    const paint = () => {
      root.querySelector('#ppSphPhotos').innerHTML = st.photos.map((p, i) => `<span class="pp-sph-ph"><img src="${p}" alt="Stair photo ${i + 1}" /><button type="button" data-sph-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></span>`).join('');
      root.querySelectorAll('[data-sph-rm]').forEach((b) => b.addEventListener('click', () => { st.photos.splice(+b.getAttribute('data-sph-rm'), 1); paint(); }));
      root.querySelector('[data-sph-go]').disabled = !st.photos.length;
    };
    root.querySelectorAll('[data-sph-add]').forEach((inp) => inp.addEventListener('change', async () => {
      for (const f of Array.from(inp.files || [])) { if (st.photos.length >= 4) break; try { st.photos.push(await shrinkPhoto(f, 1600)); } catch (_) { /* skip */ } }
      inp.value = '';
      paint();
    }));
    const mic = root.querySelector('[data-sph-mic]');
    if (mic) mic.addEventListener('click', async () => {
      if (st.recording) { st.rec.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) || '';
        st.chunks = []; st.rec = new window.MediaRecorder(stream, type ? { mimeType: type } : undefined);
        st.rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) st.chunks.push(e.data); });
        st.rec.addEventListener('stop', async () => {
          stream.getTracks().forEach((t) => t.stop());
          st.recording = false;
          const blob = new Blob(st.chunks, { type: st.rec.mimeType || 'audio/webm' });
          st.audio = blob.size > 800 ? await readAsDataUrl(blob) : null;
          mic.classList.remove('is-rec');
          mic.querySelector('span').textContent = st.audio ? 'Sizes recorded · record again' : 'Say the sizes';
        });
        st.rec.start(); st.recording = true;
        mic.classList.add('is-rec');
        mic.querySelector('span').textContent = 'Listening… tap to stop';
      } catch (_) { formError('ppSphErr', { message: 'Allow the microphone for this site, or type the sizes.' }); }
    });
    root.querySelector('[data-sph-go]').addEventListener('click', async () => {
      if (st.recording) st.rec.stop();
      const go = root.querySelector('[data-sph-go]'); go.disabled = true;
      $('ppSphErr').hidden = true;
      root.querySelector('[data-sph-wait]').hidden = false;
      try {
        if (m.dirty) await measSaveNow();
        const r = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/stair-photos`, { photos: st.photos, text: $('ppSphText').value.trim(), audio: st.audio, data: m.data });
        const out = r.data || {};
        if (state.meas !== m) return;
        const before = JSON.stringify(m.data);
        const count = (m.data.stairs || []).length;
        const res = applyVoiceActions(m, out.actions || []);
        if (!res.changed) throw new Error(out.unclear || 'Mate couldn’t build a stair from these photos. Try a photo from the bottom of the stair.');
        // keep the photos on the stair Mate built (or the current one)
        const target = m.data.stairs[(m.data.stairs.length > count ? m.data.stairs.length - 1 : m.voiceStair) || 0];
        for (const p of st.photos) {
          try { const up = await postJson(`/api/builder/measurements/${encodeURIComponent(m.id)}/photos`, { data_url: p }); if (target) { target.photos = target.photos || []; if (target.photos.length < 12) target.photos.push(up.data.key); } } catch (_) { /* photo is optional */ }
        }
        if (target && out.observations && out.observations.length) target.note = [target.note, ...out.observations].filter(Boolean).join(' · ').slice(0, 500);
        m.tab = 'stairs';
        measSaveSoon();
        const body = root.querySelector('#ppSph');
        body.innerHTML = `<div class="pp-sph-done">${mate('thumbs', 96)}<div><strong>${esc(out.reply || 'Stair built.')}</strong>
          ${out.observations && out.observations.length ? `<ul>${out.observations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
          ${out.unclear ? `<p class="pp-late">${esc(out.unclear)}</p>` : ''}
          ${out.transcript ? `<p class="pp-voice-heard">“${esc(out.transcript)}”</p>` : ''}</div></div>
          <div class="pp-sheet-actions"><button type="button" class="pp-btn pp-btn--sec" data-sph-undo>Undo</button><button type="button" class="pp-btn pp-btn--pri" data-sheet-close>See the stair</button></div>`;
        body.querySelector('[data-sph-undo]').addEventListener('click', () => { m.data = JSON.parse(before); measSaveSoon(); closeSheet(); paintMeasurement(); });
        paintMeasurement();
      } catch (ex) {
        root.querySelector('[data-sph-wait]').hidden = true;
        formError('ppSphErr', ex);
        go.disabled = false;
      }
    });
  }

  function bindVoice() {
    const box = $('ppVoice');
    if (!box) return;
    voiceFace(['recording', 'thinking'].includes(voice.phase) ? voice.phase : 'idle');
    $('ppVoiceBtn').addEventListener('click', () => {
      if (voice.phase === 'recording') { voiceStop(); return; }
      if (voice.phase === 'thinking') return;
      let seen = false;
      try { seen = localStorage.getItem('ob_voice_hint') === '1'; localStorage.setItem('ob_voice_hint', '1'); } catch (_) { seen = true; }
      if (!seen) { voiceHint(); return; }
      voiceStart();
    });
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-voice-start]')) voiceStart();
      else if (e.target.closest('[data-voice-undo]')) voiceUndo();
      else if (e.target.closest('[data-voice-close]')) { if (voice.phase === 'recording') voiceCancel(); else { voiceFace('idle'); voicePanel(''); } }
    });
  }
  window.addEventListener('hashchange', () => { if (voice.phase === 'recording') voiceCancel(); });
  // Which stair the builder is working on (voice edits go there unless another stair is named).
  view.addEventListener('focusin', (e) => { const row = e.target.closest('[data-step-row]'); if (row && state.meas) state.meas.voiceStair = Number(row.getAttribute('data-step-row').split(':')[0]); });
  view.addEventListener('click', (e) => { const viz = e.target.closest('[data-viz-stair]'); if (viz && state.meas) state.meas.voiceStair = Number(viz.getAttribute('data-viz-stair')); }, true);

  /* ─────────────────────────── Mate: ask, toasts, getting started ─────────────────────────── */

  /** Short Mate message that slides up above the tab bar and leaves by itself. */
  function mateToast(pose, title, text) {
    const old = $('ppToast');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="pp-toast" id="ppToast" role="status">${mate(pose, 44)}<div><strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ''}</div></div>`);
    const el = $('ppToast');
    setTimeout(() => { if (el.isConnected) { el.classList.add('is-out'); setTimeout(() => el.remove(), 220); } }, 3600);
  }

  /** What Mate may know: the same jobs, invoices and measurements this person sees in the app. */
  function mateSnapshot() {
    const iso = (d) => { const x = toDate(d); return x ? x.toISOString() : null; };
    const STAGE = ['Awaiting schedule', 'Scheduled', 'On site', 'Completed'];
    const jobs = (state.all.jobs || state.jobs || []).slice().sort((a, b) => (toDate(a.scheduledStart) || 0) - (toDate(b.scheduledStart) || 0)).slice(0, 110);
    return {
      today: new Date().toString().slice(0, 24),
      builder: state.builder.account.name,
      me: state.builder.member.name,
      companies: (state.builder.companies || []).map((c) => ({ id: c.id, name: c.company_name, status: c.status, phone: (c.profile && c.profile.phone) || c.contact_phone || null, email: (c.profile && c.profile.email) || c.contact_email || null, address: (c.profile && c.profile.address) || null, active_jobs: (state.all.jobs || []).filter((j) => j._co === c.id && jobIsActive(j)).length })),
      jobs: jobs.map((j) => ({ id: j.id, title: j.title || null, address: j.address || null, status: STAGE[jobStepIndex(j)], start: iso(j.scheduledStart), end: iso(j.scheduledEnd), all_day: Boolean(j.allDay), number: j.number || null, company: j._coName || null })),
      invoices: canDo('money.view') ? (state.all.invoices || state.invoices || []).slice(0, 70).map((i) => ({ id: i.id, number: i.number || null, balance: Number(i.balance || 0), state: invoiceState(i).label, due: i.due_date || null, job: (i.job && (i.job.title || i.job.address)) || null, company: i._coName || null })) : [],
      measurements: (state.homeMeas || []).slice(0, 35).map((m) => ({ id: m.id, address: m.address, status: m.status, counts: countsText(m.counts), updated: m.updated_at })),
      pickups: (state.pickups || []).map((p) => ({ name: p.name, address: p.address, hours: p.hours, phone: p.phone })),
      requests: (state.requests || []).slice(0, 25).map((r) => ({ title: r.title, status: r.status, created: r.created_at, company: r._coName || null })),
    };
  }

  const mateChat = { turns: [], busy: false, rec: null, chunks: [], stream: null };
  const MATE_SUGGEST = ['What’s on site today?', 'Which invoices are overdue?', 'What’s scheduled this week?', 'Which measurements are still open?'];

  async function openMate() {
    if (!state.homeMeas && canDo('measure')) api('/api/builder/measurements').then((r) => { state.homeMeas = r.data || []; }).catch(() => {});
    if (!state.pickups) ensurePickups();
    const root = openSheet('Ask Mate', `
      <div class="pp-chat" id="ppChat" aria-live="polite"></div>
      <form class="pp-chat-bar" id="ppChatForm">
        <label class="pp-sr" for="ppChatIn">Ask Mate</label>
        <input id="ppChatIn" maxlength="600" autocomplete="off" placeholder="Ask about jobs, invoices, measurements…" enterkeyhint="send" />
        ${window.MediaRecorder && navigator.mediaDevices ? `<button type="button" class="pp-chat-mic" id="ppChatMic" aria-label="Talk to Mate">${icon('mic')}</button>` : ''}
        <button type="submit" class="pp-chat-send" aria-label="Send">${icon('send')}</button>
      </form>`, { noFocus: true });
    root.querySelector('.pp-sheet-card').classList.add('pp-chat-card');
    paintChat();
    const form = $('ppChatForm');
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = $('ppChatIn').value.trim(); if (v) askMateNow({ question: v }); });
    const mic = $('ppChatMic');
    if (mic) mic.addEventListener('click', () => (mateChat.rec ? stopMateRec() : startMateRec()));
    root.addEventListener('click', (e) => {
      const sug = e.target.closest('[data-mate-q]');
      if (sug) askMateNow({ question: sug.getAttribute('data-mate-q') });
      const go = e.target.closest('[data-mate-go]');
      if (go) { closeSheet(); location.hash = go.getAttribute('data-mate-go'); }
    });
  }
  function paintChat() {
    const box = $('ppChat');
    if (!box) return;
    const first = state.builder.member.name.split(/\s+/)[0];
    const hello = `<div class="pp-msg pp-msg--mate">${mate('head-happy', 40)}<div class="pp-bubble"><strong>Hi ${esc(first)}! I’m Mate.</strong><span>Ask me about your jobs, schedule, invoices, pickups or measurements — typing or talking.</span></div></div>
      ${mateChat.turns.length ? '' : `<div class="pp-chat-sugs">${MATE_SUGGEST.map((q) => `<button type="button" class="pp-chip-btn" data-mate-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}`;
    box.innerHTML = hello + mateChat.turns.map((t) => t.role === 'user'
      ? `<div class="pp-msg pp-msg--me"><div class="pp-bubble">${esc(t.text)}</div></div>`
      : `<div class="pp-msg pp-msg--mate">${mate(t.error ? 'head-sorry' : 'head-talking', 40)}<div class="pp-bubble">${esc(t.text).replace(/\n/g, '<br>')}${(t.actions || []).length ? `<div class="pp-msg-acts">${t.actions.map((a) => `<button type="button" class="pp-btn pp-btn--sec pp-btn--sm" data-mate-go="${esc(a.href)}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div></div>`).join('')
      + (mateChat.busy ? `<div class="pp-msg pp-msg--mate">${mate('head-thinking', 40)}<div class="pp-bubble pp-typing"><i></i><i></i><i></i></div></div>` : '');
    box.scrollTop = box.scrollHeight;
  }
  async function askMateNow(input) {
    if (mateChat.busy) return;
    const inEl = $('ppChatIn');
    if (input.question) { mateChat.turns.push({ role: 'user', text: input.question }); if (inEl) inEl.value = ''; }
    mateChat.busy = true;
    paintChat();
    try {
      const history = mateChat.turns.slice(-8, input.question ? -1 : undefined).map((t) => ({ role: t.role, text: String(t.text).slice(0, 1200) }));
      const r = await postJson('/api/builder/mate', { ...input, snapshot: mateSnapshot(), history });
      if (!input.question && r.data.question) mateChat.turns.push({ role: 'user', text: r.data.question });
      mateChat.turns.push({ role: 'mate', text: r.data.answer, actions: r.data.actions });
    } catch (e) {
      mateChat.turns.push({ role: 'mate', text: e.message || 'I couldn’t answer right now.', error: true });
    }
    mateChat.busy = false;
    paintChat();
  }
  async function startMateRec() {
    try { mateChat.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) { mateChat.turns.push({ role: 'mate', text: 'I can’t hear you — allow the microphone for this site.', error: true }); paintChat(); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) || '';
    mateChat.chunks = [];
    mateChat.rec = new window.MediaRecorder(mateChat.stream, type ? { mimeType: type } : undefined);
    mateChat.rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) mateChat.chunks.push(e.data); });
    mateChat.rec.addEventListener('stop', async () => {
      const blob = new Blob(mateChat.chunks, { type: (mateChat.rec && mateChat.rec.mimeType) || 'audio/webm' });
      mateChat.rec = null;
      const mic = $('ppChatMic');
      if (mic) mic.classList.remove('is-rec');
      if (blob.size < 800) return;
      askMateNow({ audio: await readAsDataUrl(blob) });
    });
    mateChat.rec.start();
    const mic = $('ppChatMic');
    if (mic) mic.classList.add('is-rec');
    setTimeout(() => { if (mateChat.rec) stopMateRec(); }, 30000);
  }
  function stopMateRec() {
    if (mateChat.rec && mateChat.rec.state !== 'inactive') mateChat.rec.stop();
    if (mateChat.stream) mateChat.stream.getTracks().forEach((t) => t.stop());
    mateChat.stream = null;
  }
  window.addEventListener('hashchange', () => { if (mateChat.rec) stopMateRec(); });

  /** Home: Mate's getting-started list until the account is set up (or dismissed). */
  function setupSteps() {
    const b = state.builder;
    const steps = [
      { key: 'company', done: activeCompanies().length > 0, label: 'Connect your flooring company', sub: 'Their logo, contacts and jobs show up here', href: '#companies', pose: 'handshake', perm: 'companies.manage' },
      { key: 'send', done: (state.requests || []).length > 0 || (state.all.jobs || []).length > 0, label: 'Send your first work order', sub: 'Snap it — Mate reads it for you', href: '#send', pose: 'snap', perm: 'jobs.send' },
      { key: 'measure', done: (state.homeMeas || []).length > 0, label: 'Measure a stair on site', sub: 'Treads, risers and vents, by voice too', href: '#measurements/new', pose: 'measure', perm: 'measure' },
      { key: 'pickup', done: (state.pickups || []).length > 0, label: 'Save your pickup locations', sub: 'Jobs get the yard address automatically', href: '#settings/pickups', pose: 'delivery', perm: 'team.manage' },
      { key: 'team', done: (state.teamCount || 1) > 1, label: 'Invite your team', sub: 'Supers, purchasing and the office', href: '#team', pose: 'wave', perm: 'team.manage' },
      { key: 'app', done: isStandaloneApp(), label: 'Install the app on your phone', sub: 'One tap from your home screen', href: '#settings/app', pose: 'tablet', perm: null },
    ].filter((s) => !s.perm || canDo(s.perm));
    return { steps, left: steps.filter((s) => !s.done), b };
  }
  function setupCardHtml() {
    if (!state.builder) return '';
    let hidden = false;
    try { hidden = localStorage.getItem(`ob_setup_hidden_${state.builder.account.id}`) === '1'; } catch (_) { hidden = false; }
    const { steps, left } = setupSteps();
    if (hidden || !left.length) return '';
    const next = left[0];
    const done = steps.length - left.length;
    // One clear next step, the rest as small check chips (the long list pushed the page down).
    return `<section class="pp-card pp-setup2" style="grid-column: 1 / -1" aria-labelledby="ppSetupT">
        <img class="pp-setup2-art" src="${mateSrc(next.pose)}" alt="" />
        <div class="pp-setup2-main">
          <div class="pp-setup2-top">
            <h2 id="ppSetupT">Get set up <span>${done} of ${steps.length} done</span></h2>
            <button type="button" class="pp-link" data-setup-hide>Hide</button>
          </div>
          <div class="pp-setup2-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}" aria-label="Setup progress"><i style="width:${Math.round((done / steps.length) * 100)}%"></i></div>
          <a class="pp-setup2-next" href="${next.href}"><span><small>Next</small><strong>${esc(next.label)}</strong><em>${esc(next.sub)}</em></span><b>Start ${icon('chev')}</b></a>
          <ul class="pp-setup2-chips">${steps.map((st) => `<li class="${st.done ? 'is-done' : st === next ? 'is-next' : ''}"><a href="${st.href}">${st.done ? '✓ ' : ''}${esc(st.label.replace(/^(Connect your|Send your|Save your|Invite your|Install the app on your) /, (m) => ({ 'Connect your ': 'Connect ', 'Send your ': 'Send ', 'Save your ': 'Save ', 'Invite your ': 'Invite ', 'Install the app on your ': 'App on ' })[m] || m))}</a></li>`).join('')}</ul>
        </div>
      </section>`;
  }


  /* ─────────────────────────── more (phone) ─────────────────────────── */

  function renderMore() {
    const declined = state.requests.filter((r) => r.status === 'declined').length;
    const waiting = state.requests.filter((r) => r.status === 'pending').length;
    const row = (href, ic, label, sub, extra) => `<a class="pp-set-row" href="${href}"><span class="pp-set-ic">${icon(ic)}</span><span><strong>${esc(label)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${extra || ''}${icon('chev')}</a>`;
    const btn = (id, ic, label, sub, attr) => `<button type="button" class="pp-set-row" ${id ? `id="${id}"` : ''} ${attr || ''}><span class="pp-set-ic">${icon(ic)}</span><span><strong>${esc(label)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${icon('chev')}</button>`;
    const group = (title, inner) => inner.trim() ? `<p class="pp-more-label">${esc(title)}</p><div class="pp-card pp-set-list">${inner}</div>` : '';
    const b = state.builder;
    view.innerHTML = `
      <div class="pp-head"><div>${b ? `<p class="pp-eyebrow">${esc(b.account.name)}</p>` : ''}<h1>More</h1></div></div>
      <div class="pp-set-hub pp-more">
        ${group('Work', `
          ${row('#send', 'send', 'Send work', waiting ? `${waiting} waiting for the company` : 'PDF, photo or text', declined ? `<span class="pp-badge">${declined}</span>` : '')}
          ${row('#calendar', 'cal', 'Calendar', 'Every job by day')}
          ${row('#documents', 'camera', 'Photos & docs', 'Shared by the company')}`)}
        ${b ? group('Account', `
          ${row('#companies', 'globe', 'Companies', activeCompanies().length ? `${activeCompanies().length} connected` : 'Connect or invite flooring companies')}
          ${row('#team', 'user', 'Team', b.member.role_label)}
          ${row('#settings', 'gear', 'Settings', canDo('team.manage') ? 'Profile, company, pickups and prices' : 'Your profile and the app')}`) : ''}
        ${group(state.user.name || 'You', `
          <div class="pp-more-me"><small>${esc(state.user.email || '')}${state.user.company_name ? ` · ${esc(state.user.company_name)}` : ''}</small></div>
          ${!b && state.providers.length > 1 ? btn('ppMoreSwitch', 'globe', 'Switch company', `Now: ${providerName()}`) : ''}
          ${canInstallApp() ? btn('', 'download', 'Install the ObraBuilder app', 'Open it from your home screen', 'data-install-app') : ''}`)}
        <button type="button" class="pp-set-out" id="ppMoreLogout">${icon('back')}Sign out</button>
      </div>`;
    const sw = $('ppMoreSwitch');
    if (sw) sw.addEventListener('click', () => { openMenu(true); });
    $('ppMoreLogout').addEventListener('click', logout);
  }

  /* ─────────────────────────── shell ─────────────────────────── */

  function openMenu(open) {
    const menu = $('ppMenu');
    menu.hidden = !open;
    $('ppChip').setAttribute('aria-expanded', open ? 'true' : 'false');
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
      <div class="pp-head"><div><p class="pp-eyebrow">First sign-in</p><h1>Create your password</h1></div></div>
      <form class="pp-card pp-password" id="ppPwForm">
        <p class="pp-muted" style="margin:0">For security, replace the temporary password before opening your jobs.</p>
        <div class="pp-field"><label for="ppPw1">New password (at least 10 characters)</label><input id="ppPw1" type="password" minlength="10" autocomplete="new-password" required /></div>
        <div class="pp-field"><label for="ppPw2">Repeat the new password</label><input id="ppPw2" type="password" minlength="10" autocomplete="new-password" required /></div>
        <p class="pp-error" id="ppPwError" role="alert" hidden></p>
        <div><button class="pp-btn pp-btn--pri" id="ppPwSave" type="submit">Save password</button></div>
      </form>`;
    $('ppPwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ppPwError');
      const btn = $('ppPwSave');
      err.hidden = true;
      const pw = $('ppPw1').value;
      if (pw.length < 10) { err.textContent = 'Use at least 10 characters.'; err.hidden = false; return; }
      if (pw !== $('ppPw2').value) { err.textContent = 'The passwords do not match.'; err.hidden = false; return; }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await postJson('/api/partner-auth/change-password', { password: pw });
        await boot();
      } catch (ex) {
        err.textContent = ex.message || 'Could not save the password.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Save password';
      }
    });
  }

  function renderSearchResults() {
    const q = $('ppSearchMobile').value.trim().toLowerCase();
    const box = $('ppSearchResults');
    if (!q) { box.innerHTML = '<div class="pp-empty">Type an address, title or number.</div>'; return; }
    const jobs = state.jobs.filter((j) => jobMatchesQuery(j, q)).slice(0, 8);
    const invs = state.invoices.filter((inv) => [inv.number, invoiceRef(inv), inv.job && inv.job.address].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 5);
    box.innerHTML = (jobs.length || invs.length)
      ? `${jobs.length ? '<div class="pp-group">Jobs</div>' : ''}${jobs.map((j) => `<a class="pp-row" href="#jobs/${encodeURIComponent(j.id)}" style="text-decoration:none"><span class="pp-row-main"><strong style="font-size:15px">${esc(j.title || 'Job')}</strong><span class="pp-row-sub">${esc(j.address || '')}</span></span></a>`).join('')}${invs.length ? '<div class="pp-group">Invoices</div>' : ''}${invs.map((inv) => `<a class="pp-row" href="#invoices/${encodeURIComponent(inv.id)}" style="text-decoration:none"><span class="pp-row-main"><strong style="font-size:15px">${esc(inv.number || 'Invoice')} · ${money(inv.amount)}</strong><span class="pp-row-sub">${esc(invoiceRef(inv))}</span></span></a>`).join('')}`
      : '<div class="pp-empty">Nothing found.</div>';
    box.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { $('ppSearchSheet').hidden = true; }));
  }

  function bindShell() {
    $('ppChip').addEventListener('click', (e) => { e.stopPropagation(); openMenu($('ppMenu').hidden); });
    document.addEventListener('click', (e) => { if (!$('ppMenu').hidden && !e.target.closest('#ppMenu')) openMenu(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { openMenu(false); $('ppSearchSheet').hidden = true; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('ppSearch').focus(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && !$('ppMateBtn').hidden) { e.preventDefault(); openMate(); }
    });
    $('ppLogout').addEventListener('click', logout);
    $('ppMateBtn').addEventListener('click', () => openMate());
    $('ppProviderSwitch').addEventListener('click', async () => {
      const btn = $('ppProviderSwitch');
      const workspace = $('ppProviderSelect').value;
      if (!workspace) return;
      btn.disabled = true;
      btn.textContent = 'Switching…';
      try {
        const r = await postJson('/api/partner-auth/switch', { workspace });
        location.replace((r.data && r.data.redirect_url) || 'partner-portal.html');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Switch company';
        window.alert(err.message || 'Could not switch company.');
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
      if (route().name !== 'enviar') location.hash = '#send'; else renderSendBody();
    });
    $('ppCameraInput').addEventListener('change', async (e) => {
      if (!state.send) state.send = newSend();
      await addFiles(e.target.files);
      e.target.value = '';
      if (route().name !== 'enviar') location.hash = '#send'; else renderSendBody();
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
      $('ppChip').setAttribute('aria-label', `Account: ${state.user.name || state.user.email || ''}`);
      $('ppChipName').textContent = state.user.name || state.user.email || '';
      $('ppChipRole').textContent = state.builder.member.role_label || '';
      $('ppUserName').textContent = state.user.name || '';
      $('ppUserEmail').textContent = [state.user.email, `${state.builder.account.name} · ${state.builder.member.role_label}`].join(' · ');
      paintShell();
      loadNotes(true);
      setInterval(() => { if (document.visibilityState === 'visible') loadNotes(true); }, 120000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadNotes(true); });
      if (typeof window.sfBootCrmAddressAutocomplete === 'function') window.sfBootCrmAddressAutocomplete();
      $('ppDock').hidden = false;
      $('ppTabs').hidden = false;
      $('ppSearchFab').hidden = false;
      if (!location.hash && !activeCompanies().length) location.hash = '#companies';
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
    $('ppBrandSub').textContent = `Company: ${prov}`;
    $('ppMark').textContent = initials(builderName);
    $('ppAvatar').textContent = initials(state.user.name || state.user.email);
    $('ppChip').setAttribute('aria-label', `Account: ${state.user.name || state.user.email || ''}`);
    $('ppChipName').textContent = state.user.name || state.user.email || '';
    $('ppChipRole').textContent = prov || '';
    $('ppUserName').textContent = state.user.name || '';
    $('ppUserEmail').textContent = [state.user.email, state.user.company_name].filter(Boolean).join(' · ');
    $('ppProviderTools').hidden = state.providers.length < 2;
    if (state.providers.length > 1) {
      $('ppProviderSelect').innerHTML = state.providers.map((p) => `<option value="${esc(p.slug)}">${esc(p.name || p.company_name)}</option>`).join('');
      $('ppProviderSelect').value = state.user.workspace || '';
    }
    document.title = `${prov} · ObraBuilder`;
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
    view.innerHTML = `<p class="pp-error" role="alert">${esc(err.message || 'Could not load ObraBuilder.')}</p>`;
  });
})();
