/**
 * Abrir visita de lead ou meeting no calendario do dispositivo.
 * iPad/iPhone/Safari: GET sincrona a /calendar.ics no gesto do toque
 * (data: URI e fetch+assign sao bloqueados pelo Safari).
 * Android / Chrome desktop: Google Calendar ou escolha.
 */
(function (global) {
  'use strict';

  const icsCache = new Map();
  /** Final public /feeds/… URL after redirect (Apple Calendar fetches without cookies). */
  const icsPublicUrlCache = new Map();
  const ICS_CACHE_MS = 5 * 60 * 1000;
  let chooserLead = null;
  let chooserMeeting = null;
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

  function meetingIcsUrl(meetingId) {
    return '/api/meetings/' + encodeURIComponent(String(meetingId)) + '/calendar.ics';
  }

  /**
   * Tem de correr no mesmo tick do clique. Nao usar await antes disto no iPad.
   */
  function openIcsUrlViaUserGesture(url) {
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

  function openIcsViaUserGesture(leadId) {
    const key = cacheKey('lead', leadId);
    return openIcsUrlViaUserGesture(getCachedPublicUrl(key) || leadVisitIcsUrl(leadId));
  }

  function openMeetingIcsViaUserGesture(meetingId) {
    const key = cacheKey('meeting', meetingId);
    return openIcsUrlViaUserGesture(getCachedPublicUrl(key) || meetingIcsUrl(meetingId));
  }

  async function fetchIcsWithPublicUrl(apiUrl) {
    const r = await fetch(apiUrl, { credentials: 'include', cache: 'no-store', redirect: 'follow' });
    if (!r.ok) throw new Error('ICS HTTP ' + r.status);
    const ics = await r.text();
    const finalUrl = typeof r.url === 'string' ? r.url : '';
    const publicUrl = /\/feeds\/(lead-visit|meeting)\//.test(finalUrl) ? finalUrl : '';
    return { ics, publicUrl };
  }

  function cacheKey(kind, id) {
    return kind + ':' + String(id);
  }

  function getCachedIcs(key) {
    const row = icsCache.get(String(key));
    if (!row) return null;
    if (Date.now() - row.at > ICS_CACHE_MS) {
      icsCache.delete(String(key));
      return null;
    }
    return row.ics;
  }

  function setCachedIcs(key, ics) {
    icsCache.set(String(key), { ics, at: Date.now() });
  }

  function getCachedPublicUrl(key) {
    const row = icsPublicUrlCache.get(String(key));
    if (!row) return null;
    if (Date.now() - row.at > ICS_CACHE_MS) {
      icsPublicUrlCache.delete(String(key));
      return null;
    }
    return row.url || null;
  }

  function setCachedPublicUrl(key, url) {
    if (!url) return;
    icsPublicUrlCache.set(String(key), { url: String(url), at: Date.now() });
  }

  /** Pre-carrega .ics + URL pública ao abrir o lead (necessario para iOS abrir no clique). */
  async function prefetchLeadVisitIcs(leadId) {
    const id = leadId != null ? String(leadId) : '';
    const key = cacheKey('lead', id);
    if (!id || (getCachedIcs(key) && getCachedPublicUrl(key))) return;
    try {
      const { ics, publicUrl } = await fetchIcsWithPublicUrl(leadVisitIcsUrl(id));
      setCachedIcs(key, ics);
      setCachedPublicUrl(key, publicUrl);
    } catch (err) {
      console.warn('[crm-device-calendar] prefetch', err);
    }
  }

  async function prefetchMeetingIcs(meetingId) {
    const id = meetingId != null ? String(meetingId) : '';
    const key = cacheKey('meeting', id);
    if (!id || (getCachedIcs(key) && getCachedPublicUrl(key))) return;
    try {
      const { ics, publicUrl } = await fetchIcsWithPublicUrl(meetingIcsUrl(id));
      setCachedIcs(key, ics);
      setCachedPublicUrl(key, publicUrl);
    } catch (err) {
      console.warn('[crm-device-calendar] meeting prefetch', err);
    }
  }

  /** Abre Calendario Apple via data URI (tem de ser sincrono no gesto do utilizador). */
  function openAppleCalendarFromCache(leadId) {
    const ics = getCachedIcs(cacheKey('lead', leadId));
    if (!ics) return false;
    const dataUrl = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    global.location.assign(dataUrl);
    return true;
  }

  async function ensureIcsCached(leadId) {
    const key = cacheKey('lead', leadId);
    let ics = getCachedIcs(key);
    if (ics) return ics;
    ics = await fetchLeadIcsText(leadId);
    setCachedIcs(key, ics);
    return ics;
  }

  function normalizeMeeting(meetingOrId) {
    if (meetingOrId == null) return null;
    if (typeof meetingOrId === 'string' || typeof meetingOrId === 'number') {
      return { id: String(meetingOrId), title: 'Compromisso' };
    }
    const id = meetingOrId.id != null ? String(meetingOrId.id) : '';
    if (!id) return null;
    const startRaw = meetingOrId.scheduled_start || meetingOrId.start || meetingOrId.scheduledStart;
    const endRaw = meetingOrId.scheduled_end || meetingOrId.end || meetingOrId.scheduledEnd;
    return {
      id,
      title: String(meetingOrId.title || 'Compromisso').trim() || 'Compromisso',
      location: meetingOrId.location != null ? String(meetingOrId.location) : '',
      notes: meetingOrId.notes != null ? String(meetingOrId.notes) : '',
      start: startRaw ? new Date(startRaw) : null,
      end: endRaw ? new Date(endRaw) : null,
    };
  }

  function buildGoogleCalendarMeetingUrl(meeting) {
    const m = normalizeMeeting(meeting);
    if (!m) return 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    let start = m.start && !Number.isNaN(m.start.getTime()) ? m.start : snapToNextHalfHour();
    let end = m.end && !Number.isNaN(m.end.getTime()) ? m.end : new Date(start.getTime() + 60 * 60 * 1000);
    if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 60 * 60 * 1000);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: m.title,
      dates: formatGoogleCalendarDate(start) + '/' + formatGoogleCalendarDate(end),
      details: m.notes || '',
      location: m.location || '',
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
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
    chooserMeeting = null;
    chooserOptions = null;
  }

  function openCalendarChooser(lead, options) {
    chooserLead = lead;
    chooserMeeting = null;
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

  function openMeetingCalendarChooser(meeting) {
    const m = normalizeMeeting(meeting);
    if (!m) return;
    chooserLead = null;
    chooserMeeting = m;
    chooserOptions = null;
    const root = ensureCalendarChooserDom();
    const nameEl = document.getElementById('sfCalendarChooserLeadName');
    const hintEl = document.getElementById('sfCalendarChooserHint');
    const appleBtn = document.getElementById('sfCalendarChooserApple');
    if (nameEl) nameEl.textContent = m.title;
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
    void prefetchMeetingIcs(m.id);
  }

  function onChooserAppleClick() {
    if (chooserMeeting && chooserMeeting.id) {
      const id = chooserMeeting.id;
      closeCalendarChooser();
      openMeetingIcsViaUserGesture(id);
      return;
    }
    const lead = chooserLead;
    if (!lead || lead.id == null) return;
    closeCalendarChooser();
    openIcsViaUserGesture(lead.id);
  }

  function onChooserGoogleClick() {
    if (chooserMeeting) {
      const m = chooserMeeting;
      closeCalendarChooser();
      global.location.href = buildGoogleCalendarMeetingUrl(m);
      return;
    }
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

  /**
   * @param {object|string} meetingOrId — meeting { id, title, scheduled_start, scheduled_end, location, notes } ou id
   * @returns {boolean}
   */
  function openMeetingInDeviceCalendar(meetingOrId) {
    const m = normalizeMeeting(meetingOrId);
    if (!m) return false;

    try {
      if (isAndroidDevice()) {
        global.location.href = buildGoogleCalendarMeetingUrl(m);
        return true;
      }

      const appleNative = isSafariBrowser() || isAppleMobile();
      if (appleNative) {
        return openMeetingIcsViaUserGesture(m.id);
      }

      void prefetchMeetingIcs(m.id);
      openMeetingCalendarChooser(m);
      return true;
    } catch (err) {
      console.warn('[crm-device-calendar] meeting', err);
      openMeetingCalendarChooser(m);
      return true;
    }
  }

  function escapeIcsText(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function formatIcsUtc(date) {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      'Z'
    );
  }

  /** .ics local (sem gravar no CRM) — para “Agendar no Apple Calendar”. */
  function buildDraftEventIcs(ev) {
    const title = String((ev && ev.title) || 'Compromisso').trim() || 'Compromisso';
    let start = ev && ev.start instanceof Date ? ev.start : ev && ev.scheduled_start ? new Date(ev.scheduled_start) : snapToNextHalfHour();
    if (Number.isNaN(start.getTime())) start = snapToNextHalfHour();
    let end =
      ev && ev.end instanceof Date
        ? ev.end
        : ev && ev.scheduled_end
          ? new Date(ev.scheduled_end)
          : new Date(start.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    const uid = 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '@obramate.com';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ObraMate//Meeting//PT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + formatIcsUtc(new Date()),
      'DTSTART:' + formatIcsUtc(start),
      'DTEND:' + formatIcsUtc(end),
      'SUMMARY:' + escapeIcsText(title),
    ];
    if (ev && ev.location) lines.push('LOCATION:' + escapeIcsText(ev.location));
    if (ev && ev.notes) lines.push('DESCRIPTION:' + escapeIcsText(ev.notes));
    lines.push('STATUS:TENTATIVE', 'END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Abre um evento rascunho no Calendar do dispositivo (não cria meeting no CRM).
   * Tem de correr no gesto do toque.
   */
  function openDraftEventInDeviceCalendar(ev) {
    const draft = {
      title: (ev && ev.title) || 'Compromisso',
      scheduled_start: ev && (ev.scheduled_start || ev.start),
      scheduled_end: ev && (ev.scheduled_end || ev.end),
      location: (ev && ev.location) || '',
      notes: (ev && ev.notes) || '',
      start: ev && ev.start instanceof Date ? ev.start : ev && ev.scheduled_start ? new Date(ev.scheduled_start) : null,
      end: ev && ev.end instanceof Date ? ev.end : ev && ev.scheduled_end ? new Date(ev.scheduled_end) : null,
    };
    try {
      if (isAndroidDevice()) {
        global.location.href = buildGoogleCalendarMeetingUrl(draft);
        return true;
      }
      const ics = buildDraftEventIcs(draft);
      const dataUrl = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
      if (isAppleMobile() || isSafariBrowser() || isStandaloneDisplay()) {
        global.location.assign(dataUrl);
        return true;
      }
      // Desktop: download .ics (abre no Calendar / Outlook).
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'compromisso.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch (err) {
      console.warn('[crm-device-calendar] draft', err);
      return false;
    }
  }

  global.sfOpenLeadVisitInDeviceCalendar = openLeadVisitInDeviceCalendar;
  global.sfPrefetchLeadVisitIcs = prefetchLeadVisitIcs;
  global.sfOpenMeetingInDeviceCalendar = openMeetingInDeviceCalendar;
  global.sfOpenDraftEventInDeviceCalendar = openDraftEventInDeviceCalendar;
  global.sfPrefetchMeetingIcs = prefetchMeetingIcs;
  global.sfBuildGoogleCalendarVisitUrl = buildGoogleCalendarUrl;
  global.sfSnapVisitToNextHalfHour = snapToNextHalfHour;
  global.sfOpenCalendarChooser = openCalendarChooser;
})(typeof window !== 'undefined' ? window : globalThis);
