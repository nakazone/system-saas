(function () {
  let canManage = false;

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function fmtWhen(start, end) {
    if (!start) return "—";
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const opts = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    const a = s.toLocaleString(undefined, opts);
    if (!e) return a;
    return `${a} → ${e.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function loadJobs() {
    const q = $("filterQ").value.trim();
    const status = $("filterStatus").value;
    const source = $("filterSource").value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    const j = await api(`/api/work-orders?${params}`);
    const rows = j.data || [];
    const tbody = $("jobsTableBody");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="jobs-empty">Nenhum job encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((wo) => {
        const origin =
          wo.source_name ||
          wo.builder?.company ||
          wo.builder?.name ||
          wo.customer?.name ||
          wo.source_type;
        return `<tr data-id="${wo.id}">
          <td>${wo.number != null ? `#${wo.number}` : "—"}</td>
          <td><strong>${escapeHtml(wo.title)}</strong></td>
          <td>${escapeHtml(origin || "—")}</td>
          <td><span class="job-status is-${escapeHtml(wo.status)}">${escapeHtml(wo.status)}</span></td>
          <td>${fmtWhen(wo.scheduled_start, wo.scheduled_end)}</td>
          <td>${escapeHtml(wo.assigned_user?.name || "—")}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => {
        window.__crmJobModal.openEdit(tr.getAttribute("data-id")).catch((e) => notify(e.message, "error"));
      });
    });
  }

  async function boot() {
    try {
      await window.__crmJobModal.ready;
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      canManage = role === "admin" || perms.includes("work_orders.manage");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";
      if (!canManage) $("btnNewJob").style.display = "none";

      window.__crmJobModal.onSaved(() => loadJobs().catch(() => {}));

      $("btnNewJob").addEventListener("click", () => {
        window.__crmJobModal.openCreate().catch((e) => notify(e.message, "error"));
      });
      $("btnReload").addEventListener("click", () => loadJobs().catch((e) => notify(e.message, "error")));
      ["filterQ", "filterStatus", "filterSource"].forEach((id) => {
        $(id).addEventListener("change", () => loadJobs().catch(() => {}));
        $(id).addEventListener("input", () => {
          if (id === "filterQ") {
            clearTimeout($(id)._t);
            $(id)._t = setTimeout(() => loadJobs().catch(() => {}), 280);
          }
        });
      });

      await loadJobs();

      const openId = sessionStorage.getItem("obramate_open_job");
      if (openId) {
        sessionStorage.removeItem("obramate_open_job");
        window.__crmJobModal.openEdit(openId).catch(() => {});
      } else if (sessionStorage.getItem("obramate_job_pref_start") && canManage) {
        window.__crmJobModal.openCreate().catch(() => {});
      }
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
