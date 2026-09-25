/**
 * Campo gate — session + field-role helper.
 * Mobile field → Campo; desktop field → funcionario.html (PC shell).
 */
(function (global) {
  const FIELD_ROLES = new Set(["installer", "crew_lead"]);

  function isFieldRole(role) {
    return FIELD_ROLES.has(String(role || "").toLowerCase());
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

  function isMobile() {
    if (global.__omDevice && typeof global.__omDevice.isMobile === "function") {
      return global.__omDevice.isMobile();
    }
    return true;
  }

  /**
   * On Admin home: send field workers to Campo (mobile) or funcionario (desktop).
   */
  async function redirectFieldToCampo() {
    const data = await fetchSession();
    if (!data || !data.authenticated || !data.user) return false;
    if (!isFieldRole(data.user.role)) return false;
    const href = isMobile() ? "/campo/hoje.html" : "/funcionario.html";
    try {
      location.replace(href);
    } catch (_) {
      location.href = href;
    }
    return true;
  }

  async function enrichUserFromSession(mockUser) {
    const data = await fetchSession();
    if (!data || !data.authenticated || !data.user) return mockUser;
    const name = data.user.name || mockUser.name;
    const parts = String(name).trim().split(/\s+/);
    const firstName = parts[0] || mockUser.firstName;
    const initials =
      (parts[0] && parts[0][0] ? parts[0][0] : "") +
      (parts[1] && parts[1][0] ? parts[1][0] : parts[0] && parts[0][1] ? parts[0][1] : "");
    return {
      ...mockUser,
      id: data.user.id || mockUser.id,
      name,
      firstName,
      initials: (initials || mockUser.initials).toUpperCase(),
      role: data.user.role,
    };
  }

  global.__campoGate = {
    isFieldRole,
    fetchSession,
    redirectFieldToCampo,
    enrichUserFromSession,
  };
})(typeof window !== "undefined" ? window : globalThis);
