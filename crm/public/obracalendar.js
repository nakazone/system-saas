/**
 * ObraCalendar: turns the Calendar page into its own app, only inside /obracalendar.
 * Month and day timeline come from agenda.js; this adds the tabs (Calendar, Dia, Ajustes).
 * On a computer or tablet there is nothing extra to offer yet, so it opens the normal Calendar.
 */
(function () {
  if (!window.__OM_CAL_APP) return;
  const device = window.__omDevice;
  const isMobile = device && device.isMobile ? device.isMobile() : window.matchMedia('(max-width: 767px)').matches;
  if (!isMobile) {
    location.replace('/schedule.html' + location.search);
    return;
  }
  document.body.classList.add('oc-app');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = {
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6H20V20H4Z"/><path d="M4 10H20M8 3V7M16 3V7"/><path d="M13 14H16V17H13Z"/></svg>',
    day: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6H20V20H4Z"/><path d="M8 3V7M16 3V7M8 11H16M8 15H13"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7H20M4 17H20"/><path d="M8 5H11V9H8ZM14 15H17V19H14Z" fill="#fff"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V19M5 12H19"/></svg>',
  };
  const TABS = [
    { id: 'calendar', label: 'Calendar', icon: ICON.calendar },
    { id: 'day', label: 'Dia', icon: ICON.day },
    { id: 'settings', label: 'Ajustes', icon: ICON.settings },
  ];
  let tab = 'calendar';

  const nav = document.createElement('nav');
  nav.className = 'oc-tabs';
  nav.setAttribute('aria-label', 'ObraCalendar');
  nav.innerHTML = TABS.map((t) => `<button type="button" class="oc-tab" data-oc-tab="${t.id}">${t.icon}${t.label}</button>`).join('');
  const panel = document.createElement('section');
  panel.className = 'oc-panel';
  panel.hidden = true;
  document.body.append(panel, nav);

  const hora = (e) => {
    const app = window.__agendaApp;
    return e.allDay ? 'Dia todo' : app.fmtTime(e.start);
  };
  const subtitle = (e) => {
    const app = window.__agendaApp;
    return [app.typeInfo(e.type).one, e.address].filter(Boolean).join(' · ');
  };
  const minutesUntil = (e) => Math.round((e.start - Date.now()) / 60000);
  const whenLabel = (e) => {
    const m = minutesUntil(e);
    if (e.allDay) return 'Hoje';
    if (m <= 0) return 'Agora';
    if (m < 60) return `Em ${m} min`;
    return `Em ${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}`;
  };

  function renderDay() {
    const app = window.__agendaApp;
    if (!app) return;
    const now = new Date();
    const events = app.eventsOnDay(now).filter((e) => e.status !== 'canceled').slice();
    events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
    const next = events.find((e) => !e.allDay && e.end > now) || null;
    const rest = events.filter((e) => e !== next);
    const counts = {};
    events.forEach((e) => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const resumo = Object.keys(counts).map((t) => {
      const info = app.typeInfo(t);
      return `${counts[t]} ${(counts[t] === 1 ? info.one : info.label || info.one).toLowerCase()}`;
    }).join(' · ');
    const dateTxt = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const contact = next ? app.contactOf(next) : null;
    const phone = contact && contact.phone;
    const nextHtml = next ? `
      <div class="oc-next">
        <div class="oc-next__top"><span>Próximo · ${esc(whenLabel(next))}</span><span>${esc(hora(next))}</span></div>
        <div class="oc-next__name" data-oc-ev="${esc(next.id)}" role="button" tabindex="0">${esc(app.ticketTitle(next))}</div>
        <div class="oc-next__sub">${esc(subtitle(next))}</div>
        <div class="oc-next__acts">
          ${next.address ? `<button type="button" class="is-pri" data-ag-maps="${esc(next.address)}">Mapa</button>` : ''}
          ${phone ? `<a href="tel:${esc(phone)}">Ligar</a>` : ''}
          <button type="button" data-oc-ev="${esc(next.id)}">Detalhes</button>
        </div>
      </div>` : '';
    const rows = rest.map((e) => `
      <button type="button" class="oc-row" data-oc-ev="${esc(e.id)}">
        <span class="oc-row__h">${esc(hora(e))}</span>
        <span class="oc-row__c" style="background:${esc(e.color || '#98A2B3')}"></span>
        <span class="oc-row__b"><span class="oc-row__t">${esc(app.ticketTitle(e))}</span><span class="oc-row__s">${esc(subtitle(e))}</span></span>
      </button>`).join('');
    panel.innerHTML = `
      <header class="oc-head">
        <div><div class="oc-date">${esc(dateTxt.charAt(0).toUpperCase() + dateTxt.slice(1))}</div><h1 class="oc-title">Hoje</h1></div>
        <button type="button" class="oc-round" data-oc-new aria-label="Novo">${ICON.plus}</button>
      </header>
      ${window.MateAI ? '<button type="button" class="oc-mate" data-oc-mate>Peça ao <b>Mate</b></button>' : ''}
      ${nextHtml}
      ${rest.length ? `<div class="oc-sec"><h2>${next ? 'Depois' : 'O dia'}</h2><span>${esc(resumo)}</span></div><div class="oc-list">${rows}</div>` : ''}
      ${events.length ? app.dayRouteBtnHtml(now) : '<div class="oc-list"><div class="oc-empty">Nada agendado para hoje.</div></div>'}`;
  }

  let session = null;
  function renderSettings() {
    const u = (session && session.user) || {};
    const org = (session && session.organization) || {};
    panel.innerHTML = `
      <header class="oc-head"><h1 class="oc-title">Ajustes</h1></header>
      <div class="oc-list"><div class="oc-row" style="cursor:default"><span class="oc-row__b"><span class="oc-row__t">${esc(u.name || u.email || '')}</span><span class="oc-row__s">${esc(org.name || '')}</span></span></div></div>
      <div class="oc-list">
        <a class="oc-row" href="/dashboard"><span class="oc-row__b"><span class="oc-row__t">Abrir o ObraMate</span><span class="oc-row__s">Jobs, quotes, invoices e o resto do sistema</span></span></a>
        <a class="oc-row" href="/configuracoes.html#agenda"><span class="oc-row__b"><span class="oc-row__t">Agenda e calendários</span><span class="oc-row__s">Cores e calendários da empresa</span></span></a>
      </div>
      <div class="oc-list"><button type="button" class="oc-row" data-oc-logout><span class="oc-row__b"><span class="oc-row__t">Sair</span></span></button></div>`;
  }

  function show(next) {
    tab = next;
    nav.querySelectorAll('[data-oc-tab]').forEach((b) => {
      const on = b.dataset.ocTab === tab;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    panel.hidden = tab === 'calendar';
    if (tab === 'calendar' && window.__agendaApp) window.__agendaApp.showMonth();
    if (tab === 'day') renderDay();
    if (tab === 'settings') renderSettings();
    panel.scrollTop = 0;
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-oc-tab],[data-oc-ev],[data-oc-new],[data-oc-mate],[data-oc-logout]');
    if (!t) return;
    if (t.dataset.ocTab) return show(t.dataset.ocTab);
    if (t.dataset.ocEv) return window.__agendaApp.openDetail(t.dataset.ocEv);
    if (t.hasAttribute('data-oc-new')) return window.__agendaOpenNew();
    if (t.hasAttribute('data-oc-mate')) return window.MateAI.open();
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .then(() => { location.href = '/login.html?app=obracalendar'; });
  });

  // agenda.js redraws the stage after loading or saving: keep the Dia tab in step.
  const stage = document.getElementById('agStage');
  if (stage) new MutationObserver(() => { if (tab === 'day') renderDay(); }).observe(stage, { childList: true });

  fetch('/api/auth/session', { credentials: 'include' })
    .then((r) => r.json())
    .then((s) => { session = s; if (tab === 'settings') renderSettings(); })
    .catch(() => {});

  show('calendar');
})();
