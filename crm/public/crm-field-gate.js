/**
 * Field workers (installer / crew_lead):
 * - Mobile → Campo (with allowlist for Jobs / Schedule / Folha / Chat)
 * - Desktop → funcionario.html (PC shell), never pipeline/office CRM
 */
(function (global) {
  /**
   * Session request coalescing.
   * Shell, nav, account menu, mobile nav and the page script each call
   * GET /api/auth/session on load (8–10 identical requests per page). They now
   * share one in-flight response for a few seconds; any POST to /api/auth/*
   * (login, logout, workspace switch) drops the cached copy.
   */
  if (typeof global.fetch === "function" && !global.__omSessionCoalesce) {
    const SESSION_RE = /^(?:https?:\/\/[^/]+)?\/api\/auth\/session(?:[?#].*)?$/;
    const AUTH_RE = /^(?:https?:\/\/[^/]+)?\/api\/auth\//;
    const TTL_MS = 10000;
    const nativeFetch = global.fetch.bind(global);
    let shared = null;
    let sharedAt = 0;
    global.__omSessionCoalesce = true;
    global.__omSessionReset = function () {
      shared = null;
    };
    global.fetch = function (input, init) {
      let url = "";
      let method = "GET";
      try {
        url = typeof input === "string" ? input : (input && input.url) || String(input || "");
        method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      } catch (_) {}
      if (method === "GET" && SESSION_RE.test(url)) {
        const now = Date.now();
        if (!shared || now - sharedAt > TTL_MS) {
          sharedAt = now;
          shared = nativeFetch(input, init).then(
            (res) => {
              if (!res.ok) shared = null;
              return res;
            },
            (err) => {
              shared = null;
              throw err;
            },
          );
        }
        return shared.then((res) => res.clone());
      }
      if (method !== "GET" && AUTH_RE.test(url)) shared = null;
      return nativeFetch(input, init);
    };
  }

  const FIELD_ROLES = new Set(["installer", "crew_lead", "subcontractor"]);
  const CAMPO_HOME = "/campo/hoje.html";
  const DESKTOP_HOME = "/funcionario.html";
  const VER = "20260928-chat1";

  const DESKTOP_ALLOW = new Set([
    "funcionario.html",
    "schedule.html",
    "jobs.html",
    "job-detail.html",
    "payroll-module.html",
    "chat.html",
    "ajustes.html",
    "configuracoes.html",
    "change-password.html",
    "login.html",
  ]);

  /** Mobile field may leave Campo for these modules only. */
  const MOBILE_ALLOW = new Set([
    "schedule.html",
    "jobs.html",
    "job-detail.html",
    "payroll-module.html",
    "chat.html",
    "ajustes.html",
    "configuracoes.html",
    "change-password.html",
    "login.html",
  ]);

  function isFieldRole(role) {
    return FIELD_ROLES.has(String(role || "").toLowerCase());
  }

  function isMobile() {
    if (global.__omDevice && typeof global.__omDevice.isMobile === "function") {
      return global.__omDevice.isMobile();
    }
    const ua = global.navigator?.userAgent || "";
    if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|iPad/i.test(ua)) return true;
    try {
      if (
        global.navigator?.platform === "MacIntel" &&
        Number(global.navigator?.maxTouchPoints || 0) > 1
      ) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function currentFile() {
    const p = String(global.location?.pathname || "");
    const parts = p.split("/").filter(Boolean);
    return (parts[parts.length - 1] || "").toLowerCase() || "index.html";
  }

  function isCampoPath(pathname) {
    const p = String(pathname || global.location?.pathname || "").toLowerCase();
    return p.includes("/campo/");
  }

  function isAuthPath(pathname) {
    const p = String(pathname || "").toLowerCase();
    return (
      p.endsWith("/login.html") ||
      p.endsWith("/signup") ||
      p.includes("/change-password") ||
      p.endsWith("/logout")
    );
  }

  function fieldHomeHref() {
    return isMobile() ? CAMPO_HOME : DESKTOP_HOME;
  }

  function go(href) {
    try {
      global.location.replace(href);
    } catch (_) {
      global.location.href = href;
    }
    return true;
  }

  async function fetchSession() {
    try {
      const res = await fetch("/api/auth/session", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  /**
   * Route field staff to the right home / block office pages.
   * Returns true if a redirect was triggered.
   */
  async function bounceFieldWorker() {
    if (isAuthPath(global.location?.pathname || "")) return false;
    const data = await fetchSession();
    if (!data || !data.authenticated || !data.user) return false;
    if (!isFieldRole(data.user.role)) return false;

    const mobile = isMobile();
    const path = global.location?.pathname || "";
    const file = currentFile();

    if (mobile) {
      if (isCampoPath(path)) return false;
      if (MOBILE_ALLOW.has(file)) return false;
      return go(CAMPO_HOME);
    }

    // Desktop: Campo shell → PC funcionario home
    if (isCampoPath(path)) return go(DESKTOP_HOME);

    if (DESKTOP_ALLOW.has(file)) return false;
    return go(DESKTOP_HOME);
  }

  /** @deprecated use bounceFieldWorker */
  async function bounceFieldToCampo() {
    return bounceFieldWorker();
  }

  function bounceIfFieldRole(role) {
    if (!isFieldRole(role)) return false;
    return go(fieldHomeHref());
  }

  global.__crmFieldGate = {
    VER,
    FIELD_ROLES: Array.from(FIELD_ROLES),
    MOBILE_ALLOW: Array.from(MOBILE_ALLOW),
    isFieldRole,
    isCampoPath,
    isMobile,
    fieldHomeHref,
    goCampo: () => go(CAMPO_HOME),
    goDesktopHome: () => go(DESKTOP_HOME),
    bounceFieldWorker,
    bounceFieldToCampo,
    bounceIfFieldRole,
    CAMPO_HOME,
    DESKTOP_HOME,
  };

  if (typeof document !== "undefined" && !isAuthPath(global.location?.pathname || "")) {
    bounceFieldWorker().catch(() => {});
  }
})(typeof window !== "undefined" ? window : globalThis);
