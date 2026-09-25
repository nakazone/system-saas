/**
 * Campo tabbar — Hoje / Agenda / Horas
 */
(function () {
  const VER = "20260925-campo1";

  const ICONS = {
    hoje: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
    agenda:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    horas:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  function fileName() {
    return (location.pathname || "").split("/").pop() || "";
  }

  function activeTab() {
    const f = fileName();
    if (f === "hoje.html" || f === "" || f === "index.html") return "hoje";
    if (f === "agenda.html") return "agenda";
    if (f === "horas.html") return "horas";
    return "";
  }

  function ensure() {
    if (document.getElementById("cmTabbar")) return;
    const tab = activeTab();
    const nav = document.createElement("nav");
    nav.id = "cmTabbar";
    nav.className = "cm-tabbar";
    nav.setAttribute("aria-label", "Campo");
    nav.innerHTML = `
      <a class="cm-tabbar__item${tab === "hoje" ? " is-active" : ""}" href="hoje.html" data-cm-tab="hoje">
        ${ICONS.hoje}<span>Hoje</span>
      </a>
      <a class="cm-tabbar__item${tab === "agenda" ? " is-active" : ""}" href="agenda.html" data-cm-tab="agenda">
        ${ICONS.agenda}<span>Agenda</span>
      </a>
      <a class="cm-tabbar__item${tab === "horas" ? " is-active" : ""}" href="horas.html" data-cm-tab="horas">
        ${ICONS.horas}<span>Horas</span>
      </a>
    `;
    document.body.appendChild(nav);
    document.body.classList.add("cm-has-tabbar");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensure);
  } else {
    ensure();
  }

  window.__campoNav = { VER, ensure, activeTab };
})();
