/**
 * CRM shell — chrome estático (top bar + sidebar) em todas as telas.
 * - Injeta top bar ObraMate se faltar
 * - Garante sidebar com nav partilhada + collapse
 * - Normaliza IDs e carrega CSS/JS auxiliares (account, help, palette)
 */
(function () {
  const STORAGE_KEY = "crm_sidebar_collapsed";
  const NAV_HISTORY_KEY = "crm_nav_history_v1";
  const NAV_HISTORY_MAX = 50;
  const SHELL_VER = "20261002-gmaps1";

  const CREATE_MENU_ITEMS = [
    {
      href: "leads.html?new=1",
      label: "Lead",
      shortcut: "N",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
    },
    {
      href: "quote-builder.html",
      label: "Orçamento",
      shortcut: "O",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    },
    {
      href: "schedule.html?new=visit",
      label: "Visita",
      shortcut: "",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    },
    {
      href: "jobs.html?new=1",
      label: "Job",
      shortcut: "",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>',
    },
    {
      href: "invoices.html?new=1",
      label: "Fatura",
      shortcut: "",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M8 10h8M8 14h5"/></svg>',
    },
    {
      href: "dashboard.html?page=customers&new=1",
      label: "Cliente",
      shortcut: "",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    },
  ];

  const DOCK_HTML = `
<div class="om-dock" id="omDock" role="toolbar" aria-label="Ações rápidas">
  <a class="om-dock__primary" href="leads.html" id="omDockNew">+ Novo lead</a>
  <a class="om-dock__btn" href="schedule.html" title="Agenda">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    <span>Agendar</span>
  </a>
  <a class="om-dock__btn" href="pipeline-lab.html" title="Pipeline">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 12h6M9 16h4"/></svg>
    <span>Pipeline</span>
  </a>
  <a class="om-dock__btn" href="quote-builder.html" title="Novo orçamento">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
    <span>Orçamento</span>
  </a>
  <button type="button" class="om-dock__btn" id="omDockSearch" title="Pesquisar">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
    <span>Buscar</span>
  </button>
</div>`;

  function ensureFont() {
    if ([...document.querySelectorAll('link[href*="Plus+Jakarta"]')].length) return;
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "anonymous";
    const font = document.createElement("link");
    font.rel = "stylesheet";
    font.href =
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(pre1);
    document.head.appendChild(pre2);
    document.head.appendChild(font);
  }

  /**
   * Clear app caches + service workers and reload so deploys show up
   * without closing/reopening the PWA.
   */
  async function hardRefreshApp(triggerEl) {
    if (hardRefreshApp._busy) return;
    hardRefreshApp._busy = true;
    const targets = [];
    if (triggerEl) targets.push(triggerEl);
    document.querySelectorAll("[data-crm-hard-refresh]").forEach((el) => {
      if (!targets.includes(el)) targets.push(el);
    });
    targets.forEach((el) => {
      el.disabled = true;
      el.classList.add("is-refreshing");
      if (el.dataset.refreshLabel !== "1") {
        const label = el.querySelector("[data-crm-refresh-label]");
        if (label) {
          el.dataset.refreshPrev = label.textContent || "";
          label.textContent = "Atualizando…";
        }
      }
    });
    try {
      if (window.crmToast?.info) window.crmToast.info("Atualizando o app…");
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs.map(async (reg) => {
            try {
              await reg.update();
            } catch (_) {}
            try {
              await reg.unregister();
            } catch (_) {}
          }),
        );
      }
    } catch (_) {
      /* still reload — best effort */
    }
    try {
      const url = new URL(location.href);
      url.searchParams.set("_omr", String(Date.now()));
      location.replace(url.toString());
    } catch (_) {
      location.reload();
    }
  }

  /** Keep Ajuda / account chip in the fixed top bar (never move into sidebar). */
  function ensureTopbarUtilities() {
    const topRight = document.querySelector("#crmTopbar .crm-topbar__right");
    if (!topRight) return;

    const stray = document.getElementById("omSidebarUtilities");
    if (stray) stray.remove();

    function restoreTopbarBtn(el) {
      if (!el) return;
      if (el.classList.contains("crm-topbar__user-chip")) return;
      el.classList.add("crm-topbar__icon-btn");
      el.classList.remove("nav-item", "om-sidebar-util-btn");
      const label = el.querySelector(".nav-item__label");
      if (label) label.remove();
    }

    const topLeft = document.querySelector("#crmTopbar .crm-topbar__left");
    let refreshBtn = document.getElementById("crmTopbarRefreshBtn");
    if (!refreshBtn) {
      refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.id = "crmTopbarRefreshBtn";
      refreshBtn.className = "crm-topbar__refresh-btn";
      refreshBtn.setAttribute("data-crm-hard-refresh", "1");
      refreshBtn.title = "Atualizar o app (limpa cache e recarrega)";
      refreshBtn.setAttribute("aria-label", "Atualizar o app");
      refreshBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 11-2.6-6.2"/><path d="M21 3v6h-6"/></svg>' +
        '<span data-crm-refresh-label>Atualizar</span>';
    }
    // Keep Atualizar next to Voltar (left side), not in the right utilities.
    if (topLeft) {
      const back = document.getElementById("crmBackBtn");
      if (back && back.parentElement === topLeft) {
        if (refreshBtn.previousElementSibling !== back) {
          back.insertAdjacentElement("afterend", refreshBtn);
        }
      } else if (refreshBtn.parentElement !== topLeft) {
        topLeft.insertBefore(refreshBtn, topLeft.firstChild);
      }
    } else if (refreshBtn.parentElement !== topRight) {
      topRight.insertBefore(refreshBtn, topRight.firstChild);
    }
    if (!refreshBtn.dataset.refreshBound) {
      refreshBtn.dataset.refreshBound = "1";
      refreshBtn.addEventListener("click", (e) => {
        e.preventDefault();
        hardRefreshApp(refreshBtn);
      });
    }

    let help = document.getElementById("crmTopbarHelpBtn");
    if (!help) {
      help = document.createElement("button");
      help.type = "button";
      help.id = "crmTopbarHelpBtn";
      help.className = "crm-topbar__icon-btn";
      help.title = "Ajuda / Suporte";
      help.setAttribute("aria-label", "Ajuda e suporte");
      help.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
    }
    restoreTopbarBtn(help);
    if (help.parentElement !== topRight) topRight.appendChild(help);

    const wrap = document.getElementById("crmAccountMenuWrap");
    if (wrap) {
      const trigger =
        wrap.querySelector("[data-account-menu-trigger]") ||
        wrap.querySelector("#crmTopbarSettingsBtn");
      // Preserve user-chip trigger; only normalize legacy gear buttons
      if (trigger && !trigger.classList.contains("crm-topbar__user-chip")) {
        restoreTopbarBtn(trigger);
      }
      if (wrap.parentElement !== topRight) topRight.appendChild(wrap);
    } else {
      let settings = document.getElementById("crmTopbarSettingsBtn");
      if (!settings) {
        settings = document.createElement("a");
        settings.href = "configuracoes.html";
        settings.id = "crmTopbarSettingsBtn";
        settings.className = "crm-topbar__icon-btn";
        settings.title = "Menu da conta";
        settings.setAttribute("aria-label", "Menu da conta");
        settings.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
      }
      restoreTopbarBtn(settings);
      if (settings.parentElement !== topRight) topRight.appendChild(settings);
    }
  }

  function refreshOmUtilityBindings() {
    ensureTopbarUtilities();
    if (window.__crmAccountMenu && typeof window.__crmAccountMenu.init === "function") {
      window.__crmAccountMenu.init();
    }
    if (window.__crmHelpPanel && typeof window.__crmHelpPanel.refresh === "function") {
      window.__crmHelpPanel.refresh();
    }
    ensureTopbarUtilities();
  }

  function ensureDock() {
    if (document.getElementById("omDock")) return;
    // Home pipeline page has its own dock
    if (document.body.classList.contains("plab") && document.querySelector(".plab-dock")) return;
    // Quote builder has its own action bar — never stack a second bottom chrome
    const file = (location.pathname || "").split("/").pop() || "";
    if (
      document.body.classList.contains("qb-sidebar-page") ||
      document.getElementById("qbActionBar") ||
      /^quote-builder\.html$/i.test(file)
    ) {
      document.body.classList.add("om-no-dock");
      return;
    }
    // Phone tab bar replaces the floating dock; tablets keep the desktop dock.
    const mobile =
      window.__omDevice && typeof window.__omDevice.isMobile === "function"
        ? window.__omDevice.isMobile()
        : /iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent || "") ||
          (/Android/i.test(navigator.userAgent || "") && /Mobile/i.test(navigator.userAgent || ""));
    if (mobile) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = DOCK_HTML.trim();
    document.body.appendChild(wrap.firstElementChild);
    document.body.classList.add("om-has-dock");
    const search = document.getElementById("omDockSearch");
    if (search && !search.dataset.bound) {
      search.dataset.bound = "1";
      search.addEventListener("click", openSearch);
    }
  }

  const TOPBAR_HTML = `
<header class="crm-topbar" id="crmTopbar" aria-label="Barra superior">
  <div class="crm-topbar__left">
    <button type="button" class="crm-topbar__back-btn" id="crmBackBtn" aria-label="Voltar à tela anterior" title="Voltar" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      <span>Voltar</span>
    </button>
    <button type="button" class="crm-topbar__refresh-btn" id="crmTopbarRefreshBtn" data-crm-hard-refresh title="Atualizar o app (limpa cache e recarrega)" aria-label="Atualizar o app">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 11-2.6-6.2"/><path d="M21 3v6h-6"/></svg>
      <span data-crm-refresh-label>Atualizar</span>
    </button>
    <a href="pipeline-lab.html" class="crm-topbar__brand" id="crmTopbarBrand" aria-label="ObraMate — início">
      <img src="/assets/obramate-logo.png" alt="ObraMate" class="crm-system-logo" width="160" height="36" onerror="this.style.display='none'" />
    </a>
  </div>
  <div class="crm-topbar__right">
    <button type="button" class="crm-topbar__search" id="crmTopbarSearchBtn" aria-label="Pesquisar no sistema" title="Pesquisar (⌘K)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <span class="crm-topbar__search-text">Buscar leads, clientes, orçamentos, jobs…</span>
      <kbd>⌘K</kbd>
    </button>
    <div class="crm-create-wrap" id="crmCreateWrap">
      <button type="button" class="crm-topbar__create-btn" id="crmTopbarCreateBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="crmCreateMenu">
        <span aria-hidden="true">+</span> Criar
      </button>
      <div class="crm-create-menu" id="crmCreateMenu" hidden role="menu" aria-label="Criar novo">
        <p class="crm-create-menu__title">Criar novo</p>
      </div>
    </div>
    <button type="button" class="crm-topbar__install-btn" data-crm-pwa-install title="Instalar ObraMate neste dispositivo" aria-label="Instalar aplicativo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>
      <span>Instalar app</span>
    </button>
    <button type="button" class="crm-topbar__icon-btn" id="crmTopbarHelpBtn" title="Ajuda / Suporte" aria-label="Ajuda e suporte">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
    </button>
    <a href="configuracoes.html" class="crm-topbar__icon-btn" id="crmTopbarSettingsBtn" title="Menu da conta" aria-label="Menu da conta">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    </a>
  </div>
</header>`;

  const SIDEBAR_HTML = `
<aside class="dashboard-sidebar" id="dashboardSidebar">
  <div class="sidebar-header">
    <img src="/assets/favicon-192.png?v=20260924-pwa" alt="ObraMate" class="sidebar-brand-logo crm-system-logo" width="32" height="32" onerror="this.style.display='none'" />
    <div class="sidebar-workspace">
      <span class="sidebar-brand-name" id="sidebarWorkspaceName">ObraMate</span>
      <span class="sidebar-workspace__meta" id="sidebarWorkspaceMeta">Workspace</span>
    </div>
  </div>
  <nav class="sidebar-nav" aria-label="Principal">
    <div id="crmSharedNavRoot" data-layout="sidebar"></div>
  </nav>
  <div class="sidebar-footer">
    <a href="configuracoes.html" class="nav-item sidebar-footer-link" id="sidebarSettingsLink" aria-label="Configurações">
      <svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      <span class="nav-item__label">Configurações</span>
    </a>
    <button type="button" class="nav-item sidebar-footer-link sidebar-collapse-btn" id="sidebarCollapseBtn" aria-pressed="false" aria-label="Recolher menu lateral" title="Recolher menu">
      <svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg>
      <span class="nav-item__label">Recolher menu</span>
    </button>
  </div>
</aside>
<div class="mobile-overlay" id="mobileOverlay"></div>`;

  function isAuthPage() {
    const f = (location.pathname || "").split("/").pop() || "";
    return /^(login|builder-login|change-password)\.html$/i.test(f) || f === "login";
  }

  function currentNavHref() {
    return location.pathname + location.search + location.hash;
  }

  function isAuthHref(href) {
    try {
      const file = (String(href || "").split("?")[0].split("/").pop() || "").toLowerCase();
      return /^(login|builder-login|change-password)\.html$/.test(file);
    } catch (_) {
      return false;
    }
  }

  function readNavHistory() {
    try {
      const raw = sessionStorage.getItem(NAV_HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((h) => typeof h === "string" && h) : [];
    } catch (_) {
      return [];
    }
  }

  function writeNavHistory(arr) {
    try {
      sessionStorage.setItem(NAV_HISTORY_KEY, JSON.stringify((arr || []).slice(-NAV_HISTORY_MAX)));
    } catch (_) {}
  }

  function clearNavHistory() {
    try {
      sessionStorage.removeItem(NAV_HISTORY_KEY);
    } catch (_) {}
  }

  function trackPageVisit() {
    if (isAuthPage()) return;
    const href = currentNavHref();
    const stack = readNavHistory();
    if (stack[stack.length - 1] !== href) {
      stack.push(href);
      writeNavHistory(stack);
    }
  }

  function getPreviousHref() {
    const stack = readNavHistory();
    const cur = currentNavHref();
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i] !== cur && !isAuthHref(stack[i])) return stack[i];
    }
    return null;
  }

  function goBack() {
    const stack = readNavHistory();
    const cur = currentNavHref();
    while (stack.length && stack[stack.length - 1] === cur) stack.pop();
    let prev = null;
    while (stack.length) {
      const candidate = stack.pop();
      if (candidate && candidate !== cur && !isAuthHref(candidate)) {
        prev = candidate;
        break;
      }
    }
    writeNavHistory(stack);
    if (prev) {
      location.href = prev;
      return;
    }
    const fallback =
      (window.__omDevice && typeof window.__omDevice.entryHref === "function" && window.__omDevice.entryHref()) ||
      (document.body.classList.contains("func-app") || document.body.classList.contains("om-field-desktop")
        ? "funcionario.html"
        : "pipeline-lab.html");
    location.href = fallback;
  }

  function updateBackButtons() {
    const prev = getPreviousHref();
    ["crmBackBtn", "crmMobileBackBtn"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const enabled = !!prev;
      btn.disabled = !enabled;
      btn.setAttribute("aria-disabled", enabled ? "false" : "true");
      btn.classList.toggle("is-disabled", !enabled);
      btn.title = enabled ? "Voltar à tela anterior" : "Nenhuma tela anterior";
    });
  }

  function bindBackButton(btn) {
    if (!btn || btn.dataset.crmBackBound === "1") return;
    btn.dataset.crmBackBound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      goBack();
    });
  }

  function ensureDesktopBackButton() {
    const topbar = document.getElementById("crmTopbar");
    if (!topbar) return;

    let left = topbar.querySelector(".crm-topbar__left");
    const brand = document.getElementById("crmTopbarBrand");
    if (!left) {
      left = document.createElement("div");
      left.className = "crm-topbar__left";
      if (brand) {
        brand.replaceWith(left);
        left.appendChild(brand);
      } else {
        topbar.insertBefore(left, topbar.firstChild);
      }
    }

    let btn = document.getElementById("crmBackBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "crmBackBtn";
      btn.className = "crm-topbar__back-btn";
      btn.setAttribute("aria-label", "Voltar à tela anterior");
      btn.title = "Voltar";
      btn.disabled = true;
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>Voltar</span>';
      left.insertBefore(btn, left.firstChild);
    }
    bindBackButton(btn);
  }

  function ensureMobileBackButton() {
    const mobile = document.getElementById("mobileAppHeader");
    if (!mobile) return;
    let btn = document.getElementById("crmMobileBackBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "crmMobileBackBtn";
      btn.className = "mobile-app-header__back";
      btn.setAttribute("aria-label", "Voltar à tela anterior");
      btn.title = "Voltar";
      btn.disabled = true;
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>Voltar</span>';
      const menu = document.getElementById("mobileMenuToggle");
      if (menu && menu.parentNode === mobile) menu.after(btn);
      else mobile.insertBefore(btn, mobile.firstChild);
    }
    bindBackButton(btn);
  }

  function ensureBackButtons() {
    if (isAuthPage()) return;
    ensureDesktopBackButton();
    ensureMobileBackButton();
    trackPageVisit();
    updateBackButtons();
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
      el.removeAttribute("title");
      el.setAttribute("aria-label", label);
    });
  }

  function setCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch (_) {}
    const btn = document.getElementById("sidebarCollapseBtn");
    if (!btn) return;
    const desktop = window.matchMedia("(min-width: 1025px)").matches;
    if (!desktop && document.body.classList.contains("om-device-tablet")) {
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Fechar menu");
      btn.title = "Fechar menu";
      const lab = btn.querySelector(".nav-item__label");
      if (lab) lab.textContent = "Fechar menu";
      return;
    }
    btn.setAttribute("aria-pressed", collapsed ? "true" : "false");
    btn.setAttribute("aria-label", collapsed ? "Expandir menu lateral" : "Recolher menu lateral");
    btn.title = collapsed ? "Expandir menu" : "Recolher menu";
    const lab = btn.querySelector(".nav-item__label");
    if (lab) lab.textContent = collapsed ? "Expandir menu" : "Recolher menu";
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
      img.src = "/assets/favicon-192.png?v=20260924-pwa";
      img.alt = "ObraMate";
      img.className = "sidebar-brand-logo crm-system-logo";
      img.width = 32;
      img.height = 32;
      img.onerror = function () {
        this.style.display = "none";
      };
      header.insertBefore(img, header.firstChild);
    } else {
      const existing = header.querySelector(".sidebar-brand-logo");
      existing.src = "/assets/favicon-192.png?v=20260924-pwa";
      existing.alt = "ObraMate";
      existing.classList.add("crm-system-logo");
      existing.width = 32;
      existing.height = 32;
    }
    // Workspace name next to logo (expanded menu)
    let ws = header.querySelector(".sidebar-workspace");
    if (!ws) {
      ws = document.createElement("div");
      ws.className = "sidebar-workspace";
      ws.innerHTML =
        '<span class="sidebar-brand-name" id="sidebarWorkspaceName">ObraMate</span>' +
        '<span class="sidebar-workspace__meta" id="sidebarWorkspaceMeta">Workspace</span>';
      header.appendChild(ws);
    } else {
      if (!ws.querySelector("#sidebarWorkspaceName")) {
        const n = document.createElement("span");
        n.className = "sidebar-brand-name";
        n.id = "sidebarWorkspaceName";
        n.textContent = "ObraMate";
        ws.appendChild(n);
      }
      if (!ws.querySelector("#sidebarWorkspaceMeta")) {
        const m = document.createElement("span");
        m.className = "sidebar-workspace__meta";
        m.id = "sidebarWorkspaceMeta";
        m.textContent = "Workspace";
        ws.appendChild(m);
      }
    }
    // Collapse control lives in the footer now
    const headerCollapse = header.querySelector("#sidebarCollapseBtn");
    if (headerCollapse) headerCollapse.remove();

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

    let footer = sidebar.querySelector(".sidebar-footer");
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "sidebar-footer";
      sidebar.appendChild(footer);
    }
    // Replace legacy user bar with Configurações + Recolher
    if (!footer.querySelector("#sidebarSettingsLink") || !footer.querySelector("#sidebarCollapseBtn")) {
      footer.innerHTML = `
        <a href="configuracoes.html" class="nav-item sidebar-footer-link" id="sidebarSettingsLink" aria-label="Configurações">
          <svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          <span class="nav-item__label">Configurações</span>
        </a>
        <button type="button" class="nav-item sidebar-footer-link sidebar-collapse-btn" id="sidebarCollapseBtn" aria-pressed="false" aria-label="Recolher menu lateral" title="Recolher menu">
          <svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg>
          <span class="nav-item__label">Recolher menu</span>
        </button>`;
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

    let saved = true; // default: icon rail
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "0") saved = false;
      else if (v === "1") saved = true;
    } catch (_) {}

    if (window.matchMedia("(min-width: 1025px)").matches) setCollapsed(saved);
    else setCollapsed(false);

    const btn = document.getElementById("sidebarCollapseBtn");
    if (btn) {
      btn.style.display = "";
      if (!btn.dataset.bound) {
        btn.dataset.bound = "1";
        btn.addEventListener("click", () => {
          const desktop = window.matchMedia("(min-width: 1025px)").matches;
          if (desktop) {
            setCollapsed(!isCollapsed());
            return;
          }
          // Tablet/phone drawer: treat as close menu.
          const sidebar = getSidebar();
          const overlay = document.getElementById("mobileOverlay");
          const toggle = document.getElementById("mobileMenuToggle");
          if (sidebar) sidebar.classList.remove("mobile-open");
          if (overlay) overlay.classList.remove("active");
          if (toggle) toggle.setAttribute("aria-expanded", "false");
          document.body.classList.remove("mobile-nav-open");
        });
      }
    }

    window.matchMedia("(min-width: 1025px)").addEventListener("change", (e) => {
      if (!e.matches) setCollapsed(false);
      else {
        try {
          const v = localStorage.getItem(STORAGE_KEY);
          setCollapsed(v !== "0");
        } catch (_) {
          setCollapsed(true);
        }
      }
    });
  }

  function openSearch() {
    if (window.__crmCommandPalette && typeof window.__crmCommandPalette.open === "function") {
      window.__crmCommandPalette.open();
      return;
    }
    if (typeof window.openCrmCommandPalette === "function") {
      window.openCrmCommandPalette();
      return;
    }
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  }

  function initCreateMenu() {
    const wrap = document.getElementById("crmCreateWrap");
    const btn = document.getElementById("crmTopbarCreateBtn");
    const menu = document.getElementById("crmCreateMenu");
    if (!wrap || !btn || !menu) return;

    if (!menu.dataset.filled) {
      menu.dataset.filled = "1";
      CREATE_MENU_ITEMS.forEach((item) => {
        const a = document.createElement("a");
        a.href = item.href;
        a.className = "crm-create-menu__item";
        a.setAttribute("role", "menuitem");
        a.innerHTML =
          `<span class="crm-create-menu__icon">${item.icon}</span>` +
          `<span class="crm-create-menu__label">${item.label}</span>` +
          (item.shortcut ? `<kbd class="crm-create-menu__kbd">${item.shortcut}</kbd>` : "");
        menu.appendChild(a);
      });
    }

    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";

    const close = () => {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      wrap.classList.remove("is-open");
    };
    const open = () => {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      wrap.classList.add("is-open");
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) open();
      else close();
    });
    menu.addEventListener("click", () => close());
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  function ensureTopbarCreate() {
    const topRight = document.querySelector("#crmTopbar .crm-topbar__right");
    if (!topRight) return;
    if (document.getElementById("crmCreateWrap")) return;

    const search = document.getElementById("crmTopbarSearchBtn");
    const wrap = document.createElement("div");
    wrap.className = "crm-create-wrap";
    wrap.id = "crmCreateWrap";
    wrap.innerHTML = `
      <button type="button" class="crm-topbar__create-btn" id="crmTopbarCreateBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="crmCreateMenu">
        <span aria-hidden="true">+</span> Criar
      </button>
      <div class="crm-create-menu" id="crmCreateMenu" hidden role="menu" aria-label="Criar novo">
        <p class="crm-create-menu__title">Criar novo</p>
      </div>`;
    if (search && search.nextSibling) topRight.insertBefore(wrap, search.nextSibling);
    else if (search) search.after(wrap);
    else topRight.insertBefore(wrap, topRight.firstChild);
  }

  function enhanceExistingTopbar() {
    const searchText = document.querySelector("#crmTopbarSearchBtn .crm-topbar__search-text");
    if (searchText && /Pesquisar/i.test(searchText.textContent || "")) {
      searchText.textContent = "Buscar leads, clientes, orçamentos, jobs…";
    }
    ensureTopbarCreate();
  }

  function initTopbar() {
    enhanceExistingTopbar();
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
    initCreateMenu();
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
    ensureFont();
    if (!window.__omDevice && !document.querySelector('script[src*="om-device.js"]')) {
      await ensureScript(`om-device.js?v=${SHELL_VER}`).catch(() => {});
    }
    if (window.__omDevice && typeof window.__omDevice.applyBodyClass === "function") {
      window.__omDevice.applyBodyClass();
    }
    const brand = document.getElementById("crmTopbarBrand");
    if (brand) {
      if (document.body.classList.contains("om-field-desktop") || document.body.classList.contains("func-app")) {
        brand.setAttribute("href", "funcionario.html");
      } else if (window.__omDevice && typeof window.__omDevice.entryHref === "function") {
        brand.setAttribute("href", window.__omDevice.entryHref());
      }
    }

    ensureStylesheet(`obramate-app.css?v=${SHELL_VER}`);
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
    if (!window.__crmSoftNav && !document.querySelector('script[src*="crm-soft-nav.js"]')) {
      jobs.push(ensureScript(`crm-soft-nav.js?v=${SHELL_VER}`).catch(() => {}));
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
      jobs.push(ensureScript("saas-branding.js?v=20261002-branddoc1").catch(() => {}));
    }
    const wantMobileNav =
      typeof window.__omDevice?.isMobile === "function"
        ? window.__omDevice.isMobile()
        : /iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent || "") ||
          (/Android/i.test(navigator.userAgent || "") && /Mobile/i.test(navigator.userAgent || ""));
    if (wantMobileNav) {
      if (!window.__omMobileNav && !document.querySelector('script[src*="om-mobile-nav.js"]')) {
        ensureStylesheet(`om-mobile-nav.css?v=${SHELL_VER}`);
        ensureStylesheet(`om-native-app.css?v=${SHELL_VER}`);
        jobs.push(ensureScript(`om-mobile-nav.js?v=${SHELL_VER}`).catch(() => {}));
      } else {
        ensureStylesheet(`om-mobile-nav.css?v=${SHELL_VER}`);
        ensureStylesheet(`om-native-app.css?v=${SHELL_VER}`);
      }
      if (!window.__omNovoLeadSheet && !document.querySelector('script[src*="novo-lead-sheet.js"]')) {
        jobs.push(ensureScript(`novo-lead-sheet.js?v=${SHELL_VER}`).catch(() => {}));
      }
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
    if (!window.sfBootCrmRichText && !document.querySelector('script[src*="crm-rich-text.js"]')) {
      ensureStylesheet(`crm-rich-text.css?v=${SHELL_VER}`);
      jobs.push(
        ensureScript(`crm-rich-text.js?v=${SHELL_VER}`)
          .then(() => {
            if (typeof window.sfBootCrmRichText === "function") {
              window.sfBootCrmRichText();
            }
          })
          .catch(() => {}),
      );
    } else if (typeof window.sfBootCrmRichText === "function") {
      try {
        window.sfBootCrmRichText();
      } catch (_) {}
    } else if (typeof window.sfScanCrmRichText === "function") {
      try {
        window.sfScanCrmRichText();
      } catch (_) {}
    }
    await Promise.all(jobs);
    refreshOmUtilityBindings();
    if (typeof window.sfScanCrmAddressAutocomplete === "function") {
      try {
        window.sfScanCrmAddressAutocomplete();
      } catch (_) {}
    }
    if (typeof window.sfScanCrmRichText === "function") {
      try {
        window.sfScanCrmRichText();
      } catch (_) {}
    }
  }

  async function boot() {
    if (isAuthPage()) return;
    // Drop one-shot cache-bust query from hard refresh.
    try {
      const u = new URL(location.href);
      if (u.searchParams.has("_omr")) {
        u.searchParams.delete("_omr");
        history.replaceState(null, "", u.pathname + u.search + u.hash);
      }
    } catch (_) {}
    if (document.body.dataset.crmShellBoot === "1") return;
    document.body.dataset.crmShellBoot = "1";

    if (!window.__crmFieldGate && !document.querySelector('script[src*="crm-field-gate.js"]')) {
      await ensureScript(`crm-field-gate.js?v=${SHELL_VER}`).catch(() => {});
    }
    if (window.__crmFieldGate && typeof window.__crmFieldGate.bounceFieldWorker === "function") {
      const bounced = await window.__crmFieldGate.bounceFieldWorker().catch(() => false);
      if (bounced) return;
    }

    let isField = document.body.classList.contains("func-app");
    if (!isField && window.__crmFieldGate?.isFieldRole) {
      try {
        const r = await fetch("/api/auth/session", { credentials: "same-origin" });
        const j = await r.json();
        if (j?.authenticated && j.user) {
          window.__crmUserRole = j.user.role || "";
          isField = window.__crmFieldGate.isFieldRole(j.user.role);
        }
      } catch (_) {}
    }

    document.body.classList.add("dashboard-app-body", "om-app", "om-chrome-ready");
    // sidebar-collapsed is set by HTML (FOUC) + initCollapse from localStorage

    promoteStandaloneToShell();
    ensureTopbar();
    ensureMobileHeader();
    ensureSidebarStructure(getSidebar());
    ensureTopbarUtilities();
    ensureBackButtons();
    if (!isField) {
      ensureDock();
      if (document.getElementById("omDock")) {
        document.body.classList.add("om-has-dock");
      }
    } else {
      document.body.classList.add("om-field-desktop");
      const brand = document.getElementById("crmTopbarBrand");
      if (brand) brand.setAttribute("href", "funcionario.html");
    }

    initCollapse();
    initTopbar();
    placeNotificationBell();
    bindMobileSidebarToggle();
    ensureBackButtons();

    window.matchMedia("(min-width: 1025px)").addEventListener("change", () => {
      placeNotificationBell();
    });

    // Mount nav once (shared-nav may already be mounting on DOMContentLoaded)
    const mountNav = () => {
      if (!window.__crmSharedNav) return Promise.resolve();
      if (typeof window.__crmSharedNav.init === "function") return window.__crmSharedNav.init();
      if (typeof window.__crmSharedNav.remount === "function") return window.__crmSharedNav.remount();
      return Promise.resolve();
    };

    await Promise.all([loadCompanionAssets(), mountNav()]);
    const host = document.getElementById("crmSharedNavRoot");
    const needsNav = host && (host.dataset.mounted !== "1" || !host.children.length);
    if (needsNav) await mountNav();
    wrapNavLabels(getSidebar());
    refreshOmUtilityBindings();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      boot().catch(() => {});
    });
  } else {
    boot().catch(() => {});
  }

  window.__crmShell = {
    setCollapsed,
    isCollapsed,
    openSearch,
    boot,
    goBack,
    getPreviousHref,
    clearNavHistory,
    updateBackButtons,
    hardRefreshApp,
  };
  window.__crmHardRefresh = hardRefreshApp;
})();
