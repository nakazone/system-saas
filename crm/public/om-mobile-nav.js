/**
 * Mobile bottom nav — Início / Leads / + / Agenda / Mais
 * Injected by crm-shell on om-app pages (≤900px via CSS).
 */
(function () {
  const VER = "20260925-apptop1";
  const MQ = window.matchMedia("(max-width: 900px)");

  const ICONS = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
    pipeline:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20V10"/><path d="M12 20V4"/><path d="M18 20v-7"/></svg>',
    agenda:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    lead: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
    quote:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    invoice:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5V4a2 2 0 00-2-2z"/><path d="M8 7h6M8 11h6"/></svg>',
    jobs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2"/><path d="M9 12h6M9 16h4"/></svg>',
    agendaAdd:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg>',
  };

  function fileName() {
    return (location.pathname || "").split("/").pop() || "";
  }

  function activeTab() {
    const f = fileName();
    if (f === "home.html" || f === "" || f === "dashboard.html") return "home";
    if (f === "pipeline-lab.html" || f === "leads.html" || f === "lead-detail.html") return "pipeline";
    if (f === "schedule.html") return "agenda";
    if (f === "mais.html") return "more";
    return "";
  }

  function ensureCss() {
    if (![...document.querySelectorAll('link[href*="om-mobile-nav.css"]')].length) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `om-mobile-nav.css?v=${VER}`;
      document.head.appendChild(link);
    }
    if (![...document.querySelectorAll('link[href*="agenda-mais.css"]')].length) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `agenda-mais.css?v=${VER}`;
      document.head.appendChild(link);
    }
  }

  function closeSheets() {
    const create = document.getElementById("omCreateSheet");
    const backdrop = document.getElementById("omSheetBackdrop");
    if (create) create.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("om-sheet-open");
  }

  function openSheet(id) {
    closeSheets();
    const sheet = document.getElementById(id);
    const backdrop = document.getElementById("omSheetBackdrop");
    if (!sheet || !backdrop) return;
    sheet.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("om-sheet-open");
  }

  function ensureSheets() {
    if (document.getElementById("omSheetBackdrop")) return;

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.id = "omSheetBackdrop";
    backdrop.className = "om-sheet-backdrop";
    backdrop.setAttribute("aria-label", "Fechar");
    backdrop.hidden = true;
    backdrop.addEventListener("click", closeSheets);

    const create = document.createElement("div");
    create.id = "omCreateSheet";
    create.className = "om-sheet om-sheet--mods";
    create.setAttribute("role", "dialog");
    create.setAttribute("aria-modal", "true");
    create.setAttribute("aria-labelledby", "omCreateSheetTitle");
    create.hidden = true;
    create.innerHTML = `
      <div class="om-sheet__grab" aria-hidden="true"></div>
      <h2 class="om-sheet__title" id="omCreateSheetTitle">Criar</h2>
      <div class="om-mod-grid">
        <button type="button" class="om-mod-card" id="omCreateNewLead">
          <span class="om-mod-card__icon" aria-hidden="true">${ICONS.lead}</span>
          <span>
            <p class="om-mod-card__title">Novo lead</p>
            <p class="om-mod-card__sub">Adicionar ao pipeline</p>
          </span>
        </button>
        <a class="om-mod-card" href="schedule.html">
          <span class="om-mod-card__icon" aria-hidden="true">${ICONS.agendaAdd}</span>
          <span>
            <p class="om-mod-card__title">Agendar</p>
            <p class="om-mod-card__sub">Visita ou instalação</p>
          </span>
        </a>
        <a class="om-mod-card" href="quote-builder.html">
          <span class="om-mod-card__icon" aria-hidden="true">${ICONS.quote}</span>
          <span>
            <p class="om-mod-card__title">Quote</p>
            <p class="om-mod-card__sub">Novo orçamento</p>
          </span>
        </a>
        <a class="om-mod-card" href="invoices.html">
          <span class="om-mod-card__icon" aria-hidden="true">${ICONS.invoice}</span>
          <span>
            <p class="om-mod-card__title">Invoice</p>
            <p class="om-mod-card__sub">Nova cobrança</p>
          </span>
        </a>
      </div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(create);

    create.querySelector("#omCreateNewLead")?.addEventListener("click", () => {
      closeSheets();
      if (window.__omNovoLeadSheet && window.__omNovoLeadSheet.openNewLead()) return;
      try {
        sessionStorage.setItem("obramate_open_new_lead", "1");
      } catch (_) {}
      location.href = "pipeline-lab.html";
    });
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function ensureAppTop() {
    if (document.getElementById("omAppTop")) return;
    const top = document.createElement("header");
    top.id = "omAppTop";
    top.className = "om-app-top";
    top.setAttribute("aria-label", "Barra superior");
    top.innerHTML = `
      <a class="om-app-top__brand" href="home.html" aria-label="ObraMate">
        <img class="om-app-top__logo" src="/assets/favicon-192.png?v=20260924-pwa" alt="ObraMate" width="36" height="36" onerror="this.style.display='none'" />
      </a>
      <div class="om-app-top__actions">
        <button type="button" class="om-app-top__bell home-bell" id="homeBell" aria-label="Atenção">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
          <span class="om-app-top__bell-dot home-bell__dot" aria-hidden="true"></span>
        </button>
        <a class="om-app-top__avatar home-avatar" id="homeAvatar" href="ajustes.html" aria-label="Conta">—</a>
      </div>`;
    document.body.insertBefore(top, document.body.firstChild);
    document.body.classList.add("om-has-apptop");

    // On Home, home.js owns the bell. Elsewhere: go to Início attention.
    if (fileName() !== "home.html") {
      top.querySelector("#homeBell")?.addEventListener("click", () => {
        location.href = "home.html";
      });
      fetch("/api/auth/session", { credentials: "include" })
        .then((r) => r.json())
        .then((s) => {
          if (!s?.authenticated || !s.user) return;
          const av = document.getElementById("homeAvatar");
          if (av) {
            av.textContent = initials(s.user.name || s.user.email || "");
            av.title = s.user.name || s.user.email || "Conta";
          }
        })
        .catch(() => {});
    }
  }

  function ensureTabbar() {
    if (document.getElementById("omTabbar")) return;
    const nav = document.createElement("nav");
    nav.id = "omTabbar";
    nav.className = "om-tabbar";
    nav.setAttribute("aria-label", "Navegação principal");

    const tab = activeTab();
    nav.innerHTML = `
      <a class="om-tabbar__item${tab === "home" ? " is-active" : ""}" href="home.html" data-om-tab="home"${
        tab === "home" ? ' aria-current="page"' : ""
      }>
        ${ICONS.home}
        <span>Início</span>
      </a>
      <a class="om-tabbar__item${tab === "pipeline" ? " is-active" : ""}" href="pipeline-lab.html" data-om-tab="pipeline"${
        tab === "pipeline" ? ' aria-current="page"' : ""
      }>
        ${ICONS.pipeline}
        <span>Leads</span>
      </a>
      <div class="om-tabbar__fab-slot">
        <button type="button" class="om-tabbar__fab" id="omTabbarFab" aria-label="Criar" aria-haspopup="dialog">
          ${ICONS.plus}
        </button>
      </div>
      <a class="om-tabbar__item${tab === "agenda" ? " is-active" : ""}" href="schedule.html" data-om-tab="agenda"${
        tab === "agenda" ? ' aria-current="page"' : ""
      }>
        ${ICONS.agenda}
        <span>Agenda</span>
      </a>
      <a class="om-tabbar__item${tab === "more" ? " is-active" : ""}" href="mais.html" data-om-tab="more"${
        tab === "more" ? ' aria-current="page"' : ""
      }>
        ${ICONS.more}
        <span>Mais</span>
      </a>`;

    document.body.appendChild(nav);
    document.body.classList.add("om-has-tabbar");

    document.getElementById("omTabbarFab")?.addEventListener("click", () => openSheet("omCreateSheet"));
  }

  function boot() {
    if (document.body.dataset.omTabbarBoot === "1") return;
    if (/^(login|builder-login|change-password)\.html$/i.test(fileName())) return;
    if (!document.body.classList.contains("om-app") && !document.body.classList.contains("dashboard-app-body")) {
      return;
    }
    const mobile =
      window.__omDevice && typeof window.__omDevice.isMobile === "function"
        ? window.__omDevice.isMobile()
        : /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|iPad/i.test(
            navigator.userAgent || "",
          ) ||
          (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
    if (!mobile) return;
    document.body.dataset.omTabbarBoot = "1";
    ensureCss();
    ensureAppTop();
    ensureSheets();
    ensureTabbar();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSheets();
    });

    MQ.addEventListener("change", () => {
      if (!MQ.matches) closeSheets();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.__omMobileNav = {
    boot,
    openCreate: () => openSheet("omCreateSheet"),
    openMore: () => {
      location.href = "mais.html";
    },
    close: closeSheets,
  };
})();
