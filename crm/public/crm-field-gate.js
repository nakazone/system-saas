/**
 * Field workers (installer / crew_lead) stay in Campo — never office CRM / pipeline.
 * Load early on office pages (before redirects to pipeline).
 */
(function (global) {
  const FIELD_ROLES = new Set(["installer", "crew_lead"]);
  const CAMPO_HOME = "/campo/hoje.html";
  const VER = "20260925-field1";

  function isFieldRole(role) {
    return FIELD_ROLES.has(String(role || "").toLowerCase());
  }

  function isCampoPath(pathname) {
    const p = String(pathname || global.location?.pathname || "").toLowerCase();
    return p.includes("/campo/") || /(^|\/)campo\//.test(p);
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

  function goCampo() {
    if (isCampoPath()) return false;
    try {
      global.location.replace(CAMPO_HOME);
    } catch (_) {
      global.location.href = CAMPO_HOME;
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
   * If current user is field staff and not already in Campo, redirect.
   * Returns true when a redirect was triggered.
   */
  async function bounceFieldToCampo() {
    if (isCampoPath() || isAuthPath(global.location?.pathname || "")) return false;
    const data = await fetchSession();
    if (!data || !data.authenticated || !data.user) return false;
    if (!isFieldRole(data.user.role)) return false;
    return goCampo();
  }

  /** Sync helper when role is already known (login response). */
  function bounceIfFieldRole(role) {
    if (!isFieldRole(role)) return false;
    return goCampo();
  }

  global.__crmFieldGate = {
    VER,
    FIELD_ROLES: Array.from(FIELD_ROLES),
    isFieldRole,
    isCampoPath,
    goCampo,
    bounceFieldToCampo,
    bounceIfFieldRole,
    CAMPO_HOME,
  };

  // Auto-run on office pages (skip Campo itself)
  if (typeof document !== "undefined" && !isCampoPath() && !isAuthPath(global.location?.pathname || "")) {
    bounceFieldToCampo().catch(() => {});
  }
})(typeof window !== "undefined" ? window : globalThis);
