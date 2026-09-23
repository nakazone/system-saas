/**
 * Applies multi-tenant branding across CRM HTML pages.
 * - System chrome (top bar, mobile header, favicons, login) = fixed ObraMate
 * - Company logo = sidebar only (img.sidebar-brand-logo)
 * Colors also come from /api/branding.css.
 */
(function () {
  var DEFAULT_LOGO = "/assets/obramate-logo.png";
  var DEFAULT_NAME = "ObraMate";

  /** Fixed ObraMate marks — never swap for tenant logo. */
  function lockSystemLogos() {
    document
      .querySelectorAll(
        [
          ".crm-topbar__brand img",
          "img.crm-system-logo",
          "img.mobile-app-header__logo",
          "img.crm-shared-nav__brand-logo",
          ".login-header img.logo-image",
          'link[rel="icon"]',
          'link[rel="apple-touch-icon"]',
        ].join(", "),
      )
      .forEach(function (el) {
        if (el.tagName === "LINK") {
          el.setAttribute("href", DEFAULT_LOGO);
        } else {
          el.setAttribute("src", DEFAULT_LOGO);
          el.setAttribute("alt", DEFAULT_NAME);
          el.style.display = "";
        }
      });
  }

  /** Tenant-configurable logo — sidebar only. */
  function applyCompanyLogo(url, name) {
    var src = url || DEFAULT_LOGO;
    var alt = name || DEFAULT_NAME;
    var nodes = document.querySelectorAll(
      "img.sidebar-brand-logo, .sidebar-header > img, .sidebar-header a > img",
    );
    nodes.forEach(function (el) {
      // Never overwrite fixed system marks if misclassified
      if (el.classList && el.classList.contains("crm-system-logo")) return;
      el.setAttribute("src", src);
      el.setAttribute("alt", alt);
      el.style.display = "";
      el.onerror = function () {
        // Keep slot visible with system fallback instead of hiding forever
        if (el.getAttribute("src") !== DEFAULT_LOGO) {
          el.setAttribute("src", DEFAULT_LOGO);
        }
      };
    });
  }

  function applyName(name) {
    var n = name || DEFAULT_NAME;
    document.querySelectorAll(".sidebar-brand-name").forEach(function (el) {
      el.textContent = n;
    });
    // Keep product title as ObraMate; only rewrite legacy Senior Floors labels.
    var title = document.title || "";
    if (/Senior Floors|Flooring Platform/i.test(title)) {
      document.title = title
        .replace(/Senior Floors/gi, DEFAULT_NAME)
        .replace(/Flooring Platform/gi, DEFAULT_NAME);
    }
  }

  function applyCssVars(vars) {
    if (!vars || typeof vars !== "object") return;
    var root = document.documentElement;
    Object.keys(vars).forEach(function (k) {
      root.style.setProperty(k, vars[k]);
    });
    var primary = vars["--sf-navy"] || vars["--color-primary"];
    if (primary) {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", primary);
    }
  }

  async function boot() {
    lockSystemLogos();
    try {
      var r = await fetch("/api/branding", { credentials: "include", cache: "no-store" });
      var j = await r.json();
      if (!j || !j.success || !j.data) {
        applyCompanyLogo(DEFAULT_LOGO, DEFAULT_NAME);
        applyName(DEFAULT_NAME);
        return;
      }
      var d = j.data;
      window.__saasBrand = d;
      applyCssVars(d.css_vars);
      applyCompanyLogo(d.logo_url || DEFAULT_LOGO, d.name || DEFAULT_NAME);
      applyName(d.name || DEFAULT_NAME);
      lockSystemLogos();
    } catch (e) {
      applyCompanyLogo(DEFAULT_LOGO, DEFAULT_NAME);
      applyName(DEFAULT_NAME);
      lockSystemLogos();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
