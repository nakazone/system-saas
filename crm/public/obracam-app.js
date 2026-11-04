/**
 * ObraCam app: the ObraCam page as its own app, only inside /obracam.
 * Lists, photos, map and viewer come from job-media-board.js. This adds the tabs
 * (Jobs, Fotos, Ajustes) and takes photos here, without leaving for the job page.
 * On a computer or tablet it opens the normal ObraCam.
 */
(function () {
  if (!window.__OM_FOCUS_APP) return;
  const device = window.__omDevice;
  const isMobile = device && device.isMobile ? device.isMobile() : window.matchMedia('(max-width: 760px)').matches;
  if (!isMobile) {
    location.replace('/job-media-board.html' + location.search);
    return;
  }
  document.body.classList.add('oc-app');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = [
    { id: 'jobs', label: 'Jobs', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17H21"/><path d="M6 17V12L9 8H15L18 12V17"/><path d="M12 8V12"/></svg>' },
    { id: 'photos', label: 'Fotos', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8H7L9 5H15L17 8H21V19H3Z"/><path d="M10 10.5H14L15.5 13.5L14 16.5H10L8.5 13.5Z"/></svg>' },
    { id: 'settings', label: 'Ajustes', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7H20M4 17H20"/><path d="M8 5H11V9H8ZM14 15H17V19H14Z" fill="#fff"/></svg>' },
  ];
  const STAGES = [
    { id: 'before', label: 'Antes' },
    { id: 'during', label: 'Durante' },
    { id: 'after', label: 'Depois' },
    { id: '', label: 'Geral' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'oc-tabs';
  nav.setAttribute('aria-label', 'ObraCam');
  nav.innerHTML = TABS.map((t) => `<button type="button" class="oc-tab" data-oc-tab="${t.id}">${t.icon}${t.label}</button>`).join('');
  const panel = document.createElement('section');
  panel.className = 'oc-panel';
  panel.hidden = true;
  const sheet = document.createElement('div');
  sheet.className = 'oc-sheet';
  sheet.hidden = true;
  const camera = document.createElement('input');
  camera.type = 'file';
  camera.accept = 'image/*';
  camera.setAttribute('capture', 'environment');
  camera.hidden = true;
  const library = document.createElement('input');
  library.type = 'file';
  library.accept = 'image/*';
  library.multiple = true;
  library.hidden = true;
  document.body.append(panel, sheet, camera, library, nav);

  let session = null;
  function renderSettings() {
    const u = (session && session.user) || {};
    const org = (session && session.organization) || {};
    panel.innerHTML = `
      <h1 class="oc-title">Ajustes</h1>
      <div class="oc-list"><div class="oc-row" style="cursor:default"><span class="oc-row__t">${esc(u.name || u.email || '')}</span><span class="oc-row__s">${esc(org.name || '')}</span></div></div>
      ${canManage(u) ? `<div class="oc-list"><button type="button" class="oc-row" data-oc-stickers><span class="oc-row__t">Stickers</span><span class="oc-row__s">Etiquetas das fotos: Samples, Delivery, Scan…</span></button></div>` : ""}
      <div class="oc-list"><a class="oc-row" href="/dashboard"><span class="oc-row__t">Abrir o ObraMate</span><span class="oc-row__s">Jobs, quotes, invoices e o resto do sistema</span></a></div>
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
  let target = null;
  let stage = 'during';

  function renderSheet(status, busy) {
    sheet.innerHTML = `<div class="oc-sheet__card" role="dialog" aria-modal="true" aria-label="Tirar foto">
      <h2>Tirar foto</h2>
      <p>${esc(target ? target.label : '')}</p>
      <div class="oc-stages">${STAGES.map((s) => `<button type="button" class="oc-stage${s.id === stage ? ' is-on' : ''}" data-oc-stage="${s.id}"${busy ? ' disabled' : ''}>${s.label}</button>`).join('')}</div>
      <div class="oc-go">
        <button type="button" data-oc-camera${busy ? ' disabled' : ''}>Câmera</button>
        <button type="button" class="is-sec" data-oc-library${busy ? ' disabled' : ''}>Galeria</button>
      </div>
      <div class="oc-status" role="status">${esc(status || '')}</div>
      <button type="button" class="oc-cancel" data-oc-close${busy ? ' disabled' : ''}>Cancelar</button>
    </div>`;
  }

  function compress(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível ler esta imagem. Use JPG ou PNG.'));
      };
      img.src = url;
    });
  }

  function gps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      const timer = setTimeout(() => resolve(null), 1500);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
        () => { clearTimeout(timer); resolve(null); },
        { enableHighAccuracy: true, timeout: 1500, maximumAge: 60000 },
      );
    });
  }

  async function upload(files) {
    const list = Array.from(files || []);
    if (!list.length || !target) return;
    let sent = 0;
    try {
      const pos = await gps();
      for (const file of list) {
        renderSheet(`Enviando ${sent + 1} de ${list.length}…`, true);
        const body = {
          data_url: await compress(file),
          stage: stage || null,
          taken_at_device: new Date().toISOString(),
          lat: pos ? pos.lat : null,
          lng: pos ? pos.lng : null,
          gps_accuracy_m: pos ? pos.acc : null,
          client_upload_id: window.crypto && crypto.randomUUID ? crypto.randomUUID() : `cam-${Date.now()}-${sent}`,
          device_label: 'ObraCam app',
          is_public: false,
        };
        const r = await fetch(`/api/work-orders/${encodeURIComponent(target.id)}/media`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.success === false) throw new Error(j.error || 'Falha ao enviar a foto');
        sent += 1;
      }
      sheet.hidden = true;
      if (window.crmToast && window.crmToast.success) window.crmToast.success(sent === 1 ? 'Foto enviada' : `${sent} fotos enviadas`);
      if (window.__camApp) await window.__camApp.reload(target.id);
    } catch (e) {
      renderSheet(`${sent ? `${sent} enviada${sent === 1 ? '' : 's'}. ` : ''}${e.message || 'Falha ao enviar. Tente de novo.'}`, false);
      if (sent && window.__camApp) window.__camApp.reload(target.id).catch(() => {});
    }
  }

  camera.addEventListener('change', () => { upload(camera.files); camera.value = ''; });
  library.addEventListener('change', () => { upload(library.files); library.value = ''; });

  // Prefer the shared board upload sheet (stage chips). Keep a fallback for old #fotos links.
  document.addEventListener('click', (ev) => {
    const up = ev.target.closest('[data-cam-upload]');
    if (up) {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.__camApp && typeof window.__camApp.openUpload === 'function') {
        window.__camApp.openUpload(up.getAttribute('data-cam-upload'));
      }
      return;
    }
    const link = ev.target.closest('a[href*="job-detail.html"][href$="#fotos"]');
    if (!link || link.classList.contains('cam-row')) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = new URL(link.href).searchParams.get('id');
    if (window.__camApp && typeof window.__camApp.openUpload === 'function' && id) {
      window.__camApp.openUpload(id);
      return;
    }
    const title = document.querySelector('#camDetail h2');
    target = { id, label: title ? title.textContent.trim() : '' };
    renderSheet('', false);
    sheet.hidden = false;
  }, true);

  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-oc-stickers]')) {
      if (window.__camApp && window.__camApp.manageStickers) window.__camApp.manageStickers();
      return;
    }
    const t = ev.target.closest('[data-oc-tab],[data-oc-stage],[data-oc-camera],[data-oc-library],[data-oc-close],[data-oc-logout]');
    if (!t) return;
    if (t.dataset.ocTab) return show(t.dataset.ocTab);
    if (t.dataset.ocStage !== undefined) { stage = t.dataset.ocStage; return renderSheet('', false); }
    if (t.hasAttribute('data-oc-camera')) return camera.click();
    if (t.hasAttribute('data-oc-library')) return library.click();
    if (t.hasAttribute('data-oc-close')) { sheet.hidden = true; return; }
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
