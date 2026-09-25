/**
 * Campo gate — session + field-role helper.
 * Phase 1: mock UI works even without session; field roles stay in Campo.
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

  /**
   * On Admin mobile home: send installers/crew leads to Campo.
   * Returns true if a redirect was triggered.
   */
  async function redirectFieldToCampo() {
    const data = await fetchSession();
    if (!data || !data.authenticated || !data.user) return false;
    if (!isFieldRole(data.user.role)) return false;
    const mobile =
      global.__omDevice && typeof global.__omDevice.isMobile === "function"
        ? global.__omDevice.isMobile()
        : true;
    if (!mobile) return false;
    try {
      location.replace("/campo/hoje.html");
    } catch (_) {
      location.href = "/campo/hoje.html";
    }
    return true;
  }

  /**
   * Optional: if office user lands on Campo with ?force=0, bounce to Admin home.
   * Phase 1 keeps Campo open for preview (office can view mocks).
   */
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
