/**
 * CRM shell — top bar + sidebar collapse (desktop).
 * Persistência: localStorage key `crm_sidebar_collapsed`.
 */
(function () {
  const STORAGE_KEY = 'crm_sidebar_collapsed';

  function wrapNavLabels(root) {
    if (!root) return;
    root.querySelectorAll('.nav-item').forEach((el) => {
      if (el.querySelector('.nav-item__label')) return;
      const textNodes = [...el.childNodes].filter(
        (n) => n.nodeType === Node.TEXT_NODE && String(n.textContent || '').trim()
      );
      if (!textNodes.length) return;
      const label = textNodes.map((n) => String(n.textContent || '').trim()).join(' ');
      textNodes.forEach((n) => n.remove());
      const span = document.createElement('span');
      span.className = 'nav-item__label';
      span.textContent = label;
      el.appendChild(span);
      if (!el.getAttribute('title')) el.setAttribute('title', label);
      el.setAttribute('aria-label', label);
    });
  }

  function setCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch (_) {}
    const btn = document.getElementById('sidebarCollapseBtn');
    if (btn) {
      btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
      btn.setAttribute(
        'aria-label',
        collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'
      );
      btn.title = collapsed ? 'Expandir menu' : 'Recolher menu';
    }
  }

  function isCollapsed() {
    return document.body.classList.contains('sidebar-collapsed');
  }

  function initCollapse() {
    const sidebar = document.getElementById('dashboardSidebar');
    wrapNavLabels(sidebar);

    let saved = false;
    try {
      saved = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {}
    // Só aplica collapse em desktop
    if (window.matchMedia('(min-width: 1025px)').matches) {
      setCollapsed(saved);
    } else {
      setCollapsed(false);
    }

    const btn = document.getElementById('sidebarCollapseBtn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (!window.matchMedia('(min-width: 1025px)').matches) return;
        setCollapsed(!isCollapsed());
      });
    }

    window.matchMedia('(min-width: 1025px)').addEventListener('change', (e) => {
      if (!e.matches) setCollapsed(false);
      else {
        try {
          setCollapsed(localStorage.getItem(STORAGE_KEY) === '1');
        } catch (_) {
          setCollapsed(false);
        }
      }
    });
  }

  function openSearch() {
    if (typeof window.openCrmCommandPalette === 'function') {
      window.openCrmCommandPalette();
      return;
    }
    const input = document.getElementById('crmCmdPaletteInput');
    if (input) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
      );
    }
  }

  function initTopbar() {
    const searchBtn = document.getElementById('crmTopbarSearchBtn');
    const searchInput = document.getElementById('crmTopbarSearchInput');
    const kbd = searchBtn && searchBtn.querySelector('kbd');
    if (kbd) {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
      kbd.textContent = isMac ? '⌘K' : 'Ctrl+K';
    }
    if (searchBtn && !searchBtn.dataset.bound) {
      searchBtn.dataset.bound = '1';
      searchBtn.addEventListener('click', openSearch);
    }
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = '1';
      searchInput.addEventListener('focus', (e) => {
        e.preventDefault();
        searchInput.blur();
        openSearch();
      });
      searchInput.addEventListener('keydown', (e) => {
        e.preventDefault();
        openSearch();
      });
    }
  }

  function placeNotificationBell() {
    const wrap = document.getElementById('notificationBellWrap');
    if (!wrap) return;
    const topRight = document.querySelector('#crmTopbar .crm-topbar__right');
    const helpBtn = document.getElementById('crmTopbarHelpBtn');
    const mobileHeader = document.getElementById('mobileAppHeader');
    const desktop = window.matchMedia('(min-width: 1025px)').matches;

    if (desktop && topRight) {
      if (helpBtn && wrap.nextElementSibling !== helpBtn) {
        topRight.insertBefore(wrap, helpBtn);
      } else if (!helpBtn && wrap.parentElement !== topRight) {
        topRight.appendChild(wrap);
      }
      wrap.classList.remove('notification-bell-wrap--mobile');
    } else if (mobileHeader && wrap.parentElement !== mobileHeader) {
      mobileHeader.appendChild(wrap);
      wrap.classList.add('notification-bell-wrap--mobile');
    }
  }

  function init() {
    if (!document.getElementById('crmTopbar') && !document.getElementById('dashboardSidebar')) {
      return;
    }
    initCollapse();
    initTopbar();
    placeNotificationBell();
    window.matchMedia('(min-width: 1025px)').addEventListener('change', () => {
      placeNotificationBell();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__crmShell = { setCollapsed, isCollapsed, openSearch };
})();
