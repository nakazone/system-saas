/**
 * Agenda — no estilo do Calendário da Apple.
 * Computador / tablet: Dia · Semana · Mês · Ano, busca, barra lateral de calendários e detalhe em balão.
 * Celular: meses em rolagem contínua com pílulas, dia com linha do tempo e detalhe em folha.
 * Eventos: jobs (WorkOrder), visitas (Meeting ligado a um lead) e compromissos (Meeting).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) =>
    String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m, t) => window.crmToast && window.crmToast.show(m, { type: t || 'info' });
  const isPhone = () => window.matchMedia('(max-width: 767px)').matches;
  const DAY = 86400000;
  const HOUR_PX = 52;
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const MON3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const WD1 = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const WDL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const startOfWeek = (d) => addDays(sod(d), -d.getDay());
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseYmd = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const fmtTime = (d) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const ap = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
  };
  const fmtHour = (h) => (h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`);
  const fmtDateLong = (d) => `${WDL[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`;
  const fmtDateShort = (d) => `${d.getDate()} ${MON3[d.getMonth()]}`;

  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(v, 16);
    if (!/^[0-9a-f]{6}$/i.test(v)) return [232, 121, 44];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const tint = (hex, a) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  const shade = (hex, f) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  };

  async function api(url, opts) {
    const o = Object.assign({ credentials: 'include', cache: 'no-store' }, opts || {});
    if (o.body && typeof o.body !== 'string') {
      o.body = JSON.stringify(o.body);
      o.headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    }
    const r = await fetch(url, o);
    if (r.status === 401) {
      location.href = '/login.html';
      throw new Error('Sessão expirada');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = new Error(j.message || j.error || 'Não foi possível concluir.');
      e.status = r.status;
      throw e;
    }
    return j;
  }

  // ---------------------------------------------------------------- types
  const TYPES = {
    job: { label: 'Jobs', one: 'Job', color: '#e8792c' },
    visit: { label: 'Visitas', one: 'Visita', color: '#7a5ea8' },
    meeting: { label: 'Compromissos', one: 'Compromisso', color: '#3b6ea5' },
  };
  const JOB_STATUS = { draft: 'Rascunho', scheduled: 'Agendado', in_progress: 'Em andamento', completed: 'Concluído', canceled: 'Cancelado' };
  const FIELD_STATUS = { en_route: 'A caminho', on_site: 'No local', completed: 'Finalizado no campo' };
  const MTG_STATUS = { scheduled: 'Agendado', completed: 'Concluído', canceled: 'Cancelado' };

  /** Calendar list for the sidebar / forms — mirrors Configurações › Agenda. */
  function calList() {
    const fallback = [
      { id: 'jobs', name: 'Jobs', color: TYPES.job.color, kind: 'jobs', sector: 'all' },
      { id: 'visits', name: 'Visitas', color: TYPES.visit.color, kind: 'visits' },
      { id: 'meetings', name: 'Meetings', color: TYPES.meeting.color, kind: 'meetings' },
    ];
    const cfg = S.calendars.length ? S.calendars : fallback;
    const pt = (c) => (c.kind === 'meetings' && /^meetings?$/i.test(c.name) ? 'Compromissos' : c.name);
    return cfg.map((c) => ({
      id: c.id,
      name: pt(c),
      color: c.color,
      kind: c.kind,
      sector: c.sector || (c.kind === 'jobs' ? 'all' : undefined),
    }));
  }
  const calOf = (e) => calList().find((c) => c.id === e.calendar) || { name: TYPES[e.type].one, color: e.color };
  const SECTOR_LBL = { installation: 'Instalação', sand_finish: 'Lixa' };
  const CAL_KINDS = [
    { id: 'jobs', label: 'Jobs' },
    { id: 'visits', label: 'Visitas' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'custom', label: 'Extra' },
  ];
  const CAL_SECTORS = [
    { id: 'all', label: 'Todos' },
    { id: 'installation', label: 'Instalação' },
    { id: 'sand_finish', label: 'Lixa' },
  ];
  let calDraft = null;
  let calSheetMode = 'filter'; // 'filter' | 'edit'

  function canEditCals() {
    const perms = (S.me && S.me.permissions) || [];
    const role = String((S.me && (S.me.role || S.me.roleKey)) || '').toLowerCase();
    return perms.includes('settings.manage') || perms.includes('*') || role === 'admin';
  }

  function newCalId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (ch) => {
          const r = (Math.random() * 16) | 0;
          const v = ch === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  }

  function cloneCalDraft(list) {
    return (list || []).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      kind: c.kind || 'custom',
      sector: c.kind === 'jobs' ? c.sector || 'all' : undefined,
    }));
  }

  function ensureCalDraft() {
    if (!canEditCals()) {
      calDraft = null;
      return null;
    }
    if (!calDraft) calDraft = cloneCalDraft(calList());
    return calDraft;
  }

  // ---------------------------------------------------------------- state
  const S = {
    view: 'month',
    cursor: sod(new Date()),
    selected: sod(new Date()),
    events: [],
    loaded: null, // {from, to}
    loading: null,
    me: null,
    canManage: false,
    users: [],
    sidebar: false,
    filters: { types: { job: true, visit: true, meeting: true }, cals: {}, users: null, mine: false },
    calendars: [], // Configurações › Agenda: jobs, meetings + custom agendas (visits are built in)
    mmode: 'month', // phone: month | day
    mRange: null, // phone months rendered {from: Date(1st), to: Date(1st)}
    searchPool: null,
    pendingEvent: null,
  };

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('om_agenda_prefs') || '{}');
      if (p.view && ['day', 'week', 'month', 'year'].includes(p.view)) S.view = p.view;
      if (typeof p.sidebar === 'boolean') S.sidebar = p.sidebar;
      else S.sidebar = window.innerWidth >= 1280;
      if (p.types) Object.assign(S.filters.types, p.types);
      if (p.cals && typeof p.cals === 'object') S.filters.cals = p.cals;
      if (Array.isArray(p.users)) S.filters.users = new Set(p.users);
      if (p.mine) S.filters.mine = true;
    } catch (_) {
      S.sidebar = window.innerWidth >= 1280;
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(
        'om_agenda_prefs',
        JSON.stringify({ view: S.view, sidebar: S.sidebar, types: S.filters.types, cals: S.filters.cals, users: S.filters.users ? Array.from(S.filters.users) : null, mine: S.filters.mine })
      );
    } catch (_) {}
  }

  // ---------------------------------------------------------------- data
  function normalize(raw) {
    const start = new Date(raw.start);
    let end = new Date(raw.end || raw.start);
    if (!(end > start)) end = new Date(start.getTime() + 3600e3);
    const type = TYPES[raw.type] ? raw.type : 'meeting';
    const m = raw.meta || {};
    const calendar = String(raw.calendar_id || (type === 'job' ? 'jobs' : type === 'visit' ? 'visits' : m.calendar_id || 'meetings'));
    const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || '')) ? raw.color : type === 'job' ? (m.crew && m.crew.color) || TYPES.job.color : TYPES[type].color;
    const lastDay = sod(new Date(end.getTime() - 1));
    const multi = !sameDay(start, lastDay);
    const assignees = [];
    if (m.assigned_user_id) assignees.push(String(m.assigned_user_id));
    (m.members || []).forEach((x) => x.user_id && assignees.push(String(x.user_id)));
    return {
      id: String(raw.id),
      type,
      calendar,
      title: raw.title || TYPES[type].one,
      status: raw.status,
      start,
      end,
      lastDay,
      allDay: multi,
      color,
      meta: m,
      assignees,
      address: m.address || m.location || (m.lead && m.lead.address) || '',
    };
  }

  function ensureRange(from, to) {
    if (S.loaded && from >= S.loaded.from && to <= S.loaded.to) return Promise.resolve();
    const f = S.loaded ? new Date(Math.min(from, S.loaded.from)) : from;
    const t = S.loaded ? new Date(Math.max(to, S.loaded.to)) : to;
    return fetchRange(f, t);
  }
  async function fetchRange(from, to) {
    const j = await api(`/api/schedule/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    S.events = (j.data || []).map(normalize);
    S.loaded = { from, to };
    S.searchPool = null;
  }
  async function reload() {
    if (!S.loaded) return;
    await fetchRange(S.loaded.from, S.loaded.to);
    render();
  }

  function visible(e) {
    if (S.filters.cals[e.calendar] === false) return false;
    if (S.filters.mine && S.me && !e.assignees.includes(String(S.me.id))) return false;
    if (S.filters.users && S.filters.users.size) {
      if (!e.assignees.some((a) => S.filters.users.has(a)) && !(S.filters.users.has('none') && !e.assignees.length)) return false;
    }
    return true;
  }
  const evs = () => S.events.filter(visible);
  const eventsOnDay = (d) => {
    const a = sod(d);
    const b = addDays(a, 1);
    return evs()
      .filter((e) => e.start < b && e.end > a)
      .sort((x, y) => (y.allDay - x.allDay) || x.start - y.start);
  };

  // ---------------------------------------------------------------- layout helpers
  /** Multi-day bars inside a week row: lanes assigned greedily. */
  function weekBars(weekStart, days) {
    const weekEnd = addDays(weekStart, days);
    const bars = evs()
      .filter((e) => e.allDay && e.start < weekEnd && e.end > weekStart)
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .map((e) => {
        const s = Math.max(0, Math.round((sod(e.start) - weekStart) / DAY));
        const en = Math.min(days - 1, Math.round((e.lastDay - weekStart) / DAY));
        return { e, s, en, contL: e.start < weekStart, contR: e.lastDay >= weekEnd };
      });
    const lanes = [];
    bars.forEach((b) => {
      let lane = lanes.findIndex((l) => l.every((x) => x.en < b.s || x.s > b.en));
      if (lane < 0) {
        lanes.push([]);
        lane = lanes.length - 1;
      }
      lanes[lane].push(b);
      b.lane = lane;
    });
    return { bars, lanes: lanes.length };
  }

  /** Side-by-side columns for overlapping timed events of one day. */
  function packDay(list, dayStart) {
    const dayEnd = addDays(dayStart, 1);
    const items = list
      .map((e) => {
        const s = Math.max(e.start, dayStart);
        const en = Math.min(e.end, dayEnd);
        return { e, top: (s - dayStart) / 3600e3, bottom: Math.max((en - dayStart) / 3600e3, (s - dayStart) / 3600e3 + 0.42) };
      })
      .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
      const cols = [];
      cluster.forEach((it) => {
        let c = cols.findIndex((col) => col[col.length - 1].bottom <= it.top + 0.001);
        if (c < 0) {
          cols.push([]);
          c = cols.length - 1;
        }
        cols[c].push(it);
        it.col = c;
      });
      cluster.forEach((it) => (it.cols = cols.length));
      cluster = [];
    };
    items.forEach((it) => {
      if (cluster.length && it.top >= clusterEnd) flush();
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.bottom);
    });
    if (cluster.length) flush();
    return items;
  }

  const evStyle = (e) => `--ev:${e.color};--ev-bg:${tint(e.color, 0.16)};--ev-bg2:${tint(e.color, 0.26)};--ev-ink:${shade(e.color, 0.62)}`;
  const typeIcon = (e) =>
    e.type === 'job'
      ? '<svg viewBox="0 0 24 24"><path d="M4 8h16v11H4z"/><path d="M9 8V5h6v3"/></svg>'
      : e.type === 'visit'
        ? '<svg viewBox="0 0 24 24"><path d="M12 21s-6-5.3-6-10a6 6 0 0112 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>'
        : '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/></svg>';

  // ---------------------------------------------------------------- render
  function render() {
    const root = $('#ag');
    const phone = isPhone();
    root.classList.toggle('is-phone', phone);
    root.dataset.view = phone ? (S.view === 'year' ? 'year' : S.mmode === 'day' ? 'mday' : 'mmonth') : S.view;
    $$('.ag-seg [data-ag-view]').forEach((b) => b.classList.toggle('is-on', b.dataset.agView === S.view));
    const side = $('#agSide');
    side.hidden = phone || !S.sidebar;
    if (!side.hidden) renderSide();
    renderTitle();
    if (phone) {
      if (S.view === 'year') renderYear();
      else if (S.mmode === 'day') renderMDay();
      else renderMMonth();
    } else if (S.view === 'day') renderTimeGrid(1);
    else if (S.view === 'week') renderTimeGrid(7);
    else if (S.view === 'year') renderYear();
    else if (S.view === 'list') renderList();
    else renderMonth();
  }

  function renderTitle() {
    const c = S.cursor;
    const t = $('#agTitle');
    const back = $('#agMBackLabel');
    if (isPhone()) {
      if (S.view === 'year') {
        t.innerHTML = `${c.getFullYear()}`;
        back.textContent = 'Hoje';
      } else if (S.mmode === 'day') {
        t.innerHTML = `${WDL[S.selected.getDay()]}, <span>${S.selected.getDate()} de ${MONTHS[S.selected.getMonth()].toLowerCase()}</span>`;
        back.textContent = MONTHS[S.selected.getMonth()];
      } else {
        t.innerHTML = MONTHS[c.getMonth()];
        back.textContent = String(c.getFullYear());
      }
      return;
    }
    if (S.view === 'year') t.innerHTML = `<b>${c.getFullYear()}</b>`;
    else if (S.view === 'day') t.innerHTML = `<b>${c.getDate()} de ${MONTHS[c.getMonth()].toLowerCase()}</b> ${c.getFullYear()} <small>${WDL[c.getDay()]}</small>`;
    else if (S.view === 'week') {
      const a = startOfWeek(c);
      const b = addDays(a, 6);
      t.innerHTML =
        a.getMonth() === b.getMonth()
          ? `<b>${MONTHS[a.getMonth()]}</b> ${a.getFullYear()}`
          : `<b>${MONTHS[a.getMonth()].slice(0, 3)} – ${MONTHS[b.getMonth()].slice(0, 3)}</b> ${b.getFullYear()}`;
    } else if (S.view === 'list') t.innerHTML = '<b>Próximos eventos</b>';
    else t.innerHTML = `<b>${MONTHS[c.getMonth()]}</b> ${c.getFullYear()}`;
  }

  // ---------- desktop month
  function renderMonth() {
    const c = S.cursor;
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
    const weeks = Math.ceil((last.getDate() + first.getDay()) / 7);
    const stage = $('#agStage');
    const h = Math.max(420, stage.getBoundingClientRect().height || window.innerHeight - 200);
    const rowH = (h - 34) / weeks;
    const slots = Math.max(1, Math.floor((rowH - 32) / 21));
    const today = sod(new Date());
    let html = `<div class="ag-month" style="--weeks:${weeks}"><div class="ag-month__wd">${WD.map((w, i) => `<div class="${i === 0 || i === 6 ? 'is-we' : ''}">${w}</div>`).join('')}</div>`;
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(gridStart, w * 7);
      const { bars, lanes } = weekBars(ws, 7);
      html += `<div class="ag-week">`;
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        const out = d.getMonth() !== c.getMonth();
        const isT = sameDay(d, today);
        const timed = eventsOnDay(d).filter((e) => !e.allDay);
        const laneUse = bars.filter((b) => b.s <= i && b.en >= i).reduce((m, b) => Math.max(m, b.lane + 1), 0);
        const room = Math.max(0, slots - Math.min(lanes, slots));
        const show = timed.length > room ? timed.slice(0, Math.max(0, room - 1)) : timed;
        const hidden = timed.length - show.length + bars.filter((b) => b.lane >= slots && b.s <= i && b.en >= i).length;
        html += `<div class="ag-day${out ? ' is-out' : ''}${i === 0 || i === 6 ? ' is-we' : ''}" data-ag-day="${ymd(d)}">
          <div class="ag-day__n"><span class="${isT ? 'is-today' : ''}">${d.getDate() === 1 && !isT ? `${MON3[d.getMonth()]} ${d.getDate()}` : d.getDate()}</span></div>
          <div class="ag-day__list" style="margin-top:${Math.min(lanes, slots) * 21}px">${show
            .map(
              (e) => `<button type="button" class="ag-row" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i></i><span>${esc(e.title)}</span><time>${esc(fmtTime(e.start))}</time></button>`
            )
            .join('')}${hidden > 0 ? `<button type="button" class="ag-more" data-ag-goday="${ymd(d)}">+${hidden} mais</button>` : ''}</div>
        </div>`;
        void laneUse;
      }
      html += `<div class="ag-bars">${bars
        .filter((b) => b.lane < slots)
        .map(
          (b) => `<button type="button" class="ag-bar${b.contL ? ' cont-l' : ''}${b.contR ? ' cont-r' : ''}" data-ag-ev="${esc(b.e.id)}" style="${evStyle(b.e)};--s:${b.s};--n:${b.en - b.s + 1};--lane:${b.lane}">
            <span class="ag-bar__ic">${typeIcon(b.e)}</span><span>${esc(b.e.title)}</span></button>`
        )
        .join('')}</div></div>`;
    }
    html += '</div>';
    stage.innerHTML = html;
  }

  // ---------- desktop day / week
  function renderTimeGrid(n) {
    const start = n === 1 ? sod(S.cursor) : startOfWeek(S.cursor);
    const days = Array.from({ length: n }, (_, i) => addDays(start, i));
    const today = sod(new Date());
    const { bars, lanes } = weekBars(start, n);
    const allH = Math.max(1, lanes) * 22 + 8;
    let head = `<div class="ag-tg__head" style="--n:${n}"><div class="ag-tg__gutter"></div>${days
      .map((d) => {
        const isT = sameDay(d, today);
        return `<button type="button" class="ag-tg__dh${isT ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-we' : ''}" data-ag-goday="${ymd(d)}"><span>${WD[d.getDay()]}</span><b>${d.getDate()}</b></button>`;
      })
      .join('')}</div>
      <div class="ag-tg__all" style="--n:${n};height:${allH}px"><div class="ag-tg__gutter"><small>dia inteiro</small></div><div class="ag-tg__allin">${bars
        .map(
          (b) => `<button type="button" class="ag-bar${b.contL ? ' cont-l' : ''}${b.contR ? ' cont-r' : ''}" data-ag-ev="${esc(b.e.id)}" style="${evStyle(b.e)};--s:${b.s};--n:${b.en - b.s + 1};--lane:${b.lane};--cols:${n}"><span class="ag-bar__ic">${typeIcon(b.e)}</span><span>${esc(b.e.title)}</span></button>`
        )
        .join('')}</div></div>`;
    let grid = `<div class="ag-tg__scroll" id="agScroll"><div class="ag-tg__grid" style="--n:${n};height:${24 * HOUR_PX}px"><div class="ag-tg__hours">${Array.from(
      { length: 24 },
      (_, h) => `<div style="top:${h * HOUR_PX}px">${h ? esc(fmtHour(h)) : ''}</div>`
    ).join('')}</div>`;
    days.forEach((d, i) => {
      const list = eventsOnDay(d).filter((e) => !e.allDay);
      const packed = packDay(list, d);
      grid += `<div class="ag-tg__col${d.getDay() === 0 || d.getDay() === 6 ? ' is-we' : ''}" data-ag-col="${ymd(d)}" style="--i:${i}">${packed
        .map((p) => {
          const e = p.e;
          const h = (p.bottom - p.top) * HOUR_PX;
          return `<button type="button" class="ag-blk${h < 34 ? ' is-short' : ''}${e.status === 'completed' ? ' is-done' : ''}" data-ag-ev="${esc(e.id)}" style="${evStyle(e)};top:${p.top * HOUR_PX}px;height:${h - 2}px;left:calc(${(p.col / p.cols) * 100}% + 2px);width:calc(${100 / p.cols}% - 4px)">
            <b>${esc(e.title)}</b>${h >= 34 ? `<small>${esc(fmtTime(e.start))}${e.address ? ' · ' + esc(e.address) : ''}</small>` : ''}</button>`;
        })
        .join('')}${sameDay(d, today) ? `<div class="ag-now" style="top:${((Date.now() - d) / 3600e3) * HOUR_PX}px"></div>` : ''}</div>`;
    });
    grid += '</div></div>';
    let aside = '';
    if (n === 1) aside = dayAsideHtml(start);
    $('#agStage').innerHTML = `<div class="ag-tg${n === 1 ? ' ag-tg--day' : ''}"><div class="ag-tg__main">${head}${grid}</div>${aside}</div>`;
    const sc = $('#agScroll');
    if (sc) {
      const firsts = days.flatMap((d) => eventsOnDay(d).filter((e) => !e.allDay && sameDay(e.start, d)).map((e) => e.start.getHours()));
      const anchor = Math.min(7, firsts.length ? Math.min(...firsts) : 7);
      sc.scrollTop = Math.max(0, (anchor - 0.5) * HOUR_PX);
    }
  }

  function miniMonthHtml(month, opts) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gs = startOfWeek(first);
    const today = sod(new Date());
    const counts = {};
    if (opts && opts.dots)
      evs().forEach((e) => {
        for (let d = sod(e.start); d <= e.lastDay; d = addDays(d, 1)) counts[ymd(d)] = (counts[ymd(d)] || 0) + 1;
      });
    let html = `<div class="ag-mini${opts && opts.cls ? ' ' + opts.cls : ''}">${opts && opts.title !== false ? `<button type="button" class="ag-mini__t" data-ag-gomonth="${ymd(first)}">${opts && opts.short ? MONTHS[month.getMonth()].slice(0, 3) : MONTHS[month.getMonth()] + (opts && opts.year ? ' ' + month.getFullYear() : '')}</button>` : ''}<div class="ag-mini__g">${WD1.map((w) => `<span class="ag-mini__wd">${w}</span>`).join('')}`;
    for (let i = 0; i < 42; i++) {
      const d = addDays(gs, i);
      if (i >= 35 && d.getMonth() !== month.getMonth()) break;
      const out = d.getMonth() !== month.getMonth();
      const k = ymd(d);
      html += `<button type="button" class="ag-mini__d${out ? ' is-out' : ''}${sameDay(d, today) ? ' is-today' : ''}${sameDay(d, S.selected) && !out ? ' is-sel' : ''}${counts[k] && !out ? ' has-ev' : ''}" data-ag-goday="${k}">${out && opts && opts.hideOut ? '' : d.getDate()}</button>`;
    }
    return html + '</div></div>';
  }

  function dayAsideHtml(d) {
    const list = eventsOnDay(d);
    const stops = list.filter((e) => e.address);
    const maps = stops.length ? 'https://www.google.com/maps/dir/' + stops.map((e) => encodeURIComponent(e.address)).join('/') : '';
    return `<aside class="ag-dayside">${miniMonthHtml(d, { dots: true, year: true })}
      <div class="ag-dayside__list"><h3>${esc(fmtDateLong(d))}</h3>${
        list.length
          ? list
              .map(
                (e) => `<button type="button" class="ag-li" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i></i><div><b>${esc(e.title)}</b><small>${esc(
                  e.allDay ? 'Dia inteiro' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`
                )}${e.address ? ' · ' + esc(e.address) : ''}</small></div></button>`
              )
              .join('')
          : '<p class="ag-empty">Nada agendado.</p>'
      }${maps ? `<a class="ag-btn ag-btn--block" href="${esc(maps)}" target="_blank" rel="noopener">Rota do dia no Google Maps</a>` : ''}</div></aside>`;
  }

  // ---------- year
  function renderYear() {
    const y = S.cursor.getFullYear();
    let html = `<div class="ag-year">`;
    for (let m = 0; m < 12; m++) html += miniMonthHtml(new Date(y, m, 1), { dots: true, cls: 'ag-mini--year', hideOut: true, short: isPhone() });
    $('#agStage').innerHTML = html + '</div>';
  }

  // ---------- list
  function renderList() {
    const from = sod(new Date());
    const groups = [];
    for (let i = 0; i < 60; i++) {
      const d = addDays(from, i);
      const l = eventsOnDay(d);
      if (l.length) groups.push([d, l]);
    }
    $('#agStage').innerHTML = `<div class="ag-list">${
      groups.length
        ? groups
            .map(
              ([d, l]) => `<section><h3 class="${sameDay(d, from) ? 'is-today' : ''}">${esc(fmtDateLong(d))}</h3>${l
                .map(
                  (e) => `<button type="button" class="ag-li" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i></i><time>${esc(e.allDay ? 'dia inteiro' : fmtTime(e.start))}</time><div><b>${esc(e.title)}</b><small>${esc(
                    [TYPES[e.type].one, e.address].filter(Boolean).join(' · ')
                  )}</small></div></button>`
                )
                .join('')}</section>`
            )
            .join('')
        : '<p class="ag-empty">Nada nos próximos 60 dias.</p>'
    }</div>`;
  }

  // ---------- sidebar
  function renderSide() {
    const counts = {};
    S.events.forEach((e) => (counts[e.calendar] = (counts[e.calendar] || 0) + 1));
    const people = new Map();
    S.users.forEach((u) => people.set(String(u.id), u.name || u.email));
    S.events.forEach((e) => {
      const m = e.meta;
      if (m.assigned_user && m.assigned_user.id) people.set(String(m.assigned_user.id), m.assigned_user.name);
      (m.members || []).forEach((x) => x.user_id && people.set(String(x.user_id), x.name || x.email));
    });
    const sel = S.filters.users;
    $('#agSide').innerHTML = `${miniMonthHtml(S.cursor, { dots: true, year: true })}
      <div class="ag-side__sec"><h3>Calendários ${
        canEditCals() ? '<button type="button" class="ag-link" data-ag-act="mcal" data-ag-cal-open="edit">Editar</button>' : ''
      }</h3>${calList()
        .map(
          (c) => `<label class="ag-check" style="--c:${esc(c.color)}"><input type="checkbox" data-ag-cal="${esc(c.id)}" ${S.filters.cals[c.id] !== false ? 'checked' : ''}/><span class="ag-check__box"></span>${esc(c.name)}<small>${counts[c.id] || ''}</small></label>`
        )
        .join('')}${
        canEditCals()
          ? `<button type="button" class="ag-side__add" data-ag-act="mcal" data-ag-cal-open="add">+ Adicionar calendário</button>`
          : ''
      }</div>
      <div class="ag-side__sec"><h3>Pessoas <button type="button" class="ag-link" data-ag-users-all ${!sel || !sel.size ? 'hidden' : ''}>Todas</button></h3>
        ${S.me ? `<label class="ag-check" style="--c:#211d1a"><input type="checkbox" data-ag-mine ${S.filters.mine ? 'checked' : ''}/><span class="ag-check__box"></span>Só os meus</label>` : ''}
        ${Array.from(people.entries())
          .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
          .map(
            ([id, name]) => `<label class="ag-check ag-check--person" style="--c:#8a8074"><input type="checkbox" data-ag-user="${esc(id)}" ${sel && sel.has(id) ? 'checked' : ''}/><span class="ag-check__box"></span>${esc(name || 'Sem nome')}</label>`
          )
          .join('')}</div>`;
  }

  // ---------- phone month (continuous scroll)
  function renderMMonth(keepScroll) {
    if (!S.mRange) S.mRange = { from: addMonths(S.cursor, -3), to: addMonths(S.cursor, 9) };
    const stage = $('#agStage');
    let html = `<div class="ag-mwd">${WD1.map((w, i) => `<span class="${i === 0 || i === 6 ? 'is-we' : ''}">${w}</span>`).join('')}</div><div class="ag-mscroll" id="agMScroll">`;
    for (let m = new Date(S.mRange.from); m <= S.mRange.to; m = addMonths(m, 1)) html += mMonthHtml(m);
    html += '</div>';
    const prev = $('#agMScroll');
    const prevTop = prev ? prev.scrollTop : 0;
    const prevH = prev ? prev.scrollHeight : 0;
    stage.innerHTML = html;
    const sc = $('#agMScroll');
    if (keepScroll === 'prepend') sc.scrollTop = prevTop + (sc.scrollHeight - prevH);
    else if (keepScroll) sc.scrollTop = prevTop;
    else scrollMMonthTo(S.cursor, false);
    bindMScroll();
  }

  function mMonthHtml(m) {
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const lead = first.getDay();
    const weeks = Math.ceil((daysIn + lead) / 7);
    const today = sod(new Date());
    let html = `<section class="ag-mm" data-ag-month="${ymd(first)}"><h2 class="ag-mm__t" style="--col:${lead}"><span>${MONTHS[m.getMonth()].slice(0, 3)}</span></h2>`;
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(first, w * 7 - lead);
      const { bars } = weekBars(ws, 7);
      const maxLanes = 3;
      html += `<div class="ag-mw">`;
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        const inMonth = d.getMonth() === m.getMonth();
        if (!inMonth) {
          html += '<div class="ag-md is-blank"></div>';
          continue;
        }
        const timed = eventsOnDay(d).filter((e) => !e.allDay);
        const laneCount = Math.min(maxLanes, bars.filter((b) => b.s <= i && b.en >= i).reduce((mx, b) => Math.max(mx, b.lane + 1), 0));
        const lanesAll = bars.reduce((mx, b) => Math.max(mx, b.lane + 1), 0);
        const room = Math.max(0, maxLanes - Math.min(lanesAll, maxLanes));
        const show = timed.slice(0, room);
        const more = timed.length - show.length + bars.filter((b) => b.lane >= maxLanes && b.s <= i && b.en >= i).length;
        void laneCount;
        html += `<div class="ag-md${i === 0 || i === 6 ? ' is-we' : ''}" data-ag-mday="${ymd(d)}" role="button" tabindex="0"><span class="ag-md__n${sameDay(d, today) ? ' is-today' : ''}">${d.getDate()}</span>
          <span class="ag-md__list" style="margin-top:${Math.min(lanesAll, maxLanes) * 19}px">${show
            .map((e) => `<button type="button" class="ag-pill" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i>${typeIcon(e)}</i><span>${esc(e.title)}</span></button>`)
            .join('')}${more > 0 ? `<button type="button" class="ag-pill ag-pill--more" data-ag-daylist="${ymd(d)}">+${more}</button>` : ''}</span></div>`;
      }
      html += `<div class="ag-bars ag-bars--m">${bars
        .filter((b) => b.lane < maxLanes)
        .map((b) => {
          // Keep the bar inside this month's days.
          let s = b.s;
          let en = b.en;
          while (s <= en && addDays(ws, s).getMonth() !== m.getMonth()) s++;
          while (en >= s && addDays(ws, en).getMonth() !== m.getMonth()) en--;
          if (en < s) return '';
          return `<button type="button" class="ag-bar${b.contL || s > b.s ? ' cont-l' : ''}${b.contR || en < b.en ? ' cont-r' : ''}" data-ag-ev="${esc(b.e.id)}" style="${evStyle(b.e)};--s:${s};--n:${en - s + 1};--lane:${b.lane}"><span class="ag-bar__ic">${typeIcon(b.e)}</span><span>${esc(b.e.title)}</span></button>`;
        })
        .join('')}</div></div>`;
    }
    return html + '</section>';
  }

  function scrollMMonthTo(month, smooth) {
    const sc = $('#agMScroll');
    const sec = sc && sc.querySelector(`[data-ag-month="${ymd(new Date(month.getFullYear(), month.getMonth(), 1))}"]`);
    if (sec) sc.scrollTo({ top: relTop(sec, sc) - 2, behavior: smooth ? 'smooth' : 'auto' });
  }

  const relTop = (el, sc) => el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  let mScrollBound = null;
  function bindMScroll() {
    const sc = $('#agMScroll');
    if (!sc) return;
    let ticking = false;
    sc.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(async () => {
        ticking = false;
        // Title follows the month in view.
        const secs = $$('.ag-mm', sc);
        const top = sc.scrollTop + 40;
        let cur = secs[0];
        secs.forEach((s) => {
          if (relTop(s, sc) <= top) cur = s;
        });
        if (cur) {
          const d = parseYmd(cur.dataset.agMonth);
          if (d && (d.getMonth() !== S.cursor.getMonth() || d.getFullYear() !== S.cursor.getFullYear())) {
            S.cursor = d;
            renderTitle();
          }
        }
        if (mScrollBound) return;
        if (sc.scrollTop < 300) {
          mScrollBound = true;
          S.mRange.from = addMonths(S.mRange.from, -6);
          await ensureRange(S.mRange.from, addMonths(S.mRange.to, 1)).catch(() => {});
          renderMMonth('prepend');
          mScrollBound = null;
        } else if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 400) {
          mScrollBound = true;
          S.mRange.to = addMonths(S.mRange.to, 6);
          await ensureRange(S.mRange.from, addMonths(S.mRange.to, 1)).catch(() => {});
          renderMMonth(true);
          mScrollBound = null;
        }
      });
    });
  }

  // ---------- phone day
  function renderMDay() {
    const d = S.selected;
    const ws = startOfWeek(d);
    const today = sod(new Date());
    const list = eventsOnDay(d);
    const all = list.filter((e) => e.allDay);
    const packed = packDay(list.filter((e) => !e.allDay), d);
    let html = `<div class="ag-strip">${Array.from({ length: 7 }, (_, i) => {
      const x = addDays(ws, i);
      const has = eventsOnDay(x).length;
      return `<button type="button" class="ag-strip__d${sameDay(x, d) ? ' is-sel' : ''}${sameDay(x, today) ? ' is-today' : ''}" data-ag-strip="${ymd(x)}"><small>${WD1[i]}</small><b>${x.getDate()}</b><i class="${has ? 'has' : ''}"></i></button>`;
    }).join('')}</div>`;
    html += `<div class="ag-mday" id="agMDay">${
      all.length
        ? `<div class="ag-mday__all">${all
            .map((e) => `<button type="button" class="ag-pill ag-pill--wide" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i>${typeIcon(e)}</i><span>${esc(e.title)}</span><small>${esc(fmtDateShort(e.start))} – ${esc(fmtDateShort(e.lastDay))}</small></button>`)
            .join('')}</div>`
        : ''
    }<div class="ag-mday__scroll" id="agScroll"><div class="ag-mday__grid" style="height:${24 * HOUR_PX}px">${Array.from(
      { length: 24 },
      (_, h) => `<div class="ag-mday__h" style="top:${h * HOUR_PX}px"><span>${h ? esc(fmtHour(h)) : ''}</span></div>`
    ).join('')}<div class="ag-mday__col" data-ag-col="${ymd(d)}">${packed
      .map((p) => {
        const e = p.e;
        const h = (p.bottom - p.top) * HOUR_PX;
        return `<button type="button" class="ag-blk${h < 34 ? ' is-short' : ''}" data-ag-ev="${esc(e.id)}" style="${evStyle(e)};top:${p.top * HOUR_PX}px;height:${h - 2}px;left:calc(${(p.col / p.cols) * 100}% + 2px);width:calc(${100 / p.cols}% - 4px)"><b>${esc(e.title)}</b>${
          h >= 34 ? `<small>${esc(fmtTime(e.start))}${e.address ? ' · ' + esc(e.address) : ''}</small>` : ''
        }</button>`;
      })
      .join('')}${sameDay(d, today) ? `<div class="ag-now" style="top:${((Date.now() - d) / 3600e3) * HOUR_PX}px"></div>` : ''}</div></div></div>
      ${!list.length ? '<p class="ag-empty ag-empty--float">Nada agendado neste dia.</p>' : ''}</div>`;
    $('#agStage').innerHTML = html;
    const sc = $('#agScroll');
    const firsts = packed.map((p) => p.top);
    sc.scrollTop = Math.max(0, (Math.min(7, firsts.length ? Math.min(...firsts) : 7) - 0.5) * HOUR_PX);
    // Swipe left / right to change day.
    let x0 = null;
    const box = $('#agMDay');
    box.addEventListener('touchstart', (ev) => (x0 = ev.touches[0].clientX), { passive: true });
    box.addEventListener(
      'touchend',
      (ev) => {
        if (x0 == null) return;
        const dx = ev.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 60) goDay(addDays(S.selected, dx < 0 ? 1 : -1));
      },
      { passive: true }
    );
  }

  async function goDay(d) {
    S.selected = sod(d);
    S.cursor = sod(d);
    await ensureRange(addDays(startOfWeek(d), -7), addDays(startOfWeek(d), 14)).catch(() => {});
    render();
  }

  // ---------------------------------------------------------------- navigation
  function rangeFor() {
    const c = S.cursor;
    if (isPhone()) {
      if (S.view === 'year') return [new Date(c.getFullYear(), 0, 1), new Date(c.getFullYear() + 1, 0, 1)];
      const r = S.mRange || { from: addMonths(c, -3), to: addMonths(c, 9) };
      return [startOfWeek(r.from), addDays(addMonths(r.to, 1), 7)];
    }
    if (S.view === 'year') return [new Date(c.getFullYear(), 0, 1), new Date(c.getFullYear() + 1, 0, 1)];
    if (S.view === 'list') return [sod(new Date()), addDays(sod(new Date()), 61)];
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    return [addDays(startOfWeek(first), -7), addDays(startOfWeek(addMonths(first, 1)), 14)];
  }

  async function go() {
    const [a, b] = rangeFor();
    try {
      await ensureRange(a, b);
    } catch (e) {
      toast(e.message, 'error');
    }
    render();
    syncUrl();
  }

  function step(dir) {
    const c = S.cursor;
    if (S.view === 'day') S.cursor = addDays(c, dir);
    else if (S.view === 'week') S.cursor = addDays(c, dir * 7);
    else if (S.view === 'year') S.cursor = new Date(c.getFullYear() + dir, c.getMonth(), 1);
    else S.cursor = addMonths(c, dir);
    if (S.view === 'day') S.selected = S.cursor;
    go();
  }

  function setView(v) {
    S.view = v;
    if (v !== 'list') savePrefs();
    closePop();
    go();
  }

  function syncUrl() {
    try {
      const u = new URL(location.href);
      u.searchParams.set('date', ymd(isPhone() && S.mmode === 'day' ? S.selected : S.cursor));
      if (!isPhone()) u.searchParams.set('view', S.view);
      ['focus', 'new', 'event'].forEach((k) => u.searchParams.delete(k));
      history.replaceState(null, '', u.toString());
    } catch (_) {}
  }

  // ---------------------------------------------------------------- detail
  const findEv = (id) => S.events.find((e) => e.id === String(id)) || (S.searchPool || []).find((e) => e.id === String(id));

  function whenText(e) {
    if (e.allDay) {
      const days = Math.round((e.lastDay - sod(e.start)) / DAY) + 1;
      return {
        date: `${fmtDateShort(e.start)} – ${fmtDateShort(e.lastDay)} ${e.lastDay.getFullYear()}`,
        time: `${days} dias · começa ${fmtTime(e.start)}, termina ${fmtTime(e.end)}`,
      };
    }
    return { date: fmtDateLong(e.start), time: `${fmtTime(e.start)} – ${fmtTime(e.end)}` };
  }

  function statusText(e) {
    if (e.type === 'job') {
      const f = FIELD_STATUS[e.meta.field_status];
      return [JOB_STATUS[e.status] || e.status, f].filter(Boolean).join(' · ');
    }
    return MTG_STATUS[e.status] || e.status;
  }

  function contactOf(e) {
    const m = e.meta;
    if (e.type === 'visit' && m.lead) return { name: m.lead.name, phone: m.lead.phone, email: m.lead.email, href: `lead-detail.html?id=${encodeURIComponent(m.lead.id)}`, hrefLabel: 'Abrir lead' };
    if (e.type === 'job') {
      const c = m.customer || {};
      const name = c.name || (m.builder && (m.builder.company || m.builder.name)) || m.source_name;
      return { name, phone: c.phone, email: c.email, href: `job-detail.html?id=${encodeURIComponent(e.id)}`, hrefLabel: `Abrir job${m.number ? ' #' + m.number : ''}` };
    }
    const c = m.customer;
    return c ? { name: c.name, href: `customers.html?id=${encodeURIComponent(c.id)}`, hrefLabel: 'Abrir cliente' } : {};
  }

  function peopleOf(e) {
    const m = e.meta;
    const names = [];
    if (m.assigned_user && m.assigned_user.name) names.push(m.assigned_user.name);
    (m.members || []).forEach((x) => x.name && !names.includes(x.name) && names.push(x.name));
    (m.temp_workers || []).forEach((x) => x.name && names.push(x.name + ' (temporário)'));
    return names;
  }

  function detailHtml(e, phone) {
    const w = whenText(e);
    const ct = contactOf(e);
    const ppl = peopleOf(e);
    const phoneDigits = ct.phone ? String(ct.phone).replace(/[^\d+]/g, '') : '';
    const tel = phoneDigits
      ? typeof window.sfBuildTelHref === 'function'
        ? window.sfBuildTelHref(ct.phone)
        : 'tel:' + phoneDigits
      : '';
    const sms = phoneDigits
      ? typeof window.sfBuildSmsHref === 'function'
        ? window.sfBuildSmsHref(ct.phone)
        : 'sms:' + phoneDigits
      : '';
    const maps = e.address ? 'https://maps.google.com/?q=' + encodeURIComponent(e.address) : '';
    const canEdit = S.canManage;
    const leadId = e.meta.lead_id || (e.meta.lead && e.meta.lead.id) || '';
    const notesTarget =
      e.type === 'job'
        ? { kind: 'job', id: e.id, value: e.meta.notes || '', label: 'Notas do job', placeholder: 'Notas do job…' }
        : leadId
          ? { kind: 'lead', id: leadId, value: (e.meta.lead && e.meta.lead.notes) || '', label: 'Notas', placeholder: 'Notas do lead…' }
          : e.type === 'meeting'
            ? { kind: 'meeting', id: e.id, value: e.meta.notes || '', label: 'Notas', placeholder: 'Notas…' }
            : null;
    const startH = e.allDay ? null : Math.max(0, e.start.getHours() - 1);
    const mini =
      phone && !e.allDay
        ? `<div class="ag-card ag-dtl__mini">${[0, 1, 2, 3]
            .map((i) => `<div class="ag-dtl__mh" style="top:${i * 44}px"><span>${esc(fmtHour((startH + i) % 24))}</span></div>`)
            .join('')}<div class="ag-blk" style="${evStyle(e)};top:${((e.start - new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate(), startH)) / 3600e3) * 44}px;height:${Math.min(
            3,
            (e.end - e.start) / 3600e3
          ) * 44 - 2}px;left:64px;right:12px;width:auto"><b>${esc(e.title)}</b>${e.address ? `<small>${esc(e.address)}</small>` : ''}</div></div>`
        : '';
    const notesBlock = notesTarget
      ? `<div class="ag-card ag-dtl__notes">
          <button type="button" class="ag-dtl__notes-tog" data-ag-notes-tog aria-expanded="false">
            <span>${esc(notesTarget.label)}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>
          </button>
          <div class="ag-dtl__notes-panel" hidden>
            ${
              canEdit
                ? `<textarea name="notes" data-ag-notes="${esc(notesTarget.kind)}" data-ag-notes-id="${esc(notesTarget.id)}" maxlength="8000" placeholder="${esc(notesTarget.placeholder)}">${esc(notesTarget.value)}</textarea>
                   <div class="ag-dtl__notes-ft"><button type="button" class="ag-btn ag-btn--pri" data-ag-save-notes="${esc(notesTarget.kind)}" data-ag-notes-id="${esc(notesTarget.id)}" disabled>Guardar</button></div>`
                : `<p class="${notesTarget.value ? '' : 'is-empty'}">${esc(notesTarget.value || 'Sem notas')}</p>`
            }
          </div>
        </div>`
      : '';

    const tap = (field, inner, extraClass) =>
      canEdit
        ? `<button type="button" class="ag-dtl__tap${extraClass ? ' ' + extraClass : ''}" data-ag-tap="${esc(field)}" data-ag-id="${esc(e.id)}" data-ag-type="${esc(e.type)}" title="Clique para editar">${inner}</button>`
        : inner;

    const titleInner = `<h2>${esc(e.title)}</h2>`;
    const whenInner = `<p>${esc(w.date)}</p><p>${esc(w.time)}</p>`;
    const calInner = `<b><i class="ag-dot" style="background:${esc(calOf(e).color)}"></i>${esc(calOf(e).name)}${
      e.type === 'job' && e.meta.crew ? ' · ' + esc(e.meta.crew.name) : ''
    }</b>`;
    const statusInner = `<b>${esc(statusText(e))}</b>`;
    const sectorInner =
      e.type === 'job' ? `<b>${esc(SECTOR_LBL[e.meta.sector] || e.meta.sector || 'Geral')}</b>` : '';
    const assigneeInner = `<b>${esc(ppl.join(', ') || '—')}</b>`;

    return `<div class="ag-dtl" style="${evStyle(e)}" data-ag-detail="${esc(e.id)}" data-ag-type="${esc(e.type)}">
      <div class="ag-dtl__head">${
        canEdit && e.type !== 'visit' ? tap('title', titleInner, 'ag-dtl__tap--block') : titleInner
      }
        ${canEdit ? tap('when', whenInner, 'ag-dtl__tap--block') : whenInner}
        ${e.status && e.status !== 'scheduled' ? `<span class="ag-dtl__st">${esc(statusText(e))}</span>` : ''}</div>
      ${
        ct.name || tel
          ? `<div class="ag-card ag-dtl__row">${tel ? `<span class="ag-dtl__ic ag-dtl__ic--phone"><svg viewBox="0 0 24 24"><path d="M6.5 3.5l3 1 1 4-2 1.5a12 12 0 006 6l1.5-2 4 1 1 3c-1 2-3 2.5-5 2A17 17 0 013.5 8.5c-.5-2 0-4 3-5z"/></svg></span>` : ''}<div><b>${esc(ct.name || '')}</b>${
              ct.phone ? `<small>${esc(typeof window.sfFormatPhone === 'function' ? window.sfFormatPhone(ct.phone) : ct.phone)}</small>` : ''
            }</div>${
              tel || sms
                ? `<span class="ag-dtl__chips">${tel ? `<a class="ag-chip" href="${esc(tel)}">Ligar</a>` : ''}${
                    sms ? `<a class="ag-chip" href="${esc(sms)}">Text</a>` : ''
                  }</span>`
                : ''
            }</div>`
          : ''
      }
      ${
        e.address
          ? canEdit
            ? `<button type="button" class="ag-card ag-dtl__row ag-dtl__addr ag-dtl__tap ag-dtl__tap--addr" data-ag-tap="address" data-ag-id="${esc(e.id)}" data-ag-type="${esc(e.type)}" title="Clique para editar"><div><b>${esc(e.address.split(',')[0])}</b><small>${esc(
                e.address.split(',').slice(1).join(',').trim() || 'Toque para alterar',
              )}</small></div><span class="ag-dtl__map"><svg viewBox="0 0 24 24"><path d="M12 21s-6-5.3-6-10a6 6 0 0112 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>Editar</span></button>`
            : `<a class="ag-card ag-dtl__row ag-dtl__addr" href="${esc(maps)}" target="_blank" rel="noopener"><div><b>${esc(e.address.split(',')[0])}</b><small>${esc(
                e.address.split(',').slice(1).join(',').trim(),
              )}</small></div><span class="ag-dtl__map"><svg viewBox="0 0 24 24"><path d="M12 21s-6-5.3-6-10a6 6 0 0112 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>Mapa</span></a>`
          : canEdit
            ? `<button type="button" class="ag-card ag-dtl__row ag-dtl__tap ag-dtl__tap--addr" data-ag-tap="address" data-ag-id="${esc(e.id)}" data-ag-type="${esc(e.type)}" title="Adicionar endereço"><div><b>Sem endereço</b><small>Toque para adicionar</small></div></button>`
            : ''
      }
      ${mini}
      <div class="ag-card ag-dtl__kv">
        <div><span>Calendário</span>${
          canEdit && (e.type === 'job' || e.type === 'meeting') ? tap('calendar', calInner) : calInner
        }</div>
        <div><span>Status</span>${canEdit ? tap('status', statusInner) : statusInner}</div>
        ${
          e.type === 'job'
            ? `<div><span>Setor</span>${canEdit ? tap('sector', sectorInner) : sectorInner}</div>`
            : ''
        }
        <div><span>Responsável</span>${canEdit ? tap('assigned_user_id', assigneeInner) : assigneeInner}</div>
        ${
          e.type === 'job' && e.meta.related_work_order
            ? `<div><span>Job ligado</span><b><a class="ag-link" href="job-detail.html?id=${encodeURIComponent(e.meta.related_work_order.id)}">#${esc(
                e.meta.related_work_order.number != null ? e.meta.related_work_order.number : '—'
              )} · ${esc(e.meta.related_work_order.title)}</a></b></div>`
            : ''
        }
        ${
          e.type === 'job' && e.meta.related_children && e.meta.related_children.length
            ? `<div><span>Lixa / relacionados</span><b>${e.meta.related_children
                .map(
                  (c) =>
                    `<a class="ag-link" href="job-detail.html?id=${encodeURIComponent(c.id)}">#${esc(c.number != null ? c.number : '—')} · ${esc(c.title)}</a>`
                )
                .join('<br>')}</b></div>`
            : ''
        }
        ${ppl.length && !canEdit ? `<div><span>Equipe</span><b>${esc(ppl.join(', '))}</b></div>` : ''}
        ${e.type === 'job' && e.meta.services_total ? `<div><span>Serviços</span><b>${esc(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(e.meta.services_total))}</b></div>` : ''}
      </div>
      ${notesBlock}
      <div class="ag-dtl__acts">${ct.href ? `<a class="ag-btn ag-btn--pri" href="${esc(ct.href)}">${esc(ct.hrefLabel)}</a>` : ''}${
        canEdit && e.type === 'job'
          ? `<a class="ag-btn" href="campo/ticket.html?id=${encodeURIComponent(e.id)}">Editar ticket</a>`
          : ''
      }${
        canEdit ? `<button type="button" class="ag-btn" data-ag-edit="${esc(e.id)}">Editar</button>` : ''
      }${
        canEdit && e.type === 'job' && e.meta.sector === 'installation'
          ? `<button type="button" class="ag-btn" data-ag-lixa="${esc(e.id)}">Agendar Lixa</button>`
          : ''
      }</div>
      ${canEdit ? `<button type="button" class="ag-btn ag-btn--danger ag-btn--block" data-ag-del="${esc(e.id)}">${e.type === 'job' ? 'Cancelar job' : e.type === 'visit' ? 'Cancelar visita' : 'Cancelar compromisso'}</button>` : ''}
    </div>`;
  }

  function fieldEditorHtml(e, field) {
    const users = S.users || [];
    const assigneeId = e.meta.assigned_user_id || (e.meta.assigned_user && e.meta.assigned_user.id) || '';
    const jobCals = calList().filter((c) => c.kind === 'jobs');
    const meetCals = calList().filter((c) => c.kind === 'meetings' || c.kind === 'custom');
    const statusOpts =
      e.type === 'job'
        ? Object.entries(JOB_STATUS).filter(([k]) => k !== 'canceled')
        : Object.entries(MTG_STATUS).filter(([k]) => k !== 'canceled');
    const common = `data-ag-inline="${esc(field)}" data-ag-id="${esc(e.id)}" data-ag-type="${esc(e.type)}"`;

    if (field === 'title') {
      return `<input type="text" class="ag-dtl__in ag-dtl__in--wide" ${common} value="${esc(e.title)}" maxlength="200" />`;
    }
    if (field === 'when') {
      return `<div class="ag-dtl__when" data-ag-when-wrap>
        <input type="date" class="ag-dtl__in" data-ag-inline="date" data-ag-id="${esc(e.id)}" data-ag-type="${esc(e.type)}" value="${ymd(e.start)}" />
        <input type="time" class="ag-dtl__in" data-ag-inline="start" data-ag-id="${esc(e.id)}" data-ag-type="${esc(e.type)}" value="${hm(e.start)}" step="900" />
        ${e.type === 'visit' ? '' : `<input type="time" class="ag-dtl__in" data-ag-inline="end" data-ag-id="${esc(e.id)}" data-ag-type="${esc(e.type)}" value="${hm(e.end)}" step="900" />`}
      </div>`;
    }
    if (field === 'calendar') {
      if (e.type === 'job') {
        const list = jobCals.length
          ? jobCals
          : [{ id: 'jobs', name: 'Jobs', color: '#e8792c', kind: 'jobs', sector: 'all' }];
        return `<select class="ag-dtl__sel" ${common}>${list
          .map(
            (c) =>
              `<option value="${esc(c.id)}" data-sector="${esc(c.sector || 'all')}" ${
                c.id === e.calendar ? 'selected' : ''
              }>${esc(c.name)}</option>`,
          )
          .join('')}</select>`;
      }
      const list = meetCals.length
        ? meetCals
        : [{ id: 'meetings', name: 'Compromissos', color: '#3b6ea5', kind: 'meetings' }];
      return `<select class="ag-dtl__sel" ${common}>${list
        .map((c) => {
          const current = String(e.meta.calendar_id || e.calendar || 'meetings');
          const selected = current === String(c.id) || (current === 'meetings' && (c.id === 'meetings' || c.kind === 'meetings'));
          return `<option value="${esc(c.id)}" ${selected ? 'selected' : ''}>${esc(c.name)}</option>`;
        })
        .join('')}</select>`;
    }
    if (field === 'status') {
      return `<select class="ag-dtl__sel" ${common}>${statusOpts
        .map(([k, l]) => `<option value="${esc(k)}" ${k === e.status ? 'selected' : ''}>${esc(l)}</option>`)
        .join('')}</select>`;
    }
    if (field === 'sector') {
      return `<select class="ag-dtl__sel" ${common}>
        <option value="" ${!e.meta.sector ? 'selected' : ''}>Geral</option>
        <option value="installation" ${e.meta.sector === 'installation' ? 'selected' : ''}>Instalação</option>
        <option value="sand_finish" ${e.meta.sector === 'sand_finish' ? 'selected' : ''}>Lixa</option>
      </select>`;
    }
    if (field === 'address') {
      return `<input type="text" class="ag-dtl__in ag-dtl__in--wide" ${common} data-ag-address value="${esc(e.address || '')}" placeholder="Endereço" autocomplete="off" />`;
    }
    if (field === 'assigned_user_id') {
      return `<select class="ag-dtl__sel" ${common}><option value="">—</option>${users
        .map((u) => `<option value="${esc(u.id)}" ${String(u.id) === String(assigneeId) ? 'selected' : ''}>${esc(u.name || u.email)}</option>`)
        .join('')}</select>`;
    }
    return '';
  }

  async function beginFieldEdit(tapEl) {
    if (!tapEl || !S.canManage) return;
    const field = tapEl.getAttribute('data-ag-tap');
    const id = tapEl.getAttribute('data-ag-id');
    const type = tapEl.getAttribute('data-ag-type');
    const ev = findEv(id);
    if (!ev || !field) return;
    if (!S.users.length) await ensureUsers().catch(() => {});
    const html = fieldEditorHtml(ev, field);
    if (!html) return;

    const root = tapEl.closest('[data-ag-detail]');
    if (root && root.querySelector('[data-ag-editing]')) {
      // Another field is mid-edit — refresh static card then re-open this field.
      const anchor = $(`[data-ag-ev="${CSS.escape(id)}"]`);
      openDetail(id, anchor);
      const again = document.querySelector(
        `[data-ag-tap="${CSS.escape(field)}"][data-ag-id="${CSS.escape(id)}"]`,
      );
      if (again && again !== tapEl) return beginFieldEdit(again);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ag-dtl__kv-ctl ag-dtl__editing';
    wrap.setAttribute('data-ag-id', id);
    wrap.setAttribute('data-ag-type', type);
    wrap.setAttribute('data-ag-editing', field);
    wrap.innerHTML = html;

    if (field === 'title' || field === 'when') {
      tapEl.replaceWith(wrap);
      wrap.classList.add('ag-dtl__editing--block');
    } else if (field === 'address') {
      tapEl.replaceWith(wrap);
      wrap.classList.add('ag-card', 'ag-dtl__editing--addr');
    } else {
      const cell = tapEl.closest('.ag-dtl__kv > div') || tapEl.parentNode;
      if (cell && cell !== tapEl) {
        const label = cell.querySelector(':scope > span');
        Array.from(cell.children).forEach((ch) => {
          if (ch !== label) ch.remove();
        });
        cell.appendChild(wrap);
      } else {
        tapEl.replaceWith(wrap);
      }
    }

    const focusEl = wrap.querySelector('input, select');
    if (focusEl) {
      focusEl.focus();
      if (focusEl.tagName === 'SELECT' && typeof focusEl.showPicker === 'function') {
        try {
          focusEl.showPicker();
        } catch (_) {}
      }
    }
    if (field === 'address' && typeof window.sfAttachAddressAutocomplete === 'function') {
      const addr = wrap.querySelector('[data-ag-address]');
      if (addr) {
        window.sfAttachAddressAutocomplete(addr, {
          map: { combined: addr },
          onSelect: () => void applyInlinePatch(addr),
        }).catch(() => {});
      }
    }
  }

  function wireDetailEditors() {
    /* editors attach on click via beginFieldEdit */
  }

  let inlineBusy = false;
  async function applyInlinePatch(el) {
    if (!el || !S.canManage || inlineBusy) return;
    const id = el.getAttribute('data-ag-id');
    const type = el.getAttribute('data-ag-type');
    const field = el.getAttribute('data-ag-inline');
    if (!id || !type || !field) return;
    const ev = findEv(id);
    if (!ev) return;

    const detail = el.closest('[data-ag-detail]') || document;
    const valOf = (f) => {
      const n = detail.querySelector(`[data-ag-inline="${f}"][data-ag-id="${CSS.escape(id)}"]`);
      return n ? String(n.value || '').trim() : '';
    };

    // Skip no-op saves (e.g. focusout without edits).
    if (field === 'title' && valOf('title') === String(ev.title || '').trim()) return;
    if (field === 'address') {
      const cur = String(ev.address || '').trim();
      if (valOf('address') === cur) return;
    }
    if (field === 'status' && valOf('status') === String(ev.status || '')) return;
    if (field === 'sector') {
      const next = valOf('sector') || '';
      const cur = String(ev.meta.sector || '');
      if (next === cur) return;
    }
    if (field === 'assigned_user_id') {
      const cur = String(ev.meta.assigned_user_id || (ev.meta.assigned_user && ev.meta.assigned_user.id) || '');
      if (valOf('assigned_user_id') === cur) return;
    }
    if (field === 'calendar') {
      if (type === 'job') {
        const sel = detail.querySelector(`[data-ag-inline="calendar"][data-ag-id="${CSS.escape(id)}"]`);
        const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
        const sector = opt ? String(opt.getAttribute('data-sector') || 'all') : 'all';
        const nextSector = sector === 'installation' || sector === 'sand_finish' ? sector : '';
        const curSector = String(ev.meta.sector || '');
        if (nextSector === curSector) {
          // Job calendar is derived from sector — same sector cannot move the job.
          if (valOf('calendar') !== String(ev.calendar || '')) {
            toast('Este calendário usa o mesmo setor do job.', 'info');
          }
          openDetail(id, $(`[data-ag-ev="${CSS.escape(id)}"]`));
          return;
        }
      } else if (type === 'meeting') {
        const next = valOf('calendar');
        const cur = String(ev.meta.calendar_id || ev.calendar || 'meetings');
        const nextNorm = !next || next === 'meetings' ? 'meetings' : next;
        const curNorm = !cur || cur === 'meetings' ? 'meetings' : cur;
        if (nextNorm === curNorm) {
          openDetail(id, $(`[data-ag-ev="${CSS.escape(id)}"]`));
          return;
        }
      }
    }
    if (field === 'date' || field === 'start' || field === 'end') {
      const date = valOf('date');
      const st = valOf('start') || hm(ev.start);
      const en = valOf('end') || hm(ev.end);
      if (date === ymd(ev.start) && st === hm(ev.start) && (type === 'visit' || en === hm(ev.end))) return;
    }

    try {
      inlineBusy = true;
      el.classList.add('is-saving');
      if (type === 'job') {
        const body = {};
        if (field === 'title') {
          if (valOf('title').length < 2) throw new Error('Título muito curto.');
          body.title = valOf('title');
        } else if (field === 'status') body.status = valOf('status');
        else if (field === 'sector') body.sector = valOf('sector') || null;
        else if (field === 'address') body.address = valOf('address') || null;
        else if (field === 'assigned_user_id') body.assigned_user_id = valOf('assigned_user_id') || null;
        else if (field === 'calendar') {
          const sel = detail.querySelector(`[data-ag-inline="calendar"][data-ag-id="${CSS.escape(id)}"]`);
          const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
          const sector = opt ? String(opt.getAttribute('data-sector') || 'all') : 'all';
          body.sector = sector === 'installation' || sector === 'sand_finish' ? sector : null;
        } else if (field === 'date' || field === 'start' || field === 'end') {
          const date = valOf('date');
          const st = valOf('start') || hm(ev.start);
          const en = valOf('end') || hm(ev.end);
          if (!date || !st) throw new Error('Informe data e horário.');
          let start = new Date(`${date}T${st}`);
          let end = new Date(`${date}T${en}`);
          if (!(end > start)) end = new Date(start.getTime() + 3600e3);
          body.scheduled_start = start.toISOString();
          body.scheduled_end = end.toISOString();
        }
        await api('/api/work-orders/' + encodeURIComponent(id), { method: 'PUT', body });
      } else {
        const body = {};
        if (field === 'title' && type === 'meeting') {
          if (valOf('title').length < 2) throw new Error('Título muito curto.');
          body.title = valOf('title');
        } else if (field === 'status') body.status = valOf('status');
        else if (field === 'address') body.location = valOf('address') || null;
        else if (field === 'assigned_user_id') body.assigned_user_id = valOf('assigned_user_id') || null;
        else if (field === 'calendar' && type === 'meeting') {
          const raw = valOf('calendar');
          // Default meetings calendar uses a non-UUID id ("meetings") → store null.
          body.calendar_id =
            raw && raw !== 'meetings' && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
        } else if (field === 'date' || field === 'start' || field === 'end') {
          const date = valOf('date');
          const st = valOf('start') || hm(ev.start);
          let en = valOf('end');
          if (!date || !st) throw new Error('Informe data e horário.');
          const start = new Date(`${date}T${st}`);
          let end = en
            ? new Date(`${date}T${en}`)
            : new Date(start.getTime() + (type === 'visit' ? 3600e3 : Math.max(3600e3, ev.end - ev.start)));
          if (!(end > start)) end = new Date(start.getTime() + 3600e3);
          body.scheduled_start = start.toISOString();
          body.scheduled_end = end.toISOString();
        }
        await api('/api/meetings/' + encodeURIComponent(id), { method: 'PUT', body });
      }
      toast('Atualizado', 'success');
      const wasPhone = isPhone() && !$('#agSheet').hidden;
      await reload();
      if (wasPhone) openDetail(id);
      else {
        const anchor = $(`[data-ag-ev="${CSS.escape(id)}"]`);
        openDetail(id, anchor);
      }
    } catch (err) {
      toast(err.message || 'Não foi possível salvar.', 'error');
    } finally {
      el.classList.remove('is-saving');
      inlineBusy = false;
    }
  }

  function openDayEventsSheet(day) {
    const d = typeof day === 'string' ? parseYmd(day) : day;
    if (!d) return;
    const list = eventsOnDay(d);
    if (!list.length) {
      if (S.canManage) return newMenu(window.innerWidth / 2, window.innerHeight / 2, d);
      return toast('Sem eventos neste dia.', 'info');
    }
    if (list.length === 1) return openDetail(list[0].id);
    openSheet(
      `<header class="ag-sheet__bar"><button type="button" class="ag-round" data-ag-close aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h2>${esc(fmtDateShort(d))}</h2><span></span></header>
       <div class="ag-sheet__body"><div class="ag-card" style="padding:6px">${list
         .map(
           (e) =>
             `<button type="button" class="ag-li" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i></i><time>${esc(e.allDay ? 'dia inteiro' : fmtTime(e.start))}</time><div><b>${esc(e.title)}</b><small>${esc(TYPES[e.type].one)}</small></div></button>`
         )
         .join('')}</div></div>`
    );
  }

  function openDetail(id, anchor) {
    const e = findEv(id);
    if (!e) return;
    const paint = () => {
      if (isPhone()) {
        openSheet(`<header class="ag-sheet__bar"><button type="button" class="ag-round" data-ag-close aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${
          S.canManage ? `<button type="button" class="ag-pillbtn" data-ag-edit="${esc(e.id)}">Editar</button>` : ''
        }</header><div class="ag-sheet__body">${detailHtml(e, true)}</div>`);
        return;
      }
      const pop = $('#agPop');
      pop.innerHTML = detailHtml(e, false);
      pop.hidden = false;
      $$('.is-active-ev').forEach((x) => x.classList.remove('is-active-ev'));
      if (anchor) anchor.classList.add('is-active-ev');
      const r = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2, right: window.innerWidth / 2, top: 200, bottom: 220, width: 0 };
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      let left = r.right + 12;
      let side = 'r';
      if (left + pw > window.innerWidth - 12) {
        left = r.left - pw - 12;
        side = 'l';
      }
      if (left < 12) {
        left = Math.max(12, Math.min(window.innerWidth - pw - 12, r.left));
        side = 'b';
      }
      let top = side === 'b' ? r.bottom + 10 : r.top + r.height / 2 - ph / 2;
      top = Math.max(70, Math.min(window.innerHeight - ph - 12, top));
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      pop.dataset.side = side;
    };
    if (S.canManage && !S.users.length) {
      ensureUsers().then(paint).catch(paint);
    } else paint();
  }
  function closePop() {
    const p = $('#agPop');
    if (p) p.hidden = true;
    $$('.is-active-ev').forEach((x) => x.classList.remove('is-active-ev'));
  }

  function openSheet(html, cls) {
    const sh = $('#agSheet');
    const card = $('.ag-sheet__card', sh);
    card.className = 'ag-sheet__card' + (cls ? ' ' + cls : '');
    card.innerHTML = html;
    sh.hidden = false;
    document.body.classList.add('ag-sheet-open');
    requestAnimationFrame(() => sh.classList.add('is-open'));
  }
  function closeSheet() {
    const sh = $('#agSheet');
    sh.classList.remove('is-open');
    document.body.classList.remove('ag-sheet-open');
    setTimeout(() => {
      if (!sh.classList.contains('is-open')) {
        sh.hidden = true;
        $('.ag-sheet__card', sh).innerHTML = '';
      }
    }, 220);
  }

  // ---------------------------------------------------------------- create / edit
  function openMenu(x, y, items) {
    const m = $('#agMenu');
    m.innerHTML =
      `<button type="button" class="ag-menu__x" data-ag-menu="close" aria-label="Fechar">×</button>` +
      items
        .map((it) =>
          it.sep
            ? '<hr/>'
            : `<button type="button" class="ag-menu__i${it.danger ? ' is-danger' : ''}" data-ag-menu="${esc(it.act)}" ${
                it.data ? `data-ag-when="${esc(it.data)}"` : ''
              }><span class="ag-dot" style="--ev:${it.color || '#8a8074'}"></span>${esc(it.label)}</button>`,
        )
        .join('');
    m.hidden = false;
    if (isPhone()) {
      m.classList.add('is-sheet');
      m.style.left = m.style.top = '';
    } else {
      m.classList.remove('is-sheet');
      // Measure after paint so fixed positioning + padding are applied.
      m.style.left = '0px';
      m.style.top = '0px';
      const w = m.offsetWidth || 260;
      const h = m.offsetHeight || 160;
      m.style.left = Math.max(10, Math.min(x, window.innerWidth - w - 10)) + 'px';
      m.style.top = Math.max(10, Math.min(y, window.innerHeight - h - 10)) + 'px';
    }
  }
  const closeMenu = () => {
    const m = $('#agMenu');
    m.hidden = true;
    m.innerHTML = '';
  };

  function newMenu(x, y, when) {
    if (!S.canManage) return toast('Sem permissão para agendar.', 'error');
    const w = when ? when.toISOString() : '';
    const label = when ? (when.getHours() || when.getMinutes() ? ` · ${fmtDateShort(when)} ${fmtTime(when)}` : ` · ${fmtDateShort(when)}`) : '';
    openMenu(x, y, [
      { act: 'new-job', label: 'Novo job' + label, color: calList()[0].color, data: w },
      { act: 'new-visit', label: 'Nova visita' + label, color: TYPES.visit.color, data: w },
      { act: 'new-meeting', label: 'Novo compromisso' + label, color: (calList().find((c) => c.kind === 'meetings') || TYPES.meeting).color, data: w },
    ]);
  }

  function defaultStart(when) {
    let d = when ? new Date(when) : null;
    if (!d || Number.isNaN(d.getTime())) {
      d = addDays(sod(new Date()), 1);
      d.setHours(9);
    } else if (!d.getHours() && !d.getMinutes()) d.setHours(9);
    return d;
  }

  async function ensureUsers() {
    if (S.users.length) return S.users;
    try {
      const j = await api('/api/users?limit=100');
      S.users = (j.data || []).filter((u) => u && u.id && u.is_active !== false && u.is_active !== 0);
    } catch (_) {
      S.users = [];
    }
    return S.users;
  }

  async function openEditor(kind, ev, when) {
    if (kind === 'job') {
      if (!window.__crmJobModal) return toast('Editor de job indisponível.', 'error');
      closePop();
      closeSheet();
      if (ev) window.__crmJobModal.openEdit(ev.id).catch((e) => toast(e.message, 'error'));
      else window.__crmJobModal.openCreate(when ? { start: when } : {}).catch((e) => toast(e.message, 'error'));
      return;
    }
    const users = await ensureUsers();
    const s = ev ? ev.start : defaultStart(when);
    const e = ev ? ev.end : new Date(s.getTime() + 3600e3);
    const m = ev ? ev.meta : {};
    const isVisit = kind === 'visit';
    const title = ev ? (isVisit ? 'Editar visita' : 'Editar compromisso') : isVisit ? 'Nova visita' : 'Novo compromisso';
    const seller = ev ? m.assigned_user_id : S.me && S.me.id;
    closePop();
    openSheet(
      `<header class="ag-sheet__bar"><button type="button" class="ag-pillbtn ag-pillbtn--ghost" data-ag-close>Cancelar</button><h2>${esc(title)}</h2><button type="submit" form="agForm" class="ag-pillbtn ag-pillbtn--pri">${ev ? 'Salvar' : 'Adicionar'}</button></header>
      <form class="ag-sheet__body ag-form" id="agForm" data-kind="${kind}" ${ev ? `data-id="${esc(ev.id)}"` : ''} novalidate>
        ${
          isVisit
            ? ev
              ? `<div class="ag-card ag-form__ro"><span>Lead</span><b>${esc((m.lead && m.lead.name) || ev.title)}</b></div>`
              : `<div class="ag-card ag-form__grp"><label class="ag-form__lead">Lead<input type="search" id="agLeadQ" placeholder="Buscar lead por nome ou telefone" autocomplete="off" required /></label><input type="hidden" name="lead_id" /><div class="ag-lead-res" id="agLeadRes"></div></div>`
            : `<div class="ag-card ag-form__grp"><input name="title" class="ag-form__title" placeholder="Título" value="${esc(ev ? ev.title : '')}" required /></div>`
        }
        <div class="ag-card ag-form__grp">
          <label class="ag-form__row"><span>Data</span><input type="date" name="date" required value="${ymd(s)}" /></label>
          <label class="ag-form__row"><span>Início</span><input type="time" name="start" required value="${hm(s)}" step="900" /></label>
          ${isVisit && !ev ? '' : `<label class="ag-form__row"><span>Fim</span><input type="time" name="end" required value="${hm(e)}" step="900" /></label>`}
        </div>
        <div class="ag-card ag-form__grp">
          <label class="ag-form__row ag-form__row--col"><span>Local</span><input name="location" data-ag-address autocomplete="off" placeholder="Endereço" value="${esc(ev ? ev.address : '')}" /></label>
          <label class="ag-form__row"><span>Responsável</span><select name="assigned_user_id"><option value="">—</option>${users
            .map((u) => `<option value="${esc(u.id)}" ${String(u.id) === String(seller || '') ? 'selected' : ''}>${esc(u.name || u.email)}</option>`)
            .join('')}</select></label>
          ${!isVisit ? `<label class="ag-form__row"><span>Agenda</span><select name="calendar_id">${calList()
            .filter((c) => c.kind === 'meetings' || c.kind === 'custom')
            .map((c) => `<option value="${esc(c.kind === 'meetings' ? '' : c.id)}" ${(ev ? (m.calendar_id || '') : '') === (c.kind === 'meetings' ? '' : c.id) ? 'selected' : ''}>${esc(c.name)}</option>`)
            .join('')}</select></label>` : ''}
          ${ev ? `<label class="ag-form__row"><span>Status</span><select name="status">${Object.keys(MTG_STATUS).filter((k) => k !== 'canceled').map((k) => `<option value="${k}" ${k === ev.status ? 'selected' : ''}>${MTG_STATUS[k]}</option>`).join('')}</select></label>` : ''}
        </div>
        <div class="ag-card ag-form__grp"><textarea name="notes" rows="4" placeholder="Notas">${esc(ev ? m.notes || '' : '')}</textarea></div>
        ${isVisit && !ev ? '<p class="ag-hint">A visita dura 1 hora e o lead vai para a etapa Visita agendada.</p>' : ''}
      </form>`,
      'ag-sheet__card--form'
    );
    const addr = $('#agForm [data-ag-address]');
    if (addr && typeof window.sfAttachAddressAutocomplete === 'function') {
      window.sfAttachAddressAutocomplete(addr, { map: { combined: addr } }).catch(() => {});
    }
    if (isVisit && !ev) wireLeadPicker();
  }

  function wireLeadPicker() {
    const q = $('#agLeadQ');
    const res = $('#agLeadRes');
    let t = null;
    q.addEventListener('input', () => {
      clearTimeout(t);
      $('#agForm [name="lead_id"]').value = '';
      const v = q.value.trim();
      if (v.length < 2) {
        res.innerHTML = '';
        return;
      }
      t = setTimeout(async () => {
        try {
          const j = await api('/api/leads?limit=8&q=' + encodeURIComponent(v));
          res.innerHTML = (j.data || []).length
            ? j.data
                .map(
                  (l) => {
                    const ph = typeof window.sfFormatPhone === 'function' ? window.sfFormatPhone(l.phone) : l.phone;
                    return `<button type="button" class="ag-lead-opt" data-ag-lead="${esc(l.id)}" data-ag-lead-name="${esc(l.name)}" data-ag-lead-addr="${esc([l.address, l.zipcode && l.address && !String(l.address).includes(l.zipcode) ? l.zipcode : ''].filter(Boolean).join(', '))}"><b>${esc(l.name)}</b><small>${esc([ph, l.address].filter(Boolean).join(' · '))}</small></button>`;
                  }
                )
                .join('')
            : '<p class="ag-empty">Nenhum lead encontrado.</p>';
        } catch (e) {
          res.innerHTML = `<p class="ag-empty">${esc(e.message)}</p>`;
        }
      }, 220);
    });
  }

  async function submitForm(form) {
    const fd = new FormData(form);
    const kind = form.dataset.kind;
    const id = form.dataset.id;
    const date = fd.get('date');
    const st = fd.get('start');
    if (!date || !st) throw new Error('Informe data e horário.');
    const start = new Date(`${date}T${st}`);
    let end = fd.get('end') ? new Date(`${date}T${fd.get('end')}`) : new Date(start.getTime() + 3600e3);
    if (end <= start) end = new Date(end.getTime() + DAY);
    const location = String(fd.get('location') || '').trim() || null;
    const notes = String(fd.get('notes') || '').trim() || null;
    const assigned = fd.get('assigned_user_id') || null;
    let saved;
    if (kind === 'visit' && !id) {
      const leadId = fd.get('lead_id');
      if (!leadId) throw new Error('Escolha o lead da visita.');
      saved = await api('/api/visits', { method: 'POST', body: { lead_id: leadId, scheduled_at: start.toISOString(), address: location, notes, seller_id: assigned } });
    } else {
      const body = { scheduled_start: start.toISOString(), scheduled_end: end.toISOString(), location, notes, assigned_user_id: assigned };
      if (kind === 'meeting') {
        const title = String(fd.get('title') || '').trim();
        if (title.length < 2) throw new Error('Dê um título ao compromisso.');
        body.title = title;
      }
      if (fd.get('status')) body.status = fd.get('status');
      if (fd.has('calendar_id')) body.calendar_id = fd.get('calendar_id') || null;
      saved = await api(id ? '/api/meetings/' + encodeURIComponent(id) : '/api/meetings', { method: id ? 'PUT' : 'POST', body });
    }
    const conflicts = saved && Array.isArray(saved.conflicts) ? saved.conflicts : [];
    closeSheet();
    toast(id ? 'Salvo' : kind === 'visit' ? 'Visita agendada' : 'Compromisso criado', 'success');
    if (conflicts.length) toast(`Atenção: conflita com ${conflicts.length} evento(s) do mesmo responsável.`, 'info');
    await ensureRange(addDays(start, -1), addDays(start, 2)).catch(() => {});
    await reload();
  }

  async function cancelEvent(e) {
    const what = e.type === 'job' ? 'o job' : e.type === 'visit' ? 'a visita' : 'o compromisso';
    openSheet(
      `<div class="ag-confirm"><h2>Cancelar ${what}?</h2><p>${esc(e.title)} · ${esc(whenText(e).date)}</p><p class="ag-hint">${
        e.type === 'job' ? 'O job sai da agenda (jobs com fatura não podem ser cancelados).' : 'Sai da agenda.' + (e.type === 'visit' ? ' A visita fica como cancelada no lead.' : '')
      }</p><div class="ag-confirm__acts"><button type="button" class="ag-btn" data-ag-close>Voltar</button><button type="button" class="ag-btn ag-btn--danger" data-ag-del-ok="${esc(e.id)}">Cancelar ${what}</button></div></div>`,
      'ag-sheet__card--confirm'
    );
  }

  // ---------------------------------------------------------------- search
  async function searchPool() {
    if (S.searchPool) return S.searchPool;
    const from = addDays(sod(new Date()), -120);
    const to = addDays(sod(new Date()), 365);
    const j = await api(`/api/schedule/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    S.searchPool = (j.data || []).map(normalize);
    return S.searchPool;
  }
  async function runSearch(q, box) {
    const v = q.trim().toLowerCase();
    if (!v) {
      box.innerHTML = '';
      return false;
    }
    const pool = await searchPool().catch(() => S.events);
    const hits = pool
      .filter((e) => {
        const m = e.meta;
        return [e.title, e.address, m.notes, m.customer && m.customer.name, m.lead && m.lead.name, m.lead && m.lead.phone, m.customer && m.customer.phone, m.source_name, m.number && '#' + m.number]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(v);
      })
      .sort((a, b) => Math.abs(a.start - Date.now()) - Math.abs(b.start - Date.now()))
      .slice(0, 30)
      .sort((a, b) => a.start - b.start);
    box.innerHTML = hits.length
      ? hits
          .map(
            (e) => `<button type="button" class="ag-li" data-ag-hit="${esc(e.id)}" style="${evStyle(e)}"><i></i><time>${esc(fmtDateShort(e.start))}<br/><small>${esc(e.allDay ? 'dia inteiro' : fmtTime(e.start))}</small></time><div><b>${esc(e.title)}</b><small>${esc(
              [TYPES[e.type].one, e.address].filter(Boolean).join(' · ')
            )}</small></div></button>`
          )
          .join('')
      : '<p class="ag-empty">Nada encontrado.</p>';
    return true;
  }
  async function gotoHit(id) {
    const e = findEv(id);
    if (!e) return;
    $('#agResults').hidden = true;
    closeSheet();
    S.selected = sod(e.start);
    S.cursor = sod(e.start);
    if (isPhone()) {
      S.mmode = 'day';
      S.view = 'month';
    } else S.view = 'day';
    await go();
    setTimeout(() => openDetail(id, $(`[data-ag-ev="${CSS.escape(id)}"]`)), 50);
  }

  // ---------------------------------------------------------------- events
  function slotTimeFromClick(col, ev) {
    const r = col.getBoundingClientRect();
    const hours = (ev.clientY - r.top) / HOUR_PX;
    const q = Math.max(0, Math.min(23.75, Math.floor(hours * 4) / 4));
    const d = parseYmd(col.dataset.agCol);
    d.setHours(Math.floor(q), Math.round((q % 1) * 60));
    return d;
  }

  /** Move a job / visit / meeting to another calendar day, keeping duration and clock time. */
  async function moveEventToDay(e, day) {
    if (!e || !day || !S.canManage) return;
    if (sameDay(e.start, day)) return;
    const ms = Math.max(15 * 60e3, (e.end && e.start ? e.end - e.start : 3600e3) || 3600e3);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), e.start.getHours(), e.start.getMinutes(), 0, 0);
    if (!e.allDay && !e.start.getHours() && !e.start.getMinutes()) start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + ms);
    const body = {
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
    };
    try {
      if (e.type === 'job') {
        await api('/api/work-orders/' + encodeURIComponent(e.id), { method: 'PUT', body });
      } else {
        await api('/api/meetings/' + encodeURIComponent(e.id), { method: 'PUT', body });
      }
      toast('Movido para ' + fmtDateShort(day), 'success');
      closePop();
      closeSheet();
      await reload();
    } catch (err) {
      toast(err.message || 'Não foi possível mover.', 'error');
    }
  }

  function dayElFromPoint(x, y) {
    // Prefer geometric hit-test: bars overlay sibling day cells, so elementsFromPoint alone is flaky.
    const sels = '#agStage [data-ag-day], #agStage [data-ag-mday], #agStage [data-ag-col], #agStage [data-ag-strip], #agStage [data-ag-goday]';
    let best = null;
    let bestArea = Infinity;
    document.querySelectorAll(sels).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return;
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        best = el;
      }
    });
    if (best) return best;
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const node of stack) {
      if (!node || !node.closest) continue;
      const day = node.closest('[data-ag-day], [data-ag-mday], [data-ag-col], [data-ag-strip], [data-ag-goday]');
      if (day) return day;
    }
    return null;
  }

  function ymdFromDayEl(el) {
    if (!el) return null;
    return el.dataset.agDay || el.dataset.agMday || el.dataset.agCol || el.dataset.agStrip || el.dataset.agGoday || null;
  }

  function clearTextSelection() {
    try {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (_) {}
  }

  /** Long-press (2s) on an empty calendar day → open + Schedule menu. */
  function wireLongPressCreate() {
    const HOLD_MS = 2000;
    const LOCK_MS = 280;
    let timer = null;
    let lockTimer = null;
    let startX = 0;
    let startY = 0;
    let day = null;
    let cell = null;
    let fired = false;
    let locked = false;
    let pointerId = null;

    const unlock = () => {
      locked = false;
      document.body.classList.remove('ag-holding');
      if (cell) cell.classList.remove('is-pressing');
      cell = null;
    };

    const clear = () => {
      clearTimeout(timer);
      clearTimeout(lockTimer);
      timer = null;
      lockTimer = null;
      day = null;
      pointerId = null;
      unlock();
    };

    const dayFromTarget = (t) => {
      if (!t || !t.closest) return { day: null, cell: null };
      if (t.closest('[data-ag-ev], [data-ag-daylist], .ag-bar, .ag-blk, .ag-row, .ag-li, a, input, textarea, select')) {
        return { day: null, cell: null };
      }
      const chromeBtn = t.closest('button');
      if (chromeBtn && !chromeBtn.closest('[data-ag-day], [data-ag-mday], [data-ag-col]')) {
        return { day: null, cell: null };
      }
      const el = t.closest('[data-ag-day], [data-ag-mday], [data-ag-col]');
      if (!el) return { day: null, cell: null };
      const key = el.dataset.agDay || el.dataset.agMday || el.dataset.agCol;
      return key ? { day: parseYmd(key), cell: el } : { day: null, cell: null };
    };

    document.addEventListener(
      'pointerdown',
      (ev) => {
        if (!S.canManage) return;
        if (typeof ev.button === 'number' && ev.button !== 0) return;
        if (document.body.classList.contains('ag-dragging')) return;
        const hit = dayFromTarget(ev.target);
        if (!hit.day) return;
        fired = false;
        locked = false;
        startX = ev.clientX;
        startY = ev.clientY;
        day = hit.day;
        cell = hit.cell;
        pointerId = ev.pointerId;
        clearTimeout(timer);
        clearTimeout(lockTimer);
        lockTimer = setTimeout(() => {
          if (!day) return;
          locked = true;
          document.body.classList.add('ag-holding');
          if (cell) cell.classList.add('is-pressing');
          clearTextSelection();
        }, LOCK_MS);
        timer = setTimeout(() => {
          if (!day) return;
          fired = true;
          const when = day;
          const cx = startX || window.innerWidth / 2;
          const cy = startY || window.innerHeight / 2;
          clearTextSelection();
          clear();
          try {
            if (navigator.vibrate) navigator.vibrate(18);
          } catch (_) {}
          newMenu(cx, cy, when);
        }, HOLD_MS);
      },
      true,
    );

    document.addEventListener(
      'pointermove',
      (ev) => {
        if (pointerId != null && ev.pointerId !== pointerId) return;
        if (!timer && !lockTimer) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12) {
          clear();
          return;
        }
        if (locked) {
          ev.preventDefault();
          clearTextSelection();
        }
      },
      { capture: true, passive: false },
    );

    document.addEventListener(
      'pointerup',
      (ev) => {
        if (pointerId != null && ev.pointerId !== pointerId) return;
        if (!fired) clear();
        else {
          pointerId = null;
          unlock();
        }
      },
      true,
    );
    document.addEventListener(
      'pointercancel',
      (ev) => {
        if (pointerId != null && ev.pointerId !== pointerId) return;
        clear();
      },
      true,
    );
    document.addEventListener(
      'contextmenu',
      (ev) => {
        if (!timer && !locked && !fired) return;
        ev.preventDefault();
        clearTextSelection();
      },
      true,
    );
    document.addEventListener(
      'selectstart',
      (ev) => {
        if (!timer && !locked && !fired) return;
        ev.preventDefault();
      },
      true,
    );
    document.addEventListener(
      'click',
      (ev) => {
        if (!fired) return;
        ev.preventDefault();
        ev.stopPropagation();
        fired = false;
      },
      true,
    );
  }

  /** Drag schedule chips onto another day to reschedule. */
  function wireEventDragDrop() {
    let drag = null;

    const cleanup = () => {
      if (!drag) return;
      if (drag.ghost) drag.ghost.remove();
      if (drag.el) {
        drag.el.classList.remove('is-dragging');
        try {
          if (drag.pointerId != null) drag.el.releasePointerCapture(drag.pointerId);
        } catch (_) {}
      }
      $$('.ag-drop-target').forEach((n) => n.classList.remove('ag-drop-target'));
      document.body.classList.remove('ag-dragging');
      drag = null;
    };

    document.addEventListener(
      'pointerdown',
      (ev) => {
        if (!S.canManage) return;
        if (typeof ev.button === 'number' && ev.button !== 0) return;
        if (document.body.classList.contains('ag-holding')) return;
        const btn = ev.target.closest('[data-ag-ev]');
        if (!btn || !btn.closest('#agStage')) return;
        if (ev.target.closest('a, input, textarea, select')) return;
        drag = {
          id: btn.dataset.agEv,
          el: btn,
          startX: ev.clientX,
          startY: ev.clientY,
          moved: false,
          pointerId: ev.pointerId,
          ghost: null,
        };
      },
      true,
    );

    document.addEventListener(
      'pointermove',
      (ev) => {
        if (!drag || drag.pointerId !== ev.pointerId) return;
        const dist = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY);
        if (!drag.moved) {
          if (dist < 10) return;
          drag.moved = true;
          document.body.classList.add('ag-dragging');
          clearTextSelection();
          drag.el.classList.add('is-dragging');
          const g = document.createElement('div');
          g.className = 'ag-drag-ghost';
          g.textContent = (drag.el.querySelector('b, span') || drag.el).textContent || 'Evento';
          const st = getComputedStyle(drag.el);
          g.style.background = st.backgroundColor || 'var(--ev-bg, #fdf1e7)';
          g.style.color = st.color || 'var(--ev-ink, #211d1a)';
          g.style.borderLeft = st.borderLeft || '3px solid var(--ev, #e8792c)';
          document.body.appendChild(g);
          drag.ghost = g;
          try {
            drag.el.setPointerCapture(ev.pointerId);
          } catch (_) {}
        }
        ev.preventDefault();
        if (drag.ghost) {
          drag.ghost.style.left = ev.clientX + 12 + 'px';
          drag.ghost.style.top = ev.clientY + 12 + 'px';
        }
        $$('.ag-drop-target').forEach((n) => n.classList.remove('ag-drop-target'));
        const dayEl = dayElFromPoint(ev.clientX, ev.clientY);
        if (dayEl) dayEl.classList.add('ag-drop-target');
      },
      { capture: true, passive: false },
    );

    document.addEventListener(
      'pointerup',
      async (ev) => {
        if (!drag || drag.pointerId !== ev.pointerId) return;
        const moved = drag.moved;
        const id = drag.id;
        const x = ev.clientX;
        const y = ev.clientY;
        cleanup();
        if (!moved) return;
        window.__agSuppressEvClick = true;
        setTimeout(() => {
          window.__agSuppressEvClick = false;
        }, 120);
        const dayEl = dayElFromPoint(x, y);
        const key = ymdFromDayEl(dayEl);
        if (!key) {
          toast('Solte sobre um dia do calendário.', 'info');
          return;
        }
        const target = parseYmd(key);
        const e = findEv(id);
        if (!e || !target) return;
        await moveEventToDay(e, target);
      },
      true,
    );

    document.addEventListener(
      'pointercancel',
      (ev) => {
        if (!drag || drag.pointerId !== ev.pointerId) return;
        cleanup();
      },
      true,
    );
  }

  function wire() {
    wireLongPressCreate();
    wireEventDragDrop();
    document.addEventListener('click', async (ev) => {
      const t = ev.target;
      const menuOpen = !$('#agMenu').hidden;
      if (menuOpen && !t.closest('#agMenu')) closeMenu();
      if (!$('#agResults').hidden && !t.closest('#agResults') && !t.closest('.ag-search')) $('#agResults').hidden = true;
      let el;
      if ((el = t.closest('[data-ag-close]'))) {
        if (document.querySelector('#agSheet [data-ag-cal-sheet]')) calDraft = null;
        return closeSheet();
      }
      if ((el = t.closest('[data-ag-cal-add]'))) {
        const draft = ensureCalDraft();
        if (!draft) return toast('Sem permissão para editar agendas.', 'error');
        if (draft.length >= 24) return toast('Limite de agendas atingido.', 'error');
        draft.push({ id: newCalId(), name: 'Nova agenda', color: '#16a34a', kind: 'custom' });
        calSheetMode = 'edit';
        return openCalSheet('edit');
      }
      if ((el = t.closest('[data-ag-cal-del]'))) {
        const draft = ensureCalDraft();
        if (!draft) return;
        const i = Number(el.getAttribute('data-ag-cal-del'));
        if (!draft[i]) return;
        if (draft.length <= 1) return toast('Mantenha ao menos uma agenda.', 'error');
        draft.splice(i, 1);
        return openCalSheet('edit');
      }
      if ((el = t.closest('[data-ag-cal-save]'))) return void saveCalDraft();
      if ((el = t.closest('[data-ag-cal-mode]'))) {
        const mode = el.getAttribute('data-ag-cal-mode') === 'edit' ? 'edit' : 'filter';
        if (mode === 'edit' && !canEditCals()) return toast('Sem permissão para editar agendas.', 'error');
        return openCalSheet(mode);
      }
      if ((el = t.closest('[data-ag-menu]'))) {
        const act = el.dataset.agMenu;
        const when = el.dataset.agWhen || '';
        closeMenu();
        if (act === 'close') return;
        if (act === 'new-job') return openEditor('job', null, when || null);
        if (act === 'new-visit') return openEditor('visit', null, when || null);
        if (act === 'new-meeting') return openEditor('meeting', null, when || null);
        return;
      }
      if ((el = t.closest('[data-ag-lead]'))) {
        $('#agForm [name="lead_id"]').value = el.dataset.agLead;
        $('#agLeadQ').value = el.dataset.agLeadName;
        const addr = $('#agForm [name="location"]');
        if (addr && !addr.value && el.dataset.agLeadAddr) addr.value = el.dataset.agLeadAddr;
        $('#agLeadRes').innerHTML = '';
        return;
      }
      if ((el = t.closest('[data-ag-hit]'))) return gotoHit(el.dataset.agHit);
      if ((el = t.closest('[data-ag-edit]'))) {
        const e = findEv(el.dataset.agEdit);
        if (e) openEditor(e.type, e);
        return;
      }
      if ((el = t.closest('[data-ag-lixa]'))) {
        const e = findEv(el.dataset.agLixa);
        closePop();
        closeSheet();
        if (!e || !window.__crmJobModal) return toast('Editor de job indisponível.', 'error');
        const m = e.meta || {};
        window.__crmJobModal
          .openScheduleLixa({
            id: e.id,
            number: m.number,
            title: e.title,
            sector: m.sector,
            status: e.status,
            customer_id: m.customer_id,
            builder_id: m.builder_id,
            source_type: m.source_type,
            source_name: m.source_name,
            address: e.address || m.address,
            notes: m.notes,
            scheduled_start: e.start && e.start.toISOString ? e.start.toISOString() : m.scheduled_start,
            scheduled_end: e.end && e.end.toISOString ? e.end.toISOString() : m.scheduled_end,
          })
          .catch((err) => toast(err.message, 'error'));
        return;
      }
      if ((el = t.closest('[data-ag-del]'))) {
        const e = findEv(el.dataset.agDel);
        closePop();
        if (e) cancelEvent(e);
        return;
      }
      if ((el = t.closest('[data-ag-del-ok]'))) {
        const e = findEv(el.dataset.agDelOk);
        el.disabled = true;
        try {
          await api(e.type === 'job' ? '/api/work-orders/' + encodeURIComponent(e.id) : '/api/meetings/' + encodeURIComponent(e.id), { method: 'DELETE' });
          closeSheet();
          toast('Cancelado', 'success');
          await reload();
        } catch (err) {
          el.disabled = false;
          toast(err.message, 'error');
        }
        return;
      }
      if ((el = t.closest('[data-ag-tap]'))) {
        ev.preventDefault();
        ev.stopPropagation();
        void beginFieldEdit(el);
        return;
      }
      if ((el = t.closest('[data-ag-notes-tog]'))) {
        const box = el.closest('.ag-dtl__notes');
        const panel = box && box.querySelector('.ag-dtl__notes-panel');
        if (!panel) return;
        const open = panel.hasAttribute('hidden');
        if (open) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
        box.classList.toggle('is-open', open);
        return;
      }
      if ((el = t.closest('[data-ag-save-notes]'))) {
        const kind = el.dataset.agSaveNotes;
        const id = el.dataset.agNotesId;
        const ta = document.querySelector(`[data-ag-notes="${CSS.escape(kind || '')}"][data-ag-notes-id="${CSS.escape(id || '')}"]`);
        if (!ta || !id) return;
        el.disabled = true;
        try {
          const notes = String(ta.value || '').trim() || null;
          if (kind === 'job') {
            await api('/api/work-orders/' + encodeURIComponent(id), { method: 'PUT', body: { notes } });
            const evn = findEv(id);
            if (evn) evn.meta.notes = notes;
          } else if (kind === 'meeting') {
            await api('/api/meetings/' + encodeURIComponent(id), { method: 'PUT', body: { notes } });
            const evn = findEv(id);
            if (evn) evn.meta.notes = notes;
          } else {
            await api('/api/leads/' + encodeURIComponent(id), { method: 'PUT', body: { notes } });
            S.events.forEach((e) => {
              if (e.meta && e.meta.lead && String(e.meta.lead.id) === String(id)) e.meta.lead.notes = notes;
              if (e.meta && String(e.meta.lead_id || '') === String(id) && e.meta.lead) e.meta.lead.notes = notes;
            });
          }
          toast('Notas guardadas', 'success');
          el.disabled = true;
        } catch (err) {
          el.disabled = false;
          toast(err.message, 'error');
        }
        return;
      }
      if ((el = t.closest('[data-ag-ev]'))) {
        if (window.__agSuppressEvClick) return;
        ev.stopPropagation();
        return openDetail(el.dataset.agEv, el);
      }
      if (!$('#agPop').hidden && !t.closest('#agPop')) {
        // Native <select> option clicks land "outside" the pop — don't abort mid-edit.
        if ($('#agPop [data-ag-editing]')) return;
        closePop();
      }
      if ((el = t.closest('[data-ag-view]'))) return setView(el.dataset.agView);
      if ((el = t.closest('[data-ag-act]'))) {
        const a = el.dataset.agAct;
        if (a === 'prev') return step(-1);
        if (a === 'next') return step(1);
        if (a === 'today') {
          S.cursor = sod(new Date());
          S.selected = sod(new Date());
          if (isPhone() && S.view === 'year') S.view = 'month';
          if (isPhone() && S.mmode === 'month' && $('#agMScroll')) {
            renderTitle();
            return scrollMMonthTo(S.cursor, true);
          }
          return go();
        }
        if (a === 'sidebar') return openCalSheet();
        if (a === 'list') return setView(S.view === 'list' ? 'month' : 'list');
        if (a === 'new') return openNewMenu(el);
        if (a === 'mback') {
          if (S.view === 'year') {
            S.view = 'month';
            S.mmode = 'month';
            S.cursor = sod(new Date());
          } else if (S.mmode === 'day') {
            S.mmode = 'month';
            S.cursor = new Date(S.selected.getFullYear(), S.selected.getMonth(), 1);
          } else {
            S.view = 'year';
          }
          S.mRange = null;
          return go();
        }
        if (a === 'mmode') {
          S.mmode = S.mmode === 'day' ? 'month' : 'day';
          if (S.mmode === 'day' && !sameDay(S.selected, S.cursor) && S.selected.getMonth() !== S.cursor.getMonth()) S.selected = sod(new Date());
          S.view = 'month';
          S.mRange = null;
          return go();
        }
        if (a === 'msearch') {
          openSheet(
            `<header class="ag-sheet__bar"><label class="ag-search ag-search--sheet"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input type="search" id="agMSearch" placeholder="Buscar eventos" autocomplete="off"/></label><button type="button" class="ag-pillbtn ag-pillbtn--ghost" data-ag-close>Fechar</button></header><div class="ag-sheet__body ag-results--sheet" id="agMResults"></div>`,
            'ag-sheet__card--search'
          );
          const i = $('#agMSearch');
          setTimeout(() => i.focus(), 60);
          let tm = null;
          i.addEventListener('input', () => {
            clearTimeout(tm);
            tm = setTimeout(() => runSearch(i.value, $('#agMResults')), 180);
          });
          return;
        }
        if (a === 'mcal') {
          const open = el.getAttribute('data-ag-cal-open') || 'filter';
          if (open === 'add' && canEditCals()) {
            const draft = ensureCalDraft();
            if (draft) {
              if (draft.length >= 24) return toast('Limite de agendas atingido.', 'error');
              draft.push({ id: newCalId(), name: 'Nova agenda', color: '#16a34a', kind: 'custom' });
            }
            return openCalSheet('edit');
          }
          return openCalSheet(open === 'edit' ? 'edit' : 'filter');
        }
        return;
      }
      if ((el = t.closest('[data-ag-goday]'))) {
        S.cursor = parseYmd(el.dataset.agGoday);
        S.selected = S.cursor;
        if (isPhone()) {
          S.view = 'month';
          S.mmode = 'day';
        } else S.view = 'day';
        return go();
      }
      if ((el = t.closest('[data-ag-gomonth]'))) {
        S.cursor = parseYmd(el.dataset.agGomonth);
        if (isPhone()) {
          S.view = 'month';
          S.mmode = 'month';
          S.mRange = null;
        } else S.view = 'month';
        return go();
      }
      if ((el = t.closest('[data-ag-daylist]'))) {
        ev.stopPropagation();
        return openDayEventsSheet(el.dataset.agDaylist);
      }
      if ((el = t.closest('[data-ag-mday]'))) {
        // Month phone: open event card / day list — never enter day view.
        if (t.closest('[data-ag-ev]')) return;
        return openDayEventsSheet(el.dataset.agMday);
      }
      if ((el = t.closest('[data-ag-strip]'))) return goDay(parseYmd(el.dataset.agStrip));
      if ((el = t.closest('[data-ag-users-all]'))) {
        S.filters.users = null;
        savePrefs();
        return render();
      }
      if ((el = t.closest('[data-ag-day]')) && !isPhone()) {
        // Keep selection in state for create shortcuts; no visual selection square.
        S.selected = parseYmd(el.dataset.agDay);
        return;
      }
      if ((el = t.closest('[data-ag-col]')) && !t.closest('.ag-blk')) {
        if (!S.canManage) return;
        const when = slotTimeFromClick(el, ev);
        return newMenu(ev.clientX, ev.clientY, when);
      }
    });

    document.addEventListener('dblclick', (ev) => {
      const el = ev.target.closest('[data-ag-day]');
      if (el && !ev.target.closest('[data-ag-ev]')) newMenu(ev.clientX, ev.clientY, parseYmd(el.dataset.agDay));
    });

    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.matches('[data-ag-notes]')) {
        const kind = t.getAttribute('data-ag-notes');
        const id = t.getAttribute('data-ag-notes-id');
        const btn = document.querySelector(`[data-ag-save-notes="${CSS.escape(kind || '')}"][data-ag-notes-id="${CSS.escape(id || '')}"]`);
        if (btn) btn.disabled = false;
      }
    });

    document.addEventListener('change', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.matches('[data-ag-inline]')) {
        void applyInlinePatch(t);
        return;
      }
      const kindI = t.getAttribute('data-ag-cal-kind');
      if (kindI != null && calDraft) {
        const i = Number(kindI);
        const row = calDraft[i];
        if (!row) return;
        row.kind = String(t.value || 'custom');
        if (row.kind === 'jobs') {
          if (!row.sector) row.sector = 'all';
        } else delete row.sector;
        return openCalSheet('edit');
      }
      const secI = t.getAttribute('data-ag-cal-sector');
      if (secI != null && calDraft) {
        const i = Number(secI);
        if (calDraft[i]) calDraft[i].sector = String(t.value || 'all');
        return;
      }
      const colI = t.getAttribute('data-ag-cal-color');
      if (colI != null && calDraft) {
        const i = Number(colI);
        const v = String(t.value || '').toLowerCase();
        if (calDraft[i] && /^#[0-9a-f]{6}$/.test(v)) {
          calDraft[i].color = v;
          const sw = t.closest('.ag-cal-card')?.querySelector('.ag-cal-card__sw');
          if (sw) sw.style.setProperty('--c', v);
        }
        return;
      }
      if (t.matches('[data-ag-cal]')) {
        S.filters.cals[t.dataset.agCal] = t.checked;
      } else if (t.matches('[data-ag-mine]')) {
        S.filters.mine = t.checked;
      } else if (t.matches('[data-ag-user]')) {
        if (!S.filters.users) S.filters.users = new Set();
        if (t.checked) S.filters.users.add(t.dataset.agUser);
        else S.filters.users.delete(t.dataset.agUser);
        if (!S.filters.users.size) S.filters.users = null;
      } else return;
      savePrefs();
      render();
    });

    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement) || !calDraft) return;
      const ni = t.getAttribute('data-ag-cal-name');
      if (ni == null) return;
      const i = Number(ni);
      if (calDraft[i]) calDraft[i].name = t.value;
    });

    document.addEventListener('focusout', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (!t.matches('[data-ag-inline="title"], [data-ag-inline="address"]')) return;
      // Delay so a click on another control can take over first.
      setTimeout(() => {
        if (!t.isConnected) return;
        if (document.activeElement && t.closest('[data-ag-editing]')?.contains(document.activeElement)) return;
        void applyInlinePatch(t);
      }, 120);
    });

    document.addEventListener('submit', async (ev) => {
      if (ev.target.id !== 'agForm') return;
      ev.preventDefault();
      const btn = $('[form="agForm"][type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await submitForm(ev.target);
      } catch (e) {
        toast(e.message, 'error');
        if (btn) btn.disabled = false;
      }
    });

    const si = $('#agSearch');
    let st = null;
    si.addEventListener('input', () => {
      clearTimeout(st);
      st = setTimeout(async () => {
        const box = $('#agResults');
        const any = await runSearch(si.value, box);
        if (!any) {
          box.hidden = true;
          return;
        }
        const r = si.getBoundingClientRect();
        box.style.top = r.bottom + 8 + 'px';
        box.style.left = Math.max(12, r.right - 380) + 'px';
        box.hidden = false;
      }, 180);
    });
    si.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = $('#agResults [data-ag-hit]');
        if (first) gotoHit(first.dataset.agHit);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#agMenu').hidden) return closeMenu();
        if (!$('#agSheet').hidden) return closeSheet();
        if (!$('#agPop').hidden) return closePop();
        if (!$('#agResults').hidden) return ($('#agResults').hidden = true);
      }
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (isPhone()) return;
      const k = e.key.toLowerCase();
      if (k === 'd') setView('day');
      else if (k === 'w' || k === 's') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 'y' || k === 'a') setView('year');
      else if (k === 't' || k === 'h') {
        S.cursor = sod(new Date());
        S.selected = S.cursor;
        go();
      } else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    });

    let lastPhone = isPhone();
    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        closePop();
        if (isPhone() !== lastPhone) {
          lastPhone = isPhone();
          S.mRange = null;
          go();
        } else render();
      }, 150);
    });
  }

  function calFilterHtml() {
    return `<p class="ag-cal-sec__lbl">Mostrar na agenda</p>
      <div class="ag-card ag-cal-toggles">${calList()
        .map(
          (c) =>
            `<label class="ag-cal-toggle" style="--c:${esc(c.color)}"><input type="checkbox" data-ag-cal="${esc(c.id)}" ${
              S.filters.cals[c.id] !== false ? 'checked' : ''
            }/><span class="ag-cal-toggle__sw"></span><span class="ag-cal-toggle__name">${esc(c.name)}</span></label>`,
        )
        .join('')}</div>
      ${
        S.me
          ? `<div class="ag-card ag-cal-toggles"><label class="ag-cal-toggle" style="--c:#211d1a"><input type="checkbox" data-ag-mine ${
              S.filters.mine ? 'checked' : ''
            }/><span class="ag-cal-toggle__sw"></span><span class="ag-cal-toggle__name">Só os meus eventos</span></label></div>`
          : ''
      }
      ${
        canEditCals()
          ? `<button type="button" class="ag-btn ag-btn--block" data-ag-cal-mode="edit">Editar agendas</button>`
          : ''
      }`;
  }

  function calEditHtml() {
    const draft = ensureCalDraft();
    if (!draft) return '';
    return `<p class="ag-cal-sec__lbl">Nome, tipo e cor de cada agenda</p>
      <div class="ag-cal-cards" data-ag-cal-manage>${draft
        .map((c, i) => {
          const kind = c.kind || 'custom';
          const sector = c.sector || 'all';
          return `<article class="ag-cal-card" data-ag-cal-i="${i}">
            <div class="ag-cal-card__top">
              <label class="ag-cal-card__sw" style="--c:${esc(c.color)}" title="Cor">
                <input type="color" data-ag-cal-color="${i}" value="${esc(c.color)}" aria-label="Cor" />
              </label>
              <input type="text" class="ag-cal-card__title" data-ag-cal-name="${i}" maxlength="80" value="${esc(c.name)}" placeholder="Nome da agenda" aria-label="Nome" />
              <button type="button" class="ag-cal-card__del" data-ag-cal-del="${i}" aria-label="Remover agenda" title="Remover">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg>
              </button>
            </div>
            <div class="ag-cal-card__grid">
              <label class="ag-cal-field"><span>Tipo</span>
                <select data-ag-cal-kind="${i}">${CAL_KINDS.map(
                  (k) => `<option value="${k.id}" ${k.id === kind ? 'selected' : ''}>${esc(k.label)}</option>`,
                ).join('')}</select>
              </label>
              ${
                kind === 'jobs'
                  ? `<label class="ag-cal-field"><span>Setor</span>
                      <select data-ag-cal-sector="${i}">${CAL_SECTORS.map(
                        (s) => `<option value="${s.id}" ${s.id === sector ? 'selected' : ''}>${esc(s.label)}</option>`,
                      ).join('')}</select>
                    </label>`
                  : `<div class="ag-cal-field ag-cal-field--spacer" aria-hidden="true"></div>`
              }
            </div>
          </article>`;
        })
        .join('')}</div>
      <button type="button" class="ag-cal-add" data-ag-cal-add>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        Nova agenda
      </button>`;
  }

  function openCalSheet(mode) {
    const wantsEdit = mode === 'edit' && canEditCals();
    calSheetMode = wantsEdit ? 'edit' : 'filter';
    if (calSheetMode === 'edit') ensureCalDraft();
    else if (!calDraft) ensureCalDraft();

    const editing = calSheetMode === 'edit';
    const title = editing ? 'Editar agendas' : 'Calendários';
    const left = editing
      ? `<button type="button" class="ag-pillbtn ag-pillbtn--ghost" data-ag-cal-mode="filter">Voltar</button>`
      : `<button type="button" class="ag-pillbtn ag-pillbtn--ghost" data-ag-close>Fechar</button>`;
    const right = editing
      ? `<button type="button" class="ag-pillbtn ag-pillbtn--pri" data-ag-cal-save>Salvar</button>`
      : `<button type="button" class="ag-pillbtn ag-pillbtn--pri" data-ag-close>OK</button>`;

    openSheet(
      `<header class="ag-sheet__bar">${left}<h2>${esc(title)}</h2>${right}</header>
       <div class="ag-sheet__body ag-cal-sheet" data-ag-cal-sheet data-ag-cal-view="${calSheetMode}">
         ${editing ? calEditHtml() : calFilterHtml()}
       </div>`,
      'ag-sheet__card--form ag-sheet__card--cals',
    );
  }

  async function saveCalDraft() {
    const draft = ensureCalDraft();
    if (!draft) return;
    if (!draft.length) return toast('Mantenha ao menos uma agenda.', 'error');
    if (draft.length > 24) return toast('Limite de agendas atingido.', 'error');
    for (const c of draft) {
      if (!String(c.name || '').trim()) return toast('Cada agenda precisa de um nome.', 'error');
      if (!/^#[0-9A-Fa-f]{6}$/.test(String(c.color || ''))) return toast('Use cores no formato #RRGGBB.', 'error');
    }
    try {
      const j = await api('/api/settings/schedule', {
        method: 'PUT',
        body: {
          calendars: draft.map((c) => ({
            id: c.id,
            name: String(c.name).trim(),
            color: String(c.color).toLowerCase(),
            kind: c.kind || 'custom',
            ...(c.kind === 'jobs' ? { sector: c.sector || 'all' } : {}),
          })),
        },
      });
      S.calendars = (j.data && j.data.calendars) || draft;
      calDraft = cloneCalDraft(S.calendars);
      toast('Agendas salvas', 'success');
      if (!isPhone() && S.sidebar) renderSide();
      render();
      openCalSheet('filter');
    } catch (err) {
      toast(err.message || 'Não foi possível salvar as agendas.', 'error');
    }
  }

  function openNewMenu(anchorEl) {
    if (!S.canManage) return toast('Sem permissão para agendar.', 'error');
    const base = isPhone() && S.mmode === 'day' ? new Date(S.selected) : S.view === 'day' ? new Date(S.cursor) : null;
    if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect();
      return newMenu(r.left, r.bottom + 8, base);
    }
    return newMenu(window.innerWidth / 2, window.innerHeight * 0.42, base);
  }

  window.__agendaOpenNew = () => openNewMenu(null);

  // ---------------------------------------------------------------- boot
  async function boot() {
    loadPrefs();
    const p = new URLSearchParams(location.search);
    const date = parseYmd(p.get('date'));
    const focus = p.get('focus') ? new Date(p.get('focus')) : null;
    if (date) S.cursor = S.selected = date;
    if (focus && !Number.isNaN(focus.getTime())) {
      S.cursor = S.selected = sod(focus);
      S.view = 'day';
      if (isPhone()) S.mmode = 'day';
    }
    const v = p.get('view');
    if (v && ['day', 'week', 'month', 'year', 'list'].includes(v)) S.view = v;
    if (isPhone() && S.view !== 'year') S.view = 'month';
    S.pendingEvent = p.get('event');

    try {
      const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
      if (!sess || !sess.authenticated) {
        location.href = '/login.html';
        return;
      }
      S.me = sess.user || null;
      const perms = (S.me && S.me.permissions) || [];
      const role = String((S.me && (S.me.role || S.me.roleKey)) || '').toLowerCase();
      S.canManage =
        perms.includes('schedule.manage') ||
        perms.includes('work_orders.manage') ||
        perms.includes('*') ||
        role === 'admin';
      const un = $('#sidebarUserName');
      if (un && S.me) un.textContent = S.me.name || S.me.email;
    } catch (_) {
      toast('Sem conexão. Tente de novo.', 'error');
    }
    document.body.classList.toggle('ag-readonly', !S.canManage);
    wire();
    if (window.__crmJobModal) {
      window.__crmJobModal.ready
        .then(() => window.__crmJobModal.onSaved(() => reload().catch(() => {})))
        .catch(() => {});
    }
    ensureUsers().then(() => !isPhone() && S.sidebar && renderSide());
    api('/api/settings/schedule')
      .then((j) => {
        S.calendars = (j.data && j.data.calendars) || [];
        if (!isPhone() && S.sidebar) renderSide();
      })
      .catch(() => {});
    await go();
    const nw = p.get('new');
    if (nw && S.canManage) {
      const clearNew = () => {
        try {
          const u = new URL(location.href);
          u.searchParams.delete('new');
          history.replaceState(null, '', u.pathname + u.search + u.hash);
        } catch (_) {}
      };
      if (nw === '1' || nw === 'menu' || nw === 'add') {
        clearNew();
        setTimeout(() => openNewMenu(null), 80);
      } else {
        openEditor(nw === 'job' ? 'job' : nw === 'meeting' ? 'meeting' : 'visit', null, focus || null);
        clearNew();
      }
    }
    if (S.pendingEvent) setTimeout(() => openDetail(S.pendingEvent, $(`[data-ag-ev="${CSS.escape(S.pendingEvent)}"]`)), 80);
    const lo = $('#logoutBtn');
    if (lo)
      lo.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        location.href = '/login.html';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
