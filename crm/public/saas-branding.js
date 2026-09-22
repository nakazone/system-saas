/**
 * Applies multi-tenant branding (logo + palette) across CRM HTML pages.
 * Colors also come from /api/branding.css; this script updates logos/titles.
 */
(function () {
  var DEFAULT_LOGO = "/assets/obramate-logo.png";
  var DEFAULT_NAME = "ObraMate";

  function applyLogo(url, name) {
    var src = url || DEFAULT_LOGO;
    var imgs = document.querySelectorAll(
      'img.sidebar-brand-logo, img.logo-image, img.mobile-app-header__logo, link[rel="icon"], link[rel="apple-touch-icon"]',
    );
    imgs.forEach(function (el) {
      if (el.tagName === "LINK") {
        el.setAttribute("href", src);
      } else {
        el.setAttribute("src", src);
        if (name) el.setAttribute("alt", name);
        el.style.display = "";
      }
    });
  }

  function applyName(name) {
    var n = name || DEFAULT_NAME;
    document.querySelectorAll(".login-header h1, .sidebar-brand-name").forEach(function (el) {
      el.textContent = n;
    });
    var title = document.title || "";
    if (/Senior Floors|ObraMate|Flooring Platform/i.test(title)) {
      document.title = title
        .replace(/Senior Floors/gi, n)
        .replace(/Flooring Platform/gi, n)
        .replace(/ObraMate/gi, n);
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
    try {
      var r = await fetch("/api/branding", { credentials: "include", cache: "no-store" });
      var j = await r.json();
      if (!j || !j.success || !j.data) {
        applyLogo(DEFAULT_LOGO, DEFAULT_NAME);
        applyName(DEFAULT_NAME);
        return;
      }
      var d = j.data;
      window.__saasBrand = d;
      applyCssVars(d.css_vars);
      applyLogo(d.logo_url || DEFAULT_LOGO, d.name || DEFAULT_NAME);
      applyName(d.name || DEFAULT_NAME);
    } catch (e) {
      applyLogo(DEFAULT_LOGO, DEFAULT_NAME);
      applyName(DEFAULT_NAME);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
