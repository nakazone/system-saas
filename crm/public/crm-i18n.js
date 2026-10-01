/**
 * Lightweight CRM locale (en / pt / es).
 * Persists in localStorage `crm_locale` and sets <html lang>.
 */
(function () {
  var STORAGE_KEY = "crm_locale";
  var SUPPORTED = ["en", "pt", "es"];

  var STRINGS = {
    en: {
      "menu.settings": "Settings",
      "menu.account": "My profile & password",
      "menu.company": "Company settings",
      "menu.team": "Team",
      "menu.language": "Language",
      "menu.logout": "Log out",
      "menu.refresh": "Refresh app",
      "menu.open": "Account menu",
      "lang.en": "English",
      "lang.pt": "Português",
      "lang.es": "Español",
      "nav.users": "Team",
      "nav.settings": "Settings",
    },
    pt: {
      "menu.settings": "Configurações",
      "menu.account": "Meu perfil e senha",
      "menu.company": "Configurações da empresa",
      "menu.team": "Equipe",
      "menu.language": "Idioma",
      "menu.logout": "Sair",
      "menu.refresh": "Atualizar app",
      "menu.open": "Menu da conta",
      "lang.en": "English",
      "lang.pt": "Português",
      "lang.es": "Español",
      "nav.users": "Equipe",
      "nav.settings": "Configurações",
    },
    es: {
      "menu.settings": "Configuración",
      "menu.account": "Mi perfil y contraseña",
      "menu.company": "Configuración de la empresa",
      "menu.team": "Equipo",
      "menu.language": "Idioma",
      "menu.logout": "Cerrar sesión",
      "menu.refresh": "Actualizar app",
      "menu.open": "Menú de cuenta",
      "lang.en": "English",
      "lang.pt": "Português",
      "lang.es": "Español",
      "nav.users": "Equipo",
      "nav.settings": "Configuración",
    },
  };

  function normalize(code) {
    var c = String(code || "")
      .toLowerCase()
      .slice(0, 2);
    return SUPPORTED.indexOf(c) >= 0 ? c : "pt";
  }

  function getLocale() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return normalize(stored);
    } catch (_) {}
    var nav = (navigator.language || "pt").slice(0, 2);
    return normalize(nav === "en" || nav === "es" ? nav : "pt");
  }

  function setLocale(code) {
    var locale = normalize(code);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (_) {}
    document.documentElement.lang = locale === "pt" ? "pt-BR" : locale;
    return locale;
  }

  function t(key) {
    var locale = getLocale();
    var pack = STRINGS[locale] || STRINGS.pt;
    return pack[key] || STRINGS.en[key] || key;
  }

  function applyDom(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!key) return;
      var value = t(key);
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.setAttribute("placeholder", value);
      } else {
        el.textContent = value;
      }
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
  }

  setLocale(getLocale());

  window.CrmI18n = {
    SUPPORTED: SUPPORTED,
    getLocale: getLocale,
    setLocale: setLocale,
    t: t,
    apply: applyDom,
    STRINGS: STRINGS,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyDom(document);
    });
  } else {
    applyDom(document);
  }
})();
