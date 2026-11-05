/**
 * ObraCam app: the ObraCam page as its own app, only inside /obracam.
 * Lists, photos, map and viewer come from job-media-board.js. This adds the tabs
 * (Jobs, Fotos, Ajustes) and takes photos here, without leaving for the job page.
 * On a computer or tablet it opens the normal ObraCam.
 */
(function () {
  // The phone-or-computer check runs first, inline at the top of <body> (job-media-board.html), so a computer
  // leaves for the normal ObraCam before the page does any work; this file only has to stand aside.
  if (!window.__OM_FOCUS_APP || window.__OM_CAM_LEAVING) return;
  document.body.classList.add('oc-app');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = [
    { id: 'jobs', label: 'Jobs', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17H21"/><path d="M6 17V12L9 8H15L18 12V17"/><path d="M12 8V12"/></svg>' },
    { id: 'photos', label: 'Fotos', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8H7L9 5H15L17 8H21V19H3Z"/><path d="M10 10.5H14L15.5 13.5L14 16.5H10L8.5 13.5Z"/></svg>' },
    { id: 'settings', label: 'Ajustes', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7H20M4 17H20"/><path d="M8 5H11V9H8ZM14 15H17V19H14Z" fill="#fff"/></svg>' },
  ];
  const nav = document.createElement('nav');
  nav.className = 'oc-tabs';
  nav.setAttribute('aria-label', 'ObraCam');
  nav.innerHTML = TABS.map((t) => `<button type="button" class="oc-tab" data-oc-tab="${t.id}">${t.icon}${t.label}</button>`).join('');
  const panel = document.createElement('section');
  panel.className = 'oc-panel';
  panel.hidden = true;
  document.body.append(panel, nav);

  let session = null;
  function renderSettings() {
    const u = (session && session.user) || {};
    const org = (session && session.organization) || {};
    panel.innerHTML = `
      <h1 class="oc-title">Ajustes</h1>
      <div class="oc-list"><div class="oc-row" style="cursor:default"><span class="oc-row__t">${esc(u.name || u.email || '')}</span><span class="oc-row__s">${esc(org.name || '')}</span></div></div>
      ${canManage(u) ? `<div class="oc-list"><button type="button" class="oc-row" data-oc-stickers><span class="oc-row__t">Etiquetas</span><span class="oc-row__s">Crie, renomeie e arquive as etiquetas das fotos</span></button></div>` : ""}
      <div class="oc-list"><a class="oc-row" href="/dashboard"><span class="oc-row__t">Abrir o ObraMate</span><span class="oc-row__s">Jobs, orçamentos, faturas e o resto do sistema</span></a></div>
      <div class="oc-list"><button type="button" class="oc-row oc-row--danger" data-oc-logout><span class="oc-row__t">Sair</span></button></div>`;
  }

  function canManage(u) {
    return !!u && (u.role === "admin" || (u.permissions || []).includes("work_orders.manage"));
  }

  function markTab(id) {
    nav.querySelectorAll('[data-oc-tab]').forEach((b) => {
      const on = b.dataset.ocTab === id;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function show(id) {
    markTab(id);
    panel.hidden = id !== 'settings';
    document.body.classList.toggle('oc-settings', id === 'settings');
    document.body.classList.toggle('oc-feed', id === 'photos');
    if (id === 'settings') return renderSettings();
    const app = window.__camApp;
    if (id === 'photos') {
      if (app) app.setView('photos');
    } else if (app && app.mode() === 'photos') {
      app.setView('jobs');
    } else {
      const backLink = document.querySelector('#camDetail [data-cam-back]');
      if (backLink && document.body.classList.contains('cam-detail-open')) backLink.click();
    }
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ taking photos
  // One upload sheet for the whole page: job-media-board.js (stickers, "Tirada por", per-file progress, retry).
  const openUpload = (id) => {
    if (id && window.__camApp && typeof window.__camApp.openUpload === 'function') window.__camApp.openUpload(id);
  };
  document.addEventListener('click', (ev) => {
    const up = ev.target.closest('[data-cam-upload]');
    if (up) {
      ev.preventDefault();
      ev.stopPropagation();
      openUpload(up.getAttribute('data-cam-upload'));
      return;
    }
    // old "#fotos" links to the job page take photos here instead of leaving the app
    const link = ev.target.closest('a[href*="job-detail.html"][href$="#fotos"]');
    if (!link || link.classList.contains('cam-row')) return;
    ev.preventDefault();
    ev.stopPropagation();
    openUpload(new URL(link.href).searchParams.get('id'));
  }, true);

  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-oc-stickers]')) {
      if (window.__camApp && window.__camApp.manageStickers) window.__camApp.manageStickers();
      return;
    }
    const t = ev.target.closest('[data-oc-tab],[data-oc-logout]');
    if (!t) return;
    if (t.dataset.ocTab) return show(t.dataset.ocTab);
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .then(() => { location.href = '/login.html?app=obracam'; });
  });

  fetch('/api/auth/session', { credentials: 'include' })
    .then((r) => r.json())
    .then((s) => { session = s; if (!panel.hidden) renderSettings(); })
    .catch(() => {});

  markTab('jobs');

  // Keep the tabs in step when the page itself moves, like a map pin opening a job from Fotos.
  function syncTab() {
    if (!panel.hidden || !window.__camApp) return;
    const photos = window.__camApp.mode() === 'photos';
    document.body.classList.toggle('oc-feed', photos);
    markTab(photos ? 'photos' : 'jobs');
  }
  new MutationObserver(syncTab).observe(document.getElementById('camDetail'), { childList: true });
  new MutationObserver(syncTab).observe(document.getElementById('camSplit'), { attributes: true, attributeFilter: ['class'] });
})();
