/**
 * ObraQuote app: the Field Quote as its own app, only inside /obraquote.
 * The visit list, the visit and the presentation come from field-quote.js. This adds the
 * tabs (Início, Visitas, Ajustes) and the Home, laid out like the ObraBuilder Home:
 * greeting with the Mate, big actions, "Agora" (scheduled visits and drafts) and the month in numbers.
 */
(function () {
  'use strict';
  if (!window.__OM_QUOTE_APP || !window.OmShell) return;
  // Phone only, like the other apps' bars: on an iPad the visit keeps its two-column layout and the CRM dock.
  const dev = window.__omDevice;
  if (dev && typeof dev.isPhone === 'function' && !dev.isPhone()) return;
  document.body.classList.add('oq-app');

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const fmtN = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const time = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(m)) return '';
    if (m < 60) return m <= 1 ? 'agora' : `há ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ontem' : `há ${d} dias`;
  };
  const isToday = (d) => d.toDateString() === new Date().toDateString();
  const APPROVED = ['approved', 'converted'];
  const WAITING = ['sent', 'viewed'];
  const icon = (name) => window.OmShell.icon(name) || '';
  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const IC = {
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    chev: svg('<path d="M9 6l6 6-6 6"/>'),
  };

  // ------------------------------------------------------------ bars
  const PAGE = '/obraquote';
  const nav = window.OmShell.tabs({
    className: 'oq-tabs',
    label: 'ObraQuote',
    items: [
      { key: 'home', label: 'Início', icon: 'home', attrs: 'data-oq-tab="home"' },
      { key: 'visits', label: 'Visitas', icon: 'ruler', attrs: 'data-oq-tab="visits"' },
      { key: 'settings', label: 'Ajustes', icon: 'settings', attrs: 'data-oq-tab="settings"' },
    ],
  });
  const panel = document.createElement('section');
  panel.className = 'oq-panel';
  panel.hidden = true;
  document.body.append(panel, nav);

  let tab = new URLSearchParams(location.search).get('tab') === 'visitas' ? 'visits' : 'home';
  let session = null;
  let data = null; // { rows, events } once loaded
  let loading = null;

  function inVisit() {
    // field-quote.js renders either the list (.fq-list) or a visit (.fq-panel, the result, the presentation)
    const v = $('#fqView');
    if (v && v.querySelector('.fq-list')) return false;
    if (v && v.firstElementChild) return true;
    // still loading: a link to a visit (or one being created from the agenda) is a visit
    const p = new URLSearchParams(location.search);
    return ['id', 'meeting_id', 'lead_id', 'customer_id', 'builder_id', 'presentation_quote'].some((k) => p.get(k));
  }

  function markTab(id) {
    nav.querySelectorAll('[data-oq-tab]').forEach((b) => {
      const on = b.dataset.oqTab === id;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function show(id) {
    tab = id;
    markTab(id);
    panel.hidden = id === 'visits';
    document.body.classList.toggle('oq-on-panel', id !== 'visits');
    try {
      const url = id === 'visits' ? `${PAGE}?tab=visitas` : PAGE;
      if (!inVisit() && location.pathname + location.search !== url) history.replaceState(null, '', url);
    } catch (_) {}
    if (id === 'home') renderHome();
    if (id === 'settings') renderSettings();
    panel.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function syncVisit() {
    const v = inVisit();
    document.body.classList.toggle('oq-visit', v);
    if (v) {
      panel.hidden = true;
      document.body.classList.remove('oq-on-panel');
    } else if (tab !== 'visits' && panel.hidden) {
      show(tab);
    }
  }

  // ------------------------------------------------------------ data
  async function api(url) {
    const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || 'Não foi possível carregar.');
    return j;
  }
  function load(force) {
    if (loading && !force) return loading;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 2 * 86400e3);
    loading = Promise.all([
      api('/api/field-quotes'),
      api(`/api/schedule/events?from=${from.toISOString()}&to=${to.toISOString()}`).catch(() => ({ data: [] })),
    ]).then(([list, ev]) => {
      const now = Date.now();
      data = {
        rows: list.data || [],
        events: (ev.data || [])
          .filter((e) => e.type === 'visit' && e.status !== 'canceled' && new Date(e.end || e.start).getTime() > now - 3 * 3600e3)
          .sort((a, b) => new Date(a.start) - new Date(b.start)),
      };
      return data;
    });
    loading.catch(() => { loading = null; });
    return loading;
  }

  // ------------------------------------------------------------ home
  function greeting() {
    const h = new Date().getHours();
    const first = String((session && session.user && (session.user.name || '')) || '').split(/\s+/)[0];
    return `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${first ? `, ${first}` : ''}`;
  }
  function dateLine() {
    const d = new Date();
    return `${cap(d.toLocaleDateString('pt-BR', { weekday: 'long' }))}, ${d.getDate()} de ${cap(d.toLocaleDateString('pt-BR', { month: 'long' }))}`;
  }
  function helloHtml(line) {
    return `<header class="oq-hello">
        <div class="oq-hello__txt"><p class="oq-eyebrow">${esc(dateLine())}</p><h1>${esc(greeting())}</h1>${line ? `<p class="oq-hello__line">${esc(line)}</p>` : ''}</div>
        <img class="oq-hello__mate" src="/assets/img/mascot/mate-quote.webp?v=1" alt="" width="173" height="210" decoding="async" fetchpriority="high" />
      </header>`;
  }

  /** Where a scheduled visit's button goes: the open draft for that lead, or a new visit from the meeting. */
  function visitTarget(e, d) {
    const lead = (e.meta && e.meta.lead) || {};
    const open = d.rows.find((r) => r.status === 'draft' && lead.id && r.lead_id === lead.id);
    if (open) return { href: `${PAGE}?id=${encodeURIComponent(open.id)}`, label: 'Continuar' };
    const done = d.rows.find((r) => r.meeting_id === e.id);
    if (done) return { href: `${PAGE}?id=${encodeURIComponent(done.id)}`, label: 'Abrir' };
    return { href: `${PAGE}?meeting_id=${encodeURIComponent(e.id)}`, label: 'Começar' };
  }
  const addrOf = (e) => (e.meta && e.meta.location) || ((e.meta && e.meta.lead) || {}).address || '';
  const routeUrl = (addr) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;

  function quickHtml(d) {
    const drafts = d.rows.filter((r) => r.status !== 'quoted').sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const quoted = d.rows.filter((r) => r.status === 'quoted').sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const next = d.events[0];
    const act = (attrs, ic, label, sub) => `<a class="oq-qa" ${attrs}><span class="oq-qa__ic">${ic}</span><span><strong>${esc(label)}</strong><small>${esc(sub)}</small></span></a>`;
    const items = [
      `<button type="button" class="oq-qa" data-fq-new><span class="oq-qa__ic">${IC.plus}</span><span><strong>Nova visita</strong><small>Medir e orçar agora</small></span></button>`,
    ];
    if (next) {
      const st = new Date(next.start);
      const t = visitTarget(next, d);
      items.push(act(`href="${esc(t.href)}"`, icon('calendar'), 'Próxima visita', `${isToday(st) ? '' : 'Amanhã · '}${time(st)} · ${next.title || ''}`));
    }
    if (drafts[0]) items.push(act(`href="${PAGE}?id=${encodeURIComponent(drafts[0].id)}"`, IC.edit, 'Continuar', `${drafts[0].client_name} · ${ago(drafts[0].updated_at)}`));
    if (quoted[0]) items.push(act(`href="${PAGE}?id=${encodeURIComponent(quoted[0].id)}"`, IC.play, 'Apresentar', `${quoted[0].client_name}${quoted[0].total ? ` · ${money(quoted[0].total)}` : ''}`));
    return `<section class="oq-qa-grid oq-qa-grid--${items.length}" aria-label="Ações rápidas">${items.join('')}</section>`;
  }

  let nowTab = '';
  function nowHtml(d) {
    const drafts = d.rows.filter((r) => r.status !== 'quoted').sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const visits = d.events;
    if (!visits.length && !drafts.length) return '';
    if (nowTab !== 'visits' && nowTab !== 'drafts') nowTab = visits.length ? 'visits' : 'drafts';
    if (nowTab === 'visits' && !visits.length) nowTab = 'drafts';
    if (nowTab === 'drafts' && !drafts.length) nowTab = 'visits';
    const visitCard = (e) => {
      const st = new Date(e.start);
      const t = visitTarget(e, d);
      const addr = addrOf(e);
      return `<article class="oq-card${isToday(st) ? ' is-today' : ''}">
          <a class="oq-card__hit" href="${esc(t.href)}" aria-label="${esc(`${t.label}: ${e.title || 'visita'}`)}"></a>
          <div class="oq-card__top"><span class="oq-card__time">${isToday(st) ? 'Hoje' : 'Amanhã'} · ${esc(time(st))}</span></div>
          <strong class="oq-card__title">${esc(e.title || 'Visita')}</strong>
          <small class="oq-card__sub">${esc(addr)}</small>
          <div class="oq-card__acts">${addr ? `<a class="oq-act" href="${esc(routeUrl(addr))}" target="_blank" rel="noopener">${IC.pin}<span>Rota</span></a>` : ''}<a class="oq-act is-pri" href="${esc(t.href)}">${esc(t.label)}${IC.chev}</a></div>
        </article>`;
    };
    const draftCard = (r) => {
      const pills = [r.rooms_count ? plural(r.rooms_count, 'cômodo', 'cômodos') : '', r.total_sqft ? `${fmtN(r.total_sqft)} pé²` : ''].filter(Boolean);
      return `<article class="oq-card">
          <a class="oq-card__hit" href="${PAGE}?id=${encodeURIComponent(r.id)}" aria-label="${esc(`Continuar a visita de ${r.client_name}`)}"></a>
          <div class="oq-card__top"><span class="oq-card__time">${IC.edit}${esc(ago(r.updated_at))}</span><span class="oq-chip">Rascunho</span></div>
          <strong class="oq-card__title">${esc(r.client_name)}</strong>
          <div class="oq-card__pills">${pills.length ? pills.map((p) => `<span>${esc(p)}</span>`).join('') : '<small class="oq-card__sub oq-warn">Sem medidas ainda</small>'}</div>
          <div class="oq-card__acts"><a class="oq-act is-pri" href="${PAGE}?id=${encodeURIComponent(r.id)}">Continuar${IC.chev}</a></div>
        </article>`;
    };
    const cards = nowTab === 'visits'
      ? visits.slice(0, 8).map(visitCard).join('')
      : drafts.slice(0, 8).map(draftCard).join('') + (drafts.length > 8 ? `<button type="button" class="oq-card oq-card--more" data-oq-tab="visits">Ver os ${drafts.length} rascunhos</button>` : '');
    const tabBtn = (key, label, n) => (n ? `<button type="button" role="tab" data-oq-now="${key}" aria-selected="${nowTab === key}">${label}<b>${n}</b></button>` : '');
    return `<section class="oq-tile oq-now" aria-label="Agora">
        <div class="oq-now__tabs" role="tablist">${tabBtn('visits', 'Marcadas', visits.length)}${tabBtn('drafts', 'Rascunhos', drafts.length)}</div>
        <div class="oq-now__row" role="tabpanel">${cards}</div>
      </section>`;
  }

  function numbersHtml(d) {
    const since = Date.now() - 30 * 86400e3;
    const recent = d.rows.filter((r) => new Date(r.updated_at).getTime() >= since);
    const quoted = recent.filter((r) => r.status === 'quoted');
    const approved = quoted.filter((r) => APPROVED.includes(r.quote_status));
    const waiting = quoted.filter((r) => WAITING.includes(r.quote_status));
    const drafts = d.rows.filter((r) => r.status !== 'quoted');
    const quotedSum = quoted.reduce((s, r) => s + Number(r.total || 0), 0);
    const approvedSum = approved.reduce((s, r) => s + Number(r.total || 0), 0);
    const rate = quotedSum ? Math.round((approvedSum / quotedSum) * 100) : 0;
    return `<section class="oq-tile oq-tile--orange" aria-label="Orçados nos últimos 30 dias">
          <div class="oq-lbl">Orçados · 30 dias</div>
          <div class="oq-big">${quoted.length}</div>
          <div class="oq-tile__sub">${quotedSum ? `${money(quotedSum)} em orçamentos` : 'Nenhum orçamento nos últimos 30 dias'}</div>
          <div class="oq-inbox-grid">
            <div class="oq-inbox"><span>Esperando cliente</span><b>${waiting.length}</b></div>
            <div class="oq-inbox"><span>Aprovados</span><b>${approved.length}</b></div>
            <div class="oq-inbox"><span>Rascunhos</span><b>${drafts.length}</b></div>
          </div>
          <button type="button" class="oq-tile__link" data-oq-tab="visits">Ver visitas →</button>
        </section>
        <section class="oq-tile oq-tile--dark" aria-label="Aprovado nos últimos 30 dias">
          <div class="oq-lbl">Aprovado · 30 dias</div>
          <div class="oq-big">${money(approvedSum)}</div>
          <div class="oq-meter" role="img" aria-label="${rate}% do valor orçado foi aprovado"><i style="width:${rate}%"></i></div>
          <div class="oq-tile__sub">${quotedSum ? `${rate}% do valor orçado` : 'Aparece quando um cliente aprovar'}</div>
        </section>`;
  }

  async function renderHome() {
    if (!data) {
      panel.innerHTML = `<div class="oq-home">${helloHtml('')}<div class="oq-skel" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
      panel.setAttribute('aria-busy', 'true');
    }
    let d;
    try {
      d = await load();
    } catch (e) {
      panel.removeAttribute('aria-busy');
      panel.innerHTML = `<div class="oq-home">${helloHtml('')}<div class="oq-state"><b>Não foi possível carregar as visitas</b><p>${esc(e.message)} Verifique a conexão e tente de novo.</p><button type="button" class="oq-btn" data-oq-retry>Tentar de novo</button></div></div>`;
      return;
    }
    panel.removeAttribute('aria-busy');
    if (tab !== 'home') return;
    const today = d.events.filter((e) => isToday(new Date(e.start))).length;
    const drafts = d.rows.filter((r) => r.status !== 'quoted').length;
    const line = [today ? `${plural(today, 'visita', 'visitas')} hoje` : 'Nenhuma visita hoje', drafts ? `${plural(drafts, 'rascunho aberto', 'rascunhos abertos')}` : ''].filter(Boolean).join(' · ');
    panel.innerHTML = `<div class="oq-home">
        ${helloHtml(line)}
        ${quickHtml(d)}
        ${nowHtml(d)}
        <div class="oq-tiles">${numbersHtml(d)}</div>
      </div>`;
  }

  function renderSettings() {
    const u = (session && session.user) || {};
    const org = (session && session.organization) || {};
    panel.innerHTML = `<div class="oq-home">
      <h1 class="oq-title">Ajustes</h1>
      <div class="oq-list"><div class="oq-row" style="cursor:default"><span class="oq-row__t">${esc(u.name || u.email || '')}</span><span class="oq-row__s">${esc(org.name || '')}</span></div></div>
      <div class="oq-list"><a class="oq-row" href="/dashboard"><span class="oq-row__t">Abrir o ObraMate</span><span class="oq-row__s">Quotes, leads, agenda e o resto do sistema</span></a></div>
      <div class="oq-list"><button type="button" class="oq-row oq-row--danger" data-oq-logout><span class="oq-row__t">Sair</span></button></div>
    </div>`;
  }

  // ------------------------------------------------------------ events
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-oq-tab],[data-oq-now],[data-oq-retry],[data-oq-logout]');
    if (!t) return;
    if (t.dataset.oqTab) return show(t.dataset.oqTab);
    if (t.dataset.oqNow) {
      nowTab = t.dataset.oqNow;
      return renderHome();
    }
    if (t.hasAttribute('data-oq-retry')) {
      loading = null;
      return renderHome();
    }
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .then(() => { location.href = '/login.html?app=obraquote'; });
  });
  // Coming back to the app (another app, the lock screen): fresh numbers.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && tab === 'home' && !inVisit()) {
      loading = null;
      renderHome();
    }
  });

  fetch('/api/auth/session', { credentials: 'include' })
    .then((r) => r.json())
    .then((s) => {
      session = s;
      if (!panel.hidden && tab === 'home' && data) renderHome();
      if (!panel.hidden && tab === 'settings') renderSettings();
    })
    .catch(() => {});

  markTab(tab);
  const view = $('#fqView');
  if (view) new MutationObserver(syncVisit).observe(view, { childList: true });
  syncVisit();
  if (!inVisit()) show(tab);
})();
