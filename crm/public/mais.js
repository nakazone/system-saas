(function () {
  const $ = (id) => document.getElementById(id);

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function roleLabel(role) {
    const r = String(role || "").toLowerCase();
    if (r === "admin") return "Admin";
    if (r === "manager") return "Manager";
    if (r === "sales") return "Vendas";
    if (r === "builder") return "Builder";
    return role || "—";
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function canSee(need, anyNeed, role, keys) {
    if (String(role || "").toLowerCase() === "admin") return true;
    if (need && keys.has(need)) return true;
    if (anyNeed) {
      return String(anyNeed)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .some((p) => keys.has(p));
    }
    return !need && !anyNeed;
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_) {}
    location.href = "/login.html";
  }

  async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const user = s.user || {};
      const name = user.name || user.email || "—";
      const role = user.role || "";
      const perms = user.permissions || [];
      const keys = new Set(perms);
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;

      const av = initials(name);
      const avatar = $("maisAvatar");
      if (avatar) avatar.textContent = av;
      const un = $("maisUserName");
      if (un) un.textContent = name;
      const ur = $("maisUserRole");
      if (ur) ur.textContent = roleLabel(role);

      const sn = $("sidebarUserName");
      if (sn) sn.textContent = name;
      const sr = $("sidebarUserRole");
      if (sr) sr.textContent = roleLabel(role);
      const sa = $("sidebarUserAvatar");
      if (sa) sa.textContent = av;

      document.querySelectorAll("#maisOpsGrid [data-crm-permission], #maisOpsGrid [data-crm-permission-any]").forEach((el) => {
        const need = el.getAttribute("data-crm-permission");
        const any = el.getAttribute("data-crm-permission-any");
        el.style.display = canSee(need, any, role, keys) ? "" : "none";
      });
    } catch (_) {
      location.href = "/login.html";
    }

    $("maisLogout")?.addEventListener("click", () => logout());
    $("logoutBtn")?.addEventListener("click", () => logout());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
