/**
 * Mobile bottom nav — Início / Leads / + / Agenda / Mais
 * Field staff: Hoje / Agenda / Jobs / Chat / Horas (Campo shell links)
 */
(function () {
  const VER = "20261005-sched1";
  const MQ = window.matchMedia("(max-width: 900px)");
  const FIELD_ROLES = new Set(["installer", "crew_lead", "subcontractor"]);
  const SHEET_MS = 380;
  const TAB_HREFS = ["home.html", "pipeline-lab.html", "schedule.html", "mais.html"];
  let edgeSwipeBound = false;

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
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    horas:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    agendaAdd:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg>',
  };

  function fileName() {
    return (location.pathname || "").split("/").pop() || "";
  }

  function isFieldRole(role) {
    return FIELD_ROLES.has(String(role || "").toLowerCase());
  }

  function activeTab(field) {
    const f = fileName();
    if (field) {
      if (f === "hoje.html") return "hoje";
      if (f === "agenda.html" || f === "schedule.html") return "agenda";
      if (f === "jobs.html" || f === "job-detail.html") return "jobs";
      if (f === "chat.html") return "chat";
      if (f === "horas.html" || f === "payroll-module.html") return "horas";
      return "";
    }
    if (f === "home.html" || f === "" || f === "dashboard.html") return "home";
    if (f === "pipeline-lab.html" || f === "leads.html" || f === "lead-detail.html") return "pipeline";
    if (f === "schedule.html") return "agenda";
    if (
      f === "mais.html" ||
      f === "chat.html" ||
      f === "quotes.html" ||
      f === "quote-builder.html" ||
      f === "quote-catalog.html" ||
      f === "invoices.html" ||
      f === "invoice.html" ||
      f === "customers.html" ||
      f === "jobs.html" ||
      f === "job-detail.html" ||
      f === "job-media-board.html" ||
      f === "equipe.html" ||
      f === "configuracoes.html" ||
      f === "finance.html" ||
      f === "financial.html" ||
      f === "payroll-module.html" ||
      f === "folha.html"
    ) {
      return "more";
    }
    return "";
  }

  function hideLegacyBottomNav() {
    document.querySelectorAll("#mobileTabBar, .sf-bottom-nav.mobile-tab-bar, nav.sf-bottom-nav").forEach((el) => {
      el.style.setProperty("display", "none", "important");
      el.setAttribute("aria-hidden", "true");
      el.hidden = true;
    });
    document.body.classList.remove("sf-mobile-shell");
  }

  function ensureCss() {
    if (![...document.querySelectorAll('link[href*="om-mobile-nav.css"]')].length) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `om-mobile-nav.css?v=${VER}`;
      document.head.appendChild(link);
    }
    if (![...document.querySelectorAll('link[href*="om-native-app.css"]')].length) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `om-native-app.css?v=${VER}`;
      document.head.appendChild(link);
    }
    if (![...document.querySelectorAll('link[href*="agenda-mais.css"]')].length) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `agenda-mais.css?v=${VER}`;
      document.head.appendChild(link);
    }
  }

  function ensureAppleChrome() {
    const head = document.head;
    if (!head) return;

    const ensureMeta = (name, content) => {
      let el = head.querySelector(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        head.appendChild(el);
      }
      if (!el.getAttribute("content")) el.setAttribute("content", content);
    };

    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureMeta("mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-status-bar-style", "default");
    ensureMeta("apple-mobile-web-app-title", "ObraMate");
    ensureMeta("theme-color", "#f3f1ee");
    ensureMeta("view-transition", "same-origin");

    if (![...head.querySelectorAll('link[rel="manifest"]')].length) {
      const man = document.createElement("link");
      man.rel = "manifest";
      man.href = "/manifest.json?v=20260930-native2";
      head.appendChild(man);
    }
    if (![...head.querySelectorAll('link[rel="apple-touch-icon"]')].length) {
      const icon = document.createElement("link");
      icon.rel = "apple-touch-icon";
      icon.href = "/assets/favicon-180.png?v=20260924-pwa";
      head.appendChild(icon);
    }

    try {
      if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
        document.documentElement.classList.add("om-standalone");
        document.body.classList.add("om-standalone");
      }
    } catch (_) {}
  }

  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 10);
    } catch (_) {}
  }

  function closeSheets() {
    const create = document.getElementById("omCreateSheet");
    const backdrop = document.getElementById("omSheetBackdrop");
    if (create) {
      create.style.transform = "";
      create.classList.remove("is-open", "is-dragging");
    }
    if (backdrop) {
      backdrop.style.opacity = "";
      backdrop.classList.remove("is-open");
    }
    document.body.classList.remove("om-sheet-open");
    window.setTimeout(() => {
      if (create && !create.classList.contains("is-open")) create.hidden = true;
      if (backdrop && !backdrop.classList.contains("is-open")) backdrop.hidden = true;
    }, SHEET_MS);
  }

  function openSheet(id) {
    const sheet = document.getElementById(id);
    const backdrop = document.getElementById("omSheetBackdrop");
    if (!sheet || !backdrop) return;
    const other = document.getElementById("omCreateSheet");
    if (other && other !== sheet) {
      other.classList.remove("is-open", "is-dragging");
      other.style.transform = "";
      other.hidden = true;
    }
    sheet.hidden = false;
    sheet.style.transform = "";
    backdrop.hidden = false;
    backdrop.style.opacity = "";
    document.body.classList.add("om-sheet-open");
    haptic(8);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sheet.classList.add("is-open");
        backdrop.classList.add("is-open");
      });
    });
  }

  function bindSheetDrag(sheet) {
    if (!sheet || sheet.dataset.omDragBound === "1") return;
    sheet.dataset.omDragBound = "1";
    const backdrop = () => document.getElementById("omSheetBackdrop");
    let startY = 0;
    let dy = 0;
    let dragging = false;
    let pointerId = null;

    const onStart = (clientY, id) => {
      if (!sheet.classList.contains("is-open")) return;
      if (sheet.scrollTop > 0) return;
      startY = clientY;
      dy = 0;
      dragging = true;
      pointerId = id;
      sheet.classList.add("is-dragging");
    };

    const onMove = (clientY) => {
      if (!dragging) return;
      dy = Math.max(0, clientY - startY);
      sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
      const bd = backdrop();
      if (bd) bd.style.opacity = String(Math.max(0.15, 1 - dy / 420));
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      pointerId = null;
      sheet.classList.remove("is-dragging");
      const shouldClose = dy > 120 || (dy > 56 && dy / SHEET_MS > 0.35);
      if (shouldClose) {
        haptic(12);
        closeSheets();
        return;
      }
      sheet.style.transform = "";
      const bd = backdrop();
      if (bd) bd.style.opacity = "";
    };

    sheet.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const grab = e.target.closest(".om-sheet__grab, .om-sheet__title");
        const fromTop = e.clientY - sheet.getBoundingClientRect().top < 72;
        if (!grab && !fromTop) return;
        try {
          sheet.setPointerCapture(e.pointerId);
        } catch (_) {}
        onStart(e.clientY, e.pointerId);
      },
      { passive: true },
    );
    sheet.addEventListener(
      "pointermove",
      (e) => {
        if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
        onMove(e.clientY);
      },
      { passive: true },
    );
    sheet.addEventListener("pointerup", onEnd);
    sheet.addEventListener("pointercancel", onEnd);
  }

  function bindEdgeSwipeBack() {
    if (edgeSwipeBound) return;
    const f = fileName();
    const primary = new Set(["home.html", "pipeline-lab.html", "schedule.html", "mais.html", "", "dashboard.html"]);
    if (primary.has(f)) return;
    edgeSwipeBound = true;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let fromEdge = false;
    let pageLeft = false;
    // Edge swipe-right (iOS) + full-screen swipe-left = back.
    const EDGE_PX = 36;
    const BLOCK_SEL =
      ".om-swipe, .lcard, .mleads-swipe, .sf-quote-card, .kanban-card, .kanban-board, .chiptrack, .om-sheet, [data-om-no-back-swipe], input, textarea, select";

    function goBack() {
      haptic(10);
      if (window.__crmShell && typeof window.__crmShell.goBack === "function") {
        window.__crmShell.goBack();
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        location.href = "mais.html";
      }
    }

    function blockedTarget(el) {
      try {
        return !!(el && el.closest && el.closest(BLOCK_SEL));
      } catch (_) {
        return true;
      }
    }

    document.addEventListener(
      "touchstart",
      (e) => {
        if (document.body.classList.contains("om-sheet-open")) return;
        if (document.body.classList.contains("om-edge-swipe-lock")) return;
        const t = e.touches[0];
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        fromEdge = startX <= EDGE_PX;
        pageLeft = !fromEdge && !blockedTarget(e.target);
        tracking = fromEdge || pageLeft;
      },
      { passive: true },
    );
    document.addEventListener(
      "touchmove",
      (e) => {
        if (!tracking) return;
        const t = e.touches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = Math.abs(t.clientY - startY);
        if (dy > 56) {
          tracking = false;
          document.body.classList.remove("om-edge-swipe");
          return;
        }
        if (fromEdge && dx > 24 && dy < 40) document.body.classList.add("om-edge-swipe");
      },
      { passive: true },
    );
    document.addEventListener(
      "touchend",
      (e) => {
        if (!tracking) return;
        tracking = false;
        document.body.classList.remove("om-edge-swipe");
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = Math.abs(t.clientY - startY);
        if (dy > 60) return;
        if (fromEdge && dx >= 64) {
          goBack();
          return;
        }
        // Arrastar tela para a esquerda = voltar (fora de linhas swipe / kanban).
        if (pageLeft && dx <= -72) {
          goBack();
        }
      },
      { passive: true },
    );
  }

  function navigateNative(href) {
    if (!href) return;
    location.href = href;
  }

  function syncActive() {
    const nav = document.getElementById("omTabbar");
    if (!nav) return;
    const field = document.body.classList.contains("om-field-nav") || !!nav.classList.contains("om-tabbar--field");
    const tab = activeTab(field);
    nav.querySelectorAll("[data-om-tab]").forEach((el) => {
      const on = el.getAttribute("data-om-tab") === tab;
      el.classList.toggle("is-active", on);
      if (on) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
  }

  function bindTabNativeNav(root) {
    if (!root || root.dataset.omNavBound === "1") return;
    root.dataset.omNavBound = "1";
    root.querySelectorAll("a.om-tabbar__item[href]").forEach((a) => {
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("http")) return;
        const dest = (href.split("?")[0].split("/").pop() || href).toLowerCase();
        if (dest === fileName().toLowerCase()) {
          e.preventDefault();
          return;
        }
        haptic(8);
        a.classList.add("is-pressing");
      });
    });
  }

  function prefetchTabs() {
    const run = () => {
      TAB_HREFS.forEach((href) => {
        try {
          const link = document.createElement("link");
          link.rel = "prefetch";
          link.href = href;
          link.as = "document";
          document.head.appendChild(link);
        } catch (_) {}
      });
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 2500 });
    else window.setTimeout(run, 1200);
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
        <a class="om-mod-card" href="schedule.html?new=1" id="omCreateSchedule">
          <span class="om-mod-card__icon" aria-hidden="true">${ICONS.agendaAdd}</span>
          <span>
            <p class="om-mod-card__title">Agendar</p>
            <p class="om-mod-card__sub">Visita, job ou compromisso</p>
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
    bindSheetDrag(create);

    create.querySelector("#omCreateNewLead")?.addEventListener("click", () => {
      closeSheets();
      haptic(8);
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
        <a class="om-app-top__avatar home-avatar" id="homeAvatar" href="configuracoes.html" aria-label="Conta">—</a>
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
    if (document.getElementById("omTabbar")) {
      document.body.classList.add("om-has-tabbar");
      hideLegacyBottomNav();
      syncActive();
      return;
    }
    const nav = document.createElement("nav");
    nav.id = "omTabbar";
    nav.className = "om-tabbar";
    nav.setAttribute("aria-label", "Navegação principal");

    const tab = activeTab(false);
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
    hideLegacyBottomNav();
    bindTabNativeNav(nav);

    document.getElementById("omTabbarFab")?.addEventListener("click", () => {
      // On Schedule, + opens the add-to-agenda menu directly.
      if (fileName() === "schedule.html" && typeof window.__agendaOpenNew === "function") {
        closeSheets();
        haptic(8);
        window.__agendaOpenNew();
        return;
      }
      openSheet("omCreateSheet");
    });
  }

  /** Field worker nav — mirrors Campo tabs on Jobs / Schedule / Chat pages. */
  function ensureFieldTabbar() {
    if (document.getElementById("omTabbar")) {
      document.body.classList.add("om-has-tabbar", "om-field-nav");
      hideLegacyBottomNav();
      bindTabNativeNav(document.getElementById("omTabbar"));
      syncActive();
      return;
    }
    const nav = document.createElement("nav");
    nav.id = "omTabbar";
    nav.className = "om-tabbar om-tabbar--field";
    nav.setAttribute("aria-label", "Campo");
    const tab = activeTab(true);
    nav.innerHTML = `
      <a class="om-tabbar__item${tab === "hoje" ? " is-active" : ""}" href="/campo/hoje.html" data-om-tab="hoje"${
        tab === "hoje" ? ' aria-current="page"' : ""
      }>
        ${ICONS.home}
        <span>Hoje</span>
      </a>
      <a class="om-tabbar__item${tab === "agenda" ? " is-active" : ""}" href="/campo/agenda.html" data-om-tab="agenda"${
        tab === "agenda" ? ' aria-current="page"' : ""
      }>
        ${ICONS.agenda}
        <span>Agenda</span>
      </a>
      <a class="om-tabbar__item${tab === "jobs" ? " is-active" : ""}" href="/jobs.html" data-om-tab="jobs"${
        tab === "jobs" ? ' aria-current="page"' : ""
      }>
        ${ICONS.jobs}
        <span>Jobs</span>
      </a>
      <a class="om-tabbar__item${tab === "chat" ? " is-active" : ""}" href="/chat.html" data-om-tab="chat"${
        tab === "chat" ? ' aria-current="page"' : ""
      }>
        ${ICONS.chat}
        <span>ObraChat</span>
      </a>
      <a class="om-tabbar__item${tab === "horas" ? " is-active" : ""}" href="/campo/horas.html" data-om-tab="horas"${
        tab === "horas" ? ' aria-current="page"' : ""
      }>
        ${ICONS.horas}
        <span>Horas</span>
      </a>`;
    document.body.appendChild(nav);
    document.body.classList.add("om-has-tabbar", "om-field-nav");
    hideLegacyBottomNav();
    bindTabNativeNav(nav);
  }

  async function resolveFieldRole() {
    if (window.__crmFieldGate && typeof window.__crmFieldGate.isFieldRole === "function") {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return false;
        const s = await res.json();
        return !!(s?.authenticated && window.__crmFieldGate.isFieldRole(s.user?.role));
      } catch (_) {
        return false;
      }
    }
    try {
      const res = await fetch("/api/auth/session", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return false;
      const s = await res.json();
      return !!(s?.authenticated && isFieldRole(s.user?.role));
    } catch (_) {
      return false;
    }
  }

  async function boot() {
    if (document.body.dataset.omTabbarBoot === "1") return;
    if (/^(login|builder-login|change-password)\.html$/i.test(fileName())) return;
    if (!document.body.classList.contains("om-app") && !document.body.classList.contains("dashboard-app-body")) {
      return;
    }
    const mobile =
      window.__omDevice && typeof window.__omDevice.isMobile === "function"
        ? window.__omDevice.isMobile()
        : /iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent || "") ||
          (/Android/i.test(navigator.userAgent || "") &&
            /Mobile/i.test(navigator.userAgent || "") &&
            !(window.__omDevice && typeof window.__omDevice.isTablet === "function" && window.__omDevice.isTablet()));
    if (!mobile) return;
    document.body.dataset.omTabbarBoot = "1";
    document.documentElement.classList.add("om-device-mobile");
    document.body.classList.add("om-device-mobile");
    ensureCss();
    ensureAppleChrome();

    const field = await resolveFieldRole();
    if (field) {
      ensureFieldTabbar();
      bindEdgeSwipeBack();
      prefetchTabs();
      return;
    }

    ensureAppTop();
    ensureSheets();
    ensureTabbar();
    bindEdgeSwipeBack();
    prefetchTabs();

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
      navigateNative("mais.html");
    },
    close: closeSheets,
    haptic,
    navigate: navigateNative,
    syncActive,
  };
})();
