/**
 * Mobile bottom nav — Início / Pipeline / + / Agenda / Mais
 * Injected by crm-shell on om-app pages (≤900px via CSS).
 */
(function () {
  const VER = "20260925-home1";
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
    payroll:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
    clients:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  };

  function fileName() {
    return (location.pathname || "").split("/").pop() || "";
  }

  function activeTab() {
    const f = fileName();
    if (f === "home.html" || f === "" || f === "dashboard.html") return "home";
    if (f === "pipeline-lab.html" || f === "leads.html") return "pipeline";
    if (f === "schedule.html") return "agenda";
    return "";
  }

  function ensureCss() {
    if ([...document.querySelectorAll('link[href*="om-mobile-nav.css"]')].length) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `om-mobile-nav.css?v=${VER}`;
    document.head.appendChild(link);
  }

  function closeSheets() {
    const create = document.getElementById("omCreateSheet");
    const more = document.getElementById("omMoreSheet");
    const backdrop = document.getElementById("omSheetBackdrop");
    if (create) create.hidden = true;
    if (more) more.hidden = true;
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
    create.className = "om-sheet";
    create.setAttribute("role", "dialog");
    create.setAttribute("aria-modal", "true");
    create.setAttribute("aria-labelledby", "omCreateSheetTitle");
    create.hidden = true;
    create.innerHTML = `
      <div class="om-sheet__grab" aria-hidden="true"></div>
      <h2 class="om-sheet__title" id="omCreateSheetTitle">Criar</h2>
      <div class="om-sheet__grid">
        <a class="om-sheet__link" href="leads.html" data-om-new-lead>
          <span class="om-sheet__icon om-sheet__icon--primary">${ICONS.lead}</span>
          <span>Novo lead</span>
        </a>
        <a class="om-sheet__link" href="schedule.html">
          <span class="om-sheet__icon">${ICONS.agenda}</span>
          <span>Agendar</span>
        </a>
        <a class="om-sheet__link" href="quote-builder.html">
          <span class="om-sheet__icon">${ICONS.quote}</span>
          <span>Quote</span>
        </a>
        <a class="om-sheet__link" href="invoices.html">
          <span class="om-sheet__icon">${ICONS.invoice}</span>
          <span>Invoice</span>
        </a>
      </div>`;

    const more = document.createElement("div");
    more.id = "omMoreSheet";
    more.className = "om-sheet";
    more.setAttribute("role", "dialog");
    more.setAttribute("aria-modal", "true");
    more.setAttribute("aria-labelledby", "omMoreSheetTitle");
    more.hidden = true;
    more.innerHTML = `
      <div class="om-sheet__grab" aria-hidden="true"></div>
      <h2 class="om-sheet__title" id="omMoreSheetTitle">Mais</h2>
      <div class="om-sheet__list">
        <a class="om-sheet__row" href="quotes.html"><span class="om-sheet__icon">${ICONS.quote}</span><span>Quotes</span></a>
        <a class="om-sheet__row" href="invoices.html"><span class="om-sheet__icon">${ICONS.invoice}</span><span>Invoices</span></a>
        <a class="om-sheet__row" href="jobs.html"><span class="om-sheet__icon">${ICONS.jobs}</span><span>Jobs</span></a>
        <a class="om-sheet__row" href="dashboard.html?page=customers"><span class="om-sheet__icon">${ICONS.clients}</span><span>Clientes</span></a>
        <a class="om-sheet__row" href="payroll-module.html"><span class="om-sheet__icon">${ICONS.payroll}</span><span>Folha de pagamento</span></a>
        <a class="om-sheet__row" href="ajustes.html"><span class="om-sheet__icon">${ICONS.settings}</span><span>Ajustes</span></a>
      </div>`;

    create.querySelector("[data-om-new-lead]")?.addEventListener("click", () => {
      try {
        sessionStorage.setItem("obramate_open_new_lead", "1");
      } catch (_) {}
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(create);
    document.body.appendChild(more);
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
      <button type="button" class="om-tabbar__item" id="omTabbarMore" data-om-tab="more" aria-label="Mais" aria-haspopup="dialog">
        ${ICONS.more}
        <span>Mais</span>
      </button>`;

    document.body.appendChild(nav);
    document.body.classList.add("om-has-tabbar");

    document.getElementById("omTabbarFab")?.addEventListener("click", () => openSheet("omCreateSheet"));
    document.getElementById("omTabbarMore")?.addEventListener("click", () => openSheet("omMoreSheet"));
  }

  function boot() {
    if (document.body.dataset.omTabbarBoot === "1") return;
    if (/^(login|builder-login|change-password)\.html$/i.test(fileName())) return;
    if (!document.body.classList.contains("om-app") && !document.body.classList.contains("dashboard-app-body")) {
      return;
    }
    // Desktop CRM keeps the classic shell — no mobile tab bar
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

  window.__omMobileNav = { boot, openCreate: () => openSheet("omCreateSheet"), openMore: () => openSheet("omMoreSheet"), close: closeSheets };
})();
