/**
 * Soft navigation — keep sidebar / topbar / tabbar mounted; swap .dashboard-main only.
 */
(function () {
  if (window.__crmSoftNav) return;

  const SHELL_SCRIPT_RE =
    /crm-shell|crm-shared-nav|crm-soft-nav|om-mobile-nav|om-device|crm-field-gate|crm-toast|saas-branding|crm-i18n|crm-account-menu|crm-command-palette|crm-help-panel|crm-pwa|crm-address|crm-rich-text|novo-lead-sheet|om-native|tailwind|sortable/i;

  const HARD_NAV_RE =
    /(^|\/)(login|signup|change-password|builder-login|quote-builder|chat|campo\/|onsite|public-)/i;

  const CHROME_BODY_RE =
    /^(dashboard-app-body|om-app|om-chrome-ready|om-has-tabbar|om-has-dock|om-has-apptop|om-device-mobile|om-field-nav|om-field-desktop|om-app-ready|sidebar-collapsed|sidebar-open|func-app)$/;

  let navigating = false;
  let seq = 0;

  function fileOf(url) {
    try {
      const u = typeof url === "string" ? new URL(url, location.href) : url;
      return (u.pathname.split("/").pop() || "").toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function canSoftNav(url) {
    if (!url || url.origin !== location.origin) return false;
    const path = url.pathname || "";
    if (HARD_NAV_RE.test(path)) return false;
    const file = fileOf(url);
    if (!file.endsWith(".html") && path !== "/" && !path.endsWith("/")) return false;
    if (!document.querySelector("main.dashboard-main, .dashboard-main")) return false;
    return true;
  }

  function shouldSoftNav(url) {
    if (!canSoftNav(url)) return false;
    // Same document hash-only / identical URL — ignore for click nav
    if (url.pathname === location.pathname && url.search === location.search) return false;
    return true;
  }

  function syncChrome(href) {
    if (window.__crmSharedNav && typeof window.__crmSharedNav.syncActiveFromLocation === "function") {
      window.__crmSharedNav.syncActiveFromLocation();
    }
    if (window.__omMobileNav && typeof window.__omMobileNav.syncActive === "function") {
      window.__omMobileNav.syncActive(href);
    }
  }

  function syncBodyClasses(newBody) {
    if (!newBody) return;
    const keep = [...document.body.classList].filter((c) => CHROME_BODY_RE.test(c));
    document.body.className = newBody.className || "";
    keep.forEach((c) => document.body.classList.add(c));
  }

  function syncMobileTitle(doc) {
    const cur = document.querySelector(".mobile-app-header__title");
    const next = doc.querySelector(".mobile-app-header__title");
    if (cur && next) cur.textContent = next.textContent || "";
  }

  function ensureStylesheet(href) {
    if (!href) return;
    const abs = new URL(href, location.href).href;
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
    if (links.some((l) => l.href === abs || (l.getAttribute("href") || "").split("?")[0] === href.split("?")[0])) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-crm-soft-page", "1");
    document.head.appendChild(link);
  }

  function loadScript(src, inlineText) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.setAttribute("data-crm-soft-page", "1");
      if (src) {
        const u = new URL(src, location.href);
        u.searchParams.set("_sn", String(++seq));
        s.onload = () => resolve();
        s.onerror = () => resolve();
        s.src = u.pathname + u.search + u.hash;
        document.body.appendChild(s);
      } else if (inlineText && inlineText.trim()) {
        s.textContent = inlineText;
        document.body.appendChild(s);
        resolve();
      } else {
        resolve();
      }
    });
  }

  async function runPageAssets(doc) {
    document.querySelectorAll("script[data-crm-soft-page], link[data-crm-soft-page]").forEach((el) => el.remove());

    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (!href || SHELL_SCRIPT_RE.test(href)) return;
      if (/crm-shell|crm-shared-nav|om-mobile|om-native|obramate-app|design-system|styles\.css/i.test(href)) return;
      ensureStylesheet(href);
    });

    const bodyScripts = [...doc.querySelectorAll("body script")];
    for (const node of bodyScripts) {
      const src = node.getAttribute("src") || "";
      if (src && SHELL_SCRIPT_RE.test(src)) continue;
      if (!src && !String(node.textContent || "").trim()) continue;
      // Skip early chrome/critical inline blocks that only set body classes
      const text = String(node.textContent || "");
      if (!src && /crm_sidebar_collapsed|om-chrome-critical|__omDevice/.test(text) && text.length < 800) {
        continue;
      }
      await loadScript(src || null, src ? null : text);
    }
  }

  function hardNavigate(href) {
    location.href = href;
  }

  async function navigate(href, opts) {
    const replace = !!(opts && opts.replace);
    const force = !!(opts && opts.force);
    let url;
    try {
      url = new URL(href, location.href);
    } catch (_) {
      hardNavigate(href);
      return false;
    }

    if (force ? !canSoftNav(url) : !shouldSoftNav(url)) {
      hardNavigate(url.pathname + url.search + url.hash);
      return false;
    }

    if (navigating) return false;
    navigating = true;
    const target = url.pathname + url.search + url.hash;
    document.documentElement.classList.add("om-soft-nav-pending", "om-soft-nav-suppress");

    try {
      const res = await fetch(target, {
        credentials: "same-origin",
        headers: { Accept: "text/html", "X-ObraMate-Soft-Nav": "1" },
      });
      if (!res.ok || res.redirected && /login/i.test(res.url)) {
        hardNavigate(target);
        return false;
      }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const newMain = doc.querySelector("main.dashboard-main, .dashboard-main");
      const curMain = document.querySelector("main.dashboard-main, .dashboard-main");
      if (!newMain || !curMain) {
        hardNavigate(target);
        return false;
      }

      // Swap page content; keep shell chrome in the live document
      curMain.className = newMain.className;
      if (newMain.id) curMain.id = newMain.id;
      curMain.innerHTML = newMain.innerHTML;

      syncBodyClasses(doc.body);
      syncMobileTitle(doc);
      document.title = doc.title || document.title;

      if (replace) history.replaceState({ softNav: 1 }, "", target);
      else history.pushState({ softNav: 1 }, "", target);

      syncChrome(target);
      await runPageAssets(doc);

      // Re-bind helpers that scan the new main
      try {
        if (typeof window.sfBootCrmAddressAutocomplete === "function") {
          window.sfBootCrmAddressAutocomplete();
        }
      } catch (_) {}
      try {
        if (typeof window.sfScanCrmRichText === "function") {
          window.sfScanCrmRichText();
        }
      } catch (_) {}

      document.dispatchEvent(new CustomEvent("crm:soft-nav", { detail: { href: target } }));
      window.scrollTo(0, 0);

      document.documentElement.classList.remove("om-soft-nav-pending");
      document.documentElement.classList.add("om-soft-nav-enter");
      window.setTimeout(() => {
        document.documentElement.classList.remove("om-soft-nav-enter", "om-soft-nav-suppress");
      }, 280);

      return true;
    } catch (_) {
      hardNavigate(target);
      return false;
    } finally {
      navigating = false;
      document.documentElement.classList.remove("om-soft-nav-pending");
    }
  }

  function onClick(e) {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;
    if (a.dataset.softNav === "0" || a.getAttribute("data-no-soft-nav") === "1") return;

    const raw = a.getAttribute("href") || "";
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) {
      return;
    }

    let url;
    try {
      url = new URL(raw, location.href);
    } catch (_) {
      return;
    }
    if (!shouldSoftNav(url)) return;

    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  }

  function onPopState() {
    const href = location.pathname + location.search + location.hash;
    navigate(href, { replace: true, force: true });
  }

  document.addEventListener("click", onClick, true);
  window.addEventListener("popstate", onPopState);

  if (!history.state || !history.state.softNav) {
    try {
      history.replaceState({ softNav: 1 }, "", location.href);
    } catch (_) {}
  }

  window.__crmSoftNav = {
    navigate,
    shouldSoftNav: (href) => {
      try {
        return shouldSoftNav(new URL(href, location.href));
      } catch (_) {
        return false;
      }
    },
  };
})();
