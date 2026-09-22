/**
 * Abrir visita de lead no calendario do dispositivo.
 * iPad/iPhone/Safari: GET sincrona a /calendar.ics no gesto do toque
 * (data: URI e fetch+assign sao bloqueados pelo Safari).
 * Android / Chrome desktop: Google Calendar ou escolha.
 */
(function (global) {
  'use strict';

  const icsCache = new Map();
  const ICS_CACHE_MS = 5 * 60 * 1000;
  let chooserLead = null;
  let chooserOptions = null;

  function snapToNextHalfHour(fromDate) {
    const d = new Date(fromDate || Date.now());
    d.setSeconds(0, 0);
    const m = d.getMinutes();
    if (m === 0 || m === 30) return d;
    if (m < 30) d.setMinutes(30);
    else {
      d.setMinutes(0);
      d.setHours(d.getHours() + 1);
    }
    return d;
  }

  function formatGoogleCalendarDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      '00'
    );
  }

  function calendarFmt() {
    return global.sfLeadVisitCalendarFormat || null;
  }

  function buildLeadVisitLocation(lead) {
    const fmt = calendarFmt();
    if (fmt && typeof fmt.buildLeadVisitLocation === 'function') {
      return fmt.buildLeadVisitLocation(lead);
    }
    return '';
  }

  function buildLeadVisitDescription(lead) {
    const fmt = calendarFmt();
    if (fmt && typeof fmt.buildLeadVisitDescription === 'function') {
      return fmt.buildLeadVisitDescription(lead);
    }
    return '';
  }

  function buildLeadVisitSummary(lead) {
    const fmt = calendarFmt();
    if (fmt && typeof fmt.buildLeadVisitSummary === 'function') {
      return fmt.buildLeadVisitSummary(lead);
    }
    return (lead && lead.name ? String(lead.name) : 'Lead').trim() || 'Lead';
  }

  function buildGoogleCalendarUrl(lead, options) {
    const opts = options || {};
    const start = opts.start instanceof Date ? opts.start : snapToNextHalfHour();
    const durationMinutes =
      typeof opts.durationMinutes === 'number' && opts.durationMinutes > 0 ? opts.durationMinutes : 60;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: buildLeadVisitSummary(lead),
      dates: formatGoogleCalendarDate(start) + '/' + formatGoogleCalendarDate(end),
      details: buildLeadVisitDescription(lead),
      location: buildLeadVisitLocation(lead),
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent || '');
  }

  function isAppleMobile() {
    const ua = navigator.userAgent || '';
    const plat = navigator.platform || '';
    return (
      /iPad|iPhone|iPod/i.test(ua) ||
      (plat === 'MacIntel' && navigator.maxTouchPoints > 1) ||
      (/Macintosh|Mac OS X/i.test(ua) && navigator.maxTouchPoints > 1)
    );
  }

  function isMacOS() {
    const ua = navigator.userAgent || '';
    return /Macintosh|Mac OS X/i.test(ua) && !isAppleMobile();
  }

  /** Safari real (nao Chrome/Edge/Firefox no Mac). */
  function isSafariBrowser() {
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|OPiOS|FxiOS|CriOS/i.test(ua);
  }

  function isStandaloneDisplay() {
    return (
      (typeof navigator !== 'undefined' && navigator.standalone === true) ||
      (typeof global.matchMedia === 'function' &&
        global.matchMedia('(display-mode: standalone)').matches)
    );
  }

  function leadVisitIcsUrl(leadId) {
    return '/api/leads/' + encodeURIComponent(String(leadId)) + '/calendar.ics';
  }

  /**
   * Tem de correr no mesmo tick do clique. Nao usar await antes disto no iPad.
   */
  function openIcsViaUserGesture(leadId) {
    const url = leadVisitIcsUrl(leadId);
    if (isAppleMobile() || isStandaloneDisplay()) {
      global.location.assign(url);
      return true;
    }
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  async function fetchLeadIcsText(leadId) {
    const r = await fetch('/api/leads/' + encodeURIComponent(String(leadId)) + '/calendar.ics', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('ICS HTTP ' + r.status);
    return await r.text();
  }

  function getCachedIcs(leadId) {
    const row = icsCache.get(String(leadId));
    if (!row) return null;
    if (Date.now() - row.at > ICS_CACHE_MS) {
      icsCache.delete(String(leadId));
      return null;
    }
    return row.ics;
  }

  function setCachedIcs(leadId, ics) {
    icsCache.set(String(leadId), { ics, at: Date.now() });
  }

  /** Pre-carrega .ics ao abrir o lead (necessario para iOS abrir no clique). */
  async function prefetchLeadVisitIcs(leadId) {
    const id = leadId != null ? String(leadId) : '';
    if (!id || getCachedIcs(id)) return;
    try {
      const ics = await fetchLeadIcsText(id);
      setCachedIcs(id, ics);
    } catch (err) {
      console.warn('[crm-device-calendar] prefetch', err);
    }
  }

  /** Abre Calendario Apple via data URI (tem de ser sincrono no gesto do utilizador). */
  function openAppleCalendarFromCache(leadId) {
    const ics = getCachedIcs(leadId);
    if (!ics) return false;
    const dataUrl = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    global.location.assign(dataUrl);
    return true;
  }

  async function ensureIcsCached(leadId) {
    let ics = getCachedIcs(leadId);
    if (ics) return ics;
    ics = await fetchLeadIcsText(leadId);
    setCachedIcs(leadId, ics);
    return ics;
  }

  function ensureCalendarChooserDom() {
    let root = document.getElementById('sfCalendarChooserModal');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'sfCalendarChooserModal';
    root.className = 'sf-calendar-chooser';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="sf-calendar-chooser__backdrop" data-sf-cal-close tabindex="-1"></div>' +
      '<div class="sf-calendar-chooser__sheet" role="dialog" aria-labelledby="sfCalendarChooserTitle">' +
      '<div class="lead-quick-sheet__handle" aria-hidden="true"></div>' +
      '<header class="sf-calendar-chooser__header">' +
      '<h2 id="sfCalendarChooserTitle" class="sf-calendar-chooser__title">Abrir no calend\u00e1rio</h2>' +
      '<button type="button" class="lead-quick-sheet__close" data-sf-cal-close aria-label="Fechar">&times;</button>' +
      '</header>' +
      '<p class="sf-calendar-chooser__subtitle" id="sfCalendarChooserLeadName"></p>' +
      '<div class="sf-calendar-chooser__actions">' +
      '<button type="button" class="btn btn-primary sf-calendar-chooser__btn" id="sfCalendarChooserApple">' +
      'Calend\u00e1rio Apple' +
      '</button>' +
      '<button type="button" class="btn btn-secondary sf-calendar-chooser__btn" id="sfCalendarChooserGoogle">' +
      'Google Calendar' +
      '</button>' +
      '</div>' +
      '<p class="sf-calendar-chooser__hint" id="sfCalendarChooserHint"></p>' +
      '</div>';

    document.body.appendChild(root);

    root.querySelectorAll('[data-sf-cal-close]').forEach((el) => {
      el.addEventListener('click', closeCalendarChooser);
    });

    document.getElementById('sfCalendarChooserApple').addEventListener('click', onChooserAppleClick);
    document.getElementById('sfCalendarChooserGoogle').addEventListener('click', onChooserGoogleClick);

    return root;
  }

  function closeCalendarChooser() {
    const root = document.getElementById('sfCalendarChooserModal');
    if (!root) return;
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    chooserLead = null;
    chooserOptions = null;
  }

  function openCalendarChooser(lead, options) {
    chooserLead = lead;
    chooserOptions = options || null;
    const root = ensureCalendarChooserDom();
    const nameEl = document.getElementById('sfCalendarChooserLeadName');
    const hintEl = document.getElementById('sfCalendarChooserHint');
    const appleBtn = document.getElementById('sfCalendarChooserApple');
    if (nameEl) {
      nameEl.textContent = lead && lead.name ? String(lead.name) : 'Lead';
    }
    if (hintEl) {
      hintEl.textContent = isMacOS()
        ? 'No Chrome ou Edge, prefira Google Calendar. No Safari, Calend\u00e1rio Apple abre direto.'
        : 'Escolha o calend\u00e1rio que usa no dia a dia.';
    }
    if (appleBtn) {
      appleBtn.disabled = false;
      appleBtn.textContent = 'Calend\u00e1rio Apple';
    }
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    if (lead && lead.id != null) void prefetchLeadVisitIcs(lead.id);
  }

  function onChooserAppleClick() {
    const lead = chooserLead;
    if (!lead || lead.id == null) return;
    closeCalendarChooser();
    openIcsViaUserGesture(lead.id);
  }

  function onChooserGoogleClick() {
    const lead = chooserLead;
    if (!lead) return;
    closeCalendarChooser();
    global.location.href = buildGoogleCalendarUrl(lead, chooserOptions);
  }

  /**
   * @param {object} lead
   * @param {{ start?: Date, durationMinutes?: number }} [options]
   * @returns {boolean}
   */
  function openLeadVisitInDeviceCalendar(lead, options) {
    if (!lead) return false;

    try {
      if (isAndroidDevice()) {
        global.location.href = buildGoogleCalendarUrl(lead, options);
        return true;
      }

      const appleNative = isSafariBrowser() || isAppleMobile();
      if (appleNative && lead.id != null && lead.id !== '') {
        return openIcsViaUserGesture(lead.id);
      }

      if (lead.id != null && lead.id !== '') {
        void prefetchLeadVisitIcs(lead.id);
      }
      openCalendarChooser(lead, options);
      return true;
    } catch (err) {
      console.warn('[crm-device-calendar]', err);
      openCalendarChooser(lead, options);
      return true;
    }
  }

  global.sfOpenLeadVisitInDeviceCalendar = openLeadVisitInDeviceCalendar;
  global.sfPrefetchLeadVisitIcs = prefetchLeadVisitIcs;
  global.sfBuildGoogleCalendarVisitUrl = buildGoogleCalendarUrl;
  global.sfSnapVisitToNextHalfHour = snapToNextHalfHour;
  global.sfOpenCalendarChooser = openCalendarChooser;
})(typeof window !== 'undefined' ? window : globalThis);
