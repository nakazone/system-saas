/**
 * Campo tabbar — Hoje / Agenda / Jobs / Chat / Horas
 */
(function () {
  const VER = "20261105-shell1";

  function fileName() {
    return (location.pathname || "").split("/").pop() || "";
  }

  function activeTab() {
    const f = fileName();
    const path = (location.pathname || "").toLowerCase();
    if (f === "hoje.html" || f === "" || f === "index.html") return "hoje";
    if (f === "agenda.html") return "agenda";
    if (f === "jobs.html" || f === "job-detail.html" || path.includes("/jobs")) return "jobs";
    if (f === "chat.html") return "chat";
    if (f === "horas.html") return "horas";
    return "";
  }

  /** Same bars as every other app (om-shell.js): app name + account on top, the floating tabs below. */
  function ensureTop() {
    // Ticket and samples are detail pages: their header with the back button stays in place of this bar.
    if (document.getElementById("cmAppTop") || document.querySelector(".cm-ticket-top, .st-top")) return;
    document.body.insertBefore(window.OmShell.crewTop("cmAppTop"), document.body.firstChild);
  }

  function ensure() {
    if (!window.OmShell || document.getElementById("cmTabbar")) return;
    ensureTop();
    const tab = activeTab();
    const item = (key, label, icon, href) => ({ key, label, icon, href, active: tab === key, attrs: `data-cm-tab="${key}"`, className: "cm-tabbar__item" });
    const nav = window.OmShell.tabs({
      id: "cmTabbar",
      className: "cm-tabbar",
      label: "ObraCrew",
      items: [
        item("hoje", "Hoje", "home", "/campo/hoje.html"),
        item("agenda", "Agenda", "calendar", "/campo/agenda.html"),
        item("jobs", "Jobs", "jobs", "/jobs.html"),
        item("chat", "ObraChat", "chat", "/chat.html"),
        item("horas", "Horas", "clock", "/campo/horas.html"),
      ],
    });
    document.body.appendChild(nav);
    document.body.classList.add("cm-has-tabbar");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensure);
  } else {
    ensure();
  }

  // Route panel on demand: crm-day-route.js (and the address autocomplete it uses for the start
  // address) used to load on every Campo page; now they load the first time "Ver rota" is tapped.
  // Same versioned URLs the pages had.
  const LAZY = {
    autocomplete: "/crm-address-autocomplete.js?v=20261105-u1",
    dayRoute: "/crm-day-route.js?v=20261105-field1",
  };
  const loading = {};
  function loadScript(src) {
    if (!loading[src]) {
      loading[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => {
          delete loading[src];
          s.remove();
          reject(new Error("Sem conexão para abrir a rota agora."));
        };
        document.head.appendChild(s);
      });
    }
    return loading[src];
  }
  async function loadDayRoute() {
    if (window.__crmDayRoute) return window.__crmDayRoute;
    if (typeof window.sfEnsureCrmAddressAutocomplete !== "function") await loadScript(LAZY.autocomplete);
    await loadScript(LAZY.dayRoute);
    return window.__crmDayRoute || null;
  }

  window.__campoNav = { VER, ensure, activeTab, loadDayRoute };
})();
