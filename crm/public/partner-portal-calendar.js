/**
 * ObraBuilder calendar: the ObraMate calendar for builders.
 * Same layout and stylesheet (agenda.css): Day, Week, Month and Year on computer and tablet, with
 * mini calendar, company filter and day panel; continuous months and a day timeline on the phone.
 * Read-only: each company schedules its own jobs, so there is no create, drag or inline edit here.
 */
(function () {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const HOUR_PX = 52;
  const PREFS_KEY = 'pp_calendar_prefs';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  /** One colour per company; the company name always goes with it, so colour never carries meaning alone. */
  const CO_COLORS = ['#B4561A', '#3F6C8A', '#536249', '#7A5C99', '#A8862D', '#8A7460', '#221E1A', '#A23B55'];

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
  const isPhone = () => window.matchMedia('(max-width: 767px)').matches;
  const fmtTime = (d) => {
    const m = d.getMinutes();
    const h12 = d.getHours() % 12 || 12;
    const ap = d.getHours() < 12 ? 'AM' : 'PM';
    return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
  };
  const fmtHour = (h) => (h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`);
  const fmtShort = (d) => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  const fmtLong = (d) => `${WDL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const JOB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v11H4z"/><path d="M9 8V5h6v3"/></svg>';
  const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0112 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>';
  const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>';
  const CAL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 3v3M16 3v3"/></svg>';

  const S = {
    host: null,
    opts: {},
    view: 'month',
    mmode: 'month',
    cursor: sod(new Date()),
    selected: sod(new Date()),
    sidebar: window.innerWidth >= 1280,
    dayPanel: window.innerWidth >= 1280,
    hidden: new Set(),
    all: [],
    events: [],
    companies: [],
    mRange: null,
    returnFocus: null,
  };

  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (['day', 'week', 'month', 'year'].includes(p.view)) S.view = p.view;
    if (typeof p.sidebar === 'boolean') S.sidebar = p.sidebar;
    if (typeof p.dayPanel === 'boolean') S.dayPanel = p.dayPanel;
    if (Array.isArray(p.hidden)) S.hidden = new Set(p.hidden.map(String));
  } catch (_) { /* preferences are optional */ }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view: S.view, sidebar: S.sidebar, dayPanel: S.dayPanel, hidden: Array.from(S.hidden) }));
    } catch (_) { /* preferences are optional */ }
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const mounted = () => Boolean(S.host && S.host.isConnected && $('#agStage', S.host));

  /* ------------------------------------------------------------ data */

  function mixHex(hex, white) {
    const h = String(hex).replace('#', '');
    const mix = (c) => Math.round(parseInt(c, 16) * (1 - white) + 255 * white).toString(16).padStart(2, '0');
    return `#${mix(h.slice(0, 2))}${mix(h.slice(2, 4))}${mix(h.slice(4, 6))}`;
  }
  const evStyle = (e) => `--ev:${e.color};--ev-bg:${mixHex(e.color, 0.88)};--ev-bg2:${mixHex(e.color, 0.78)};--ev-ink:#221e1a`;
  const toneCls = (e) => (e.allDay ? 'is-allday' : 'is-timed');

  /** "840 S Race St, Denver" becomes "840 Race", so a chip on the grid still names the place. */
  function streetChip(address) {
    const tokens = String(address || '').split(',')[0].trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    const dirs = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west']);
    let i = 0;
    let number = '';
    if (/^\d/.test(tokens[0])) { number = tokens[0]; i = 1; }
    while (i < tokens.length - 1 && dirs.has(tokens[i].toLowerCase().replace('.', ''))) i += 1;
    return [number, tokens[i] && i < tokens.length ? tokens[i] : ''].filter(Boolean).join(' ') || tokens.slice(0, 2).join(' ');
  }

  function normalize(job, colorOf) {
    let start = new Date(job.scheduledStart);
    if (Number.isNaN(start.getTime())) return null;
    let end = new Date(job.scheduledEnd || job.scheduledStart);
    if (!(end > start)) end = new Date(start.getTime() + 3600e3);
    if (job.allDay) {
      // All-day dates are stored at UTC midnight: read them in UTC so they don't slip to the day before.
      const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
      const b = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
      start = new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
      end = addDays(start, Math.max(1, Math.round((b - a) / DAY)));
    }
    const lastDay = sod(new Date(end.getTime() - 1));
    return {
      id: String(job.id),
      job,
      title: job.title || streetChip(job.address) || 'Job',
      address: String(job.address || '').trim(),
      number: job.number || '',
      status: job.status,
      company: job._co ? String(job._co) : '',
      companyName: job._coName || '',
      color: colorOf(job),
      start,
      end,
      lastDay,
      allDay: Boolean(job.allDay) || !sameDay(start, lastDay),
    };
  }

  const findEv = (id) => S.all.find((e) => e.id === String(id));
  const multiCo = () => S.companies.length > 1;
  function applyFilter() {
    S.events = S.all.filter((e) => !e.company || !S.hidden.has(e.company));
  }
  const eventsOnDay = (d) => {
    const a = sod(d);
    const b = addDays(a, 1);
    return S.events
      .filter((e) => e.start < b && e.end > a)
      .sort((x, y) => y.allDay - x.allDay || x.start - y.start || x.id.localeCompare(y.id));
  };
  const stageText = (e) => (S.opts.stageOf ? S.opts.stageOf(e.job) : '');
  const subLine = (e) => [multiCo() ? e.companyName : '', e.address.split(',').slice(0, 2).join(',')].filter(Boolean).join(' · ');

  /* ------------------------------------------------------------ layout helpers */

  function weekBars(weekStart, days) {
    const weekEnd = addDays(weekStart, days);
    const bars = S.events
      .filter((e) => e.allDay && e.start < weekEnd && e.end > weekStart)
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .map((e) => ({
        e,
        s: Math.max(0, Math.round((sod(e.start) - weekStart) / DAY)),
        en: Math.min(days - 1, Math.round((e.lastDay - weekStart) / DAY)),
        contL: e.start < weekStart,
        contR: e.lastDay >= weekEnd,
      }));
    const lanes = [];
    bars.forEach((b) => {
      let lane = lanes.findIndex((l) => l.every((x) => x.en < b.s || x.s > b.en));
      if (lane < 0) { lanes.push([]); lane = lanes.length - 1; }
      lanes[lane].push(b);
      b.lane = lane;
    });
    return { bars, lanes: lanes.length };
  }

  /** Overlapping timed jobs of one day sit side by side. */
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
        if (c < 0) { cols.push([]); c = cols.length - 1; }
        cols[c].push(it);
        it.col = c;
      });
      cluster.forEach((it) => { it.cols = cols.length; });
      cluster = [];
      clusterEnd = -1;
    };
    items.forEach((it) => {
      if (cluster.length && it.top >= clusterEnd) flush();
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.bottom);
    });
    if (cluster.length) flush();
    return items;
  }

  function blockHtml(p) {
    const e = p.e;
    const h = (p.bottom - p.top) * HOUR_PX;
    const size = h < 30 ? ' is-short' : h < 48 ? ' is-compact' : '';
    const meta = [fmtTime(e.start), streetChip(e.address)].filter(Boolean).join(' · ');
    return `<button type="button" class="ag-blk ${toneCls(e)}${size}${e.status === 'completed' ? ' is-done' : ''}" data-ag-ev="${esc(e.id)}" style="${evStyle(e)};top:${p.top * HOUR_PX}px;height:${Math.max(16, h - 2)}px;left:calc(${(p.col / p.cols) * 100}% + 2px);width:calc(${100 / p.cols}% - 4px)"><b>${esc(e.title)}</b>${h >= 30 ? `<small>${esc(meta)}</small>` : ''}</button>`;
  }
  const nowLine = (d) => `<div class="ag-now" style="top:${((Date.now() - d) / 3600e3) * HOUR_PX}px"></div>`;
  function scrollToWork(firstHours) {
    const sc = $('#agScroll', S.host);
    if (sc) sc.scrollTop = Math.max(0, (Math.min(7, firstHours.length ? Math.min(...firstHours) : 7) - 0.5) * HOUR_PX);
  }

  /* ------------------------------------------------------------ render */

  function render() {
    if (!mounted()) return;
    const root = $('#ag', S.host);
    const phone = isPhone();
    root.classList.toggle('is-phone', phone);
    root.dataset.view = phone ? (S.view === 'year' ? 'year' : S.mmode === 'day' ? 'mday' : 'mmonth') : S.view;
    $$('.ag-seg [data-ag-view]', root).forEach((b) => {
      const on = b.dataset.agView === S.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const side = $('#agSide', root);
    side.hidden = phone || !S.sidebar;
    if (!side.hidden) renderSide();
    const railL = $('#agRailLeft', root);
    railL.hidden = phone;
    railL.classList.toggle('is-open', S.sidebar && !phone);
    railL.setAttribute('aria-pressed', String(S.sidebar && !phone));
    railL.title = S.sidebar ? 'Hide the side calendar' : 'Show the side calendar';
    const dayOk = !phone && ['month', 'week', 'day'].includes(S.view);
    const railR = $('#agRailRight', root);
    railR.hidden = !dayOk;
    railR.classList.toggle('is-open', S.dayPanel && dayOk);
    railR.setAttribute('aria-pressed', String(S.dayPanel && dayOk));
    railR.title = S.dayPanel ? 'Hide the day panel' : 'Show the day panel';
    $('.ag-mcal', root).hidden = !multiCo();
    $('.pp-cal-cobtn', root).hidden = !multiCo() || !side.hidden;
    renderTitle();
    if (phone) {
      if (S.view === 'year') renderYear();
      else if (S.mmode === 'day') renderMDay();
      else renderMonths();
    } else if (S.view === 'day') renderTimeGrid(1);
    else if (S.view === 'week') renderTimeGrid(7);
    else if (S.view === 'year') renderYear();
    else renderMonths();
    renderDayPanel();
    if (!S.events.length) {
      const stage = $('#agStage', root);
      stage.insertAdjacentHTML('beforeend', `<p class="ag-empty ag-empty--float pp-cal-none">${S.all.length ? 'All companies are hidden. Turn one back on to see its jobs.' : 'Nothing scheduled yet. Jobs show up here when the company schedules them.'}</p>`);
    }
  }

  function renderTitle() {
    const c = S.cursor;
    const t = $('#agTitle', S.host);
    const back = $('#agMBackLabel', S.host);
    if (isPhone()) {
      if (S.view === 'year') {
        t.textContent = String(c.getFullYear());
        back.textContent = 'Today';
      } else if (S.mmode === 'day') {
        t.innerHTML = `${WDL[S.selected.getDay()]}, <span>${MONTHS[S.selected.getMonth()]} ${S.selected.getDate()}</span>`;
        back.textContent = MONTHS[S.selected.getMonth()];
      } else {
        t.textContent = MONTHS[c.getMonth()];
        back.textContent = String(c.getFullYear());
      }
      return;
    }
    if (S.view === 'year') t.innerHTML = `<b>${c.getFullYear()}</b>`;
    else if (S.view === 'day') t.innerHTML = `<b>${MONTHS[c.getMonth()]} ${c.getDate()}</b> ${c.getFullYear()} <small>${WDL[c.getDay()]}</small>`;
    else if (S.view === 'week') {
      const a = startOfWeek(c);
      const b = addDays(a, 6);
      t.innerHTML = a.getMonth() === b.getMonth()
        ? `<b>${MONTHS[a.getMonth()]}</b> ${a.getFullYear()}`
        : `<b>${MONTHS[a.getMonth()].slice(0, 3)} – ${MONTHS[b.getMonth()].slice(0, 3)}</b> ${b.getFullYear()}`;
    } else t.innerHTML = `<b>${MONTHS[c.getMonth()]}</b> ${c.getFullYear()}`;
  }

  function renderTimeGrid(n) {
    const start = n === 1 ? sod(S.cursor) : startOfWeek(S.cursor);
    const days = Array.from({ length: n }, (_, i) => addDays(start, i));
    const today = sod(new Date());
    const { bars, lanes } = weekBars(start, n);
    const head = `<div class="ag-tg__head" style="--n:${n}"><div class="ag-tg__gutter"></div>${days.map((d) => `<div class="ag-tg__dhwrap"><button type="button" class="ag-tg__dh${sameDay(d, today) ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-we' : ''}" data-ag-goday="${ymd(d)}"><span>${WD[d.getDay()]}</span><b>${d.getDate()}</b></button></div>`).join('')}</div>
      <div class="ag-tg__all" style="--n:${n};height:${Math.max(1, lanes) * 22 + 8}px"><div class="ag-tg__gutter"><small>all day</small></div><div class="ag-tg__allin">${bars.map((b) => `<button type="button" class="ag-bar is-allday${b.contL ? ' cont-l' : ''}${b.contR ? ' cont-r' : ''}" data-ag-ev="${esc(b.e.id)}" style="${evStyle(b.e)};--s:${b.s};--n:${b.en - b.s + 1};--lane:${b.lane};--cols:${n}"><span class="ag-bar__ic">${JOB_ICON}</span><span>${esc(b.e.title)}</span></button>`).join('')}</div></div>`;
    let grid = `<div class="ag-tg__scroll" id="agScroll"><div class="ag-tg__grid" style="--n:${n};height:${24 * HOUR_PX}px"><div class="ag-tg__hours">${Array.from({ length: 24 }, (_, h) => `<div style="top:${h * HOUR_PX}px">${h ? esc(fmtHour(h)) : ''}</div>`).join('')}</div>`;
    days.forEach((d, i) => {
      const packed = packDay(eventsOnDay(d).filter((e) => !e.allDay), d);
      grid += `<div class="ag-tg__col${d.getDay() === 0 || d.getDay() === 6 ? ' is-we' : ''}" style="--i:${i}">${packed.map(blockHtml).join('')}${sameDay(d, today) ? nowLine(d) : ''}</div>`;
    });
    grid += '</div></div>';
    $('#agStage', S.host).innerHTML = `<div class="ag-tg${n === 1 ? ' ag-tg--day' : ''}"><div class="ag-tg__main">${head}${grid}</div></div>`;
    scrollToWork(days.flatMap((d) => eventsOnDay(d).filter((e) => !e.allDay && sameDay(e.start, d)).map((e) => e.start.getHours())));
  }

  function colorsByDay() {
    const map = {};
    S.events.forEach((e) => {
      for (let d = sod(e.start); d <= e.lastDay; d = addDays(d, 1)) {
        const k = ymd(d);
        map[k] = map[k] || [];
        if (!map[k].includes(e.color)) map[k].push(e.color);
      }
    });
    return map;
  }

  function miniMonthHtml(month, opts, colors) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gs = startOfWeek(first);
    const today = sod(new Date());
    const name = opts.short ? MONTHS[month.getMonth()].slice(0, 3) : MONTHS[month.getMonth()] + (opts.year ? ` ${month.getFullYear()}` : '');
    const titleEl = `<button type="button" class="ag-mini__t" data-ag-gomonth="${ymd(first)}">${esc(name)}</button>`;
    const nav = opts.nav
      ? `<div class="ag-mini__nav"><button type="button" class="ag-mini__navbtn" data-ag-mini-nav="-1" aria-label="Previous month">‹</button>${titleEl}<button type="button" class="ag-mini__navbtn" data-ag-mini-nav="1" aria-label="Next month">›</button></div>`
      : titleEl;
    let html = `<div class="ag-mini${opts.cls ? ` ${opts.cls}` : ''}">${nav}<div class="ag-mini__g">${WD1.map((w) => `<span class="ag-mini__wd">${w}</span>`).join('')}`;
    for (let i = 0; i < 42; i++) {
      const d = addDays(gs, i);
      if (i >= 35 && d.getMonth() !== month.getMonth()) break;
      const out = d.getMonth() !== month.getMonth();
      const k = ymd(d);
      const list = !out && colors[k] ? colors[k].slice(0, 4) : [];
      const dots = list.length ? `<span class="ag-mini__dots" aria-hidden="true">${list.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>` : '';
      const label = `${fmtLong(d)}${list.length ? ', has jobs' : ''}`;
      html += `<button type="button" class="ag-mini__d${out ? ' is-out' : ''}${sameDay(d, today) ? ' is-today' : ''}${sameDay(d, S.selected) && !out ? ' is-sel' : ''}${list.length ? ' has-ev' : ''}" data-ag-goday="${k}" aria-label="${esc(label)}">${out && opts.hideOut ? '' : d.getDate()}${dots}</button>`;
    }
    return `${html}</div></div>`;
  }

  function renderYear() {
    const y = S.cursor.getFullYear();
    const colors = colorsByDay();
    let html = '<div class="ag-year">';
    for (let m = 0; m < 12; m++) html += miniMonthHtml(new Date(y, m, 1), { cls: 'ag-mini--year', hideOut: true, short: isPhone() }, colors);
    $('#agStage', S.host).innerHTML = `${html}</div>`;
  }

  function dayPanelHtml(d) {
    const list = eventsOnDay(d);
    const rows = list.map((e) => {
      const t1 = e.allDay ? 'all day' : fmtTime(e.start);
      const t2 = e.allDay && !sameDay(e.start, e.lastDay) ? `${fmtShort(e.start)} – ${fmtShort(e.lastDay)}` : '';
      return `<button type="button" class="ag-dp__it${e.status === 'completed' ? ' is-done' : ''}" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><time>${esc(t1)}${t2 ? `<small>${esc(t2)}</small>` : ''}</time><i></i><span class="ag-dp__b ${toneCls(e)}"><em>${esc(stageText(e))}</em><b>${esc(e.title)}</b>${subLine(e) ? `<small>${esc(subLine(e))}</small>` : ''}</span></button>`;
    }).join('');
    return `<div class="ag-dp__hd"><h3>${sameDay(d, new Date()) ? 'Today · ' : ''}${esc(WDL[d.getDay()])}, ${esc(fmtShort(d))}</h3><p>${list.length ? plural(list.length, 'job', 'jobs') : 'Nothing scheduled'}</p></div><div class="ag-dp__list">${list.length ? rows : '<p class="ag-empty">No jobs on this day.</p>'}</div>`;
  }
  function renderDayPanel() {
    const panel = $('#agDayPanel', S.host);
    const show = !isPhone() && S.dayPanel && ['month', 'week', 'day'].includes(S.view);
    panel.hidden = !show;
    if (show) panel.innerHTML = dayPanelHtml(S.view === 'day' ? sod(S.cursor) : S.selected);
  }

  function companyChecksHtml() {
    const counts = {};
    S.all.forEach((e) => { counts[e.company] = (counts[e.company] || 0) + 1; });
    return S.companies.map((c) => `<label class="ag-check" style="--c:${esc(c.color)}"><input type="checkbox" data-ag-co="${esc(c.id)}" ${S.hidden.has(c.id) ? '' : 'checked'}/><span class="ag-check__box"></span>${esc(c.name)}<small>${counts[c.id] || 0}</small></label>`).join('');
  }
  function renderSide() {
    const today = sod(new Date());
    const n = eventsOnDay(today).length;
    $('#agSide', S.host).innerHTML = `${miniMonthHtml(S.cursor, { year: true, nav: true }, colorsByDay())}
      <button type="button" class="ag-today-blk" data-ag-goday="${ymd(today)}" title="Open today"><span class="ag-today-blk__t">Today · ${esc(WD[today.getDay()])} ${today.getDate()}</span><span class="ag-today-blk__g"><span><b>${n}</b>${n === 1 ? 'job' : 'jobs'}</span></span></button>
      ${multiCo() ? `<div class="ag-side__sec"><h3>Companies</h3>${companyChecksHtml()}</div>` : ''}`;
  }

  function monthSectionHtml(m) {
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const lead = first.getDay();
    const weeks = Math.ceil((daysIn + lead) / 7);
    const today = sod(new Date());
    const maxLanes = 3;
    let html = `<section class="ag-mm" data-ag-month="${ymd(first)}"><h2 class="ag-mm__t" style="--col:${lead}"><span>${MONTHS[m.getMonth()].slice(0, 3)}</span></h2>`;
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(first, w * 7 - lead);
      const { bars } = weekBars(ws, 7);
      const lanesAll = bars.reduce((mx, b) => Math.max(mx, b.lane + 1), 0);
      html += '<div class="ag-mw">';
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        if (d.getMonth() !== m.getMonth()) { html += '<div class="ag-md is-blank"></div>'; continue; }
        const dayList = eventsOnDay(d);
        const timed = dayList.filter((e) => !e.allDay);
        const room = Math.max(0, maxLanes - Math.min(lanesAll, maxLanes));
        const show = timed.slice(0, room);
        const more = timed.length - show.length + bars.filter((b) => b.lane >= maxLanes && b.s <= i && b.en >= i).length;
        const colors = [...new Set(dayList.map((e) => e.color))].slice(0, 4);
        const dots = colors.length ? `<span class="ag-md__dots" aria-hidden="true">${colors.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>` : '';
        const label = `${fmtLong(d)}, ${dayList.length ? plural(dayList.length, 'job', 'jobs') : 'no jobs'}`;
        html += `<div class="ag-md${i === 0 || i === 6 ? ' is-we' : ''}${sameDay(d, S.selected) ? ' is-sel' : ''}" data-ag-mday="${ymd(d)}" role="button" tabindex="0" aria-label="${esc(label)}"><span class="ag-md__top"><span class="ag-md__n${sameDay(d, today) ? ' is-today' : ''}">${d.getDate()}</span>${dots}</span>
          <span class="ag-md__list" style="margin-top:${Math.min(lanesAll, maxLanes) * 19}px">${show.map((e) => `<button type="button" class="ag-pill ${toneCls(e)}" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i>${JOB_ICON}</i><span>${esc(e.title)}</span></button>`).join('')}${more > 0 ? `<button type="button" class="ag-pill ag-pill--more" data-ag-daylist="${ymd(d)}">+${more}</button>` : ''}</span></div>`;
      }
      html += `<div class="ag-bars ag-bars--m">${bars.filter((b) => b.lane < maxLanes).map((b) => {
        // Keep the bar inside this month's days.
        let s = b.s;
        let en = b.en;
        while (s <= en && addDays(ws, s).getMonth() !== m.getMonth()) s += 1;
        while (en >= s && addDays(ws, en).getMonth() !== m.getMonth()) en -= 1;
        if (en < s) return '';
        return `<button type="button" class="ag-bar is-allday${b.contL || s > b.s ? ' cont-l' : ''}${b.contR || en < b.en ? ' cont-r' : ''}" data-ag-ev="${esc(b.e.id)}" style="${evStyle(b.e)};--s:${s};--n:${en - s + 1};--lane:${b.lane}"><span class="ag-bar__ic">${JOB_ICON}</span><span>${esc(b.e.title)}</span></button>`;
      }).join('')}</div></div>`;
    }
    return `${html}</section>`;
  }

  const relTop = (el, sc) => el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  function scrollToMonth(month, smooth) {
    const sc = $('#agMScroll', S.host);
    const sec = sc && sc.querySelector(`[data-ag-month="${ymd(new Date(month.getFullYear(), month.getMonth(), 1))}"]`);
    if (sec) sc.scrollTo({ top: relTop(sec, sc) - 2, behavior: smooth ? 'smooth' : 'auto' });
  }
  function renderMonths(keepScroll) {
    if (!S.mRange) S.mRange = { from: addMonths(S.cursor, -3), to: addMonths(S.cursor, 9) };
    const stage = $('#agStage', S.host);
    const prev = $('#agMScroll', S.host);
    const prevTop = prev ? prev.scrollTop : 0;
    const prevH = prev ? prev.scrollHeight : 0;
    let html = `<div class="ag-mwd">${WD1.map((w, i) => `<span class="${i === 0 || i === 6 ? 'is-we' : ''}">${w}</span>`).join('')}</div><div class="ag-mscroll" id="agMScroll">`;
    for (let m = new Date(S.mRange.from); m <= S.mRange.to; m = addMonths(m, 1)) html += monthSectionHtml(m);
    stage.innerHTML = `${html}</div>`;
    const sc = $('#agMScroll', S.host);
    if (keepScroll === 'prepend') sc.scrollTop = prevTop + (sc.scrollHeight - prevH);
    else if (keepScroll) sc.scrollTop = prevTop;
    else scrollToMonth(S.cursor, false);
    let ticking = false;
    sc.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!sc.isConnected) return;
        // The title follows the month in view.
        const top = sc.scrollTop + 40;
        let cur = null;
        $$('.ag-mm', sc).forEach((s) => { if (!cur || relTop(s, sc) <= top) cur = s; });
        const d = cur && parseYmd(cur.dataset.agMonth);
        if (d && (d.getMonth() !== S.cursor.getMonth() || d.getFullYear() !== S.cursor.getFullYear())) {
          S.cursor = d;
          renderTitle();
          if (!isPhone() && S.sidebar) renderSide();
        }
        if (sc.scrollTop < 300) {
          S.mRange.from = addMonths(S.mRange.from, -6);
          renderMonths('prepend');
        } else if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 400) {
          S.mRange.to = addMonths(S.mRange.to, 6);
          renderMonths(true);
        }
      });
    }, { passive: true });
  }

  function renderMDay() {
    const d = S.selected;
    const ws = startOfWeek(d);
    const today = sod(new Date());
    const list = eventsOnDay(d);
    const all = list.filter((e) => e.allDay);
    const packed = packDay(list.filter((e) => !e.allDay), d);
    const strip = Array.from({ length: 7 }, (_, i) => {
      const x = addDays(ws, i);
      return `<button type="button" class="ag-strip__d${sameDay(x, d) ? ' is-sel' : ''}${sameDay(x, today) ? ' is-today' : ''}" data-ag-strip="${ymd(x)}" aria-label="${esc(fmtLong(x))}"><small>${WD1[i]}</small><b>${x.getDate()}</b><i class="${eventsOnDay(x).length ? 'has' : ''}"></i></button>`;
    }).join('');
    $('#agStage', S.host).innerHTML = `<div class="ag-strip">${strip}</div><div class="ag-mday" id="agMDay">
      ${all.length ? `<div class="ag-mday__all">${all.map((e) => `<button type="button" class="ag-pill ag-pill--wide is-allday" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i>${JOB_ICON}</i><span>${esc(e.title)}</span><small>${esc(fmtShort(e.start))} – ${esc(fmtShort(e.lastDay))}</small></button>`).join('')}</div>` : ''}
      <div class="ag-mday__scroll" id="agScroll"><div class="ag-mday__grid" style="height:${24 * HOUR_PX}px">${Array.from({ length: 24 }, (_, h) => `<div class="ag-mday__h" style="top:${h * HOUR_PX}px"><span>${h ? esc(fmtHour(h)) : ''}</span></div>`).join('')}<div class="ag-mday__col">${packed.map(blockHtml).join('')}${sameDay(d, today) ? nowLine(d) : ''}</div></div></div>
      ${!list.length && S.events.length ? '<p class="ag-empty ag-empty--float">Nothing scheduled on this day.</p>' : ''}</div>`;
    scrollToWork(packed.map((p) => p.top));
    // Swipe left or right to change day.
    let x0 = null;
    const box = $('#agMDay', S.host);
    box.addEventListener('touchstart', (ev) => { x0 = ev.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', (ev) => {
      if (x0 == null) return;
      const dx = ev.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 60) { S.selected = addDays(S.selected, dx < 0 ? 1 : -1); S.cursor = S.selected; render(); }
    }, { passive: true });
  }

  /* ------------------------------------------------------------ sheets */

  function layer() {
    let el = document.getElementById('ppCalLayer');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ppCalLayer';
    el.innerHTML = '<div class="ag-sheet" id="agSheet" hidden><div class="ag-sheet__backdrop" data-ag-close></div><div class="ag-sheet__card" role="dialog" aria-modal="true" aria-label="Calendar details"></div></div><div class="ag-menu" id="agMenu" hidden></div><div class="ag-results" id="agResults" hidden></div>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    return el;
  }
  function openSheet(html, cls) {
    const sh = $('#agSheet', layer());
    const card = $('.ag-sheet__card', sh);
    S.returnFocus = S.returnFocus || document.activeElement;
    card.className = `ag-sheet__card${cls ? ` ${cls}` : ''}`;
    card.innerHTML = html;
    sh.hidden = false;
    document.body.classList.add('ag-sheet-open');
    requestAnimationFrame(() => {
      sh.classList.add('is-open');
      const first = $('[data-ag-close]', card);
      if (first) first.focus({ preventScroll: true });
    });
  }
  function closeSheet() {
    const sh = document.getElementById('agSheet');
    if (!sh || sh.hidden) return;
    sh.classList.remove('is-open');
    document.body.classList.remove('ag-sheet-open');
    setTimeout(() => {
      if (!sh.classList.contains('is-open')) { sh.hidden = true; $('.ag-sheet__card', sh).innerHTML = ''; }
    }, 220);
    const back = S.returnFocus;
    S.returnFocus = null;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }
  function closeMenu() {
    const m = document.getElementById('agMenu');
    if (m) { m.hidden = true; m.classList.remove('is-maps', 'is-sheet'); m.style.zIndex = ''; m.innerHTML = ''; }
    const bd = document.getElementById('agMapsBackdrop');
    if (bd) bd.hidden = true;
  }
  function closeAll() {
    closeMenu();
    closeSheet();
    const r = document.getElementById('agResults');
    if (r) r.hidden = true;
    $$('.is-active-ev').forEach((x) => x.classList.remove('is-active-ev'));
  }
  const sheetBar = (title) => `<header class="ag-sheet__bar"><button type="button" class="ag-round" data-ag-close aria-label="Close">${CLOSE_ICON}</button><h2>${esc(title)}</h2><span></span></header>`;

  function whenText(e) {
    if (e.allDay) {
      const days = Math.round((e.lastDay - sod(e.start)) / DAY) + 1;
      return days <= 1
        ? { date: fmtLong(e.start), time: 'All day' }
        : { date: `${fmtShort(e.start)} – ${fmtShort(e.lastDay)}, ${e.lastDay.getFullYear()}`, time: `${days} days` };
    }
    return { date: fmtLong(e.start), time: `${fmtTime(e.start)} – ${fmtTime(e.end)}` };
  }
  function openDetail(id, anchor) {
    const e = findEv(id);
    if (!e) return;
    $$('.is-active-ev').forEach((x) => x.classList.remove('is-active-ev'));
    if (anchor) anchor.classList.add('is-active-ev');
    const w = whenText(e);
    const city = e.address.split(',').slice(1).join(',').trim();
    openSheet(`${sheetBar('Job')}<div class="ag-sheet__body"><div class="ag-dtl" style="${evStyle(e)}">
      <div class="ag-dtl__head"><h2>${esc(e.title)}</h2><p>${esc(w.date)}</p><p>${esc(w.time)}</p>${stageText(e) ? `<span class="ag-dtl__st">${esc(stageText(e))}</span>` : ''}</div>
      ${e.address ? `<div class="ag-card ag-dtl__addr"><span class="ag-dtl__addr-main"><span class="ag-dtl__addr-txt"><b>${esc(e.address.split(',')[0])}</b>${city ? `<small>${esc(city)}</small>` : ''}</span></span><button type="button" class="ag-dtl__map" data-ag-maps="${esc(e.address)}">${PIN_ICON}Map</button></div>` : ''}
      ${e.companyName || e.number ? `<div class="ag-card ag-dtl__kv">${e.companyName ? `<div><span>Company</span><b><i class="ag-dot" style="background:${esc(e.color)}"></i>${esc(e.companyName)}</b></div>` : ''}${e.number ? `<div><span>Job #</span><b>${esc(e.number)}</b></div>` : ''}</div>` : ''}
      <div class="ag-dtl__acts"><a class="ag-btn ag-btn--pri ag-btn--block" href="#jobs/${encodeURIComponent(e.id)}">Open job</a></div>
    </div></div>`);
  }
  function openDayList(day) {
    const d = parseYmd(day);
    if (!d) return;
    const list = eventsOnDay(d);
    if (!list.length) {
      S.selected = d;
      if (S.opts.toast) S.opts.toast('No jobs on this day.');
      return;
    }
    if (list.length === 1) { openDetail(list[0].id); return; }
    openSheet(`${sheetBar(fmtShort(d))}<div class="ag-sheet__body"><div class="ag-card" style="padding:6px">${list.map((e) => `<button type="button" class="ag-li ${toneCls(e)}" data-ag-ev="${esc(e.id)}" style="${evStyle(e)}"><i></i><time>${esc(e.allDay ? 'all day' : fmtTime(e.start))}</time><div><b>${esc(e.title)}</b><small>${esc(subLine(e))}</small></div></button>`).join('')}</div></div>`);
  }
  function openCompanies() {
    openSheet(`${sheetBar('Companies')}<div class="ag-sheet__body"><div class="ag-card ag-side__sec" style="padding:10px 14px">${companyChecksHtml()}</div></div>`);
  }
  function openMaps(address) {
    const addr = String(address || '').trim();
    if (!addr) return;
    const m = $('#agMenu', layer());
    let bd = document.getElementById('agMapsBackdrop');
    if (!bd) {
      bd = document.createElement('button');
      bd.id = 'agMapsBackdrop';
      bd.type = 'button';
      bd.className = 'ag-maps-backdrop';
      bd.setAttribute('aria-label', 'Close');
      bd.addEventListener('click', closeMenu);
      document.body.appendChild(bd);
    }
    m.classList.add('is-maps', 'is-sheet');
    m.style.zIndex = '10120';
    m.innerHTML = `<button type="button" class="ag-menu__x" data-ag-maps-close aria-label="Close">×</button><p class="ag-menu__hint">Open in maps</p><p class="ag-menu__addr">${esc(addr)}</p><a class="ag-menu__i" href="https://maps.apple.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">Apple Maps</a><a class="ag-menu__i" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}" target="_blank" rel="noopener">Google Maps</a>`;
    m.hidden = false;
    bd.hidden = false;
  }

  /* ------------------------------------------------------------ search */

  function searchHtml(q) {
    const v = q.trim().toLowerCase();
    if (!v) return '';
    const hits = S.all
      .filter((e) => [e.title, e.address, e.number, e.companyName].filter(Boolean).join(' ').toLowerCase().includes(v))
      .sort((a, b) => Math.abs(a.start - Date.now()) - Math.abs(b.start - Date.now()))
      .slice(0, 30)
      .sort((a, b) => a.start - b.start);
    return hits.length
      ? hits.map((e) => `<button type="button" class="ag-li ${toneCls(e)}" data-ag-hit="${esc(e.id)}" style="${evStyle(e)}"><i></i><time>${esc(fmtShort(e.start))}<br/><small>${e.start.getFullYear()}</small></time><div><b>${esc(e.title)}</b><small>${esc(subLine(e))}</small></div></button>`).join('')
      : '<p class="ag-empty">No jobs found.</p>';
  }
  function gotoHit(id) {
    const e = findEv(id);
    if (!e) return;
    closeAll();
    if (e.company && S.hidden.has(e.company)) { S.hidden.delete(e.company); applyFilter(); savePrefs(); }
    S.selected = sod(e.start);
    S.cursor = sod(e.start);
    if (isPhone()) { S.mmode = 'day'; S.view = 'month'; } else S.view = 'day';
    render();
    setTimeout(() => openDetail(id), 50);
  }
  function openMobileSearch() {
    openSheet(`<header class="ag-sheet__bar"><label class="ag-search ag-search--sheet">${SEARCH_ICON}<input type="search" id="agMSearch" placeholder="Search jobs" autocomplete="off" aria-label="Search jobs" /></label><button type="button" class="ag-pillbtn" data-ag-close>Cancel</button></header><div class="ag-sheet__body" id="agMResults"></div>`, 'ag-sheet__card--search');
    const i = $('#agMSearch');
    setTimeout(() => i.focus(), 60);
    i.addEventListener('input', () => { $('#agMResults').innerHTML = searchHtml(i.value); });
  }

  /* ------------------------------------------------------------ navigation and events */

  function step(dir) {
    const c = S.cursor;
    if (S.view === 'day') { S.cursor = addDays(c, dir); S.selected = S.cursor; }
    else if (S.view === 'week') S.cursor = addDays(c, dir * 7);
    else if (S.view === 'year') S.cursor = new Date(c.getFullYear() + dir, c.getMonth(), 1);
    else S.cursor = addMonths(c, dir);
    if (S.view === 'month' && $('#agMScroll', S.host)) {
      const has = $('#agMScroll', S.host).querySelector(`[data-ag-month="${ymd(new Date(S.cursor.getFullYear(), S.cursor.getMonth(), 1))}"]`);
      if (has) {
        renderTitle();
        if (S.sidebar && !isPhone()) renderSide();
        scrollToMonth(S.cursor, true);
        return;
      }
      S.mRange = null;
    }
    render();
  }
  function setView(v) {
    S.view = v;
    S.mRange = null;
    savePrefs();
    render();
  }
  function goToday() {
    S.cursor = sod(new Date());
    S.selected = S.cursor;
    if (isPhone() && S.view === 'year') S.view = 'month';
    if (S.view === 'month' && (!isPhone() || S.mmode === 'month') && $('#agMScroll', S.host)) {
      renderTitle();
      renderDayPanel();
      if (S.sidebar && !isPhone()) renderSide();
      scrollToMonth(S.cursor, true);
      return;
    }
    S.mRange = null;
    render();
  }
  function selectDay(el, day) {
    S.selected = day;
    $$('.ag-md.is-sel', S.host).forEach((x) => x.classList.remove('is-sel'));
    el.classList.add('is-sel');
    renderDayPanel();
    if (S.sidebar) renderSide();
  }

  function onAct(a) {
    if (a === 'prev') return step(-1);
    if (a === 'next') return step(1);
    if (a === 'today') return goToday();
    if (a === 'toggle-side') { S.sidebar = !S.sidebar; savePrefs(); return render(); }
    if (a === 'toggle-day') { S.dayPanel = !S.dayPanel; savePrefs(); return render(); }
    if (a === 'companies') return openCompanies();
    if (a === 'msearch') return openMobileSearch();
    if (a === 'mmode') {
      S.mmode = S.mmode === 'day' ? 'month' : 'day';
      S.view = 'month';
      S.mRange = null;
      return render();
    }
    if (a === 'mback') {
      if (S.view === 'year') { S.view = 'month'; S.mmode = 'month'; S.cursor = sod(new Date()); }
      else if (S.mmode === 'day') { S.mmode = 'month'; S.cursor = new Date(S.selected.getFullYear(), S.selected.getMonth(), 1); }
      else S.view = 'year';
      S.mRange = null;
      return render();
    }
    return undefined;
  }

  function onClick(ev) {
    const t = ev.target;
    const results = document.getElementById('agResults');
    if (results && !results.hidden && !t.closest('#agResults') && !t.closest('.ag-search')) results.hidden = true;
    let el;
    if (t.closest('[data-ag-close]')) return closeSheet();
    if (t.closest('[data-ag-maps-close]')) return closeMenu();
    if ((el = t.closest('[data-ag-maps]'))) return openMaps(el.getAttribute('data-ag-maps'));
    if ((el = t.closest('#agMenu a'))) return closeMenu();
    if ((el = t.closest('[data-ag-hit]'))) return gotoHit(el.dataset.agHit);
    if ((el = t.closest('[data-ag-ev]'))) return openDetail(el.dataset.agEv, el);
    if ((el = t.closest('[data-ag-view]'))) return setView(el.dataset.agView);
    if ((el = t.closest('[data-ag-act]'))) return onAct(el.dataset.agAct);
    if ((el = t.closest('[data-ag-goday]'))) {
      S.cursor = parseYmd(el.dataset.agGoday);
      S.selected = S.cursor;
      S.mRange = null;
      if (isPhone()) { S.view = 'month'; S.mmode = 'day'; } else { S.view = 'day'; savePrefs(); }
      return render();
    }
    if ((el = t.closest('[data-ag-gomonth]'))) {
      S.cursor = parseYmd(el.dataset.agGomonth);
      S.view = 'month';
      S.mmode = 'month';
      S.mRange = null;
      savePrefs();
      return render();
    }
    if ((el = t.closest('[data-ag-daylist]'))) return openDayList(el.dataset.agDaylist);
    if ((el = t.closest('[data-ag-mini-nav]'))) {
      S.cursor = addMonths(new Date(S.cursor.getFullYear(), S.cursor.getMonth(), 1), Number(el.dataset.agMiniNav) || 0);
      S.mRange = null;
      return render();
    }
    if ((el = t.closest('[data-ag-strip]'))) {
      S.selected = parseYmd(el.dataset.agStrip);
      S.cursor = S.selected;
      return render();
    }
    if ((el = t.closest('[data-ag-mday]'))) {
      const day = parseYmd(el.dataset.agMday);
      if (!day) return undefined;
      if (isPhone()) return openDayList(el.dataset.agMday);
      selectDay(el, day);
      if (eventsOnDay(day).length > 1 && !S.dayPanel) openDayList(el.dataset.agMday);
    }
    return undefined;
  }
  function onChange(ev) {
    const box = ev.target.closest && ev.target.closest('[data-ag-co]');
    if (!box) return;
    if (box.checked) S.hidden.delete(box.dataset.agCo);
    else S.hidden.add(box.dataset.agCo);
    savePrefs();
    applyFilter();
    render();
  }

  let bound = false;
  function bindGlobal() {
    if (bound) return;
    bound = true;
    document.addEventListener('keydown', (e) => {
      if (!mounted() && document.getElementById('agSheet')?.hidden !== false) return;
      if (e.key === 'Escape') {
        const bd = document.getElementById('agMapsBackdrop');
        if (bd && !bd.hidden) return closeMenu();
        const sh = document.getElementById('agSheet');
        if (sh && !sh.hidden) return closeSheet();
        const r = document.getElementById('agResults');
        if (r && !r.hidden) r.hidden = true;
        return undefined;
      }
      if (!mounted() || (document.getElementById('agSheet') && !document.getElementById('agSheet').hidden)) return undefined;
      const md = e.target.closest && e.target.closest('[data-ag-mday]');
      if (md && e.target === md && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        md.click();
        return undefined;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isPhone()) return undefined;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], .pp-menu, [role="dialog"]')) return undefined;
      const k = e.key.toLowerCase();
      if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 'y') setView('year');
      else if (k === 't') goToday();
      else if (e.key === 'ArrowLeft' && !e.target.closest('[data-ag-mday]')) step(-1);
      else if (e.key === 'ArrowRight' && !e.target.closest('[data-ag-mday]')) step(1);
      return undefined;
    });
    document.addEventListener('click', (ev) => {
      const r = document.getElementById('agResults');
      if (r && !r.hidden && !ev.target.closest('#agResults') && !ev.target.closest('.ag-search')) r.hidden = true;
    });
    window.addEventListener('hashchange', closeAll);
    let wasPhone = isPhone();
    let timer = null;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!mounted()) return;
        if (isPhone() !== wasPhone) { wasPhone = isPhone(); S.mRange = null; }
        render();
      }, 150);
    });
  }

  const shellHtml = () => `<div class="ag" id="ag" data-view="month">
    <div class="ag-top">
      <div class="ag-tool">
        <div class="ag-tool__left"><button type="button" class="ag-capsule ag-icon ag-icon--solo pp-cal-cobtn" data-ag-act="companies" aria-label="Companies" title="Companies">${CAL_ICON}</button></div>
        <nav class="ag-seg" aria-label="View"><button type="button" data-ag-view="day">Day</button><button type="button" data-ag-view="week">Week</button><button type="button" data-ag-view="month">Month</button><button type="button" data-ag-view="year">Year</button></nav>
        <label class="ag-search">${SEARCH_ICON}<input type="search" id="agSearch" placeholder="Search jobs" autocomplete="off" aria-label="Search jobs" /></label>
      </div>
      <div class="ag-mbar">
        <button type="button" class="ag-mback" data-ag-act="mback"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span id="agMBackLabel"></span></button>
        <div class="ag-capsule">
          <button type="button" class="ag-icon" data-ag-act="mmode" aria-label="Switch between month and day" title="Month or day"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="5.5" rx="1.6"/><rect x="4" y="13.5" width="16" height="5.5" rx="1.6"/></svg></button>
          <button type="button" class="ag-icon" data-ag-act="msearch" aria-label="Search jobs">${SEARCH_ICON}</button>
        </div>
      </div>
      <div class="ag-head">
        <h1 class="ag-title" id="agTitle"></h1>
        <div class="ag-nav">
          <button type="button" class="ag-icon" data-ag-act="prev" aria-label="Previous"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
          <button type="button" class="ag-today" data-ag-act="today">Today</button>
          <button type="button" class="ag-icon" data-ag-act="next" aria-label="Next"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
        </div>
      </div>
    </div>
    <div class="ag-body">
      <aside class="ag-side" id="agSide" aria-label="Side calendar" hidden></aside>
      <button type="button" class="ag-rail ag-rail--left" id="agRailLeft" data-ag-act="toggle-side" aria-label="Side calendar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8.5 12l6 6.5"/></svg></button>
      <section class="ag-stage" id="agStage" aria-label="Calendar"></section>
      <button type="button" class="ag-rail ag-rail--right" id="agRailRight" data-ag-act="toggle-day" aria-label="Day panel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L15.5 12l-6 6.5"/></svg></button>
      <aside class="ag-dp" id="agDayPanel" aria-label="Selected day" hidden></aside>
    </div>
    <div class="ag-mfloat">
      <button type="button" class="ag-mtoday" data-ag-act="today">Today</button>
      <button type="button" class="ag-capsule ag-icon ag-mcal" data-ag-act="companies" aria-label="Companies">${CAL_ICON}</button>
    </div>
  </div>`;

  /**
   * Draws the calendar in `host`.
   * opts.jobs: portal jobs. opts.companies: [{ id, name }], in a stable order.
   * opts.stageOf(job): plain text for where the job stands. opts.toast(text): small notice.
   */
  function mount(host, opts) {
    S.host = host;
    S.opts = opts || {};
    const list = (S.opts.companies || []).filter((c) => c && c.id);
    S.companies = list.map((c, i) => ({ id: String(c.id), name: c.name, color: CO_COLORS[i % CO_COLORS.length] }));
    const colorByCo = new Map(S.companies.map((c) => [c.id, c.color]));
    const colorOf = (job) => colorByCo.get(String(job._co || '')) || CO_COLORS[0];
    S.all = (S.opts.jobs || []).filter((j) => j.scheduledStart && j.status !== 'canceled').map((j) => normalize(j, colorOf)).filter(Boolean);
    // Companies that no longer exist must not stay hidden forever.
    S.hidden = new Set(Array.from(S.hidden).filter((id) => colorByCo.has(id)));
    applyFilter();
    if (isPhone() && S.view !== 'year') S.view = 'month';
    S.mRange = null;
    layer();
    host.innerHTML = shellHtml();
    const root = $('#ag', host);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    const si = $('#agSearch', root);
    si.addEventListener('input', () => {
      const box = $('#agResults');
      const html = searchHtml(si.value);
      box.innerHTML = html;
      if (!html) { box.hidden = true; return; }
      const r = si.getBoundingClientRect();
      box.style.top = `${r.bottom + 8}px`;
      box.style.left = `${Math.max(12, r.right - 380)}px`;
      box.hidden = false;
    });
    si.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = $('#agResults [data-ag-hit]');
      if (first) gotoHit(first.dataset.agHit);
    });
    bindGlobal();
    render();
  }

  window.PpCalendar = { mount };
})();
