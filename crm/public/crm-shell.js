/**
 * CRM shell — chrome estático (top bar + sidebar) em todas as telas.
 * - Injeta top bar ObraMate se faltar
 * - Garante sidebar com nav partilhada + collapse
 * - Normaliza IDs e carrega CSS/JS auxiliares (account, help, palette)
 */
(function () {
  const STORAGE_KEY = "crm_sidebar_collapsed";
  const SHELL_VER = "20260924-addr";

  const TOPBAR_HTML = `
<header class="crm-topbar" id="crmTopbar" aria-label="Barra superior">
  <a href="dashboard.html" class="crm-topbar__brand" aria-label="ObraMate — início">
    <img src="/assets/obramate-logo.png" alt="ObraMate" class="crm-system-logo" width="160" height="36" onerror="this.style.display='none'" />
  </a>
  <div class="crm-topbar__right">
    <button type="button" class="crm-topbar__search" id="crmTopbarSearchBtn" aria-label="Pesquisar no sistema" title="Pesquisar (⌘K)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <span class="crm-topbar__search-text">Pesquisar…</span>
      <kbd>⌘K</kbd>
    </button>
    <button type="button" class="crm-topbar__install-btn" data-crm-pwa-install title="Instalar ObraMate neste dispositivo" aria-label="Instalar aplicativo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>
      <span>Instalar app</span>
    </button>
    <button type="button" class="crm-topbar__icon-btn" id="crmTopbarHelpBtn" title="Ajuda / Suporte" aria-label="Ajuda e suporte">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
    </button>
    <a href="ajustes.html" class="crm-topbar__icon-btn" id="crmTopbarSettingsBtn" title="Menu da conta" aria-label="Menu da conta">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    </a>
  </div>
</header>`;

  const SIDEBAR_HTML = `
<aside class="dashboard-sidebar" id="dashboardSidebar">
  <div class="sidebar-header">
    <img src="/assets/obramate-logo.png" alt="Empresa" class="sidebar-brand-logo" width="220" height="44" onerror="this.style.display='none'" />
    <button type="button" class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-pressed="false" aria-label="Recolher menu lateral" title="Recolher menu">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
  </div>
  <nav class="sidebar-nav" aria-label="Principal">
    <div id="crmSharedNavRoot" data-layout="sidebar"></div>
  </nav>
  <div class="sidebar-footer">
    <div class="sidebar-user-bar">
      <div class="sidebar-user-bar__avatar" id="sidebarUserAvatar" aria-hidden="true">—</div>
      <div class="sidebar-user-bar__text">
        <span class="sidebar-user-bar__name" id="sidebarUserName">—</span>
        <span class="sidebar-user-bar__role" id="sidebarUserRole"></span>
      </div>
      <button type="button" id="logoutBtn" class="sidebar-logout-btn" title="Sair" aria-label="Sair">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
      </button>
    </div>
  </div>
</aside>
<div class="mobile-overlay" id="mobileOverlay"></div>`;

  function isAuthPage() {
    const f = (location.pathname || "").split("/").pop() || "";
    return /^(login|builder-login|change-password)\.html$/i.test(f) || f === "login";
  }

  function ensureStylesheet(href) {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => (l.getAttribute("href") || "").includes(href.split("?")[0]))) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href.includes("?") ? href : `${href}?v=${SHELL_VER}`;
    document.head.appendChild(link);
  }

  function ensureScript(src, attrs) {
    const base = src.split("?")[0];
    if ([...document.querySelectorAll("script[src]")].some((s) => (s.getAttribute("src") || "").includes(base))) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src.includes("?") ? src : `${src}?v=${SHELL_VER}`;
      if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(src));
      document.body.appendChild(el);
    });
  }

  function getSidebar() {
    return (
      document.getElementById("dashboardSidebar") ||
      document.querySelector("aside.dashboard-sidebar") ||
      document.querySelector(".dashboard-sidebar")
    );
  }

  function wrapNavLabels(root) {
    if (!root) return;
    root.querySelectorAll(".nav-item").forEach((el) => {
      if (el.querySelector(".nav-item__label")) return;
      const textNodes = [...el.childNodes].filter(
        (n) => n.nodeType === Node.TEXT_NODE && String(n.textContent || "").trim()
      );
      if (!textNodes.length) return;
      const label = textNodes.map((n) => String(n.textContent || "").trim()).join(" ");
      textNodes.forEach((n) => n.remove());
      const span = document.createElement("span");
      span.className = "nav-item__label";
      span.textContent = label;
      el.appendChild(span);
      if (!el.getAttribute("title")) el.setAttribute("title", label);
      el.setAttribute("aria-label", label);
    });
  }

  function setCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch (_) {}
    const btn = document.getElementById("sidebarCollapseBtn");
    if (btn) {
      btn.setAttribute("aria-pressed", collapsed ? "true" : "false");
      btn.setAttribute("aria-label", collapsed ? "Expandir menu lateral" : "Recolher menu lateral");
      btn.title = collapsed ? "Expandir menu" : "Recolher menu";
    }
  }

  function isCollapsed() {
    return document.body.classList.contains("sidebar-collapsed");
  }

  function ensureTopbar() {
    if (document.getElementById("crmTopbar")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = TOPBAR_HTML.trim();
    const topbar = wrap.firstElementChild;
    const mobile = document.getElementById("mobileAppHeader");
    if (mobile && mobile.parentNode) {
      mobile.parentNode.insertBefore(topbar, mobile);
    } else {
      document.body.insertBefore(topbar, document.body.firstChild);
    }
  }

  function ensureSidebarStructure(sidebar) {
    if (!sidebar) return null;
    if (!sidebar.id) sidebar.id = "dashboardSidebar";
    // Prefer canonical id for shell CSS / mobile toggle
    if (sidebar.id !== "dashboardSidebar") {
      sidebar.dataset.shellAliasId = sidebar.id;
      sidebar.id = "dashboardSidebar";
    }

    let header = sidebar.querySelector(".sidebar-header");
    if (!header) {
      header = document.createElement("div");
      header.className = "sidebar-header";
      sidebar.insertBefore(header, sidebar.firstChild);
    }
    if (!header.querySelector(".sidebar-brand-logo")) {
      const img = document.createElement("img");
      img.src = "/assets/obramate-logo.png";
      img.alt = "Empresa";
      img.className = "sidebar-brand-logo";
      img.width = 220;
      img.height = 44;
      img.onerror = function () {
        this.style.display = "none";
      };
      header.insertBefore(img, header.firstChild);
    }
    if (!header.querySelector("#sidebarCollapseBtn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidebar-collapse-btn";
      btn.id = "sidebarCollapseBtn";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Recolher menu lateral");
      btn.title = "Recolher menu";
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
      header.appendChild(btn);
    }

    let nav = sidebar.querySelector("nav.sidebar-nav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "sidebar-nav";
      nav.setAttribute("aria-label", "Principal");
      header.after(nav);
    }

    let root = nav.querySelector("#crmSharedNavRoot");
    if (!root) {
      nav.innerHTML = "";
      root = document.createElement("div");
      root.id = "crmSharedNavRoot";
      root.setAttribute("data-layout", "sidebar");
      nav.appendChild(root);
    } else {
      root.setAttribute("data-layout", "sidebar");
      // Drop any hardcoded sibling groups left beside the shared root
      [...nav.children].forEach((child) => {
        if (child !== root) child.remove();
      });
      const oldTop = root.querySelector(".crm-shared-nav");
      if (oldTop) oldTop.remove();
    }

    if (!sidebar.querySelector(".sidebar-footer")) {
      const footer = document.createElement("div");
      footer.className = "sidebar-footer";
      footer.innerHTML = `
        <div class="sidebar-user-bar">
          <div class="sidebar-user-bar__avatar" id="sidebarUserAvatar" aria-hidden="true">—</div>
          <div class="sidebar-user-bar__text">
            <span class="sidebar-user-bar__name" id="sidebarUserName">—</span>
            <span class="sidebar-user-bar__role" id="sidebarUserRole"></span>
          </div>
          <button type="button" id="logoutBtn" class="sidebar-logout-btn" title="Sair" aria-label="Sair">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
          </button>
        </div>`;
      sidebar.appendChild(footer);
    }

    if (!document.getElementById("mobileOverlay")) {
      const ov = document.createElement("div");
      ov.className = "mobile-overlay";
      ov.id = "mobileOverlay";
      sidebar.after(ov);
    }

    const mobileToggle = document.getElementById("mobileMenuToggle");
    if (mobileToggle) mobileToggle.setAttribute("aria-controls", "dashboardSidebar");

    return sidebar;
  }

  /** Pages that only had horizontal shared-nav → promote to full sidebar shell */
  function promoteStandaloneToShell() {
    const orphanRoot = document.getElementById("crmSharedNavRoot");
    const hasSidebar = !!getSidebar();
    if (hasSidebar || !orphanRoot) return;

    document.body.classList.add("dashboard-app-body");
    document.body.classList.remove("crm-standalone-page");

    // Collect page content (everything except the orphan nav root)
    const children = [...document.body.children].filter(
      (el) =>
        el !== orphanRoot &&
        el.id !== "crmTopbar" &&
        el.id !== "mobileAppHeader" &&
        !(el.tagName === "SCRIPT")
    );

    const container = document.createElement("div");
    container.className = "dashboard-container";
    const sideWrap = document.createElement("div");
    sideWrap.innerHTML = SIDEBAR_HTML.trim();
    while (sideWrap.firstChild) container.appendChild(sideWrap.firstChild);

    const main = document.createElement("main");
    main.className = "dashboard-main";
    children.forEach((el) => main.appendChild(el));
    container.appendChild(main);

    orphanRoot.remove();
    document.body.appendChild(container);
  }

  function ensureMobileHeader() {
    if (document.getElementById("mobileAppHeader")) return;
    const h = document.createElement("header");
    h.className = "mobile-app-header";
    h.id = "mobileAppHeader";
    const title =
      document.title.split("|")[0].split("—")[0].split("-")[0].trim() || "ObraMate";
    h.innerHTML = `
      <button type="button" class="mobile-app-header__menu" id="mobileMenuToggle" aria-label="Abrir menu" aria-expanded="false" aria-controls="dashboardSidebar">
        <span class="mobile-app-header__menu-icon" aria-hidden="true"></span>
      </button>
      <div class="mobile-app-header__brand">
        <img src="/assets/obramate-logo.png" alt="ObraMate" class="mobile-app-header__logo crm-system-logo" width="28" height="28" onerror="this.style.display='none'" />
        <h1 class="mobile-app-header__title">${title.replace(/</g, "")}</h1>
      </div>`;
    const topbar = document.getElementById("crmTopbar");
    if (topbar) topbar.after(h);
    else document.body.insertBefore(h, document.body.firstChild);
  }

  function initCollapse() {
    const sidebar = getSidebar();
    wrapNavLabels(sidebar);

    let saved = false;
    try {
      saved = localStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {}
    if (window.matchMedia("(min-width: 1025px)").matches) setCollapsed(saved);
    else setCollapsed(false);

    const btn = document.getElementById("sidebarCollapseBtn");
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        if (!window.matchMedia("(min-width: 1025px)").matches) return;
        setCollapsed(!isCollapsed());
      });
    }

    window.matchMedia("(min-width: 1025px)").addEventListener("change", (e) => {
      if (!e.matches) setCollapsed(false);
      else {
        try {
          setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
        } catch (_) {
          setCollapsed(false);
        }
      }
    });
  }

  function openSearch() {
    if (typeof window.openCrmCommandPalette === "function") {
      window.openCrmCommandPalette();
      return;
    }
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  }

  function initTopbar() {
    const searchBtn = document.getElementById("crmTopbarSearchBtn");
    const kbd = searchBtn && searchBtn.querySelector("kbd");
    if (kbd) {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
      kbd.textContent = isMac ? "⌘K" : "Ctrl+K";
    }
    if (searchBtn && !searchBtn.dataset.bound) {
      searchBtn.dataset.bound = "1";
      searchBtn.addEventListener("click", openSearch);
    }
  }

  function placeNotificationBell() {
    const wrap = document.getElementById("notificationBellWrap");
    if (!wrap) return;
    const topRight = document.querySelector("#crmTopbar .crm-topbar__right");
    const helpBtn = document.getElementById("crmTopbarHelpBtn");
    const mobileHeader = document.getElementById("mobileAppHeader");
    const desktop = window.matchMedia("(min-width: 1025px)").matches;

    if (desktop && topRight) {
      if (helpBtn && wrap.nextElementSibling !== helpBtn) topRight.insertBefore(wrap, helpBtn);
      else if (!helpBtn && wrap.parentElement !== topRight) topRight.appendChild(wrap);
      wrap.classList.remove("notification-bell-wrap--mobile");
    } else if (mobileHeader && wrap.parentElement !== mobileHeader) {
      mobileHeader.appendChild(wrap);
      wrap.classList.add("notification-bell-wrap--mobile");
    }
  }

  function bindMobileSidebarToggle() {
    const toggle = document.getElementById("mobileMenuToggle");
    const sidebar = getSidebar();
    const overlay = document.getElementById("mobileOverlay");
    if (!toggle || !sidebar || toggle.dataset.shellBound) return;
    toggle.dataset.shellBound = "1";
    const close = () => {
      sidebar.classList.remove("mobile-open");
      if (overlay) overlay.classList.remove("active");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("mobile-nav-open");
    };
    const open = () => {
      sidebar.classList.add("mobile-open");
      if (overlay) overlay.classList.add("active");
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("mobile-nav-open");
    };
    toggle.addEventListener("click", () => {
      if (sidebar.classList.contains("mobile-open")) close();
      else open();
    });
    if (overlay && !overlay.dataset.shellBound) {
      overlay.dataset.shellBound = "1";
      overlay.addEventListener("click", close);
    }
  }

  async function loadCompanionAssets() {
    ensureStylesheet(`crm-shell.css?v=${SHELL_VER}`);
    ensureStylesheet(`crm-shared-nav.css?v=${SHELL_VER}`);
    ensureStylesheet(`crm-command-palette.css?v=${SHELL_VER}`);
    ensureStylesheet(`crm-help-panel.css?v=${SHELL_VER}`);
    ensureStylesheet(`crm-toast.css`);

    const jobs = [];
    if (!window.CrmI18n) jobs.push(ensureScript(`crm-i18n.js?v=${SHELL_VER}`).catch(() => {}));
    if (!window.__crmSharedNav && !document.querySelector('script[src*="crm-shared-nav.js"]')) {
      jobs.push(ensureScript(`crm-shared-nav.js?v=${SHELL_VER}`).catch(() => {}));
    }
    if (!window.__crmPwaInstall && !document.querySelector('script[src*="crm-pwa-install.js"]')) {
      ensureStylesheet(`crm-pwa-install.css?v=${SHELL_VER}`);
      jobs.push(ensureScript(`crm-pwa-install.js?v=${SHELL_VER}`).catch(() => {}));
    } else {
      ensureStylesheet(`crm-pwa-install.css?v=${SHELL_VER}`);
    }
    if (!window.__crmAccountMenu) {
      jobs.push(ensureScript(`crm-account-menu.js?v=${SHELL_VER}`).catch(() => {}));
    }
    if (!window.openCrmCommandPalette) {
      jobs.push(ensureScript(`crm-command-palette.js?v=${SHELL_VER}`).catch(() => {}));
    }
    if (!document.querySelector('script[src*="crm-help-panel.js"]')) {
      jobs.push(ensureScript(`crm-help-panel.js?v=${SHELL_VER}`).catch(() => {}));
    }
    if (!document.querySelector('script[src*="saas-branding.js"]')) {
      jobs.push(ensureScript("saas-branding.js").catch(() => {}));
    }
    if (!window.sfBootCrmAddressAutocomplete && !document.querySelector('script[src*="crm-address-autocomplete.js"]')) {
      jobs.push(
        ensureScript(`crm-address-autocomplete.js?v=${SHELL_VER}`)
          .then(() => {
            if (typeof window.sfBootCrmAddressAutocomplete === "function") {
              window.sfBootCrmAddressAutocomplete();
            }
          })
          .catch(() => {}),
      );
    } else if (typeof window.sfBootCrmAddressAutocomplete === "function") {
      try {
        window.sfBootCrmAddressAutocomplete();
      } catch (_) {}
    } else if (typeof window.sfScanCrmAddressAutocomplete === "function") {
      try {
        window.sfScanCrmAddressAutocomplete();
      } catch (_) {}
    }
    await Promise.all(jobs);
    if (window.__crmAccountMenu && typeof window.__crmAccountMenu.init === "function") {
      window.__crmAccountMenu.init();
    }
    if (typeof window.sfScanCrmAddressAutocomplete === "function") {
      try {
        window.sfScanCrmAddressAutocomplete();
      } catch (_) {}
    }
  }

  async function boot() {
    if (isAuthPage()) return;
    if (document.body.dataset.crmShellBoot === "1") return;
    document.body.dataset.crmShellBoot = "1";
    document.body.classList.add("dashboard-app-body");

    promoteStandaloneToShell();
    ensureTopbar();
    ensureMobileHeader();
    ensureSidebarStructure(getSidebar());

    initCollapse();
    initTopbar();
    placeNotificationBell();
    bindMobileSidebarToggle();

    window.matchMedia("(min-width: 1025px)").addEventListener("change", () => {
      placeNotificationBell();
    });

    await loadCompanionAssets();
    const host = document.getElementById("crmSharedNavRoot");
    const needsNav = host && (!host.dataset.mounted || host.dataset.mounted !== "1" || !host.children.length);
    if (needsNav && window.__crmSharedNav && typeof window.__crmSharedNav.remount === "function") {
      await window.__crmSharedNav.remount();
    }
    // Re-wrap labels after shared nav mounts
    setTimeout(() => wrapNavLabels(getSidebar()), 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      boot().catch(() => {});
    });
  } else {
    boot().catch(() => {});
  }

  window.__crmShell = { setCollapsed, isCollapsed, openSearch, boot };
})();
