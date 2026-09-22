/**
 * Applies multi-tenant branding (logo + palette) across CRM HTML pages.
 * Colors also come from /api/branding.css; this script updates logos/titles.
 */
(function () {
  function applyLogo(url, name) {
    if (!url) return;
    const imgs = document.querySelectorAll(
      'img.sidebar-brand-logo, img.logo-image, img.mobile-app-header__logo, link[rel="icon"], link[rel="apple-touch-icon"]',
    );
    imgs.forEach((el) => {
      if (el.tagName === "LINK") {
        el.setAttribute("href", url);
      } else {
        el.setAttribute("src", url);
        if (name) el.setAttribute("alt", name);
        el.style.display = "";
      }
    });
  }

  function applyName(name) {
    if (!name) return;
    document.querySelectorAll(".login-header h1, .sidebar-brand-name").forEach((el) => {
      el.textContent = name;
    });
    const title = document.title || "";
    if (/Senior Floors/i.test(title)) {
      document.title = title.replace(/Senior Floors/gi, name);
    }
  }

  function applyCssVars(vars) {
    if (!vars || typeof vars !== "object") return;
    const root = document.documentElement;
    Object.keys(vars).forEach((k) => {
      root.style.setProperty(k, vars[k]);
    });
    const primary = vars["--sf-navy"] || vars["--color-primary"];
    if (primary) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", primary);
    }
  }

  async function boot() {
    try {
      const r = await fetch("/api/branding", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (!j || !j.success || !j.data) return;
      const d = j.data;
      window.__saasBrand = d;
      applyCssVars(d.css_vars);
      applyLogo(d.logo_url, d.name);
      applyName(d.name);
    } catch {
      /* ignore — defaults from styles.css remain */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
