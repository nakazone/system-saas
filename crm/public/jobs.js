(function () {
  let canManage = false;
  let allJobs = [];

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

  function clientLabel(wo) {
    return (
      wo.customer?.name ||
      wo.builder?.company ||
      wo.builder?.name ||
      wo.source_name ||
      wo.title ||
      "—"
    );
  }

  function fmtSchedule(start, end) {
    if (!start) return "Unscheduled";
    const s = new Date(start);
    const opts = { month: "long", day: "numeric", year: "numeric" };
    const day = s.toLocaleDateString(undefined, opts);
    if (!end) return day;
    const e = new Date(end);
    if (s.toDateString() === e.toDateString()) return day;
    return `${day} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }

  function statusLabel(status) {
    const map = {
      draft: "Draft",
      scheduled: "Upcoming",
      in_progress: "In progress",
      completed: "Completed",
      canceled: "Canceled",
    };
    return map[status] || status;
  }

  function renderOverview(rows) {
    const now = Date.now();
    const dayMs = 86400000;
    let unscheduled = 0;
    let late = 0;
    let scheduled = 0;
    let progress = 0;
    let done = 0;
    let next30 = 0;
    let past30 = 0;

    rows.forEach((wo) => {
      if (wo.status === "canceled") return;
      if (wo.status === "draft" || !wo.scheduled_start) unscheduled += 1;
      if (wo.status === "scheduled") scheduled += 1;
      if (wo.status === "in_progress") progress += 1;
      if (wo.status === "completed") done += 1;

      if (wo.scheduled_end) {
        const end = new Date(wo.scheduled_end).getTime();
        if (end < now && (wo.status === "scheduled" || wo.status === "in_progress")) late += 1;
      }
      if (wo.scheduled_start) {
        const start = new Date(wo.scheduled_start).getTime();
        if (start >= now && start <= now + 30 * dayMs) next30 += 1;
      }
      if (wo.status === "completed" && wo.scheduled_end) {
        const end = new Date(wo.scheduled_end).getTime();
        if (end >= now - 30 * dayMs && end <= now) past30 += 1;
      }
    });

    $("ovUnscheduled").textContent = String(unscheduled);
    $("ovLate").textContent = String(late);
    $("ovScheduled").textContent = String(scheduled);
    $("ovProgress").textContent = String(progress);
    $("ovDone").textContent = String(done);
    $("ovNext30").textContent = String(next30);
    $("ovPast30").textContent = String(past30);
  }

  function renderTable(rows) {
    const tbody = $("jobsTableBody");
    $("jobsResultCount").textContent = `(${rows.length} result${rows.length === 1 ? "" : "s"})`;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="jobs-empty">Nenhum job encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((wo) => {
        return `<tr data-id="${wo.id}">
          <td class="jobs-table__client">${escapeHtml(clientLabel(wo))}</td>
          <td>${wo.number != null ? `#${wo.number}` : "—"}</td>
          <td class="jobs-table__muted">${escapeHtml(wo.address || "—")}</td>
          <td>${escapeHtml(fmtSchedule(wo.scheduled_start, wo.scheduled_end))}</td>
          <td><span class="job-status is-${escapeHtml(wo.status)}">${escapeHtml(statusLabel(wo.status))}</span></td>
          <td class="jobs-table__muted">${escapeHtml(wo.assigned_user?.name || "—")}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => {
        window.location.href = `job-detail.html?id=${encodeURIComponent(tr.getAttribute("data-id"))}`;
      });
    });
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
    allJobs = j.data || [];
    renderOverview(allJobs);
    renderTable(allJobs);
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
        window.location.href = `job-detail.html?id=${encodeURIComponent(openId)}`;
        return;
      }
      if (sessionStorage.getItem("obramate_job_pref_start") && canManage) {
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
