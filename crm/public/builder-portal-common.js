/* global sessionStorage, window, document, location */
(function () {
  const RETURN_KEY = 'sf_builder_return_url';
  const SKIP_PASSWORD_PAGES = [
    'builder-login',
    'builder-forgot-password',
    'builder-reset-password',
    'builder-change-password',
  ];

  function pageStem() {
    return (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  }

  const SF_LOGO_URL = '/assets/SeniorFloors.png?v=20260531';
  const PORTAL_UI_VERSION = '20260531-crm-nav';

  const NOTIF_ICONS = {
    project: '\u{1F514}',
    message: '\u{1F4AC}',
    checklist: '\u2705',
    visit: '\u{1F4C5}',
    document_expiry: '\u{1F4C1}',
    document: '\u{1F4C1}',
    pricing: '\u{1F4B0}',
    completed: '\u{1F389}',
    estimate: '\u{1F4CB}',
    info: '\u2139\uFE0F',
  };

  function notifIcon(type) {
    const k = String(type || 'info').toLowerCase();
    return NOTIF_ICONS[k] || NOTIF_ICONS.info;
  }

  function fmtNotifTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Badge SF nos avatares de contactos Senior Floors (portal builder). */
  function sfContactBadgeHtml(title) {
    const t = escapeHtml(title || 'Senior Floors');
    return `<span class="bp-sf-contact-badge" title="${t}"><img src="${SF_LOGO_URL}" alt="${t}" width="26" height="26" loading="lazy" /></span>`;
  }

  function enhanceAuthFetch() {
    if (!window.builderAuth || window.builderAuth._portalEnhanced) return;
    const orig = window.builderAuth.fetch.bind(window.builderAuth);
    window.builderAuth.fetch = async function (path, opts) {
      const r = await orig(path, opts);
      if (r.status === 401 && !SKIP_PASSWORD_PAGES.includes(pageStem())) {
        sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
        location.href = 'builder-login.html?expired=1';
      }
      return r;
    };
    window.builderAuth._portalEnhanced = true;
  }

  async function guardPortalPage() {
    if (!window.builderAuth) return false;
    enhanceAuthFetch();
    const stem = pageStem();
    if (SKIP_PASSWORD_PAGES.includes(stem)) return true;
    if (!window.builderAuth.getToken()) {
      sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
      location.href = 'builder-login.html';
      return false;
    }
    try {
      const r = await window.builderAuth.fetch('/api/builder-auth/me');
      const j = await r.json();
      if (!j.success) return false;
      if (j.data.portal_password_must_change && stem !== 'builder-change-password') {
        location.href = 'builder-change-password.html?required=1';
        return false;
      }
      window.builderPortalUser = j.data;
      return true;
    } catch {
      return false;
    }
  }

  let badgePollTimer = null;

  async function fetchUnreadCounts() {
    let unread = { messages: 0, notifications: 0, total: 0 };
    try {
      const r = await window.builderAuth.fetch('/api/builder-notifications/unread-count');
      const j = await r.json();
      if (j.success) unread = j.data;
    } catch (_) {}
    return unread;
  }

  function applyUnreadBadges(unread) {
    const metric = document.getElementById('metricUnread');
    if (metric) metric.textContent = String(unread.total || 0);
    const navBadge = document.getElementById('bpNavMsgBadge');
    if (navBadge) {
      const n = unread.total || 0;
      navBadge.textContent = n > 99 ? '99+' : String(n);
      navBadge.classList.toggle('hidden', n <= 0);
    }
    const existing = document.querySelector('.bp-notif-badge');
    if (existing) {
      const n = unread.total || 0;
      if (n > 0) {
        existing.textContent = n > 99 ? '99+' : String(n);
        existing.classList.remove('hidden');
      } else {
        existing.remove();
      }
    } else {
      const btn = document.getElementById('bpNotifBtn');
      const n = unread.total || 0;
      if (btn && n > 0) {
        const span = document.createElement('span');
        span.className = 'bp-notif-badge';
        span.textContent = n > 99 ? '99+' : String(n);
        btn.appendChild(span);
      }
    }
  }

  async function refreshUnreadBadges() {
    if (!window.builderAuth?.getToken?.()) return;
    applyUnreadBadges(await fetchUnreadCounts());
  }

  function startBadgePolling() {
    if (badgePollTimer) clearInterval(badgePollTimer);
    if (!window.builderAuth?.getToken?.()) return;
    badgePollTimer = setInterval(() => {
      void refreshUnreadBadges();
    }, 30000);
  }

  let notifClickBound = false;

  function notifBtnHtml(unread) {
    const n = unread.total || 0;
    return `<button type="button" class="bp-sidebar-notif-btn" id="bpNotifBtn" aria-label="Notifications">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
      ${n > 0 ? `<span class="bp-notif-badge">${n > 99 ? '99+' : n}</span>` : ''}
    </button>
    <div class="bp-notif-dropdown bp-notif-dropdown--sidebar hidden" id="bpNotifDropdown"></div>`;
  }

  function wirePortalLogout() {
    document.getElementById('btnPortalLogout')?.addEventListener('click', () => {
      window.builderAuth.setToken(null);
      location.href = 'builder-login.html';
    });
  }

  function wireNotificationDropdown() {
    if (notifClickBound) return;
    notifClickBound = true;

    document.getElementById('bpNotifBtn')?.addEventListener('click', async () => {
      const dd = document.getElementById('bpNotifDropdown');
      if (!dd) return;
      if (!dd.classList.contains('hidden')) {
        dd.classList.add('hidden');
        return;
      }
      dd.classList.remove('hidden');
      dd.innerHTML = '<p class="bp-muted" style="padding:12px">Loading...</p>';
      const r = await window.builderAuth.fetch('/api/builder-notifications?limit=20');
      const j = await r.json();
      const rows = j.data || [];
      dd.innerHTML =
        `<div class="bp-notif-head">
          <strong>Notifications</strong>
          <button type="button" class="bp-link-btn" id="bpMarkAllRead">Mark all read</button>
        </div>` +
        (rows.length
          ? rows
              .map((n) => {
                const href = n.link_url || '#';
                const icon = notifIcon(n.type);
                const cleanBody = String(n.body || '')
                  .replace(/\s*\[doc:\d+:d\d+\]\s*$/i, '')
                  .trim();
                return `<a href="${escapeHtml(href)}" class="bp-notif-item${n.is_read ? '' : ' bp-notif-item--unread'}" data-notif-id="${n.id}">
                    <span class="bp-notif-item__icon" aria-hidden="true">${icon}</span>
                    <span class="bp-notif-item__content">
                      <span class="bp-notif-item__title">${escapeHtml(n.title)}</span>
                      <span class="bp-notif-item__body">${escapeHtml(cleanBody)}</span>
                      <span class="bp-notif-item__time">${escapeHtml(fmtNotifTime(n.created_at))}</span>
                    </span>
                  </a>`;
              })
              .join('')
          : '<p class="bp-muted" style="padding:12px">No notifications yet.</p>') +
        `<div class="bp-notif-foot"><a href="builder-profile.html#notifications">Manage notification preferences</a></div>`;

      dd.querySelectorAll('.bp-notif-item[data-notif-id]').forEach((el) => {
        el.addEventListener('click', async () => {
          const nid = el.dataset.notifId;
          if (!nid) return;
          try {
            await window.builderAuth.fetch(`/api/builder-notifications/${nid}/read`, {
              method: 'POST',
            });
            void refreshUnreadBadges();
          } catch (_) {}
        });
      });

      document.getElementById('bpMarkAllRead')?.addEventListener('click', async () => {
        await window.builderAuth.fetch('/api/builder-notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
        await loadPortalSidebarFooter();
        void refreshUnreadBadges();
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.bp-notif-wrap, #bpSidebarNotifWrap')) {
        document.getElementById('bpNotifDropdown')?.classList.add('hidden');
      }
    });
  }

  async function loadPortalSidebarFooter() {
    const nameEl = document.getElementById('bpSidebarName');
    if (!nameEl) return loadPortalHeader();

    const unread = await fetchUnreadCounts();
    const u = window.builderPortalUser || {};
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Partner';

    nameEl.textContent = name;
    const roleEl = document.getElementById('bpSidebarRole');
    if (roleEl) roleEl.textContent = u.company || 'Partner portal';
    const av = document.getElementById('bpSidebarAvatar');
    if (av) av.textContent = (u.first_name || 'B')[0].toUpperCase();

    const notifWrap = document.getElementById('bpSidebarNotifWrap');
    if (notifWrap) {
      notifWrap.className = 'bp-notif-wrap';
      notifWrap.innerHTML = notifBtnHtml(unread);
    }

    wirePortalLogout();
    wireNotificationDropdown();
  }

  async function loadPortalHeader() {
    const slot = document.getElementById('bpPortalHeader');
    if (!slot) return;
    const unread = await fetchUnreadCounts();

    const u = window.builderPortalUser || {};
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Partner';

    slot.innerHTML = `
      <div class="bp-header-bar">
        <div class="bp-header-bar__user">
          <a href="builder-profile.html" class="bp-header-avatar" title="Profile">${escapeHtml((u.first_name || 'B')[0])}</a>
          <div>
            <div class="bp-header-bar__name">${escapeHtml(name)}</div>
            <div class="bp-header-bar__co">${escapeHtml(u.company || '')}</div>
          </div>
        </div>
        <div class="bp-header-bar__actions">
          <div class="bp-notif-wrap">
            ${notifBtnHtml(unread)}
          </div>
          <button type="button" class="bp-btn-ghost" id="btnPortalLogout">Logout</button>
        </div>
      </div>`;

    wirePortalLogout();
    wireNotificationDropdown();
  }

  function pageHeaderHtml({ title, subtitle = '', actionsHtml = '', eyebrow = 'Senior Floors Partner' }) {
    return `<header class="bp-page-header">
      <div class="bp-page-header__text">
        ${eyebrow ? `<p class="bp-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1 class="bp-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="bp-page-header__sub">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="bp-page-header__actions">${actionsHtml}</div>` : ''}
    </header>`;
  }

  function setMobileSidebarOpen(open) {
    const sidebar =
      document.getElementById('dashboardSidebar') || document.querySelector('.bp-portal-sidebar');
    const overlay = document.getElementById('mobileOverlay');
    const toggle =
      document.getElementById('mobileMenuToggle') || document.getElementById('bpMenuToggle');
    if (!sidebar) return;
    if (sidebar.id === 'dashboardSidebar' && overlay) {
      sidebar.classList.toggle('mobile-open', open);
      overlay.classList.toggle('active', open);
      overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    } else {
      sidebar.classList.toggle('bp-sidebar--open', open);
      const legacy = document.getElementById('bpSidebarOverlay');
      legacy?.classList.toggle('is-visible', open);
    }
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeMobileSidebar() {
    setMobileSidebarOpen(false);
  }

  function openMobileSidebar() {
    setMobileSidebarOpen(true);
  }

  function initPortalContentWrap() {
    const main = document.querySelector('.bp-portal-main');
    if (!main || main.querySelector('.bp-page-content')) return;
    const headerSlot = document.getElementById('bpPortalHeader');
    const children = [...main.children].filter((el) => el.id !== 'bpPortalHeader');
    if (!children.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'bp-page-content';
    children.forEach((el) => wrap.appendChild(el));
    if (headerSlot) main.insertBefore(wrap, headerSlot.nextSibling);
    else main.appendChild(wrap);
  }

  function wireMobileNav() {
    const btn =
      document.getElementById('bpMenuToggle') || document.getElementById('mobileMenuToggle');
    const sidebar =
      document.getElementById('dashboardSidebar') || document.querySelector('.bp-portal-sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (!btn || !sidebar) return;
    btn.addEventListener('click', () => {
      const open =
        sidebar.id === 'dashboardSidebar'
          ? sidebar.classList.contains('mobile-open')
          : sidebar.classList.contains('bp-sidebar--open');
      setMobileSidebarOpen(!open);
    });
    overlay?.addEventListener('click', closeMobileSidebar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMobileSidebar();
    });
    sidebar.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 768px)').matches) closeMobileSidebar();
      });
    });
  }

  let portalReadyPromise = null;

  function whenPortalReady() {
    if (!portalReadyPromise) {
      portalReadyPromise = (async () => {
        if (!window.builderAuth) return false;
        const stem = pageStem();
        if (SKIP_PASSWORD_PAGES.includes(stem)) return false;
        const ok = await guardPortalPage();
        if (!ok) return false;
        if (window.builderPortalNav?.renderNav) {
          window.builderPortalNav.renderNav(window.builderPortalNav.currentPage());
        }
        initPortalContentWrap();
        await loadPortalSidebarFooter();
        wireMobileNav();
        startBadgePolling();
        return true;
      })();
    }
    return portalReadyPromise;
  }

  window.builderPortalCommon = {
    guardPortalPage,
    loadPortalHeader,
    loadPortalSidebarFooter,
    refreshUnreadBadges,
    startBadgePolling,
    wireMobileNav,
    whenPortalReady,
    pageHeaderHtml,
    initPortalContentWrap,
    PORTAL_UI_VERSION,
    RETURN_KEY,
    SF_LOGO_URL,
    sfContactBadgeHtml,
  };

  window.addEventListener('beforeunload', () => {
    if (badgePollTimer) clearInterval(badgePollTimer);
  });

  document.addEventListener('DOMContentLoaded', () => {
    void whenPortalReady();
  });
})();
