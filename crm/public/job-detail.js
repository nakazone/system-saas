(function () {
  let canManage = false;
  let job = null;
  let jobId = null;

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

  function statusLabel(status) {
    const map = {
      draft: "Draft",
      scheduled: "Upcoming",
      in_progress: "In progress",
      completed: "Completed",
      canceled: "Canceled",
    };
    return map[status] || status || "—";
  }

  function clientLabel(wo) {
    return (
      wo.customer?.name ||
      wo.builder?.company ||
      wo.builder?.name ||
      wo.source_name ||
      "Client"
    );
  }

  function fmtDay(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function fmtWhen(start, end) {
    if (!start) return "—";
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const opts = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    const a = s.toLocaleString(undefined, opts);
    if (!e) return a;
    return `${a} – ${e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }

  function sourceLabel(wo) {
    const type = wo.source_type || "other";
    const name = wo.source_name;
    if (name) return `${type} · ${name}`;
    return type;
  }

  function render() {
    if (!job) return;
    const client = clientLabel(job);
    document.title = `Job for ${client} | ObraMate`;

    const badge = $("jobStatusBadge");
    badge.className = `job-status is-${job.status || "draft"}`;
    badge.textContent = statusLabel(job.status);

    $("jobDetailTitle").textContent = `Job for ${client}`;
    $("jobClientName").textContent = client;
    $("jobProperty").textContent = job.address || "No property address";

    const contact = $("jobClientContact");
    const bits = [];
    if (job.customer?.phone) {
      bits.push(`<a href="tel:${escapeHtml(job.customer.phone)}">${escapeHtml(job.customer.phone)}</a>`);
    }
    if (job.customer?.email) {
      bits.push(`<a href="mailto:${escapeHtml(job.customer.email)}">${escapeHtml(job.customer.email)}</a>`);
    }
    contact.innerHTML = bits.length ? bits.join("") : '<span style="color:#8a8074">Sem contacto</span>';

    $("jobMetaNumber").textContent = job.number != null ? String(job.number) : "—";
    $("jobMetaSource").textContent = sourceLabel(job);
    $("jobMetaStart").textContent = fmtDay(job.scheduled_start);
    $("jobMetaEnd").textContent = fmtDay(job.scheduled_end);
    $("jobMetaAssignee").textContent = job.assigned_user?.name || "—";

    const members = Array.isArray(job.members) ? job.members : [];
    const temps = Array.isArray(job.temp_workers) ? job.temp_workers : [];
    const memberNames = members.map((m) => m.name).filter(Boolean);
    $("jobMetaTeam").textContent = memberNames.length
      ? memberNames.join(", ")
      : temps.length
        ? `${temps.length} temporário(s)`
        : "—";

    const servicesBody = $("jobServicesBody");
    if (servicesBody) {
      const lines = Array.isArray(job.line_items) ? job.line_items : [];
      if (!lines.length) {
        servicesBody.innerHTML =
          '<p class="jobs-empty" style="padding:1rem 0">Sem serviços neste job. Use Editar serviços para adicionar.</p>';
      } else {
        const rows = lines
          .map(
            (li) => `<tr>
              <td>${escapeHtml(li.service_name || "—")}</td>
              <td style="text-align:right">${escapeHtml(String(li.quantity_sqft ?? 0))}</td>
              <td style="text-align:right">${escapeHtml(
                (Number(li.unit_price) || 0).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                }),
              )}</td>
              <td style="text-align:right">${escapeHtml(
                (Number(li.line_total) || 0).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                }),
              )}</td>
            </tr>`,
          )
          .join("");
        const total = (Number(job.services_total) || 0).toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
        });
        servicesBody.innerHTML = `<table class="job-visits-table">
          <thead><tr><th>Serviço</th><th style="text-align:right">Sqft</th><th style="text-align:right">Preço</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${escapeHtml(total)}</td></tr></tfoot>
        </table>`;
      }
    }

    const teamBody = $("jobTeamBody");
    if (teamBody) {
      const parts = [];
      if (job.assigned_user?.name) {
        parts.push(`<p><strong>Responsável:</strong> ${escapeHtml(job.assigned_user.name)}</p>`);
      }
      if (memberNames.length) {
        parts.push(
          `<p><strong>Equipe:</strong> ${memberNames.map(escapeHtml).join(", ")}</p>`,
        );
      }
      if (temps.length) {
        parts.push(
          `<div style="margin-top:0.65rem"><strong>Temporários</strong><ul style="margin:0.35rem 0 0;padding-left:1.1rem">${temps
            .map(
              (t) =>
                `<li>${escapeHtml(t.name)}${
                  t.phone || t.email
                    ? ` <span style="color:#8a8074">(${escapeHtml([t.phone, t.email].filter(Boolean).join(" · "))})</span>`
                    : ""
                }</li>`,
            )
            .join("")}</ul></div>`,
        );
      }
      if (!parts.length) {
        teamBody.innerHTML =
          '<p class="jobs-empty" style="padding:0.5rem 0">Sem equipe adicional. Use Gerir para adicionar.</p>';
      } else {
        teamBody.innerHTML = parts.join("");
      }
    }

    $("jobNotes").value = job.notes || "";
    const preview = (job.notes || "").trim();
    $("jobRailNotesPreview").textContent = preview || "Leave an internal note for yourself or a team member.";

    const visits = $("jobVisitsBody");
    if (job.scheduled_start) {
      visits.innerHTML = `<table class="job-visits-table">
        <thead>
          <tr>
            <th>Date and time</th>
            <th>Title</th>
            <th>Status</th>
            <th>Assigned</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(fmtWhen(job.scheduled_start, job.scheduled_end))}</td>
            <td>${escapeHtml(job.title || "Job visit")}</td>
            <td><span class="job-status is-${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span></td>
            <td>${escapeHtml(job.assigned_user?.name || "—")}</td>
          </tr>
        </tbody>
      </table>`;
    } else {
      visits.innerHTML = '<p class="jobs-empty" style="padding:1rem 0">Sem agendamento. Edite o job ou use o Schedule.</p>';
    }

    const schedHref = job.scheduled_start
      ? `schedule.html?focus=${encodeURIComponent(job.scheduled_start)}`
      : "schedule.html";
    $("btnOpenSchedule").href = schedHref;
    $("btnEditSchedule").href = schedHref;

    if (!canManage) {
      $("btnEditJob").style.display = "none";
      $("btnDeleteJob").style.display = "none";
      $("btnSaveNotes").style.display = "none";
      const manageTeam = $("btnManageTeam");
      if (manageTeam) manageTeam.style.display = "none";
      const editSvc = $("btnEditServices");
      if (editSvc) editSvc.style.display = "none";
      $("jobNotes").readOnly = true;
    }
  }

  async function loadJob() {
    const j = await api(`/api/work-orders/${jobId}`);
    job = j.data;
    render();
  }

  async function saveNotes() {
    if (!canManage || !jobId) return;
    const notes = $("jobNotes").value.trim() || null;
    const j = await api(`/api/work-orders/${jobId}`, {
      method: "PUT",
      body: JSON.stringify({ notes }),
    });
    job = j.data;
    render();
    notify("Notas guardadas.", "success");
  }

  async function deleteJob() {
    if (!canManage || !jobId) return;
    if (!confirm("Excluir este job? Ele será cancelado e sairá da agenda.")) return;
    await api(`/api/work-orders/${jobId}`, { method: "DELETE" });
    notify("Job excluído.", "success");
    window.location.href = "jobs.html";
  }

  async function boot() {
    jobId = new URLSearchParams(window.location.search).get("id");
    if (!jobId) {
      window.location.href = "jobs.html";
      return;
    }

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

      window.__crmJobModal.onSaved((data) => {
        if (!data) {
          window.location.href = "jobs.html";
          return;
        }
        if (data.id === jobId) {
          job = data;
          render();
        } else {
          loadJob().catch(() => {});
        }
      });

      $("btnEditJob").addEventListener("click", () => {
        window.__crmJobModal.openEdit(jobId).catch((e) => notify(e.message, "error"));
      });
      $("btnManageTeam")?.addEventListener("click", () => {
        window.__crmJobModal.openEdit(jobId).catch((e) => notify(e.message, "error"));
      });
      $("btnEditServices")?.addEventListener("click", () => {
        window.__crmJobModal.openEdit(jobId).catch((e) => notify(e.message, "error"));
      });
      $("btnDeleteJob").addEventListener("click", () => {
        deleteJob().catch((e) => notify(e.message, "error"));
      });
      $("btnSaveNotes").addEventListener("click", () => {
        saveNotes().catch((e) => notify(e.message, "error"));
      });
      $("jobNotes").addEventListener("input", () => {
        const preview = $("jobNotes").value.trim();
        $("jobRailNotesPreview").textContent =
          preview || "Leave an internal note for yourself or a team member.";
      });

      await loadJob();
    } catch (err) {
      notify(err.message || "Falha ao carregar job", "error");
      window.location.href = "jobs.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
