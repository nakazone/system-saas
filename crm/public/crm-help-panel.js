/**
 * Left slide-over Help panel (top-bar ? icon).
 */
(function () {
  var PANEL_ID = "crmHelpPanel";
  var BACKDROP_ID = "crmHelpBackdrop";

  function panelHtml() {
    return (
      '<aside class="crm-help-panel" id="' +
      PANEL_ID +
      '" role="dialog" aria-modal="true" aria-labelledby="crmHelpPanelTitle" hidden>' +
      '<div class="crm-help-panel__header">' +
      '<div class="crm-help-panel__intro">' +
      "<h2 id=\"crmHelpPanelTitle\">Need a hand?</h2>" +
      '<p class="crm-help-panel__lead">Help Center, tips, and support for your ObraMate workspace.</p>' +
      "</div>" +
      '<button type="button" class="crm-help-panel__close" data-crm-help-close aria-label="Close help">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      "</button>" +
      "</div>" +
      '<div class="crm-help-panel__body">' +
      '<a class="crm-help-panel__cta" href="ajustes.html#suporte">' +
      "<strong>Visit Help Center</strong>" +
      "<span>Browse guides or send a message to our team</span>" +
      "</a>" +
      '<p class="crm-help-panel__section-label">Recommendations</p>' +
      '<div class="crm-help-panel__cards">' +
      '<a class="crm-help-panel__card" href="dashboard.html">' +
      "<strong>Get Started</strong>" +
      "<span>A hand-picked list of steps to get ObraMate up and running for your company — branding, team invites, and your first leads.</span>" +
      "</a>" +
      '<a class="crm-help-panel__card" href="dashboard.html?page=leads">' +
      "<strong>Schedule &amp; pipeline</strong>" +
      "<span>View your leads pipeline, schedule visits, and learn more about tasks and follow-ups.</span>" +
      "</a>" +
      '<a class="crm-help-panel__card" href="dashboard.html?page=quotes">' +
      "<strong>Work</strong>" +
      "<span>Help covering each step of your workflow — leads, quotes, invoices, payroll, and job costs.</span>" +
      "</a>" +
      '<a class="crm-help-panel__card" href="dashboard.html?page=customers">' +
      "<strong>Clients</strong>" +
      "<span>Manage clients and builders, and keep communications organized across your team.</span>" +
      "</a>" +
      "</div>" +
      '<a class="crm-help-panel__link-row" href="ajustes.html#suporte@obramate" target="_blank" rel="noopener noreferrer">' +
      "<span>Watch ObraMate tips</span>" +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>' +
      "</a>" +
      '<div class="crm-help-panel__contact">' +
      "<h3>Get Support</h3>" +
      '<p>Email us at <a href="mailto:support@obramate.com">support@obramate.com</a> or open a ticket inside the app.</p>' +
      '<a class="crm-help-panel__btn" href="ajustes.html#suporte">Contact support</a>' +
      "</div>" +
      '<div class="crm-help-panel__footer">' +
      '<a href="/pricing">Terms of Service</a>' +
      '<a href="mailto:support@obramate.com">support@obramate.com</a>' +
      "</div>" +
      "</div>" +
      "</aside>"
    );
  }

  function ensure() {
    var backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "crm-help-backdrop";
      backdrop.hidden = true;
      backdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(backdrop);
    }
    var panel = document.getElementById(PANEL_ID);
    if (!panel) {
      document.body.insertAdjacentHTML("beforeend", panelHtml());
      panel = document.getElementById(PANEL_ID);
    }
    return { backdrop: backdrop, panel: panel };
  }

  function open() {
    var els = ensure();
    els.backdrop.hidden = false;
    els.backdrop.setAttribute("aria-hidden", "false");
    els.panel.hidden = false;
    requestAnimationFrame(function () {
      document.body.classList.add("crm-help-open");
      els.panel.classList.add("is-open");
      els.backdrop.classList.add("is-open");
    });
    var btn = document.getElementById("crmTopbarHelpBtn");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function close() {
    var panel = document.getElementById(PANEL_ID);
    var backdrop = document.getElementById(BACKDROP_ID);
    document.body.classList.remove("crm-help-open");
    if (panel) panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    var btn = document.getElementById("crmTopbarHelpBtn");
    if (btn) btn.setAttribute("aria-expanded", "false");
    window.setTimeout(function () {
      if (panel) panel.hidden = true;
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute("aria-hidden", "true");
      }
    }, 280);
  }

  function isOpen() {
    return document.body.classList.contains("crm-help-open");
  }

  function bindHelpButton(btn) {
    if (!btn || btn.dataset.crmHelpBound) return;
    btn.dataset.crmHelpBound = "1";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-controls", PANEL_ID);
    btn.setAttribute("aria-expanded", "false");
    // Prefer button semantics over navigation
    if (btn.tagName === "A") {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (isOpen()) close();
        else open();
      });
    } else {
      btn.addEventListener("click", function () {
        if (isOpen()) close();
        else open();
      });
    }
  }

  function init() {
    ensure();
    bindHelpButton(document.getElementById("crmTopbarHelpBtn"));

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-crm-help-close]")) {
        close();
        return;
      }
      if (e.target.closest("#" + BACKDROP_ID)) {
        close();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__crmHelpPanel = { open: open, close: close, isOpen: isOpen };
})();
