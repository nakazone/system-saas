/**
 * Top-bar account / tools dropdown:
 * Settings, Your Account, Team, Language (en/pt/es), Log out.
 */
(function () {
  function t(key) {
    return window.CrmI18n && typeof window.CrmI18n.t === "function"
      ? window.CrmI18n.t(key)
      : key;
  }

  function can(perm) {
    if (!perm) return true;
    var keys = window.__crmPermissionKeys;
    if (!Array.isArray(keys)) return true; // until session loads
    var role = window.__crmUserRole;
    if (role === "admin") return true;
    return keys.indexOf(perm) >= 0;
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (_) {}
    window.location.href = "/login.html";
  }

  function teamHref() {
    var file = (window.location.pathname || "").split("/").pop() || "";
    if (file.toLowerCase() === "dashboard.html" || file === "" || file === "/") {
      return "#";
    }
    return "dashboard.html?page=users";
  }

  function goTeam(e) {
    if (e) e.preventDefault();
    var file = (window.location.pathname || "").split("/").pop() || "";
    if (
      (file.toLowerCase() === "dashboard.html" || file === "" || file === "/") &&
      typeof window.showPage === "function"
    ) {
      window.showPage("users");
      return;
    }
    window.location.href = "dashboard.html?page=users";
  }

  function buildMenuHtml() {
    var locale = window.CrmI18n ? window.CrmI18n.getLocale() : "pt";
    return (
      '<div class="crm-account-menu" id="crmAccountMenu" hidden>' +
      '<a class="crm-account-menu__item" href="ajustes.html" data-account-action="settings" data-crm-permission="settings.manage">' +
      '<span data-i18n="menu.settings">' +
      t("menu.settings") +
      "</span></a>" +
      '<a class="crm-account-menu__item" href="change-password.html" data-account-action="account">' +
      '<span data-i18n="menu.account">' +
      t("menu.account") +
      "</span></a>" +
      '<a class="crm-account-menu__item" href="' +
      teamHref() +
      '" data-account-action="team" data-crm-permission="users.view">' +
      '<span data-i18n="menu.team">' +
      t("menu.team") +
      "</span></a>" +
      '<div class="crm-account-menu__sep" role="separator"></div>' +
      '<div class="crm-account-menu__section">' +
      '<p class="crm-account-menu__label" data-i18n="menu.language">' +
      t("menu.language") +
      "</p>" +
      '<div class="crm-account-menu__langs" role="group" aria-label="Language">' +
      '<button type="button" class="crm-account-menu__lang' +
      (locale === "en" ? " is-active" : "") +
      '" data-locale="en" data-i18n="lang.en">' +
      t("lang.en") +
      "</button>" +
      '<button type="button" class="crm-account-menu__lang' +
      (locale === "pt" ? " is-active" : "") +
      '" data-locale="pt" data-i18n="lang.pt">' +
      t("lang.pt") +
      "</button>" +
      '<button type="button" class="crm-account-menu__lang' +
      (locale === "es" ? " is-active" : "") +
      '" data-locale="es" data-i18n="lang.es">' +
      t("lang.es") +
      "</button>" +
      "</div></div>" +
      '<div class="crm-account-menu__sep" role="separator"></div>' +
      '<button type="button" class="crm-account-menu__item crm-account-menu__item--danger" data-account-action="logout">' +
      '<span data-i18n="menu.logout">' +
      t("menu.logout") +
      "</span></button>" +
      "</div>"
    );
  }

  function applyPermissions(menu) {
    menu.querySelectorAll("[data-crm-permission]").forEach(function (el) {
      var perm = el.getAttribute("data-crm-permission");
      el.hidden = !can(perm);
    });
  }

  function closeMenu(wrap) {
    var btn = wrap.querySelector("[data-account-menu-trigger]");
    var menu = wrap.querySelector("#crmAccountMenu");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
    wrap.classList.remove("is-open");
  }

  function openMenu(wrap) {
    var btn = wrap.querySelector("[data-account-menu-trigger]");
    var menu = wrap.querySelector("#crmAccountMenu");
    if (!menu) return;
    applyPermissions(menu);
    if (window.CrmI18n) window.CrmI18n.apply(menu);
    menu.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "true");
    wrap.classList.add("is-open");
  }

  function ensureWrap() {
    var existing = document.getElementById("crmAccountMenuWrap");
    if (existing) return existing;

    var old = document.getElementById("crmTopbarSettingsBtn");
    var host = old && old.parentElement;
    if (!host) return null;

    var wrap = document.createElement("div");
    wrap.className = "crm-account-menu-wrap";
    wrap.id = "crmAccountMenuWrap";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "crm-topbar__icon-btn";
    btn.id = "crmTopbarSettingsBtn";
    btn.setAttribute("data-account-menu-trigger", "1");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "crmAccountMenu");
    btn.setAttribute("data-i18n-aria", "menu.open");
    btn.setAttribute("data-i18n-title", "menu.open");
    btn.setAttribute("aria-label", t("menu.open"));
    btn.title = t("menu.open");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';

    wrap.appendChild(btn);
    wrap.insertAdjacentHTML("beforeend", buildMenuHtml());
    host.replaceChild(wrap, old);
    return wrap;
  }

  function bind(wrap) {
    if (!wrap || wrap.dataset.bound) return;
    wrap.dataset.bound = "1";

    var btn = wrap.querySelector("[data-account-menu-trigger]");
    var menu = wrap.querySelector("#crmAccountMenu");

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) openMenu(wrap);
      else closeMenu(wrap);
    });

    menu.addEventListener("click", function (e) {
      var langBtn = e.target.closest("[data-locale]");
      if (langBtn) {
        e.preventDefault();
        e.stopPropagation();
        var next = langBtn.getAttribute("data-locale");
        if (window.CrmI18n) window.CrmI18n.setLocale(next);
        window.location.reload();
        return;
      }

      var actionEl = e.target.closest("[data-account-action]");
      if (!actionEl) return;
      var action = actionEl.getAttribute("data-account-action");
      if (action === "logout") {
        e.preventDefault();
        closeMenu(wrap);
        logout();
        return;
      }
      if (action === "team") {
        e.preventDefault();
        closeMenu(wrap);
        goTeam();
        return;
      }
      closeMenu(wrap);
    });

    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) closeMenu(wrap);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu(wrap);
    });
  }

  function syncSessionPermissions() {
    fetch("/api/auth/session", { credentials: "include" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.authenticated || !j.user) return;
        window.__crmPermissionKeys = j.user.permissions || [];
        window.__crmUserRole = j.user.role || "";
        var menu = document.getElementById("crmAccountMenu");
        if (menu && !menu.hidden) applyPermissions(menu);
      })
      .catch(function () {});
  }

  function init() {
    var wrap = ensureWrap();
    if (!wrap) return;
    bind(wrap);
    if (window.CrmI18n) window.CrmI18n.apply(wrap);
    syncSessionPermissions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__crmAccountMenu = { init: init, logout: logout };
})();
